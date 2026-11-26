import { MenuFamilyManagement, type UniversalMenuFamilyData } from "@/components/menu-family-management";
import { PanelShell } from "@/components/panel-shell";
import { requirePanelAccess } from "@/lib/panel-auth";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ familyId: string }> };

function rows<T>(value: T[] | null) { return value ?? []; }

function recipeBaseUnit(unit: string): "g" | "ml" | "unit" {
  if (unit === "kg") return "g";
  if (unit === "l") return "ml";
  return unit === "g" || unit === "ml" ? unit : "unit";
}

export default async function MenuFamilyDetailPage({ params }: PageProps) {
  const { familyId } = await params;
  const supabase = await createServerSupabaseClient();
  const { user, roleNames, moduleKeys } = await requirePanelAccess(supabase, "menu");
  const [familyResult, presentationsResult, itemsResult, componentsResult, substitutionsResult, pricesResult, additionsResult, combosResult, variantsResult, comboComponentsResult, comboComponentOptionsResult, packagingResult, inventoryResult, preparationsResult, suppliesResult] = await Promise.all([
    supabase.from("menu_families").select("id, name, description, is_active").eq("id", familyId).maybeSingle(),
    supabase.from("menu_family_presentations").select("id, name, description").eq("family_id", familyId).order("sort_order").order("name"),
    supabase.from("menu_family_items").select("id, name, sku, commercial_description, image_url, is_active").eq("family_id", familyId).order("sort_order").order("name"),
    supabase.from("menu_family_recipe_components").select("id, family_item_id, presentation_id, source_kind, inventory_item_id, source_preparation_id, quantity_base, base_unit, option_group, is_required, sort_order").order("sort_order"),
    supabase.from("menu_family_recipe_substitutions").select("id, component_id, source_kind, inventory_item_id, source_preparation_id, quantity_base, base_unit"),
    supabase.from("menu_family_prices").select("id, family_item_id, presentation_id, sale_price_cop, is_active").eq("is_active", true),
    supabase.from("menu_family_additions").select("id, name, sku, sale_price_cop, quantity_base, base_unit, max_allowed").eq("family_id", familyId).order("sort_order").order("name"),
    supabase.from("menu_family_combos").select("id, name, sku, description").eq("family_id", familyId).order("sort_order").order("name"),
    supabase.from("menu_family_combo_variants").select("id, combo_id, name, sale_price_cop").order("sort_order").order("name"),
    supabase.from("menu_family_combo_components").select("id, variant_id, name, source_kind, family_item_id, inventory_item_id, presentation_id, quantity, is_required").order("sort_order"),
    supabase.from("menu_family_combo_component_options").select("id, component_id, source_kind, family_item_id, inventory_item_id, presentation_id, quantity").order("sort_order"),
    supabase.from("menu_family_packaging_rules").select("id, family_item_id, presentation_id, packaging_inventory_item_id, service_kind, quantity_base"),
    supabase.from("inventory_items").select("id, name, unit").eq("item_kind", "ingredient").eq("is_active", true).in("unit", ["g", "kg", "ml", "l", "unit"]).order("name"),
    supabase.from("preparations").select("id, name, base_unit").in("base_unit", ["g", "kg", "ml", "l", "unit"]).order("name"),
    supabase.from("inventory_items").select("id, name, unit").eq("item_kind", "supply").eq("unit", "unit").order("name")
  ]);

  if (familyResult.error && /menu_families|schema cache|does not exist/i.test(familyResult.error.message)) notFound();
  if (familyResult.error || !familyResult.data) notFound();

  const items = rows(itemsResult.data) as UniversalMenuFamilyData["items"];
  const itemIds = new Set(items.map((item) => item.id));
  const combos = rows(combosResult.data) as UniversalMenuFamilyData["combos"];
  const comboIds = new Set(combos.map((combo) => combo.id));
  const variants = (rows(variantsResult.data) as UniversalMenuFamilyData["variants"]).filter((variant) => comboIds.has(variant.combo_id));
  const variantIds = new Set(variants.map((variant) => variant.id));
  const comboComponents = (rows(comboComponentsResult.data) as UniversalMenuFamilyData["comboComponents"]).filter((component) => variantIds.has(component.variant_id));
  const comboComponentIds = new Set(comboComponents.map((component) => component.id));
  const data: UniversalMenuFamilyData = {
    family: familyResult.data as UniversalMenuFamilyData["family"],
    presentations: rows(presentationsResult.data) as UniversalMenuFamilyData["presentations"],
    items,
    components: (rows(componentsResult.data) as UniversalMenuFamilyData["components"]).filter((component) => itemIds.has(component.family_item_id)),
    substitutions: rows(substitutionsResult.data) as UniversalMenuFamilyData["substitutions"],
    prices: (rows(pricesResult.data) as UniversalMenuFamilyData["prices"]).filter((price) => itemIds.has(price.family_item_id)),
    additions: rows(additionsResult.data) as UniversalMenuFamilyData["additions"],
    combos,
    variants,
    comboComponents,
    comboComponentOptions: (rows(comboComponentOptionsResult.data) as UniversalMenuFamilyData["comboComponentOptions"]).filter((option) => comboComponentIds.has(option.component_id)),
    packagingRules: (rows(packagingResult.data) as UniversalMenuFamilyData["packagingRules"]).filter((rule) => itemIds.has(rule.family_item_id)),
    inventorySources: rows(inventoryResult.data).map((source) => ({ id: source.id, name: source.name, unit: recipeBaseUnit(source.unit) })) as UniversalMenuFamilyData["inventorySources"],
    preparationSources: rows(preparationsResult.data).map((source) => ({ id: source.id, name: source.name, unit: recipeBaseUnit(source.base_unit) })) as UniversalMenuFamilyData["preparationSources"],
    packagingSources: rows(suppliesResult.data).map((source) => ({ id: source.id, name: source.name, unit: source.unit })) as UniversalMenuFamilyData["packagingSources"]
  };

  return <PanelShell active="menu-familias" hideHeader moduleKeys={moduleKeys} roleNames={roleNames} title={data.family.name} userEmail={user.email ?? "usuario"}><MenuFamilyManagement data={data} /></PanelShell>;
}
