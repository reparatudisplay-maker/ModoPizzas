import Link from "next/link";
import { redirect } from "next/navigation";
import { Bike, ChefHat, ClipboardList, Package, Plus, Settings, Store, Truck } from "lucide-react";
import { assignUserRole, removeUserRole, updateSiteSettings } from "@/app/admin/actions";
import { signOut } from "@/app/auth/actions";
import { updateOrderStatus } from "@/app/orders/actions";
import { formatCop } from "@/lib/format";
import { createServerSupabaseClient } from "@/lib/supabase-server";

type OrderItemSnapshot = {
  sizeId?: string;
  flavorAId?: string;
  flavorBId?: string | null;
  crustId?: string | null;
  extraIds?: string[];
  notes?: string;
};

type PanelOrder = {
  id: string;
  order_number: number;
  kind: "delivery" | "pickup" | "local";
  status: string;
  customer_name: string | null;
  customer_phone: string | null;
  delivery_address: string | null;
  delivery_neighborhood: string | null;
  total_cop: number;
  created_at: string;
  order_items: Array<{
    id: string;
    quantity: number;
    unit_price_cop: number;
    line_total_cop: number;
    notes: string | null;
  }>;
};

const staffRoles = new Set(["vendedor", "mesero", "cocina", "mensajero", "gerente", "admin_sistema"]);
const orderCreatorRoles = new Set(["vendedor", "mesero", "gerente", "admin_sistema"]);
const nextStatuses = ["confirmed", "in_kitchen", "in_preparation", "prepared", "on_the_way", "delivered", "cancelled"];
const assignableRoles = ["cliente", "vendedor", "mesero", "cocina", "mensajero", "gerente", "admin_sistema"];

export const dynamic = "force-dynamic";

const statusLabels: Record<string, string> = {
  sent_to_whatsapp: "WhatsApp",
  confirmed: "Confirmado",
  in_kitchen: "Cocina",
  in_preparation: "Preparacion",
  prepared: "Preparado",
  on_the_way: "En camino",
  delivered: "Entregado",
  cancelled: "Cancelado"
};

function parseSnapshot(value: string | null): OrderItemSnapshot {
  if (!value) return {};
  try {
    return JSON.parse(value) as OrderItemSnapshot;
  } catch {
    return {};
  }
}

function orderKindLabel(kind: PanelOrder["kind"]) {
  if (kind === "delivery") return "Domicilio";
  if (kind === "pickup") return "Recoger";
  return "Local";
}

function statusLabel(status: string) {
  return statusLabels[status] ?? status;
}

