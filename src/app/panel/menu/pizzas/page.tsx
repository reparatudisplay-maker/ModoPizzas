import { notFound, redirect } from "next/navigation";
import {
  MenuPizzasWorkspace,
  type AdditionIngredientSource,
  type MenuCategoryRecord,
  type PizzaAdditionRecord,
  type PizzaFlavorRecord,
  type PizzaSizeRecord
} from "@/components/menu-pizzas-workspace";
import { PanelShell } from "@/components/panel-shell";
import { buildProductionInventory, type ProductionAllocationInput, type ProductionBatchInput, type ProductionConsumptionInput, type ProductionTraceAllocationInput } from "@/lib/production-inventory";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { canonicalStockUnit, convertStockQuantity, type StockUnit } from "@/lib/units";

const managerRoles = new Set(["gerente", "admin_sistema"]);

export const dynamic = "force-dynamic";

function isDirectImageUrl(value: string) {
  return value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:");
}

type FlavorRow = Omit<PizzaFlavorRecord, "menu_category_name"> & {
  menu_categories: { name: string } | null;
};

type FlavorIngredientRow = {
  flavor_id: string;
  source_kind: "inventory_item" | "preparation";
  inventory_item_id: string | null;
  source_preparation_id: string | null;
};

type AdditionRow = {
  id: string;
  sku: string;
  name: string;
  source_kind: "inventory_item" | "preparation";
  inventory_item_id: string | null;
  source_preparation_id: string | null;
  max_allowed: number;
  is_active: boolean;
  is_available: boolean;
  sort_order: number;
  created_at: string;
  inventory_items: { name: string; unit: "g" | "kg" | "ml" | "l" | "unit"; average_cost_cop: number | null } | null;
  preparations: { name: string; base_unit: StockUnit } | null;
};

type AdditionSizeRow = {
  addition_id: string;
  pizza_size_id: string;
  quantity_base: number;
  unit: "g" | "ml" | "unit";
  display_quantity: number;
  display_unit: "g" | "kg" | "ml" | "l" | "unit";
  price_cop: number;
  pizza_sizes: { name: string } | null;
};

type AdditionFlavorRow = {
  addition_id: string;
  flavor_id: string;
  pizza_flavors: { name: string } | null;
};

type AdditionCategoryRow = {
  addition_id: string;
  menu_category_id: string;
  menu_categories: { name: string } | null;
};

type PurchaseCostRow = {
  id: string;
  inventory_item_id: string;
  quantity: number;
  unit: StockUnit;
  line_total_cop: number;
};

type PurchaseAllocationRow = {
  purchase_item_id: string | null;
  quantity_base: number;
  base_unit: StockUnit;
};

type PhysicalCountRow = {
  source_kind: "inventory_item" | "preparation";
  inventory_item_id: string | null;
  source_preparation_id: string | null;
  difference_quantity_base: number;
  base_unit: StockUnit;
  average_cost_cop: number;
};

function toUnit(quantity: number, fromUnit: StockUnit, toUnit: StockUnit) {
  if (fromUnit === toUnit) return quantity;
  return convertStockQuantity(quantity, fromUnit, toUnit);
}

