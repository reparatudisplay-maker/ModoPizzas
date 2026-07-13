"use server";

import { revalidatePath } from "next/cache";
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
  revalidatePath("/panel/nuevo-pedido");
}

function revalidateInventory() {
  revalidatePath("/panel");
  revalidatePath("/panel/inventario");
  revalidatePath("/panel/proveedores");
}

function getStockUnit(formData: FormData, key = "unit") {
  const value = getString(formData, key);
  return ["g", "kg", "ml", "l", "unit"].includes(value) ? value : "unit";
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
  const payload = {
    code,
    name,
    description: getOptionalString(formData, "description"),
    display_order: getInteger(formData, "display_order", 0),
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

  const prices = (sizes ?? []).map((size) => ({
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
  const payload = {
    sku: getOptionalString(formData, "sku"),
    name: getString(formData, "name"),
    unit: getStockUnit(formData),
    current_quantity: getDecimal(formData, "current_quantity", 0),
    average_cost_cop: getDecimal(formData, "average_cost_cop", 0),
    is_active: getBoolean(formData, "is_active")
  };

  const query = id
    ? supabase.from("inventory_items").update(payload).eq("id", id)
    : supabase.from("inventory_items").insert(payload);
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

export async function registerPurchase(formData: FormData) {
  const inventoryItemId = getString(formData, "inventory_item_id");
  const quantity = getDecimal(formData, "quantity", 0);
  const unitCost = getDecimal(formData, "unit_cost_cop", 0);
  const lineTotal = Math.round(quantity * unitCost * 100) / 100;
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

  const { data: purchase, error: purchaseError } = await supabase
    .from("purchases")
    .insert({
      supplier_id: getOptionalString(formData, "supplier_id"),
      purchased_by: user.id,
      total_cop: lineTotal,
      notes: getOptionalString(formData, "notes")
    })
    .select("id")
    .single();

  if (purchaseError) {
    throw new Error(purchaseError.message);
  }

  const { error: lineError } = await supabase.from("purchase_items").insert({
    purchase_id: purchase.id,
    inventory_item_id: inventoryItemId,
    quantity,
    unit: item.unit,
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
