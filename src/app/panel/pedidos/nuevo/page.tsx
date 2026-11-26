import { PanelShell } from "@/components/panel-shell";
import { PosOrderWorkspace, type CartLine, type PosAdditionOption, type PosComboOption, type PosEditablePendingOrder, type PosOrderTableOption, type PosPackagingRule, type PosPendingPayment, type PosPizzaBaseOption, type PosPizzaOption, type PosPlatformPaymentSetting, type PosSaleProductOption, type ProductViewSettings } from "@/components/pos-order-workspace";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePanelAccess } from "@/lib/panel-auth";
import { formatPresentationQuantity, formatStockQuantity, type StockUnit } from "@/lib/units";

export const dynamic = "force-dynamic";

const productImageBucket = "product-images";
const defaultProductViewSettings: ProductViewSettings = {
  showCost: true,
  showStock: true,
  showSoldOut: true,
  showSearch: true,
  showPizzaPhoto: true,
  showPizzaFlavor: true,
  showPizzaCategory: true,
  showPizzaPrice: true,
  showPrintPreview: true
};

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
  pos_image_url: string | null;
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
  stock_base: number | null;
  unit_cost_cop: number | null;
};

type PizzaBaseOptionRow = {
  pizza_size_id: string;
  source_kind: "inventory_item" | "preparation";
  source_id: string;
  source_name: string;
  quantity_base: number;
  unit: StockUnit;
  is_default: boolean;
  available_quantity: number;
};

type PlatformPaymentSettingRow = {
  platform: "rappi" | "didi";
  commission_percent: number | string;
  fixed_fee_cop: number | string;
  commission_tax_percent: number | string | null;
  didi_tu_negocio_commission_percent: number | string | null;
  didi_tu_negocio_fixed_fee_cop: number | string | null;
  didi_tu_negocio_commission_tax_percent: number | string | null;
};

type PendingPaymentRow = {
  id: string;
  code: string;
  kind: "local" | "pickup" | "delivery";
  ordered_at: string;
  customer_name: string | null;
  table_id: string | null;
  table_name_snapshot?: string | null;
  total_cop: number | string;
  pos_order_items: Array<{
    item_kind: "pizza" | "sale_product" | "free_sale" | "temporary_menu";
    quantity: number | string;
    product_name_snapshot: string | null;
    unit_price_cop: number | string;
    line_subtotal_cop: number | string;
    inventory_item: Array<{ presentation_quantity: number | string | null; presentation_unit: StockUnit | null }> | { presentation_quantity: number | string | null; presentation_unit: StockUnit | null } | null;
  }>;
};

type EditablePendingOrderRow = {
  id: string;
  code: string;
  kind: "local" | "pickup" | "delivery";
  customer_name: string | null;
  customer_phone: string | null;
  notes: string | null;
  discount_cop: number | string;
  ordered_at: string;
  table_id: string | null;
  source_channel: string;
  collection_party: string;
  pos_order_items: Array<{
    id: string;
    item_kind: "pizza" | "sale_product" | "free_sale" | "temporary_menu";
    pizza_price_config_id: string | null;
    inventory_item_id: string | null;
    cart_line_key: string | null;
    quantity: number | string;
    product_name_snapshot: string;
    sku_snapshot: string | null;
    unit_price_cop: number | string;
    notes: string | null;
    pos_order_temporary_menu_details: {
      catalog_code: string;
      components_snapshot: unknown;
      selection_snapshot: unknown;
    } | Array<{
      catalog_code: string;
      components_snapshot: unknown;
      selection_snapshot: unknown;
    }> | null;
    pos_order_item_additions: Array<{
      addition_id: string;
      name_snapshot: string;
      sku_snapshot: string | null;
      quantity: number | string;
      unit_price_cop: number | string;
    }>;
  }>;
  pos_order_combo_snapshots: Array<{ id: string }>;
  direct_sale_purchases: Array<{
    id: string;
    order_item_id: string;
    inventory_item_id: string | null;
    acquisition_unit_cost_cop: number | string;
    funds_origin: "cash_session" | "external";
    observation: string | null;
    cash_movement_id: string | null;
  }>;
  kitchen_order_items: Array<{ status: string }>;
};

