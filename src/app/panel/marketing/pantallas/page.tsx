import { notFound } from "next/navigation";
import { MarketingScreensWorkspace, type MarketingDataSource, type MarketingProjectRecord } from "@/components/marketing-screens-workspace";
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

type ProjectRow = Omit<MarketingProjectRecord, "scenes">;

type SceneRow = {
  id: string;
  project_id: string;
  name: string;
  sort_order: number;
  duration_seconds: number;
  background: MarketingProjectRecord["scenes"][number]["background"];
  transition: MarketingProjectRecord["scenes"][number]["transition"];
  elements: MarketingProjectRecord["scenes"][number]["elements"];
};

type PizzaPriceRow = {
  id: string;
  sale_price_cop: number;
  pizza_flavors: { name: string; image_url: string | null; menu_categories: { name: string } | null } | null;
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

type PromotionRow = {
  id: string;
  name: string;
  image_url: string | null;
  promo_price_cop: number | null;
};

function formatPresentation(quantity: number, unit: string) {
  const displayUnit = unit === "ml" && quantity >= 1000 ? "L" : unit === "g" && quantity >= 1000 ? "KG" : unit === "unit" ? "UND" : unit.toUpperCase();
  const displayQuantity = displayUnit === "L" || displayUnit === "KG" ? quantity / 1000 : quantity;
  return `${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(displayQuantity)} ${displayUnit}`;
}

export default async function MarketingPantallasPage() {
  const supabase = await createServerSupabaseClient();
  const { user, roleNames, moduleKeys } = await requirePanelAccess(supabase, "marketing");
  const permissionResult = await supabase.rpc("current_user_has_permission", { p_permission_code: "marketing_pantallas.view" });
  if (!permissionResult.data) notFound();

  const [projectsResult, scenesResult, pizzaPricesResult, saleProductsResult, promotionsResult] = await Promise.all([
    supabase
      .from("marketing_screen_projects")
      .select("id, name, resolution_preset, width_px, height_px, orientation, duration_total_seconds, status, updated_at")
      .order("updated_at", { ascending: false }),
    supabase.from("marketing_screen_scenes").select("id, project_id, name, sort_order, duration_seconds, background, transition, elements").order("sort_order"),
    supabase
      .from("pizza_price_configs")
      .select("id, sale_price_cop, pizza_flavors(name, image_url, menu_categories(name)), pizza_sizes(name)")
      .eq("is_active", true),
    supabase
      .from("pos_sale_product_references")
      .select("id, sku, name, image_url, presentation_quantity, presentation_unit, sale_price_cop")
      .eq("sale_is_enabled", true),
    supabase.from("marketing_promotions").select("id, name, image_url, promo_price_cop").eq("is_active", true)
  ]);

  const error = projectsResult.error ?? scenesResult.error ?? pizzaPricesResult.error ?? saleProductsResult.error ?? promotionsResult.error;
  const scenesByProject = new Map<string, SceneRow[]>();
  for (const scene of (scenesResult.data ?? []) as unknown as SceneRow[]) {
    scenesByProject.set(scene.project_id, [...(scenesByProject.get(scene.project_id) ?? []), scene]);
  }
  const projects = ((projectsResult.data ?? []) as unknown as ProjectRow[]).map((project) => ({
    ...project,
    scenes: (scenesByProject.get(project.id) ?? []).map((scene) => ({
      id: scene.id,
      name: scene.name,
      duration_seconds: Number(scene.duration_seconds ?? 8),
      transition: scene.transition,
      background: scene.background,
      elements: scene.elements
    }))
  })) as MarketingProjectRecord[];

  const pizzaSources = await Promise.all(
    ((pizzaPricesResult.data ?? []) as unknown as PizzaPriceRow[]).map(async (row) => ({
      id: row.id,
      kind: "pizza_price" as const,
      label: `${row.pizza_flavors?.name ?? "Pizza"} ${row.pizza_sizes?.name ?? ""}`.trim(),
      meta: row.pizza_flavors?.menu_categories?.name ?? null,
      price_cop: Number(row.sale_price_cop ?? 0),
      image_src: await signedImage(supabase, row.pizza_flavors?.image_url ?? null)
    }))
  );
  const productSources = await Promise.all(
    ((saleProductsResult.data ?? []) as unknown as SaleProductRow[]).map(async (row) => ({
      id: row.id,
      kind: "sale_product" as const,
      label: `${row.name} ${formatPresentation(Number(row.presentation_quantity ?? 0), row.presentation_unit)}`,
      meta: row.sku,
      price_cop: Number(row.sale_price_cop ?? 0),
      image_src: await signedImage(supabase, row.image_url)
    }))
  );
  const promotionSources = await Promise.all(
    ((promotionsResult.data ?? []) as unknown as PromotionRow[]).map(async (row) => ({
      id: row.id,
      kind: "promotion" as const,
      label: row.name,
      meta: "Promocion",
      price_cop: row.promo_price_cop === null ? null : Number(row.promo_price_cop),
      image_src: await signedImage(supabase, row.image_url)
    }))
  );

  return (
    <PanelShell active="marketing-pantallas" hideHeader moduleKeys={moduleKeys} roleNames={roleNames} title="Marketing" userEmail={user.email ?? "usuario"}>
      {error ? <p className="alert">{error.message}</p> : null}
      <MarketingScreensWorkspace dataSources={[...pizzaSources, ...productSources, ...promotionSources] as MarketingDataSource[]} projects={projects} />
    </PanelShell>
  );
}
