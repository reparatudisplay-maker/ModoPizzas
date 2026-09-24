"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { normalizeMasterText } from "@/lib/master-normalization";
import { parseColombianDecimal, parseColombianInteger } from "@/lib/number-format";
import { getAdjustedSourceStock } from "@/lib/inventory-stock";
import type { StockUnit } from "@/lib/units";

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

export type PosOrderTestDeletionPreview = {
  order_id: string;
  order_code: string;
  consumptions: Array<{
    allocation_id: string;
    consumption_id: string;
    order_item_id: string | null;
    order_item_addition_id: string | null;
    item_name: string;
    item_kind: "pizza" | "sale_product" | null;
    quantity_base: number;
    base_unit: StockUnit;
    cost_cop: number;
    source_kind: "inventory_item" | "preparation";
    source_name: string;
    purchase_item_id: string | null;
    production_batch_id: string | null;
    origin_label: string;
    combo_name: string | null;
  }>;
};

export type PosOrderTestDeletionPreviewState = {
  status: "success" | "error";
  message: string;
  preview?: PosOrderTestDeletionPreview;
};

export type PosInventoryConsumptionPreview = {
  status: "ok" | "insufficient";
  shortages: PosStockShortage[];
  consolidated: Array<{
    source_kind: "inventory_item" | "preparation";
    source_id: string;
    source_name: string;
    unit: StockUnit;
    stock_before: number;
    consumption_quantity: number;
    stock_after: number;
    origins: Array<{
      origin_label: string;
      purchase_item_id: string | null;
      production_batch_id: string | null;
      purchased_at: string | null;
      purchase_expiration_date: string | null;
      elaborated_at: string | null;
      production_expiration_date: string | null;
      stock_before: number;
      consumption_quantity: number;
      stock_after: number;
    }>;
  }>;
  lines: Array<{
    order_item_id: string;
    item_kind: "pizza" | "sale_product";
    name: string;
    quantity: number;
    cart_line_key: string | null;
    notes: string | null;
    consumptions: Array<{
      source_name: string;
      source_kind: "inventory_item" | "preparation";
      source_id: string;
      quantity_base: number;
      base_unit: StockUnit;
      origin_label: string;
      purchase_item_id: string | null;
      production_batch_id: string | null;
      purchased_at: string | null;
      purchase_expiration_date: string | null;
      elaborated_at: string | null;
      production_expiration_date: string | null;
      origin_stock_before: number;
      origin_consumption: number;
      origin_stock_after: number;
    }>;
  }>;
};

