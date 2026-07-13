"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";

const validRoles = new Set(["cliente", "vendedor", "mesero", "cocina", "mensajero", "gerente", "admin_sistema"]);

function getString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function getOptionalString(formData: FormData, key: string) {
  const value = getString(formData, key);
  return value.length > 0 ? value : null;
}

function getInteger(formData: FormData, key: string, fallback = 0) {
  const value = getString(formData, key).replace(/\./g, "").replace(/,/g, ".");
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback;
}

function getDecimal(formData: FormData, key: string, fallback = 0) {
  const value = getString(formData, key).replace(/\./g, "").replace(/,/g, ".");
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function getBoolean(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function normalizeCode(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function splitLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function splitCsv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function revalidateMenu() {
  revalidatePath("/");
  revalidatePath("/panel");
  revalidatePath("/panel/menu");
  revalidatePath("/panel/pizzas");
  revalidatePath("/panel/nuevo-pedido");
}

function revalidateInventory() {
  revalidatePath("/panel");
  revalidatePath("/panel/inventario");
  revalidatePath("/panel/insumos");
  revalidatePath("/panel/compras");
  revalidatePath("/panel/gastos");
  revalidatePath("/panel/proveedores");
  revalidatePath("/panel/marcas");
  revalidatePath("/panel/categorias");
}

function getStockUnit(formData: FormData, key = "unit") {
  const value = getString(formData, key);
  return ["g", "kg", "ml", "l", "unit"].includes(value) ? value : "unit";
}

function getOptionalStockUnit(formData: FormData, key: string) {
  const value = getString(formData, key);
  return ["g", "kg", "ml", "l", "unit"].includes(value) ? value : null;
}

function convertStockQuantity(quantity: number, fromUnit: string, toUnit: string) {
  if (fromUnit === toUnit) return quantity;
  if (fromUnit === "g" && toUnit === "kg") return quantity / 1000;
  if (fromUnit === "kg" && toUnit === "g") return quantity * 1000;
  if (fromUnit === "ml" && toUnit === "l") return quantity / 1000;
  if (fromUnit === "l" && toUnit === "ml") return quantity * 1000;
  throw new Error("La unidad elegida no es compatible con la unidad del producto.");
}

export async function updateSiteSettings(formData: FormData) {
  const businessName = getString(formData, "business_name");
  const whatsappNumber = getString(formData, "whatsapp_number");
  const whatsappButtonText = getString(formData, "whatsapp_button_text");
  const whatsappEnabled = formData.get("whatsapp_enabled") === "on";
  const supabase = await createServerSupabaseClient();

  const { error } = await supabase
    .from("site_settings")
    .update({
      business_name: businessName || "ModoPizzas",
      whatsapp_number: whatsappNumber,
      whatsapp_button_text: whatsappButtonText || "Finalizar por WhatsApp",
      whatsapp_enabled: whatsappEnabled,
      updated_at: new Date().toISOString()
    })
    .eq("id", true);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/");
  revalidatePath("/panel");
}

export async function savePizzaSize(formData: FormData) {
  const id = getOptionalString(formData, "id");
  const name = getString(formData, "name");
  const code = normalizeCode(getString(formData, "code") || name);
  const supabase = await createServerSupabaseClient();
  let displayOrder = getInteger(formData, "display_order", 0);

  if (!formData.has("display_order")) {
    if (id) {
      const { data: currentSize, error: currentSizeError } = await supabase
        .from("pizza_sizes")
        .select("display_order")
        .eq("id", id)
        .single();

      if (currentSizeError) {
        throw new Error(currentSizeError.message);
      }

      displayOrder = Number(currentSize?.display_order ?? 0);
    } else {
      const { data: lastSize, error: lastSizeError } = await supabase
        .from("pizza_sizes")
        .select("display_order")
        .order("display_order", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastSizeError) {
        throw new Error(lastSizeError.message);
      }

      displayOrder = Number(lastSize?.display_order ?? 0) + 1;
    }
  }

  const payload = {
    code,
    name,
    description: getOptionalString(formData, "description"),
    diameter_cm: getDecimal(formData, "diameter_cm", 0) || null,
    display_order: displayOrder,
    is_active: getBoolean(formData, "is_active"),
    supports_half_and_half: getBoolean(formData, "supports_half_and_half")
  };

  const query = id
    ? supabase.from("pizza_sizes").update(payload).eq("id", id)
    : supabase.from("pizza_sizes").insert(payload);
  const { error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  revalidateMenu();
  redirect("/panel/pizzas?section=tamanos");
}

export async function deletePizzaSize(formData: FormData) {
  const id = getString(formData, "id");
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("pizza_sizes").delete().eq("id", id);

  if (error) {
    throw new Error(error.message);
  }

  revalidateMenu();
}

export async function savePizzaFlavor(formData: FormData) {
  const id = getOptionalString(formData, "id");
  const name = getString(formData, "name");
  const code = normalizeCode(getString(formData, "code") || name);
  const supabase = await createServerSupabaseClient();
  const payload = {
    code,
    name,
    description: getString(formData, "description"),
    image_url: getOptionalString(formData, "image_url"),
    allergens: splitCsv(getString(formData, "allergens")),
    is_featured: getBoolean(formData, "is_featured"),
    is_public: getBoolean(formData, "is_public"),
    is_active: getBoolean(formData, "is_active")
  };

  const flavorResult = id
    ? await supabase.from("pizza_flavors").update(payload).eq("id", id).select("id").single()
    : await supabase.from("pizza_flavors").insert(payload).select("id").single();

  if (flavorResult.error) {
    throw new Error(flavorResult.error.message);
  }

  const flavorId = flavorResult.data.id;
  const { data: sizes, error: sizesError } = await supabase.from("pizza_sizes").select("id");
  if (sizesError) {
    throw new Error(sizesError.message);
  }

  const prices = (sizes ?? [])
    .filter((size) => formData.has(`price_${size.id}`))
    .map((size) => ({
      flavor_id: flavorId,
      size_id: size.id,
      price_cop: getInteger(formData, `price_${size.id}`, 0)
    }));

  if (prices.length > 0) {
    const { error: pricesError } = await supabase.from("pizza_flavor_prices").upsert(prices, {
      onConflict: "flavor_id,size_id"
    });

    if (pricesError) {
      throw new Error(pricesError.message);
    }
  }

  revalidateMenu();
  redirect("/panel/pizzas?section=sabores");
}

export async function deletePizzaFlavor(formData: FormData) {
  const id = getString(formData, "id");
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("pizza_flavors").delete().eq("id", id);

  if (error) {
    throw new Error(error.message);
  }

  revalidateMenu();
}

export async function savePizzaRecipeAndPrice(formData: FormData) {
  const flavorId = getString(formData, "flavor_id");
  const sizeId = getString(formData, "size_id");
  const priceCop = getInteger(formData, "price_cop", 0);
  const wastePercent = getDecimal(formData, "waste_percent", 5);
  const supabase = await createServerSupabaseClient();

  const { error: deleteError } = await supabase
    .from("recipes")
    .delete()
    .eq("flavor_id", flavorId)
    .eq("size_id", sizeId)
    .is("extra_id", null);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  const rowCount = Math.min(getInteger(formData, "row_count", 4), 40);
  const rows = Array.from({ length: rowCount })
    .map((_, index) => {
      const inventoryItemId = getOptionalString(formData, `ingredient_${index}`);
      const quantity = getDecimal(formData, `quantity_${index}`, 0);
      const unit = getOptionalStockUnit(formData, `unit_${index}`);

      if (!inventoryItemId || quantity <= 0 || !unit) {
        return null;
      }

      return {
        flavor_id: flavorId,
        size_id: sizeId,
        inventory_item_id: inventoryItemId,
        quantity,
        unit
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  if (rows.length > 0) {
    const { error: insertError } = await supabase.from("recipes").insert(rows);
    if (insertError) {
      throw new Error(insertError.message);
    }
  }

  const { error: priceError } = await supabase.from("pizza_flavor_prices").upsert(
    {
      flavor_id: flavorId,
      size_id: sizeId,
      price_cop: priceCop,
      waste_percent: wastePercent
    },
    { onConflict: "flavor_id,size_id" }
  );

  if (priceError) {
    throw new Error(priceError.message);
  }

  revalidateMenu();
  revalidatePath("/panel/pizzas");
}

export async function savePizzaExtra(formData: FormData) {
  const id = getOptionalString(formData, "id");
  const name = getString(formData, "name");
  const code = normalizeCode(getString(formData, "code") || name);
  const supabase = await createServerSupabaseClient();
  const payload = {
    code,
    name,
    price_cop: getInteger(formData, "price_cop", 0),
    extra_kind: getString(formData, "extra_kind") === "crust" ? "crust" : "addition",
    is_active: getBoolean(formData, "is_active")
  };

  const query = id
    ? supabase.from("pizza_extras").update(payload).eq("id", id)
    : supabase.from("pizza_extras").insert(payload);
  const { error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  revalidateMenu();
}

export async function saveCombo(formData: FormData) {
  const id = getOptionalString(formData, "id");
  const name = getString(formData, "name");
  const code = normalizeCode(getString(formData, "code") || name);
  const supabase = await createServerSupabaseClient();
  const payload = {
    code,
    name,
    description: getString(formData, "description"),
    price_cop: getInteger(formData, "price_cop", 0),
    is_public: getBoolean(formData, "is_public"),
    is_active: getBoolean(formData, "is_active")
  };

  const comboResult = id
    ? await supabase.from("combos").update(payload).eq("id", id).select("id").single()
    : await supabase.from("combos").insert(payload).select("id").single();

  if (comboResult.error) {
    throw new Error(comboResult.error.message);
  }

  const comboId = comboResult.data.id;
  const { error: deleteError } = await supabase.from("combo_items").delete().eq("combo_id", comboId);
  if (deleteError) {
    throw new Error(deleteError.message);
  }

  const items = splitLines(getString(formData, "items")).map((item) => ({
    combo_id: comboId,
    item_label: item,
    quantity: 1
  }));

  if (items.length > 0) {
    const { error: insertError } = await supabase.from("combo_items").insert(items);
    if (insertError) {
      throw new Error(insertError.message);
    }
  }

  revalidateMenu();
}

export async function saveInventoryItem(formData: FormData) {
  const id = getOptionalString(formData, "id");
  const supabase = await createServerSupabaseClient();
  const payload: {
    name: string;
    unit: string;
    is_active: boolean;
    sku?: string | null;
    category_id?: string | null;
    presentation_quantity?: number | null;
    presentation_unit?: string | null;
    current_quantity?: number;
    average_cost_cop?: number;
  } = {
    name: getString(formData, "name"),
    unit: getStockUnit(formData),
    is_active: getBoolean(formData, "is_active")
  };

  if (formData.has("sku")) {
    payload.sku = getOptionalString(formData, "sku");
  }

  if (formData.has("category_id")) {
    payload.category_id = getOptionalString(formData, "category_id");
  }

  if (formData.has("presentation_quantity")) {
    const presentationQuantity = getDecimal(formData, "presentation_quantity", 0);
    payload.presentation_quantity = presentationQuantity > 0 ? presentationQuantity : null;
    payload.presentation_unit = presentationQuantity > 0 ? getStockUnit(formData, "presentation_unit") : null;
  }

  if (formData.has("current_quantity")) {
    payload.current_quantity = getDecimal(formData, "current_quantity", 0);
  }

  if (formData.has("average_cost_cop")) {
    payload.average_cost_cop = getDecimal(formData, "average_cost_cop", 0);
  }

  const query = id
    ? supabase.from("inventory_items").update(payload).eq("id", id)
    : supabase.from("inventory_items").insert(payload);
  const { error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  revalidateInventory();
}

export async function saveProductCategory(formData: FormData) {
  const id = getOptionalString(formData, "id");
  const supabase = await createServerSupabaseClient();
  const payload = {
    name: getString(formData, "name"),
    description: getOptionalString(formData, "description"),
    is_active: getBoolean(formData, "is_active"),
    updated_at: new Date().toISOString()
  };

  const query = id
    ? supabase.from("product_categories").update(payload).eq("id", id)
    : supabase.from("product_categories").insert(payload);
  const { error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  revalidateInventory();
}

export async function saveSupplier(formData: FormData) {
  const id = getOptionalString(formData, "id");
  const supabase = await createServerSupabaseClient();
  const payload = {
    name: getString(formData, "name"),
    phone: getOptionalString(formData, "phone"),
    notes: getOptionalString(formData, "notes"),
    is_active: getBoolean(formData, "is_active")
  };

  const query = id ? supabase.from("suppliers").update(payload).eq("id", id) : supabase.from("suppliers").insert(payload);
  const { error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  revalidateInventory();
}

export async function saveBrand(formData: FormData) {
  const id = getOptionalString(formData, "id");
  const supabase = await createServerSupabaseClient();
  const payload = {
    name: getString(formData, "name"),
    category: getOptionalString(formData, "category"),
    notes: getOptionalString(formData, "notes"),
    is_active: getBoolean(formData, "is_active"),
    updated_at: new Date().toISOString()
  };

  const query = id ? supabase.from("brands").update(payload).eq("id", id) : supabase.from("brands").insert(payload);
  const { error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  revalidateInventory();
}

export async function registerPurchase(formData: FormData) {
  const purchaseId = getOptionalString(formData, "purchase_id");
  const inventoryItemId = getString(formData, "inventory_item_id");
  const enteredQuantity = getDecimal(formData, "quantity", 0);
  const presentationQuantity = getDecimal(formData, "presentation_quantity", 0);
  const presentationUnit = getStockUnit(formData, "presentation_unit");
  const lineTotal = getInteger(formData, "total_paid_cop", getInteger(formData, "unit_cost_cop", 0));
  const purchaseDate = getString(formData, "purchase_date");
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Debes iniciar sesion.");
  }

  const { data: item, error: itemError } = await supabase
    .from("inventory_items")
    .select("id, unit, current_quantity, average_cost_cop")
    .eq("id", inventoryItemId)
    .single();

  if (itemError) {
    throw new Error(itemError.message);
  }

  if (purchaseId) {
    await reversePurchaseStock(supabase, purchaseId, user.id);
  }

  const quantity =
    presentationQuantity > 0
      ? convertStockQuantity(enteredQuantity * presentationQuantity, presentationUnit, item.unit)
      : convertStockQuantity(enteredQuantity, "unit", item.unit);
  const unitCost = quantity > 0 ? Math.round((lineTotal / quantity) * 100) / 100 : 0;

  const purchasePayload = {
      supplier_id: getOptionalString(formData, "supplier_id"),
      brand_id: getOptionalString(formData, "brand_id"),
      purchased_by: user.id,
      total_cop: lineTotal,
      notes: getOptionalString(formData, "notes"),
      purchased_at: purchaseDate ? `${purchaseDate}T12:00:00-05:00` : new Date().toISOString()
    };
  const purchaseResult = purchaseId
    ? await supabase.from("purchases").update(purchasePayload).eq("id", purchaseId).select("id").single()
    : await supabase
    .from("purchases")
    .insert(purchasePayload)
    .select("id")
    .single();
  const purchase = purchaseResult.data;
  const purchaseError = purchaseResult.error;

  if (purchaseError) {
    throw new Error(purchaseError.message);
  }
  if (!purchase) {
    throw new Error("No se pudo guardar la compra.");
  }

  if (purchaseId) {
    const { error: deleteLineError } = await supabase.from("purchase_items").delete().eq("purchase_id", purchaseId);
    if (deleteLineError) {
      throw new Error(deleteLineError.message);
    }
  }

  const { error: lineError } = await supabase.from("purchase_items").insert({
    purchase_id: purchase.id,
    inventory_item_id: inventoryItemId,
    purchased_quantity: enteredQuantity,
    quantity,
    unit: item.unit,
    presentation_quantity: presentationQuantity > 0 ? presentationQuantity : null,
    presentation_unit: presentationQuantity > 0 ? presentationUnit : null,
    unit_cost_cop: unitCost,
    line_total_cop: lineTotal
  });

  if (lineError) {
    throw new Error(lineError.message);
  }

  const currentQuantity = Number(item.current_quantity ?? 0);
  const currentAverage = Number(item.average_cost_cop ?? 0);
  const nextQuantity = currentQuantity + quantity;
  const nextAverage =
    nextQuantity > 0 ? Math.round(((currentQuantity * currentAverage + lineTotal) / nextQuantity) * 100) / 100 : unitCost;

  const { error: updateError } = await supabase
    .from("inventory_items")
    .update({
      current_quantity: nextQuantity,
      average_cost_cop: nextAverage
    })
    .eq("id", inventoryItemId);

  if (updateError) {
    throw new Error(updateError.message);
  }

  await supabase.from("inventory_movements").insert({
    inventory_item_id: inventoryItemId,
    movement_kind: "purchase",
    quantity_delta: quantity,
    unit: item.unit,
    source_table: "purchases",
    source_id: purchase.id,
    note: getOptionalString(formData, "notes"),
    created_by: user.id
  });

  revalidateInventory();
  if (purchaseId) {
    redirect("/panel/compras");
  }
}

async function reversePurchaseStock(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  purchaseId: string,
  userId: string
) {
  const { data: lines, error } = await supabase
    .from("purchase_items")
    .select("inventory_item_id, quantity, unit, line_total_cop")
    .eq("purchase_id", purchaseId);

  if (error) {
    throw new Error(error.message);
  }

  for (const line of lines ?? []) {
    const { data: item, error: itemError } = await supabase
      .from("inventory_items")
      .select("id, current_quantity, average_cost_cop")
      .eq("id", line.inventory_item_id)
      .single();

    if (itemError) {
      throw new Error(itemError.message);
    }

    const currentQuantity = Number(item.current_quantity ?? 0);
    const currentAverage = Number(item.average_cost_cop ?? 0);
    const reverseQuantity = Number(line.quantity ?? 0);
    const reverseTotal = Number(line.line_total_cop ?? 0);
    const nextQuantity = Math.max(0, currentQuantity - reverseQuantity);
    const remainingValue = Math.max(0, currentQuantity * currentAverage - reverseTotal);
    const nextAverage = nextQuantity > 0 ? Math.round((remainingValue / nextQuantity) * 100) / 100 : 0;

    const { error: updateError } = await supabase
      .from("inventory_items")
      .update({
        current_quantity: nextQuantity,
        average_cost_cop: nextAverage
      })
      .eq("id", item.id);

    if (updateError) {
      throw new Error(updateError.message);
    }

    await supabase.from("inventory_movements").insert({
      inventory_item_id: item.id,
      movement_kind: "adjustment",
      quantity_delta: -reverseQuantity,
      unit: line.unit,
      source_table: "purchases",
      source_id: purchaseId,
      note: "Reversion de compra",
      created_by: userId
    });
  }
}

export async function deletePurchase(formData: FormData) {
  const purchaseId = getString(formData, "purchase_id");
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Debes iniciar sesion.");
  }

  await reversePurchaseStock(supabase, purchaseId, user.id);

  const { error } = await supabase.from("purchases").delete().eq("id", purchaseId);
  if (error) {
    throw new Error(error.message);
  }

  revalidateInventory();
}

export async function updatePurchaseMeta(formData: FormData) {
  const id = getString(formData, "id");
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("purchases")
    .update({
      supplier_id: getOptionalString(formData, "supplier_id"),
      brand_id: getOptionalString(formData, "brand_id"),
      notes: getOptionalString(formData, "notes")
    })
    .eq("id", id);

  if (error) {
    throw new Error(error.message);
  }

  revalidateInventory();
}

export async function registerExpense(formData: FormData) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Debes iniciar sesion.");
  }

  const { error } = await supabase.from("expenses").insert({
    category: getString(formData, "category"),
    description: getString(formData, "description"),
    amount_cop: getDecimal(formData, "amount_cop", 0),
    paid_by: user.id
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidateInventory();
}

export async function assignUserRole(formData: FormData) {
  const userId = getString(formData, "user_id");
  const role = getString(formData, "role");
  const supabase = await createServerSupabaseClient();

  if (!validRoles.has(role)) {
    throw new Error("Rol no valido.");
  }

  const { error } = await supabase.from("user_roles").insert({
    user_id: userId,
    role
  });

  if (error && error.code !== "23505") {
    throw new Error(error.message);
  }

  revalidatePath("/panel");
}

export async function removeUserRole(formData: FormData) {
  const userId = getString(formData, "user_id");
  const role = getString(formData, "role");
  const supabase = await createServerSupabaseClient();

  const { error } = await supabase.from("user_roles").delete().eq("user_id", userId).eq("role", role);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/panel");
}