type PackagingRuleRow = {
  id: string;
  target_kind: "pizza_size" | "sale_product";
  pizza_size_id: string | null;
  sale_product_id: string | null;
  service_kind: "local" | "pickup" | "takeaway" | "delivery";
  packaging_inventory_item_id: string;
  quantity_base: number | string;
  packaging_item: { name: string } | null;
};

type ProductViewSettingsRow = { settings: unknown };

function parseProductViewSettings(value: unknown): ProductViewSettings {
  if (!value || typeof value !== "object") return defaultProductViewSettings;
  const settings = value as Record<string, unknown>;
  return {
    showCost: typeof settings.showCost === "boolean" ? settings.showCost : defaultProductViewSettings.showCost,
    showStock: typeof settings.showStock === "boolean" ? settings.showStock : defaultProductViewSettings.showStock,
    showSoldOut: typeof settings.showSoldOut === "boolean" ? settings.showSoldOut : defaultProductViewSettings.showSoldOut,
    showSearch: typeof settings.showSearch === "boolean" ? settings.showSearch : defaultProductViewSettings.showSearch,
    showPizzaPhoto: typeof settings.showPizzaPhoto === "boolean" ? settings.showPizzaPhoto : defaultProductViewSettings.showPizzaPhoto,
    showPizzaFlavor: typeof settings.showPizzaFlavor === "boolean" ? settings.showPizzaFlavor : defaultProductViewSettings.showPizzaFlavor,
    showPizzaCategory: typeof settings.showPizzaCategory === "boolean" ? settings.showPizzaCategory : defaultProductViewSettings.showPizzaCategory,
    showPizzaPrice: typeof settings.showPizzaPrice === "boolean" ? settings.showPizzaPrice : defaultProductViewSettings.showPizzaPrice,
    showPrintPreview: typeof settings.showPrintPreview === "boolean" ? settings.showPrintPreview : defaultProductViewSettings.showPrintPreview
  };
}

function bogotaDayRange() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const date = `${value("year")}-${value("month")}-${value("day")}`;
  const start = new Date(`${date}T00:00:00-05:00`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

type ComboRow = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  image_url: string | null;
  sale_price_cop: number;
  combo_variants: Array<{
    id: string;
    name: string;
    sale_price_cop: number;
    sort_order: number | null;
    is_active: boolean;
    combo_groups: Array<{
    id: string;
    name: string;
    group_kind: "pizza" | "sale_product";
    quantity_to_choose: number;
    is_required: boolean;
    pizza_size_id: string | null;
    sort_order: number | null;
    combo_group_options: Array<{
      id: string;
      pizza_flavor_id: string | null;
      inventory_item_id: string | null;
      is_active: boolean;
      sort_order: number | null;
      pizza_flavors: { id: string; name: string; image_url: string | null } | null;
      inventory_items: { id: string; name: string; image_url: string | null; sale_price_cop: number | null; sale_is_enabled: boolean | null } | null;
    }>;
  }>;
  }>;
};

function isDirectImageUrl(path: string) {
  return path.startsWith("http") || path.startsWith("/") || path.startsWith("data:");
}

async function signedImageUrls(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>, paths: Array<string | null | undefined>) {
  const urls = new Map<string, string | null>();
  const uniquePaths = [...new Set(paths.filter((path): path is string => Boolean(path)))];
  const privatePaths = uniquePaths.filter((path) => !isDirectImageUrl(path));

  for (const path of uniquePaths.filter(isDirectImageUrl)) urls.set(path, path);
  if (privatePaths.length === 0) return urls;

  const { data } = await supabase.storage.from(productImageBucket).createSignedUrls(privatePaths, 60 * 60);
  data?.forEach((entry, index) => urls.set(privatePaths[index], entry.signedUrl ?? null));
  return urls;
}

