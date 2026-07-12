import Link from "next/link";
import { redirect } from "next/navigation";
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
const nextStatuses = ["confirmed", "in_kitchen", "in_preparation", "prepared", "on_the_way", "delivered", "cancelled"];

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

  const { data: orders, error } = canOperate
    ? await supabase
        .from("orders")
        .select(
          "id, order_number, kind, status, customer_name, customer_phone, delivery_address, delivery_neighborhood, total_cop, created_at, order_items(id, quantity, unit_price_cop, line_total_cop, notes)"
        )
        .order("created_at", { ascending: false })
        .limit(30)
    : { data: null, error: null };

  return (
    <main className="panel-page">
      <header className="panel-header">
        <div>
          <Link className="ghost-button" href="/">
            Inicio
          </Link>
          <h1 className="section-title">Panel ModoPizzas</h1>
          <p className="section-copy">Pedidos web, cocina, caja y domicilios empiezan aqui.</p>
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

      {canOperate ? (
        <section className="panel-list">
          {(orders as PanelOrder[] | null)?.map((order) => (
            <article className="order-card" key={order.id}>
              <header>
                <div>
                  <h2>Pedido #{order.order_number}</h2>
                  <p className="muted">
                    {orderKindLabel(order.kind)} · {new Date(order.created_at).toLocaleString("es-CO")}
                  </p>
                </div>
                <span className="badge">{order.status}</span>
              </header>

              <div className="order-details">
                <span>Cliente: {order.customer_name || "Sin nombre"}</span>
                <span>Telefono: {order.customer_phone || "No registrado"}</span>
                {order.kind === "delivery" ? (
                  <span>
                    Envio: {order.delivery_address} {order.delivery_neighborhood ? `· ${order.delivery_neighborhood}` : ""}
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
                        {snapshot.flavorBId ? ` / ${snapshot.flavorBId}` : ""} · borde {snapshot.crustId ?? "normal"}
                        {snapshot.extraIds?.length ? ` · extras ${snapshot.extraIds.join(", ")}` : ""}
                        {snapshot.notes ? ` · ${snapshot.notes}` : ""}
                      </small>
                      <strong>{formatCop(item.line_total_cop)}</strong>
                    </li>
                  );
                })}
              </ul>

              <footer className="order-footer">
                <strong>Total {formatCop(order.total_cop)}</strong>
                <form action={updateOrderStatus} className="status-form">
                  <input name="order_id" type="hidden" value={order.id} />
                  <select defaultValue={order.status} name="status">
                    {nextStatuses.map((status) => (
                      <option key={status} value={status}>
                        {status}
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
