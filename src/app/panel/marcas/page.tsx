import { notFound, redirect } from "next/navigation";
import { saveBrand } from "@/app/admin/actions";
import { PanelShell } from "@/components/panel-shell";
import { createServerSupabaseClient } from "@/lib/supabase-server";

type Brand = {
  id: string;
  name: string;
  category: string | null;
  notes: string | null;
  is_active: boolean;
};

const managerRoles = new Set(["gerente", "admin_sistema"]);

export const dynamic = "force-dynamic";

function BrandForm({ brand }: { brand?: Brand }) {
  return (
    <form action={saveBrand} className="compact-card">
      {brand ? <input name="id" type="hidden" value={brand.id} /> : null}
      <div>
        <h3>{brand ? `Editar ${brand.name}` : "Nueva marca"}</h3>
        {brand ? <span className="badge">{brand.is_active ? "Activa" : "Inactiva"}</span> : <span className="badge">Maestro</span>}
      </div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor={brand ? `name-${brand.id}` : "name-new"}>Nombre</label>
          <input defaultValue={brand?.name} id={brand ? `name-${brand.id}` : "name-new"} name="name" required />
        </div>
        <div className="field">
          <label htmlFor={brand ? `category-${brand.id}` : "category-new"}>Categoria</label>
          <input defaultValue={brand?.category ?? ""} id={brand ? `category-${brand.id}` : "category-new"} name="category" placeholder="Harinas, quesos, carnes frias" />
        </div>
        <div className="field full">
          <label htmlFor={brand ? `notes-${brand.id}` : "notes-new"}>Notas</label>
          <textarea defaultValue={brand?.notes ?? ""} id={brand ? `notes-${brand.id}` : "notes-new"} name="notes" />
        </div>
      </div>
      <label className="check-option">
        <input defaultChecked={brand?.is_active ?? true} name="is_active" type="checkbox" />
        <span>Activa</span>
      </label>
      <button className="primary-button" type="submit">
        Guardar marca
      </button>
    </form>
  );
}

export default async function BrandsPage() {
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

  const { data, error } = await supabase.from("brands").select("*").order("is_active", { ascending: false }).order("name");
  const brands = (data ?? []) as Brand[];
  const activeCount = brands.filter((brand) => brand.is_active).length;

  return (
    <PanelShell
      active="marcas"
      roleNames={roleNames}
      subtitle="Dato maestro para identificar marcas de harinas, quesos, carnes frias, salsas, empaques y otros insumos."
      title="Marcas"
      userEmail={user.email ?? "usuario"}
    >
      <section className="metrics-grid">
        <div className="metric-card">
          <span>Total marcas</span>
          <strong>{brands.length}</strong>
        </div>
        <div className="metric-card">
          <span>Activas</span>
          <strong>{activeCount}</strong>
        </div>
        <div className="metric-card">
          <span>Uso</span>
          <strong>Compras</strong>
        </div>
      </section>

      {error ? <p className="alert">{error.message}</p> : null}

      <section className="admin-grid">
        <BrandForm />
      </section>

      <section className="form-panel">
        <h2>Listado de marcas</h2>
        <div className="data-list">
          {brands.length === 0 ? <p className="muted">Aun no hay marcas registradas.</p> : null}
          {brands.map((brand) => (
            <details className="data-row" key={brand.id}>
              <summary>
                <strong>{brand.name}</strong>
                <span>
                  {brand.category || "Sin categoria"} - {brand.is_active ? "Activa" : "Inactiva"}
                </span>
              </summary>
              <BrandForm brand={brand} />
            </details>
          ))}
        </div>
      </section>
    </PanelShell>
  );
}
