import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { deletePizzaFlavor, deletePizzaSize, savePizzaFlavor, savePizzaSize } from "@/app/admin/actions";
import { PanelShell } from "@/components/panel-shell";
import { PizzaRecipeEditor } from "@/components/pizza-recipe-editor";
import { formatCop } from "@/lib/format";
import { createServerSupabaseClient } from "@/lib/supabase-server";

type PizzasPageProps = {
  searchParams: Promise<{ section?: string; flavor?: string; size?: string; editSize?: string; editFlavor?: string }>;
};

type StockUnit = "g" | "kg" | "ml" | "l" | "unit";

type PizzaSize = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  diameter_cm: number | null;
  display_order: number;
  is_active: boolean;
  supports_half_and_half: boolean;
};

type PizzaFlavor = {
  id: string;
  code: string;
  name: string;
  description: string;
  image_url: string | null;
  allergens: string[];
  is_featured: boolean;
  is_public: boolean;
  is_active: boolean;
};

type PizzaPrice = {
  flavor_id: string;
  size_id: string;
  price_cop: number;
  waste_percent: number | null;
};

type InventoryItem = {
  id: string;
  name: string;
  unit: StockUnit;
  current_quantity: number;
  average_cost_cop: number;
  is_active: boolean;
};

type RecipeRow = {
  id: string;
  flavor_id: string | null;
  size_id: string | null;
  inventory_item_id: string;
  quantity: number;
  unit: StockUnit;
  inventory_items: InventoryItem | null;
};

const managerRoles = new Set(["gerente", "admin_sistema"]);

export const dynamic = "force-dynamic";

function tabClass(active: string, value: string) {
  return active === value ? "ghost-button active-tab" : "ghost-button";
}

function priceFor(prices: PizzaPrice[], flavorId: string, sizeId: string) {
  return prices.find((price) => price.flavor_id === flavorId && price.size_id === sizeId)?.price_cop ?? 0;
}

function wasteFor(prices: PizzaPrice[], flavorId: string, sizeId: string) {
  return prices.find((price) => price.flavor_id === flavorId && price.size_id === sizeId)?.waste_percent ?? 5;
}

function convertQuantity(quantity: number, fromUnit: StockUnit, toUnit: StockUnit) {
  if (fromUnit === toUnit) return quantity;
  if (fromUnit === "g" && toUnit === "kg") return quantity / 1000;
  if (fromUnit === "kg" && toUnit === "g") return quantity * 1000;
  if (fromUnit === "ml" && toUnit === "l") return quantity / 1000;
  if (fromUnit === "l" && toUnit === "ml") return quantity * 1000;
  return null;
}

function recipeLineCost(recipe: RecipeRow) {
  if (!recipe.inventory_items) return 0;
  const converted = convertQuantity(Number(recipe.quantity), recipe.unit, recipe.inventory_items.unit);
  if (converted === null) return 0;
  return converted * Number(recipe.inventory_items.average_cost_cop ?? 0);
}

function recipeCost(recipes: RecipeRow[]) {
  return Math.round(recipes.reduce((sum, recipe) => sum + recipeLineCost(recipe), 0));
}

function recipeAvailability(recipes: RecipeRow[]) {
  if (recipes.length === 0) return "Sin receta";
  const unavailable = recipes.some((recipe) => {
    const item = recipe.inventory_items;
    if (!item) return true;
    const needed = convertQuantity(Number(recipe.quantity), recipe.unit, item.unit);
    return needed === null || Number(item.current_quantity ?? 0) < needed;
  });
  return unavailable ? "Stock bajo" : "Disponible";
}

function SectionTabs({ active }: { active: string }) {
  return (
    <nav className="section-tabs" aria-label="Secciones de pizzas">
      <Link className={tabClass(active, "resumen")} href="/panel/pizzas?section=resumen">
        Resumen
      </Link>
      <Link className={tabClass(active, "tamanos")} href="/panel/pizzas?section=tamanos">
        Tamanos
      </Link>
      <Link className={tabClass(active, "sabores")} href="/panel/pizzas?section=sabores">
        Sabores
      </Link>
      <Link className={tabClass(active, "recetas")} href="/panel/pizzas?section=recetas">
        Recetas y precios
      </Link>
    </nav>
  );
}

