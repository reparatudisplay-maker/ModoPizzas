import { PanelShell } from "@/components/panel-shell";
import { ComboPricesWorkspace, type ComboPizzaFlavorOption, type ComboPriceRecord, type ComboSaleProductOption, type ComboSizeOption, type ComboVariantDraft } from "@/components/combo-prices-workspace";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePanelAccess } from "@/lib/panel-auth";
import { buildProductionInventory, type ProductionAllocationInput, type ProductionBatchInput, type ProductionConsumptionInput, type ProductionTraceAllocationInput } from "@/lib/production-inventory";
import { canonicalStockUnit, convertStockQuantity, formatStockQuantity, type StockUnit } from "@/lib/units";

export const dynamic = "force-dynamic";

const productImageBucket = "product-images";

type ComboRow = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  image_url: string | null;
  sale_price_cop: number;
  is_active: boolean;
  sort_order: number | null;
  combo_groups: Array<{
    id: string;
    name: string;
    group_kind: "pizza" | "sale_product";
    quantity_to_choose: number;
    is_required: boolean;
    pizza_size_id: string | null;
    allow_all_flavors: boolean;
    sort_order: number | null;
    variant_id: string | null;
    combo_group_options: Array<{
      id: string;
      pizza_flavor_id: string | null;
      inventory_item_id: string | null;
      is_active: boolean;
      sort_order: number | null;
    }>;
  }>;
  combo_variants: Array<{
    id: string;
    name: string;
    sale_price_cop: number;
    sort_order: number | null;
    is_active: boolean;
  }>;
};

type PizzaPriceRow = {
  id: string;
  flavor_id: string;
  size_id: string;
  sale_price_cop: number;
  pizza_flavors: { id: string; name: string; image_url: string | null } | null;
};

type PizzaCostComponentRow = {
  price_config_id: string;
  source_kind: "inventory_item" | "preparation";
  inventory_item_id: string | null;
  source_preparation_id: string | null;
  quantity_base: number;
  unit: StockUnit;
};

type PizzaBaseSourceRow = {
  pizza_size_id: string;
  source_kind: "inventory_item" | "preparation";
  inventory_item_id: string | null;
  source_preparation_id: string | null;
  quantity_base: number;
  unit: StockUnit;
};

type InventoryCostRow = {
  id: string;
  unit: StockUnit;
  average_cost_cop: number | null;
};

type PreparationRow = { id: string; base_unit: StockUnit };

type SaleProductRow = {
  id: string;
  sku: string | null;
  name: string;
  image_url: string | null;
  presentation_quantity: number | null;
  presentation_unit: StockUnit | null;
  sale_price_cop: number | null;
  sale_is_enabled: boolean | null;
  stock_base: number | null;
  unit_cost_cop: number | null;
};

