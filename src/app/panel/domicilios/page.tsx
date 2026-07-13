import { redirect } from "next/navigation";
import { OrderList } from "@/components/order-list";
import { PanelShell } from "@/components/panel-shell";
import { getCurrentPanelUser, getPanelOrders, staffRoles } from "@/lib/panel-orders";

export const dynamic = "force-dynamic";

export default async function DeliveryPage() {
  const { user, roleNames } = await getCurrentPanelUser();

  if (!user) {
    redirect("/login");
  }

  const canOperate = roleNames.some((role) => staffRoles.has(role));
  const { orders, error } = canOperate ? await getPanelOrders(["prepared", "on_the_way", "delivered"], "delivery") : { orders: [], error: null };

  return (
    <PanelShell
      active="domicilios"
      roleNames={roleNames}
      subtitle="Pedidos a domicilio con nombre, telefono, direccion y estado de entrega."
      title="Domicilios"
      userEmail={user.email ?? "usuario"}
    >
      {error ? <p className="alert">{error.message}</p> : null}
      <section className="quick-lanes" aria-label="Flujo domicilio">
        <span>Preparado</span>
        <span>En camino</span>
        <span>Entregado</span>
      </section>
      <OrderList compact orders={orders} />
    </PanelShell>
  );
}