function SizeForm({ size }: { size?: PizzaSize }) {
  return (
    <form action={savePizzaSize} className="compact-card">
      {size ? <input name="id" type="hidden" value={size.id} /> : null}
      <div>
        <h3>{size ? `Editar ${size.name}` : "Nuevo tamano"}</h3>
        {size ? <span className="badge">{size.is_active ? "Activo" : "Oculto"}</span> : <span className="badge">Maestro</span>}
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Nombre</label>
          <input defaultValue={size?.name} name="name" required />
        </div>
        <div className="field">
          <label>Codigo</label>
          <input defaultValue={size?.code} name="code" placeholder="mediana" />
        </div>
        <div className="field">
          <label>Diametro (cm)</label>
          <input defaultValue={size?.diameter_cm ?? ""} inputMode="decimal" name="diameter_cm" placeholder="Ej. 30" />
        </div>
        <div className="field full">
          <label>Descripcion</label>
          <input defaultValue={size?.description ?? ""} name="description" />
        </div>
      </div>
      <div className="check-grid">
        <label className="check-option">
          <input defaultChecked={size?.is_active ?? true} name="is_active" type="checkbox" />
          <span>Activo</span>
        </label>
        <label className="check-option">
          <input defaultChecked={size?.supports_half_and_half ?? true} name="supports_half_and_half" type="checkbox" />
          <span>Mitad y mitad</span>
        </label>
      </div>
      <div className="form-actions">
        <button className="primary-button" type="submit">
          {size ? "Actualizar tamano" : "Guardar tamano"}
        </button>
        {size ? (
          <Link className="ghost-button" href="/panel/pizzas?section=tamanos">
            Cancelar
          </Link>
        ) : null}
      </div>
    </form>
  );
}

function FlavorForm({ flavor }: { flavor?: PizzaFlavor }) {
  return (
    <form action={savePizzaFlavor} className="compact-card">
      {flavor ? <input name="id" type="hidden" value={flavor.id} /> : null}
      <div>
        <h3>{flavor ? `Editar ${flavor.name}` : "Nuevo sabor"}</h3>
        {flavor ? <span className="badge">{flavor.is_public && flavor.is_active ? "Publico" : "Oculto"}</span> : <span className="badge">Pizza</span>}
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Nombre</label>
          <input defaultValue={flavor?.name} name="name" required />
        </div>
        <div className="field">
          <label>Codigo</label>
          <input defaultValue={flavor?.code} name="code" placeholder="pepperoni" />
        </div>
        <div className="field full">
          <label>Descripcion</label>
          <textarea defaultValue={flavor?.description} name="description" />
        </div>
        <div className="field full">
          <label>Foto (URL)</label>
          <input defaultValue={flavor?.image_url ?? ""} name="image_url" placeholder="https://..." type="url" />
        </div>
        <div className="field full">
          <label>Alergenos separados por coma</label>
          <input defaultValue={flavor?.allergens.join(", ")} name="allergens" placeholder="gluten, lacteos" />
        </div>
      </div>
      <div className="check-grid">
        <label className="check-option">
          <input defaultChecked={flavor?.is_active ?? true} name="is_active" type="checkbox" />
          <span>Activo</span>
        </label>
        <label className="check-option">
          <input defaultChecked={flavor?.is_public ?? true} name="is_public" type="checkbox" />
          <span>Visible publico</span>
        </label>
        <label className="check-option">
          <input defaultChecked={flavor?.is_featured ?? false} name="is_featured" type="checkbox" />
          <span>Popular</span>
        </label>
      </div>
      <div className="form-actions">
        <button className="primary-button" type="submit">
          {flavor ? "Actualizar sabor" : "Guardar sabor"}
        </button>
        {flavor ? (
          <Link className="ghost-button" href="/panel/pizzas?section=sabores">
            Cancelar
          </Link>
        ) : null}
      </div>
    </form>
  );
}

