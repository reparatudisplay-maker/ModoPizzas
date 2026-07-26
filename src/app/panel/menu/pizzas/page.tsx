import { notFound, redirect } from "next/navigation";
import { MenuPizzasWorkspace, type MenuCategoryRecord, type PizzaFlavorRecord, type PizzaSizeRecord } from "@/components/menu-pizzas-workspace";
import { PanelShell } from "@/components/panel-shell";
import { createServerSupabaseClient } from "@/lib/supabase-server";

const managerRoles = new Set(["gerente", "admin_sistema"]);

export const dynamic = "force-dynamic";

function isDirectImageUrl(value: string) {
  return value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:");
}

type FlavorRow = Omit<PizzaFlavorRecord, "menu_category_name"> & {
  menu_categories: { name: string } | null;
};

type FlavorIngredientRow = {
  flavor_id: string;
  source_kind: "inventory_item" | "preparation";
  inventory_item_id: string | null;
  source_preparation_id: string | null;
};

export default async function MenuPizzasPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roleNames = roles?.map((item) => item.role) ?? [];
  if (!roleNames.some((role) => managerRoles.has(role))) notFound();

  const [categoriesResult, sizesResult, flavorsResult, flavorIngredientsResult, inventorySourcesResult, preparationSourcesResult] = await Promise.all([
    supabase.from("menu_categories").select("id, sku, name, description, sort_order, is_active, created_at").order("sort_order").order("name"),
    supabase.from("pizza_sizes").select("id, sku, name, diameter_cm, slices_count, sort_order, is_active, created_at").order("sort_order").order("name"),
    supabase
      .from("pizza_flavors")
      .select("id, sku, name, commercial_description, image_url, allows_half_and_half, menu_category_id, allergens, is_active, created_at, sort_order, menu_categories(name)")
      .order("sort_order")
      .order("name"),
    supabase.from("pizza_flavor_ingredients").select("flavor_id, source_kind, inventory_item_id, source_preparation_id"),
    supabase
      .from("inventory_items")
      .select("id, name")
      .eq("item_kind", "ingredient")
      .eq("is_active", true)
      .is("presentation_quantity", null)
      .order("name"),
    supabase.from("preparations").select("id, name").eq("is_active", true).order("name")
  ]);

  const error =
    categoriesResult.error ?? sizesResult.error ?? flavorsResult.error ?? flavorIngredientsResult.error ?? inventorySourcesResult.error ?? preparationSourcesResult.error;
  const categories = (categoriesResult.data ?? []) as MenuCategoryRecord[];
  const sizes = (sizesResult.data ?? []) as PizzaSizeRecord[];
  const flavorRows = (flavorsResult.data ?? []) as unknown as FlavorRow[];
  const inventorySources = (inventorySourcesResult.data ?? []).map((item) => ({ id: item.id, name: item.name, source_kind: "inventory_item" as const }));
  const preparationSources = (preparationSourcesResult.data ?? []).map((item) => ({ id: item.id, name: item.name, source_kind: "preparation" as const }));
  const sourceNameByKey = new Map([...inventorySources, ...preparationSources].map((source) => [`${source.source_kind}:${source.id}`, source.name]));
  const ingredientsByFlavor = new Map<string, PizzaFlavorRecord["characteristic_ingredients"]>();
  for (const ingredient of (flavorIngredientsResult.data ?? []) as FlavorIngredientRow[]) {
    const sourceId = ingredient.source_kind === "preparation" ? ingredient.source_preparation_id : ingredient.inventory_item_id;
    if (!sourceId) continue;
    const key = `${ingredient.source_kind}:${sourceId}`;
    ingredientsByFlavor.set(ingredient.flavor_id, [
      ...(ingredientsByFlavor.get(ingredient.flavor_id) ?? []),
      {
        source_kind: ingredient.source_kind,
        source_id: sourceId,
        source_name: sourceNameByKey.get(key) ?? "Sin nombre"
      }
    ]);
  }

  const signedImageEntries = await Promise.all(
    flavorRows.map(async (flavor) => {
      if (!flavor.image_url || isDirectImageUrl(flavor.image_url)) {
        return [flavor.id, flavor.image_url] as const;
      }

      const { data } = await supabase.storage.from("product-images").createSignedUrl(flavor.image_url, 60 * 60);
      return [flavor.id, data?.signedUrl ?? null] as const;
    })
  );
  const imageSrcById = new Map(signedImageEntries);
  const flavors = flavorRows.map((flavor) => ({
    ...flavor,
    menu_category_name: flavor.menu_categories?.name ?? null,
    image_src: imageSrcById.get(flavor.id) ?? null,
    characteristic_ingredients: ingredientsByFlavor.get(flavor.id) ?? []
  }));

  return (
    <PanelShell active="menu-pizzas" hideHeader roleNames={roleNames} title="Pizzas" userEmail={user.email ?? "usuario"}>
      {error ? <p className="alert">{error.message}</p> : null}
      <MenuPizzasWorkspace categories={categories} flavors={flavors} ingredientSources={[...inventorySources, ...preparationSources]} sizes={sizes} />
    </PanelShell>
  );
}
