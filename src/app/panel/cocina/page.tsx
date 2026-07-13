import { redirect } from "next/navigation";
import { OrderList } from "@/components/order-list";
import { PanelShell } from "@/components/panel-shell";
import { getCurrentPanelUser, getPanelOrders, staffRoles } from "@/lib/panel-orders";

export const dynamic = "force-dynamic";

export default async function KitchenPage() {
  const { user, roleNames } = await getCurrentPanelUser();

  if (!user) {
    redirect("/login");
  }

  const canOperate = roleNames.some((role) => staffRoles.has(role));
  const { orders, error } = canOperate
    ? await getPanelOrders(["confirmed", "in_kitchen", "in_preparation", "prepared"])
    : { orders: [], error: null };

  return (
    <PanelShell
      active="cocina"
      roleNames={roleNames}
      subtitle="Pedidos que cocina debe preparar y actualizar. Se quitaron estados de horno/listo para mantener el flujo simple."
      title="Cocina"
      userEmail={user.email ?? "usuario"}
    >
      {error ? <p className="alert">{error.message}</p> : null}
      <section className="quick-lanes" aria-label="Flujo cocina">
        <span>Confirmado</span>
        <span>Cocina</span>
        <span>Preparacion</span>
        <span>Preparado</span>
      </section>
      <OrderList compact orders={orders} />
    </PanelShell>
  );
}