export default async function PanelPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roleNames = roles?.map((item) => item.role) ?? [];
  const canOperate = roleNames.some((role) => staffRoles.has(role));
  const canCreateOrders = roleNames.some((role) => orderCreatorRoles.has(role));
  const isAdmin = roleNames.includes("admin_sistema");
  const isManager = isAdmin || roleNames.includes("gerente");

  const [{ data: orders, error }, { data: settings }, { data: profiles }] = await Promise.all([
    canOperate
      ? supabase
        .from("orders")
        .select(
          "id, order_number, kind, status, customer_name, customer_phone, delivery_address, delivery_neighborhood, total_cop, created_at, order_items(id, quantity, unit_price_cop, line_total_cop, notes)"
        )
        .order("created_at", { ascending: false })
        .limit(30)
      : Promise.resolve({ data: null, error: null }),
    isManager
      ? supabase
          .from("site_settings")
          .select("business_name, whatsapp_number, whatsapp_enabled, whatsapp_button_text")
          .single()
      : Promise.resolve({ data: null, error: null }),
    isAdmin
      ? supabase
          .from("profiles")
          .select("id, full_name, phone, user_roles(role)")
          .order("created_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: null, error: null })
  ]);

  return (
    <main className="panel-page">
      <header className="panel-header">
        <div>
          <h1 className="section-title">Panel ModoPizzas</h1>
          <p className="section-copy">Pedidos web, cocina, caja y domicilios empiezan aqui.</p>
          <nav className="panel-nav" aria-label="Modulos del panel">
            <Link className="ghost-button" href="/">
              <Store size={16} /> Web publica
            </Link>
            {canCreateOrders ? (
              <Link className="primary-button" href="/panel/nuevo-pedido">
                <Plus size={16} /> Nuevo pedido
              </Link>
            ) : null}
            <a className="ghost-button" href="#pedidos">
              <ClipboardList size={16} /> Pedidos
            </a>
            <a className="ghost-button" href="#cocina">
              <ChefHat size={16} /> Cocina
            </a>
            <a className="ghost-button" href="#domicilios">
              <Bike size={16} /> Domicilios
            </a>
            {isManager ? (
              <Link className="ghost-button" href="/panel/menu">
                <Settings size={16} /> Menu
              </Link>
            ) : null}
            {isManager ? (
              <Link className="ghost-button" href="/panel/proveedores">
                <Truck size={16} /> Proveedores
              </Link>
            ) : null}
            {isManager ? (
              <Link className="ghost-button" href="/panel/inventario">
                <Package size={16} /> Inventario
              </Link>
            ) : null}
          </nav>
        </div>
        <form action={signOut}>
          <button className="ghost-button" type="submit">
            Cerrar sesion
          </button>
        </form>
      </header>

      <section className="metrics-grid">
        <div className="metric-card">
          <span>Usuario</span>
          <strong>{user.email}</strong>
        </div>
        <div className="metric-card">
          <span>Roles</span>
          <strong>{roleNames.length > 0 ? roleNames.join(", ") : "sin rol"}</strong>
        </div>
        <div className="metric-card">
          <span>Pedidos visibles</span>
          <strong>{orders?.length ?? 0}</strong>
        </div>
      </section>

      {canOperate ? (
        <section className="module-grid panel-modules" aria-label="Resumen de modulos activos">
          <article className="module-card" id="pedidos">
            <header>
              <h2>Vendedor / Caja</h2>
              <span className="badge">activo</span>
            </header>
            <p>Recibe pedidos web, crea pedidos internos, actualiza estados e imprime recibo o comanda.</p>
          </article>
          <article className="module-card" id="cocina">
            <header>
              <h2>Cocina</h2>
              <span className="badge">preparacion</span>
            </header>
            <p>Filtra mentalmente los pedidos confirmados, en cocina y en preparacion desde la lista principal.</p>
          </article>
          <article className="module-card" id="domicilios">
            <header>
              <h2>Domicilios</h2>
              <span className="badge">entrega</span>
            </header>
            <p>Los pedidos a domicilio muestran nombre, telefono, direccion y estado para el mensajero.</p>
          </article>
          {isManager ? (
            <article className="module-card">
              <header>
                <h2>Proveedores</h2>
                <span className="badge">maestro</span>
              </header>
              <p>Registra contactos de compra antes de cargar facturas, insumos y movimientos de inventario.</p>
              <Link className="module-link" href="/panel/proveedores">
                Abrir proveedores
              </Link>
            </article>
          ) : null}
        </section>
      ) : null}

      {!canOperate ? (
        <section className="form-panel">
          <h2>Cuenta activa</h2>
          <p className="muted">
            Tu cuenta existe, pero aun no tiene permisos operativos. Un administrador debe asignarte rol de vendedor,
            cocina, mensajero, gerente o administrador.
          </p>
        </section>
      ) : null}

      {error ? <p className="alert">{error.message}</p> : null}

      {isManager && settings ? (
        <section className="admin-grid">
          <form action={updateSiteSettings} className="form-panel">
            <h2>Ajustes publicos</h2>
            <div className="field">
              <label htmlFor="business_name">Nombre del negocio</label>
              <input defaultValue={settings.business_name} id="business_name" name="business_name" />
            </div>
            <div className="field">
              <label htmlFor="whatsapp_number">WhatsApp</label>
              <input defaultValue={settings.whatsapp_number} id="whatsapp_number" name="whatsapp_number" />
            </div>
            <div className="field">
              <label htmlFor="whatsapp_button_text">Texto del boton</label>
              <input
                defaultValue={settings.whatsapp_button_text}
                id="whatsapp_button_text"
                name="whatsapp_button_text"
              />
            </div>
            <label className="check-option">
              <input defaultChecked={settings.whatsapp_enabled} name="whatsapp_enabled" type="checkbox" />
              <span>WhatsApp activo</span>
            </label>
            <button className="primary-button" type="submit">
              Guardar ajustes
            </button>
          </form>

          {isAdmin ? (
            <section className="form-panel">
              <h2>Roles de usuarios</h2>
              <div className="role-list">
                {profiles?.map((profile) => {
                  const profileRoles = profile.user_roles?.map((roleRow) => roleRow.role) ?? [];
                  return (
                    <article className="role-row" key={profile.id}>
                      <div>
                        <strong>{profile.full_name || "Sin nombre"}</strong>
                        <small>{profile.phone || profile.id}</small>
                        <span className="muted">{profileRoles.length ? profileRoles.join(", ") : "sin rol"}</span>
                      </div>
                      <form action={assignUserRole} className="status-form">
                        <input name="user_id" type="hidden" value={profile.id} />
                        <select name="role">
                          {assignableRoles.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>
                        <button className="primary-button" type="submit">
                          Asignar
                        </button>
                      </form>
                      {profileRoles.map((role) => (
                        <form action={removeUserRole} className="inline-form" key={role}>
                          <input name="user_id" type="hidden" value={profile.id} />
                          <input name="role" type="hidden" value={role} />
                          <button className="ghost-button" type="submit">
                            Quitar {role}
                          </button>
                        </form>
                      ))}
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}
        </section>
      ) : null}

      {canOperate ? (
        <section className="panel-list" aria-label="Pedidos recientes">
          {(orders as PanelOrder[] | null)?.map((order) => (
            <article className="order-card" key={order.id}>
              <header>
                <div>
                  <h2>Pedido #{order.order_number}</h2>
                  <p className="muted">
                    {orderKindLabel(order.kind)} - {new Date(order.created_at).toLocaleString("es-CO")}
                  </p>
                </div>
                <span className={`badge status-badge status-${order.status}`}>{statusLabel(order.status)}</span>
              </header>

              <div className="order-details">
                <span>Cliente: {order.customer_name || "Sin nombre"}</span>
                <span>Telefono: {order.customer_phone || "No registrado"}</span>
                {order.kind === "delivery" ? (
                  <span>
                    Envio: {order.delivery_address} {order.delivery_neighborhood ? `- ${order.delivery_neighborhood}` : ""}
                  </span>
                ) : null}
              </div>

              <ul className="order-items">
                {order.order_items.map((item) => {
                  const snapshot = parseSnapshot(item.notes);
                  return (
                    <li key={item.id}>
                      <span>
                        {item.quantity} x Pizza {snapshot.sizeId ?? ""} {snapshot.flavorBId ? "mitad y mitad" : ""}
                      </span>
                      <small>
                        {snapshot.flavorAId}
                        {snapshot.flavorBId ? ` / ${snapshot.flavorBId}` : ""} - borde {snapshot.crustId ?? "normal"}
                        {snapshot.extraIds?.length ? ` - extras ${snapshot.extraIds.join(", ")}` : ""}
                        {snapshot.notes ? ` - ${snapshot.notes}` : ""}
                      </small>
                      <strong>{formatCop(item.line_total_cop)}</strong>
                    </li>
                  );
                })}
              </ul>

              <footer className="order-footer">
                <strong>Total {formatCop(order.total_cop)}</strong>
                <div className="print-links">
                  <Link className="ghost-button" href={`/panel/pedidos/${order.id}/recibo`}>
                    Recibo
                  </Link>
                  <Link className="ghost-button" href={`/panel/pedidos/${order.id}/comanda`}>
                    Comanda
                  </Link>
                </div>
                <form action={updateOrderStatus} className="status-form">
                  <input name="order_id" type="hidden" value={order.id} />
                  <select defaultValue={order.status} name="status">
                    {nextStatuses.map((status) => (
                      <option key={status} value={status}>
                        {statusLabel(status)}
                      </option>
                    ))}
                  </select>
                  <button className="primary-button" type="submit">
                    Actualizar
                  </button>
                </form>
              </footer>
            </article>
          ))}
        </section>
      ) : null}
    </main>
  );
}
