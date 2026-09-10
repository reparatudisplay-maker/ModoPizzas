import { notFound } from "next/navigation";
import { MarketingPromotionsWorkspace, type MarketingPromotionRecord, type MarketingSelectable } from "@/components/marketing-promotions-workspace";
import { PanelShell } from "@/components/panel-shell";
import { requirePanelAccess } from "@/lib/panel-auth";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

function isDirectImageUrl(value: string) {
  return value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:");
}

async function signedImage(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>, path: string | null) {
  if (!path || isDirectImageUrl(path)) return path;
  const { data } = await supabase.storage.from("product-images").createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

type PromotionRow = Omit<MarketingPromotionRecord, "pizza_price_ids" | "sale_product_ids" | "project_ids" | "image_src">;
type RelationRow = { promotion_id: string; pizza_price_config_id?: string; inventory_item_id?: string; project_id?: string };
type PizzaPriceRow = {
  id: string;
  sale_price_cop: number;
  pizza_flavors: { name: string; image_url: string | null } | null;
  pizza_sizes: { name: string } | null;
};
type SaleProductRow = {
  id: string;
  sku: string;
  name: string;
  image_url: string | null;
  presentation_quantity: number;
  presentation_unit: string;
  sale_price_cop: number;
};

function formatPresentation(quantity: number, unit: string) {
  const displayUnit = unit === "ml" && quantity >= 1000 ? "L" : unit === "g" && quantity >= 1000 ? "KG" : unit === "unit" ? "UND" : unit.toUpperCase();
  const displayQuantity = displayUnit === "L" || displayUnit === "KG" ? quantity / 1000 : quantity;
  return `${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(displayQuantity)} ${displayUnit}`;
}

export default async function MarketingPromocionesPage() {
  const supabase = await createServerSupabaseClient();
  const { user, roleNames, moduleKeys } = await requirePanelAccess(supabase, "marketing");
  const permissionResult = await supabase.rpc("current_user_has_permission", { p_permission_code: "marketing_promociones.view" });
  if (!permissionResult.data) notFound();

  const [
    promotionsResult,
    pizzaRelationsResult,
    saleRelationsResult,
    projectRelationsResult,
    pizzaPricesResult,
    saleProductsResult,
    projectsResult
  ] = await Promise.all([
    supabase
      .from("marketing_promotions")
      .select("id, name, image_url, main_text, secondary_text, normal_price_cop, promo_price_cop, starts_at, ends_at, status, is_active, updated_at")
      .order("updated_at", { ascending: false }),
    supabase.from("marketing_promotion_pizza_prices").select("promotion_id, pizza_price_config_id"),
    supabase.from("marketing_promotion_sale_products").select("promotion_id, inventory_item_id"),
    supabase.from("marketing_promotion_screen_projects").select("promotion_id, project_id"),
    supabase
      .from("pizza_price_configs")
      .select("id, sale_price_cop, pizza_flavors(name, image_url), pizza_sizes(name)")
      .eq("is_active", true),
    supabase
      .from("pos_sale_product_references")
      .select("id, sku, name, image_url, presentation_quantity, presentation_unit, sale_price_cop")
      .eq("sale_is_enabled", true),
    supabase.from("marketing_screen_projects").select("id, name").order("name")
  ]);

  const error =
    promotionsResult.error ??
    pizzaRelationsResult.error ??
    saleRelationsResult.error ??
    projectRelationsResult.error ??
    pizzaPricesResult.error ??
    saleProductsResult.error ??
    projectsResult.error;

  function relationMap(rows: RelationRow[], column: "pizza_price_config_id" | "inventory_item_id" | "project_id") {
    const map = new Map<string, string[]>();
    for (const row of rows) {
      const value = row[column];
      if (!value) continue;
      map.set(row.promotion_id, [...(map.get(row.promotion_id) ?? []), value]);
    }
    return map;
  }

  const pizzaMap = relationMap((pizzaRelationsResult.data ?? []) as RelationRow[], "pizza_price_config_id");
  const saleMap = relationMap((saleRelationsResult.data ?? []) as RelationRow[], "inventory_item_id");
  const projectMap = relationMap((projectRelationsResult.data ?? []) as RelationRow[], "project_id");
  const promotions = await Promise.all(
    ((promotionsResult.data ?? []) as PromotionRow[]).map(async (promotion) => ({
      ...promotion,
      image_src: await signedImage(supabase, promotion.image_url),
      normal_price_cop: promotion.normal_price_cop === null ? null : Number(promotion.normal_price_cop),
      promo_price_cop: promotion.promo_price_cop === null ? null : Number(promotion.promo_price_cop),
      pizza_price_ids: pizzaMap.get(promotion.id) ?? [],
      sale_product_ids: saleMap.get(promotion.id) ?? [],
      project_ids: projectMap.get(promotion.id) ?? []
    }))
  );
  const pizzaPrices = await Promise.all(
    ((pizzaPricesResult.data ?? []) as unknown as PizzaPriceRow[]).map(async (row) => ({
      id: row.id,
      label: `${row.pizza_flavors?.name ?? "Pizza"} ${row.pizza_sizes?.name ?? ""}`.trim(),
      price_cop: Number(row.sale_price_cop ?? 0),
      image_src: await signedImage(supabase, row.pizza_flavors?.image_url ?? null)
    }))
  );
  const saleProducts = await Promise.all(
    ((saleProductsResult.data ?? []) as unknown as SaleProductRow[]).map(async (row) => ({
      id: row.id,
      label: `${row.name} ${formatPresentation(Number(row.presentation_quantity ?? 0), row.presentation_unit)}`,
      price_cop: Number(row.sale_price_cop ?? 0),
      image_src: await signedImage(supabase, row.image_url)
    }))
  );
  const projects = (projectsResult.data ?? []).map((project) => ({ id: project.id, label: project.name })) as MarketingSelectable[];

  return (
    <PanelShell active="marketing-promociones" hideHeader moduleKeys={moduleKeys} roleNames={roleNames} title="Marketing" userEmail={user.email ?? "usuario"}>
      {error ? <p className="alert">{error.message}</p> : null}
      <MarketingPromotionsWorkspace pizzaPrices={pizzaPrices} projects={projects} promotions={promotions as MarketingPromotionRecord[]} saleProducts={saleProducts} />
    </PanelShell>
  );
}
