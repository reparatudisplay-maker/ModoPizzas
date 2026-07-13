import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { saveInventoryItem } from "@/app/admin/actions";
import { PanelShell } from "@/components/panel-shell";
import { createServerSupabaseClient } from "@/lib/supabase-server";

type InventoryItem = {
  id: string;
  name: string;
  unit: "g" | "kg" | "ml" | "l" | "unit";
  category_id: string | null;
  presentation_quantity: number | null;
  presentation_unit: "g" | "kg" | "ml" | "l" | "unit" | null;
  is_active: boolean;
  product_categories: { name: string } | null;
};

type ProductCategory = {
  id: string;
  name: string;
  is_active: boolean;
};

const managerRoles = new Set(["gerente", "admin_sistema"]);
const stockUnits = ["g", "kg", "ml", "l", "unit"];

export const dynamic = "force-dynamic";

function unitLabel(unit: string) {
  if (unit === "unit") return "unidad";
  return unit;
}

function formatQuantity(value: number | null) {
  if (!value) return "";
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 3 }).format(value);
}

function ItemForm({ categories, item }: { categories: ProductCategory[]; item?: InventoryItem }) {
  return (
    <form action={saveInventoryItem} className="compact-card">
      {item ? <input name="id" type="hidden" value={item.id} /> : null}
      <div>
        <h3>{item ? `Editar ${item.name}` : "Nuevo producto"}</h3>
        {item ? <span className="badge">{item.is_active ? "Activo" : "Inactivo"}</span> : <span className="badge">Maestro</span>}
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Nombre</label>
          <input defaultValue={item?.name} name="name" required />
        </div>
        <div className="field">
          <label>Unidad</label>
          <select defaultValue={item?.unit ?? "unit"} name="unit">
            {stockUnits.map((unit) => (
              <option key={unit} value={unit}>
                {unitLabel(unit)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Categoria</label>
          <div className="linked-field">
            <select defaultValue={item?.category_id ?? ""} name="category_id">
              <option value="">Sin categoria</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <Link className="ghost-button" href="/panel/categorias">
              <Plus size={18} />
            </Link>
          </div>
        </div>
        <div className="field">
          <label>Presentacion</label>
          <div className="split-input">
            <input defaultValue={formatQuantity(item?.presentation_quantity ?? null)} inputMode="decimal" name="presentation_quantity" placeholder="Ej. 1,5" />
            <select defaultValue={item?.presentation_unit ?? item?.unit ?? "unit"} name="presentation_unit">
              {stockUnits.map((unit) => (
                <option key={unit} value={unit}>
                  {unitLabel(unit)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
      <label className="check-option">
        <input defaultChecked={item?.is_active ?? true} name="is_active" type="checkbox" />
        <span>Activo</span>
      </label>
      <button className="primary-button" type="submit">
        Guardar producto
      </button>
    </form>
  );
}

export default async function SuppliesPage() {
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

  const [itemsResult, categoriesResult] = await Promise.all([
    supabase
      .from("inventory_items")
      .select("*, product_categories(name)")
      .order("is_active", { ascending: false })
      .order("name"),
    supabase.from("product_categories").select("id, name, is_active").eq("is_active", true).order("name")
  ]);
  const error = itemsResult.error ?? categoriesResult.error;
  const categories = (categoriesResult.data ?? []) as ProductCategory[];
  const items = (itemsResult.data ?? []) as unknown as InventoryItem[];

  return (
    <PanelShell
      active="insumos"
      roleNames={roleNames}
      subtitle="Registra los productos que luego se usaran en compras, inventario y recetas."
      title="Productos"
      userEmail={user.email ?? "usuario"}
    >
      {error ? <p className="alert">{error.message}</p> : null}
      <section className="editor-grid">
        <ItemForm categories={categories} />
      </section>
      <section className="form-panel">
        <h2>Listado de productos</h2>
        <div className="data-list">
          {items.map((item) => (
            <details className="data-row" key={item.id}>
              <summary>
                <strong>{item.name}</strong>
                <span>
                  {item.product_categories?.name ?? "Sin categoria"} - {unitLabel(item.unit)}
                  {item.presentation_quantity ? ` - ${formatQuantity(Number(item.presentation_quantity))} ${unitLabel(item.presentation_unit ?? item.unit)}` : ""}
                  {" - "}
                  {item.is_active ? "Activo" : "Inactivo"}
                </span>
              </summary>
              <ItemForm categories={categories} item={item} />
            </details>
          ))}
        </div>
      </section>
    </PanelShell>
  );
}
