import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { saveSupplier } from "@/app/admin/actions";
import { createServerSupabaseClient } from "@/lib/supabase-server";

type Supplier = {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
};

const managerRoles = new Set(["gerente", "admin_sistema"]);

export const dynamic = "force-dynamic";

function SupplierForm({ supplier }: { supplier?: Supplier }) {
  return (
    <form action={saveSupplier} className="compact-card">
      {supplier ? <input name="id" type="hidden" value={supplier.id} /> : null}
      <div>
        <h3>{supplier ? `Editar ${supplier.name}` : "Nuevo proveedor"}</h3>
        {supplier ? <span className="badge">{supplier.is_active ? "Activo" : "Inactivo"}</span> : <span className="badge">Maestro</span>}
      </div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor={supplier ? `name-${supplier.id}` : "name-new"}>Nombre</label>
          <input defaultValue={supplier?.name} id={supplier ? `name-${supplier.id}` : "name-new"} name="name" required />
        </div>
        <div className="field">
          <label htmlFor={supplier ? `phone-${supplier.id}` : "phone-new"}>Telefono</label>
          <input defaultValue={supplier?.phone ?? ""} id={supplier ? `phone-${supplier.id}` : "phone-new"} name="phone" />
        </div>
        <div className="field full">
          <label htmlFor={supplier ? `notes-${supplier.id}` : "notes-new"}>Notas</label>
          <textarea
            defaultValue={supplier?.notes ?? ""}
            id={supplier ? `notes-${supplier.id}` : "notes-new"}
            name="notes"
            placeholder="Contacto, direccion, condiciones de pago o productos que suministra"
          />
        </div>
      </div>
      <label className="check-option">
        <input defaultChecked={supplier?.is_active ?? true} name="is_active" type="checkbox" />
        <span>Activo</span>
      </label>
      <button className="primary-button" type="submit">
        Guardar proveedor
      </button>
    </form>
  );
}

export default async function SuppliersPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const canManage = roles?.some((item) => managerRoles.has(item.role)) ?? false;
  if (!canManage) {
    notFound();
  }

  const { data, error } = await supabase.from("suppliers").select("*").order("is_active", { ascending: false }).order("name");
  const suppliers = (data ?? []) as Supplier[];
  const activeCount = suppliers.filter((supplier) => supplier.is_active).length;

  return (
    <main className="panel-page">
      <header className="panel-header">
        <div>
          <nav className="panel-nav" aria-label="Navegacion de proveedores">
            <Link className="ghost-button" href="/panel">
              Panel
            </Link>
            <Link className="ghost-button" href="/panel/inventario">
              Inventario
            </Link>
          </nav>
          <h1 className="section-title">Proveedores</h1>
          <p className="section-copy">
            Este es un dato maestro: primero crea proveedores, luego registra compras de insumos asociadas a ellos.
          </p>
        </div>
      </header>

      <section className="metrics-grid">
        <div className="metric-card">
          <span>Total proveedores</span>
          <strong>{suppliers.length}</strong>
        </div>
        <div className="metric-card">
          <span>Activos</span>
          <strong>{activeCount}</strong>
        </div>
        <div className="metric-card">
          <span>Uso</span>
          <strong>Compras</strong>
        </div>
      </section>

      {error ? <p className="alert">{error.message}</p> : null}

      <section className="admin-grid">
        <SupplierForm />
        <article className="form-panel">
          <h2>Prueba recomendada</h2>
          <div className="data-list">
            <div className="data-row static-row">
              <strong>1. Crear proveedor</strong>
              <span>Nombre y telefono son suficientes para validar el modulo.</span>
            </div>
            <div className="data-row static-row">
              <strong>2. Editar proveedor</strong>
              <span>Abre un proveedor existente, cambia notas o telefono y guarda.</span>
            </div>
            <div className="data-row static-row">
              <strong>3. Registrar compra</strong>
              <span>Luego ve a inventario y usa ese proveedor en una compra.</span>
            </div>
          </div>
        </article>
      </section>

      <section className="form-panel">
        <h2>Listado de proveedores</h2>
        <div className="data-list">
          {suppliers.length === 0 ? <p className="muted">Aun no hay proveedores registrados.</p> : null}
          {suppliers.map((supplier) => (
            <details className="data-row" key={supplier.id}>
              <summary>
                <strong>{supplier.name}</strong>
                <span>{supplier.phone || "Sin telefono"} - {supplier.is_active ? "Activo" : "Inactivo"}</span>
              </summary>
              <SupplierForm supplier={supplier} />
            </details>
          ))}
        </div>
      </section>
    </main>
  );
}