async function signedImage(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>, path: string | null) {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  const { data } = await supabase.storage.from(productImageBucket).createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

export default async function MenuPreciosCombosPage() {
  const supabase = await createServerSupabaseClient();
  const { user, roleNames, moduleKeys } = await requirePanelAccess(supabase, "menu");

  const [combosResult, pricesResult, sizesResult, productsResult, componentsResult, baseSourcesResult, inventoryCostsResult, preparationsResult, productionBatchesResult, productionAllocationsResult, productionConsumptionsResult, productionTraceAllocationsResult, productionItemsResult, productionPreparationsResult] = await Promise.all([
    supabase
      .from("combo_configs")
      .select("id, sku, name, description, image_url, sale_price_cop, is_active, sort_order, combo_variants(id, name, sale_price_cop, sort_order, is_active), combo_groups(id, variant_id, name, group_kind, quantity_to_choose, is_required, pizza_size_id, allow_all_flavors, sort_order, combo_group_options(id, pizza_flavor_id, inventory_item_id, is_active, sort_order))")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("pizza_price_configs")
      .select("id, flavor_id, size_id, sale_price_cop, pizza_flavors(id, name, image_url)")
      .eq("is_active", true),
    supabase.from("pizza_sizes").select("id, name").eq("is_active", true).order("diameter_cm"),
    supabase.rpc("get_pos_sale_product_catalog"),
    supabase.from("pizza_price_components").select("price_config_id, source_kind, inventory_item_id, source_preparation_id, quantity_base, unit"),
    supabase.from("pizza_size_base_sources").select("pizza_size_id, source_kind, inventory_item_id, source_preparation_id, quantity_base, unit"),
    supabase.from("inventory_items").select("id, unit, average_cost_cop").eq("is_active", true),
    supabase.from("preparations").select("id, base_unit").eq("is_active", true),
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

  const error = combosResult.error ?? pricesResult.error ?? sizesResult.error ?? productsResult.error ?? componentsResult.error ?? baseSourcesResult.error ?? inventoryCostsResult.error ?? preparationsResult.error ?? productionBatchesResult.error ?? productionAllocationsResult.error ?? productionConsumptionsResult.error ?? productionTraceAllocationsResult.error ?? productionItemsResult.error ?? productionPreparationsResult.error;
  const priceRows = (pricesResult.data ?? []) as unknown as PizzaPriceRow[];
  const productsRows = (productsResult.data ?? []) as unknown as SaleProductRow[];
  const productById = new Map(productsRows.map((product) => [product.id, product]));
  const componentsByPrice = new Map<string, PizzaCostComponentRow[]>();
  for (const component of (componentsResult.data ?? []) as unknown as PizzaCostComponentRow[]) {
    componentsByPrice.set(component.price_config_id, [...(componentsByPrice.get(component.price_config_id) ?? []), component]);
  }
  const baseSourceBySize = new Map<string, PizzaBaseSourceRow>();
  for (const source of (baseSourcesResult.data ?? []) as unknown as PizzaBaseSourceRow[]) {
    if (!baseSourceBySize.has(source.pizza_size_id)) baseSourceBySize.set(source.pizza_size_id, source);
  }
  const inventoryCostById = new Map((inventoryCostsResult.data ?? []).map((item) => [item.id, item as InventoryCostRow]));
  const preparationUnitById = new Map((preparationsResult.data ?? []).map((item) => [item.id, (item as PreparationRow).base_unit]));
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
      item.stock_base > 0 && item.inventory_value_cop > 0 ? item.inventory_value_cop / item.stock_base : null
    ])
  );

  function sourceCost(
    sourceKind: "inventory_item" | "preparation",
    sourceId: string | null,
    quantityBase: number,
    unit: StockUnit
  ) {
    if (sourceKind === "preparation") {
      const unitCost = preparationCostById.get(sourceId ?? "") ?? null;
      const sourceUnit = preparationUnitById.get(sourceId ?? "") ?? null;
      if (unitCost === null || !sourceUnit || canonicalStockUnit(sourceUnit) !== canonicalStockUnit(unit)) return null;
      try {
        return convertStockQuantity(Number(quantityBase ?? 0), unit, canonicalStockUnit(unit)) * unitCost;
      } catch {
        return null;
      }
    }
    if (!sourceId) return null;
    const source = inventoryCostById.get(sourceId);
    const unitCost = Number(source?.average_cost_cop ?? 0);
    if (!source || unitCost <= 0 || canonicalStockUnit(source.unit) !== canonicalStockUnit(unit)) return null;
    try {
      const quantityInBase = convertStockQuantity(Number(quantityBase ?? 0), unit, canonicalStockUnit(unit));
      const sourceUnitInBase = convertStockQuantity(1, source.unit, canonicalStockUnit(source.unit));
      return quantityInBase * (unitCost / sourceUnitInBase);
    } catch {
      return null;
    }
  }

  function estimatedPizzaCost(price: PizzaPriceRow) {
    const base = baseSourceBySize.get(price.size_id);
    if (!base) return null;
    const sources = [
      base,
      ...(componentsByPrice.get(price.id) ?? [])
    ];
    let total = 0;
    for (const source of sources) {
      const sourceId = source.source_kind === "preparation" ? source.source_preparation_id : source.inventory_item_id;
      const cost = sourceCost(source.source_kind, sourceId, Number(source.quantity_base ?? 0), source.unit);
      if (cost === null) return null;
      total += cost;
    }
    return total;
  }

  const flavorMap = new Map<string, ComboPizzaFlavorOption>();
  for (const price of priceRows) {
    if (!price.pizza_flavors) continue;
    const existing = flavorMap.get(price.flavor_id) ?? {
      id: price.flavor_id,
      name: price.pizza_flavors.name,
      image_src: await signedImage(supabase, price.pizza_flavors.image_url),
      prices: []
    };
    existing.prices.push({
      price_config_id: price.id,
      size_id: price.size_id,
      sale_price_cop: Number(price.sale_price_cop ?? 0),
      estimated_cost_cop: estimatedPizzaCost(price)
    });
    flavorMap.set(price.flavor_id, existing);
  }
  const pizzaFlavors = [...flavorMap.values()].sort((a, b) => a.name.localeCompare(b.name));

  const saleProducts: ComboSaleProductOption[] = await Promise.all(
    productsRows.map(async (product) => ({
      id: product.id,
      sku: product.sku,
      name: product.name,
      image_src: await signedImage(supabase, product.image_url),
      presentation:
        product.presentation_quantity && product.presentation_unit
          ? formatStockQuantity(Number(product.presentation_quantity), product.presentation_unit)
          : "Sin presentacion",
      sale_price_cop: Number(product.sale_price_cop ?? 0),
      sale_is_enabled: Boolean(product.sale_is_enabled),
      stock_base: Number(product.stock_base ?? 0),
      unit_cost_cop: product.unit_cost_cop === null ? null : Number(product.unit_cost_cop)
    }))
  );

  const sizes: ComboSizeOption[] = ((sizesResult.data ?? []) as ComboSizeOption[]).map((size) => ({ id: size.id, name: size.name }));

  const combos: ComboPriceRecord[] = await Promise.all(
    ((combosResult.data ?? []) as unknown as ComboRow[]).map(async (combo) => {
      const rawGroups = (combo.combo_groups ?? [])
        .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
        .map((group) => ({
          id: group.id,
          variant_id: group.variant_id,
          name: group.name,
          group_kind: group.group_kind,
          quantity_to_choose: Number(group.quantity_to_choose ?? 1),
          is_required: group.is_required,
          pizza_size_id: group.pizza_size_id,
          allow_all_flavors: group.allow_all_flavors,
          sort_order: Number(group.sort_order ?? 0),
          options: (group.combo_group_options ?? [])
            .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
            .map((option) => ({
              id: option.id,
              pizza_flavor_id: option.pizza_flavor_id,
              inventory_item_id: option.inventory_item_id,
              is_active: option.is_active,
              sort_order: Number(option.sort_order ?? 0)
            }))
        }));
      const variants: ComboVariantDraft[] = (combo.combo_variants?.length ? combo.combo_variants : [{ id: null, name: "GRUPO 1", sale_price_cop: Number(combo.sale_price_cop ?? 0), sort_order: 0, is_active: true }]).sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)).map((variant) => ({
        id: variant.id,
        name: variant.name,
        sale_price_cop: Number(variant.sale_price_cop ?? 0),
        sort_order: Number(variant.sort_order ?? 0),
        is_active: variant.is_active,
        groups: rawGroups.filter((group) => (group.variant_id ?? (variant.id ? null : "legacy")) === (variant.id ?? "legacy"))
      }));
      const variantsWithMetrics = variants.map((variant) => {
        let normalMin = 0;
        let normalMax = 0;
        let costMin = 0;
        let costMax = 0;
        let hasCost = true;
        for (const group of variant.groups) {
          const activeOptions = group.options.filter((option) => option.is_active);
          const prices = activeOptions.map((option) => group.group_kind === "pizza"
            ? flavorMap.get(option.pizza_flavor_id ?? "")?.prices.find((price) => price.size_id === group.pizza_size_id)?.sale_price_cop ?? 0
            : Number(productById.get(option.inventory_item_id ?? "")?.sale_price_cop ?? 0)
          ).filter((price) => price > 0);
          if (prices.length === 0) continue;
          normalMin += Math.min(...prices) * group.quantity_to_choose;
          normalMax += Math.max(...prices) * group.quantity_to_choose;

          const costs = activeOptions.map((option) => group.group_kind === "pizza"
            ? flavorMap.get(option.pizza_flavor_id ?? "")?.prices.find((price) => price.size_id === group.pizza_size_id)?.estimated_cost_cop ?? null
            : productById.get(option.inventory_item_id ?? "")?.unit_cost_cop ?? null
          ).filter((value): value is number => value !== null && value > 0);
          if (costs.length !== activeOptions.length) hasCost = false;
          else {
            costMin += Math.min(...costs) * group.quantity_to_choose;
            costMax += Math.max(...costs) * group.quantity_to_choose;
          }
        }
        return {
          ...variant,
          normal_price_min_cop: normalMin || null,
          normal_price_max_cop: normalMax || null,
          estimated_cost_min_cop: hasCost ? costMin : null,
          estimated_cost_max_cop: hasCost ? costMax : null
        };
      });
      const normalPrices = variantsWithMetrics.map((variant) => variant.normal_price_min_cop).filter((value): value is number => value !== null);
      const costRanges = variantsWithMetrics.flatMap((variant) => {
        const min = variant.estimated_cost_min_cop;
        const max = variant.estimated_cost_max_cop;
        return min === null || max === null ? [] : [{ min, max }];
      });
      return {
        id: combo.id,
        sku: combo.sku,
        name: combo.name,
        description: combo.description,
        image_url: combo.image_url,
        image_src: await signedImage(supabase, combo.image_url),
        sale_price_cop: variantsWithMetrics.length ? Math.min(...variantsWithMetrics.map((variant) => variant.sale_price_cop)) : Number(combo.sale_price_cop ?? 0),
        is_active: combo.is_active,
        sort_order: Number(combo.sort_order ?? 0),
        normal_price_cop: normalPrices.length ? Math.min(...normalPrices) : 0,
        estimated_cost_cop: costRanges.length ? Math.min(...costRanges.map((range) => range.min)) : null,
        estimated_cost_min_cop: costRanges.length ? Math.min(...costRanges.map((range) => range.min)) : null,
        estimated_cost_max_cop: costRanges.length ? Math.max(...costRanges.map((range) => range.max)) : null,
        variants: variantsWithMetrics
      };
    })
  );

  return (
    <PanelShell active="menu-precios-combos" hideHeader moduleKeys={moduleKeys} roleNames={roleNames} title="Precios de combos" userEmail={user.email ?? "usuario"}>
      {error ? <p className="alert">{error.message}</p> : null}
      <ComboPricesWorkspace combos={combos} pizzaFlavors={pizzaFlavors} saleProducts={saleProducts} sizes={sizes} />
    </PanelShell>
  );
}
