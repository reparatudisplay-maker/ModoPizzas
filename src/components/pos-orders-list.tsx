"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { Ban, Eye, Search, X } from "lucide-react";
import { cancelPosOrder, type FormActionState } from "@/app/admin/actions";
import { formatCop } from "@/lib/format";
import { normalizeMasterText, uppercaseMasterName } from "@/lib/master-normalization";
import { formatStockQuantity, type StockUnit } from "@/lib/units";

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
  notes: string | null;
  created_by_name: string;
  cancelled_at: string | null;
  cancelled_by_name: string | null;
  cancel_reason: string | null;
  payments: Array<{
    method: string;
    amount_cop: number;
    cash_received_cop: number | null;
    cash_change_cop: number | null;
  }>;
  items: Array<{
    id: string;
    item_kind: "pizza" | "sale_product";
    quantity: number;
    product_name_snapshot: string;
    sku_snapshot: string | null;
    unit_price_cop: number;
    line_subtotal_cop: number;
    notes: string | null;
    presentation_quantity: number | null;
    presentation_unit: StockUnit | null;
    additions: Array<{
      id: string;
      quantity: number;
      name_snapshot: string;
      unit_price_cop: number;
      line_subtotal_cop: number;
      scope: "whole" | "left" | "right";
      scope_label: string | null;
    }>;
    kitchen: Array<{
      status: "pending" | "in_preparation" | "prepared";
      received_at: string;
      started_at: string | null;
      prepared_at: string | null;
    }>;
  }>;
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
  const [detailOrder, setDetailOrder] = useState<PosOrderListRow | null>(null);
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
              <th>USUARIO</th>
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
                <td>{order.created_by_name}</td>
                <td>{order.items_count}</td>
                <td>{formatCop(order.total_cop)}</td>
                <td>{order.payment_method}</td>
                <td><span className={`stock-pill ${order.status === "cancelled" ? "danger" : "ok"}`}>{statusLabel(order.status)}</span></td>
                <td>{new Date(order.created_at).toLocaleDateString("es-CO")}</td>
                <td className="actions-column compact-actions-column">
                  <button className="icon-button" onClick={() => setDetailOrder(order)} title={`Ver detalle de ${order.code}`} type="button"><Eye size={16} /></button>
                  {order.status !== "cancelled" && order.status !== "delivered" ? <CancelOrderButton id={order.id} /> : null}
                </td>
              </tr>
            ))}
            {filteredOrders.length === 0 ? <tr><td colSpan={10}>Sin pedidos.</td></tr> : null}
          </tbody>
        </table>
      </div>
      {detailOrder ? <PosOrderDetailModal order={detailOrder} onClose={() => setDetailOrder(null)} /> : null}
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

