"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { normalizeMasterText } from "@/lib/master-normalization";
import { parseColombianDecimal, parseColombianInteger } from "@/lib/number-format";

const validRoles = new Set(["vendedor", "mesero", "cocina", "mensajero", "gerente", "admin_sistema"]);
const productImageBucket = "product-images";
const profileImageBucket = "profile-images";
const productImageMaxSize = 400 * 1024;
const productImageTypes = new Map([
  ["image/webp", "webp"]
]);

export type FormActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

export type ConservationProfileActionState = FormActionState & {
  profile?: {
    id: string;
    sku: string;
    name: string;
    description: string | null;
    sort_order: number;
    temperature_min: number | null;
    temperature_max: number | null;
    is_active: boolean;
    conservation_profile_rules: Array<{
      id: string;
      storage_method: "ambient" | "refrigerated" | "frozen";
      duration_value: number;
      duration_unit: "hours" | "days";
      temperature_min: number | null;
      temperature_max: number | null;
      notes: string | null;
    }>;
  };
};

export type CategoryActionState = FormActionState & {
  category?: {
    id: string;
    name: string;
    is_active: boolean;
  };
};

export type ProductionActionState = FormActionState & {
  production?: {
    id: string;
    code: string;
    total_cost_cop: number;
    unit_cost_cop: number;
    expiration_date: string;
    actual_quantity_base: number;
    base_unit: string;
  };
};

export type PosOrderActionState = FormActionState & {
  stockShortages?: PosStockShortage[];
  order?: {
    id: string;
    code: string;
    total_cop: number;
    cash_received_cop?: number;
    cash_change_cop?: number;
  };
};

export type PosStockShortage = {
  source_kind: "inventory_item" | "preparation";
  source_id: string;
  source_name: string;
  source_category: "inventory_item" | "sale_product" | "preparation";
  unit: "g" | "ml" | "unit";
  requested_quantity: number;
  available_quantity: number;
  missing_quantity: number;
  usages: Array<{
    line_position: number;
    line_kind: "pizza" | "sale_product";
    line_label: string;
    line_quantity: number;
    requested_quantity: number;
  }>;
};

export type PhysicalInventoryActionState = FormActionState & {
  count?: {
    id: string;
    adjustment_kind: "waste" | "adjustment_in";
    difference_quantity_base: number;
    base_unit: string;
  };
};

export type HistoricalPreparationStockActionState = FormActionState & {
  entry?: {
    production_id: string;
    production_batch_id: string;
    code: string;
    quantity_base: number;
    base_unit: string;
    total_cost_cop: number;
    unit_cost_cop: number;
    expiration_date: string;
  };
};

type PhysicalInventoryCountRecord = {
  id: string;
  source_kind: "inventory_item" | "preparation";
  inventory_item_id: string | null;
  source_preparation_id: string | null;
  theoretical_quantity_base: number;
  physical_quantity_base: number;
  difference_quantity_base: number;
  base_unit: string;
  average_cost_cop: number;
  adjustment_kind: "waste" | "adjustment_in";
  created_at: string;
};

type FlavorIngredientInput = {
  source_kind: "inventory_item" | "preparation";
  source_id: string;
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
  const parsed = parseColombianInteger(getString(formData, key));
  return parsed !== null && Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback;
}

