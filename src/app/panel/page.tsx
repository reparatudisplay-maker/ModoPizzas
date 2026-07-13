import Link from "next/link";
import { redirect } from "next/navigation";
import { OrderList } from "@/components/order-list";
import { PanelShell } from "@/components/panel-shell";
import { formatCop } from "@/lib/format";
import { getCurrentPanelUser, getPanelOrders, managerRoles, orderCreatorRoles, staffRoles } from "@/lib/panel-orders";

export const dynamic = "force-dynamic";

export default async function OrdersPanelPage() {
  const { user, roleNames } = await getCurrentPanelUser();

  if (!user) {
    redirect("/login");
  }

  const canOperate = roleNames.some((role) => staffRoles.has(role));
  const canCreateOrders = roleNames.some((role) => orderCreatorRoles.has(role));
  const isManager = roleNames.some((role) => managerRoles.has(role));
  const { orders, error } = canOperate ? await getPanelOrders() : { orders: [], error: null };
  const activeOrders = orders.filter((order) => !["delivered", "cancelled"].includes(order.status));
  const deliveryOrders = activeOrders.filter((order) => order.kind === "delivery");
  const totalActive = activeOrders.reduce((sum, order) => sum + Number(order.total_cop ?? 0), 0);

  return (
    <PanelShell
      active="pedidos"
      roleNames={roleNames}
      subtitle="Vista principal para vendedor, gerente y caja: pedidos activos, cobro, comanda y cambio de estado."
      title="Pedidos"
      userEmail={user.email ?? "usuario"}
      actions={
        canCreateOrders ? (
          <Link className="primary-button" href="/panel/nuevo-pedido">
            Nuevo pedido
          </Link>
        ) : null
      }
    >
      {!canOperate ? (
        <section className="form-panel">
          <h2>Cuenta sin modulo operativo</h2>
          <p className="muted">Un administrador debe asignar un rol de trabajador para activar el panel.</p>
        </section>
      ) : null}

      {error ? <p className="alert">{error.message}</p> : null}

      <section className="worker-metrics">
        <article>
          <span>Activos</span>
          <strong>{activeOrders.length}</strong>
        </article>
        <article>
          <span>Domicilios</span>
          <strong>{deliveryOrders.length}</strong>
        </article>
        <article>
          <span>Total activo</span>
          <strong>{formatCop(totalActive)}</strong>
        </article>
      </section>

      <section className="quick-lanes" aria-label="Accesos rapidos">
        <Link href="/panel/cocina">Cocina</Link>
        <Link href="/panel/domicilios">Domicilios</Link>
        {isManager ? <Link href="/panel/proveedores">Proveedores</Link> : null}
        {isManager ? <Link href="/panel/inventario">Inventario</Link> : null}
      </section>

      <OrderList orders={orders} />
    </PanelShell>
  );
}