function formatDateTime(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function paymentLabel(method: string) {
  const labels: Record<string, string> = {
    cash: "Efectivo",
    card: "Tarjeta",
    transfer: "Transferencia",
    mixed: "Mixto",
    pending: "Pendiente"
  };
  return labels[method] ?? method;
}

function kitchenLabel(status: "pending" | "in_preparation" | "prepared") {
  const labels = { pending: "Pendiente", in_preparation: "En preparación", prepared: "Preparado" };
  return labels[status];
}

function additionScope(addition: PosOrderListRow["items"][number]["additions"][number]) {
  if (addition.scope === "whole") return "";
  return ` (${addition.scope_label ?? (addition.scope === "left" ? "mitad izquierda" : "mitad derecha")})`;
}

function PosOrderDetailModal({ order, onClose }: { order: PosOrderListRow; onClose: () => void }) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const cashPayment = order.payments.find((payment) => payment.method === "cash");
  const kitchenItems = order.items.flatMap((item) => item.kitchen);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-label={`Detalle del pedido ${order.code}`} aria-modal="true" className="modal-panel order-detail-modal" role="dialog">
        <header className="modal-header">
          <div>
            <strong>Pedido {order.code}</strong>
            <span>{formatDateTime(order.created_at)} · {kindLabel(order.kind)}</span>
          </div>
          <button className="icon-button" onClick={onClose} title="Cerrar" type="button"><X size={18} /></button>
        </header>
        <div className="order-detail-content">
          <div className="order-detail-meta">
            <span className={`stock-pill ${order.status === "cancelled" ? "danger" : "ok"}`}>{statusLabel(order.status)}</span>
            <span><b>Cliente:</b> {order.customer_name ?? "Sin cliente"}</span>
            <span><b>Usuario:</b> {order.created_by_name}</span>
            <span><b>Pago:</b> {paymentLabel(order.payment_method)}</span>
          </div>

          <section className="order-detail-section" aria-label="Items del pedido">
            <h3>Items</h3>
            <div className="order-detail-items">
              {order.items.map((item) => {
                const presentation = item.item_kind === "sale_product" && item.presentation_quantity !== null && item.presentation_unit
                  ? formatStockQuantity(item.presentation_quantity, item.presentation_unit)
                  : null;
                return (
                  <article className="order-detail-item" key={item.id}>
                    <div>
                      <strong>{item.quantity} × {item.product_name_snapshot}{presentation ? ` ${presentation}` : ""}</strong>
                      {item.item_kind === "pizza" ? <small>{item.product_name_snapshot.includes(" / ") ? "Mitad y mitad" : "Pizza"}</small> : null}
                      {item.item_kind === "pizza" ? <small>Sin: {item.notes ?? "—"}</small> : null}
                      {item.additions.length > 0 ? (
                        <small>Adiciones: {item.additions.map((addition) => `+ ${addition.name_snapshot} x${addition.quantity}${additionScope(addition)}`).join(", ")}</small>
                      ) : item.item_kind === "pizza" ? <small>Adiciones: —</small> : null}
                      {item.item_kind === "sale_product" ? <small>{formatCop(item.unit_price_cop)} c/u</small> : null}
                    </div>
                    <div className="order-detail-line-total">
                      <small>{formatCop(item.unit_price_cop)} c/u</small>
                      <strong>{formatCop(item.line_subtotal_cop)}</strong>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="order-detail-summary" aria-label="Resumen del pedido">
            <div><span>Total pedido</span><strong>{formatCop(order.total_cop)}</strong></div>
            <div><span>Método de pago</span><strong>{paymentLabel(order.payment_method)}</strong></div>
            {cashPayment ? <div><span>Efectivo recibido</span><strong>{cashPayment.cash_received_cop === null ? "—" : formatCop(cashPayment.cash_received_cop)}</strong></div> : null}
            {cashPayment ? <div><span>Cambio</span><strong>{cashPayment.cash_change_cop === null ? "—" : formatCop(cashPayment.cash_change_cop)}</strong></div> : null}
            <div className="order-detail-wide"><span>Observaciones</span><strong>{order.notes ?? "—"}</strong></div>
          </section>

          {kitchenItems.length > 0 ? (
            <section className="order-detail-section" aria-label="Estado de cocina">
              <h3>Cocina</h3>
              <div className="order-detail-kitchen-grid">
                {kitchenItems.map((item, index) => (
                  <div className="order-detail-kitchen" key={`${item.received_at}-${index}`}>
                    <span className="stock-pill ok">{kitchenLabel(item.status)}</span>
                    <small>Recibido: {formatDateTime(item.received_at)}</small>
                    <small>Iniciado: {formatDateTime(item.started_at)}</small>
                    <small>Preparado: {formatDateTime(item.prepared_at)}</small>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {order.status === "cancelled" ? (
            <section className="order-detail-cancelled" aria-label="Información de cancelación">
              <strong>Cancelado</strong>
              <span>{formatDateTime(order.cancelled_at)}{order.cancelled_by_name ? ` · ${order.cancelled_by_name}` : ""}</span>
              <span>Motivo: {order.cancel_reason ?? "Sin motivo registrado"}</span>
            </section>
          ) : null}
        </div>
      </section>
    </div>
  );
}
