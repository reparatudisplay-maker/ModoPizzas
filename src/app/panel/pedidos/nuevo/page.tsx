import { PanelShell } from "@/components/panel-shell";
import { PosOrderWorkspace, type PosAdditionOption, type PosPizzaOption, type PosSaleProductOption } from "@/components/pos-order-workspace";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePanelAccess } from "@/lib/panel-auth";
import { convertStockQuantity, formatStockQuantity, type StockUnit } from "@/lib/units";

export const dynamic = "force-dynamic";

const productImageBucket = "product-images";

type PriceRow = {
  id: string;
  sku: string;
  flavor_id: string;
  size_id: string;
  sale_price_cop: number;
  pizza_flavors: {
    id: string;
    name: string;
    image_url: string | null;
    allows_half_and_half: boolean;
    menu_category_id: string | null;
    menu_categories: { name: string } | null;
  } | null;
  pizza_sizes: { id: string; name: string; diameter_cm: number | null; slices_count: number | null; sort_order: number | null; is_active: boolean } | null;
  pizza_price_components: { id: string }[];
};

type SizeRow = {
  id: string;
  name: string;
  diameter_cm: number | null;
  slices_count: number | null;
  sort_order: number | null;
  is_active: boolean;
};

type FlavorRow = {
  id: string;
  name: string;
  image_url: string | null;
  allows_half_and_half: boolean;
  menu_category_id: string | null;
  menu_categories: { name: string } | null;
};

type FlavorIngredientRow = {
  flavor_id: string;
  source_kind: "inventory_item" | "preparation";
  inventory_item_id: string | null;
  source_preparation_id: string | null;
  inventory_items: { name: string } | { name: string }[] | null;
  preparations: { name: string } | { name: string }[] | null;
};

type AdditionRow = {
  id: string;
  sku: string;
  name: string;
  source_kind: "inventory_item" | "preparation";
  inventory_item_id: string | null;
  max_allowed: number;
  pizza_addition_sizes: Array<{ pizza_size_id: string; price_cop: number }>;
  pizza_addition_flavors: Array<{ flavor_id: string }>;
  pizza_addition_categories: Array<{ menu_category_id: string }>;
  inventory_items: { image_url: string | null } | null;
};

type PurchaseLine = {
  id: string;
  inventory_item_id: string;
  quantity: number;
  unit: StockUnit;
  line_total_cop: number | null;
};

type AllocationLine = {
  purchase_item_id: string | null;
  quantity_base: number;
  base_unit: StockUnit;
};

type SaleProductRow = {
  id: string;
  sku: string | null;
  name: string;
  image_url: string | null;
  presentation_quantity: number | null;
  presentation_unit: StockUnit | null;
  sale_price_cop: number | null;
  sale_is_enabled: boolean | null;
  unit: StockUnit;
};