export default async function PizzasPage({ searchParams }: PizzasPageProps) {
  const { section = "resumen", flavor, size, editSize, editFlavor } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roleNames = roles?.map((item) => item.role) ?? [];
  const canManage = roleNames.some((role) => managerRoles.has(role));
  if (!canManage) {
    notFound();
  }

  const [sizesResult, flavorsResult, pricesResult, recipesResult, itemsResult] = await Promise.all([
    supabase.from("pizza_sizes").select("*").order("display_order"),
    supabase.from("pizza_flavors").select("*").order("name"),
    supabase.from("pizza_flavor_prices").select("*"),
    supabase.from("recipes").select("*, inventory_items(id, name, unit, current_quantity, average_cost_cop, is_active)").not("flavor_id", "is", null),
    supabase.from("inventory_items").select("id, name, unit, current_quantity, average_cost_cop, is_active").eq("is_active", true).order("name")
  ]);

  const sizes = (sizesResult.data ?? []) as PizzaSize[];
  const flavors = (flavorsResult.data ?? []) as PizzaFlavor[];
  const prices = (pricesResult.data ?? []) as PizzaPrice[];
  const recipes = (recipesResult.data ?? []) as unknown as RecipeRow[];
  const items = (itemsResult.data ?? []) as InventoryItem[];
  const error = sizesResult.error ?? flavorsResult.error ?? pricesResult.error ?? recipesResult.error ?? itemsResult.error;
  const selectedFlavorId = flavor ?? flavors[0]?.id ?? "";
  const selectedSizeId = size ?? sizes[0]?.id ?? "";
  const editableSize = editSize ? sizes.find((pizzaSize) => pizzaSize.id === editSize) : undefined;
  const editableFlavor = editFlavor ? flavors.find((pizzaFlavor) => pizzaFlavor.id === editFlavor) : undefined;
  const selectedRecipes = recipes.filter((recipe) => recipe.flavor_id === selectedFlavorId && recipe.size_id === selectedSizeId);
  const selectedPrice = priceFor(prices, selectedFlavorId, selectedSizeId);
  const selectedWaste = wasteFor(prices, selectedFlavorId, selectedSizeId);

  return (
    <PanelShell
      active="pizzas"
      roleNames={roleNames}
      subtitle="Arma sabores, tamanos, recetas, costos y precios de venta."
      title="Pizzas"
      userEmail={user.email ?? "usuario"}
    >
      <SectionTabs active={section} />
      {error ? <p className="alert">{error.message}</p> : null}

      {section === "resumen" ? (
        <section className="form-panel">
          <h2>Sabores por tamano</h2>
          <div className="data-table-wrap">
            <table className="data-table pizza-summary-table">
              <thead>
                <tr>
                  <th>Sabor</th>
                  {sizes.map((pizzaSize) => (
                    <th key={pizzaSize.id}>{pizzaSize.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {flavors.map((pizzaFlavor) => (
                  <tr key={pizzaFlavor.id}>
                    <td>{pizzaFlavor.name}</td>
                    {sizes.map((pizzaSize) => {
                      const comboRecipes = recipes.filter((recipe) => recipe.flavor_id === pizzaFlavor.id && recipe.size_id === pizzaSize.id);
                      const cost = recipeCost(comboRecipes);
                      const salePrice = priceFor(prices, pizzaFlavor.id, pizzaSize.id);
                      return (
                        <td key={pizzaSize.id}>
                          <Link className="summary-cell-link" href={`/panel/pizzas?section=recetas&flavor=${pizzaFlavor.id}&size=${pizzaSize.id}`}>
                            <strong>{formatCop(salePrice)}</strong>
                            <span>Costo {formatCop(cost)}</span>
                            <small>{recipeAvailability(comboRecipes)}</small>
                          </Link>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {section === "tamanos" ? (
        <section className="module-stack">
          <SizeForm size={editableSize} />
          <section className="form-panel">
            <div className="section-title-row">
              <h2>Listado de tamanos</h2>
            </div>
            <div className="data-table-wrap">
              <table className="data-table pizza-management-table">
                <thead>
                  <tr>
                    <th>Acciones</th>
                    <th>Nombre</th>
                    <th>Codigo</th>
                    <th>Medida</th>
                    <th>Mitad</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {sizes.map((pizzaSize) => (
                    <tr key={pizzaSize.id}>
                      <td>
                        <span className="row-actions center-actions">
                          <Link className="icon-button" href={`/panel/pizzas?section=tamanos&editSize=${pizzaSize.id}`} title="Editar tamano">
                            <Pencil size={16} />
                          </Link>
                          <form action={deletePizzaSize}>
                            <input name="id" type="hidden" value={pizzaSize.id} />
                            <button className="icon-button danger-button" title="Eliminar tamano" type="submit">
                              <Trash2 size={16} />
                            </button>
                          </form>
                        </span>
                      </td>
                      <td>{pizzaSize.name}</td>
                      <td>{pizzaSize.code}</td>
                      <td>{pizzaSize.diameter_cm ? `${pizzaSize.diameter_cm} cm` : "Sin medida"}</td>
                      <td>{pizzaSize.supports_half_and_half ? "Si" : "No"}</td>
                      <td>{pizzaSize.is_active ? "Activo" : "Oculto"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      ) : null}

      {section === "sabores" ? (
        <section className="module-stack">
          <FlavorForm flavor={editableFlavor} />
          <section className="form-panel">
            <div className="section-title-row">
              <h2>Listado de sabores</h2>
            </div>
            <div className="data-table-wrap">
              <table className="data-table pizza-management-table">
                <thead>
                  <tr>
                    <th>Acciones</th>
                    <th>Nombre</th>
                    <th>Codigo</th>
                    <th>Foto</th>
                    <th>Visible</th>
                    <th>Popular</th>
                    <th>Alergenos</th>
                    <th>Descripcion</th>
                  </tr>
                </thead>
                <tbody>
                  {flavors.map((pizzaFlavor) => (
                    <tr key={pizzaFlavor.id}>
                      <td>
                        <span className="row-actions center-actions">
                          <Link className="icon-button" href={`/panel/pizzas?section=sabores&editFlavor=${pizzaFlavor.id}`} title="Editar sabor">
                            <Pencil size={16} />
                          </Link>
                          <form action={deletePizzaFlavor}>
                            <input name="id" type="hidden" value={pizzaFlavor.id} />
                            <button className="icon-button danger-button" title="Eliminar sabor" type="submit">
                              <Trash2 size={16} />
                            </button>
                          </form>
                        </span>
                      </td>
                      <td>{pizzaFlavor.name}</td>
                      <td>{pizzaFlavor.code}</td>
                      <td>
                        {pizzaFlavor.image_url ? (
                          <a className="table-image-link" href={pizzaFlavor.image_url} rel="noreferrer" target="_blank">
                            Ver foto
                          </a>
                        ) : (
                          "Sin foto"
                        )}
                      </td>
                      <td>{pizzaFlavor.is_public && pizzaFlavor.is_active ? "Publico" : "Oculto"}</td>
                      <td>{pizzaFlavor.is_featured ? "Si" : "No"}</td>
                      <td>{pizzaFlavor.allergens.length > 0 ? pizzaFlavor.allergens.join(", ") : "Sin alergenos"}</td>
                      <td>{pizzaFlavor.description || "Sin descripcion"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      ) : null}

      {section === "recetas" ? (
        <PizzaRecipeEditor
          flavors={flavors}
          items={items}
          price={selectedPrice}
          recipes={selectedRecipes}
          selectedFlavorId={selectedFlavorId}
          selectedSizeId={selectedSizeId}
          sizes={sizes}
          wastePercent={selectedWaste}
        />
      ) : null}
    </PanelShell>
  );
}