export default async function MenuPizzasPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roleNames = roles?.map((item) => item.role) ?? [];
  if (!roleNames.some((role) => managerRoles.has(role))) notFound();

  const [
    categoriesResult,
    sizesResult,
    flavorsResult,
    flavorIngredientsResult,
    inventorySourcesResult,
    preparationSourcesResult,
    additionsResult,
    additionSizesResult,
    additionFlavorsResult,
    additionCategoriesResult,
    purchaseCostsResult,
    purchaseAllocationsResult,
    physicalCountsResult,
    productionBatchesResult,
    productionAllocationsResult,
    productionConsumptionsResult,
    productionTraceAllocationsResult,
    productionItemsResult,
    productionPreparationsResult
  ] = await Promise.all([
    supabase.from("menu_categories").select("id, sku, name, description, sort_order, is_active, created_at").order("sort_order").order("name"),
    supabase.from("pizza_sizes").select("id, sku, name, diameter_cm, slices_count, sort_order, is_active, created_at").order("sort_order").order("name"),
    supabase
      .from("pizza_flavors")
      .select("id, sku, name, commercial_description, image_url, allows_half_and_half, menu_category_id, allergens, is_active, created_at, sort_order, menu_categories(name)")
      .order("sort_order")
      .order("name"),
    supabase.from("pizza_flavor_ingredients").select("flavor_id, source_kind, inventory_item_id, source_preparation_id"),
    supabase
      .from("inventory_items")
      .select("id, name, unit, average_cost_cop")
      .eq("item_kind", "ingredient")
      .eq("is_active", true)
      .is("presentation_quantity", null)
      .order("name"),
    supabase.from("preparations").select("id, name, base_unit").eq("is_active", true).order("name"),
    supabase
      .from("pizza_additions")
      .select("id, sku, name, source_kind, inventory_item_id, source_preparation_id, max_allowed, is_active, is_available, sort_order, created_at, inventory_items(name, unit, average_cost_cop), preparations(name, base_unit)")
      .order("sort_order")
      .order("name"),
    supabase.from("pizza_addition_sizes").select("addition_id, pizza_size_id, quantity_base, unit, display_quantity, display_unit, price_cop, pizza_sizes(name)"),
    supabase.from("pizza_addition_flavors").select("addition_id, flavor_id, pizza_flavors(name)"),
    supabase.from("pizza_addition_categories").select("addition_id, menu_category_id, menu_categories(name)"),
    supabase.from("purchase_items").select("id, inventory_item_id, quantity, unit, line_total_cop"),
    supabase.from("production_consumption_allocations").select("purchase_item_id, quantity_base, base_unit").not("purchase_item_id", "is", null),
    supabase
      .from("physical_inventory_counts")
      .select("source_kind, inventory_item_id, source_preparation_id, difference_quantity_base, base_unit, average_cost_cop")
      .is("voided_at", null),
    supabase
      .from("production_batches")
      .select("id, production_id, preparation_id, initial_quantity_base, base_unit, unit_cost_cop, expiration_date, elaborated_at, production_number, productions(id, code, storage_method, total_cost_cop, unit_cost_cop, created_by), preparations(id, name, image_url, unit_kind, base_unit, is_active)")
      .order("expiration_date", { ascending: true }),
    supabase.from("production_consumption_allocations").select("production_batch_id, quantity_base, base_unit"),
    supabase.from("production_consumptions").select("id, production_id, source_kind, inventory_item_id, source_preparation_id, quantity_base, base_unit, cost_cop"),
    supabase.from("production_consumption_allocations").select("consumption_id, purchase_item_id, production_batch_id, quantity_base, base_unit, cost_cop"),
    supabase.from("inventory_items").select("id, name"),
    supabase.from("preparations").select("id, name, image_url")
  ]);

  const error =
    categoriesResult.error ??
    sizesResult.error ??
    flavorsResult.error ??
    flavorIngredientsResult.error ??
    inventorySourcesResult.error ??
    preparationSourcesResult.error ??
    additionsResult.error ??
    additionSizesResult.error ??
    additionFlavorsResult.error ??
    additionCategoriesResult.error ??
    purchaseCostsResult.error ??
    purchaseAllocationsResult.error ??
    physicalCountsResult.error ??
    productionBatchesResult.error ??
    productionAllocationsResult.error ??
    productionConsumptionsResult.error ??
    productionTraceAllocationsResult.error ??
    productionItemsResult.error ??
    productionPreparationsResult.error;
  const categories = (categoriesResult.data ?? []) as MenuCategoryRecord[];
  const sizes = (sizesResult.data ?? []) as PizzaSizeRecord[];
  const flavorRows = (flavorsResult.data ?? []) as unknown as FlavorRow[];
  const inventorySources = (inventorySourcesResult.data ?? []).map((item) => ({ id: item.id, name: item.name, source_kind: "inventory_item" as const }));
  const preparationSources = (preparationSourcesResult.data ?? []).map((item) => ({ id: item.id, name: item.name, source_kind: "preparation" as const }));
  const sourceNameByKey = new Map([...inventorySources, ...preparationSources].map((source) => [`${source.source_kind}:${source.id}`, source.name]));
  const ingredientsByFlavor = new Map<string, PizzaFlavorRecord["characteristic_ingredients"]>();
  for (const ingredient of (flavorIngredientsResult.data ?? []) as FlavorIngredientRow[]) {
    const sourceId = ingredient.source_kind === "preparation" ? ingredient.source_preparation_id : ingredient.inventory_item_id;
    if (!sourceId) continue;
    const key = `${ingredient.source_kind}:${sourceId}`;
    ingredientsByFlavor.set(ingredient.flavor_id, [
      ...(ingredientsByFlavor.get(ingredient.flavor_id) ?? []),
      {
        source_kind: ingredient.source_kind,
        source_id: sourceId,
        source_name: sourceNameByKey.get(key) ?? "Sin nombre"
      }
    ]);
  }

  const signedImageEntries = await Promise.all(
    flavorRows.map(async (flavor) => {
      if (!flavor.image_url || isDirectImageUrl(flavor.image_url)) {
        return [flavor.id, flavor.image_url] as const;
      }

      const { data } = await supabase.storage.from("product-images").createSignedUrl(flavor.image_url, 60 * 60);
      return [flavor.id, data?.signedUrl ?? null] as const;
    })
  );
  const imageSrcById = new Map(signedImageEntries);
  const flavors = flavorRows.map((flavor) => ({
    ...flavor,
    menu_category_name: flavor.menu_categories?.name ?? null,
    image_src: imageSrcById.get(flavor.id) ?? null,
    characteristic_ingredients: ingredientsByFlavor.get(flavor.id) ?? []
  }));

  const purchaseAllocationsByLine = new Map<string, number>();
  for (const allocation of (purchaseAllocationsResult.data ?? []) as PurchaseAllocationRow[]) {
    if (!allocation.purchase_item_id) continue;
    purchaseAllocationsByLine.set(allocation.purchase_item_id, (purchaseAllocationsByLine.get(allocation.purchase_item_id) ?? 0) + Number(allocation.quantity_base ?? 0));
  }

  const itemCostById = new Map<string, { stock_base: number; value_cop: number; unit_cost_cop: number | null }>();
  for (const line of (purchaseCostsResult.data ?? []) as PurchaseCostRow[]) {
    const baseUnit = canonicalStockUnit(line.unit);
    let quantityBase = Number(line.quantity ?? 0);
    try {
      quantityBase = toUnit(quantityBase, line.unit, baseUnit);
    } catch {
      continue;
    }
    const allocatedBase = purchaseAllocationsByLine.get(line.id) ?? 0;
    const availableBase = Math.max(0, quantityBase - allocatedBase);
    const lineValue = Number(line.line_total_cop ?? 0);
    const availableValue = quantityBase > 0 ? (availableBase / quantityBase) * lineValue : 0;
    const current = itemCostById.get(line.inventory_item_id) ?? { stock_base: 0, value_cop: 0, unit_cost_cop: null };
    current.stock_base += availableBase;
    current.value_cop += availableValue;
    itemCostById.set(line.inventory_item_id, current);
  }

  for (const count of (physicalCountsResult.data ?? []) as unknown as PhysicalCountRow[]) {
    const sourceId = count.source_kind === "preparation" ? count.source_preparation_id : count.inventory_item_id;
    if (!sourceId || count.source_kind !== "inventory_item") continue;
    const current = itemCostById.get(sourceId) ?? { stock_base: 0, value_cop: 0, unit_cost_cop: null };
    current.stock_base += Number(count.difference_quantity_base ?? 0);
    current.value_cop += Number(count.difference_quantity_base ?? 0) * Number(count.average_cost_cop ?? 0);
    itemCostById.set(sourceId, current);
  }
  for (const [id, cost] of itemCostById) {
    itemCostById.set(id, {
      ...cost,
      stock_base: Math.max(0, cost.stock_base),
      value_cop: Math.max(0, cost.value_cop),
      unit_cost_cop: cost.stock_base > 0 && cost.value_cop > 0 ? cost.value_cop / cost.stock_base : null
    });
  }

  const productionInventory = buildProductionInventory({
    batches: (productionBatchesResult.data ?? []) as unknown as ProductionBatchInput[],
    allocations: (productionAllocationsResult.data ?? []) as ProductionAllocationInput[],
    consumptions: (productionConsumptionsResult.data ?? []) as ProductionConsumptionInput[],
    traceAllocations: (productionTraceAllocationsResult.data ?? []) as ProductionTraceAllocationInput[],
    inventoryNames: new Map((productionItemsResult.data ?? []).map((item) => [item.id, item.name])),
    preparationNames: new Map((productionPreparationsResult.data ?? []).map((preparation) => [preparation.id, preparation.name]))
  });
  const preparationCostById = new Map(
    productionInventory.items.map((item) => [
      item.id,
      {
        stock_base: item.stock_base,
        value_cop: item.inventory_value_cop,
        unit_cost_cop: item.stock_base > 0 && item.inventory_value_cop > 0 ? item.inventory_value_cop / item.stock_base : null
      }
    ])
  );
  for (const count of (physicalCountsResult.data ?? []) as unknown as PhysicalCountRow[]) {
    if (count.source_kind !== "preparation" || !count.source_preparation_id) continue;
    const current = preparationCostById.get(count.source_preparation_id) ?? { stock_base: 0, value_cop: 0, unit_cost_cop: null };
    current.stock_base += Number(count.difference_quantity_base ?? 0);
    current.value_cop += Number(count.difference_quantity_base ?? 0) * Number(count.average_cost_cop ?? 0);
    preparationCostById.set(count.source_preparation_id, {
      stock_base: Math.max(0, current.stock_base),
      value_cop: Math.max(0, current.value_cop),
      unit_cost_cop: current.stock_base > 0 && current.value_cop > 0 ? current.value_cop / current.stock_base : null
    });
  }

  const additionIngredientSources = (inventorySourcesResult.data ?? []).map((item) => {
    const cost = itemCostById.get(item.id);
    return {
      id: item.id,
      name: item.name,
      source_kind: "inventory_item" as const,
      unit: item.unit,
      stock_base: cost?.stock_base ?? 0,
      unit_cost_cop: cost?.unit_cost_cop ?? null
    };
  }) as AdditionIngredientSource[];
  const additionPreparationSources = (preparationSourcesResult.data ?? []).map((item) => {
    const source = item as { id: string; name: string; base_unit?: StockUnit };
    const cost = preparationCostById.get(source.id);
    return {
      id: source.id,
      name: source.name,
      source_kind: "preparation" as const,
      unit: source.base_unit ?? "unit",
      stock_base: cost?.stock_base ?? 0,
      unit_cost_cop: cost?.unit_cost_cop ?? null
    };
  }) as AdditionIngredientSource[];

  const additionSizesById = new Map<string, PizzaAdditionRecord["sizes"]>();
  for (const row of (additionSizesResult.data ?? []) as unknown as AdditionSizeRow[]) {
    additionSizesById.set(row.addition_id, [
      ...(additionSizesById.get(row.addition_id) ?? []),
      {
        pizza_size_id: row.pizza_size_id,
        pizza_size_name: row.pizza_sizes?.name ?? "Sin tamano",
        quantity_base: Number(row.quantity_base ?? 0),
        unit: row.unit,
        display_quantity: Number(row.display_quantity ?? 0),
        display_unit: row.display_unit,
        price_cop: Number(row.price_cop ?? 0)
      }
    ]);
  }
  const compatibleFlavorsById = new Map<string, PizzaAdditionRecord["compatible_flavors"]>();
  for (const row of (additionFlavorsResult.data ?? []) as unknown as AdditionFlavorRow[]) {
    compatibleFlavorsById.set(row.addition_id, [
      ...(compatibleFlavorsById.get(row.addition_id) ?? []),
      { id: row.flavor_id, name: row.pizza_flavors?.name ?? "Sin sabor" }
    ]);
  }
  const compatibleCategoriesById = new Map<string, PizzaAdditionRecord["compatible_categories"]>();
  for (const row of (additionCategoriesResult.data ?? []) as unknown as AdditionCategoryRow[]) {
    compatibleCategoriesById.set(row.addition_id, [
      ...(compatibleCategoriesById.get(row.addition_id) ?? []),
      { id: row.menu_category_id, name: row.menu_categories?.name ?? "Sin categoria" }
    ]);
  }
  const additions = ((additionsResult.data ?? []) as unknown as AdditionRow[]).map((addition) => ({
    id: addition.id,
    sku: addition.sku,
    name: addition.name,
    source_kind: addition.source_kind,
    source_id: addition.source_kind === "preparation" ? addition.source_preparation_id ?? "" : addition.inventory_item_id ?? "",
    component_name: addition.source_kind === "preparation" ? addition.preparations?.name ?? "Sin preparacion" : addition.inventory_items?.name ?? "Sin ingrediente",
    component_unit: addition.source_kind === "preparation" ? addition.preparations?.base_unit ?? "unit" : addition.inventory_items?.unit ?? "unit",
    component_stock_base: addition.source_kind === "preparation" ? preparationCostById.get(addition.source_preparation_id ?? "")?.stock_base ?? 0 : itemCostById.get(addition.inventory_item_id ?? "")?.stock_base ?? 0,
    component_unit_cost_cop:
      addition.source_kind === "preparation" ? preparationCostById.get(addition.source_preparation_id ?? "")?.unit_cost_cop ?? null : itemCostById.get(addition.inventory_item_id ?? "")?.unit_cost_cop ?? null,
    max_allowed: Number(addition.max_allowed ?? 1),
    is_active: addition.is_active,
    is_available: addition.is_available,
    sort_order: Number(addition.sort_order ?? 0),
    created_at: addition.created_at,
    sizes: additionSizesById.get(addition.id) ?? [],
    compatible_flavors: compatibleFlavorsById.get(addition.id) ?? [],
    compatible_categories: compatibleCategoriesById.get(addition.id) ?? []
  })) as PizzaAdditionRecord[];

  return (
    <PanelShell active="menu-pizzas" hideHeader roleNames={roleNames} title="Pizzas" userEmail={user.email ?? "usuario"}>
      {error ? <p className="alert">{error.message}</p> : null}
        <MenuPizzasWorkspace
        additionIngredientSources={[...additionIngredientSources, ...additionPreparationSources]}
        additions={additions}
        categories={categories}
        flavors={flavors}
        ingredientSources={[...inventorySources, ...preparationSources]}
        sizes={sizes}
      />
    </PanelShell>
  );
}
