import { PanelShell } from "@/components/panel-shell";
import { ComboPricesWorkspace, type ComboPizzaFlavorOption, type ComboPriceRecord, type ComboSaleProductOption, type ComboSizeOption } from "@/components/combo-prices-workspace";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePanelAccess } from "@/lib/panel-auth";
import { formatStockQuantity, type StockUnit } from "@/lib/units";

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
    combo_group_options: Array<{
      id: string;
      pizza_flavor_id: string | null;
      inventory_item_id: string | null;
      supplement_cop: number;
      is_active: boolean;
      sort_order: number | null;
    }>;
  }>;
};

type PizzaPriceRow = {
  id: string;
  flavor_id: string;
  size_id: string;
  sale_price_cop: number;
  pizza_flavors: { id: string; name: string; image_url: string | null } | null;
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
  stock_base: number | null;
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

  const [combosResult, pricesResult, sizesResult, productsResult] = await Promise.all([
    supabase
      .from("combo_configs")
      .select("id, sku, name, description, image_url, sale_price_cop, is_active, sort_order, combo_groups(id, name, group_kind, quantity_to_choose, is_required, pizza_size_id, allow_all_flavors, sort_order, combo_group_options(id, pizza_flavor_id, inventory_item_id, supplement_cop, is_active, sort_order))")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("pizza_price_configs")
      .select("id, flavor_id, size_id, sale_price_cop, pizza_flavors(id, name, image_url)")
      .eq("is_active", true),
    supabase.from("pizza_sizes").select("id, name").eq("is_active", true).order("diameter_cm"),
    supabase.rpc("get_pos_sale_product_catalog")
  ]);

  const error = combosResult.error ?? pricesResult.error ?? sizesResult.error ?? productsResult.error;
  const priceRows = (pricesResult.data ?? []) as unknown as PizzaPriceRow[];
  const productsRows = (productsResult.data ?? []) as unknown as SaleProductRow[];
  const productById = new Map(productsRows.map((product) => [product.id, product]));

  const flavorMap = new Map<string, ComboPizzaFlavorOption>();
  for (const price of priceRows) {
    if (!price.pizza_flavors) continue;
    const existing = flavorMap.get(price.flavor_id) ?? {
      id: price.flavor_id,
      name: price.pizza_flavors.name,
      image_src: await signedImage(supabase, price.pizza_flavors.image_url),
      prices: []
    };
    existing.prices.push({ price_config_id: price.id, size_id: price.size_id, sale_price_cop: Number(price.sale_price_cop ?? 0) });
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
      stock_base: Number(product.stock_base ?? 0)
    }))
  );

  const sizes: ComboSizeOption[] = ((sizesResult.data ?? []) as ComboSizeOption[]).map((size) => ({ id: size.id, name: size.name }));

  const combos: ComboPriceRecord[] = await Promise.all(
    ((combosResult.data ?? []) as unknown as ComboRow[]).map(async (combo) => {
      const groups = (combo.combo_groups ?? [])
        .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
        .map((group) => ({
          id: group.id,
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
              supplement_cop: Number(option.supplement_cop ?? 0),
              is_active: option.is_active,
              sort_order: Number(option.sort_order ?? 0)
            }))
        }));
      const normalPrice = groups.reduce((sum, group) => {
        const prices = group.options.map((option) => {
          if (group.group_kind === "pizza") return flavorMap.get(option.pizza_flavor_id ?? "")?.prices.find((price) => price.size_id === group.pizza_size_id)?.sale_price_cop ?? 0;
          return Number(productById.get(option.inventory_item_id ?? "")?.sale_price_cop ?? 0);
        }).filter((price) => price > 0);
        return sum + (prices.length ? Math.min(...prices) * group.quantity_to_choose : 0);
      }, 0);
      return {
        id: combo.id,
        sku: combo.sku,
        name: combo.name,
        description: combo.description,
        image_url: combo.image_url,
        image_src: await signedImage(supabase, combo.image_url),
        sale_price_cop: Number(combo.sale_price_cop ?? 0),
        is_active: combo.is_active,
        sort_order: Number(combo.sort_order ?? 0),
        normal_price_cop: normalPrice,
        estimated_cost_cop: null,
        groups
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