async function signedImage(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>, path: string | null) {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  const { data } = await supabase.storage.from(productImageBucket).createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

function relationName(relation: { name: string } | { name: string }[] | null) {
  if (Array.isArray(relation)) return relation[0]?.name ?? null;
  return relation?.name ?? null;
}

export default async function NuevoPedidoPage() {
  const supabase = await createServerSupabaseClient();
  const { user, roleNames, moduleKeys } = await requirePanelAccess(supabase, "pedidos");

  const [
    flavorsResult,
    sizesResult,
    pricesResult,
    flavorIngredientsResult,
    additionsResult,
    saleProductsResult,
    purchaseItemsResult,
    productionAllocationsResult,
    posAllocationsResult
  ] = await Promise.all([
    supabase
      .from("pizza_flavors")
      .select("id, name, image_url, allows_half_and_half, menu_category_id, menu_categories(name)")
      .eq("is_active", true)
      .order("sort_order"),
    supabase
      .from("pizza_sizes")
      .select("id, name, diameter_cm, slices_count, sort_order, is_active")
      .order("diameter_cm", { ascending: true }),
    supabase
      .from("pizza_price_configs")
      .select("id, sku, flavor_id, size_id, sale_price_cop, pizza_flavors(id, name, image_url, allows_half_and_half, menu_category_id, menu_categories(name)), pizza_sizes(id, name, diameter_cm, slices_count, sort_order, is_active), pizza_price_components(id)")
      .eq("is_active", true)
      .order("created_at", { ascending: false }),
    supabase
      .from("pizza_flavor_ingredients")
      .select("flavor_id, source_kind, inventory_item_id, source_preparation_id, inventory_items(name), preparations(name)"),
    supabase
      .from("pizza_additions")
      .select("id, sku, name, source_kind, inventory_item_id, max_allowed, inventory_items(image_url), pizza_addition_sizes(pizza_size_id, price_cop), pizza_addition_flavors(flavor_id), pizza_addition_categories(menu_category_id)")
      .eq("is_active", true)
      .eq("is_available", true)
      .order("sort_order"),
    supabase
      .from("pos_sale_product_references")
      .select("id, sku, name, image_url, presentation_quantity, presentation_unit, sale_price_cop, sale_is_enabled, unit")
      .eq("sale_is_enabled", true)
      .gt("sale_price_cop", 0)
      .order("name"),
    supabase.from("purchase_items").select("id, inventory_item_id, quantity, unit, line_total_cop"),
    supabase.from("production_consumption_allocations").select("purchase_item_id, quantity_base, base_unit").not("purchase_item_id", "is", null),
    supabase
      .from("pos_order_consumption_allocations")
      .select("purchase_item_id, quantity_base, base_unit, pos_order_consumptions!inner(pos_orders!inner(status))")
      .not("purchase_item_id", "is", null)
      .neq("pos_order_consumptions.pos_orders.status", "cancelled")
  ]);

  const error =
    flavorsResult.error ??
    sizesResult.error ??
    pricesResult.error ??
    flavorIngredientsResult.error ??
    additionsResult.error ??
    saleProductsResult.error ??
    purchaseItemsResult.error ??
    productionAllocationsResult.error ??
    posAllocationsResult.error;

  const signedImageCache = new Map<string, Promise<string | null>>();
  function signedCachedImage(path: string | null) {
    if (!path) return Promise.resolve(null);
    const cached = signedImageCache.get(path);
    if (cached) return cached;
    const promise = signedImage(supabase, path);
    signedImageCache.set(path, promise);
    return promise;
  }

  const purchaseAllocationByLine = new Map<string, number>();
  for (const allocation of [...((productionAllocationsResult.data ?? []) as AllocationLine[]), ...((posAllocationsResult.data ?? []) as unknown as AllocationLine[])]) {
    if (!allocation.purchase_item_id) continue;
    purchaseAllocationByLine.set(allocation.purchase_item_id, (purchaseAllocationByLine.get(allocation.purchase_item_id) ?? 0) + Number(allocation.quantity_base ?? 0));
  }

  const stockByProduct = new Map<string, number>();
  const costByProduct = new Map<string, { quantity: number; total: number }>();
  for (const line of (purchaseItemsResult.data ?? []) as PurchaseLine[]) {
    let quantity = Number(line.quantity ?? 0);
    try {
      quantity = convertStockQuantity(quantity, line.unit, "unit");
    } catch {
      quantity = Number(line.quantity ?? 0);
    }
    const available = Math.max(0, quantity - (purchaseAllocationByLine.get(line.id) ?? 0));
    stockByProduct.set(line.inventory_item_id, (stockByProduct.get(line.inventory_item_id) ?? 0) + available);
    const lineTotal = Number(line.line_total_cop ?? 0);
    if (available > 0 && quantity > 0 && lineTotal > 0) {
      const current = costByProduct.get(line.inventory_item_id) ?? { quantity: 0, total: 0 };
      current.quantity += available;
      current.total += (lineTotal / quantity) * available;
      costByProduct.set(line.inventory_item_id, current);
    }
  }

  const flavorRows = (flavorsResult.data ?? []) as unknown as FlavorRow[];
  const ingredientsByFlavor = new Map<string, PosPizzaOption["characteristic_ingredients"]>();
  for (const ingredient of (flavorIngredientsResult.data ?? []) as unknown as FlavorIngredientRow[]) {
    const sourceId = ingredient.source_kind === "preparation" ? ingredient.source_preparation_id : ingredient.inventory_item_id;
    const sourceName = ingredient.source_kind === "preparation" ? relationName(ingredient.preparations) : relationName(ingredient.inventory_items);
    if (!sourceId || !sourceName) continue;
    const list = ingredientsByFlavor.get(ingredient.flavor_id) ?? [];
    list.push({
      source_id: sourceId,
      source_kind: ingredient.source_kind,
      source_name: sourceName
    });
    ingredientsByFlavor.set(ingredient.flavor_id, list);
  }
  const sizeRows = ((sizesResult.data ?? []) as unknown as SizeRow[]).sort(
    (a, b) => Number(a.diameter_cm ?? 0) - Number(b.diameter_cm ?? 0) || Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0) || a.name.localeCompare(b.name)
  );
  const flavorGroups = new Map<string, PosPizzaOption>();
  for (const flavor of flavorRows) {
    flavorGroups.set(flavor.id, {
      flavor_id: flavor.id,
      flavor_name: flavor.name,
      category_id: flavor.menu_category_id ?? null,
      category_name: flavor.menu_categories?.name ?? null,
      image_src: await signedImage(supabase, flavor.image_url ?? null),
      allows_half_and_half: flavor.allows_half_and_half,
      characteristic_ingredients: ingredientsByFlavor.get(flavor.id) ?? [],
      min_price_cop: null,
      prices: sizeRows.map((size) => ({
        id: null,
        sku: null,
        size_id: size.id,
        size_name: size.name,
        diameter_cm: size.diameter_cm === null ? null : Number(size.diameter_cm),
        slices_count: size.slices_count === null ? null : Number(size.slices_count),
        sort_order: size.sort_order === null ? 0 : Number(size.sort_order),
        is_active: size.is_active,
        price_cop: null,
        components_count: 0
      }))
    });
  }

  const pizzaRows = (pricesResult.data ?? []) as unknown as PriceRow[];
  for (const price of pizzaRows) {
    if (!price.pizza_flavors || !price.pizza_sizes?.is_active) continue;
    const existing = flavorGroups.get(price.flavor_id);
    const sizePrice = {
      id: price.id,
      sku: price.sku,
      size_id: price.size_id,
      size_name: price.pizza_sizes.name,
      diameter_cm: price.pizza_sizes.diameter_cm === null ? null : Number(price.pizza_sizes.diameter_cm),
      slices_count: price.pizza_sizes.slices_count === null ? null : Number(price.pizza_sizes.slices_count),
      sort_order: price.pizza_sizes.sort_order === null ? 0 : Number(price.pizza_sizes.sort_order),
      is_active: price.pizza_sizes.is_active,
      price_cop: Number(price.sale_price_cop ?? 0),
      components_count: price.pizza_price_components?.length ?? 0
    };
    if (!existing) continue;
    existing.prices = existing.prices.map((size) => (size.size_id === sizePrice.size_id ? sizePrice : size));
    existing.prices.sort(
      (a, b) => Number(a.diameter_cm ?? 0) - Number(b.diameter_cm ?? 0) || Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0) || a.size_name.localeCompare(b.size_name)
    );
    if (sizePrice.is_active) {
      existing.min_price_cop = existing.min_price_cop === null ? sizePrice.price_cop : Math.min(existing.min_price_cop, sizePrice.price_cop);
    }
  }
  const pizzas = [...flavorGroups.values()].sort((a, b) => a.flavor_name.localeCompare(b.flavor_name));

  const additions: PosAdditionOption[] = [];
  for (const addition of (additionsResult.data ?? []) as unknown as AdditionRow[]) {
    for (const size of addition.pizza_addition_sizes ?? []) {
      additions.push({
        id: addition.id,
        sku: addition.sku,
        name: addition.name,
        image_src: await signedImage(supabase, addition.inventory_items?.image_url ?? null),
        size_id: size.pizza_size_id,
        flavor_ids: (addition.pizza_addition_flavors ?? []).map((item) => item.flavor_id),
        category_ids: (addition.pizza_addition_categories ?? []).map((item) => item.menu_category_id),
        max_allowed: Number(addition.max_allowed ?? 1),
        price_cop: Number(size.price_cop ?? 0)
      });
    }
  }

  const saleProductRows = (saleProductsResult.data ?? []) as SaleProductRow[];
  const saleProducts: PosSaleProductOption[] = await Promise.all(
    saleProductRows.map(async (product) => {
      const cost = costByProduct.get(product.id);
      return {
        id: product.id,
        sku: product.sku,
        name: product.name,
        image_src: await signedCachedImage(product.image_url),
        presentation:
          product.presentation_quantity && product.presentation_unit
            ? formatStockQuantity(Number(product.presentation_quantity), product.presentation_unit as StockUnit)
            : null,
        sale_price_cop: Number(product.sale_price_cop ?? 0),
        stock_base: stockByProduct.get(product.id) ?? 0,
        unit_cost_cop: cost && cost.quantity > 0 ? cost.total / cost.quantity : null,
        unit: "unit"
      };
    })
  );

  return (
    <PanelShell active="pedidos-nuevo" hideHeader moduleKeys={moduleKeys} roleNames={roleNames} title="Crear pedido" userEmail={user.email ?? "usuario"}>
      {error ? <p className="alert">{error.message}</p> : null}
      <PosOrderWorkspace additions={additions} pizzas={pizzas} saleProducts={saleProducts} />
    </PanelShell>
  );
}