function getDecimal(formData: FormData, key: string, fallback = 0) {
  const parsed = parseColombianDecimal(getString(formData, key));
  return parsed !== null && Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function getSignedDecimal(formData: FormData, key: string) {
  const rawValue = getOptionalString(formData, key);
  if (!rawValue) return null;
  const parsed = parseColombianDecimal(rawValue);
  return parsed !== null && Number.isFinite(parsed) ? parsed : null;
}

function getMachineDecimal(formData: FormData, key: string, fallback = 0) {
  const value = getString(formData, key);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function getBoolean(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function upperText(value: string | null) {
  return value ? value.toUpperCase() : null;
}

function getStockUnit(formData: FormData, key = "unit") {
  const value = getString(formData, key);
  return ["g", "kg", "ml", "l", "unit"].includes(value) ? value : "unit";
}

function getInventoryItemKind(formData: FormData, key = "item_kind") {
  const value = getString(formData, key);
  if (value === "ingredient" || value === "sale_product" || value === "supply") return value;
  return "";
}

function getPurchaseMode(formData: FormData, key = "purchase_mode") {
  return getString(formData, key) === "packages" ? "packages" : "total_weight";
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

function normalizeStockQuantityToBase(quantity: number, unit: string) {
  const baseUnit = canonicalStockUnit(unit);
  return {
    quantity: convertStockQuantity(quantity, unit, baseUnit),
    unit: baseUnit
  };
}

function normalizeSkuName(value: string) {
  const normalized = value
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]/g, "");
  return normalized.padEnd(3, "X").slice(0, 3);
}

function presentationCode(quantity: number, unit: string) {
  const displayUnit = unit === "ml" && quantity >= 1000 ? "l" : unit === "g" && quantity >= 1000 ? "kg" : unit;
  const displayQuantity = displayUnit === "l" || displayUnit === "kg" ? quantity / 1000 : quantity;
  const normalizedQuantity = new Intl.NumberFormat("es-CO", {
    maximumFractionDigits: 3,
    useGrouping: false
  })
    .format(displayQuantity)
    .replace(",", "");
  const normalizedUnit = displayUnit === "unit" ? "UND" : displayUnit.toUpperCase();
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

function getFormFile(formData: FormData, key: string) {
  const value = formData.get(key);
  return value instanceof File && value.size > 0 ? value : null;
}

function getFlavorIngredientInputs(formData: FormData) {
  const rawValue = getString(formData, "characteristic_ingredients");
  if (!rawValue) return [];
  try {
    const parsed = JSON.parse(rawValue) as FlavorIngredientInput[];
    const seen = new Set<string>();
    return parsed.filter((item) => {
      if (!item || (item.source_kind !== "inventory_item" && item.source_kind !== "preparation") || !item.source_id) return false;
      const key = `${item.source_kind}:${item.source_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch {
    return [];
  }
}

async function uploadProductImage(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>, file: File, folder = "productos") {
  const extension = productImageTypes.get(file.type);
  if (!extension) throw new Error("La imagen debe estar optimizada en formato WebP.");
  if (file.size > productImageMaxSize) throw new Error("No fue posible optimizar la imagen por debajo de 400 KB. Selecciona una imagen más pequeña.");

  const path = `${folder}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from(productImageBucket).upload(path, file, {
    cacheControl: "3600",
    contentType: file.type,
    upsert: false
  });
  if (error) throw new Error(error.message);
  return path;
}

async function uploadProfileImage(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>, file: File, userId: string) {
  const extension = productImageTypes.get(file.type);
  if (!extension) throw new Error("La imagen debe estar optimizada en formato WebP.");
  if (file.size > productImageMaxSize) throw new Error("No fue posible optimizar la imagen por debajo de 400 KB. Selecciona una imagen más pequeña.");

  const path = `profiles/${userId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from(profileImageBucket).upload(path, file, {
    cacheControl: "3600",
    contentType: file.type,
    upsert: false
  });
  if (error) throw new Error(error.message);
  return path;
}

async function removeProfileImage(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>, imageUrl: string | null) {
  if (imageUrl) await supabase.storage.from(profileImageBucket).remove([imageUrl]);
}

async function removeStoredImageIfUnreferenced(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>, imageUrl: string | null) {
  if (!imageUrl) return;
  const tables = ["inventory_items", "preparations", "pizza_flavors"] as const;
  for (const table of tables) {
    const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true }).eq("image_url", imageUrl);
    if (error || (count ?? 0) > 0) return;
  }
  await supabase.storage.from(productImageBucket).remove([imageUrl]);
}

function revalidateInventory() {
  revalidatePath("/panel");
  revalidatePath("/panel/inventario");
  revalidatePath("/panel/productos");
  revalidatePath("/panel/compras");
  revalidatePath("/panel/proveedores");
  revalidatePath("/panel/marcas");
  revalidatePath("/panel/categorias");
  revalidatePath("/panel/perfiles-conservacion");
  revalidatePath("/panel/configuracion");
  revalidatePath("/panel/configuracion/cocina");
  revalidatePath("/panel/produccion");
  revalidatePath("/panel/menu/pizzas");
  revalidatePath("/panel/menu/precios/adiciones");
  revalidatePath("/panel/menu/precios/pizzas");
  revalidatePath("/panel/menu/precios/productos");
  revalidatePath("/panel/pedidos");
  revalidatePath("/panel/pedidos/nuevo");
}

async function relationCount(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>, table: string, column: string, value: string) {
  const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true }).eq(column, value);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function physicalCountSourceStockBase(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  sourceKind: "inventory_item" | "preparation",
  sourceId: string,
  baseUnit: string
) {
  let stock = 0;

  if (sourceKind === "inventory_item") {
    const { data: purchaseItems, error } = await supabase
      .from("purchase_items")
      .select("id, quantity, unit")
      .eq("inventory_item_id", sourceId);
    if (error) throw new Error(error.message);

    const itemIds = (purchaseItems ?? []).map((item) => item.id);
    stock = (purchaseItems ?? []).reduce((sum, item) => sum + convertStockQuantity(Number(item.quantity ?? 0), item.unit, baseUnit), 0);

    if (itemIds.length > 0) {
      const { data: allocations, error: allocationsError } = await supabase
        .from("production_consumption_allocations")
        .select("quantity_base, base_unit")
        .in("purchase_item_id", itemIds);
      if (allocationsError) throw new Error(allocationsError.message);
      stock -= (allocations ?? []).reduce((sum, allocation) => sum + convertStockQuantity(Number(allocation.quantity_base ?? 0), allocation.base_unit, baseUnit), 0);
    }
  } else {
    const { data: batches, error } = await supabase
      .from("production_batches")
      .select("id, initial_quantity_base, base_unit")
      .eq("preparation_id", sourceId);
    if (error) throw new Error(error.message);

    const batchIds = (batches ?? []).map((batch) => batch.id);
    stock = (batches ?? []).reduce((sum, batch) => sum + convertStockQuantity(Number(batch.initial_quantity_base ?? 0), batch.base_unit, baseUnit), 0);

    if (batchIds.length > 0) {
      const { data: allocations, error: allocationsError } = await supabase
        .from("production_consumption_allocations")
        .select("quantity_base, base_unit")
        .in("production_batch_id", batchIds);
      if (allocationsError) throw new Error(allocationsError.message);
      stock -= (allocations ?? []).reduce((sum, allocation) => sum + convertStockQuantity(Number(allocation.quantity_base ?? 0), allocation.base_unit, baseUnit), 0);
    }
  }

  const countColumn = sourceKind === "inventory_item" ? "inventory_item_id" : "source_preparation_id";
  const { data: counts, error: countsError } = await supabase
    .from("physical_inventory_counts")
    .select("difference_quantity_base, base_unit")
    .eq(countColumn, sourceId)
    .is("voided_at", null);
  if (countsError) throw new Error(countsError.message);

  stock += (counts ?? []).reduce((sum, count) => sum + convertStockQuantity(Number(count.difference_quantity_base ?? 0), count.base_unit, baseUnit), 0);
  return Number(stock.toFixed(3));
}

async function getEditablePhysicalCount(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>, countId: string) {
  const { data: count, error } = await supabase
    .from("physical_inventory_counts")
    .select("id, source_kind, inventory_item_id, source_preparation_id, theoretical_quantity_base, physical_quantity_base, difference_quantity_base, base_unit, average_cost_cop, adjustment_kind, created_at")
    .eq("id", countId)
    .is("voided_at", null)
    .single();
  if (error || !count) throw new Error(error?.message ?? "Ajuste no encontrado.");

  const record = count as PhysicalInventoryCountRecord;
  const sourceId = record.source_kind === "inventory_item" ? record.inventory_item_id : record.source_preparation_id;
  if (!sourceId) throw new Error("El ajuste no tiene una fuente valida.");

  const sourceColumn = record.source_kind === "inventory_item" ? "inventory_item_id" : "source_preparation_id";
  const { data: latest, error: latestError } = await supabase
    .from("physical_inventory_counts")
    .select("id")
    .eq("source_kind", record.source_kind)
    .eq(sourceColumn, sourceId)
    .is("voided_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (latestError) throw new Error(latestError.message);
  if (latest?.id !== record.id) {
    throw new Error("Solo se puede editar o eliminar el ultimo ajuste de este producto para no dejar conteos posteriores inconsistentes.");
  }

  return { count: record, sourceId };
}

async function hasDuplicateName(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  table:
    | "product_categories"
    | "brands"
    | "suppliers"
    | "conservation_profiles"
    | "preparations"
    | "menu_categories"
    | "pizza_sizes"
    | "pizza_flavors"
    | "pizza_additions",
  name: string,
  currentId?: string | null
) {
  const { data, error } = await supabase.from(table).select("id, name");
  if (error) throw new Error(error.message);
  const normalizedName = normalizeMasterText(name);
  return (data ?? []).some((item) => item.id !== currentId && normalizeMasterText(item.name ?? "") === normalizedName);
}

async function reserveMenuSku(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  section: "menu_categories" | "pizza_sizes" | "pizza_flavors" | "pizza_additions",
  name: string
) {
  const { data, error } = await supabase.rpc("reserve_menu_sku", { p_section: section, p_name: name });
  if (error) throw new Error(error.message);
  return String(data);
}

async function reservePizzaPriceSku(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>, flavorId: string, sizeId: string) {
  const { data, error } = await supabase.rpc("reserve_pizza_price_sku", { p_flavor_id: flavorId, p_size_id: sizeId });
  if (error) throw new Error(error.message);
  return String(data);
}

async function nextMenuSortOrder(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  table: "menu_categories" | "pizza_sizes" | "pizza_flavors" | "pizza_additions"
) {
  const { data, error } = await supabase.from(table).select("sort_order").order("sort_order", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return Number(data?.sort_order ?? 0) + 1;
}

async function saveFlavorIngredients(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  flavorId: string,
  ingredients: FlavorIngredientInput[]
) {
  const { data: baseSources, error: baseSourcesError } = await supabase
    .from("pizza_size_base_sources")
    .select("source_kind, inventory_item_id, source_preparation_id")
    .eq("is_active", true);
  if (baseSourcesError) throw new Error(baseSourcesError.message);
  const reservedBaseKeys = new Set(
    (baseSources ?? []).map((source) => `${source.source_kind}:${source.source_kind === "inventory_item" ? source.inventory_item_id : source.source_preparation_id}`)
  );

  for (const ingredient of ingredients) {
    const key = `${ingredient.source_kind}:${ingredient.source_id}`;
    if (reservedBaseKeys.has(key)) throw new Error("La base comun por tamano no puede agregarse como ingrediente caracteristico.");
    if (ingredient.source_kind === "preparation") {
      const { data, error } = await supabase.from("preparations").select("name").eq("id", ingredient.source_id).single();
      if (error) throw new Error(error.message);
      if (isDoughBaseName(data.name)) throw new Error("La masa se configura unicamente como base comun por tamano.");
    }
  }

  const { error: deleteError } = await supabase.from("pizza_flavor_ingredients").delete().eq("flavor_id", flavorId);
  if (deleteError) throw new Error(deleteError.message);
  if (ingredients.length === 0) return;

  const payload = ingredients.map((ingredient) => ({
    flavor_id: flavorId,
    source_kind: ingredient.source_kind,
    inventory_item_id: ingredient.source_kind === "inventory_item" ? ingredient.source_id : null,
    source_preparation_id: ingredient.source_kind === "preparation" ? ingredient.source_id : null
  }));
  const { error } = await supabase.from("pizza_flavor_ingredients").insert(payload);
  if (error) throw new Error(error.message);
}

type PizzaAdditionSizeInput = {
  pizza_size_id: string;
  quantity: number;
  unit: string;
  price_cop: number;
};

type PizzaSizeBaseSourceKind = "inventory_item" | "preparation";

function isDoughBaseName(name: string | null | undefined) {
  return normalizeMasterText(name ?? "").includes("MASA");
}

function getPizzaAdditionSizeInputs(formData: FormData) {
  const rawValue = getString(formData, "addition_sizes");
  if (!rawValue) return [];
  try {
    const parsed = JSON.parse(rawValue) as PizzaAdditionSizeInput[];
    const seen = new Set<string>();
    return parsed.filter((item) => {
      if (!item?.pizza_size_id || !item.unit || Number(item.quantity) <= 0) return false;
      if (seen.has(item.pizza_size_id)) return false;
      seen.add(item.pizza_size_id);
      return true;
    });
  } catch {
    return [];
  }
}

function getJsonStringArray(formData: FormData, key: string) {
  const rawValue = getString(formData, key);
  if (!rawValue) return [];
  try {
    const parsed = JSON.parse(rawValue) as string[];
    return [...new Set(parsed.filter((item) => typeof item === "string" && item))];
  } catch {
    return [];
  }
}

export async function savePizzaSizeBaseSource(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const pizzaSizeId = getString(formData, "pizza_size_id");
  const sourceKind = getString(formData, "source_kind") as PizzaSizeBaseSourceKind;
  const sourceId = getString(formData, "source_id");
  const quantity = getDecimal(formData, "quantity", 0);
  const displayUnit = getStockUnit(formData, "unit");
  const supabase = await createServerSupabaseClient();

  if (!pizzaSizeId) return { status: "error", message: "Selecciona un tamano." };
  if (sourceKind !== "inventory_item" && sourceKind !== "preparation") return { status: "error", message: "Selecciona el tipo de base." };
  if (!sourceId) return { status: "error", message: "Selecciona el componente base." };
  if (quantity <= 0) return { status: "error", message: "La cantidad de base debe ser mayor a cero." };

  const { data: size, error: sizeError } = await supabase.from("pizza_sizes").select("id, is_active").eq("id", pizzaSizeId).single();
  if (sizeError || !size?.is_active) return { status: "error", message: sizeError?.message ?? "Selecciona un tamano activo." };

  let baseUnit: string;
  if (sourceKind === "inventory_item") {
    const { data, error } = await supabase
      .from("inventory_items")
      .select("id, unit, item_kind, is_active, presentation_quantity")
      .eq("id", sourceId)
      .single();
    if (error || !data) return { status: "error", message: error?.message ?? "Ingrediente no encontrado." };
    if (!data.is_active || data.item_kind !== "ingredient" || data.presentation_quantity !== null) {
      return { status: "error", message: "La base comprada debe ser un ingrediente activo sin presentacion comercial." };
    }
    baseUnit = canonicalStockUnit(data.unit);
  } else {
    const { data, error } = await supabase.from("preparations").select("id, base_unit, is_active").eq("id", sourceId).single();
    if (error || !data) return { status: "error", message: error?.message ?? "Preparacion no encontrada." };
    if (!data.is_active) return { status: "error", message: "Selecciona una preparacion activa." };
    baseUnit = canonicalStockUnit(data.base_unit);
  }

  if (canonicalStockUnit(displayUnit) !== baseUnit) {
    return { status: "error", message: "La unidad no es compatible con el componente base." };
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();
  const quantityBase = convertStockQuantity(quantity, displayUnit, baseUnit);
  const { data: existing, error: existingError } = await supabase
    .from("pizza_size_base_sources")
    .select("id")
    .eq("pizza_size_id", pizzaSizeId)
    .maybeSingle();
  if (existingError) return { status: "error", message: existingError.message };

  const payload = {
    pizza_size_id: pizzaSizeId,
    source_kind: sourceKind,
    inventory_item_id: sourceKind === "inventory_item" ? sourceId : null,
    source_preparation_id: sourceKind === "preparation" ? sourceId : null,
    quantity_base: quantityBase,
    unit: baseUnit,
    display_quantity: quantity,
    display_unit: displayUnit,
    is_active: true,
    updated_by: user?.id ?? null,
    updated_at: new Date().toISOString()
  };

  const { error } = existing
    ? await supabase.from("pizza_size_base_sources").update(payload).eq("id", existing.id)
    : await supabase.from("pizza_size_base_sources").insert({ ...payload, created_by: user?.id ?? null });

  if (error) return { status: "error", message: error.message };
  revalidateInventory();
  return { status: "success", message: "Base por tamano guardada correctamente." };
}

export async function savePizzaSizeComponentQuantities(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const rawRows = getString(formData, "rows");
  let rows: Array<{ pizza_size_id?: string; source_kind?: string; source_id?: string; unit?: string; quantity_base?: string }>;
  try {
    rows = JSON.parse(rawRows || "[]") as Array<{ pizza_size_id?: string; source_kind?: string; source_id?: string; unit?: string; quantity_base?: string }>;
  } catch {
    return { status: "error", message: "Los gramajes enviados no son validos." };
  }

  const normalizedRows = rows.map((row) => ({
    pizza_size_id: row.pizza_size_id ?? "",
    source_kind: row.source_kind ?? "",
    source_id: row.source_id ?? "",
    unit: row.unit ?? "",
    quantity_base: parseColombianDecimal(String(row.quantity_base ?? ""))
  }));
  if (normalizedRows.some((row) => !row.pizza_size_id || !row.source_id || !["inventory_item", "preparation"].includes(row.source_kind) || !["g", "ml", "unit"].includes(row.unit) || row.quantity_base === null || row.quantity_base < 0)) {
    return { status: "error", message: "Cada gramaje configurado debe tener una cantidad igual o mayor que cero y una unidad base valida." };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("save_pizza_size_component_quantities", {
    p_rows: normalizedRows.map((row) => ({ ...row, quantity_base: row.quantity_base }))
  });
  if (error) return { status: "error", message: error.message };
  revalidateInventory();
  return { status: "success", message: "Gramajes por tamano guardados correctamente." };
}

async function savePizzaAdditionRelations(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  additionId: string,
  sizes: Array<PizzaAdditionSizeInput & { quantity_base: number; base_unit: string }>,
  flavorIds: string[],
  categoryIds: string[]
) {
  const [sizesDelete, flavorsDelete, categoriesDelete] = await Promise.all([
    supabase.from("pizza_addition_sizes").delete().eq("addition_id", additionId),
    supabase.from("pizza_addition_flavors").delete().eq("addition_id", additionId),
    supabase.from("pizza_addition_categories").delete().eq("addition_id", additionId)
  ]);
  const deleteError = sizesDelete.error ?? flavorsDelete.error ?? categoriesDelete.error;
  if (deleteError) throw new Error(deleteError.message);

  if (sizes.length > 0) {
    const { error } = await supabase.from("pizza_addition_sizes").insert(
      sizes.map((item) => ({
        addition_id: additionId,
        pizza_size_id: item.pizza_size_id,
        quantity_base: item.quantity_base,
        unit: item.base_unit,
        display_quantity: item.quantity,
        display_unit: item.unit,
        price_cop: item.price_cop
      }))
    );
    if (error) throw new Error(error.message);
  }

  if (flavorIds.length > 0) {
    const { error } = await supabase.from("pizza_addition_flavors").insert(flavorIds.map((flavor_id) => ({ addition_id: additionId, flavor_id })));
    if (error) throw new Error(error.message);
  }

  if (categoryIds.length > 0) {
    const { error } = await supabase
      .from("pizza_addition_categories")
      .insert(categoryIds.map((menu_category_id) => ({ addition_id: additionId, menu_category_id })));
    if (error) throw new Error(error.message);
  }
}

async function recalculateInventoryItem(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>, inventoryItemId: string) {
  const { data: lines, error } = await supabase
    .from("purchase_items")
    .select("quantity, line_total_cop")
    .eq("inventory_item_id", inventoryItemId);

  if (error) throw new Error(error.message);

  const quantity = (lines ?? []).reduce((sum, line) => sum + Number(line.quantity ?? 0), 0);
  const total = (lines ?? []).reduce((sum, line) => sum + Number(line.line_total_cop ?? 0), 0);
  const average = quantity > 0 ? Math.round((total / quantity) * 100) / 100 : 0;

  const { error: updateError } = await supabase
    .from("inventory_items")
    .update({ current_quantity: quantity, average_cost_cop: average })
    .eq("id", inventoryItemId);

  if (updateError) throw new Error(updateError.message);
}

export async function saveInventoryItem(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const id = getOptionalString(formData, "id");
  const supabase = await createServerSupabaseClient();
  const itemKind = getInventoryItemKind(formData);
  const productName = upperText(getOptionalString(formData, "name")) ?? "";

  if (!itemKind) return { status: "error", message: "Selecciona un tipo de producto." };
  if (!productName) return { status: "error", message: "Ingresa el nombre del producto." };

  const { data: existingItems, error: existingItemsError } = await supabase
    .from("inventory_items")
    .select("id, name")
    .is("presentation_quantity", null);

  if (existingItemsError) return { status: "error", message: existingItemsError.message };

  const normalizedName = normalizeMasterText(productName);
  const duplicateItem = (existingItems ?? []).find((item) => item.id !== id && normalizeMasterText(item.name ?? "") === normalizedName);
  if (duplicateItem) return { status: "error", message: "Ya existe un producto con ese nombre." };

  const payload: {
    name: string;
    unit: string;
    item_kind: "ingredient" | "sale_product" | "supply";
    purchase_mode: "total_weight" | "packages";
    is_active: boolean;
    category_id?: string | null;
    brand_id?: string | null;
    image_url?: string | null;
    presentation_quantity: number | null;
    presentation_unit: string | null;
  } = {
    name: productName,
    unit: getStockUnit(formData),
    item_kind: itemKind,
    purchase_mode: getPurchaseMode(formData),
    is_active: getBoolean(formData, "is_active"),
    presentation_quantity: null,
    presentation_unit: null
  };

  if (formData.has("category_id")) payload.category_id = getOptionalString(formData, "category_id");
  if (formData.has("brand_id")) payload.brand_id = getOptionalString(formData, "brand_id");

  const imageFile = getFormFile(formData, "product_image");
  const shouldRemoveImage = getString(formData, "remove_image") === "1";
  if (imageFile) {
    try {
      payload.image_url = await uploadProductImage(supabase, imageFile);
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : "No se pudo subir la foto." };
    }
  } else if (shouldRemoveImage) {
    payload.image_url = null;
  }

  const result = id
    ? await supabase.from("inventory_items").update(payload).eq("id", id)
    : await supabase.from("inventory_items").insert({ ...payload, current_quantity: 0, average_cost_cop: 0 });

  if (result.error) return { status: "error", message: result.error.message };
  revalidateInventory();
  return { status: "success", message: "Guardado correctamente" };
}

export async function saveProductCategoryInline(_previousState: CategoryActionState, formData: FormData): Promise<CategoryActionState> {
  const id = getOptionalString(formData, "id");
  const supabase = await createServerSupabaseClient();
  const name = upperText(getOptionalString(formData, "name")) ?? "";

  if (!name) return { status: "error", message: "Ingresa el nombre de la categoria." };

  try {
    if (await hasDuplicateName(supabase, "product_categories", name, id)) {
      return { status: "error", message: "Esta categoria ya esta registrada." };
    }
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "No se pudo validar la categoria." };
  }

  const payload = {
    name,
    description: upperText(getOptionalString(formData, "description")),
    is_active: getBoolean(formData, "is_active"),
    updated_at: new Date().toISOString()
  };
  const query = id ? supabase.from("product_categories").update(payload).eq("id", id) : supabase.from("product_categories").insert(payload);
  const { data, error } = await query.select("id, name, is_active").single();

  if (error) return { status: "error", message: error.message };
  revalidateInventory();
  return { status: "success", message: "Categoria guardada correctamente", category: data };
}

export async function saveProductCategoryState(_previousState: CategoryActionState, formData: FormData): Promise<CategoryActionState> {
  return saveProductCategoryInline(_previousState, formData);
}

export async function saveBrandState(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const id = getOptionalString(formData, "id");
  const supabase = await createServerSupabaseClient();
  const name = upperText(getOptionalString(formData, "name")) ?? "";

  if (!name) return { status: "error", message: "Ingresa el nombre de la marca." };

  try {
    if (await hasDuplicateName(supabase, "brands", name, id)) return { status: "error", message: "Ya existe una marca con ese nombre." };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "No se pudo validar la marca." };
  }

  const payload = {
    name,
    category: getOptionalString(formData, "category"),
    notes: getOptionalString(formData, "notes"),
    is_active: getBoolean(formData, "is_active"),
    updated_at: new Date().toISOString()
  };
  const query = id ? supabase.from("brands").update(payload).eq("id", id) : supabase.from("brands").insert(payload);
  const { error } = await query;

  if (error) return { status: "error", message: error.message };
  revalidateInventory();
  return { status: "success", message: "Marca guardada correctamente." };
}

export async function saveSupplierState(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const id = getOptionalString(formData, "id");
  const supabase = await createServerSupabaseClient();
  const name = upperText(getOptionalString(formData, "name")) ?? "";

  if (!name) return { status: "error", message: "Ingresa el nombre del proveedor." };

  try {
    if (await hasDuplicateName(supabase, "suppliers", name, id)) return { status: "error", message: "Ya existe un proveedor con ese nombre." };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "No se pudo validar el proveedor." };
  }

  const payload = {
    name,
    phone: getOptionalString(formData, "phone"),
    notes: getOptionalString(formData, "notes"),
    is_active: getBoolean(formData, "is_active")
  };
  const query = id ? supabase.from("suppliers").update(payload).eq("id", id) : supabase.from("suppliers").insert(payload);
  const { error } = await query;

  if (error) return { status: "error", message: error.message };
  revalidateInventory();
  return { status: "success", message: "Proveedor guardado correctamente." };
}

export async function saveMenuCategory(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const id = getOptionalString(formData, "id");
  const supabase = await createServerSupabaseClient();
  const name = upperText(getOptionalString(formData, "name")) ?? "";

  if (!name) return { status: "error", message: "Ingresa el nombre de la categoria." };

  try {
    if (await hasDuplicateName(supabase, "menu_categories", name, id)) {
      return { status: "error", message: "Esta categoria ya esta registrada." };
    }
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "No se pudo validar la categoria." };
  }

  const payload = {
    name,
    description: getOptionalString(formData, "description"),
    is_active: getBoolean(formData, "is_active"),
    updated_at: new Date().toISOString()
  };
  let query;
  try {
    query = id
      ? supabase.from("menu_categories").update(payload).eq("id", id)
      : supabase.from("menu_categories").insert({
          ...payload,
          sku: await reserveMenuSku(supabase, "menu_categories", name),
          sort_order: await nextMenuSortOrder(supabase, "menu_categories")
        });
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "No se pudo generar el SKU." };
  }
  const { error } = await query;

  if (error) return { status: "error", message: error.message };
  revalidateInventory();
  return { status: "success", message: "Categoria guardada correctamente." };
}

export async function savePizzaSize(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const id = getOptionalString(formData, "id");
  const supabase = await createServerSupabaseClient();
  const name = upperText(getOptionalString(formData, "name")) ?? "";
  const diameterCm = getDecimal(formData, "diameter_cm");
  const slicesCount = getInteger(formData, "slices_count");

  if (!name) return { status: "error", message: "Ingresa el nombre del tamano." };
  if (diameterCm <= 0) return { status: "error", message: "Ingresa un diametro mayor a cero." };
  if (slicesCount <= 0) return { status: "error", message: "Ingresa el numero de porciones." };

  try {
    if (await hasDuplicateName(supabase, "pizza_sizes", name, id)) {
      return { status: "error", message: "Este tamano ya esta registrado." };
    }
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "No se pudo validar el tamano." };
  }

  const payload = {
    name,
    diameter_cm: diameterCm,
    slices_count: slicesCount,
    is_active: getBoolean(formData, "is_active"),
    updated_at: new Date().toISOString()
  };
  let query;
  try {
    query = id
      ? supabase.from("pizza_sizes").update(payload).eq("id", id)
      : supabase.from("pizza_sizes").insert({
          ...payload,
          sku: await reserveMenuSku(supabase, "pizza_sizes", name),
          sort_order: await nextMenuSortOrder(supabase, "pizza_sizes")
        });
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "No se pudo generar el SKU." };
  }
  const { error } = await query;

  if (error) return { status: "error", message: error.message };
  revalidateInventory();
  return { status: "success", message: "Tamano guardado correctamente." };
}

export async function savePizzaFlavor(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const id = getOptionalString(formData, "id");
  const supabase = await createServerSupabaseClient();
  const name = upperText(getOptionalString(formData, "name")) ?? "";
  const ingredients = getFlavorIngredientInputs(formData);

  if (!name) return { status: "error", message: "Ingresa el nombre del sabor." };

  try {
    if (await hasDuplicateName(supabase, "pizza_flavors", name, id)) {
      return { status: "error", message: "Este sabor ya esta registrado." };
    }
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "No se pudo validar el sabor." };
  }

  let imageUrl = getOptionalString(formData, "existing_image_url");
  const previousImageUrl = imageUrl;
  if (getString(formData, "remove_image") === "1") {
    imageUrl = null;
  }

  const imageFile = getFormFile(formData, "flavor_image");
  if (imageFile) {
    try {
      imageUrl = await uploadProductImage(supabase, imageFile, "sabores");
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : "No se pudo subir la foto." };
    }
  }

  const payload = {
    name,
    commercial_description: getOptionalString(formData, "commercial_description") ?? "",
    image_url: imageUrl,
    allows_half_and_half: getBoolean(formData, "allows_half_and_half"),
    menu_category_id: getOptionalString(formData, "menu_category_id"),
    allergens: upperText(getOptionalString(formData, "allergens")),
    is_active: getBoolean(formData, "is_active"),
    updated_at: new Date().toISOString()
  };
  let query;
  try {
    query = id
      ? supabase.from("pizza_flavors").update(payload).eq("id", id)
      : supabase.from("pizza_flavors").insert({
          ...payload,
          sku: await reserveMenuSku(supabase, "pizza_flavors", name),
          sort_order: await nextMenuSortOrder(supabase, "pizza_flavors")
        });
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "No se pudo generar el SKU." };
  }
  const { data, error } = await query.select("id").single();

  if (error) return { status: "error", message: error.message };
  try {
    await saveFlavorIngredients(supabase, data.id, ingredients);
    if (previousImageUrl && previousImageUrl !== imageUrl) {
      await removeStoredImageIfUnreferenced(supabase, previousImageUrl);
    }
  } catch (saveError) {
    return { status: "error", message: saveError instanceof Error ? saveError.message : "No se pudieron guardar los ingredientes." };
  }
  revalidateInventory();
  return { status: "success", message: "Sabor guardado correctamente." };
}

export async function savePizzaAddition(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const id = getOptionalString(formData, "id");
  const supabase = await createServerSupabaseClient();
  const alternateName = upperText(getOptionalString(formData, "alternate_name"));
  const useAlternateName = getBoolean(formData, "use_alternate_name");
  const sourceKind = getString(formData, "source_kind");
  const sourceId = getString(formData, "source_id");
  const maxAllowed = getInteger(formData, "max_allowed", 1);
  const sizeInputs = getPizzaAdditionSizeInputs(formData);
  const flavorIds = getJsonStringArray(formData, "compatible_flavor_ids");
  const categoryIds = getJsonStringArray(formData, "compatible_category_ids");

  if (sourceKind !== "inventory_item") return { status: "error", message: "Selecciona un ingrediente valido." };
  if (!sourceId) return { status: "error", message: "Selecciona el ingrediente que consume la adicion." };
  if (maxAllowed <= 0) return { status: "error", message: "El maximo permitido debe ser mayor a cero." };
  if (sizeInputs.length === 0) return { status: "error", message: "Configura cantidad y precio para al menos un tamano." };

  let baseUnit = "unit";
  const { data: ingredient, error: ingredientError } = await supabase
    .from("inventory_items")
    .select("id, name, unit, item_kind, is_active, presentation_quantity")
    .eq("id", sourceId)
    .single();
  if (ingredientError || !ingredient) return { status: "error", message: ingredientError?.message ?? "Ingrediente no encontrado." };
  if (!ingredient.is_active || ingredient.item_kind !== "ingredient" || ingredient.presentation_quantity !== null) {
    return { status: "error", message: "Las adiciones solo pueden consumir ingredientes activos." };
  }
  baseUnit = canonicalStockUnit(ingredient.unit);

  const name = useAlternateName && alternateName ? alternateName : upperText(ingredient.name) ?? "";
  if (!name) return { status: "error", message: "Selecciona el ingrediente de la adicion." };

  const { data: existingAdditions, error: existingAdditionsError } = await supabase
    .from("pizza_additions")
    .select("id, name")
    .eq("inventory_item_id", sourceId);
  if (existingAdditionsError) return { status: "error", message: existingAdditionsError.message };
  const normalizedAdditionName = normalizeMasterText(name);
  const duplicateAddition = (existingAdditions ?? []).find((addition) => addition.id !== id && normalizeMasterText(addition.name ?? "") === normalizedAdditionName);
  if (duplicateAddition) {
    return { status: "error", message: "Ya existe una adicion con este ingrediente y nombre mostrado." };
  }

  const normalizedSizes: Array<PizzaAdditionSizeInput & { quantity_base: number; base_unit: string }> = [];
  try {
    for (const item of sizeInputs) {
      const submittedUnit = ["g", "kg", "ml", "l", "unit"].includes(item.unit) ? item.unit : "unit";
      if (canonicalStockUnit(submittedUnit) !== baseUnit) throw new Error("Hay una unidad incompatible con el ingrediente seleccionado.");
      const quantityBase = convertStockQuantity(Number(item.quantity), submittedUnit, baseUnit);
      normalizedSizes.push({
        ...item,
        unit: submittedUnit,
        price_cop: Math.max(0, Number(item.price_cop ?? 0)),
        quantity_base: quantityBase,
        base_unit: baseUnit
      });
    }
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Hay una unidad incompatible." };
  }

  const payload = {
    name,
    source_kind: "inventory_item",
    inventory_item_id: sourceId,
    source_preparation_id: null,
    max_allowed: maxAllowed,
    is_active: getBoolean(formData, "is_active"),
    is_available: getBoolean(formData, "is_available"),
    updated_at: new Date().toISOString()
  };
  const query = id
    ? supabase.from("pizza_additions").update(payload).eq("id", id)
    : supabase.from("pizza_additions").insert({
        ...payload,
        sku: await reserveMenuSku(supabase, "pizza_additions", name),
        sort_order: await nextMenuSortOrder(supabase, "pizza_additions")
      });
  const { data, error } = await query.select("id").single();
  if (error) return { status: "error", message: error.message };

  try {
    await savePizzaAdditionRelations(supabase, data.id, normalizedSizes, flavorIds, categoryIds);
  } catch (saveError) {
    return { status: "error", message: saveError instanceof Error ? saveError.message : "No se pudieron guardar los detalles de la adicion." };
  }

  revalidateInventory();
  return { status: "success", message: "Adicion guardada correctamente." };
}

export async function savePizzaPrice(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const id = getOptionalString(formData, "id");
  const flavorId = getString(formData, "flavor_id");
  const sizeId = getString(formData, "size_id");
  const salePriceCop = getInteger(formData, "sale_price_cop", 0);
  const estimatedCostCop = getMachineDecimal(formData, "estimated_cost_cop", 0);
  const marginPercent = getMachineDecimal(formData, "margin_percent", 0);
  const supabase = await createServerSupabaseClient();

  if (!flavorId) return { status: "error", message: "Selecciona un sabor." };
  if (!sizeId) return { status: "error", message: "Selecciona un tamano." };
  if (salePriceCop <= 0) return { status: "error", message: "Ingresa el precio de venta." };
  const { data: flavor, error: flavorError } = await supabase.from("pizza_flavors").select("id, is_active").eq("id", flavorId).single();
  if (flavorError || !flavor?.is_active) return { status: "error", message: flavorError?.message ?? "Selecciona un sabor activo." };
  const { data: size, error: sizeError } = await supabase.from("pizza_sizes").select("id, is_active").eq("id", sizeId).single();
  if (sizeError || !size?.is_active) return { status: "error", message: sizeError?.message ?? "Selecciona un tamano activo." };

  const { data: baseSources, error: baseSourceError } = await supabase
    .from("pizza_size_base_sources")
    .select("pizza_size_id, source_kind, inventory_item_id, source_preparation_id, is_active")
    .eq("is_active", true);
  if (baseSourceError) return { status: "error", message: baseSourceError.message };
  const baseSource = (baseSources ?? []).find((source) => source.pizza_size_id === sizeId);
  if (!baseSource) return { status: "error", message: "Configura la base comun para este tamano antes de guardar el precio." };
  const baseSourceId = baseSource.source_kind === "inventory_item" ? baseSource.inventory_item_id : baseSource.source_preparation_id;
  if (!baseSourceId) return { status: "error", message: "La base comun del tamano no es valida." };
  const [flavorIngredientsResult, quantityRowsResult] = await Promise.all([
    supabase.from("pizza_flavor_ingredients").select("source_kind, inventory_item_id, source_preparation_id").eq("flavor_id", flavorId),
    supabase.from("pizza_size_component_quantities").select("source_kind, inventory_item_id, source_preparation_id, quantity_base").eq("pizza_size_id", sizeId)
  ]);
  if (flavorIngredientsResult.error) return { status: "error", message: flavorIngredientsResult.error.message };
  if (quantityRowsResult.error) return { status: "error", message: quantityRowsResult.error.message };
  const reservedBaseKeys = new Set(
    (baseSources ?? []).map((source) => `${source.source_kind}:${source.source_kind === "inventory_item" ? source.inventory_item_id : source.source_preparation_id}`)
  );
  const quantityByKey = new Map(
    (quantityRowsResult.data ?? []).map((row) => [
      `${row.source_kind}:${row.source_kind === "inventory_item" ? row.inventory_item_id : row.source_preparation_id}`,
      Number(row.quantity_base ?? 0)
    ])
  );
  const missingQuantity = (flavorIngredientsResult.data ?? []).some((ingredient) => {
    const key = `${ingredient.source_kind}:${ingredient.source_kind === "inventory_item" ? ingredient.inventory_item_id : ingredient.source_preparation_id}`;
    return !reservedBaseKeys.has(key) && (quantityByKey.get(key) ?? 0) <= 0;
  });
  if (missingQuantity) return { status: "error", message: "Configura los gramajes globales de todos los ingredientes del sabor para este tamano." };
  const { data: duplicate, error: duplicateError } = await supabase
    .from("pizza_price_configs")
    .select("id")
    .eq("flavor_id", flavorId)
    .eq("size_id", sizeId)
    .maybeSingle();
  if (duplicateError) return { status: "error", message: duplicateError.message };
  if (duplicate && duplicate.id !== id) return { status: "error", message: "Ya existe un precio para este sabor y tamano." };

  const {
    data: { user }
  } = await supabase.auth.getUser();

  const payload = {
    flavor_id: flavorId,
    size_id: sizeId,
    sale_price_cop: salePriceCop,
    is_active: getBoolean(formData, "is_active"),
    updated_at: new Date().toISOString()
  };
  let query;
  try {
    query = id
      ? supabase.from("pizza_price_configs").update(payload).eq("id", id)
      : supabase.from("pizza_price_configs").insert({
          ...payload,
          sku: await reservePizzaPriceSku(supabase, flavorId, sizeId),
          created_by: user?.id ?? null
        });
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "No se pudo generar el SKU." };
  }
  const { data: savedConfig, error } = await query.select("id").single();
  if (error) return { status: "error", message: error.message };

  try {
    const { error: syncError } = await supabase.rpc("sync_pizza_price_components_for_config", { p_price_config_id: savedConfig.id });
    if (syncError) throw new Error(syncError.message);
    const { error: historyError } = await supabase.from("pizza_price_history").insert({
      price_config_id: savedConfig.id,
      estimated_cost_cop: estimatedCostCop > 0 ? estimatedCostCop : null,
      sale_price_cop: salePriceCop,
      margin_percent: marginPercent > 0 ? marginPercent : null,
      created_by: user?.id ?? null
    });
    if (historyError) throw new Error(historyError.message);
  } catch (saveError) {
    return { status: "error", message: saveError instanceof Error ? saveError.message : "No se pudo guardar la receta del precio." };
  }

  revalidateInventory();
  return { status: "success", message: "Precio guardado correctamente." };
}

export async function saveSaleProductPrice(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const id = getString(formData, "id");
  const salePriceCop = getInteger(formData, "sale_price_cop", 0);
  const currentCostCop = getMachineDecimal(formData, "current_cost_cop", 0);
  const saleIsEnabled = getBoolean(formData, "sale_is_enabled");
  const supabase = await createServerSupabaseClient();

  if (!id) return { status: "error", message: "Referencia no valida." };
  if (salePriceCop <= 0) return { status: "error", message: "Ingresa un precio de venta mayor que cero." };

  const { data: reference, error: referenceError } = await supabase
    .from("pos_sale_product_references")
    .select("id, sale_price_cop, sale_is_enabled")
    .eq("id", id)
    .maybeSingle();

  if (referenceError) return { status: "error", message: referenceError.message };
  if (!reference) return { status: "error", message: "La referencia no esta disponible para configurar precio." };

  const {
    data: { user }
  } = await supabase.auth.getUser();

  const { error: updateError } = await supabase
    .from("inventory_items")
    .update({
      sale_price_cop: salePriceCop,
      sale_is_enabled: saleIsEnabled
    })
    .eq("id", id);

  if (updateError) return { status: "error", message: updateError.message };

  const { error: historyError } = await supabase.from("sale_product_price_history").insert({
    inventory_item_id: id,
    previous_price_cop: Number(reference.sale_price_cop ?? 0),
    new_price_cop: salePriceCop,
    cost_cop: currentCostCop > 0 ? currentCostCop : null,
    sale_is_enabled: saleIsEnabled,
    created_by: user?.id ?? null
  });

  if (historyError) return { status: "error", message: historyError.message };

  revalidateInventory();
  return { status: "success", message: "Precio de producto guardado correctamente." };
}

export async function moveMenuPizzaItem(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const section = getString(formData, "section");
  const id = getString(formData, "id");
  const direction = getString(formData, "direction");
  if (!id) return { status: "error", message: "Registro no valido." };
  if (!["menu_categories", "pizza_sizes", "pizza_flavors", "pizza_additions"].includes(section)) return { status: "error", message: "Seccion no valida." };
  if (direction !== "up" && direction !== "down") return { status: "error", message: "Direccion no valida." };

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("move_menu_item", { p_section: section, p_id: id, p_direction: direction });
  if (error) return { status: "error", message: error.message };
  revalidateInventory();
  return { status: "success", message: "Orden actualizado." };
}

export async function deleteMenuCategory(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const id = getString(formData, "id");
  if (!id) return { status: "error", message: "Categoria no valida." };
  const supabase = await createServerSupabaseClient();
  try {
    const { error } = await supabase.rpc("delete_menu_item", { p_section: "menu_categories", p_id: id });
    if (error) return { status: "error", message: error.message };
    revalidateInventory();
    return { status: "success", message: "Categoria eliminada correctamente." };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "No se pudo validar la categoria." };
  }
}

export async function deletePizzaSize(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const id = getString(formData, "id");
  if (!id) return { status: "error", message: "Tamano no valido." };
  const supabase = await createServerSupabaseClient();
  try {
    const { error } = await supabase.rpc("delete_menu_item", { p_section: "pizza_sizes", p_id: id });
    if (error) return { status: "error", message: error.message };
    revalidateInventory();
    return { status: "success", message: "Tamano eliminado correctamente." };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "No se pudo eliminar el tamano." };
  }
}

export async function deletePizzaFlavor(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const id = getString(formData, "id");
  if (!id) return { status: "error", message: "Sabor no valido." };
  const supabase = await createServerSupabaseClient();
  try {
    const { data: flavor, error: flavorError } = await supabase.from("pizza_flavors").select("image_url").eq("id", id).single();
    if (flavorError) return { status: "error", message: flavorError.message };

    const { error } = await supabase.rpc("delete_menu_item", { p_section: "pizza_flavors", p_id: id });
    if (error) return { status: "error", message: error.message };
    await removeStoredImageIfUnreferenced(supabase, flavor.image_url);
    revalidateInventory();
    return { status: "success", message: "Sabor eliminado correctamente." };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "No se pudo validar el sabor." };
  }
}

export async function deletePizzaAddition(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const id = getString(formData, "id");
  if (!id) return { status: "error", message: "Adicion no valida." };
  const supabase = await createServerSupabaseClient();
  try {
    const { error } = await supabase.rpc("delete_menu_item", { p_section: "pizza_additions", p_id: id });
    if (error) return { status: "error", message: error.message };
    revalidateInventory();
    return { status: "success", message: "Adicion eliminada correctamente." };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "No se pudo eliminar la adicion." };
  }
}

export async function deletePizzaPrice(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const id = getString(formData, "id");
  if (!id) return { status: "error", message: "Precio no valido." };
  const supabase = await createServerSupabaseClient();
  try {
    const { error } = await supabase.from("pizza_price_configs").delete().eq("id", id);
    if (error) return { status: "error", message: error.message };
    revalidateInventory();
    return { status: "success", message: "Precio eliminado correctamente." };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "No se pudo eliminar el precio." };
  }
}

export async function deleteProductCategory(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const id = getString(formData, "id");
  if (!id) return { status: "error", message: "Categoria no valida." };
  const supabase = await createServerSupabaseClient();
  try {
    if ((await relationCount(supabase, "inventory_items", "category_id", id)) > 0) {
      return { status: "error", message: "No se puede eliminar esta categoria porque esta siendo utilizada en Productos." };
    }
    const { error } = await supabase.from("product_categories").delete().eq("id", id);
    if (error) return { status: "error", message: error.message };
    revalidateInventory();
    return { status: "success", message: "Categoria eliminada correctamente." };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "No se pudo validar la categoria." };
  }
}

export async function deleteBrand(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const id = getString(formData, "id");
  if (!id) return { status: "error", message: "Marca no valida." };
  const supabase = await createServerSupabaseClient();
  try {
    const usedIn: string[] = [];
    if ((await relationCount(supabase, "inventory_items", "brand_id", id)) > 0) usedIn.push("Productos");
    if ((await relationCount(supabase, "purchases", "brand_id", id)) > 0) usedIn.push("Compras");
    if (usedIn.length > 0) return { status: "error", message: `No se puede eliminar esta marca porque esta siendo utilizada en ${usedIn.join(" y ")}.` };

    const { error } = await supabase.from("brands").delete().eq("id", id);
    if (error) return { status: "error", message: error.message };
    revalidateInventory();
    return { status: "success", message: "Marca eliminada correctamente." };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "No se pudo validar la marca." };
  }
}

export async function deleteSupplier(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const id = getString(formData, "id");
  if (!id) return { status: "error", message: "Proveedor no valido." };
  const supabase = await createServerSupabaseClient();
  try {
    if ((await relationCount(supabase, "purchases", "supplier_id", id)) > 0) {
      return { status: "error", message: "No se puede eliminar este proveedor porque esta siendo utilizado en Compras." };
    }
    const { error } = await supabase.from("suppliers").delete().eq("id", id);
    if (error) return { status: "error", message: error.message };
    revalidateInventory();
    return { status: "success", message: "Proveedor eliminado correctamente." };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "No se pudo validar el proveedor." };
  }
}

export async function deleteInventoryItem(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const id = getString(formData, "id");
  if (!id) return { status: "error", message: "Producto no valido." };
  const supabase = await createServerSupabaseClient();
  try {
    const { data: item, error: itemError } = await supabase.from("inventory_items").select("image_url").eq("id", id).single();
    if (itemError) return { status: "error", message: itemError.message };

    const { data, error } = await supabase.rpc("delete_inventory_item_safely", { p_item_id: id });
    if (error) return { status: "error", message: error.message };

    const result = data as { deleted?: boolean; message?: string; used_in?: string[] } | null;
    if (!result?.deleted) {
      return {
        status: "error",
        message: result?.message ?? "No se puede eliminar este producto porque tiene relaciones. Puedes desactivarlo."
      };
    }

    await removeStoredImageIfUnreferenced(supabase, item.image_url);
    revalidateInventory();
    return { status: "success", message: result.message ?? "Producto eliminado correctamente." };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "No se pudo validar el uso del producto." };
  }
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
    .select("id, name, sku, unit, item_kind, category_id, brand_id, purchase_mode, presentation_quantity, presentation_unit, is_active")
    .eq("id", masterItemId)
    .single();

  if (masterItemError) throw new Error(masterItemError.message);
  if (purchaseKind === "ingredient" || presentationQuantity <= 0) return masterItem;

  const { data: existingReference, error: existingReferenceError } = await supabase
    .from("inventory_items")
    .select("id, name, sku, unit, item_kind, category_id, brand_id, purchase_mode, presentation_quantity, presentation_unit, is_active")
    .eq("item_kind", purchaseKind)
    .eq("presentation_quantity", presentationQuantity)
    .eq("presentation_unit", presentationUnit)
    .eq("name", masterItem.name.toUpperCase())
    .maybeSingle();

  if (existingReferenceError) throw new Error(existingReferenceError.message);
  if (existingReference) return existingReference;

  const sku = normalizeReferenceSku(referenceSku) ?? buildReferenceSku(masterItem.name, presentationQuantity, presentationUnit);
  const { data: duplicateSku, error: duplicateSkuError } = await supabase.from("inventory_items").select("id").ilike("sku", sku).limit(1).maybeSingle();
  if (duplicateSkuError) throw new Error(duplicateSkuError.message);
  if (duplicateSku) throw new Error(`Ya existe un producto con el SKU ${sku}.`);

  const { data, error } = await supabase
    .from("inventory_items")
    .insert({
      name: masterItem.name.toUpperCase(),
      sku,
      unit: "unit",
      item_kind: purchaseKind,
      category_id: masterItem.category_id,
      brand_id: masterItem.brand_id,
      purchase_mode: purchaseKind === "ingredient" ? masterItem.purchase_mode ?? "packages" : "packages",
      presentation_quantity: presentationQuantity,
      presentation_unit: presentationUnit,
      is_active: true,
      current_quantity: 0,
      average_cost_cop: 0
    })
    .select("id, name, sku, unit, item_kind, category_id, brand_id, purchase_mode, presentation_quantity, presentation_unit, is_active")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function registerPurchase(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const purchaseId = getOptionalString(formData, "purchase_id");
  let inventoryItemId = getString(formData, "inventory_item_id");
  let purchaseKind = getInventoryItemKind(formData, "purchase_kind");
  const enteredQuantity = getDecimal(formData, "quantity", 0);
  const submittedPurchaseMode = getPurchaseMode(formData);
  const packageContentQuantity = getDecimal(formData, "package_content_quantity", 0);
  const presentationQuantity = getDecimal(formData, "presentation_quantity", 0);
  const presentationUnit = getStockUnit(formData, "presentation_unit");
  const effectivePresentationQuantity = submittedPurchaseMode === "packages" ? packageContentQuantity : presentationQuantity;
  const normalizedPresentation =
    effectivePresentationQuantity > 0 ? normalizeStockQuantityToBase(effectivePresentationQuantity, presentationUnit) : { quantity: 0, unit: canonicalStockUnit(presentationUnit) };
  const lineTotal = getInteger(formData, "total_paid_cop", 0);
  const purchaseDate = getString(formData, "purchase_date");
  const expirationDate = getOptionalString(formData, "expiration_date");
  const referenceSku = normalizeReferenceSku(getOptionalString(formData, "reference_sku"));
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return { status: "error", message: "Debes iniciar sesion." };
  if (!inventoryItemId) return { status: "error", message: "Selecciona un producto registrado." };
  if (enteredQuantity <= 0) return { status: "error", message: "Ingresa una cantidad mayor a cero." };
  if (lineTotal <= 0) return { status: "error", message: "Ingresa el total pagado." };

  if (!purchaseKind) {
    const { data: selectedItem, error: selectedItemError } = await supabase.from("inventory_items").select("item_kind").eq("id", inventoryItemId).single();
    if (selectedItemError) return { status: "error", message: selectedItemError.message };
    purchaseKind = selectedItem?.item_kind === "sale_product" || selectedItem?.item_kind === "supply" ? selectedItem.item_kind : "ingredient";
  }
  const storesPresentationAsLabel = purchaseKind === "sale_product";

  const affectedItems = new Set<string>();
  if (purchaseId) {
    const { data: previousLines, error: previousLinesError } = await supabase.from("purchase_items").select("inventory_item_id").eq("purchase_id", purchaseId);
    if (previousLinesError) return { status: "error", message: previousLinesError.message };
    previousLines?.forEach((line) => affectedItems.add(line.inventory_item_id));
  }

  let item: { id: string; unit: string; purchase_mode?: string | null };
  let quantity = 0;
  try {
    item = await resolvePurchaseInventoryItem(supabase, inventoryItemId, purchaseKind, normalizedPresentation.quantity, normalizedPresentation.unit, referenceSku);
    inventoryItemId = item.id;
    const isUnitStockItem = item.unit === "unit" && purchaseKind !== "sale_product";
    const targetUnit = purchaseKind === "ingredient" || isUnitStockItem ? canonicalStockUnit(presentationUnit) : "unit";
    const itemPurchaseMode =
      purchaseKind === "ingredient" && !isUnitStockItem && (item.purchase_mode === "packages" || item.purchase_mode === "total_weight")
        ? item.purchase_mode
        : submittedPurchaseMode;
    if (itemPurchaseMode === "packages" && packageContentQuantity <= 0) return { status: "error", message: "Ingresa el contenido por paquete." };
    const ingredientEntryQuantity = purchaseKind === "ingredient" && itemPurchaseMode === "packages" ? enteredQuantity * packageContentQuantity : enteredQuantity;
    if (purchaseKind === "sale_product") {
      quantity = enteredQuantity;
    } else if (isUnitStockItem) {
      quantity = itemPurchaseMode === "packages" ? enteredQuantity * packageContentQuantity : enteredQuantity;
    } else if (purchaseKind === "supply") {
      quantity = enteredQuantity;
    } else {
      quantity = convertStockQuantity(ingredientEntryQuantity, presentationUnit, targetUnit);
    }
    item.unit = targetUnit;
    item.purchase_mode = itemPurchaseMode;
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "No se pudo resolver el producto de inventario." };
  }

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
    : await supabase.from("purchases").insert(purchasePayload).select("id").single();

  if (purchaseResult.error) return { status: "error", message: purchaseResult.error.message };
  if (!purchaseResult.data) return { status: "error", message: "No se pudo guardar la compra." };

  if (purchaseId) {
    const { error: deleteLineError } = await supabase.from("purchase_items").delete().eq("purchase_id", purchaseId);
    if (deleteLineError) return { status: "error", message: deleteLineError.message };
  }

  const unitCost = quantity > 0 ? Math.round((lineTotal / quantity) * 100) / 100 : 0;
  const linePayload: {
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
    purchase_id: purchaseResult.data.id,
    inventory_item_id: inventoryItemId,
    purchased_quantity: enteredQuantity,
    quantity,
    unit: item.unit,
    presentation_quantity:
      item.purchase_mode === "packages"
        ? storesPresentationAsLabel
          ? packageContentQuantity
          : normalizedPresentation.quantity
        : purchaseKind === "ingredient" && item.unit !== "unit"
          ? enteredQuantity
          : storesPresentationAsLabel
          ? presentationQuantity > 0
            ? presentationQuantity
            : null
          : normalizedPresentation.quantity > 0
            ? normalizedPresentation.quantity
            : null,
    presentation_unit:
      item.purchase_mode === "packages"
        ? storesPresentationAsLabel
          ? presentationUnit
          : normalizedPresentation.unit
        : purchaseKind === "ingredient" && item.unit !== "unit"
          ? presentationUnit
          : storesPresentationAsLabel
          ? presentationQuantity > 0
            ? presentationUnit
            : null
          : normalizedPresentation.quantity > 0
            ? normalizedPresentation.unit
            : null,
    unit_cost_cop: unitCost,
    line_total_cop: lineTotal
  };
  if (expirationDate) linePayload.expiration_date = expirationDate;

  const { error: lineError } = await supabase.from("purchase_items").insert(linePayload);
  if (lineError) return { status: "error", message: lineError.message };

  affectedItems.add(inventoryItemId);
  try {
    await Promise.all([...affectedItems].map((id) => recalculateInventoryItem(supabase, id)));
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "No se pudo recalcular el inventario." };
  }

  revalidateInventory();
  return { status: "success", message: "Guardado correctamente" };
}

export async function deletePurchase(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const purchaseId = getString(formData, "purchase_id");
  if (!purchaseId) return { status: "error", message: "Compra no valida." };
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return { status: "error", message: "Debes iniciar sesion." };

  try {
    const { data: lines, error: linesError } = await supabase.from("purchase_items").select("inventory_item_id").eq("purchase_id", purchaseId);
    if (linesError) return { status: "error", message: linesError.message };
    const affectedItems = Array.from(new Set((lines ?? []).map((line) => line.inventory_item_id)));

    const { error } = await supabase.from("purchases").delete().eq("id", purchaseId);
    if (error) return { status: "error", message: error.message };

    await Promise.all(affectedItems.map((id) => recalculateInventoryItem(supabase, id)));
    revalidateInventory();
    return { status: "success", message: "Compra eliminada y stock revertido correctamente." };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "No se pudo eliminar la compra." };
  }
}

function getConservationDurationUnit(formData: FormData, key: string) {
  const value = getString(formData, key);
  return value === "hours" || value === "days" ? value : "days";
}

function getStorageMethod(value: string) {
  return ["ambient", "refrigerated", "frozen"].includes(value) ? value : "";
}

function getUnitKind(formData: FormData) {
  const value = getString(formData, "unit_kind");
  if (value === "weight" || value === "volume" || value === "unit") return value;
  return "";
}

function canonicalUnitForKind(unitKind: string) {
  if (unitKind === "weight") return "g";
  if (unitKind === "volume") return "ml";
  return "unit";
}

function unitKindForStockUnit(unit: string) {
  if (unit === "g" || unit === "kg") return "weight";
  if (unit === "ml" || unit === "l") return "volume";
  return "unit";
}

function isUnitCompatibleWithKind(unitKind: string, unit: string) {
  if (unitKind === "weight") return unit === "g" || unit === "kg";
  if (unitKind === "volume") return unit === "ml" || unit === "l";
  return unit === "unit";
}

function getIndexedStrings(formData: FormData, prefix: string) {
  const indexes = new Set<number>();
  for (const key of formData.keys()) {
    const match = key.match(new RegExp(`^${prefix}\\[(\\d+)\\]`));
    if (match) indexes.add(Number(match[1]));
  }
  return [...indexes].sort((a, b) => a - b);
}

export async function saveConservationProfile(_previousState: ConservationProfileActionState, formData: FormData): Promise<ConservationProfileActionState> {
  const id = getOptionalString(formData, "id");
  const supabase = await createServerSupabaseClient();
  const name = upperText(getOptionalString(formData, "name")) ?? "";

  if (!name) return { status: "error", message: "Ingresa el nombre del perfil." };

  try {
    if (await hasDuplicateName(supabase, "conservation_profiles", name, id)) {
      return { status: "error", message: "Ya existe un perfil con ese nombre." };
    }
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "No se pudo validar el perfil." };
  }

  const rules = getIndexedStrings(formData, "rules")
    .map((index) => {
      const enabled = formData.get(`rules[${index}][enabled]`) === "on";
      const storageMethod = getStorageMethod(getString(formData, `rules[${index}][storage_method]`));
      const durationValue = getInteger(formData, `rules[${index}][duration_value]`, 0);
      const temperatureMin = getSignedDecimal(formData, `rules[${index}][temperature_min]`);
      const temperatureMax = getSignedDecimal(formData, `rules[${index}][temperature_max]`);
      return {
        enabled,
        storage_method: storageMethod,
        duration_value: durationValue,
        duration_unit: getConservationDurationUnit(formData, `rules[${index}][duration_unit]`),
        temperature_min: temperatureMin,
        temperature_max: temperatureMax
      };
    })
    .filter((rule) => rule.enabled);

  if (rules.length === 0) return { status: "error", message: "Habilita al menos un metodo de conservacion." };
  if (rules.some((rule) => !rule.storage_method || rule.duration_value <= 0)) {
    return { status: "error", message: "Cada metodo habilitado necesita duracion mayor que cero." };
  }
  if (rules.some((rule) => rule.temperature_min !== null && rule.temperature_max !== null && rule.temperature_min > rule.temperature_max)) {
    return { status: "error", message: "La temperatura minima no puede superar la maxima." };
  }
  if (new Set(rules.map((rule) => rule.storage_method)).size !== rules.length) {
    return { status: "error", message: "No puedes repetir metodos de conservacion en el mismo perfil." };
  }

  const payload = {
    name,
    description: upperText(getOptionalString(formData, "description")),
    temperature_min: null,
    temperature_max: null,
    is_active: getBoolean(formData, "is_active"),
    updated_at: new Date().toISOString()
  };

  let profileResult;
  if (id) {
    profileResult = await supabase.from("conservation_profiles").update(payload).eq("id", id).select("id").single();
  } else {
    const [{ data: skuData, error: skuError }, { data: sortData, error: sortError }] = await Promise.all([
      supabase.rpc("reserve_conservation_profile_sku", { p_name: name }),
      supabase.from("conservation_profiles").select("sort_order").order("sort_order", { ascending: false }).limit(1).maybeSingle()
    ]);
    if (skuError) return { status: "error", message: skuError.message };
    if (sortError) return { status: "error", message: sortError.message };
    profileResult = await supabase
      .from("conservation_profiles")
      .insert({ ...payload, sku: skuData, sort_order: Number(sortData?.sort_order ?? 0) + 1 })
      .select("id")
      .single();
  }

  if (profileResult.error) return { status: "error", message: profileResult.error.message };
  const profileId = profileResult.data?.id;
  if (!profileId) return { status: "error", message: "No se pudo guardar el perfil." };

  const { error: deleteRulesError } = await supabase.from("conservation_profile_rules").delete().eq("profile_id", profileId);
  if (deleteRulesError) return { status: "error", message: deleteRulesError.message };

  const { error: rulesError } = await supabase.from("conservation_profile_rules").insert(
    rules.map((rule) => ({
      profile_id: profileId,
      storage_method: rule.storage_method,
      duration_value: rule.duration_value,
      duration_unit: rule.duration_unit,
      temperature_min: rule.temperature_min,
      temperature_max: rule.temperature_max,
      notes: null
    }))
  );
  if (rulesError) return { status: "error", message: rulesError.message };

  const { data: savedProfile, error: savedProfileError } = await supabase
    .from("conservation_profiles")
    .select("id, sku, name, description, sort_order, temperature_min, temperature_max, is_active, conservation_profile_rules(id, storage_method, duration_value, duration_unit, temperature_min, temperature_max, notes)")
    .eq("id", profileId)
    .single();
  if (savedProfileError) return { status: "error", message: savedProfileError.message };

  revalidateInventory();
  return { status: "success", message: "Perfil guardado correctamente.", profile: savedProfile as ConservationProfileActionState["profile"] };
}

export async function moveConservationProfile(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const id = getString(formData, "id");
  const direction = getString(formData, "direction");
  if (!id) return { status: "error", message: "Perfil no valido." };
  if (direction !== "up" && direction !== "down") return { status: "error", message: "Direccion no valida." };

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("move_conservation_profile", { p_id: id, p_direction: direction });
  if (error) return { status: "error", message: error.message };
  revalidateInventory();
  return { status: "success", message: "Orden actualizado." };
}

export async function deleteConservationProfile(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const id = getString(formData, "id");
  if (!id) return { status: "error", message: "Perfil no valido." };

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("delete_conservation_profile", { p_id: id });
  if (error) return { status: "error", message: error.message };
  revalidateInventory();
  return { status: "success", message: "Perfil eliminado correctamente." };
}

export async function savePreparation(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const id = getOptionalString(formData, "id");
  const supabase = await createServerSupabaseClient();
  const name = upperText(getOptionalString(formData, "name")) ?? "";
  const unitKind = getUnitKind(formData);
  const baseUnit = canonicalUnitForKind(unitKind);
  const submittedYieldUnit = getStockUnit(formData, "base_yield_unit");
  const submittedYieldQuantity = getDecimal(formData, "base_yield_quantity", 0);
  const alternativeUnitRaw = getOptionalString(formData, "alternative_unit");
  const alternativeUnit = alternativeUnitRaw ? getStockUnit(formData, "alternative_unit") : null;
  const conversionEnabled = getString(formData, "conversion_enabled") === "on";
  const density = conversionEnabled ? getDecimal(formData, "density", 0) : 0;

  if (!name) return { status: "error", message: "Ingresa el nombre de la preparacion." };
  if (!unitKind) return { status: "error", message: "Selecciona la unidad principal." };
  if (!isUnitCompatibleWithKind(unitKind, submittedYieldUnit)) return { status: "error", message: "El rendimiento no es compatible con la unidad principal." };
  if (submittedYieldQuantity <= 0) return { status: "error", message: "Ingresa un rendimiento mayor a cero." };
  if (conversionEnabled && unitKind === "unit") return { status: "error", message: "La conversion peso-volumen no aplica para unidad." };
  if (conversionEnabled && density <= 0) {
    return { status: "error", message: "Ingresa densidad para convertir entre peso y volumen." };
  }

  try {
    if (await hasDuplicateName(supabase, "preparations", name, id)) {
      return { status: "error", message: "Ya existe una preparacion con ese nombre." };
    }
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "No se pudo validar la preparacion." };
  }

  const baseYieldQuantity = convertStockQuantity(submittedYieldQuantity, submittedYieldUnit, baseUnit);
  const payload: {
    name: string;
    image_url?: string | null;
    unit_kind: string;
    base_unit: string;
    alternative_unit: string | null;
    density: number | null;
    conservation_profile_id: string | null;
    base_yield_quantity: number;
    base_yield_unit: string;
    is_active: boolean;
    updated_at: string;
  } = {
    name,
    unit_kind: unitKind,
    base_unit: baseUnit,
    alternative_unit: alternativeUnit,
    density: conversionEnabled && density > 0 ? density : null,
    conservation_profile_id: getOptionalString(formData, "conservation_profile_id"),
    base_yield_quantity: baseYieldQuantity,
    base_yield_unit: baseUnit,
    is_active: getBoolean(formData, "is_active"),
    updated_at: new Date().toISOString()
  };

  const imageFile = getFormFile(formData, "preparation_image");
  const shouldRemoveImage = getString(formData, "remove_image") === "1";
  if (imageFile) {
    try {
      payload.image_url = await uploadProductImage(supabase, imageFile, "preparaciones");
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : "No se pudo subir la foto." };
    }
  } else if (shouldRemoveImage) {
    payload.image_url = null;
  }

  const preparationResult = id
    ? await supabase.from("preparations").update(payload).eq("id", id).select("id").single()
    : await supabase.from("preparations").insert(payload).select("id").single();

  if (preparationResult.error) return { status: "error", message: preparationResult.error.message };
  const preparationId = preparationResult.data?.id;
  if (!preparationId) return { status: "error", message: "No se pudo guardar la preparacion." };

  if (id) {
    const { error: deleteRecipeError } = await supabase.from("preparation_recipe_items").delete().eq("preparation_id", preparationId);
    if (deleteRecipeError) return { status: "error", message: deleteRecipeError.message };
  }

  const indexes = getIndexedStrings(formData, "recipe");
  const recipeRows = [];
  for (const index of indexes) {
    const sourceKind = getString(formData, `recipe[${index}][source_kind]`);
    const sourceId = getString(formData, `recipe[${index}][source_id]`);
    const quantity = getDecimal(formData, `recipe[${index}][quantity]`, 0);
    const unit = getStockUnit(formData, `recipe[${index}][unit]`);
    if (!sourceId || quantity <= 0) continue;

    if (sourceKind === "preparation") {
      if (sourceId === preparationId) return { status: "error", message: "Una preparacion no puede usarse como ingrediente de si misma." };
      const { data: sourcePreparation, error: sourcePreparationError } = await supabase.from("preparations").select("unit_kind, base_unit, is_active").eq("id", sourceId).single();
      if (sourcePreparationError) return { status: "error", message: sourcePreparationError.message };
      if (!sourcePreparation.is_active) return { status: "error", message: "Solo puedes usar preparaciones activas en la receta." };
      if (!isUnitCompatibleWithKind(sourcePreparation.unit_kind, unit)) return { status: "error", message: "Hay una unidad incompatible en la receta." };
      recipeRows.push({
        preparation_id: preparationId,
        source_kind: "preparation",
        source_preparation_id: sourceId,
        inventory_item_id: null,
        quantity: convertStockQuantity(quantity, unit, sourcePreparation.base_unit),
        unit: sourcePreparation.base_unit
      });
      continue;
    }

    const { data: inventoryItem, error: inventoryItemError } = await supabase
      .from("inventory_items")
      .select("unit, item_kind, is_active, presentation_quantity")
      .eq("id", sourceId)
      .single();
    if (inventoryItemError) return { status: "error", message: inventoryItemError.message };
    if (!inventoryItem.is_active || inventoryItem.item_kind !== "ingredient" || inventoryItem.presentation_quantity !== null) {
      return { status: "error", message: "La receta base solo puede usar ingredientes activos." };
    }
    const targetUnit = canonicalStockUnit(inventoryItem.unit);
    if (!isUnitCompatibleWithKind(unitKindForStockUnit(targetUnit), unit)) return { status: "error", message: "Hay una unidad incompatible en la receta." };
    recipeRows.push({
      preparation_id: preparationId,
      source_kind: "inventory_item",
      inventory_item_id: sourceId,
      source_preparation_id: null,
      quantity: convertStockQuantity(quantity, unit, targetUnit),
      unit: targetUnit
    });
  }

  if (recipeRows.length > 0) {
    const { error: recipeError } = await supabase.from("preparation_recipe_items").insert(recipeRows);
    if (recipeError) return { status: "error", message: recipeError.message };
  }

  revalidateInventory();
  return { status: "success", message: "Preparacion guardada correctamente." };
}

export async function togglePreparationState(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const id = getString(formData, "id");
  const isActive = getString(formData, "is_active") === "true";
  if (!id) return { status: "error", message: "Preparacion no valida." };
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("preparations").update({ is_active: isActive, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { status: "error", message: error.message };
  revalidateInventory();
  return { status: "success", message: isActive ? "Preparacion activada." : "Preparacion desactivada." };
}

export async function registerProduction(_previousState: ProductionActionState, formData: FormData): Promise<ProductionActionState> {
  const supabase = await createServerSupabaseClient();
  const preparationId = getString(formData, "preparation_id");
  const storageMethod = getString(formData, "storage_method");
  const elaboratedAt = getString(formData, "elaborated_at");
  const expirationDate = getString(formData, "expiration_date");
  const actualQuantity = getDecimal(formData, "actual_quantity", 0);
  const actualUnit = getStockUnit(formData, "actual_unit");
  const submittedExpectedQuantity = getDecimal(formData, "expected_quantity", 0);
  const submittedExpectedUnit = getStockUnit(formData, "expected_unit");
  const expectedQuantity = submittedExpectedQuantity > 0 ? submittedExpectedQuantity : actualQuantity;
  const expectedUnit = submittedExpectedQuantity > 0 ? submittedExpectedUnit : actualUnit;
  const itemsRaw = getString(formData, "items");

  if (!preparationId) return { status: "error", message: "Selecciona una preparacion." };
  if (!["ambient", "refrigerated", "frozen"].includes(storageMethod)) return { status: "error", message: "Selecciona un metodo de conservacion valido." };
  if (!elaboratedAt) return { status: "error", message: "Ingresa la fecha de elaboracion." };
  if (!expirationDate) return { status: "error", message: "Ingresa la fecha de vencimiento." };
  if (actualQuantity <= 0) return { status: "error", message: "La cantidad real debe ser mayor a cero." };

  let items: unknown;
  try {
    items = JSON.parse(itemsRaw);
  } catch {
    return { status: "error", message: "La receta confirmada no es valida." };
  }

  if (!Array.isArray(items) || items.length === 0) {
    return { status: "error", message: "La produccion necesita al menos un ingrediente." };
  }

  const { data: activeProfileRule, error: activeProfileRuleError } = await supabase
    .from("preparations")
    .select("id, conservation_profiles!inner(is_active, conservation_profile_rules(storage_method))")
    .eq("id", preparationId)
    .eq("conservation_profiles.is_active", true)
    .single();
  if (activeProfileRuleError || !activeProfileRule) {
    return { status: "error", message: activeProfileRuleError?.message ?? "La preparacion no tiene un perfil de conservacion activo." };
  }

  const { data, error } = await supabase.rpc("create_production", {
    p_preparation_id: preparationId,
    p_storage_method: storageMethod,
    p_elaborated_at: elaboratedAt,
    p_expiration_date: expirationDate,
    p_expected_quantity: expectedQuantity,
    p_expected_unit: expectedUnit,
    p_actual_quantity: actualQuantity,
    p_actual_unit: actualUnit,
    p_items: items
  });

  if (error) return { status: "error", message: error.message };

  revalidateInventory();
  return {
    status: "success",
    message: "Produccion registrada correctamente.",
    production: data as ProductionActionState["production"]
  };
}

export async function deleteProduction(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const productionId = getString(formData, "production_id");
  if (!productionId) return { status: "error", message: "Produccion no valida." };

  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return { status: "error", message: "Debes iniciar sesion." };

  try {
    const { data: batches, error: batchesError } = await supabase
      .from("production_batches")
      .select("id")
      .eq("production_id", productionId);
    if (batchesError) return { status: "error", message: batchesError.message };

    const batchIds = (batches ?? []).map((batch) => batch.id);
    if (batchIds.length > 0) {
      const { count, error: allocationsError } = await supabase
        .from("production_consumption_allocations")
        .select("id", { count: "exact", head: true })
        .in("production_batch_id", batchIds);

      if (allocationsError) return { status: "error", message: allocationsError.message };
      if ((count ?? 0) > 0) {
        return {
          status: "error",
          message: "No se puede eliminar esta produccion porque su lote ya fue consumido por otra produccion."
        };
      }
    }

    const { error } = await supabase.from("productions").delete().eq("id", productionId);
    if (error) return { status: "error", message: error.message };

    revalidateInventory();
    revalidatePath("/panel/produccion/registrar");
    return { status: "success", message: "Produccion eliminada correctamente." };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "No se pudo eliminar la produccion." };
  }
}

export async function recordPhysicalInventoryCount(
  _previousState: PhysicalInventoryActionState,
  formData: FormData
): Promise<PhysicalInventoryActionState> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return { status: "error", message: "Debes iniciar sesion." };

  const sourceKind = getString(formData, "source_kind");
  const sourceId = getString(formData, "source_id");
  const theoreticalQuantity = getMachineDecimal(formData, "theoretical_quantity_base", 0);
  const averageCost = getMachineDecimal(formData, "average_cost_cop", 0);
  const physicalQuantity = getDecimal(formData, "physical_quantity", 0);
  const physicalUnit = getStockUnit(formData, "physical_unit");
  const reason = getString(formData, "reason");

  if (sourceKind !== "inventory_item" && sourceKind !== "preparation") {
    return { status: "error", message: "Selecciona un producto o preparacion valida." };
  }
  if (!sourceId) return { status: "error", message: "Selecciona un registro para contar." };
  if (physicalQuantity < 0) return { status: "error", message: "El stock fisico no puede ser negativo." };
  if (!reason) return { status: "error", message: "Ingresa el motivo del conteo." };

  let baseUnit = "unit";
  if (sourceKind === "inventory_item") {
    const { data: item, error } = await supabase.from("inventory_items").select("unit").eq("id", sourceId).single();
    if (error || !item) return { status: "error", message: error?.message ?? "Producto no encontrado." };
    baseUnit = canonicalStockUnit(item.unit);
  } else {
    const { data: preparation, error } = await supabase.from("preparations").select("base_unit").eq("id", sourceId).single();
    if (error || !preparation) return { status: "error", message: error?.message ?? "Preparacion no encontrada." };
    baseUnit = canonicalStockUnit(preparation.base_unit);
  }

  let physicalBase = 0;
  try {
    physicalBase = convertStockQuantity(physicalQuantity, physicalUnit, baseUnit);
  } catch {
    return { status: "error", message: "La unidad del conteo no es compatible con el producto seleccionado." };
  }

  const difference = Number((physicalBase - theoreticalQuantity).toFixed(3));
  if (difference === 0) {
    return { status: "error", message: "No hay diferencia entre el stock teorico y el stock fisico." };
  }

  const adjustmentKind = difference > 0 ? "adjustment_in" : "waste";
  const payload = {
    source_kind: sourceKind,
    inventory_item_id: sourceKind === "inventory_item" ? sourceId : null,
    source_preparation_id: sourceKind === "preparation" ? sourceId : null,
    theoretical_quantity_base: theoreticalQuantity,
    physical_quantity_base: physicalBase,
    difference_quantity_base: difference,
    base_unit: baseUnit,
    average_cost_cop: averageCost,
    adjustment_kind: adjustmentKind,
    reason: upperText(reason),
    created_by: user.id
  };

  const { data, error } = await supabase
    .from("physical_inventory_counts")
    .insert(payload)
    .select("id, adjustment_kind, difference_quantity_base, base_unit")
    .single();

  if (error) return { status: "error", message: error.message };

  revalidateInventory();
  return {
    status: "success",
    message: "Conteo fisico registrado correctamente.",
    count: data as PhysicalInventoryActionState["count"]
  };
}

export async function updatePhysicalInventoryCount(
  _previousState: PhysicalInventoryActionState,
  formData: FormData
): Promise<PhysicalInventoryActionState> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return { status: "error", message: "Debes iniciar sesion." };

  const countId = getString(formData, "count_id");
  const physicalQuantity = getDecimal(formData, "physical_quantity", 0);
  const physicalUnit = getStockUnit(formData, "physical_unit");
  const reason = getString(formData, "reason");

  if (!countId) return { status: "error", message: "Selecciona un ajuste valido." };
  if (physicalQuantity < 0) return { status: "error", message: "El stock fisico no puede ser negativo." };
  if (!reason) return { status: "error", message: "Ingresa el motivo del ajuste." };

  try {
    const { count, sourceId } = await getEditablePhysicalCount(supabase, countId);
    const currentStock = await physicalCountSourceStockBase(supabase, count.source_kind, sourceId, count.base_unit);
    const previousDifference = Number(count.difference_quantity_base ?? 0);
    const revertedStock = Number((currentStock - previousDifference).toFixed(3));
    if (revertedStock < 0) {
      return { status: "error", message: "No se puede revertir el ajuste anterior sin dejar stock negativo." };
    }

    const physicalBase = convertStockQuantity(physicalQuantity, physicalUnit, count.base_unit);
    const difference = Number((physicalBase - revertedStock).toFixed(3));
    if (difference === 0) return { status: "error", message: "No hay diferencia entre el stock teorico y el stock fisico." };
    if (physicalBase < 0) return { status: "error", message: "El stock final no puede ser negativo." };

    const adjustmentKind = difference > 0 ? "adjustment_in" : "waste";
    const { data, error } = await supabase
      .from("physical_inventory_counts")
      .update({
        theoretical_quantity_base: revertedStock,
        physical_quantity_base: physicalBase,
        difference_quantity_base: difference,
        adjustment_kind: adjustmentKind,
        reason: upperText(reason),
        updated_at: new Date().toISOString(),
        updated_by: user.id
      })
      .eq("id", count.id)
      .select("id, adjustment_kind, difference_quantity_base, base_unit")
      .single();

    if (error) return { status: "error", message: error.message };

    revalidateInventory();
    return {
      status: "success",
      message: "Ajuste de inventario actualizado correctamente.",
      count: data as PhysicalInventoryActionState["count"]
    };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "No se pudo actualizar el ajuste." };
  }
}

export async function voidPhysicalInventoryCount(
  _previousState: PhysicalInventoryActionState,
  formData: FormData
): Promise<PhysicalInventoryActionState> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return { status: "error", message: "Debes iniciar sesion." };

  const countId = getString(formData, "count_id");
  if (!countId) return { status: "error", message: "Selecciona un ajuste valido." };

  try {
    const { count, sourceId } = await getEditablePhysicalCount(supabase, countId);
    const currentStock = await physicalCountSourceStockBase(supabase, count.source_kind, sourceId, count.base_unit);
    const revertedStock = Number((currentStock - Number(count.difference_quantity_base ?? 0)).toFixed(3));
    if (revertedStock < 0) {
      return { status: "error", message: "No se puede eliminar este ajuste porque la reversion dejaria stock negativo." };
    }

    const { data, error } = await supabase
      .from("physical_inventory_counts")
      .update({
        voided_at: new Date().toISOString(),
        voided_by: user.id,
        void_reason: "ANULADO DESDE INVENTARIO"
      })
      .eq("id", count.id)
      .select("id, adjustment_kind, difference_quantity_base, base_unit")
      .single();

    if (error) return { status: "error", message: error.message };

    revalidateInventory();
    return {
      status: "success",
      message: "Ajuste de inventario eliminado correctamente.",
      count: data as PhysicalInventoryActionState["count"]
    };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "No se pudo eliminar el ajuste." };
  }
}

export async function createPosOrder(_previousState: PosOrderActionState, formData: FormData): Promise<PosOrderActionState> {
  const supabase = await createServerSupabaseClient();
  const kind = getString(formData, "kind");
  const paymentMethod = getString(formData, "payment_method");
  const itemsRaw = getString(formData, "items");
  const customerName = getString(formData, "customer_name");
  const customerPhone = getString(formData, "customer_phone");
  const discountCop = getDecimal(formData, "discount_cop", 0);
  const deliveryCop = getDecimal(formData, "delivery_cop", 0);
  const cashReceivedCop = getDecimal(formData, "cash_received_cop", 0);
  const cashChangeCop = getDecimal(formData, "cash_change_cop", 0);
  const notes = getString(formData, "notes");

  if (!["local", "pickup", "delivery"].includes(kind)) return { status: "error", message: "Selecciona el tipo de pedido." };
  if (!["cash", "card", "transfer", "mixed", "pending"].includes(paymentMethod)) return { status: "error", message: "Selecciona la forma de pago." };

  let items: unknown;
  try {
    items = JSON.parse(itemsRaw);
  } catch {
    return { status: "error", message: "El pedido no tiene productos validos." };
  }

  if (!Array.isArray(items) || items.length === 0) return { status: "error", message: "Agrega al menos un producto al pedido." };
  if (paymentMethod === "cash" && cashReceivedCop <= 0) return { status: "error", message: "Confirma el cobro en efectivo." };

  const { data, error } = await supabase.rpc("create_pos_order_with_payment", {
    p_kind: kind,
    p_customer_name: upperText(customerName),
    p_customer_phone: customerPhone,
    p_discount_cop: discountCop,
    p_delivery_cop: deliveryCop,
    p_payment_method: paymentMethod,
    p_notes: upperText(notes),
    p_items: items,
    p_cash_received_cop: paymentMethod === "cash" ? cashReceivedCop : null,
    p_cash_change_cop: paymentMethod === "cash" ? cashChangeCop : null
  });

  if (error) {
    const errorWithDetails = error as typeof error & { details?: string | null };
    let stockShortages: PosStockShortage[] = [];
    if (error.message === "POS_STOCK_SHORTAGE" && errorWithDetails.details) {
      try {
        const parsed = JSON.parse(errorWithDetails.details);
        if (Array.isArray(parsed)) stockShortages = parsed as PosStockShortage[];
      } catch {
        stockShortages = [];
      }
    }

    if (stockShortages.length === 0 && /stock insuficiente/i.test(error.message)) {
      const { data: currentShortages } = await supabase.rpc("get_pos_order_stock_shortages", { p_items: items });
      if (Array.isArray(currentShortages)) stockShortages = currentShortages as PosStockShortage[];
    }

    if (stockShortages.length > 0) {
      return {
        status: "error",
        message: "No hay suficiente stock para elaborar este pedido.",
        stockShortages
      };
    }
    return { status: "error", message: error.message };
  }
  const order = data as PosOrderActionState["order"];

  revalidateInventory();
  return {
    status: "success",
    message: "Pedido confirmado correctamente.",
    order
  };
}

export async function cancelPosOrder(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const supabase = await createServerSupabaseClient();
  const orderId = getString(formData, "order_id");
  const reason = getString(formData, "reason");
  if (!orderId) return { status: "error", message: "Pedido no valido." };

  const { error } = await supabase.rpc("cancel_pos_order", {
    p_order_id: orderId,
    p_reason: upperText(reason)
  });

  if (error) return { status: "error", message: error.message };
  revalidateInventory();
  return { status: "success", message: "Pedido cancelado correctamente." };
}

export async function updateKitchenOrderItemStatus(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const supabase = await createServerSupabaseClient();
  const itemId = getString(formData, "kitchen_order_item_id");
  const status = getString(formData, "status");
  if (!itemId) return { status: "error", message: "Linea de cocina no valida." };
  if (!["in_preparation", "prepared"].includes(status)) return { status: "error", message: "Estado de cocina no valido." };

  const { error } = await supabase.rpc("update_kitchen_order_item_status", {
    p_kitchen_order_item_id: itemId,
    p_status: status
  });

  if (error) return { status: "error", message: error.message };
  revalidatePath("/panel/cocina");
  revalidatePath("/panel/pedidos");
  return { status: "success", message: "Linea actualizada." };
}

export async function saveKitchenSettings(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const supabase = await createServerSupabaseClient();
  const ovenCount = getInteger(formData, "oven_count", 1);
  const ovenWidthCm = getDecimal(formData, "oven_width_cm", 130);
  const ovenDepthCm = getDecimal(formData, "oven_depth_cm", 50);
  const warningThreshold = getInteger(formData, "warning_threshold_minutes", 12);
  const delayThreshold = getInteger(formData, "delay_threshold_minutes", 20);

  if (ovenCount <= 0) return { status: "error", message: "Ingresa al menos un horno." };
  if (ovenWidthCm <= 0 || ovenDepthCm <= 0) return { status: "error", message: "Ingresa medidas utiles del horno mayores a cero." };
  if (delayThreshold < warningThreshold) return { status: "error", message: "El umbral de retraso debe ser mayor o igual al de advertencia." };

  const userResult = await supabase.auth.getUser();
  const userId = userResult.data.user?.id ?? null;

  const { error: settingsError } = await supabase.from("kitchen_settings").upsert({
    id: true,
    oven_count: ovenCount,
    oven_width_cm: ovenWidthCm,
    oven_depth_cm: ovenDepthCm,
    sound_enabled_default: getBoolean(formData, "sound_enabled_default"),
    warning_threshold_minutes: warningThreshold,
    delay_threshold_minutes: delayThreshold,
    updated_at: new Date().toISOString(),
    updated_by: userId
  });

  if (settingsError) return { status: "error", message: settingsError.message };

  const sizeRows = getIndexedStrings(formData, "sizes").map((index) => ({
    pizza_size_id: getString(formData, `sizes[${index}][pizza_size_id]`),
    simultaneous_capacity: getInteger(formData, `sizes[${index}][simultaneous_capacity]`, 1),
    assembly_minutes: getInteger(formData, `sizes[${index}][assembly_minutes]`, 2),
    baking_minutes: getInteger(formData, `sizes[${index}][baking_minutes]`, 8),
    finishing_minutes: getInteger(formData, `sizes[${index}][finishing_minutes]`, 1),
    updated_at: new Date().toISOString(),
    updated_by: userId
  }));

  if (sizeRows.some((row) => !row.pizza_size_id)) return { status: "error", message: "Tamano de pizza no valido." };
  if (sizeRows.some((row) => row.simultaneous_capacity <= 0 || row.baking_minutes <= 0)) {
    return { status: "error", message: "Cada tamano necesita capacidad y horneado mayores a cero." };
  }

  if (sizeRows.length > 0) {
    const { error: sizesError } = await supabase.from("kitchen_size_settings").upsert(sizeRows, { onConflict: "pizza_size_id" });
    if (sizesError) return { status: "error", message: sizesError.message };
  }

  revalidatePath("/panel/configuracion");
  revalidatePath("/panel/configuracion/cocina");
  revalidatePath("/panel/cocina");
  return { status: "success", message: "Configuracion de cocina guardada correctamente." };
}

export async function savePublicBusinessSettings(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const supabase = await createServerSupabaseClient();
  await requireUserPermission(supabase, "usuarios_permisos.manage");

  const businessName = getString(formData, "business_name");
  const whatsappNumber = getString(formData, "whatsapp_number").replace(/\D/g, "");
  let openingHours: Array<{ day: string; is_open: boolean; opens_at: string; closes_at: string }>;
  try {
    openingHours = JSON.parse(getString(formData, "opening_hours"));
  } catch {
    return { status: "error", message: "Los horarios no son validos." };
  }
  if (!businessName) return { status: "error", message: "Ingresa el nombre comercial." };
  if (!whatsappNumber || whatsappNumber.length < 10) return { status: "error", message: "Ingresa un WhatsApp valido con indicativo de pais." };
  if (!Array.isArray(openingHours) || openingHours.length !== 7 || openingHours.some((item) => !item || typeof item.day !== "string" || typeof item.is_open !== "boolean" || (item.is_open && (!/^\d{2}:\d{2}$/.test(item.opens_at) || !/^\d{2}:\d{2}$/.test(item.closes_at))))) {
    return { status: "error", message: "Revisa los horarios configurados." };
  }

  const { error } = await supabase
    .from("site_settings")
    .update({
      business_name: businessName,
      whatsapp_number: whatsappNumber,
      public_phone: getOptionalString(formData, "public_phone"),
      public_address: getOptionalString(formData, "public_address"),
      public_neighborhood: getOptionalString(formData, "public_neighborhood"),
      public_city: getOptionalString(formData, "public_city"),
      public_weekday_hours: getOptionalString(formData, "public_weekday_hours"),
      public_weekend_hours: getOptionalString(formData, "public_weekend_hours"),
      public_maps_url: getOptionalString(formData, "public_maps_url"),
      public_info_text: getOptionalString(formData, "public_info_text"),
      public_instagram_url: getOptionalString(formData, "public_instagram_url"),
      public_facebook_url: getOptionalString(formData, "public_facebook_url"),
      public_opening_hours: openingHours
    })
    .eq("id", true);
  if (error) return { status: "error", message: error.message };

  revalidatePath("/");
  revalidatePath("/panel/configuracion/negocio");
  return { status: "success", message: "Informacion publica actualizada." };
}

async function requireUserPermission(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>, permissionCode: string) {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Debes iniciar sesion.");

  const { data, error } = await supabase.rpc("current_user_has_permission", { p_permission_code: permissionCode });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("No tienes permisos para realizar esta accion.");
  return user;
}

function getRoleInputs(formData: FormData, fallbackRole?: string) {
  const roles = getJsonStringArray(formData, "roles").filter((role) => validRoles.has(role));
  if (roles.length > 0) return roles;
  const role = fallbackRole ?? getString(formData, "role");
  return validRoles.has(role) ? [role] : [];
}

export async function registerSystemUser(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const supabase = await createServerSupabaseClient();
  await requireUserPermission(supabase, "usuarios_permisos.manage");

  const email = getString(formData, "email").toLowerCase();
  const fullName = upperText(getString(formData, "full_name"));
  const phone = getOptionalString(formData, "phone");
  const password = getString(formData, "password");
  const passwordConfirmation = getString(formData, "password_confirmation");
  const roles = getRoleInputs(formData);
  const isActive = getBoolean(formData, "is_active");
  const profileImage = getFormFile(formData, "profile_image");

  if (!email || !email.includes("@")) return { status: "error", message: "Ingresa un correo valido." };
  if (!fullName) return { status: "error", message: "Ingresa el nombre del usuario." };
  if (roles.length !== 1) return { status: "error", message: "Selecciona un rol principal." };
  if (password.length < 8) return { status: "error", message: "La contrasena debe tener al menos 8 caracteres." };
  if (password !== passwordConfirmation) return { status: "error", message: "Las contrasenas no coinciden." };

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return {
      status: "error",
      message: "El registro de usuarios no esta disponible temporalmente. Contacta al administrador tecnico."
    };
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, phone }
  });
  if (error || !data.user) return { status: "error", message: error?.message ?? "No se pudo registrar el usuario." };

  const removeCreatedAuthUser = async () => {
    await admin.from("profiles").delete().eq("id", data.user!.id);
    await admin.auth.admin.deleteUser(data.user!.id);
  };

  const { error: profileError } = await admin.from("profiles").upsert({
    id: data.user.id,
    email,
    full_name: fullName,
    phone,
    is_active: isActive,
    account_type: "staff",
    updated_at: new Date().toISOString()
  });
  if (profileError) {
    await removeCreatedAuthUser();
    return { status: "error", message: profileError.message };
  }

  let uploadedProfileImage: string | null = null;
  if (profileImage) {
    try {
      uploadedProfileImage = await uploadProfileImage(supabase, profileImage, data.user.id);
      const { error: avatarError } = await admin.from("profiles").update({ avatar_url: uploadedProfileImage, updated_at: new Date().toISOString() }).eq("id", data.user.id);
      if (avatarError) throw new Error(avatarError.message);
    } catch (error) {
      await removeProfileImage(supabase, uploadedProfileImage);
      await removeCreatedAuthUser();
      return { status: "error", message: error instanceof Error ? error.message : "No se pudo guardar la foto de perfil." };
    }
  }

  const { error: roleError } = await supabase.rpc("admin_set_user_roles", {
    p_user_id: data.user.id,
    p_roles: roles
  });
  if (roleError) {
    await removeProfileImage(supabase, uploadedProfileImage);
    await removeCreatedAuthUser();
    return { status: "error", message: roleError.message };
  }

  const { error: moduleAccessError } = await supabase.rpc("admin_set_user_module_access", {
    p_user_id: data.user.id,
    p_module_keys: getJsonStringArray(formData, "module_access")
  });
  if (moduleAccessError) {
    await removeProfileImage(supabase, uploadedProfileImage);
    await removeCreatedAuthUser();
    return { status: "error", message: moduleAccessError.message };
  }

  revalidatePath("/panel");
  revalidatePath("/panel/configuracion");
  return { status: "success", message: "Usuario registrado correctamente." };
}

export async function updateSystemUser(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const supabase = await createServerSupabaseClient();
  await requireUserPermission(supabase, "usuarios_permisos.manage");

  const userId = getString(formData, "user_id");
  const accountType = getString(formData, "account_type") === "client" ? "client" : "staff";
  const roles = getRoleInputs(formData);
  const password = getString(formData, "password");
  const passwordConfirmation = getString(formData, "password_confirmation");
  const profileImage = getFormFile(formData, "profile_image");
  const shouldRemoveProfileImage = getString(formData, "remove_profile_image") === "1";
  if (!userId) return { status: "error", message: "Usuario no valido." };
  if (accountType === "staff" && roles.length !== 1) return { status: "error", message: "Selecciona un rol principal." };
  if (password || passwordConfirmation) {
    if (password.length < 8) return { status: "error", message: "La contrasena debe tener al menos 8 caracteres." };
    if (password !== passwordConfirmation) return { status: "error", message: "Las contrasenas no coinciden." };
  }

  const { data: currentProfile, error: currentProfileError } = await supabase.from("profiles").select("avatar_url").eq("id", userId).single();
  if (currentProfileError) return { status: "error", message: currentProfileError.message };
  const previousAvatarUrl = currentProfile.avatar_url;
  let nextAvatarUrl = shouldRemoveProfileImage ? null : previousAvatarUrl;
  let uploadedProfileImage: string | null = null;
  if (profileImage) {
    try {
      uploadedProfileImage = await uploadProfileImage(supabase, profileImage, userId);
      nextAvatarUrl = uploadedProfileImage;
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : "No se pudo subir la foto de perfil." };
    }
  }

  const { error: profileError } = await supabase.rpc("admin_update_user_profile", {
    p_user_id: userId,
    p_full_name: upperText(getString(formData, "full_name")),
    p_phone: getOptionalString(formData, "phone"),
    p_is_active: getBoolean(formData, "is_active"),
    p_account_type: accountType
  });
  if (profileError) {
    await removeProfileImage(supabase, uploadedProfileImage);
    return { status: "error", message: profileError.message };
  }

  if (accountType === "staff") {
    const { error: roleError } = await supabase.rpc("admin_set_user_roles", {
      p_user_id: userId,
      p_roles: roles
    });
    if (roleError) {
      await removeProfileImage(supabase, uploadedProfileImage);
      return { status: "error", message: roleError.message };
    }

    const { error: moduleAccessError } = await supabase.rpc("admin_set_user_module_access", {
      p_user_id: userId,
      p_module_keys: getJsonStringArray(formData, "module_access")
    });
    if (moduleAccessError) {
      await removeProfileImage(supabase, uploadedProfileImage);
      return { status: "error", message: moduleAccessError.message };
    }
  }

  if (password) {
    const admin = createSupabaseAdminClient();
    if (!admin) {
      await removeProfileImage(supabase, uploadedProfileImage);
      return { status: "error", message: "El cambio de contrasena no esta disponible temporalmente. Contacta al administrador tecnico." };
    }
    const { error: passwordError } = await admin.auth.admin.updateUserById(userId, { password });
    if (passwordError) {
      await removeProfileImage(supabase, uploadedProfileImage);
      return { status: "error", message: passwordError.message };
    }
  }

  if (nextAvatarUrl !== previousAvatarUrl) {
    const { error: avatarError } = await supabase.from("profiles").update({ avatar_url: nextAvatarUrl, updated_at: new Date().toISOString() }).eq("id", userId);
    if (avatarError) {
      await removeProfileImage(supabase, uploadedProfileImage);
      return { status: "error", message: avatarError.message };
    }
  }

  if (previousAvatarUrl && previousAvatarUrl !== nextAvatarUrl) await removeProfileImage(supabase, previousAvatarUrl);

  revalidatePath("/panel");
  revalidatePath("/panel/configuracion");
  return { status: "success", message: "Usuario actualizado correctamente." };
}

export async function saveSystemRole(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const supabase = await createServerSupabaseClient();
  await requireUserPermission(supabase, "usuarios_permisos.manage");

  const role = getString(formData, "role");
  if (!validRoles.has(role)) return { status: "error", message: "Rol no valido." };

  const permissions = getJsonStringArray(formData, "permissions");
  const isSystemAdmin = role === "admin_sistema";
  const { error: roleError } = await supabase
    .from("app_roles")
    .update({
      name: upperText(getString(formData, "name")),
      description: getOptionalString(formData, "description"),
      is_active: isSystemAdmin ? true : getBoolean(formData, "is_active"),
      updated_at: new Date().toISOString()
    })
    .eq("role", role);
  if (roleError) return { status: "error", message: roleError.message };

  const { error } = await supabase.rpc("admin_save_role_permissions", {
    p_role: role,
    p_permission_codes: permissions
  });
  if (error) return { status: "error", message: error.message };

  revalidatePath("/panel");
  revalidatePath("/panel/configuracion");
  return { status: "success", message: "Rol y permisos actualizados correctamente." };
}

export async function saveUserPermissionOverrides(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const supabase = await createServerSupabaseClient();
  await requireUserPermission(supabase, "usuarios_permisos.manage");

  const userId = getString(formData, "user_id");
  if (!userId) return { status: "error", message: "Usuario no valido." };

  const { error } = await supabase.rpc("admin_save_user_permission_overrides", {
    p_user_id: userId,
    p_allow: getJsonStringArray(formData, "allow"),
    p_deny: getJsonStringArray(formData, "deny")
  });
  if (error) return { status: "error", message: error.message };

  revalidatePath("/panel/configuracion");
  return { status: "success", message: "Permisos del usuario actualizados correctamente." };
}

export async function sendPasswordRecovery(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const supabase = await createServerSupabaseClient();
  await requireUserPermission(supabase, "usuarios_permisos.manage");

  const email = getString(formData, "email").toLowerCase();
  if (!email || !email.includes("@")) return { status: "error", message: "El usuario no tiene un correo valido." };
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  if (error) return { status: "error", message: error.message };
  return { status: "success", message: "Recuperacion enviada correctamente." };
}

function getJsonValue<T>(formData: FormData, key: string, fallback: T): T {
  const rawValue = getString(formData, key);
  if (!rawValue) return fallback;
  try {
    return JSON.parse(rawValue) as T;
  } catch {
    return fallback;
  }
}

function marketingStatus(value: string) {
  return ["draft", "active", "archived"].includes(value) ? value : "draft";
}

function promotionStatus(value: string) {
  return ["draft", "active", "paused", "expired"].includes(value) ? value : "draft";
}

function revalidateMarketing() {
  revalidatePath("/panel/marketing/pantallas");
  revalidatePath("/panel/marketing/promociones");
  revalidatePath("/panel/configuracion");
}

function revalidateCashAndExpenses() {
  revalidatePath("/panel/gastos");
  revalidatePath("/panel/gastos/categorias");
  revalidatePath("/panel/caja");
  revalidatePath("/panel/caja/movimientos");
  revalidatePath("/panel/caja/cierre");
  revalidatePath("/panel/pedidos");
  revalidatePath("/panel/pedidos/nuevo");
}

export async function saveExpenseCategory(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const supabase = await createServerSupabaseClient();
  await requireUserPermission(supabase, "gastos.categories");

  const id = getOptionalString(formData, "id");
  const name = upperText(getOptionalString(formData, "name")) ?? "";
  const description = upperText(getOptionalString(formData, "description"));
  const isActive = getBoolean(formData, "is_active");

  if (!name) return { status: "error", message: "Ingresa el nombre de la categoria." };

  const { data: existing, error: existingError } = await supabase.from("expense_categories").select("id, name");
  if (existingError) return { status: "error", message: existingError.message };
  const normalizedName = normalizeMasterText(name);
  const duplicate = (existing ?? []).find((item) => item.id !== id && normalizeMasterText(item.name ?? "") === normalizedName);
  if (duplicate) return { status: "error", message: "Esta categoria ya esta registrada." };

  if (id) {
    const { error } = await supabase
      .from("expense_categories")
      .update({ name, description, is_active: isActive, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return { status: "error", message: error.message };
  } else {
    const { data: maxOrder } = await supabase.from("expense_categories").select("sort_order").order("sort_order", { ascending: false }).limit(1).maybeSingle();
    const { error } = await supabase.from("expense_categories").insert({
      name,
      description,
      is_active: isActive,
      sort_order: Number(maxOrder?.sort_order ?? 0) + 1
    });
    if (error) return { status: "error", message: error.message };
  }

  revalidateCashAndExpenses();
  return { status: "success", message: id ? "Categoria actualizada correctamente." : "Categoria creada correctamente." };
}

export async function moveExpenseCategory(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const supabase = await createServerSupabaseClient();
  const id = getString(formData, "id");
  const direction = getString(formData, "direction");
  if (!id || !["up", "down"].includes(direction)) return { status: "error", message: "Movimiento no valido." };
  const { error } = await supabase.rpc("move_expense_category", { p_category_id: id, p_direction: direction });
  if (error) return { status: "error", message: error.message };
  revalidatePath("/panel/gastos/categorias");
  return { status: "success", message: "Orden actualizado." };
}

export async function deleteExpenseCategory(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const supabase = await createServerSupabaseClient();
  const id = getString(formData, "id");
  if (!id) return { status: "error", message: "Categoria no valida." };
  const { error } = await supabase.rpc("delete_expense_category", { p_category_id: id });
  if (error) return { status: "error", message: error.message };
  revalidateCashAndExpenses();
  return { status: "success", message: "Categoria eliminada correctamente." };
}

export async function registerExpenseAction(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const supabase = await createServerSupabaseClient();
  const categoryId = getString(formData, "category_id");
  const description = upperText(getString(formData, "description")) ?? "";
  const amountCop = getDecimal(formData, "amount_cop", 0);
  const paymentSource = getString(formData, "payment_source");
  const spentAt = getString(formData, "spent_at");

  if (!categoryId) return { status: "error", message: "Selecciona una categoria." };
  if (!description) return { status: "error", message: "Ingresa el concepto del gasto." };
  if (amountCop <= 0) return { status: "error", message: "Ingresa un valor mayor que cero." };
  if (!["cash_session", "bank_transfer", "custody_fund", "other"].includes(paymentSource)) {
    return { status: "error", message: "Selecciona el origen del pago." };
  }

  const { error } = await supabase.rpc("register_expense", {
    p_category_id: categoryId,
    p_description: description,
    p_amount_cop: amountCop,
    p_spent_at: spentAt ? new Date(spentAt).toISOString() : new Date().toISOString(),
    p_payment_source: paymentSource,
    p_supplier_id: getOptionalString(formData, "supplier_id"),
    p_beneficiary_name: upperText(getOptionalString(formData, "beneficiary_name")),
    p_document_number: upperText(getOptionalString(formData, "document_number")),
    p_notes: upperText(getOptionalString(formData, "notes")),
    p_receipt_url: getOptionalString(formData, "receipt_url"),
    p_custody_fund_id: getOptionalString(formData, "custody_fund_id")
  });
  if (error) return { status: "error", message: error.message };
  revalidateCashAndExpenses();
  return { status: "success", message: "Gasto registrado correctamente." };
}

export async function voidExpenseAction(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const supabase = await createServerSupabaseClient();
  const id = getString(formData, "id");
  const reason = upperText(getOptionalString(formData, "reason")) ?? "ANULACION";
  if (!id) return { status: "error", message: "Gasto no valido." };
  const { error } = await supabase.rpc("void_expense", { p_expense_id: id, p_reason: reason });
  if (error) return { status: "error", message: error.message };
  revalidateCashAndExpenses();
  return { status: "success", message: "Gasto anulado correctamente." };
}

export async function openCashSessionAction(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const supabase = await createServerSupabaseClient();
  const openingCashCop = getDecimal(formData, "opening_cash_cop", 0);
  if (openingCashCop < 0) return { status: "error", message: "La base inicial no puede ser negativa." };
  const { error } = await supabase.rpc("open_cash_session", {
    p_opening_cash_cop: openingCashCop,
    p_cash_register_id: getOptionalString(formData, "cash_register_id")
  });
  if (error) return { status: "error", message: error.message };
  revalidateCashAndExpenses();
  return { status: "success", message: "Caja abierta correctamente." };
}

export async function registerCashMovementAction(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const supabase = await createServerSupabaseClient();
  const sessionId = getString(formData, "cash_session_id");
  const movementKind = getString(formData, "movement_kind");
  const amountCop = getDecimal(formData, "amount_cop", 0);
  if (!sessionId) return { status: "error", message: "No hay una caja abierta seleccionada." };
  if (!["manual_income", "manual_out", "withdrawal"].includes(movementKind)) return { status: "error", message: "Tipo de movimiento no valido." };
  if (amountCop <= 0) return { status: "error", message: "Ingresa un valor mayor que cero." };
  const { error } = await supabase.rpc("register_cash_movement", {
    p_cash_session_id: sessionId,
    p_movement_kind: movementKind,
    p_amount_cop: amountCop,
    p_destination: getString(formData, "destination"),
    p_reason: upperText(getString(formData, "reason"))
  });
  if (error) return { status: "error", message: error.message };
  revalidateCashAndExpenses();
  return { status: "success", message: "Movimiento registrado correctamente." };
}

export async function recordCashCountAction(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const supabase = await createServerSupabaseClient();
  const sessionId = getString(formData, "cash_session_id");
  const countedCashCop = getDecimal(formData, "counted_cash_cop", 0);
  if (!sessionId) return { status: "error", message: "No hay una caja abierta seleccionada." };
  const { error } = await supabase.rpc("record_cash_count", {
    p_cash_session_id: sessionId,
    p_counted_cash_cop: countedCashCop,
    p_notes: upperText(getOptionalString(formData, "notes"))
  });
  if (error) return { status: "error", message: error.message };
  revalidateCashAndExpenses();
  return { status: "success", message: "Arqueo registrado correctamente." };
}

export async function closeCashSessionAction(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const supabase = await createServerSupabaseClient();
  const sessionId = getString(formData, "cash_session_id");
  const countedCashCop = getDecimal(formData, "counted_cash_cop", 0);
  if (!sessionId) return { status: "error", message: "No hay una caja abierta seleccionada." };
  const { error } = await supabase.rpc("close_cash_session", {
    p_cash_session_id: sessionId,
    p_counted_cash_cop: countedCashCop,
    p_notes: upperText(getOptionalString(formData, "notes"))
  });
  if (error) return { status: "error", message: error.message };
  revalidateCashAndExpenses();
  return { status: "success", message: "Caja cerrada correctamente." };
}

export async function saveMarketingProject(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const supabase = await createServerSupabaseClient();
  const id = getOptionalString(formData, "id");
  await requireUserPermission(supabase, id ? "marketing_pantallas.edit" : "marketing_pantallas.create");

  const userResult = await supabase.auth.getUser();
  const userId = userResult.data.user?.id ?? null;
  const name = upperText(getString(formData, "name"));
  const width = getInteger(formData, "width_px", 1920);
  const height = getInteger(formData, "height_px", 1080);
  const scenes = getJsonValue<
    Array<{
      id?: string;
      name: string;
      sort_order: number;
      duration_seconds: number;
      background: Record<string, unknown>;
      transition: string;
      elements: unknown[];
    }>
  >(formData, "scenes", []);

  if (!name) return { status: "error", message: "Ingresa el nombre del proyecto." };
  if (width <= 0 || height <= 0) return { status: "error", message: "La resolucion debe ser mayor a cero." };
  if (scenes.length === 0) return { status: "error", message: "Agrega al menos una escena." };
  if (scenes.some((scene) => Number(scene.duration_seconds) <= 0)) return { status: "error", message: "Cada escena necesita duracion mayor a cero." };

  const durationTotal = scenes.reduce((sum, scene) => sum + Number(scene.duration_seconds ?? 0), 0);
  const payload = {
    name,
    resolution_preset: getString(formData, "resolution_preset") === "1280x720" ? "1280x720" : getString(formData, "resolution_preset") === "custom" ? "custom" : "1920x1080",
    width_px: width,
    height_px: height,
    orientation: height > width ? "portrait" : "landscape",
    duration_total_seconds: durationTotal,
    status: marketingStatus(getString(formData, "status")),
    updated_at: new Date().toISOString(),
    updated_by: userId
  };

  const query = id
    ? supabase.from("marketing_screen_projects").update(payload).eq("id", id).select("id").single()
    : supabase
        .from("marketing_screen_projects")
        .insert({ ...payload, created_by: userId })
        .select("id")
        .single();
  const { data: project, error } = await query;
  if (error || !project) return { status: "error", message: error?.message ?? "No se pudo guardar el proyecto." };

  const projectId = project.id;
  const { error: deleteError } = await supabase.from("marketing_screen_scenes").delete().eq("project_id", projectId);
  if (deleteError) return { status: "error", message: deleteError.message };

  const rows = scenes.map((scene, index) => ({
    project_id: projectId,
    name: upperText(String(scene.name || `Escena ${index + 1}`)),
    sort_order: index + 1,
    duration_seconds: Number(scene.duration_seconds || 8),
    background: scene.background && typeof scene.background === "object" ? scene.background : { type: "color", value: "#17120f" },
    transition: ["cut", "fade", "slide"].includes(scene.transition) ? scene.transition : "fade",
    elements: Array.isArray(scene.elements) ? scene.elements : []
  }));
  const { error: scenesError } = await supabase.from("marketing_screen_scenes").insert(rows);
  if (scenesError) return { status: "error", message: scenesError.message };

  revalidateMarketing();
  return { status: "success", message: "Proyecto guardado correctamente." };
}

export async function duplicateMarketingProject(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const supabase = await createServerSupabaseClient();
  await requireUserPermission(supabase, "marketing_pantallas.create");
  const id = getString(formData, "id");
  const name = upperText(getString(formData, "name"));
  if (!id || !name) return { status: "error", message: "Selecciona un proyecto y un nuevo nombre." };

  const [projectResult, scenesResult] = await Promise.all([
    supabase.from("marketing_screen_projects").select("resolution_preset, width_px, height_px, orientation, duration_total_seconds, status, export_settings").eq("id", id).single(),
    supabase.from("marketing_screen_scenes").select("name, sort_order, duration_seconds, background, transition, elements").eq("project_id", id).order("sort_order")
  ]);
  if (projectResult.error) return { status: "error", message: projectResult.error.message };
  if (scenesResult.error) return { status: "error", message: scenesResult.error.message };

  const userResult = await supabase.auth.getUser();
  const userId = userResult.data.user?.id ?? null;
  const { data: newProject, error } = await supabase
    .from("marketing_screen_projects")
    .insert({ ...projectResult.data, name, status: "draft", created_by: userId, updated_by: userId })
    .select("id")
    .single();
  if (error || !newProject) return { status: "error", message: error?.message ?? "No se pudo duplicar." };

  const rows = (scenesResult.data ?? []).map((scene) => ({ ...scene, project_id: newProject.id }));
  if (rows.length > 0) {
    const { error: scenesError } = await supabase.from("marketing_screen_scenes").insert(rows);
    if (scenesError) return { status: "error", message: scenesError.message };
  }
  revalidateMarketing();
  return { status: "success", message: "Proyecto duplicado correctamente." };
}

export async function deleteMarketingProject(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const supabase = await createServerSupabaseClient();
  await requireUserPermission(supabase, "marketing_pantallas.delete");
  const id = getString(formData, "id");
  if (!id) return { status: "error", message: "Proyecto no valido." };
  const { error } = await supabase.from("marketing_screen_projects").delete().eq("id", id);
  if (error) return { status: "error", message: error.message };
  revalidateMarketing();
  return { status: "success", message: "Proyecto eliminado correctamente." };
}

export async function saveMarketingPromotion(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const supabase = await createServerSupabaseClient();
  const id = getOptionalString(formData, "id");
  await requireUserPermission(supabase, id ? "marketing_promociones.edit" : "marketing_promociones.create");

  const userResult = await supabase.auth.getUser();
  const userId = userResult.data.user?.id ?? null;
  const name = upperText(getString(formData, "name"));
  const mainText = upperText(getString(formData, "main_text"));
  const previousImage = getOptionalString(formData, "previous_image_url");
  const removeImage = getBoolean(formData, "remove_image");
  const imageFile = getFormFile(formData, "image");
  let imageUrl = removeImage ? null : previousImage;

  if (!name) return { status: "error", message: "Ingresa el nombre de la promocion." };
  if (!mainText) return { status: "error", message: "Ingresa el texto principal." };

  try {
    if (imageFile) imageUrl = await uploadProductImage(supabase, imageFile, "marketing");
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "No se pudo subir la imagen." };
  }

  const payload = {
    name,
    image_url: imageUrl,
    main_text: mainText,
    secondary_text: upperText(getOptionalString(formData, "secondary_text")),
    normal_price_cop: getOptionalString(formData, "normal_price_cop") ? getDecimal(formData, "normal_price_cop", 0) : null,
    promo_price_cop: getOptionalString(formData, "promo_price_cop") ? getDecimal(formData, "promo_price_cop", 0) : null,
    starts_at: getOptionalString(formData, "starts_at"),
    ends_at: getOptionalString(formData, "ends_at"),
    status: promotionStatus(getString(formData, "status")),
    is_active: getBoolean(formData, "is_active"),
    updated_at: new Date().toISOString(),
    updated_by: userId
  };

  const query = id
    ? supabase.from("marketing_promotions").update(payload).eq("id", id).select("id").single()
    : supabase.from("marketing_promotions").insert({ ...payload, created_by: userId }).select("id").single();
  const { data: promotion, error } = await query;
  if (error || !promotion) return { status: "error", message: error?.message ?? "No se pudo guardar la promocion." };

  const promotionId = promotion.id;
  const pizzaPriceIds = getJsonStringArray(formData, "pizza_price_ids");
  const saleProductIds = getJsonStringArray(formData, "sale_product_ids");
  const projectIds = getJsonStringArray(formData, "project_ids");
  const [pizzaDelete, saleDelete, projectDelete] = await Promise.all([
    supabase.from("marketing_promotion_pizza_prices").delete().eq("promotion_id", promotionId),
    supabase.from("marketing_promotion_sale_products").delete().eq("promotion_id", promotionId),
    supabase.from("marketing_promotion_screen_projects").delete().eq("promotion_id", promotionId)
  ]);
  const relationError = pizzaDelete.error ?? saleDelete.error ?? projectDelete.error;
  if (relationError) return { status: "error", message: relationError.message };

  const inserts = [];
  if (pizzaPriceIds.length > 0) {
    inserts.push(supabase.from("marketing_promotion_pizza_prices").insert(pizzaPriceIds.map((pizza_price_config_id) => ({ promotion_id: promotionId, pizza_price_config_id }))));
  }
  if (saleProductIds.length > 0) {
    inserts.push(supabase.from("marketing_promotion_sale_products").insert(saleProductIds.map((inventory_item_id) => ({ promotion_id: promotionId, inventory_item_id }))));
  }
  if (projectIds.length > 0) {
    inserts.push(supabase.from("marketing_promotion_screen_projects").insert(projectIds.map((project_id) => ({ promotion_id: promotionId, project_id }))));
  }
  const results = await Promise.all(inserts);
  const insertError = results.find((result) => result.error)?.error;
  if (insertError) return { status: "error", message: insertError.message };

  if ((removeImage || imageFile) && previousImage && previousImage !== imageUrl) {
    await removeStoredImageIfUnreferenced(supabase, previousImage);
  }

  revalidateMarketing();
  return { status: "success", message: "Promocion guardada correctamente." };
}

export async function deleteMarketingPromotion(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const supabase = await createServerSupabaseClient();
  await requireUserPermission(supabase, "marketing_promociones.delete");
  const id = getString(formData, "id");
  if (!id) return { status: "error", message: "Promocion no valida." };
  const { data: promotion } = await supabase.from("marketing_promotions").select("image_url").eq("id", id).single();
  const { error } = await supabase.from("marketing_promotions").delete().eq("id", id);
  if (error) return { status: "error", message: error.message };
  await removeStoredImageIfUnreferenced(supabase, promotion?.image_url ?? null);
  revalidateMarketing();
  return { status: "success", message: "Promocion eliminada correctamente." };
}

export async function assignUserRole(formData: FormData) {
  const userId = getString(formData, "user_id");
  const role = getString(formData, "role");
  const supabase = await createServerSupabaseClient();
  if (!validRoles.has(role)) throw new Error("Rol no valido.");
  await requireUserPermission(supabase, "usuarios_permisos.manage");

  const { data: currentRoles, error: rolesError } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if (rolesError) throw new Error(rolesError.message);
  const roles = [...new Set([...(currentRoles?.map((item) => item.role) ?? []), role])];
  const { error } = await supabase.rpc("admin_set_user_roles", { p_user_id: userId, p_roles: roles });
  if (error) throw new Error(error.message);
  revalidatePath("/panel");
}

export async function removeUserRole(formData: FormData) {
  const userId = getString(formData, "user_id");
  const role = getString(formData, "role");
  const supabase = await createServerSupabaseClient();
  await requireUserPermission(supabase, "usuarios_permisos.manage");

  const { data: currentRoles, error: rolesError } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if (rolesError) throw new Error(rolesError.message);
  const roles = (currentRoles?.map((item) => item.role) ?? []).filter((item) => item !== role);
  const { error } = await supabase.rpc("admin_set_user_roles", { p_user_id: userId, p_roles: roles });
  if (error) throw new Error(error.message);
  revalidatePath("/panel");
}
