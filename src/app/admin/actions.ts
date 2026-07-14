"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";

const validRoles = new Set(["cliente", "vendedor", "mesero", "cocina", "mensajero", "gerente", "admin_sistema"]);

export type FormActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

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
  revalidatePath("/panel/productos");
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

function getInventoryItemKind(formData: FormData, key = "item_kind") {
  const value = getString(formData, key);
  if (value === "ingredient" || value === "sale_product" || value === "supply") return value;
  return "";
}

function normalizeSkuName(value: string) {
  const normalized = value
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]/g, "");
  return normalized.padEnd(3, "X").slice(0, 3);
}

function upperText(value: string | null) {
  return value ? value.toUpperCase() : null;
}

function presentationCode(quantity: number, unit: string) {
  const normalizedQuantity = new Intl.NumberFormat("es-CO", {
    maximumFractionDigits: 3,
    useGrouping: false
  })
    .format(quantity)
    .replace(",", "");
  const normalizedUnit = unit === "unit" ? "UND" : unit.toUpperCase();
  return `${normalizedQuantity}${normalizedUnit}`;
}

function buildReferenceSku(name: string, quantity: number, unit: string) {
  return `${normalizeSkuName(name)}${presentationCode(quantity, unit)}`;
}

function normalizeReferenceSku(value: string | null) {
  if (!value) return null;
  const normalized = value
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, "");
  return normalized || null;
}