export type PosInventoryConsumptionPreviewState = {
  status: "success" | "error";
  message: string;
  preview?: PosInventoryConsumptionPreview;
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

type PosComboCartChoice = {
  variant_id?: string;
  applied_variant_id?: string;
  applied_variant_name?: string;
  group_id: string;
  option_id: string;
  kind: "pizza" | "sale_product";
  id: string;
  name: string;
  unit_price_cop: number;
  line_key?: string;
};

type PosComboCartItem = {
  line_key?: string;
  kind: "combo";
  id: string;
  quantity: number;
  unit_price_cop: number;
  combo_choices?: PosComboCartChoice[];
  combo_normal_price_cop?: number;
  combo_savings_cop?: number;
};

type PosComboComponentCartItem = {
  line_key?: string;
  kind: "pizza" | "sale_product";
  id: string;
  quantity?: number;
  unit_price_cop?: number;
  combo_instance_id?: string | null;
  combo_config_id?: string | null;
  combo_choices?: PosComboCartChoice[];
  combo_unit_price_cop?: number;
  combo_normal_price_cop?: number;
  combo_savings_cop?: number;
  combo_component_normal_price_cop?: number;
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

function getStockUnitFromValue(value: unknown): StockUnit {
  return value === "g" || value === "kg" || value === "ml" || value === "l" || value === "unit" ? value : "unit";
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
  const tables = ["inventory_items", "preparations", "pizza_flavors", "combo_configs"] as const;
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
  revalidatePath("/panel/menu/precios/combos");
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
      const [productionAllocationsResult, posAllocationsResult] = await Promise.all([
        supabase
          .from("production_consumption_allocations")
          .select("quantity_base, base_unit")
          .in("purchase_item_id", itemIds),
        supabase
          .from("pos_order_consumption_allocations")
          .select("quantity_base, base_unit, pos_order_consumptions!inner(pos_orders!inner(status))")
          .in("purchase_item_id", itemIds)
          .neq("pos_order_consumptions.pos_orders.status", "cancelled")
      ]);
      if (productionAllocationsResult.error) throw new Error(productionAllocationsResult.error.message);
      if (posAllocationsResult.error) throw new Error(posAllocationsResult.error.message);
      stock -= [...(productionAllocationsResult.data ?? []), ...(posAllocationsResult.data ?? [])].reduce(
        (sum, allocation) => sum + convertStockQuantity(Number(allocation.quantity_base ?? 0), allocation.base_unit, baseUnit),
        0
      );
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
      const [productionAllocationsResult, posAllocationsResult] = await Promise.all([
        supabase
          .from("production_consumption_allocations")
          .select("quantity_base, base_unit")
          .in("production_batch_id", batchIds),
        supabase
          .from("pos_order_consumption_allocations")
          .select("quantity_base, base_unit, pos_order_consumptions!inner(pos_orders!inner(status))")
          .in("production_batch_id", batchIds)
          .neq("pos_order_consumptions.pos_orders.status", "cancelled")
      ]);
      if (productionAllocationsResult.error) throw new Error(productionAllocationsResult.error.message);
      if (posAllocationsResult.error) throw new Error(posAllocationsResult.error.message);
      stock -= [...(productionAllocationsResult.data ?? []), ...(posAllocationsResult.data ?? [])].reduce(
        (sum, allocation) => sum + convertStockQuantity(Number(allocation.quantity_base ?? 0), allocation.base_unit, baseUnit),
        0
      );
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
  const alternativePreparationId = getString(formData, "alternative_preparation_id");
  const alternativeQuantity = getDecimal(formData, "alternative_preparation_quantity", 0);
  const alternativeDisplayUnit = getStockUnit(formData, "alternative_preparation_unit");
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

  let alternativePreparationQuantityBase: number | null = null;
  let alternativePreparationUnit: string | null = null;
  if (alternativePreparationId) {
    if (alternativeQuantity <= 0) return { status: "error", message: "Ingresa la cantidad de masa producida alternativa." };
    const { data, error } = await supabase.from("preparations").select("id, base_unit, is_active").eq("id", alternativePreparationId).single();
    if (error || !data?.is_active) return { status: "error", message: error?.message ?? "La masa producida alternativa no esta disponible." };
    alternativePreparationUnit = canonicalStockUnit(data.base_unit);
    if (canonicalStockUnit(alternativeDisplayUnit) !== alternativePreparationUnit) return { status: "error", message: "La unidad de la masa producida alternativa no es compatible." };
    alternativePreparationQuantityBase = convertStockQuantity(alternativeQuantity, alternativeDisplayUnit, alternativePreparationUnit as StockUnit);
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
    alternative_preparation_id: alternativePreparationId || null,
    alternative_preparation_quantity_base: alternativePreparationQuantityBase,
    alternative_preparation_unit: alternativePreparationUnit,
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

type ComboGroupInput = {
  id?: string | null;
  name?: string;
  group_kind?: "pizza" | "sale_product";
  quantity_to_choose?: number;
  is_required?: boolean;
  pizza_size_id?: string | null;
  allow_all_flavors?: boolean;
  sort_order?: number;
  options?: Array<{
    id?: string | null;
    pizza_flavor_id?: string | null;
    inventory_item_id?: string | null;
    is_active?: boolean;
    sort_order?: number;
  }>;
};

type ComboVariantInput = {
  id?: string | null;
  name?: string;
  sale_price_cop?: number;
  sort_order?: number;
  is_active?: boolean;
  groups?: ComboGroupInput[];
};

function parseComboGroups(rawValue: string) {
  try {
    const parsed = JSON.parse(rawValue) as ComboGroupInput[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((group, groupIndex) => ({
      id: group.id || null,
      name: upperText(String(group.name ?? "").trim()) ?? "",
      group_kind: group.group_kind === "sale_product" ? "sale_product" as const : "pizza" as const,
      quantity_to_choose: Math.max(1, Math.round(Number(group.quantity_to_choose ?? 1))),
      is_required: group.is_required !== false,
      pizza_size_id: group.group_kind === "sale_product" ? null : group.pizza_size_id || null,
      allow_all_flavors: group.group_kind === "pizza" ? Boolean(group.allow_all_flavors) : false,
      sort_order: Number.isFinite(Number(group.sort_order)) ? Number(group.sort_order) : groupIndex,
      options: Array.isArray(group.options)
        ? group.options.map((option, optionIndex) => ({
            id: option.id || null,
            pizza_flavor_id: option.pizza_flavor_id || null,
            inventory_item_id: option.inventory_item_id || null,
            is_active: option.is_active !== false,
            sort_order: Number.isFinite(Number(option.sort_order)) ? Number(option.sort_order) : optionIndex
          }))
        : []
    }));
  } catch {
    return [];
  }
}

function parseComboVariants(rawValue: string) {
  try {
    const parsed = JSON.parse(rawValue) as ComboVariantInput[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((variant, variantIndex) => ({
      id: variant.id || null,
      name: upperText(String(variant.name ?? `GRUPO ${variantIndex + 1}`).trim()),
      sale_price_cop: Math.max(0, Math.round(Number(variant.sale_price_cop ?? 0))),
      sort_order: Number.isFinite(Number(variant.sort_order)) ? Number(variant.sort_order) : variantIndex,
      is_active: variant.is_active !== false,
      groups: parseComboGroups(JSON.stringify(variant.groups ?? []))
    }));
  } catch {
    return [];
  }
}

export async function saveComboConfig(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", message: "Debes iniciar sesion." };

  const id = getString(formData, "id");
  const name = upperText(getString(formData, "name"));
  const description = upperText(getOptionalString(formData, "description"));
  const sortOrder = getInteger(formData, "sort_order", 0);
  const isActive = getBoolean(formData, "is_active");
  const variants = parseComboVariants(getString(formData, "variants_payload"));
  const imageFile = getFormFile(formData, "image");

  if (!name) return { status: "error", message: "Ingresa el nombre del combo." };
  if (variants.length === 0) return { status: "error", message: "Configura al menos un grupo de precio." };
  if (variants.some((variant) => !variant.name || variant.sale_price_cop <= 0)) return { status: "error", message: "Cada grupo de sabores necesita nombre y precio fijo." };
  for (const variant of variants) {
    if (variant.groups.length === 0) return { status: "error", message: `${variant.name} no tiene componentes.` };
    for (const group of variant.groups) {
      if (!group.name) return { status: "error", message: "Cada componente debe tener nombre." };
      if (group.group_kind === "pizza" && !group.pizza_size_id) return { status: "error", message: `Selecciona el tamano para ${group.name}.` };
      if (!group.allow_all_flavors && group.options.length < group.quantity_to_choose) return { status: "error", message: `${group.name} no tiene suficientes opciones.` };
      if (group.group_kind === "sale_product" && group.options.length < group.quantity_to_choose) return { status: "error", message: `${group.name} no tiene suficientes productos.` };
    }
  }

  try {
    const previous = id
      ? await supabase.from("combo_configs").select("image_url, sku").eq("id", id).maybeSingle()
      : { data: null, error: null };
    if (previous.error) return { status: "error", message: previous.error.message };

    let imageUrl = previous.data?.image_url ?? null;
    if (imageFile) imageUrl = await uploadProductImage(supabase, imageFile, "combos");

    let sku = previous.data?.sku ?? null;
    if (!id) {
      const { data: nextSku, error: skuError } = await supabase.rpc("reserve_combo_sku", { p_name: name });
      if (skuError) return { status: "error", message: skuError.message };
      sku = String(nextSku);
    }

    const comboResult = id
      ? await supabase
          .from("combo_configs")
          .update({ sku, name, description, image_url: imageUrl, sale_price_cop: Math.min(...variants.map((variant) => variant.sale_price_cop)), is_active: isActive, sort_order: sortOrder })
          .eq("id", id)
          .select("id")
          .single()
      : await supabase
          .from("combo_configs")
          .insert({ sku, name, description, image_url: imageUrl, sale_price_cop: Math.min(...variants.map((variant) => variant.sale_price_cop)), is_active: isActive, sort_order: sortOrder, created_by: user.id })
          .select("id")
          .single();
    if (comboResult.error) return { status: "error", message: comboResult.error.message };
    const comboId = comboResult.data.id;

    const { error: deleteGroupsError } = await supabase.from("combo_groups").delete().eq("combo_id", comboId);
    if (deleteGroupsError) return { status: "error", message: deleteGroupsError.message };
    const { error: deleteVariantsError } = await supabase.from("combo_variants").delete().eq("combo_config_id", comboId);
    if (deleteVariantsError) return { status: "error", message: deleteVariantsError.message };
    for (const variant of variants) {
      const variantResult = await supabase.from("combo_variants").insert({ combo_config_id: comboId, name: variant.name, sale_price_cop: variant.sale_price_cop, sort_order: variant.sort_order, is_active: variant.is_active }).select("id").single();
      if (variantResult.error) return { status: "error", message: variantResult.error.message };
      for (const group of variant.groups) {
        const groupResult = await supabase.from("combo_groups").insert({ combo_id: comboId, variant_id: variantResult.data.id, name: group.name, group_kind: group.group_kind, quantity_to_choose: group.quantity_to_choose, is_required: group.is_required, pizza_size_id: group.pizza_size_id, allow_all_flavors: group.allow_all_flavors, sort_order: group.sort_order }).select("id").single();
        if (groupResult.error) return { status: "error", message: groupResult.error.message };
        if (group.options.length > 0) {
          const optionResult = await supabase.from("combo_group_options").insert(group.options.map((option) => ({ group_id: groupResult.data.id, pizza_flavor_id: group.group_kind === "pizza" ? option.pizza_flavor_id : null, inventory_item_id: group.group_kind === "sale_product" ? option.inventory_item_id : null, is_active: option.is_active, sort_order: option.sort_order })));
          if (optionResult.error) return { status: "error", message: optionResult.error.message };
        }
      }
    }

    if (imageFile && previous.data?.image_url && previous.data.image_url !== imageUrl) await removeStoredImageIfUnreferenced(supabase, previous.data.image_url);
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "No se pudo guardar el combo." };
  }

  revalidateInventory();
  return { status: "success", message: "Combo guardado correctamente." };
}

export async function deleteComboConfig(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const supabase = await createServerSupabaseClient();
  const id = getString(formData, "id");
  if (!id) return { status: "error", message: "Selecciona un combo valido." };

  const { count, error: countError } = await supabase.from("pos_order_combo_snapshots").select("id", { count: "exact", head: true }).eq("combo_config_id", id);
  if (countError) return { status: "error", message: countError.message };
  if ((count ?? 0) > 0) {
    const { error } = await supabase.from("combo_configs").update({ is_active: false }).eq("id", id);
    if (error) return { status: "error", message: error.message };
    revalidateInventory();
    return { status: "success", message: "Combo inactivado porque ya tiene ventas historicas." };
  }

  const { data: combo, error: comboError } = await supabase.from("combo_configs").select("image_url").eq("id", id).maybeSingle();
  if (comboError) return { status: "error", message: comboError.message };
  const { error } = await supabase.from("combo_configs").delete().eq("id", id);
  if (error) return { status: "error", message: error.message };
  await removeStoredImageIfUnreferenced(supabase, combo?.image_url ?? null);
  revalidateInventory();
  return { status: "success", message: "Combo eliminado correctamente." };
}

function isComboCartItem(item: unknown): item is PosComboCartItem {
  return Boolean(item && typeof item === "object" && (item as { kind?: unknown }).kind === "combo");
}

function isComboComponentCartItem(item: unknown): item is PosComboComponentCartItem {
  if (!item || typeof item !== "object") return false;
  const record = item as { kind?: unknown; combo_instance_id?: unknown; combo_config_id?: unknown };
  return (record.kind === "pizza" || record.kind === "sale_product") && typeof record.combo_instance_id === "string" && typeof record.combo_config_id === "string";
}

async function expandComboItemsForPos(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  items: unknown[]
) {
  const expandedItems: unknown[] = [];
  const snapshots: Array<{
    combo_config_id: string;
    cart_line_key: string | null;
    sku: string | null;
    name: string;
    quantity: number;
    unit_price_cop: number;
    normal_price_cop: number;
    savings_cop: number;
    choices: PosComboCartChoice[];
  }> = [];
  const comboComponentItems = items.filter(isComboComponentCartItem);
  const processedComboComponentKeys = new Set<string>();

  for (const item of comboComponentItems) {
    if (!item.combo_instance_id || processedComboComponentKeys.has(item.combo_instance_id)) continue;
    const components = comboComponentItems.filter((component) => component.combo_instance_id === item.combo_instance_id);
    components.forEach((component) => processedComboComponentKeys.add(component.combo_instance_id!));
    const choices = Array.isArray(item.combo_choices) ? item.combo_choices : [];
    if (!item.combo_config_id || choices.length === 0) throw new Error("Selecciona las opciones del combo.");

    const { data: combo, error: comboError } = await supabase
      .from("combo_configs")
      .select("id, sku, name, sale_price_cop, is_active, combo_variants(id, name, sale_price_cop, is_active, combo_groups(id, name, group_kind, quantity_to_choose, is_required, pizza_size_id, sort_order, combo_group_options(id, pizza_flavor_id, inventory_item_id, is_active)))")
      .eq("id", item.combo_config_id)
      .maybeSingle();
    if (comboError) throw new Error(comboError.message);
    if (!combo || !combo.is_active) throw new Error("El combo ya no esta activo.");

    const allGroups = (combo.combo_variants ?? []).flatMap((candidate) =>
      (candidate.combo_groups ?? []).map((group) => ({ candidate, group }))
    );
    const selectedPizzaSources = choices.flatMap((choice) => {
      const found = allGroups.find(({ group }) => group.id === choice.group_id && group.group_kind === "pizza");
      return found ? [found] : [];
    });
    const variant = selectedPizzaSources.sort((left, right) => Number(right.candidate.sale_price_cop ?? 0) - Number(left.candidate.sale_price_cop ?? 0))[0]?.candidate;
    if (!variant) throw new Error("Selecciona las pizzas del combo.");
    const groups = Array.isArray(variant.combo_groups) ? variant.combo_groups : [];
    const expectedChoices: PosComboCartChoice[] = [];
    for (const group of groups) {
      const selected = group.group_kind === "pizza"
        ? choices.filter((choice) => allGroups.some(({ group: sourceGroup }) => sourceGroup.id === choice.group_id && sourceGroup.group_kind === "pizza" && Number(sourceGroup.sort_order ?? 0) === Number(group.sort_order ?? 0)))
        : choices.filter((choice) => choice.group_id === group.id);
      if (group.is_required && selected.length !== Number(group.quantity_to_choose ?? 1)) throw new Error(`Selecciona ${group.quantity_to_choose} opcion(es) en ${group.name}.`);
      if (selected.length > Number(group.quantity_to_choose ?? 1)) throw new Error(`Hay demasiadas opciones en ${group.name}.`);
      for (const choice of selected) {
        const sourceGroup = allGroups.find(({ group: candidate }) => candidate.id === choice.group_id)?.group ?? group;
        const option = (sourceGroup.combo_group_options ?? []).find((candidate: { id: string; is_active: boolean }) => candidate.id === choice.option_id && candidate.is_active);
        if (!option) throw new Error(`Una opcion de ${group.name} ya no esta disponible.`);
        if (group.group_kind === "pizza") {
          const { data: price, error: priceError } = await supabase
            .from("pizza_price_configs")
            .select("id, sale_price_cop")
            .eq("flavor_id", option.pizza_flavor_id)
            .eq("size_id", group.pizza_size_id)
            .eq("is_active", true)
            .maybeSingle();
          if (priceError) throw new Error(priceError.message);
          if (!price) throw new Error(`La pizza seleccionada en ${group.name} no tiene precio activo.`);
          const sourceVariant = allGroups.find(({ group: candidate }) => candidate.id === sourceGroup.id)?.candidate;
          expectedChoices.push({ ...choice, variant_id: sourceVariant?.id ?? variant.id, applied_variant_id: variant.id, applied_variant_name: variant.name, kind: "pizza", id: price.id, unit_price_cop: Number(price.sale_price_cop ?? 0), line_key: choice.line_key });
        } else {
          const { data: product, error: productError } = await supabase
            .from("pos_sale_product_references")
            .select("id, sale_price_cop, sale_is_enabled")
            .eq("id", option.inventory_item_id)
            .maybeSingle();
          if (productError) throw new Error(productError.message);
          if (!product?.sale_is_enabled || Number(product.sale_price_cop ?? 0) <= 0) throw new Error(`El producto seleccionado en ${group.name} no esta vendible.`);
          expectedChoices.push({ ...choice, variant_id: variant.id, applied_variant_id: variant.id, applied_variant_name: variant.name, kind: "sale_product", id: product.id, unit_price_cop: Number(product.sale_price_cop ?? 0), line_key: choice.line_key });
        }
      }
    }

    const normalPriceCop = expectedChoices.reduce((sum, choice) => sum + choice.unit_price_cop, 0);
    const comboUnitPrice = Number(variant.sale_price_cop ?? combo.sale_price_cop ?? 0);
    const comboSavingsCop = Math.max(0, normalPriceCop - comboUnitPrice);
    const comboQuantity = Math.max(1, Math.round(Number(item.quantity ?? 1)));
    if (components.some((component) => Math.max(1, Math.round(Number(component.quantity ?? 1))) !== comboQuantity)) {
      throw new Error("Los componentes del combo deben conservar la misma cantidad.");
    }
    const weightedTotal = expectedChoices.reduce((sum, choice) => sum + Math.max(1, choice.unit_price_cop), 0);
    let allocated = 0;
    const expectedByLineKey = new Map<string, number>();
    expectedChoices.forEach((choice, index) => {
      const isLast = index === expectedChoices.length - 1;
      const netPrice = isLast ? comboUnitPrice - allocated : Math.round((comboUnitPrice * Math.max(1, choice.unit_price_cop)) / Math.max(1, weightedTotal));
      allocated += netPrice;
      if (choice.line_key) expectedByLineKey.set(choice.line_key, netPrice);
    });

    for (const [componentIndex, component] of components.entries()) {
      const expected = expectedChoices.find((choice) => choice.line_key === component.line_key) ?? expectedChoices.find((choice) => choice.kind === component.kind && choice.id === component.id);
      if (!expected) throw new Error("Los componentes del combo no coinciden con la configuracion vigente.");
      if (component.kind !== expected.kind || component.id !== expected.id) throw new Error("Los componentes del combo no coinciden con la configuracion vigente.");
      const netPrice = component.line_key && expectedByLineKey.has(component.line_key) ? expectedByLineKey.get(component.line_key)! : Math.max(0, Math.round(Number(component.unit_price_cop ?? 0)));
      const componentRecord = component as Record<string, unknown>;
      const componentNotes = typeof componentRecord.notes === "string" && componentRecord.notes ? componentRecord.notes : `COMBO ${combo.sku}`;
      expandedItems.push({
        ...componentRecord,
        combo_config_id: combo.id,
        combo_variant_id: variant.id,
        combo_normal_price_cop: normalPriceCop,
        combo_unit_price_cop: comboUnitPrice,
        combo_savings_cop: comboSavingsCop,
        combo_is_primary: componentIndex === 0,
        unit_price_cop: netPrice,
        notes: componentNotes
      });
    }

    snapshots.push({
      combo_config_id: combo.id,
      cart_line_key: item.combo_instance_id,
      sku: combo.sku,
      name: combo.name,
      quantity: comboQuantity,
      unit_price_cop: comboUnitPrice,
      normal_price_cop: normalPriceCop,
      savings_cop: comboSavingsCop,
      choices: expectedChoices.map((choice) => ({
        ...choice,
        combo_instance_id: item.combo_instance_id,
        component_line_keys: components.map((component) => component.line_key).filter(Boolean)
      })) as PosComboCartChoice[]
    });
  }

  for (const item of items) {
    if (isComboComponentCartItem(item)) continue;
    if (!isComboCartItem(item)) {
      expandedItems.push(item);
      continue;
    }

    const quantity = Math.max(1, Math.round(Number(item.quantity ?? 1)));
    const choices = Array.isArray(item.combo_choices) ? item.combo_choices : [];
    if (!item.id || choices.length === 0) throw new Error("Selecciona las opciones del combo.");

    const { data: combo, error: comboError } = await supabase
      .from("combo_configs")
      .select("id, sku, name, sale_price_cop, is_active, combo_variants(id, sale_price_cop, is_active, combo_groups(id, name, group_kind, quantity_to_choose, is_required, pizza_size_id, combo_group_options(id, pizza_flavor_id, inventory_item_id, is_active)))")
      .eq("id", item.id)
      .maybeSingle();
    if (comboError) throw new Error(comboError.message);
    if (!combo || !combo.is_active) throw new Error("El combo ya no esta activo.");

    const variant = (combo.combo_variants ?? []).find((candidate: { id: string }) => candidate.id === choices[0]?.variant_id) ?? combo.combo_variants?.[0];
    if (!variant) throw new Error("Selecciona un grupo de precio del combo.");
    const groups = Array.isArray(variant.combo_groups) ? variant.combo_groups : [];
    const expandedForCombo: Array<Record<string, unknown>> = [];
    const snapshotChoices: PosComboCartChoice[] = [];
    let normalPriceCop = 0;

    for (const group of groups) {
      const selected = choices.filter((choice) => choice.group_id === group.id);
      if (group.is_required && selected.length !== Number(group.quantity_to_choose ?? 1)) throw new Error(`Selecciona ${group.quantity_to_choose} opcion(es) en ${group.name}.`);
      if (selected.length > Number(group.quantity_to_choose ?? 1)) throw new Error(`Hay demasiadas opciones en ${group.name}.`);

      for (const choice of selected) {
        const option = (group.combo_group_options ?? []).find((candidate: { id: string; is_active: boolean }) => candidate.id === choice.option_id && candidate.is_active);
        if (!option) throw new Error(`Una opcion de ${group.name} ya no esta disponible.`);
        if (group.group_kind === "pizza") {
          const { data: price, error: priceError } = await supabase
            .from("pizza_price_configs")
            .select("id, sale_price_cop")
            .eq("flavor_id", option.pizza_flavor_id)
            .eq("size_id", group.pizza_size_id)
            .eq("is_active", true)
            .maybeSingle();
          if (priceError) throw new Error(priceError.message);
          if (!price) throw new Error(`La pizza seleccionada en ${group.name} no tiene precio activo.`);
          normalPriceCop += Number(price.sale_price_cop ?? 0);
          snapshotChoices.push({ ...choice, variant_id: variant.id, kind: "pizza", id: price.id, unit_price_cop: Number(price.sale_price_cop ?? 0) });
          expandedForCombo.push({
            line_key: `${item.line_key ?? crypto.randomUUID()}:${group.id}:${choice.option_id}`,
            kind: "pizza",
            id: price.id,
            secondary_id: null,
            quantity: 1,
            unit_price_cop: 0,
            notes: `COMBO ${combo.sku}`,
            removed_components: [],
            base_override: null,
            additions: []
          });
        } else {
          const { data: product, error: productError } = await supabase
            .from("pos_sale_product_references")
            .select("id, sale_price_cop, sale_is_enabled")
            .eq("id", option.inventory_item_id)
            .maybeSingle();
          if (productError) throw new Error(productError.message);
          if (!product?.sale_is_enabled || Number(product.sale_price_cop ?? 0) <= 0) throw new Error(`El producto seleccionado en ${group.name} no esta vendible.`);
          normalPriceCop += Number(product.sale_price_cop ?? 0);
          snapshotChoices.push({ ...choice, variant_id: variant.id, kind: "sale_product", id: product.id, unit_price_cop: Number(product.sale_price_cop ?? 0) });
          expandedForCombo.push({
            line_key: `${item.line_key ?? crypto.randomUUID()}:${group.id}:${choice.option_id}`,
            kind: "sale_product",
            id: product.id,
            quantity: 1,
            unit_price_cop: 0,
            notes: `COMBO ${combo.sku}`,
            additions: []
          });
        }
      }
    }

    const comboUnitPrice = Number(variant.sale_price_cop ?? combo.sale_price_cop ?? 0);
    const weightedTotal = expandedForCombo.reduce((sum, expanded, index) => sum + Math.max(1, snapshotChoices[index]?.unit_price_cop ?? 0), 0);
    let allocated = 0;
    const pricedItems = expandedForCombo.map((expanded, index) => {
      const isLast = index === expandedForCombo.length - 1;
      const weight = Math.max(1, snapshotChoices[index]?.unit_price_cop ?? 0);
      const unitPrice = isLast ? comboUnitPrice - allocated : Math.round((comboUnitPrice * weight) / weightedTotal);
      allocated += unitPrice;
      return { ...expanded, unit_price_cop: unitPrice, quantity };
    });
    expandedItems.push(...pricedItems);
    snapshots.push({
      combo_config_id: combo.id,
      cart_line_key: item.line_key ?? null,
      sku: combo.sku,
      name: combo.name,
      quantity,
      unit_price_cop: comboUnitPrice,
      normal_price_cop: normalPriceCop,
      savings_cop: Math.max(0, normalPriceCop - comboUnitPrice),
      choices: snapshotChoices
    });
  }

  return { expandedItems, snapshots };
}

function parsePreviewStockUnit(value: unknown): StockUnit {
  return value === "g" || value === "kg" || value === "ml" || value === "l" || value === "unit" ? value : "unit";
}

function parsePosInventoryConsumptionPreview(value: unknown): PosInventoryConsumptionPreview | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const status = raw.status === "insufficient" ? "insufficient" : raw.status === "ok" ? "ok" : null;
  if (!status) return null;
  const shortages = Array.isArray(raw.shortages) ? raw.shortages as PosStockShortage[] : [];
  const consolidated = (Array.isArray(raw.consolidated) ? raw.consolidated : []).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    if (typeof item.source_id !== "string" || typeof item.source_name !== "string") return [];
    return [{
      source_kind: item.source_kind === "preparation" ? "preparation" as const : "inventory_item" as const,
      source_id: item.source_id,
      source_name: item.source_name,
      unit: parsePreviewStockUnit(item.unit),
      stock_before: Number(item.stock_before ?? 0),
      consumption_quantity: Number(item.consumption_quantity ?? 0),
      stock_after: Number(item.stock_after ?? 0),
      origins: (Array.isArray(item.origins) ? item.origins : []).flatMap((origin) => {
        if (!origin || typeof origin !== "object") return [];
        const source = origin as Record<string, unknown>;
        return [{
          origin_label: String(source.origin_label ?? "Origen sin registro"),
          purchase_item_id: typeof source.purchase_item_id === "string" ? source.purchase_item_id : null,
          production_batch_id: typeof source.production_batch_id === "string" ? source.production_batch_id : null,
          purchased_at: typeof source.purchased_at === "string" ? source.purchased_at : null,
          purchase_expiration_date: typeof source.purchase_expiration_date === "string" ? source.purchase_expiration_date : null,
          elaborated_at: typeof source.elaborated_at === "string" ? source.elaborated_at : null,
          production_expiration_date: typeof source.production_expiration_date === "string" ? source.production_expiration_date : null,
          stock_before: Number(source.stock_before ?? 0),
          consumption_quantity: Number(source.consumption_quantity ?? 0),
          stock_after: Number(source.stock_after ?? 0)
        }];
      })
    }];
  });
  const lines = (Array.isArray(raw.lines) ? raw.lines : []).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    if (typeof item.order_item_id !== "string" || typeof item.name !== "string") return [];
    return [{
      order_item_id: item.order_item_id,
      item_kind: item.item_kind === "sale_product" ? "sale_product" as const : "pizza" as const,
      name: item.name,
      quantity: Number(item.quantity ?? 0),
      cart_line_key: typeof item.cart_line_key === "string" ? item.cart_line_key : null,
      notes: typeof item.notes === "string" ? item.notes : null,
      consumptions: (Array.isArray(item.consumptions) ? item.consumptions : []).flatMap((consumption) => {
        if (!consumption || typeof consumption !== "object") return [];
        const source = consumption as Record<string, unknown>;
        return [{
          source_name: String(source.source_name ?? "Fuente sin registro"),
          source_kind: source.source_kind === "preparation" ? "preparation" as const : "inventory_item" as const,
          source_id: String(source.source_id ?? ""),
          quantity_base: Number(source.quantity_base ?? 0),
          base_unit: parsePreviewStockUnit(source.base_unit),
          origin_label: String(source.origin_label ?? "Origen sin registro"),
          purchase_item_id: typeof source.purchase_item_id === "string" ? source.purchase_item_id : null,
          production_batch_id: typeof source.production_batch_id === "string" ? source.production_batch_id : null,
          purchased_at: typeof source.purchased_at === "string" ? source.purchased_at : null,
          purchase_expiration_date: typeof source.purchase_expiration_date === "string" ? source.purchase_expiration_date : null,
          elaborated_at: typeof source.elaborated_at === "string" ? source.elaborated_at : null,
          production_expiration_date: typeof source.production_expiration_date === "string" ? source.production_expiration_date : null,
          origin_stock_before: Number(source.origin_stock_before ?? 0),
          origin_consumption: Number(source.origin_consumption ?? 0),
          origin_stock_after: Number(source.origin_stock_after ?? 0)
        }];
      })
    }];
  });
  return { status, shortages, consolidated, lines };
}

