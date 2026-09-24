import { PublicStorefront, type PublicCatalog } from "@/components/public-storefront";
import type { PosComboOption } from "@/components/pos-order-workspace";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const fallbackBusiness = {
  business_name: "Modo Pizzas",
  phone: "",
  whatsapp_number: "",
  address: null,
  neighborhood: null,
  city: null,
  weekday_hours: null,
  weekend_hours: null,
  opening_hours: [],
  maps_url: null,
  info_text: null,
  instagram_url: null,
  facebook_url: null,
  email: "modopizzasmedellin@gmail.com",
  legal_contact_email: "modopizzasmedellin@gmail.com"
};

type PublicComboRow = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  image_url: string | null;
  sale_price_cop: number;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  sort_order: number;
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

function currentTimeMs() {
  return Date.now();
}

async function signedImage(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>, path: string | null) {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  const imageClient = createSupabaseAdminClient() ?? supabase;
  const { data } = await imageClient.storage.from("product-images").createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

export default async function HomePage() {
  const supabase = await createServerSupabaseClient();
  const publicCatalogClient = createSupabaseAdminClient() ?? supabase;
  const [{ data, error }, businessResult, combosResult] = await Promise.all([
    supabase.rpc("get_public_menu_catalog"),
    supabase.rpc("get_public_business_information"),
    publicCatalogClient
      .from("combo_configs")
      .select("id, sku, name, description, image_url, sale_price_cop, is_active, starts_at, ends_at, sort_order, combo_variants(id, name, sale_price_cop, sort_order, is_active, combo_groups(id, name, group_kind, quantity_to_choose, is_required, pizza_size_id, sort_order, combo_group_options(id, pizza_flavor_id, inventory_item_id, is_active, sort_order, pizza_flavors(id, name, image_url), inventory_items(id, name, image_url, sale_price_cop, sale_is_enabled))))")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
  ]);
  // The storefront remains available while its public catalog migration is pending.
  // This avoids exposing a server implementation error to visitors.
  const catalogUnavailable = Boolean(error && /get_public_menu_catalog/i.test(error.message));
  if (error && !catalogUnavailable) throw new Error(error.message);
  const fallbackCatalog: PublicCatalog = {
    pizzas: [],
    products: [],
    additions: [],
    promotions: [],
    combos: [],
    business: fallbackBusiness
  };
  const rawCatalog = (data ?? {}) as Partial<PublicCatalog>;
  const catalog: PublicCatalog = {
    ...fallbackCatalog,
    ...rawCatalog,
    pizzas: rawCatalog.pizzas ?? [],
    products: rawCatalog.products ?? [],
    additions: rawCatalog.additions ?? [],
    promotions: rawCatalog.promotions ?? [],
    combos: rawCatalog.combos ?? [],
    business: { ...fallbackBusiness, ...(rawCatalog.business ?? {}), ...(businessResult.data ?? {}) }
  };
  const pizzaPriceByFlavorAndSize = new Map(catalog.pizzas.map((price) => [`${price.flavor_id}:${price.size_id}`, price]));
  const now = currentTimeMs();
  const comboRows = ((combosResult.data ?? []) as unknown as PublicComboRow[]).filter((combo) => combo.is_active && (!combo.starts_at || new Date(combo.starts_at).getTime() <= now) && (!combo.ends_at || new Date(combo.ends_at).getTime() >= now));
  const combos: PosComboOption[] = await Promise.all(comboRows.map(async (combo) => {
    const variants = await Promise.all((combo.combo_variants ?? []).filter((variant) => variant.is_active).sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)).map(async (variant) => ({
      id: variant.id,
      name: variant.name,
      sale_price_cop: Number(variant.sale_price_cop ?? 0),
      groups: await Promise.all((variant.combo_groups ?? []).sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)).map(async (group) => ({
        id: group.id,
        name: group.name,
        group_kind: group.group_kind,
        quantity_to_choose: Number(group.quantity_to_choose ?? 1),
        is_required: group.is_required,
        pizza_size_id: group.pizza_size_id,
        sort_order: Number(group.sort_order ?? 0),
        options: await Promise.all((group.combo_group_options ?? []).filter((option) => option.is_active).sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)).map(async (option) => {
          const pizza = option.pizza_flavor_id && group.pizza_size_id ? pizzaPriceByFlavorAndSize.get(`${option.pizza_flavor_id}:${group.pizza_size_id}`) : null;
          const product = option.inventory_item_id ? catalog.products.find((candidate) => candidate.id === option.inventory_item_id) : null;
          return {
            id: option.id,
            name: option.pizza_flavors?.name ?? product?.name ?? option.inventory_items?.name ?? "Opción",
            image_src: await signedImage(supabase, option.pizza_flavors?.image_url ?? product?.image_url ?? option.inventory_items?.image_url ?? null),
            presentation: pizza?.size_name ?? (product ? `${product.presentation_quantity ?? ""} ${product.presentation_unit ?? ""}`.trim() : null),
            pizza_flavor_id: option.pizza_flavor_id,
            pizza_price_config_id: pizza?.id ?? null,
            inventory_item_id: option.inventory_item_id,
            unit_price_cop: Number(pizza?.sale_price_cop ?? product?.sale_price_cop ?? option.inventory_items?.sale_price_cop ?? 0)
          };
        }))
      })))
    })));
    const imageSrc = await signedImage(supabase, combo.image_url);
    return {
      id: combo.id,
      sku: combo.sku,
      name: combo.name,
      description: combo.description,
      image_src: imageSrc ?? variants.flatMap((variant) => variant.groups.flatMap((group) => group.options.map((option) => option.image_src).filter((src): src is string => Boolean(src))))[0] ?? null,
      sale_price_cop: Number(combo.sale_price_cop ?? 0),
      normal_price_cop: 0,
      variants
    };
  }));
  const imagePaths = new Set<string>();
  for (const collection of [catalog.pizzas, catalog.products, catalog.additions, catalog.promotions]) {
    for (const item of collection) if (item.image_url) imagePaths.add(item.image_url);
  }
  const signed = new Map(await Promise.all([...imagePaths].map(async (path) => [path, await signedImage(supabase, path)] as const)));
  const withSignedImage = <T extends { image_url: string | null }>(items: T[]) => items.map((item) => ({ ...item, image_url: item.image_url ? signed.get(item.image_url) ?? null : null }));
  return <PublicStorefront catalog={{ ...catalog, combos, pizzas: withSignedImage(catalog.pizzas), products: withSignedImage(catalog.products), additions: withSignedImage(catalog.additions), promotions: withSignedImage(catalog.promotions) }} catalogUnavailable={catalogUnavailable} />;
}
