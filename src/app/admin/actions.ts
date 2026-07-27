"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { normalizeMasterText } from "@/lib/master-normalization";

const validRoles = new Set(["cliente", "vendedor", "mesero", "cocina", "mensajero", "gerente", "admin_sistema"]);
const productImageBucket = "product-images";
const productImageMaxSize = 4 * 1024 * 1024;
const productImageTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"]
]);

export type FormActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

export type ConservationProfileActionState = FormActionState & {
  profile?: {
    id: string;
    name: string;
    is_active: boolean;
    conservation_profile_rules: Array<{
      id: string;
      storage_method: "ambient" | "refrigerated" | "frozen";
      duration_value: number;
      duration_unit: "hours" | "days" | "weeks" | "months";
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

export type PhysicalInventoryActionState = FormActionState & {
  count?: {
    id: string;
    adjustment_kind: "waste" | "adjustment_in";
    difference_quantity_base: number;
    base_unit: string;
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
  const value = getString(formData, key).replace(/\./g, "").replace(/,/g, ".");
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback;
}

function getDecimal(formData: FormData, key: string, fallback = 0) {
  const value = getString(formData, key).replace(/\./g, "").replace(/,/g, ".");
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
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

function normalizeSkuName(value: string) {
  const normalized = value
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]/g, "");
  return normalized.padEnd(3, "X").slice(0, 3);
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
  if (!extension) throw new Error("La foto debe ser JPG, PNG, WEBP o GIF.");
  if (file.size > productImageMaxSize) throw new Error("La foto no puede superar 4 MB.");

  const path = `${folder}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from(productImageBucket).upload(path, file, {
    cacheControl: "3600",
    contentType: file.type,
    upsert: false
  });
  if (error) throw new Error(error.message);
  return path;
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
  revalidatePath("/panel/configuracion");
  revalidatePath("/panel/produccion");
  revalidatePath("/panel/menu/pizzas");
  revalidatePath("/panel/menu/precios/adiciones");
  revalidatePath("/panel/menu/precios/pizzas");
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

type PizzaPriceComponentInput = {
  source_kind: "inventory_item" | "preparation";
  source_id: string;
  quantity: number;
  unit: string;
  estimated_cost_cop?: number | null;
};

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

function getPizzaPriceComponents(formData: FormData) {
  const rawValue = getString(formData, "components");
  if (!rawValue) return [];
  try {
    const parsed = JSON.parse(rawValue) as PizzaPriceComponentInput[];
    return parsed.filter((item) => {
      return (
        item &&
        (item.source_kind === "inventory_item" || item.source_kind === "preparation") &&
        typeof item.source_id === "string" &&
        item.source_id.length > 0 &&
        Number(item.quantity) > 0 &&
        ["g", "kg", "ml", "l", "unit"].includes(item.unit)
      );
    });
  } catch {
    return [];
  }
}

async function savePizzaPriceComponents(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  configId: string,
  components: Array<PizzaPriceComponentInput & { quantity_base: number; base_unit: string }>
) {
  const { error: deleteError } = await supabase.from("pizza_price_components").delete().eq("price_config_id", configId);
  if (deleteError) throw new Error(deleteError.message);
  if (components.length === 0) return;

  const { error } = await supabase.from("pizza_price_components").insert(
    components.map((component) => ({
      price_config_id: configId,
      source_kind: component.source_kind,
      inventory_item_id: component.source_kind === "inventory_item" ? component.source_id : null,
      source_preparation_id: component.source_kind === "preparation" ? component.source_id : null,
      quantity_base: component.quantity_base,
      unit: component.base_unit,
      display_quantity: component.quantity,
      display_unit: component.unit
    }))
  );
  if (error) throw new Error(error.message);
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
  const components = getPizzaPriceComponents(formData);
  const estimatedCostCop = getMachineDecimal(formData, "estimated_cost_cop", 0);
  const marginPercent = getMachineDecimal(formData, "margin_percent", 0);
  const supabase = await createServerSupabaseClient();

  if (!flavorId) return { status: "error", message: "Selecciona un sabor." };
  if (!sizeId) return { status: "error", message: "Selecciona un tamano." };
  if (salePriceCop <= 0) return { status: "error", message: "Ingresa el precio de venta." };
  if (components.length === 0) return { status: "error", message: "Agrega al menos un componente con cantidad." };

  const seen = new Set<string>();
  for (const component of components) {
    const key = `${component.source_kind}:${component.source_id}`;
    if (seen.has(key)) return { status: "error", message: "No repitas ingredientes o preparaciones en la misma receta." };
    seen.add(key);
  }

  const { data: flavor, error: flavorError } = await supabase.from("pizza_flavors").select("id, is_active").eq("id", flavorId).single();
  if (flavorError || !flavor?.is_active) return { status: "error", message: flavorError?.message ?? "Selecciona un sabor activo." };
  const { data: size, error: sizeError } = await supabase.from("pizza_sizes").select("id, is_active").eq("id", sizeId).single();
  if (sizeError || !size?.is_active) return { status: "error", message: sizeError?.message ?? "Selecciona un tamano activo." };

  const { data: duplicate, error: duplicateError } = await supabase
    .from("pizza_price_configs")
    .select("id")
    .eq("flavor_id", flavorId)
    .eq("size_id", sizeId)
    .maybeSingle();
  if (duplicateError) return { status: "error", message: duplicateError.message };
  if (duplicate && duplicate.id !== id) return { status: "error", message: "Ya existe un precio para este sabor y tamano." };

  const normalizedComponents: Array<PizzaPriceComponentInput & { quantity_base: number; base_unit: string }> = [];
  try {
    for (const component of components) {
      let baseUnit: string | null = null;
      if (component.source_kind === "inventory_item") {
        const { data, error } = await supabase
          .from("inventory_items")
          .select("id, unit, item_kind, is_active, presentation_quantity")
          .eq("id", component.source_id)
          .single();
        if (error || !data) throw new Error(error?.message ?? "Ingrediente no encontrado.");
        if (!data.is_active || data.item_kind !== "ingredient" || data.presentation_quantity !== null) throw new Error("Solo puedes usar ingredientes activos.");
        baseUnit = canonicalStockUnit(data.unit);
      } else {
        const { data, error } = await supabase.from("preparations").select("id, base_unit, is_active").eq("id", component.source_id).single();
        if (error || !data) throw new Error(error?.message ?? "Preparacion no encontrada.");
        if (!data.is_active) throw new Error("Solo puedes usar preparaciones activas.");
        baseUnit = canonicalStockUnit(data.base_unit);
      }
      if (canonicalStockUnit(component.unit) !== baseUnit) throw new Error("Hay una unidad incompatible con un componente.");
      normalizedComponents.push({
        ...component,
        unit: component.unit,
        quantity_base: convertStockQuantity(Number(component.quantity), component.unit, baseUnit),
        base_unit: baseUnit
      });
    }
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Hay una unidad incompatible." };
  }

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
    await savePizzaPriceComponents(supabase, savedConfig.id, normalizedComponents);
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
    const purchaseCount = await relationCount(supabase, "purchase_items", "inventory_item_id", id);
    if (purchaseCount > 0) return { status: "error", message: "No se puede eliminar este producto porque esta siendo utilizado en Compras." };

    const { error: movementCleanupError } = await supabase.from("inventory_movements").delete().eq("inventory_item_id", id);
    if (movementCleanupError && movementCleanupError.code !== "42P01" && movementCleanupError.code !== "PGRST205") {
      return { status: "error", message: movementCleanupError.message };
    }

    const { error } = await supabase.from("inventory_items").delete().eq("id", id);
    if (error) return { status: "error", message: error.message };
    revalidateInventory();
    return { status: "success", message: "Producto eliminado correctamente." };
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
      purchase_mode: masterItem.purchase_mode ?? "packages",
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
  const effectivePresentationQuantity = submittedPurchaseMode === "packages" ? packageContentQuantity : presentationQuantity;
  const presentationUnit = getStockUnit(formData, "presentation_unit");
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

  const affectedItems = new Set<string>();
  if (purchaseId) {
    const { data: previousLines, error: previousLinesError } = await supabase.from("purchase_items").select("inventory_item_id").eq("purchase_id", purchaseId);
    if (previousLinesError) return { status: "error", message: previousLinesError.message };
    previousLines?.forEach((line) => affectedItems.add(line.inventory_item_id));
  }

  let item: { id: string; unit: string; purchase_mode?: string | null };
  let quantity = 0;
  try {
    item = await resolvePurchaseInventoryItem(supabase, inventoryItemId, purchaseKind, effectivePresentationQuantity, presentationUnit, referenceSku);
    inventoryItemId = item.id;
    const targetUnit = purchaseKind === "ingredient" ? canonicalStockUnit(presentationUnit) : "unit";
    const itemPurchaseMode = item.purchase_mode === "packages" || item.purchase_mode === "total_weight" ? item.purchase_mode : submittedPurchaseMode;
    if (itemPurchaseMode === "packages" && packageContentQuantity <= 0) return { status: "error", message: "Ingresa el contenido por paquete." };
    const ingredientEntryQuantity = purchaseKind === "ingredient" && itemPurchaseMode === "packages" ? enteredQuantity * packageContentQuantity : enteredQuantity;
    quantity = purchaseKind === "sale_product" || purchaseKind === "supply" ? enteredQuantity : convertStockQuantity(ingredientEntryQuantity, presentationUnit, targetUnit);
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
    presentation_quantity: item.purchase_mode === "packages" ? packageContentQuantity : presentationQuantity > 0 ? presentationQuantity : null,
    presentation_unit: item.purchase_mode === "packages" ? presentationUnit : presentationQuantity > 0 ? presentationUnit : null,
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

function getDurationUnit(formData: FormData, key: string) {
  const value = getString(formData, key);
  return ["hours", "days", "weeks", "months"].includes(value) ? value : "days";
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
      return {
        enabled,
        storage_method: storageMethod,
        duration_value: durationValue,
        duration_unit: getDurationUnit(formData, `rules[${index}][duration_unit]`),
        notes: upperText(getOptionalString(formData, `rules[${index}][notes]`))
      };
    })
    .filter((rule) => rule.enabled);

  if (rules.length === 0) return { status: "error", message: "Agrega al menos una regla de conservacion." };
  if (rules.some((rule) => !rule.storage_method || rule.duration_value <= 0)) {
    return { status: "error", message: "Cada regla necesita metodo y duracion mayor a cero." };
  }
  if (new Set(rules.map((rule) => rule.storage_method)).size !== rules.length) {
    return { status: "error", message: "No puedes repetir metodos de conservacion en el mismo perfil." };
  }

  const payload = {
    name,
    description: upperText(getOptionalString(formData, "description")),
    is_active: getBoolean(formData, "is_active"),
    updated_at: new Date().toISOString()
  };
  const profileResult = id
    ? await supabase.from("conservation_profiles").update(payload).eq("id", id).select("id").single()
    : await supabase.from("conservation_profiles").insert(payload).select("id").single();

  if (profileResult.error) return { status: "error", message: profileResult.error.message };
  const profileId = profileResult.data?.id;
  if (!profileId) return { status: "error", message: "No se pudo guardar el perfil." };

  if (id) {
    const { error: deleteRulesError } = await supabase.from("conservation_profile_rules").delete().eq("profile_id", profileId);
    if (deleteRulesError) return { status: "error", message: deleteRulesError.message };
  }

  const { error: rulesError } = await supabase.from("conservation_profile_rules").insert(
    rules.map((rule) => ({
      profile_id: profileId,
      storage_method: rule.storage_method,
      duration_value: rule.duration_value,
      duration_unit: rule.duration_unit,
      notes: rule.notes
    }))
  );
  if (rulesError) return { status: "error", message: rulesError.message };

  const { data: savedProfile, error: savedProfileError } = await supabase
    .from("conservation_profiles")
    .select("id, name, is_active, conservation_profile_rules(id, storage_method, duration_value, duration_unit, notes)")
    .eq("id", profileId)
    .single();
  if (savedProfileError) return { status: "error", message: savedProfileError.message };

  revalidateInventory();
  return { status: "success", message: "Perfil guardado correctamente.", profile: savedProfile as ConservationProfileActionState["profile"] };
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

export async function assignUserRole(formData: FormData) {
  const userId = getString(formData, "user_id");
  const role = getString(formData, "role");
  const supabase = await createServerSupabaseClient();
  if (!validRoles.has(role)) throw new Error("Rol no valido.");

  const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
  if (error && error.code !== "23505") throw new Error(error.message);
  revalidatePath("/panel");
}

export async function removeUserRole(formData: FormData) {
  const userId = getString(formData, "user_id");
  const role = getString(formData, "role");
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("user_roles").delete().eq("user_id", userId).eq("role", role);
  if (error) throw new Error(error.message);
  revalidatePath("/panel");
}