export async function getPosInventoryConsumptionPreview(itemsRaw: string): Promise<PosInventoryConsumptionPreviewState> {
  const supabase = await createServerSupabaseClient();
  let items: unknown;
  try {
    items = JSON.parse(itemsRaw);
  } catch {
    return { status: "error", message: "El pedido no tiene productos válidos." };
  }
  if (!Array.isArray(items) || items.length === 0) return { status: "error", message: "Agrega al menos un producto al pedido." };

  try {
    const expanded = await expandComboItemsForPos(supabase, items);
    const { data, error } = await supabase.rpc("get_pos_inventory_consumption_preview", { p_items: expanded.expandedItems });
    if (error) return { status: "error", message: error.message };
    const preview = parsePosInventoryConsumptionPreview(data);
    if (!preview) return { status: "error", message: "La vista previa de inventario no devolvió datos válidos." };
    if (preview.status === "ok") {
      const stockClient = createSupabaseAdminClient() ?? supabase;
      for (const row of preview.consolidated) {
        const adjusted = await getAdjustedSourceStock(stockClient, row.source_kind, row.source_id, row.unit);
        row.stock_before = adjusted.stock;
        row.stock_after = Number((adjusted.stock - row.consumption_quantity).toFixed(3));
        for (const origin of row.origins) {
          const originId = origin.purchase_item_id ?? origin.production_batch_id;
          if (!originId || !adjusted.originStock.has(originId)) continue;
          origin.stock_before = adjusted.originStock.get(originId) ?? 0;
          origin.stock_after = Number((origin.stock_before - origin.consumption_quantity).toFixed(3));
        }
      }
    }
    return { status: "success", message: preview.status === "insufficient" ? "El pedido tiene faltantes de inventario." : "Consumo de inventario calculado.", preview };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "No se pudo calcular el consumo de inventario." };
  }
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
  const discountType = getString(formData, "discount_type") || "none";
  const discountValue = getDecimal(formData, "discount_value", 0);
  const discountCop = getDecimal(formData, "discount_cop", 0);
  const deliveryCop = getDecimal(formData, "delivery_cop", 0);
  const cashReceivedCop = getDecimal(formData, "cash_received_cop", 0);
  const cashChangeCop = getDecimal(formData, "cash_change_cop", 0);
  const notes = getString(formData, "notes");

  if (!["local", "pickup", "delivery"].includes(kind)) return { status: "error", message: "Selecciona el tipo de pedido." };
  if (!["cash", "card", "transfer", "mixed", "pending"].includes(paymentMethod)) return { status: "error", message: "Selecciona la forma de pago." };
  if (!["none", "percentage", "amount"].includes(discountType)) return { status: "error", message: "El tipo de descuento no es válido." };
  if (discountType === "none" && (discountValue !== 0 || discountCop !== 0)) return { status: "error", message: "El descuento no es válido." };
  if (discountType === "percentage" && (discountValue <= 0 || discountValue >= 100)) return { status: "error", message: "El descuento porcentual debe ser mayor que cero y menor al 100%." };
  if (discountType === "amount" && (discountValue <= 0 || discountCop <= 0)) return { status: "error", message: "El descuento debe ser mayor que cero." };

  let items: unknown;
  try {
    items = JSON.parse(itemsRaw);
  } catch {
    return { status: "error", message: "El pedido no tiene productos validos." };
  }

  if (!Array.isArray(items) || items.length === 0) return { status: "error", message: "Agrega al menos un producto al pedido." };
  if (paymentMethod === "cash" && cashReceivedCop <= 0) return { status: "error", message: "Confirma el cobro en efectivo." };

  let rpcItems = items;
  let comboSnapshots: Awaited<ReturnType<typeof expandComboItemsForPos>>["snapshots"] = [];
  try {
    const expanded = await expandComboItemsForPos(supabase, items);
    rpcItems = expanded.expandedItems;
    comboSnapshots = expanded.snapshots;
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "No se pudo validar el combo." };
  }

  const { data, error } = await supabase.rpc("create_pos_order_with_discount_payment", {
    p_kind: kind,
    p_customer_name: upperText(customerName),
    p_customer_phone: customerPhone,
    p_discount_type: discountType,
    p_discount_value: discountValue,
    p_discount_cop: discountCop,
    p_delivery_cop: deliveryCop,
    p_payment_method: paymentMethod,
    p_notes: upperText(notes),
    p_items: rpcItems,
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
      const { data: currentShortages } = await supabase.rpc("get_pos_order_stock_shortages", { p_items: rpcItems });
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
  if (order?.id && comboSnapshots.length > 0) {
    const { error: snapshotError } = await supabase.from("pos_order_combo_snapshots").insert(
      comboSnapshots.map((snapshot) => ({
        order_id: order.id,
        combo_config_id: snapshot.combo_config_id,
        cart_line_key: snapshot.cart_line_key,
        sku: snapshot.sku,
        name: snapshot.name,
        quantity: snapshot.quantity,
        unit_price_cop: snapshot.unit_price_cop,
        normal_price_cop: snapshot.normal_price_cop,
        savings_cop: snapshot.savings_cop,
        choices: snapshot.choices
      }))
    );
    if (snapshotError) return { status: "error", message: `Pedido creado, pero no se pudo guardar el resumen del combo: ${snapshotError.message}` };
  }

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

export async function getPosOrderTestDeletionPreview(orderId: string): Promise<PosOrderTestDeletionPreviewState> {
  if (!orderId) return { status: "error", message: "Pedido no válido." };
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_pos_order_test_deletion_preview", { p_order_id: orderId });
  if (error || !data) return { status: "error", message: error?.message ?? "No se pudieron cargar los consumos reales del pedido." };

  const raw = data as Record<string, unknown>;
  const rawConsumptions = Array.isArray(raw.consumptions) ? raw.consumptions : [];
  const consumptions = rawConsumptions
    .map((entry) => entry as Record<string, unknown>)
    .filter((entry) => typeof entry.allocation_id === "string")
    .map((entry) => {
      const itemKind: "pizza" | "sale_product" | null = entry.item_kind === "pizza" || entry.item_kind === "sale_product" ? entry.item_kind : null;
      const sourceKind: "inventory_item" | "preparation" = entry.source_kind === "preparation" ? "preparation" : "inventory_item";
      return {
        allocation_id: String(entry.allocation_id),
        consumption_id: String(entry.consumption_id ?? ""),
        order_item_id: typeof entry.order_item_id === "string" ? entry.order_item_id : null,
        order_item_addition_id: typeof entry.order_item_addition_id === "string" ? entry.order_item_addition_id : null,
        item_name: String(entry.item_name ?? "Consumo sin línea"),
        item_kind: itemKind,
        quantity_base: Number(entry.quantity_base ?? 0),
        base_unit: getStockUnitFromValue(entry.base_unit),
        cost_cop: Number(entry.cost_cop ?? 0),
        source_kind: sourceKind,
        source_name: String(entry.source_name ?? "Fuente sin registro"),
        purchase_item_id: typeof entry.purchase_item_id === "string" ? entry.purchase_item_id : null,
        production_batch_id: typeof entry.production_batch_id === "string" ? entry.production_batch_id : null,
        origin_label: String(entry.origin_label ?? "Origen sin registro"),
        combo_name: typeof entry.combo_name === "string" ? entry.combo_name : null
      };
    });

  return {
    status: "success",
    message: "Consumos reales cargados.",
    preview: {
      order_id: String(raw.order_id ?? orderId),
      order_code: String(raw.order_code ?? ""),
      consumptions
    }
  };
}

export async function deletePosOrderForTesting(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const orderId = getString(formData, "order_id");
  if (!orderId) return { status: "error", message: "Pedido no válido." };

  let reintegratedAllocationIds: string[] = [];
  try {
    const parsed = JSON.parse(getString(formData, "reintegrated_allocation_ids") || "[]");
    if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) {
      return { status: "error", message: "La selección de consumos no es válida." };
    }
    reintegratedAllocationIds = [...new Set(parsed)];
  } catch {
    return { status: "error", message: "La selección de consumos no es válida." };
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("delete_pos_order_for_testing", {
    p_order_id: orderId,
    p_reintegrated_allocation_ids: reintegratedAllocationIds,
    p_reason_code: getOptionalString(formData, "loss_reason"),
    p_reason_detail: getOptionalString(formData, "loss_reason_detail")
  });
  if (error) return { status: "error", message: error.message };

  const result = (data ?? {}) as { reintegrated_allocation_count?: number; retained_allocation_count?: number };
  revalidateInventory();
  revalidatePath("/panel/caja");
  revalidatePath("/panel/cocina");
  revalidatePath("/panel/reportes");
  return {
    status: "success",
    message: `Pedido eliminado. ${Number(result.reintegrated_allocation_count ?? 0)} consumo(s) reintegrado(s) y ${Number(result.retained_allocation_count ?? 0)} conservado(s) como salida.`
  };
}

export async function updatePosOrderOperationalDate(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const supabase = await createServerSupabaseClient();
  const orderId = getString(formData, "order_id");
  const date = getString(formData, "ordered_date");
  const time = getString(formData, "ordered_time");
  if (!orderId || !date || !time) return { status: "error", message: "Ingresa una fecha y hora válidas." };

  const orderedAt = new Date(`${date}T${time}:00-05:00`);
  if (Number.isNaN(orderedAt.getTime())) return { status: "error", message: "Ingresa una fecha y hora válidas." };
  if (orderedAt.getTime() > Date.now() + 5 * 60 * 1000) return { status: "error", message: "La fecha operativa no puede estar en el futuro." };

  const { error } = await supabase.rpc("update_pos_order_operational_date", {
    p_order_id: orderId,
    p_ordered_at: orderedAt.toISOString()
  });
  if (error) return { status: "error", message: error.message };

  revalidatePath("/panel/pedidos");
  revalidatePath("/panel/reportes");
  revalidatePath("/panel/caja");
  return { status: "success", message: "Fecha operativa actualizada." };
}

export async function updatePosOrderPaymentMethod(_previousState: FormActionState, formData: FormData): Promise<FormActionState> {
  const supabase = await createServerSupabaseClient();
  const orderId = getString(formData, "order_id");
  const paymentMethod = getString(formData, "payment_method");
  const totalCop = getDecimal(formData, "total_cop", 0);
  const reason = getString(formData, "reason");
  if (!orderId) return { status: "error", message: "Pedido no valido." };
  if (!["cash", "transfer", "mixed", "pending"].includes(paymentMethod)) return { status: "error", message: "Selecciona el metodo de pago." };

  let payments: Array<Record<string, number | string>> = [];
  if (paymentMethod === "cash") {
    const cashReceived = getDecimal(formData, "cash_received_cop", totalCop);
    if (cashReceived < totalCop) return { status: "error", message: "El efectivo recibido no cubre el total." };
    payments = [{ method: "cash", amount_cop: totalCop, cash_received_cop: cashReceived, cash_change_cop: Math.max(0, cashReceived - totalCop) }];
  } else if (paymentMethod === "mixed") {
    const cashAmount = getDecimal(formData, "mixed_cash_cop", 0);
    const transferAmount = getDecimal(formData, "mixed_transfer_cop", 0);
    const cashReceived = getDecimal(formData, "mixed_cash_received_cop", cashAmount);
    if (cashAmount <= 0 || transferAmount <= 0) return { status: "error", message: "El pago mixto debe incluir efectivo y transferencia." };
    if (Math.round(cashAmount + transferAmount) !== Math.round(totalCop)) return { status: "error", message: "El desglose mixto debe sumar exactamente el total." };
    if (cashReceived < cashAmount) return { status: "error", message: "El efectivo recibido no cubre la parte en efectivo." };
    payments = [
      { method: "cash", amount_cop: cashAmount, cash_received_cop: cashReceived, cash_change_cop: Math.max(0, cashReceived - cashAmount) },
      { method: "transfer", amount_cop: transferAmount }
    ];
  } else {
    payments = [{ method: paymentMethod, amount_cop: totalCop }];
  }

  const { error } = await supabase.rpc("correct_pos_order_payment_method", {
    p_order_id: orderId,
    p_payment_method: paymentMethod,
    p_payments: payments,
    p_reason: upperText(reason)
  });
  if (error) return { status: "error", message: error.message };

  revalidatePath("/panel/pedidos");
  revalidatePath("/panel/caja");
  revalidatePath("/panel/reportes");
  return { status: "success", message: "Metodo de pago actualizado." };
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

  const basePayload = {
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
  };
  const legalPayload = {
    ...basePayload,
    public_email: getOptionalString(formData, "public_email"),
    legal_contact_email: getOptionalString(formData, "legal_contact_email")
  };

  const { error } = await supabase.from("site_settings").update(legalPayload).eq("id", true);
  if (error && /public_email|legal_contact_email|schema cache/i.test(error.message)) {
    const { error: retryError } = await supabase.from("site_settings").update(basePayload).eq("id", true);
    if (retryError) return { status: "error", message: retryError.message };
  } else if (error) {
    return { status: "error", message: error.message };
  }

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
