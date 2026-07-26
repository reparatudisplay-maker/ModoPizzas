import { notFound, redirect } from "next/navigation";
import {
  MenuPizzasWorkspace,
  type AdditionIngredientSource,
  type MenuCategoryRecord,
  type PizzaAdditionRecord,
  type PizzaFlavorRecord,
  type PizzaSizeRecord
} from "@/components/menu-pizzas-workspace";
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

type AdditionRow = {
  id: string;
  name: string;
  inventory_item_id: string;
  max_allowed: number;
  is_active: boolean;
  is_available: boolean;
  created_at: string;
  inventory_items: { name: string; unit: "g" | "kg" | "ml" | "l" | "unit"; average_cost_cop: number | null } | null;
};

type AdditionSizeRow = {
  addition_id: string;
  pizza_size_id: string;
  quantity_base: number;
  unit: "g" | "ml" | "unit";
  display_quantity: number;
  display_unit: "g" | "kg" | "ml" | "l" | "unit";
  cost_cop: number;
  price_cop: number;
  pizza_sizes: { name: string } | null;
};

type AdditionFlavorRow = {
  addition_id: string;
  flavor_id: string;
  pizza_flavors: { name: string } | null;
};

type AdditionCategoryRow = {
  addition_id: string;
  menu_category_id: string;
  menu_categories: { name: string } | null;
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

  const [
    categoriesResult,
    sizesResult,
    flavorsResult,
    flavorIngredientsResult,
    inventorySourcesResult,
    preparationSourcesResult,
    additionsResult,
    additionSizesResult,
    additionFlavorsResult,
    additionCategoriesResult
  ] = await Promise.all([
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
      .select("id, name, unit, average_cost_cop")
      .eq("item_kind", "ingredient")
      .eq("is_active", true)
      .is("presentation_quantity", null)
      .order("name"),
    supabase.from("preparations").select("id, name").eq("is_active", true).order("name"),
    supabase
      .from("pizza_additions")
      .select("id, name, inventory_item_id, max_allowed, is_active, is_available, created_at, inventory_items(name, unit, average_cost_cop)")
      .order("name"),
    supabase.from("pizza_addition_sizes").select("addition_id, pizza_size_id, quantity_base, unit, display_quantity, display_unit, cost_cop, price_cop, pizza_sizes(name)"),
    supabase.from("pizza_addition_flavors").select("addition_id, flavor_id, pizza_flavors(name)"),
    supabase.from("pizza_addition_categories").select("addition_id, menu_category_id, menu_categories(name)")
  ]);

  const error =
    categoriesResult.error ??
    sizesResult.error ??
    flavorsResult.error ??
    flavorIngredientsResult.error ??
    inventorySourcesResult.error ??
    preparationSourcesResult.error ??
    additionsResult.error ??
    additionSizesResult.error ??
    additionFlavorsResult.error ??
    additionCategoriesResult.error;
  const categories = (categoriesResult.data ?? []) as MenuCategoryRecord[];
  const sizes = (sizesResult.data ?? []) as PizzaSizeRecord[];
  const flavorRows = (flavorsResult.data ?? []) as unknown as FlavorRow[];
  const inventorySources = (inventorySourcesResult.data ?? []).map((item) => ({ id: item.id, name: item.name, source_kind: "inventory_item" as const }));
  const additionIngredientSources = (inventorySourcesResult.data ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    unit: item.unit,
    average_cost_cop: Number(item.average_cost_cop ?? 0)
  })) as AdditionIngredientSource[];
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
  const additionSizesById = new Map<string, PizzaAdditionRecord["sizes"]>();
  for (const row of (additionSizesResult.data ?? []) as unknown as AdditionSizeRow[]) {
    additionSizesById.set(row.addition_id, [
      ...(additionSizesById.get(row.addition_id) ?? []),
      {
        pizza_size_id: row.pizza_size_id,
        pizza_size_name: row.pizza_sizes?.name ?? "Sin tamano",
        quantity_base: Number(row.quantity_base ?? 0),
        unit: row.unit,
        display_quantity: Number(row.display_quantity ?? 0),
        display_unit: row.display_unit,
        cost_cop: Number(row.cost_cop ?? 0),
        price_cop: Number(row.price_cop ?? 0)
      }
    ]);
  }
  const compatibleFlavorsById = new Map<string, PizzaAdditionRecord["compatible_flavors"]>();
  for (const row of (additionFlavorsResult.data ?? []) as unknown as AdditionFlavorRow[]) {
    compatibleFlavorsById.set(row.addition_id, [
      ...(compatibleFlavorsById.get(row.addition_id) ?? []),
      { id: row.flavor_id, name: row.pizza_flavors?.name ?? "Sin sabor" }
    ]);
  }
  const compatibleCategoriesById = new Map<string, PizzaAdditionRecord["compatible_categories"]>();
  for (const row of (additionCategoriesResult.data ?? []) as unknown as AdditionCategoryRow[]) {
    compatibleCategoriesById.set(row.addition_id, [
      ...(compatibleCategoriesById.get(row.addition_id) ?? []),
      { id: row.menu_category_id, name: row.menu_categories?.name ?? "Sin categoria" }
    ]);
  }
  const additions = ((additionsResult.data ?? []) as unknown as AdditionRow[]).map((addition) => ({
    id: addition.id,
    name: addition.name,
    inventory_item_id: addition.inventory_item_id,
    ingredient_name: addition.inventory_items?.name ?? "Sin ingrediente",
    ingredient_unit: addition.inventory_items?.unit ?? "unit",
    ingredient_average_cost_cop: Number(addition.inventory_items?.average_cost_cop ?? 0),
    max_allowed: Number(addition.max_allowed ?? 1),
    is_active: addition.is_active,
    is_available: addition.is_available,
    created_at: addition.created_at,
    sizes: additionSizesById.get(addition.id) ?? [],
    compatible_flavors: compatibleFlavorsById.get(addition.id) ?? [],
    compatible_categories: compatibleCategoriesById.get(addition.id) ?? []
  })) as PizzaAdditionRecord[];

  return (
    <PanelShell active="menu-pizzas" hideHeader roleNames={roleNames} title="Pizzas" userEmail={user.email ?? "usuario"}>
      {error ? <p className="alert">{error.message}</p> : null}
      <MenuPizzasWorkspace
        additionIngredientSources={additionIngredientSources}
        additions={additions}
        categories={categories}
        flavors={flavors}
        ingredientSources={[...inventorySources, ...preparationSources]}
        sizes={sizes}
      />
    </PanelShell>
  );
}
