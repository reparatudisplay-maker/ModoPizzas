import { notFound, redirect } from "next/navigation";
import { PanelShell } from "@/components/panel-shell";
import { PosOrdersList, type PosOrderListRow } from "@/components/pos-orders-list";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const orderRoles = new Set(["vendedor", "mesero", "gerente", "admin_sistema"]);

type OrderRow = {
  id: string;
  code: string;
  kind: string;
  status: string;
  customer_name: string | null;
  total_cop: number;
  payment_method: string;
  created_at: string;
  pos_order_items: { id: string }[];
};

export default async function PedidosPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roleNames = roles?.map((item) => item.role) ?? [];
  if (!roleNames.some((role) => orderRoles.has(role))) notFound();

  const { data, error } = await supabase
    .from("pos_orders")
    .select("id, code, kind, status, customer_name, total_cop, payment_method, created_at, pos_order_items(id)")
    .order("created_at", { ascending: false })
    .limit(80);

  const orders = ((data ?? []) as unknown as OrderRow[]).map((order) => ({
    id: order.id,
    code: order.code,
    kind: order.kind,
    status: order.status,
    customer_name: order.customer_name,
    total_cop: Number(order.total_cop ?? 0),
    payment_method: order.payment_method,
    created_at: order.created_at,
    items_count: order.pos_order_items?.length ?? 0
  })) satisfies PosOrderListRow[];

  return (
    <PanelShell active="pedidos-listado" hideHeader roleNames={roleNames} title="Pedidos" userEmail={user.email ?? "usuario"}>
      {error ? <p className="alert">{error.message}</p> : null}
      <PosOrdersList orders={orders} />
    </PanelShell>
  );
}
