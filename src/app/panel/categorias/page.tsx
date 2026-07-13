import { notFound, redirect } from "next/navigation";
import { saveProductCategory } from "@/app/admin/actions";
import { PanelShell } from "@/components/panel-shell";
import { createServerSupabaseClient } from "@/lib/supabase-server";

type ProductCategory = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
};

const managerRoles = new Set(["gerente", "admin_sistema"]);

export const dynamic = "force-dynamic";

function CategoryForm({ category }: { category?: ProductCategory }) {
  return (
    <form action={saveProductCategory} className="compact-card">
      {category ? <input name="id" type="hidden" value={category.id} /> : null}
      <div>
        <h3>{category ? `Editar ${category.name}` : "Nueva categoria"}</h3>
        {category ? <span className="badge">{category.is_active ? "Activa" : "Inactiva"}</span> : <span className="badge">Maestro</span>}
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Nombre</label>
          <input defaultValue={category?.name} name="name" required />
        </div>
        <div className="field full">
          <label>Descripcion</label>
          <textarea defaultValue={category?.description ?? ""} name="description" placeholder="Uso, tipo de productos o notas internas" />
        </div>
      </div>
      <label className="check-option">
        <input defaultChecked={category?.is_active ?? true} name="is_active" type="checkbox" />
        <span>Activa</span>
      </label>
      <button className="primary-button" type="submit">
        Guardar categoria
      </button>
    </form>
  );
}

export default async function CategoriesPage() {
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

  const { data, error } = await supabase.from("product_categories").select("*").order("is_active", { ascending: false }).order("name");
  const categories = (data ?? []) as ProductCategory[];
  const activeCount = categories.filter((category) => category.is_active).length;

  return (
    <PanelShell
      active="categorias"
      roleNames={roleNames}
      subtitle="Agrupa productos para compras, inventario, recetas y reportes."
      title="Categorias"
      userEmail={user.email ?? "usuario"}
    >
      <section className="metrics-grid">
        <div className="metric-card">
          <span>Total categorias</span>
          <strong>{categories.length}</strong>
        </div>
        <div className="metric-card">
          <span>Activas</span>
          <strong>{activeCount}</strong>
        </div>
        <div className="metric-card">
          <span>Uso</span>
          <strong>Productos</strong>
        </div>
      </section>

      {error ? <p className="alert">{error.message}</p> : null}

      <section className="editor-grid">
        <CategoryForm />
      </section>

      <section className="form-panel">
        <h2>Listado de categorias</h2>
        <div className="data-list">
          {categories.map((category) => (
            <details className="data-row" key={category.id}>
              <summary>
                <strong>{category.name}</strong>
                <span>{category.is_active ? "Activa" : "Inactiva"}</span>
              </summary>
              <CategoryForm category={category} />
            </details>
          ))}
        </div>
      </section>
    </PanelShell>
  );
}
