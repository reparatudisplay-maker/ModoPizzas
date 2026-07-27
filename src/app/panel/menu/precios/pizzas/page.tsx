import { notFound, redirect } from "next/navigation";
import { PanelShell } from "@/components/panel-shell";
import {
  PizzaPricesWorkspace,
  type PizzaPriceCategory,
  type PizzaPriceFlavor,
  type PizzaPriceRecord,
  type PizzaPriceSize,
  type PizzaPriceSource
} from "@/components/pizza-prices-workspace";
import { buildProductionInventory, type ProductionAllocationInput, type ProductionBatchInput, type ProductionConsumptionInput, type ProductionTraceAllocationInput } from "@/lib/production-inventory";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { canonicalStockUnit, convertStockQuantity, type StockUnit } from "@/lib/units";

const managerRoles = new Set(["gerente", "admin_sistema"]);

export const dynamic = "force-dynamic";

type FlavorRow = {
  id: string;
  name: string;
  menu_category_id: string | null;
  is_active: boolean;
  menu_categories: { name: string } | null;
};

type FlavorIngredientRow = {
  flavor_id: string;
  source_kind: "inventory_item" | "preparation";
  inventory_item_id: string | null;
  source_preparation_id: string | null;
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

type PriceConfigRow = {
  id: string;
  sku: string;
  flavor_id: string;
  size_id: string;
  sale_price_cop: number;
  is_active: boolean;
  pizza_flavors: { name: string; menu_category_id: string | null; menu_categories: { name: string } | null } | null;
  pizza_sizes: { name: string } | null;
};

type PriceComponentRow = {
  price_config_id: string;
  source_kind: "inventory_item" | "preparation";
  inventory_item_id: string | null;
  source_preparation_id: string | null;
  quantity_base: number;
  unit: StockUnit;
  display_quantity: number;
  display_unit: StockUnit;
  inventory_items: { name: string } | null;
  preparations: { name: string } | null;
};

function toUnit(quantity: number, fromUnit: StockUnit, toUnit: StockUnit) {
  if (fromUnit === toUnit) return quantity;
  return convertStockQuantity(quantity, fromUnit, toUnit);
}

export default async function MenuPreciosPizzasPage() {
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
    priceConfigsResult,
    priceComponentsResult,
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
    supabase.from("menu_categories").select("id, name, is_active").order("name"),
    supabase.from("pizza_sizes").select("id, name, is_active").order("sort_order").order("name"),
    supabase.from("pizza_flavors").select("id, name, menu_category_id, is_active, menu_categories(name)").order("sort_order").order("name"),
    supabase.from("pizza_flavor_ingredients").select("flavor_id, source_kind, inventory_item_id, source_preparation_id"),
    supabase
      .from("inventory_items")
      .select("id, name, unit, average_cost_cop")
      .eq("item_kind", "ingredient")
      .eq("is_active", true)
      .is("presentation_quantity", null)
      .order("name"),
    supabase.from("preparations").select("id, name, base_unit, is_active").eq("is_active", true).order("name"),
    supabase
      .from("pizza_price_configs")
      .select("id, sku, flavor_id, size_id, sale_price_cop, is_active, pizza_flavors(name, menu_category_id, menu_categories(name)), pizza_sizes(name)")
      .order("created_at", { ascending: false }),
    supabase
      .from("pizza_price_components")
      .select("price_config_id, source_kind, inventory_item_id, source_preparation_id, quantity_base, unit, display_quantity, display_unit, inventory_items(name), preparations(name)"),
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
    priceConfigsResult.error ??
    priceComponentsResult.error ??
    purchaseCostsResult.error ??
    purchaseAllocationsResult.error ??
    physicalCountsResult.error ??
    productionBatchesResult.error ??
    productionAllocationsResult.error ??
    productionConsumptionsResult.error ??
    productionTraceAllocationsResult.error ??
    productionItemsResult.error ??
    productionPreparationsResult.error;

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
    if (count.source_kind !== "inventory_item" || !count.inventory_item_id) continue;
    const current = itemCostById.get(count.inventory_item_id) ?? { stock_base: 0, value_cop: 0, unit_cost_cop: null };
    current.stock_base += Number(count.difference_quantity_base ?? 0);
    current.value_cop += Number(count.difference_quantity_base ?? 0) * Number(count.average_cost_cop ?? 0);
    itemCostById.set(count.inventory_item_id, current);
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

  const inventorySources = (inventorySourcesResult.data ?? []).map((item) => {
    const cost = itemCostById.get(item.id);
    return {
      id: item.id,
      name: item.name,
      source_kind: "inventory_item" as const,
      unit: item.unit as StockUnit,
      stock_base: cost?.stock_base ?? 0,
      unit_cost_cop: cost?.unit_cost_cop ?? null
    };
  });
  const preparationSources = (preparationSourcesResult.data ?? []).map((item) => {
    const cost = preparationCostById.get(item.id);
    return {
      id: item.id,
      name: item.name,
      source_kind: "preparation" as const,
      unit: item.base_unit as StockUnit,
      stock_base: cost?.stock_base ?? 0,
      unit_cost_cop: cost?.unit_cost_cop ?? null
    };
  });
  const sources = [...inventorySources, ...preparationSources] as PizzaPriceSource[];
  const sourceNameByKey = new Map(sources.map((source) => [`${source.source_kind}:${source.id}`, source.name]));

  const ingredientsByFlavor = new Map<string, PizzaPriceFlavor["characteristic_ingredients"]>();
  for (const ingredient of (flavorIngredientsResult.data ?? []) as FlavorIngredientRow[]) {
    const sourceId = ingredient.source_kind === "preparation" ? ingredient.source_preparation_id : ingredient.inventory_item_id;
    if (!sourceId) continue;
    const key = `${ingredient.source_kind}:${sourceId}`;
    ingredientsByFlavor.set(ingredient.flavor_id, [
      ...(ingredientsByFlavor.get(ingredient.flavor_id) ?? []),
      { source_kind: ingredient.source_kind, source_id: sourceId, source_name: sourceNameByKey.get(key) ?? "Sin nombre" }
    ]);
  }

  const flavors = ((flavorsResult.data ?? []) as unknown as FlavorRow[]).map((flavor) => ({
    id: flavor.id,
    name: flavor.name,
    menu_category_id: flavor.menu_category_id,
    menu_category_name: flavor.menu_categories?.name ?? null,
    is_active: flavor.is_active,
    characteristic_ingredients: ingredientsByFlavor.get(flavor.id) ?? []
  })) as PizzaPriceFlavor[];
  const sizes = (sizesResult.data ?? []) as PizzaPriceSize[];
  const categories = (categoriesResult.data ?? []) as PizzaPriceCategory[];
  const componentsByConfig = new Map<string, PizzaPriceRecord["components"]>();
  for (const component of (priceComponentsResult.data ?? []) as unknown as PriceComponentRow[]) {
    const sourceId = component.source_kind === "preparation" ? component.source_preparation_id : component.inventory_item_id;
    if (!sourceId) continue;
    componentsByConfig.set(component.price_config_id, [
      ...(componentsByConfig.get(component.price_config_id) ?? []),
      {
        source_kind: component.source_kind,
        source_id: sourceId,
        source_name: component.source_kind === "preparation" ? component.preparations?.name ?? "Sin preparacion" : component.inventory_items?.name ?? "Sin ingrediente",
        quantity_base: Number(component.quantity_base ?? 0),
        unit: component.unit,
        display_quantity: Number(component.display_quantity ?? 0),
        display_unit: component.display_unit
      }
    ]);
  }
  const prices = ((priceConfigsResult.data ?? []) as unknown as PriceConfigRow[]).map((price) => ({
    id: price.id,
    sku: price.sku,
    flavor_id: price.flavor_id,
    flavor_name: price.pizza_flavors?.name ?? "Sin sabor",
    category_id: price.pizza_flavors?.menu_category_id ?? null,
    category_name: price.pizza_flavors?.menu_categories?.name ?? null,
    size_id: price.size_id,
    size_name: price.pizza_sizes?.name ?? "Sin tamano",
    sale_price_cop: Number(price.sale_price_cop ?? 0),
    is_active: price.is_active,
    components: componentsByConfig.get(price.id) ?? []
  })) as PizzaPriceRecord[];

  return (
    <PanelShell active="menu-precios-pizzas" hideHeader roleNames={roleNames} title="Precios de pizzas" userEmail={user.email ?? "usuario"}>
      {error ? <p className="alert">{error.message}</p> : null}
      <PizzaPricesWorkspace categories={categories} flavors={flavors} prices={prices} sizes={sizes} sources={sources} />
    </PanelShell>
  );
}