function posPizzaFallbackImage(name: string) {
  const images: Record<string, string> = {
    CARNES: "/pos-pizzas/carnes.png",
    HAWAIANA: "/pos-pizzas/hawaiana.png",
    JAMON: "/pos-pizzas/jamon.png",
    PEPPERONI: "/pos-pizzas/pepperoni.png",
    "POLLO CON CHAMPINONES": "/pos-pizzas/pollo-con-champinones.png",
    SUPREMA: "/pos-pizzas/suprema.png",
    TOCINETA: "/pos-pizzas/tocineta.png",
    VEGETARIANA: "/pos-pizzas/vegetariana.png"
  };
  return images[name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()] ?? null;
}

function relationName(relation: { name: string } | { name: string }[] | null) {
  if (Array.isArray(relation)) return relation[0]?.name ?? null;
  return relation?.name ?? null;
}

export default async function NuevoPedidoPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const supabase = await createServerSupabaseClient();
  const { user, roleNames, moduleKeys } = await requirePanelAccess(supabase, "pedidos");
  const { edit: editOrderId } = await searchParams;

  const [
    flavorsResult,
    sizesResult,
    pricesResult,
    flavorIngredientsResult,
    additionsResult,
    saleProductsResult,
    combosResult,
    baseOptionsResult,
    platformPaymentSettingsResult,
    orderTablesResult,
    pendingPaymentsResult,
    paidPaymentsResult,
    packagingRulesResult,
    productViewSettingsResult
  ] = await Promise.all([
    supabase
      .from("pizza_flavors")
      .select("id, name, image_url, pos_image_url, allows_half_and_half, menu_category_id, menu_categories(name)")
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
    supabase.rpc("get_pos_sale_product_catalog"),
    supabase
      .from("combo_configs")
      .select("id, sku, name, description, image_url, sale_price_cop, combo_variants(id, name, sale_price_cop, sort_order, is_active, combo_groups(id, name, group_kind, quantity_to_choose, is_required, pizza_size_id, sort_order, combo_group_options(id, pizza_flavor_id, inventory_item_id, is_active, sort_order, pizza_flavors(id, name, image_url), inventory_items(id, name, image_url, sale_price_cop, sale_is_enabled))))")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    supabase.rpc("get_pos_pizza_base_options"),
    supabase
      .from("platform_payment_settings")
      .select("*")
      .order("platform"),
    supabase.from("order_tables").select("id, name").eq("is_active", true).order("sort_order").order("name"),
    supabase.from("pos_orders").select("id, code, kind, ordered_at, customer_name, table_id, table_name_snapshot, total_cop, pos_order_items(item_kind, quantity, product_name_snapshot, unit_price_cop, line_subtotal_cop, inventory_item:inventory_items!pos_order_items_inventory_item_id_fkey(presentation_quantity, presentation_unit))").eq("payment_method", "pending").neq("status", "cancelled").order("ordered_at", { ascending: false }),
    (() => {
      const today = bogotaDayRange();
      return supabase.from("pos_orders").select("id, code, kind, ordered_at, customer_name, table_id, table_name_snapshot, total_cop, pos_order_items(item_kind, quantity, product_name_snapshot, unit_price_cop, line_subtotal_cop, inventory_item:inventory_items!pos_order_items_inventory_item_id_fkey(presentation_quantity, presentation_unit))").neq("payment_method", "pending").neq("status", "cancelled").gte("ordered_at", today.from).lt("ordered_at", today.to).order("ordered_at", { ascending: false });
    })(),
    supabase
      .from("pos_packaging_rules")
      .select("id, target_kind, pizza_size_id, sale_product_id, service_kind, packaging_inventory_item_id, quantity_base, packaging_item:inventory_items!pos_packaging_rules_packaging_inventory_item_id_fkey(name)")
      .eq("is_active", true),
    supabase.from("pos_user_product_view_settings").select("settings").eq("profile_id", user.id).maybeSingle()
  ]);

  const error =
    flavorsResult.error ??
    sizesResult.error ??
    pricesResult.error ??
    flavorIngredientsResult.error ??
    additionsResult.error ??
    saleProductsResult.error ??
    combosResult.error ??
    baseOptionsResult.error ??
    platformPaymentSettingsResult.error;

  const flavorRows = (flavorsResult.data ?? []) as unknown as FlavorRow[];
  const initialProductViewSettings = parseProductViewSettings((productViewSettingsResult.data as ProductViewSettingsRow | null)?.settings);
  const additionRows = (additionsResult.data ?? []) as unknown as AdditionRow[];
  const saleProductRows = (saleProductsResult.data ?? []) as SaleProductRow[];
  const comboRows = (combosResult.data ?? []) as unknown as ComboRow[];
  const pizzaImagePathByFlavor = new Map(
    flavorRows.map((flavor) => [flavor.id, flavor.pos_image_url ?? posPizzaFallbackImage(flavor.name) ?? flavor.image_url] as const)
  );
  const imageSrcByPath = await signedImageUrls(supabase, [
    ...pizzaImagePathByFlavor.values(),
    ...additionRows.map((addition) => addition.inventory_items?.image_url ?? null),
    ...saleProductRows.map((product) => product.image_url),
    ...comboRows.map((combo) => combo.image_url)
  ]);
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
      image_src: imageSrcByPath.get(pizzaImagePathByFlavor.get(flavor.id) ?? "") ?? null,
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
  for (const addition of additionRows) {
    for (const size of addition.pizza_addition_sizes ?? []) {
      additions.push({
        id: addition.id,
        sku: addition.sku,
        name: addition.name,
        image_src: imageSrcByPath.get(addition.inventory_items?.image_url ?? "") ?? null,
        size_id: size.pizza_size_id,
        flavor_ids: (addition.pizza_addition_flavors ?? []).map((item) => item.flavor_id),
        category_ids: (addition.pizza_addition_categories ?? []).map((item) => item.menu_category_id),
        max_allowed: Number(addition.max_allowed ?? 1),
        price_cop: Number(size.price_cop ?? 0)
      });
    }
  }

  const saleProducts: PosSaleProductOption[] = saleProductRows.map((product) => {
      return {
        id: product.id,
        sku: product.sku,
        name: product.name,
        image_src: imageSrcByPath.get(product.image_url ?? "") ?? null,
        presentation:
          product.presentation_quantity && product.presentation_unit
            ? formatPresentationQuantity(Number(product.presentation_quantity), product.presentation_unit as StockUnit)
            : null,
        sale_price_cop: Number(product.sale_price_cop ?? 0),
        stock_base: Number(product.stock_base ?? 0),
        unit_cost_cop: product.unit_cost_cop === null ? null : Number(product.unit_cost_cop),
        unit: "unit"
      };
    });
  const baseOptions: PosPizzaBaseOption[] = ((baseOptionsResult.data ?? []) as unknown as PizzaBaseOptionRow[]).map((option) => ({
    pizza_size_id: option.pizza_size_id,
    source_kind: option.source_kind,
    source_id: option.source_id,
    source_name: option.source_name,
    quantity_base: Number(option.quantity_base),
    unit: option.unit,
    is_default: option.is_default,
    available_quantity: Number(option.available_quantity)
  }));
  const platformPaymentSettings: PosPlatformPaymentSetting[] = ((platformPaymentSettingsResult.data ?? []) as PlatformPaymentSettingRow[]).map((setting) => ({
    platform: setting.platform,
    commission_percent: Number(setting.commission_percent ?? 0),
    fixed_fee_cop: Number(setting.fixed_fee_cop ?? 0),
    commission_tax_percent: Number(setting.commission_tax_percent ?? 0),
    didi_tu_negocio_commission_percent: Number(setting.didi_tu_negocio_commission_percent ?? 9.5),
    didi_tu_negocio_fixed_fee_cop: Number(setting.didi_tu_negocio_fixed_fee_cop ?? 0),
    didi_tu_negocio_commission_tax_percent: Number(setting.didi_tu_negocio_commission_tax_percent ?? 0)
  }));
  const orderTables: PosOrderTableOption[] = orderTablesResult.error ? [] : ((orderTablesResult.data ?? []) as PosOrderTableOption[]);
  const pendingPayments: PosPendingPayment[] = ((pendingPaymentsResult.data ?? []) as unknown as PendingPaymentRow[]).map((order) => ({
    id: order.id,
    code: order.code,
    kind: order.kind,
    ordered_at: order.ordered_at,
    customer_name: order.customer_name,
    table_id: order.table_id,
    table_name: order.table_name_snapshot ?? null,
    total_cop: Number(order.total_cop ?? 0),
    items: (order.pos_order_items ?? []).flatMap((item) => {
      if (!item.product_name_snapshot || Number(item.quantity) <= 0) return [];
      const inventoryItem = Array.isArray(item.inventory_item) ? item.inventory_item[0] ?? null : item.inventory_item;
      const presentation = item.item_kind === "sale_product" && inventoryItem?.presentation_quantity && inventoryItem.presentation_unit
        ? formatPresentationQuantity(Number(inventoryItem.presentation_quantity), inventoryItem.presentation_unit)
        : null;
      return [{ name: presentation && !item.product_name_snapshot.includes(presentation) ? `${item.product_name_snapshot} ${presentation}` : item.product_name_snapshot, quantity: Number(item.quantity), unit_price_cop: Number(item.unit_price_cop ?? 0), line_subtotal_cop: Number(item.line_subtotal_cop ?? 0) }];
    })
  }));
  const paidTodayPayments: PosPendingPayment[] = ((paidPaymentsResult.data ?? []) as unknown as PendingPaymentRow[]).map((order) => ({
    id: order.id,
    code: order.code,
    kind: order.kind,
    ordered_at: order.ordered_at,
    customer_name: order.customer_name,
    table_id: order.table_id,
    table_name: order.table_name_snapshot ?? null,
    total_cop: Number(order.total_cop ?? 0),
    items: (order.pos_order_items ?? []).flatMap((item) => {
      if (!item.product_name_snapshot || Number(item.quantity) <= 0) return [];
      const inventoryItem = Array.isArray(item.inventory_item) ? item.inventory_item[0] ?? null : item.inventory_item;
      const presentation = item.item_kind === "sale_product" && inventoryItem?.presentation_quantity && inventoryItem.presentation_unit
        ? formatPresentationQuantity(Number(inventoryItem.presentation_quantity), inventoryItem.presentation_unit)
        : null;
      return [{ name: presentation && !item.product_name_snapshot.includes(presentation) ? `${item.product_name_snapshot} ${presentation}` : item.product_name_snapshot, quantity: Number(item.quantity), unit_price_cop: Number(item.unit_price_cop ?? 0), line_subtotal_cop: Number(item.line_subtotal_cop ?? 0) }];
    })
  }));
  const packagingRules: PosPackagingRule[] = packagingRulesResult.error ? [] : ((packagingRulesResult.data ?? []) as unknown as PackagingRuleRow[])
    .map((rule) => ({
      id: rule.id,
      target_kind: rule.target_kind,
      target_id: rule.target_kind === "pizza_size" ? rule.pizza_size_id ?? "" : rule.sale_product_id ?? "",
      service_kind: rule.service_kind,
      packaging_inventory_item_id: rule.packaging_inventory_item_id,
      packaging_name: rule.packaging_item?.name ?? "Empaque",
      quantity_base: Number(rule.quantity_base ?? 0)
    }))
    .filter((rule) => rule.target_id && rule.quantity_base > 0);
  const priceByFlavorAndSize = new Map<string, { price_config_id: string; sale_price_cop: number }>();
  const flavorImageById = new Map(pizzas.map((pizza) => [pizza.flavor_id, pizza.image_src]));
  const sizeNameById = new Map(sizeRows.map((size) => [size.id, size.name]));
  for (const pizza of pizzas) {
    for (const price of pizza.prices) {
      if (!price.id || price.price_cop === null) continue;
      priceByFlavorAndSize.set(`${pizza.flavor_id}:${price.size_id}`, { price_config_id: price.id, sale_price_cop: price.price_cop });
    }
  }
  const productById = new Map(saleProducts.map((product) => [product.id, product]));
  const combos: PosComboOption[] = await Promise.all(
    comboRows.map(async (combo) => {
      const variants = (combo.combo_variants ?? [])
        .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
        .map((variant) => ({
          id: variant.id,
          name: variant.name,
          sale_price_cop: Number(variant.sale_price_cop ?? 0),
          groups: (variant.combo_groups ?? [])
        .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
        .map((group) => ({
          id: group.id,
          name: group.name,
          group_kind: group.group_kind,
          quantity_to_choose: Number(group.quantity_to_choose ?? 1),
          is_required: group.is_required,
          pizza_size_id: group.pizza_size_id,
          sort_order: Number(group.sort_order ?? 0),
          options: (group.combo_group_options ?? [])
            // Options are references, not names. Keep the configured active reference
            // so an inactive historical alternative cannot appear as a second beverage.
            .filter((option) => option.is_active)
            .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
            .map((option) => {
              if (group.group_kind === "pizza") {
                const price = option.pizza_flavor_id && group.pizza_size_id ? priceByFlavorAndSize.get(`${option.pizza_flavor_id}:${group.pizza_size_id}`) : null;
                return {
                  id: option.id,
                  name: option.pizza_flavors?.name ?? "Pizza",
                  image_src: option.pizza_flavor_id ? flavorImageById.get(option.pizza_flavor_id) ?? null : null,
                  presentation: group.pizza_size_id ? sizeNameById.get(group.pizza_size_id) ?? null : null,
                  pizza_flavor_id: option.pizza_flavor_id,
                  pizza_price_config_id: price?.price_config_id ?? null,
                  inventory_item_id: null,
                  unit_price_cop: Number(price?.sale_price_cop ?? 0),
                };
              }
              const product = option.inventory_item_id ? productById.get(option.inventory_item_id) : null;
              return {
                id: option.id,
                name: product?.name ?? option.inventory_items?.name ?? "Producto",
                image_src: product?.image_src ?? null,
                presentation: product?.presentation ?? null,
                pizza_flavor_id: null,
                pizza_price_config_id: null,
                inventory_item_id: option.inventory_item_id,
                unit_price_cop: Number(product?.sale_price_cop ?? option.inventory_items?.sale_price_cop ?? 0),
              };
            })
            .filter((option) => option.unit_price_cop > 0 && (option.pizza_price_config_id || option.inventory_item_id))
        }))
        .filter((group) => group.options.length >= group.quantity_to_choose)
        }))
        .filter((variant) => variant.groups.length > 0);
      const normalPrice = variants.reduce((min, variant) => {
        const value = variant.groups.reduce((sum, group) => {
        const prices = group.options.map((option) => option.unit_price_cop).filter((price) => price > 0);
          return sum + (prices.length ? Math.min(...prices) * group.quantity_to_choose : 0);
        }, 0);
        return min === 0 ? value : Math.min(min, value);
      }, 0);
      return {
        id: combo.id,
        sku: combo.sku,
        name: combo.name,
        description: combo.description,
        image_src: imageSrcByPath.get(combo.image_url ?? "") ?? null,
        sale_price_cop: variants.length ? Math.min(...variants.map((variant) => variant.sale_price_cop)) : Number(combo.sale_price_cop ?? 0),
        normal_price_cop: normalPrice,
        variants
      };
    })
  );

  let editingOrder: PosEditablePendingOrder | null = null;
  let editError = "";
  if (editOrderId) {
    const { data, error: pendingOrderError } = await supabase
      .from("pos_orders")
      .select("id, code, kind, customer_name, customer_phone, notes, discount_cop, ordered_at, table_id, source_channel, collection_party, pos_order_items(id, item_kind, pizza_price_config_id, inventory_item_id, cart_line_key, quantity, product_name_snapshot, sku_snapshot, unit_price_cop, notes, pos_order_temporary_menu_details(catalog_code, components_snapshot, selection_snapshot), pos_order_item_additions(addition_id, name_snapshot, sku_snapshot, quantity, unit_price_cop)), pos_order_combo_snapshots(id), direct_sale_purchases(id, order_item_id, inventory_item_id, acquisition_unit_cost_cop, funds_origin, observation, cash_movement_id), kitchen_order_items(status)")
      .eq("id", editOrderId)
      .eq("payment_method", "pending")
      .neq("status", "cancelled")
      .maybeSingle();
    const pendingOrder = data as unknown as EditablePendingOrderRow | null;
    if (pendingOrderError || !pendingOrder) {
      editError = pendingOrderError?.message ?? "El pedido pendiente ya no está disponible para edición.";
    } else if (pendingOrder.source_channel !== "direct" || pendingOrder.collection_party !== "business") {
      editError = "Solo se pueden editar pedidos pendientes de cobro directo.";
    } else if (pendingOrder.pos_order_combo_snapshots.length > 0) {
      editError = "Los combos pendientes todavía no se pueden editar de forma segura desde cobros pendientes.";
    } else if (pendingOrder.direct_sale_purchases.some((purchase) => purchase.cash_movement_id)) {
      editError = "Este pedido incluye una venta libre pagada desde caja y no se puede reemplazar sin alterar su movimiento de caja.";
    } else if (pendingOrder.kitchen_order_items.some((item) => item.status !== "pending")) {
      editError = "No se puede editar un pedido cuya preparación ya fue iniciada.";
    } else {
      const directPurchasesByOrderItemId = new Map(pendingOrder.direct_sale_purchases.map((purchase) => [purchase.order_item_id, purchase]));
      const cart = pendingOrder.pos_order_items.map((item, index): CartLine | null => {
        if (item.item_kind === "pizza") {
          const pizzaWithPrice = pizzas
            .flatMap((pizza) => pizza.prices.map((price) => ({ pizza, price })))
            .find((entry) => entry.price.id === item.pizza_price_config_id);
          if (!pizzaWithPrice || !pizzaWithPrice.price.id) return null;
          const snapshotWithoutSize = item.product_name_snapshot.endsWith(` ${pizzaWithPrice.price.size_name}`)
            ? item.product_name_snapshot.slice(0, -(` ${pizzaWithPrice.price.size_name}`).length)
            : item.product_name_snapshot;
          const pizzaFlavors = snapshotWithoutSize.split(" / ");
          const secondaryFlavorName = pizzaFlavors.length === 2 ? pizzaFlavors[1] : null;
          const secondaryPrice = secondaryFlavorName
            ? pizzas.find((pizza) => pizza.flavor_name === secondaryFlavorName)?.prices.find((price) => price.size_id === pizzaWithPrice.price.size_id && price.id)
            : null;
          if (secondaryFlavorName && !secondaryPrice?.id) return null;
          return {
            key: item.cart_line_key ?? `edit-${item.id}`,
            signature: `edit-${item.id}-${index}`,
            kind: "pizza",
            id: pizzaWithPrice.price.id,
            secondary_id: secondaryPrice?.id ?? null,
            name: item.product_name_snapshot,
            sku: pizzaWithPrice.price.sku,
            image_src: pizzaWithPrice.pizza.image_src,
            quantity: Number(item.quantity),
            unit_price_cop: Number(item.unit_price_cop),
            notes: item.notes ?? undefined,
            additions: item.pos_order_item_additions.map((addition, additionIndex) => {
              const configured = additions.find((candidate) => candidate.id === addition.addition_id && candidate.size_id === pizzaWithPrice.price.size_id)
                ?? additions.find((candidate) => candidate.id === addition.addition_id);
              return {
                key: `edit-${item.id}-addition-${additionIndex}`,
                id: addition.addition_id,
                name: configured?.name ?? addition.name_snapshot,
                sku: configured?.sku ?? addition.sku_snapshot ?? "",
                quantity: Number(addition.quantity),
                unit_price_cop: Number(addition.unit_price_cop),
                scope: "whole"
              };
            })
          };
        }
        if (item.item_kind === "free_sale") {
          const purchase = directPurchasesByOrderItemId.get(item.id);
          if (!purchase || !item.cart_line_key) return null;
          return {
            key: item.cart_line_key,
            signature: `edit-${item.id}-${index}`,
            kind: "direct_sale",
            id: `direct-${item.id}`,
            name: item.product_name_snapshot,
            sku: item.sku_snapshot,
            image_src: null,
            quantity: Number(item.quantity),
            unit_price_cop: Number(item.unit_price_cop),
            notes: item.notes ?? undefined,
            additions: [],
            direct_sale: {
              inventory_item_id: purchase.inventory_item_id,
              acquisition_unit_cost_cop: Number(purchase.acquisition_unit_cost_cop),
              funds_origin: purchase.funds_origin,
              observation: purchase.observation ?? ""
            }
          };
        }
        if (item.item_kind === "temporary_menu") {
          const detail = Array.isArray(item.pos_order_temporary_menu_details)
            ? item.pos_order_temporary_menu_details[0]
            : item.pos_order_temporary_menu_details;
          if (!detail || !Array.isArray(detail.components_snapshot) || !detail.selection_snapshot || typeof detail.selection_snapshot !== "object") return null;
          const selection = detail.selection_snapshot as Record<string, unknown>;
          const selectionMode = selection.mode === "drink" || selection.mode === "fries" ? selection.mode : "none";
          const components = detail.components_snapshot.flatMap((component) => {
            if (!component || typeof component !== "object") return [];
            const value = component as Record<string, unknown>;
            return typeof value.name === "string" && typeof value.quantity === "string" ? [{ name: value.name, quantity: value.quantity }] : [];
          });
          if (components.length === 0) return null;
          return {
            key: item.cart_line_key ?? `edit-${item.id}`,
            signature: `edit-${item.id}-${index}`,
            kind: "temporary_menu",
            id: detail.catalog_code,
            name: item.product_name_snapshot,
            sku: item.sku_snapshot,
            image_src: null,
            quantity: Number(item.quantity),
            unit_price_cop: Number(item.unit_price_cop),
            notes: item.notes ?? undefined,
            additions: [],
            temporary_menu: {
              family: detail.catalog_code === "LASANA-CARNE" ? "lasagnas" : "wings",
              selection_mode: selectionMode,
              beverage_inventory_item_id: typeof selection.beverage_inventory_item_id === "string" ? selection.beverage_inventory_item_id : null,
              beverage_name: typeof selection.beverage_name === "string" ? selection.beverage_name : null,
              components
            }
          };
        }
        const product = item.inventory_item_id ? productById.get(item.inventory_item_id) : null;
        if (!product) return null;
        return {
          key: item.cart_line_key ?? `edit-${item.id}`,
          signature: `edit-${item.id}-${index}`,
          kind: "sale_product",
          id: product.id,
          name: product.name,
          sku: product.sku,
          image_src: product.image_src,
          quantity: Number(item.quantity),
          unit_price_cop: Number(item.unit_price_cop),
          notes: item.notes ?? undefined,
          additions: []
        };
      });
      if (cart.some((item) => item === null)) {
        editError = "Este pedido contiene un producto que ya no está disponible para edición.";
      } else {
        const saleDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(pendingOrder.ordered_at));
        editingOrder = {
          id: pendingOrder.id,
          code: pendingOrder.code,
          cart: cart as CartLine[],
          kind: pendingOrder.kind,
          pickupMode: "pickup",
          tableId: pendingOrder.table_id ?? "",
          customerName: pendingOrder.customer_name ?? "",
          customerPhone: pendingOrder.customer_phone ?? "",
          notes: pendingOrder.notes ?? "",
          discountCop: Number(pendingOrder.discount_cop ?? 0),
          saleDate
        };
      }
    }
  }

  return (
    <PanelShell active="pedidos-nuevo" hideHeader moduleKeys={moduleKeys} roleNames={roleNames} title="Crear pedido" userEmail={user.email ?? "usuario"}>
      {error ? <p className="alert">{error.message}</p> : null}
      {editError ? <p className="alert">{editError}</p> : null}
      <PosOrderWorkspace key={editingOrder?.id ?? "new-order"} additions={additions} baseOptions={baseOptions} canConfigurePizzaPhotos canEditSaleDate={roleNames.includes("admin_sistema") || roleNames.includes("gerente")} canRecordPendingStock={roleNames.includes("admin_sistema") || roleNames.includes("gerente")} combos={combos} editingOrder={editingOrder} initialProductViewSettings={initialProductViewSettings} isSystemAdmin={roleNames.includes("admin_sistema")} orderTables={orderTables} packagingRules={packagingRules} paidTodayPayments={paidTodayPayments} pendingPayments={pendingPayments} pizzas={pizzas} platformPaymentSettings={platformPaymentSettings} saleProducts={saleProducts} userId={user.id} />
    </PanelShell>
  );
}
