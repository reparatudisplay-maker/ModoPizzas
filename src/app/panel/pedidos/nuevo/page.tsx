import { notFound, redirect } from "next/navigation";
import { PanelShell } from "@/components/panel-shell";
import { PosOrderWorkspace, type PosAdditionOption, type PosPizzaOption, type PosSaleProductOption } from "@/components/pos-order-workspace";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { convertStockQuantity, formatStockQuantity, type StockUnit } from "@/lib/units";

export const dynamic = "force-dynamic";

const orderRoles = new Set(["vendedor", "mesero", "gerente", "admin_sistema"]);
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
};

type AllocationLine = {
  purchase_item_id: string | null;
  quantity_base: number;
  base_unit: StockUnit;
};

async function signedImage(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>, path: string | null) {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  const { data } = await supabase.storage.from(productImageBucket).createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

export default async function NuevoPedidoPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roleNames = roles?.map((item) => item.role) ?? [];
  if (!roleNames.some((role) => orderRoles.has(role))) notFound();

  const [
    flavorsResult,
    sizesResult,
    pricesResult,
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
      .from("pizza_additions")
      .select("id, sku, name, source_kind, inventory_item_id, max_allowed, inventory_items(image_url), pizza_addition_sizes(pizza_size_id, price_cop), pizza_addition_flavors(flavor_id), pizza_addition_categories(menu_category_id)")
      .eq("is_active", true)
      .eq("is_available", true)
      .order("sort_order"),
    supabase
      .from("inventory_items")
      .select("id, sku, name, image_url, presentation_quantity, presentation_unit, unit")
      .eq("item_kind", "sale_product")
      .eq("is_active", true)
      .order("name"),
    supabase.from("purchase_items").select("id, inventory_item_id, quantity, unit"),
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
    additionsResult.error ??
    saleProductsResult.error ??
    purchaseItemsResult.error ??
    productionAllocationsResult.error ??
    posAllocationsResult.error;

  const purchaseAllocationByLine = new Map<string, number>();
  for (const allocation of [...((productionAllocationsResult.data ?? []) as AllocationLine[]), ...((posAllocationsResult.data ?? []) as unknown as AllocationLine[])]) {
    if (!allocation.purchase_item_id) continue;
    purchaseAllocationByLine.set(allocation.purchase_item_id, (purchaseAllocationByLine.get(allocation.purchase_item_id) ?? 0) + Number(allocation.quantity_base ?? 0));
  }

  const stockByProduct = new Map<string, number>();
  for (const line of (purchaseItemsResult.data ?? []) as PurchaseLine[]) {
    let quantity = Number(line.quantity ?? 0);
    try {
      quantity = convertStockQuantity(quantity, line.unit, "unit");
    } catch {
      quantity = Number(line.quantity ?? 0);
    }
    const available = Math.max(0, quantity - (purchaseAllocationByLine.get(line.id) ?? 0));
    stockByProduct.set(line.inventory_item_id, (stockByProduct.get(line.inventory_item_id) ?? 0) + available);
  }

  const flavorRows = (flavorsResult.data ?? []) as unknown as FlavorRow[];
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

  const saleProducts: PosSaleProductOption[] = await Promise.all(
    (saleProductsResult.data ?? []).map(async (product) => ({
      id: product.id,
      sku: product.sku,
      name: product.name,
      image_src: await signedImage(supabase, product.image_url),
      presentation:
        product.presentation_quantity && product.presentation_unit
          ? formatStockQuantity(Number(product.presentation_quantity), product.presentation_unit as StockUnit)
          : null,
      stock_base: stockByProduct.get(product.id) ?? 0,
      unit: "unit"
    }))
  );

  return (
    <PanelShell active="pedidos-nuevo" hideHeader roleNames={roleNames} title="Crear pedido" userEmail={user.email ?? "usuario"}>
      {error ? <p className="alert">{error.message}</p> : null}
      <PosOrderWorkspace additions={additions} pizzas={pizzas} saleProducts={saleProducts} />
    </PanelShell>
  );
}
