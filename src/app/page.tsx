import { PublicStorefront, type PublicCatalog } from "@/components/public-storefront";
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

async function signedImage(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>, path: string | null) {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  const imageClient = createSupabaseAdminClient() ?? supabase;
  const { data } = await imageClient.storage.from("product-images").createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

export default async function HomePage() {
  const supabase = await createServerSupabaseClient();
  const [{ data, error }, businessResult] = await Promise.all([
    supabase.rpc("get_public_menu_catalog"),
    supabase.rpc("get_public_business_information")
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
    business: { ...fallbackBusiness, ...(rawCatalog.business ?? {}), ...(businessResult.data ?? {}) }
  };
  const imagePaths = new Set<string>();
  for (const collection of [catalog.pizzas, catalog.products, catalog.additions, catalog.promotions]) {
    for (const item of collection) if (item.image_url) imagePaths.add(item.image_url);
  }
  const signed = new Map(await Promise.all([...imagePaths].map(async (path) => [path, await signedImage(supabase, path)] as const)));
  const withSignedImage = <T extends { image_url: string | null }>(items: T[]) => items.map((item) => ({ ...item, image_url: item.image_url ? signed.get(item.image_url) ?? null : null }));
  return <PublicStorefront catalog={{ ...catalog, pizzas: withSignedImage(catalog.pizzas), products: withSignedImage(catalog.products), additions: withSignedImage(catalog.additions), promotions: withSignedImage(catalog.promotions) }} catalogUnavailable={catalogUnavailable} />;
}
