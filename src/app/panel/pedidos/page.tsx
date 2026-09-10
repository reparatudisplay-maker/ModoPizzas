import { PanelShell } from "@/components/panel-shell";
import { PosOrdersList, type PosOrderListRow } from "@/components/pos-orders-list";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePanelAccess } from "@/lib/panel-auth";

export const dynamic = "force-dynamic";


type OrderRow = {
  id: string;
  code: string;
  kind: string;
  status: string;
  customer_name: string | null;
  total_cop: number;
  payment_method: string;
  notes: string | null;
  created_by: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  created_at: string;
  pos_order_payments: Array<{
    method: string;
    amount_cop: number;
    cash_received_cop: number | null;
    cash_change_cop: number | null;
  }>;
  pos_order_items: Array<{
    id: string;
    item_kind: "pizza" | "sale_product";
    quantity: number;
    product_name_snapshot: string;
    sku_snapshot: string | null;
    unit_price_cop: number;
    line_subtotal_cop: number;
    notes: string | null;
    inventory_items: { presentation_quantity: number | null; presentation_unit: "g" | "kg" | "ml" | "l" | "unit" | null } | null;
    pos_order_item_additions: Array<{
      id: string;
      quantity: number;
      name_snapshot: string;
      unit_price_cop: number;
      line_subtotal_cop: number;
      scope: "whole" | "left" | "right";
      scope_label: string | null;
    }> | null;
    kitchen_order_items: {
      status: "pending" | "in_preparation" | "prepared";
      received_at: string;
      started_at: string | null;
      prepared_at: string | null;
    } | null;
  }>;
};

function asArray<T>(value: T[] | T | null | undefined): T[] {
  return Array.isArray(value) ? value : value ? [value] : [];
}

export default async function PedidosPage() {
  const supabase = await createServerSupabaseClient();
  const { user, roleNames, moduleKeys } = await requirePanelAccess(supabase, "pedidos");

  const { data, error } = await supabase
    .from("pos_orders")
    .select(`
      id, code, kind, status, customer_name, total_cop, payment_method, notes, created_by, cancelled_at, cancelled_by, cancel_reason, created_at,
      pos_order_payments(method, amount_cop, cash_received_cop, cash_change_cop),
      pos_order_items(
        id, item_kind, quantity, product_name_snapshot, sku_snapshot, unit_price_cop, line_subtotal_cop, notes,
        inventory_items(presentation_quantity, presentation_unit),
        pos_order_item_additions(id, quantity, name_snapshot, unit_price_cop, line_subtotal_cop, scope, scope_label),
        kitchen_order_items(status, received_at, started_at, prepared_at)
      )
    `)
    .order("created_at", { ascending: false })
    .limit(80);

  const rawOrders = (data ?? []) as unknown as OrderRow[];
  const profileIds = [...new Set(rawOrders.flatMap((order) => [order.created_by, order.cancelled_by]).filter((id): id is string => Boolean(id)))];
  const { data: profiles } = profileIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", profileIds)
    : { data: [] as Array<{ id: string; full_name: string | null; email: string | null }> };
  const profileNameById = new Map((profiles ?? []).map((profile) => [profile.id, profile.full_name ?? profile.email ?? "Usuario no disponible"]));

  const orders = rawOrders.map((order) => ({
    id: order.id,
    code: order.code,
    kind: order.kind,
    status: order.status,
    customer_name: order.customer_name,
    total_cop: Number(order.total_cop ?? 0),
    payment_method: order.payment_method,
    created_at: order.created_at,
    items_count: order.pos_order_items?.length ?? 0,
    notes: order.notes,
    created_by_name: order.created_by ? profileNameById.get(order.created_by) ?? "Usuario no disponible" : "Usuario no disponible",
    cancelled_at: order.cancelled_at,
    cancelled_by_name: order.cancelled_by ? profileNameById.get(order.cancelled_by) ?? "Usuario no disponible" : null,
    cancel_reason: order.cancel_reason,
    payments: asArray(order.pos_order_payments).map((payment) => ({
      method: payment.method,
      amount_cop: Number(payment.amount_cop ?? 0),
      cash_received_cop: payment.cash_received_cop === null ? null : Number(payment.cash_received_cop),
      cash_change_cop: payment.cash_change_cop === null ? null : Number(payment.cash_change_cop)
    })),
    items: (order.pos_order_items ?? []).map((item) => ({
      id: item.id,
      item_kind: item.item_kind,
      quantity: Number(item.quantity ?? 0),
      product_name_snapshot: item.product_name_snapshot,
      sku_snapshot: item.sku_snapshot,
      unit_price_cop: Number(item.unit_price_cop ?? 0),
      line_subtotal_cop: Number(item.line_subtotal_cop ?? 0),
      notes: item.notes,
      presentation_quantity: item.inventory_items?.presentation_quantity === null || item.inventory_items?.presentation_quantity === undefined ? null : Number(item.inventory_items.presentation_quantity),
      presentation_unit: item.inventory_items?.presentation_unit ?? null,
      additions: asArray(item.pos_order_item_additions).map((addition) => ({
        id: addition.id,
        quantity: Number(addition.quantity ?? 0),
        name_snapshot: addition.name_snapshot,
        unit_price_cop: Number(addition.unit_price_cop ?? 0),
        line_subtotal_cop: Number(addition.line_subtotal_cop ?? 0),
        scope: addition.scope,
        scope_label: addition.scope_label
      })),
      kitchen: asArray(item.kitchen_order_items).map((kitchenItem) => ({
        status: kitchenItem.status,
        received_at: kitchenItem.received_at,
        started_at: kitchenItem.started_at,
        prepared_at: kitchenItem.prepared_at
      }))
    }))
  })) satisfies PosOrderListRow[];

  return (
    <PanelShell active="pedidos-listado" hideHeader moduleKeys={moduleKeys} roleNames={roleNames} title="Pedidos" userEmail={user.email ?? "usuario"}>
      {error ? <p className="alert">{error.message}</p> : null}
      <PosOrdersList orders={orders} />
    </PanelShell>
  );
}
