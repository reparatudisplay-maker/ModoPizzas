import { notFound, redirect } from "next/navigation";
import { PanelShell } from "@/components/panel-shell";
import {
  PreparationsModule,
  type ConservationProfileOption,
  type PreparationRecord,
  type PreparationRecipeLine,
  type PreparationSource
} from "@/components/preparations-module";
import { createServerSupabaseClient } from "@/lib/supabase-server";

type StockUnit = "g" | "kg" | "ml" | "l" | "unit";
type UnitKind = "weight" | "volume" | "unit";

type PreparationRow = {
  id: string;
  name: string;
  image_url: string | null;
  unit_kind: UnitKind;
  base_unit: StockUnit;
  alternative_unit: StockUnit | null;
  density: number | null;
  conservation_profile_id: string | null;
  base_yield_quantity: number;
  base_yield_unit: StockUnit;
  is_active: boolean;
  conservation_profiles: { name: string } | null;
};

type RecipeRow = {
  id: string;
  preparation_id: string;
  source_kind: "inventory_item" | "preparation";
  inventory_item_id: string | null;
  source_preparation_id: string | null;
  quantity: number;
  unit: StockUnit;
};

type InventoryItemRow = {
  id: string;
  name: string;
  unit: StockUnit;
  item_kind: "ingredient" | "sale_product" | "supply" | null;
  is_active: boolean;
  presentation_quantity: number | null;
};

const managerRoles = new Set(["gerente", "admin_sistema"]);

export const dynamic = "force-dynamic";

function isDirectImageUrl(value: string) {
  return value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:");
}

function unitKindForStockUnit(unit: StockUnit): UnitKind {
  if (unit === "g" || unit === "kg") return "weight";
  if (unit === "ml" || unit === "l") return "volume";
  return "unit";
}

export default async function ProductionPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roleNames = roles?.map((item) => item.role) ?? [];
  if (!roleNames.some((role) => managerRoles.has(role))) notFound();

  const [preparationsResult, recipeResult, inventoryItemsResult, profilesResult] = await Promise.all([
    supabase
      .from("preparations")
      .select("id, name, image_url, unit_kind, base_unit, alternative_unit, density, conservation_profile_id, base_yield_quantity, base_yield_unit, is_active, conservation_profiles(name)")
      .order("name"),
    supabase.from("preparation_recipe_items").select("id, preparation_id, source_kind, inventory_item_id, source_preparation_id, quantity, unit").order("created_at"),
    supabase
      .from("inventory_items")
      .select("id, name, unit, item_kind, is_active, presentation_quantity")
      .eq("is_active", true)
      .eq("item_kind", "ingredient")
      .is("presentation_quantity", null)
      .order("name"),
    supabase
      .from("conservation_profiles")
      .select("id, name, is_active, conservation_profile_rules(id, storage_method, duration_value, duration_unit, notes)")
      .eq("is_active", true)
      .order("name")
  ]);

  const error = preparationsResult.error ?? recipeResult.error ?? inventoryItemsResult.error ?? profilesResult.error;
  const preparationRows = (preparationsResult.data ?? []) as unknown as PreparationRow[];
  const recipeRows = (recipeResult.data ?? []) as RecipeRow[];
  const inventoryItems = (inventoryItemsResult.data ?? []) as InventoryItemRow[];
  const profiles = (profilesResult.data ?? []) as ConservationProfileOption[];
  const preparationById = new Map(preparationRows.map((preparation) => [preparation.id, preparation]));
  const inventoryById = new Map(inventoryItems.map((item) => [item.id, item]));

  const signedImageEntries = await Promise.all(
    preparationRows.map(async (preparation) => {
      if (!preparation.image_url || isDirectImageUrl(preparation.image_url)) return [preparation.id, preparation.image_url] as const;
      const { data } = await supabase.storage.from("product-images").createSignedUrl(preparation.image_url, 60 * 60);
      return [preparation.id, data?.signedUrl ?? null] as const;
    })
  );
  const imageSrcById = new Map(signedImageEntries);

  const recipeByPreparation = new Map<string, PreparationRecipeLine[]>();
  for (const line of recipeRows) {
    const source =
      line.source_kind === "preparation" && line.source_preparation_id
        ? preparationById.get(line.source_preparation_id)
        : line.inventory_item_id
          ? inventoryById.get(line.inventory_item_id)
          : null;
    if (!source) continue;
    const recipeLine: PreparationRecipeLine = {
      id: line.id,
      source_kind: line.source_kind,
      source_id: line.source_kind === "preparation" ? line.source_preparation_id ?? "" : line.inventory_item_id ?? "",
      source_name: source.name,
      quantity: Number(line.quantity),
      unit: line.unit
    };
    recipeByPreparation.set(line.preparation_id, [...(recipeByPreparation.get(line.preparation_id) ?? []), recipeLine]);
  }

  const preparations: PreparationRecord[] = preparationRows.map((preparation) => ({
    id: preparation.id,
    name: preparation.name,
    image_url: preparation.image_url,
    image_src: imageSrcById.get(preparation.id) ?? null,
    unit_kind: preparation.unit_kind,
    base_unit: preparation.base_unit,
    alternative_unit: preparation.alternative_unit,
    density: preparation.density ? Number(preparation.density) : null,
    conservation_profile_id: preparation.conservation_profile_id,
    conservation_profile_name: preparation.conservation_profiles?.name ?? null,
    base_yield_quantity: Number(preparation.base_yield_quantity),
    base_yield_unit: preparation.base_yield_unit,
    is_active: preparation.is_active,
    recipe_items: recipeByPreparation.get(preparation.id) ?? []
  }));

  const inventorySources: PreparationSource[] = inventoryItems.map((item) => ({
    id: item.id,
    name: item.name,
    source_kind: "inventory_item",
    unit_kind: unitKindForStockUnit(item.unit),
    base_unit: item.unit === "kg" ? "g" : item.unit === "l" ? "ml" : item.unit
  }));
  const preparationSources: PreparationSource[] = preparations
    .filter((preparation) => preparation.is_active)
    .map((preparation) => ({
      id: preparation.id,
      name: preparation.name,
      source_kind: "preparation",
      unit_kind: preparation.unit_kind,
      base_unit: preparation.base_unit
    }));

  return (
    <PanelShell active="produccion-preparaciones" hideHeader roleNames={roleNames} title="Produccion" userEmail={user.email ?? "usuario"}>
      {error ? <p className="alert">{error.message}</p> : null}
      <PreparationsModule preparations={preparations} profiles={profiles} sources={[...inventorySources, ...preparationSources]} />
    </PanelShell>
  );
}
