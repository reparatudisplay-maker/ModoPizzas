"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { Ban, Search, X } from "lucide-react";
import { cancelPosOrder, type FormActionState } from "@/app/admin/actions";
import { formatCop } from "@/lib/format";
import { normalizeMasterText, uppercaseMasterName } from "@/lib/master-normalization";

export type PosOrderListRow = {
  id: string;
  code: string;
  kind: string;
  status: string;
  customer_name: string | null;
  total_cop: number;
  payment_method: string;
  created_at: string;
  items_count: number;
};

const initialState: FormActionState = { status: "idle", message: "" };

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    new: "Nuevo",
    confirmed: "Confirmado",
    preparing: "En preparacion",
    ready: "Listo",
    delivered: "Entregado",
    cancelled: "Cancelado"
  };
  return labels[status] ?? status;
}

function kindLabel(kind: string) {
  if (kind === "local") return "Local";
  if (kind === "pickup") return "Recoger";
  return "Domicilio";
}

export function PosOrdersList({ orders }: { orders: PosOrderListRow[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const normalizedQuery = normalizeMasterText(query);
  const filteredOrders = useMemo(
    () =>
      orders.filter((order) => {
        const text = `${order.code} ${order.customer_name ?? ""} ${order.status} ${order.kind}`;
        const matchesQuery = !normalizedQuery || normalizeMasterText(text).includes(normalizedQuery);
        const matchesStatus = status ? order.status === status : true;
        return matchesQuery && matchesStatus;
      }),
    [normalizedQuery, orders, status]
  );

  return (
    <section className="form-panel">
      <div className="section-title-row inventory-toolbar-row">
        <h2>Listado de pedidos</h2>
        <form className="table-filters" onSubmit={(event) => event.preventDefault()}>
          <label className="pos-search compact-search">
            <Search size={18} />
            <input onChange={(event) => setQuery(uppercaseMasterName(event.target.value))} placeholder="Buscar pedido" value={query} />
          </label>
          <select onChange={(event) => setStatus(event.target.value)} title="Estado" value={status}>
            <option value="">Todos</option>
            <option value="confirmed">Confirmados</option>
            <option value="preparing">En preparacion</option>
            <option value="ready">Listos</option>
            <option value="delivered">Entregados</option>
            <option value="cancelled">Cancelados</option>
          </select>
        </form>
      </div>
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>CODIGO</th>
              <th>TIPO</th>
              <th>CLIENTE</th>
              <th>ITEMS</th>
              <th>TOTAL</th>
              <th>PAGO</th>
              <th>ESTADO</th>
              <th>FECHA</th>
              <th className="actions-column compact-actions-column">ACCIONES</th>
            </tr>
          </thead>
          <tbody>
            {filteredOrders.map((order) => (
              <tr key={order.id}>
                <td><strong>{order.code}</strong></td>
                <td>{kindLabel(order.kind)}</td>
                <td>{order.customer_name ?? "Sin cliente"}</td>
                <td>{order.items_count}</td>
                <td>{formatCop(order.total_cop)}</td>
                <td>{order.payment_method}</td>
                <td><span className={`stock-pill ${order.status === "cancelled" ? "danger" : "ok"}`}>{statusLabel(order.status)}</span></td>
                <td>{new Date(order.created_at).toLocaleDateString("es-CO")}</td>
                <td className="actions-column compact-actions-column">
                  {order.status !== "cancelled" && order.status !== "delivered" ? <CancelOrderButton id={order.id} /> : null}
                </td>
              </tr>
            ))}
            {filteredOrders.length === 0 ? <tr><td colSpan={9}>Sin pedidos.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CancelOrderButton({ id }: { id: string }) {
  const [state, action] = useActionState(cancelPosOrder, initialState);
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return <button className="icon-button danger-button" onClick={() => setConfirming(true)} title="Cancelar pedido" type="button"><Ban size={16} /></button>;
  }
  return (
    <form action={action} className="inline-form compact-confirm-actions">
      <input name="order_id" type="hidden" value={id} />
      <input name="reason" type="hidden" value="Cancelado desde listado" />
      <SubmitCancelButton />
      <button className="icon-button" onClick={() => setConfirming(false)} title="No cancelar" type="button"><X size={16} /></button>
      {state.status !== "idle" ? <span className={`row-action-message ${state.status}`}>{state.message}</span> : null}
    </form>
  );
}

function SubmitCancelButton() {
  const { pending } = useFormStatus();
  return <button className="ghost-button danger-button compact-confirm-button" disabled={pending} type="submit">{pending ? "Cancelando..." : "Confirmar"}</button>;
}