function canonicalStockUnit(unit: string) {
  if (unit === "kg" || unit === "g") return "g";
  if (unit === "l" || unit === "ml") return "ml";
  return "unit";
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

export async function saveInventoryItem(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const id = getOptionalString(formData, "id");
  const supabase = await createServerSupabaseClient();
  const itemKind = getInventoryItemKind(formData);
  if (!itemKind) {
    return { status: "error", message: "Selecciona un tipo de producto." };
  }
  const payload: {
    name: string;
    unit: string;
    item_kind: "ingredient" | "sale_product" | "supply";
    is_active: boolean;
    category_id?: string | null;
    presentation_quantity: number | null;
    presentation_unit: string | null;
    current_quantity?: number;
    average_cost_cop?: number;
  } = {
    name: getString(formData, "name"),
    unit: itemKind === "sale_product" ? "unit" : getStockUnit(formData),
    item_kind: itemKind,
    is_active: getBoolean(formData, "is_active"),
    presentation_quantity: null,
    presentation_unit: null
  };

  if (formData.has("category_id")) {
    payload.category_id = getOptionalString(formData, "category_id");
  }

  if (formData.has("current_quantity")) {
    payload.current_quantity = getDecimal(formData, "current_quantity", 0);
  }

  if (formData.has("average_cost_cop")) {
    payload.average_cost_cop = getDecimal(formData, "average_cost_cop", 0);
  }

  if (id) {
    const { error } = await supabase.from("inventory_items").update(payload).eq("id", id);
    if (error) {
      return { status: "error", message: error.message };
    }

    revalidateInventory();
    return { status: "success", message: "Guardado correctamente" };
  }

  const insertResult = await supabase.from("inventory_items").insert(payload).select("id").single();
  if (insertResult.error) {
    return { status: "error", message: insertResult.error.message };
  }

  revalidateInventory();
  return { status: "success", message: "Guardado correctamente" };
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

async function resolvePurchaseInventoryItem(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  masterItemId: string,
  purchaseKind: string,
  presentationQuantity: number,
  presentationUnit: string,
  referenceSku: string | null
) {
  const { data: masterItem, error: masterItemError } = await supabase
    .from("inventory_items")
    .select("id, name, sku, unit, item_kind, category_id, presentation_quantity, presentation_unit, current_quantity, average_cost_cop, is_active")
    .eq("id", masterItemId)
    .single();

  if (masterItemError) {
    throw new Error(masterItemError.message);
  }

  if (purchaseKind === "ingredient") {
    return masterItem;
  }

  const referenceName = masterItem.name.toUpperCase();
  const legacyReferenceName = `${masterItem.name} ${presentationCode(presentationQuantity, presentationUnit)}`.toUpperCase();
  const { data: existingReference, error: existingReferenceError } = await supabase
    .from("inventory_items")
    .select("id, name, sku, unit, item_kind, category_id, presentation_quantity, presentation_unit, current_quantity, average_cost_cop, is_active")
    .eq("item_kind", purchaseKind)
    .eq("presentation_quantity", presentationQuantity)
    .eq("presentation_unit", presentationUnit)
    .in("name", [referenceName, legacyReferenceName])
    .maybeSingle();

  if (existingReferenceError) {
    throw new Error(existingReferenceError.message);
  }

  if (existingReference) {
    return existingReference;
  }

  const sku = normalizeReferenceSku(referenceSku) ?? buildReferenceSku(masterItem.name, presentationQuantity, presentationUnit);
  const { data: duplicateSku, error: duplicateSkuError } = await supabase
    .from("inventory_items")
    .select("id")
    .ilike("sku", sku)
    .limit(1)
    .maybeSingle();

  if (duplicateSkuError) {
    throw new Error(duplicateSkuError.message);
  }

  if (duplicateSku) {
    throw new Error(`Ya existe un producto con el SKU ${sku}.`);
  }

  const insertResult = await supabase
    .from("inventory_items")
    .insert({
      name: referenceName,
      sku,
      unit: "unit",
      item_kind: purchaseKind,
      category_id: masterItem.category_id,
      presentation_quantity: presentationQuantity,
      presentation_unit: presentationUnit,
      is_active: true,
      current_quantity: 0,
      average_cost_cop: 0
    })
    .select("id, name, sku, unit, item_kind, category_id, presentation_quantity, presentation_unit, current_quantity, average_cost_cop, is_active")
    .single();

  if (insertResult.error) {
    throw new Error(insertResult.error.message);
  }

  return insertResult.data;
}

export async function registerPurchase(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const purchaseId = getOptionalString(formData, "purchase_id");
  let inventoryItemId = getString(formData, "inventory_item_id");
  const purchaseKind = getInventoryItemKind(formData, "purchase_kind");
  const enteredQuantity = getDecimal(formData, "quantity", 0);
  const presentationQuantity = getDecimal(formData, "presentation_quantity", 0);
  const presentationUnit = getStockUnit(formData, "presentation_unit");
  const lineTotal = getInteger(formData, "total_paid_cop", getInteger(formData, "unit_cost_cop", 0));
  const purchaseDate = getString(formData, "purchase_date");
  const expirationDate = getOptionalString(formData, "expiration_date");
  const referenceSku = normalizeReferenceSku(getOptionalString(formData, "reference_sku"));
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return { status: "error", message: "Debes iniciar sesion." };
  }

  if (!purchaseKind) {
    return { status: "error", message: "Selecciona una seccion de compra." };
  }

  if (purchaseId) {
    await reversePurchaseStock(supabase, purchaseId, user.id);
  }

  let quantity = 0;
  let item: {
    id: string;
    unit: string;
    current_quantity?: number | string | null;
    average_cost_cop?: number | string | null;
  };
  let previousItemUnit = "unit";
  try {
    item = await resolvePurchaseInventoryItem(supabase, inventoryItemId, purchaseKind, presentationQuantity, presentationUnit, referenceSku);
    inventoryItemId = item.id;
    previousItemUnit = item.unit;
    const targetUnit = purchaseKind === "ingredient" ? canonicalStockUnit(presentationUnit) : "unit";
    quantity =
      purchaseKind === "sale_product" || purchaseKind === "supply"
        ? convertStockQuantity(enteredQuantity, "unit", targetUnit)
        : convertStockQuantity(enteredQuantity, presentationUnit, targetUnit);
    item.unit = targetUnit;
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "No se pudo resolver el producto de inventario." };
  }
  const unitCost = quantity > 0 ? Math.round((lineTotal / quantity) * 100) / 100 : 0;

  const purchasePayload = {
      supplier_id: getOptionalString(formData, "supplier_id"),
      brand_id: getOptionalString(formData, "brand_id"),
      purchased_by: user.id,
      total_cop: lineTotal,
      notes: upperText(getOptionalString(formData, "notes")),
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
    return { status: "error", message: purchaseError.message };
  }
  if (!purchase) {
    return { status: "error", message: "No se pudo guardar la compra." };
  }

  if (purchaseId) {
    const { error: deleteLineError } = await supabase.from("purchase_items").delete().eq("purchase_id", purchaseId);
    if (deleteLineError) {
      return { status: "error", message: deleteLineError.message };
    }
  }

  const purchaseLinePayload: {
    purchase_id: string;
    inventory_item_id: string;
    purchased_quantity: number;
    quantity: number;
    unit: string;
    presentation_quantity: number | null;
    presentation_unit: string | null;
    unit_cost_cop: number;
    line_total_cop: number;
    expiration_date?: string;
  } = {
    purchase_id: purchase.id,
    inventory_item_id: inventoryItemId,
    purchased_quantity: enteredQuantity,
    quantity,
    unit: item.unit,
    presentation_quantity: presentationQuantity > 0 ? presentationQuantity : null,
    presentation_unit: presentationQuantity > 0 ? presentationUnit : null,
    unit_cost_cop: unitCost,
    line_total_cop: lineTotal
  };

  if (expirationDate) {
    purchaseLinePayload.expiration_date = expirationDate;
  }

  const { error: lineError } = await supabase.from("purchase_items").insert(purchaseLinePayload);

  if (lineError) {
    return { status: "error", message: lineError.message };
  }

  const storedUnit = item.unit;
  const currentQuantity = convertStockQuantity(Number(item.current_quantity ?? 0), previousItemUnit, storedUnit);
  const currentAverage = Number(item.average_cost_cop ?? 0);
  const nextQuantity = currentQuantity + quantity;
  const nextAverage =
    nextQuantity > 0 ? Math.round(((currentQuantity * currentAverage + lineTotal) / nextQuantity) * 100) / 100 : unitCost;

  const { error: updateError } = await supabase
    .from("inventory_items")
    .update({
      unit: storedUnit,
      current_quantity: nextQuantity,
      average_cost_cop: nextAverage
    })
    .eq("id", inventoryItemId);

  if (updateError) {
    return { status: "error", message: updateError.message };
  }

  await supabase.from("inventory_movements").insert({
    inventory_item_id: inventoryItemId,
    movement_kind: "purchase",
    quantity_delta: quantity,
    unit: item.unit,
    source_table: "purchases",
    source_id: purchase.id,
    note: upperText(getOptionalString(formData, "notes")),
    created_by: user.id
  });

  revalidateInventory();
  return { status: "success", message: "Guardado correctamente" };
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

export async function registerInventoryAdjustment(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const inventoryItemId = getString(formData, "inventory_item_id");
  const adjustmentKind = getString(formData, "adjustment_kind") === "adjustment_out" ? "adjustment_out" : "adjustment_in";
  const enteredQuantity = getDecimal(formData, "quantity", 0);
  const enteredUnit = getStockUnit(formData, "unit");
  const reason = getString(formData, "reason");
  const observation = getOptionalString(formData, "observation");
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return { status: "error", message: "Debes iniciar sesion." };
  }

  if (!inventoryItemId) {
    return { status: "error", message: "Selecciona un producto." };
  }

  if (enteredQuantity <= 0) {
    return { status: "error", message: "La cantidad debe ser mayor a cero." };
  }

  if (!reason) {
    return { status: "error", message: "El motivo es obligatorio." };
  }

  const { data: item, error: itemError } = await supabase
    .from("inventory_items")
    .select("id, unit, current_quantity, average_cost_cop")
    .eq("id", inventoryItemId)
    .single();

  if (itemError) {
    return { status: "error", message: itemError.message };
  }

  let convertedQuantity = 0;
  try {
    convertedQuantity = convertStockQuantity(enteredQuantity, enteredUnit, item.unit);
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "La unidad elegida no es compatible." };
  }

  const currentQuantity = Number(item.current_quantity ?? 0);
  const quantityDelta = adjustmentKind === "adjustment_out" ? -convertedQuantity : convertedQuantity;
  const nextQuantity = currentQuantity + quantityDelta;

  if (nextQuantity < 0) {
    return { status: "error", message: "El ajuste no puede dejar el stock en negativo." };
  }

  const note = observation ? `Motivo: ${reason}\nObservacion: ${observation}` : `Motivo: ${reason}`;
  const { error: movementError } = await supabase.from("inventory_movements").insert({
    inventory_item_id: inventoryItemId,
    movement_kind: adjustmentKind,
    quantity_delta: quantityDelta,
    unit: item.unit,
    source_table: "inventory_adjustments",
    note,
    created_by: user.id
  });

  if (movementError) {
    return { status: "error", message: movementError.message };
  }

  const { error: updateError } = await supabase
    .from("inventory_items")
    .update({
      current_quantity: nextQuantity,
      average_cost_cop: Number(item.average_cost_cop ?? 0)
    })
    .eq("id", inventoryItemId);

  if (updateError) {
    return { status: "error", message: updateError.message };
  }

  revalidateInventory();
  return { status: "success", message: "Ajuste registrado correctamente" };
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
