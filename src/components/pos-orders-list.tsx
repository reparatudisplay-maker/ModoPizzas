"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Ban, CalendarClock, CheckSquare, Eye, Search, Settings, Trash2, WalletCards, X } from "lucide-react";
import {
  cancelPosOrder,
  deletePosOrderForTesting,
  getPosOrderTestDeletionPreview,
  updatePosOrderOperationalDate,
  updatePosOrderPaymentMethod,
  type FormActionState,
  type PosOrderTestDeletionPreview
} from "@/app/admin/actions";
import { formatCop } from "@/lib/format";
import { normalizeMasterText, uppercaseMasterName } from "@/lib/master-normalization";
import { formatStockQuantity, type StockUnit } from "@/lib/units";

export type PosOrderListRow = {
  id: string;
  code: string;
  kind: string;
  status: string;
  customer_name: string | null;
  subtotal_cop: number;
  discount_cop: number;
  delivery_cop: number;
  discount_type: "none" | "percentage" | "amount";
  discount_value: number;
  total_cop: number;
  payment_method: string;
  ordered_at: string;
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
    base_default_name: string | null;
    base_used_name: string | null;
    base_replaced_by_name: string | null;
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
const orderColumnsKey = "modopizzas.pos-orders.columns";
type OrderColumn = "code" | "kind" | "customer" | "user" | "summary" | "items" | "subtotal" | "discount" | "delivery" | "total" | "payment" | "status" | "date" | "time" | "actions";
const allOrderColumns: OrderColumn[] = ["code", "kind", "customer", "user", "summary", "items", "subtotal", "discount", "delivery", "total", "payment", "status", "date", "time", "actions"];
const defaultOrderColumns: OrderColumn[] = ["code", "kind", "user", "summary", "total", "payment", "status", "date", "actions"];
const orderColumnLabels: Record<OrderColumn, string> = {
  code: "Código",
  kind: "Tipo",
  customer: "Cliente",
  user: "Usuario",
  summary: "Resumen",
  items: "Ítems",
  subtotal: "Subtotal",
  discount: "Descuento",
  delivery: "Domicilio",
  total: "Total",
  payment: "Pago",
  status: "Estado",
  date: "Fecha",
  time: "Hora",
  actions: "Acciones"
};

function initialOrderColumns() {
  if (typeof window === "undefined") return defaultOrderColumns;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(orderColumnsKey) ?? "[]");
    const columns = Array.isArray(parsed) ? parsed.filter((item): item is OrderColumn => allOrderColumns.includes(item)) : [];
    return columns.length ? columns : defaultOrderColumns;
  } catch {
    return defaultOrderColumns;
  }
}

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

function operationalDateParts(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return { date: `${part("year")}-${part("month")}-${part("day")}`, time: `${part("hour")}:${part("minute")}` };
}

export function PosOrdersList({ canDeleteForTests, canEditOperationalDate, canEditPayment, orders }: { canDeleteForTests: boolean; canEditOperationalDate: boolean; canEditPayment: boolean; orders: PosOrderListRow[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [columns, setColumns] = useState<OrderColumn[]>(defaultOrderColumns);
  const [columnsReady, setColumnsReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detailOrder, setDetailOrder] = useState<PosOrderListRow | null>(null);
  const [dateOrder, setDateOrder] = useState<PosOrderListRow | null>(null);
  const [paymentOrder, setPaymentOrder] = useState<PosOrderListRow | null>(null);
  const [deletionOrder, setDeletionOrder] = useState<PosOrderListRow | null>(null);
  const [deletionPreview, setDeletionPreview] = useState<PosOrderTestDeletionPreview | null>(null);
  const [deletionPreviewError, setDeletionPreviewError] = useState("");
  const [deletionPreviewLoading, setDeletionPreviewLoading] = useState(false);
  const normalizedQuery = normalizeMasterText(query);
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setColumns(initialOrderColumns());
      setColumnsReady(true);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);
  useEffect(() => {
    if (!columnsReady) return;
    window.localStorage.setItem(orderColumnsKey, JSON.stringify(columns));
  }, [columns, columnsReady]);
  const filteredOrders = useMemo(
    () =>
      orders.filter((order) => {
        const text = `${order.code} ${order.customer_name ?? ""} ${order.created_by_name} ${order.status} ${order.kind} ${order.items.map((item) => item.product_name_snapshot).join(" ")}`;
        const matchesQuery = !normalizedQuery || normalizeMasterText(text).includes(normalizedQuery);
        const matchesStatus = status ? order.status === status : true;
        return matchesQuery && matchesStatus;
      }),
    [normalizedQuery, orders, status]
  );
  const visibleColumn = (column: OrderColumn) => columns.includes(column);
  const visibleCount = columns.length || defaultOrderColumns.length;
  const toggleColumn = (column: OrderColumn) =>
    setColumns((current) => {
      if (!current.includes(column)) return [...current, column];
      if (current.length <= 1) return current;
      return current.filter((item) => item !== column);
    });

  const openDeletion = async (order: PosOrderListRow) => {
    setDeletionOrder(order);
    setDeletionPreview(null);
    setDeletionPreviewError("");
    setDeletionPreviewLoading(true);
    const result = await getPosOrderTestDeletionPreview(order.id);
    setDeletionPreviewLoading(false);
    if (result.status === "error" || !result.preview) {
      setDeletionPreviewError(result.message);
      return;
    }
    setDeletionPreview(result.preview);
  };

  const closeDeletion = () => {
    setDeletionOrder(null);
    setDeletionPreview(null);
    setDeletionPreviewError("");
  };

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
          <button className="ghost-button table-settings-button" onClick={() => setSettingsOpen(true)} type="button">
            <Settings size={18} /> Configuración
          </button>
        </form>
      </div>
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              {visibleColumn("code") ? <th>CÓDIGO</th> : null}
              {visibleColumn("kind") ? <th>TIPO</th> : null}
              {visibleColumn("customer") ? <th>CLIENTE</th> : null}
              {visibleColumn("user") ? <th>USUARIO</th> : null}
              {visibleColumn("summary") ? <th>RESUMEN</th> : null}
              {visibleColumn("items") ? <th>ÍTEMS</th> : null}
              {visibleColumn("subtotal") ? <th>SUBTOTAL</th> : null}
              {visibleColumn("discount") ? <th>DESCUENTO</th> : null}
              {visibleColumn("delivery") ? <th>DOMICILIO</th> : null}
              {visibleColumn("total") ? <th>TOTAL</th> : null}
              {visibleColumn("payment") ? <th>PAGO</th> : null}
              {visibleColumn("status") ? <th>ESTADO</th> : null}
              {visibleColumn("date") ? <th>FECHA</th> : null}
              {visibleColumn("time") ? <th>HORA</th> : null}
              {visibleColumn("actions") ? <th className="actions-column compact-actions-column">ACCIONES</th> : null}
            </tr>
          </thead>
          <tbody>
            {filteredOrders.map((order) => (
              <tr key={order.id}>
                {visibleColumn("code") ? <td><strong>{order.code}</strong></td> : null}
                {visibleColumn("kind") ? <td>{kindLabel(order.kind)}</td> : null}
                {visibleColumn("customer") ? <td>{order.customer_name ?? "Sin cliente"}</td> : null}
                {visibleColumn("user") ? <td>{order.created_by_name}</td> : null}
                {visibleColumn("summary") ? <td><OrderSummary order={order} /></td> : null}
                {visibleColumn("items") ? <td>{order.items_count}</td> : null}
                {visibleColumn("subtotal") ? <td>{formatCop(order.subtotal_cop)}</td> : null}
                {visibleColumn("discount") ? <td>{order.discount_cop > 0 ? `-${formatCop(order.discount_cop)}` : "—"}</td> : null}
                {visibleColumn("delivery") ? <td>{order.delivery_cop > 0 ? formatCop(order.delivery_cop) : "—"}</td> : null}
                {visibleColumn("total") ? <td>{formatCop(order.total_cop)}</td> : null}
                {visibleColumn("payment") ? <td>{paymentLabel(order.payment_method)}</td> : null}
                {visibleColumn("status") ? <td><span className={`stock-pill ${order.status === "cancelled" ? "danger" : "ok"}`}>{statusLabel(order.status)}</span></td> : null}
                {visibleColumn("date") ? <td>{new Date(order.ordered_at).toLocaleDateString("es-CO", { timeZone: "America/Bogota" })}</td> : null}
                {visibleColumn("time") ? <td>{new Date(order.ordered_at).toLocaleTimeString("es-CO", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit" })}</td> : null}
                {visibleColumn("actions") ? <td className="actions-column compact-actions-column">
                  <button className="icon-button" onClick={() => setDetailOrder(order)} title={`Ver detalle de ${order.code}`} type="button"><Eye size={16} /></button>
                  {canEditOperationalDate ? <button className="icon-button" onClick={() => setDateOrder(order)} title={`Editar fecha de ${order.code}`} type="button"><CalendarClock size={16} /></button> : null}
                  {canEditPayment && order.status !== "cancelled" ? <button className="icon-button" onClick={() => setPaymentOrder(order)} title={`Editar pago de ${order.code}`} type="button"><WalletCards size={16} /></button> : null}
                  {order.status !== "cancelled" && order.status !== "delivered" ? <CancelOrderButton id={order.id} /> : null}
                  {canDeleteForTests && order.status !== "cancelled" ? <button className="icon-button danger-button" onClick={() => void openDeletion(order)} title={`Eliminar ${order.code} en modo pruebas`} type="button"><Trash2 size={16} /></button> : null}
                </td> : null}
              </tr>
            ))}
            {filteredOrders.length === 0 ? <tr><td colSpan={visibleCount}>Sin pedidos.</td></tr> : null}
          </tbody>
        </table>
      </div>
      {settingsOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
          <section aria-label="Configuración de columnas" aria-modal="true" className="modal-panel inventory-settings-modal" role="dialog" onMouseDown={(event) => event.stopPropagation()}>
            <header className="modal-header">
              <div><strong>Configuración de columnas</strong><span>Elige la información visible en este navegador.</span></div>
              <button className="icon-button" onClick={() => setSettingsOpen(false)} title="Cerrar" type="button"><X size={18} /></button>
            </header>
            <div className="column-settings-grid">
              {allOrderColumns.map((column) => (
                <label key={column}>
                  <input checked={visibleColumn(column)} disabled={columns.length <= 1 && visibleColumn(column)} onChange={() => toggleColumn(column)} type="checkbox" />
                  <span>{orderColumnLabels[column]}</span>
                </label>
              ))}
            </div>
            <footer className="modal-footer">
              <button className="ghost-button" onClick={() => setColumns(defaultOrderColumns)} type="button">Restablecer columnas</button>
              <button className="primary-button" onClick={() => setSettingsOpen(false)} type="button">Cerrar</button>
            </footer>
          </section>
        </div>
      ) : null}
      {detailOrder ? <PosOrderDetailModal canEditOperationalDate={canEditOperationalDate} onEditDate={() => { setDateOrder(detailOrder); setDetailOrder(null); }} order={detailOrder} onClose={() => setDetailOrder(null)} /> : null}
      {dateOrder ? <OperationalDateModal order={dateOrder} onClose={() => setDateOrder(null)} /> : null}
      {paymentOrder ? <PaymentMethodModal order={paymentOrder} onClose={() => setPaymentOrder(null)} /> : null}
      {deletionOrder ? <DeletePosOrderTestModal key={`${deletionOrder.id}:${deletionPreview ? "loaded" : "loading"}`} error={deletionPreviewError} loading={deletionPreviewLoading} order={deletionOrder} preview={deletionPreview} onClose={closeDeletion} /> : null}
    </section>
  );
}

function OrderSummary({ order }: { order: PosOrderListRow }) {
  const visibleItems = order.items.slice(0, 2);
  const hiddenCount = Math.max(0, order.items.length - visibleItems.length);
  return (
    <div className="order-row-summary">
      {visibleItems.map((item) => <span key={item.id}>{item.quantity}× {item.product_name_snapshot}</span>)}
      {hiddenCount > 0 ? <small>+{hiddenCount} productos más</small> : null}
    </div>
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

function DeletePosOrderTestModal({
  error,
  loading,
  onClose,
  order,
  preview
}: {
  error: string;
  loading: boolean;
  onClose: () => void;
  order: PosOrderListRow;
  preview: PosOrderTestDeletionPreview | null;
}) {
  const [state, action] = useActionState(deletePosOrderForTesting, initialState);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => preview?.consumptions.map((allocation) => allocation.allocation_id) ?? []);
  const [reason, setReason] = useState("system_test");
  const [reasonDetail, setReasonDetail] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [localError, setLocalError] = useState("");
  const router = useRouter();
  const allocations = useMemo(() => preview?.consumptions ?? [], [preview]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const retainedCount = allocations.length - selectedIds.length;
  const groupedAllocations = useMemo(() => {
    const groups = new Map<string, typeof allocations>();
    for (const allocation of allocations) {
      const key = `${allocation.combo_name ?? ""}::${allocation.order_item_id ?? allocation.item_name}`;
      const group = groups.get(key) ?? [];
      group.push(allocation);
      groups.set(key, group);
    }
    return [...groups.values()];
  }, [allocations]);

  useEffect(() => {
    if (state.status !== "success") return;
    const timeout = window.setTimeout(() => {
      onClose();
      router.refresh();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [onClose, router, state.status]);

  const setSelection = (allocationId: string, selected: boolean) => {
    setConfirming(false);
    setLocalError("");
    setSelectedIds((current) => selected ? [...new Set([...current, allocationId])] : current.filter((id) => id !== allocationId));
  };

  const selectAll = () => {
    setSelectedIds(allocations.map((allocation) => allocation.allocation_id));
    setConfirming(false);
    setLocalError("");
  };
  const clearSelection = () => {
    setSelectedIds([]);
    setConfirming(false);
    setLocalError("");
  };
  const openFinalConfirmation = () => {
    if (retainedCount > 0 && (!reason || (reason === "other" && !reasonDetail.trim()))) {
      setLocalError(reason === "other" ? "Describe el otro motivo de la salida de inventario." : "Selecciona el motivo de los consumos que permanecerán como salida.");
      return;
    }
    setLocalError("");
    setConfirming(true);
  };

  const selectedSummary = selectedIds.length === allocations.length
    ? "Se reintegrará todo el inventario a sus fuentes originales."
    : selectedIds.length === 0
      ? "Los consumos permanecerán descontados como salida de inventario."
      : "Reintegro parcial: solo volverán los consumos seleccionados.";

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form action={action} aria-label={`Eliminar pedido ${order.code} en modo pruebas`} aria-modal="true" className="modal-panel order-test-delete-modal" role="dialog" onMouseDown={(event) => event.stopPropagation()}>
        <input name="order_id" type="hidden" value={order.id} />
        <input name="reintegrated_allocation_ids" type="hidden" value={JSON.stringify(selectedIds)} />
        <input name="loss_reason" type="hidden" value={retainedCount > 0 ? reason : ""} />
        <input name="loss_reason_detail" type="hidden" value={retainedCount > 0 ? reasonDetail : ""} />
        <header className="modal-header">
          <div>
            <strong>Eliminar pedido {order.code}</strong>
            <span>Función disponible únicamente durante pruebas del sistema.</span>
          </div>
          <button className="icon-button" onClick={onClose} title="Cerrar" type="button"><X size={18} /></button>
        </header>
        <div className="order-test-delete-body">
          <section className="order-test-delete-meta" aria-label="Resumen del pedido">
            <div><span>Fecha/hora</span><strong>{formatDateTime(order.ordered_at)}</strong></div>
            <div><span>Usuario</span><strong>{order.created_by_name}</strong></div>
            <div><span>Tipo</span><strong>{kindLabel(order.kind)}</strong></div>
            <div><span>Total</span><strong>{formatCop(order.total_cop)}</strong></div>
            <div><span>Método de pago</span><strong>{paymentLabel(order.payment_method)}</strong></div>
            <div><span>Estado</span><strong>{statusLabel(order.status)}</strong></div>
          </section>

          <section className="order-test-delete-section" aria-label="Productos del pedido">
            <h3>Pedido</h3>
            <div className="order-test-delete-products">{order.items.map((item) => <span key={item.id}>{item.quantity}× {item.product_name_snapshot}</span>)}</div>
          </section>

          <section className="order-test-delete-section" aria-label="Consumos de inventario">
            <div className="order-test-delete-section-heading">
              <div>
                <h3>Consumos reales de inventario</h3>
                <p>Se muestran las asignaciones que el pedido ya consumió, sin recalcular recetas.</p>
              </div>
              {preview ? <CheckSquare aria-hidden="true" size={19} /> : null}
            </div>
            {loading ? <p className="form-status">Cargando consumos reales…</p> : null}
            {error ? <p className="form-status error">{error}</p> : null}
            {preview && allocations.length === 0 ? <p className="empty-state">Este pedido no tiene asignaciones de inventario registradas.</p> : null}
            {preview && allocations.length > 0 ? (
              <>
                <div className="inline-actions">
                  <button className="ghost-button" onClick={selectAll} type="button">Seleccionar todo</button>
                  <button className="ghost-button" onClick={clearSelection} type="button">Quitar selección</button>
                </div>
                <p className="order-test-delete-selection-summary">{selectedSummary}</p>
                <div className="order-test-delete-consumption-list">
                  {groupedAllocations.map((group) => (
                    <section className="order-test-delete-consumption-group" key={group[0].allocation_id}>
                      {group[0].combo_name ? <small className="order-test-delete-combo">{group[0].combo_name}</small> : null}
                      <h4>{group[0].item_name}</h4>
                      {group.map((allocation) => (
                        <label className={`order-test-delete-consumption ${selectedSet.has(allocation.allocation_id) ? "selected" : ""}`} key={allocation.allocation_id}>
                          <input checked={selectedSet.has(allocation.allocation_id)} onChange={(event) => setSelection(allocation.allocation_id, event.target.checked)} type="checkbox" />
                          <span className="order-test-delete-consumption-main"><strong>{allocation.source_name}</strong><small>{formatStockQuantity(allocation.quantity_base, allocation.base_unit)} · {allocation.origin_label}</small></span>
                          <span className="order-test-delete-consumption-state">{selectedSet.has(allocation.allocation_id) ? "Reintegrar" : "Conservar salida"}</span>
                        </label>
                      ))}
                    </section>
                  ))}
                </div>
              </>
            ) : null}
          </section>

          {preview && retainedCount > 0 ? (
            <section className="order-test-delete-section order-test-delete-reason" aria-label="Motivo de la salida">
              <h3>Motivo de los consumos no reintegrados</h3>
              <div className="form-grid">
                <div className="field">
                  <label>Motivo</label>
                  <select onChange={(event) => { setReason(event.target.value); setConfirming(false); }} value={reason}>
                    <option value="loss_total">Pérdida total</option>
                    <option value="prepared_product">Producto preparado</option>
                    <option value="damaged_product">Producto dañado</option>
                    <option value="system_test">Prueba de sistema</option>
                    <option value="other">Otro</option>
                  </select>
                </div>
                {reason === "other" ? <div className="field"><label>Descripción</label><input onChange={(event) => { setReasonDetail(event.target.value); setConfirming(false); }} value={reasonDetail} /></div> : null}
              </div>
            </section>
          ) : null}

          {confirming ? <section className="order-test-delete-confirmation"><strong>Esta acción eliminará {order.code} del sistema de pruebas.</strong><span>Se reintegrarán {selectedIds.length} consumo(s) y {retainedCount} permanecerán como salida.</span></section> : null}
          {localError ? <p className="form-status error">{localError}</p> : null}
          {state.status !== "idle" ? <p className={`form-status ${state.status}`}>{state.message}</p> : null}
        </div>
        <footer className="modal-footer">
          {confirming ? <button className="secondary-button" onClick={() => setConfirming(false)} type="button">Volver</button> : <button className="secondary-button" onClick={onClose} type="button">Cancelar</button>}
          {confirming ? <DeleteTestOrderSubmitButton disabled={loading || Boolean(error)} /> : <button className="primary-button danger-button" disabled={loading || Boolean(error) || !preview} onClick={openFinalConfirmation} type="button">Eliminar pedido</button>}
        </footer>
      </form>
    </div>
  );
}

function DeleteTestOrderSubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return <button className="primary-button danger-button" disabled={disabled || pending} type="submit">{pending ? "Eliminando..." : "Eliminar definitivamente"}</button>;
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

function OperationalDateModal({ order, onClose }: { order: PosOrderListRow; onClose: () => void }) {
  const [state, action] = useActionState(updatePosOrderOperationalDate, initialState);
  const router = useRouter();
  const current = operationalDateParts(order.ordered_at);

  useEffect(() => {
    if (state.status !== "success") return;
    const timeout = window.setTimeout(() => {
      onClose();
      router.refresh();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [onClose, router, state.status]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form action={action} aria-label={`Editar fecha del pedido ${order.code}`} aria-modal="true" className="modal-panel compact-modal operational-date-modal" role="dialog" onMouseDown={(event) => event.stopPropagation()}>
        <input name="order_id" type="hidden" value={order.id} />
        <header className="modal-header">
          <div>
            <strong>Editar fecha del pedido {order.code}</strong>
            <span>Corrige la fecha operativa sin alterar el registro original.</span>
          </div>
          <button className="icon-button" onClick={onClose} title="Cerrar" type="button"><X size={18} /></button>
        </header>
        <div className="compact-card operational-date-body">
          <div className="form-grid">
            <div className="field"><label>Fecha</label><input defaultValue={current.date} name="ordered_date" required type="date" /></div>
            <div className="field"><label>Hora</label><input defaultValue={current.time} name="ordered_time" required type="time" /></div>
          </div>
          <div className="operational-date-info">
            <span>Fecha operativa actual <strong>{formatDateTime(order.ordered_at)}</strong></span>
            <span>Registro original <strong>{formatDateTime(order.created_at)}</strong></span>
          </div>
          {state.status !== "idle" ? <p className={`form-status ${state.status}`}>{state.message}</p> : null}
        </div>
        <footer className="modal-footer">
          <button className="secondary-button" onClick={onClose} type="button">Cancelar</button>
          <UpdateOperationalDateButton />
        </footer>
      </form>
    </div>
  );
}

function UpdateOperationalDateButton() {
  const { pending } = useFormStatus();
  return <button className="primary-button" disabled={pending} type="submit">{pending ? "Actualizando..." : "Actualizar fecha"}</button>;
}

function PaymentMethodModal({ order, onClose }: { order: PosOrderListRow; onClose: () => void }) {
  const [state, action] = useActionState(updatePosOrderPaymentMethod, initialState);
  const [method, setMethod] = useState(order.payment_method === "card" ? "transfer" : order.payment_method);
  const [cashReceived, setCashReceived] = useState(String(Math.round(order.total_cop)));
  const [mixedCash, setMixedCash] = useState("");
  const [mixedTransfer, setMixedTransfer] = useState("");
  const [mixedCashReceived, setMixedCashReceived] = useState("");
  const router = useRouter();
  const mixedSum = Number(mixedCash || 0) + Number(mixedTransfer || 0);

  useEffect(() => {
    if (state.status !== "success") return;
    const timeout = window.setTimeout(() => {
      onClose();
      router.refresh();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [onClose, router, state.status]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form action={action} aria-label={`Editar metodo de pago del pedido ${order.code}`} aria-modal="true" className="modal-panel compact-modal operational-date-modal" role="dialog" onMouseDown={(event) => event.stopPropagation()}>
        <input name="order_id" type="hidden" value={order.id} />
        <input name="total_cop" type="hidden" value={Math.round(order.total_cop)} />
        <header className="modal-header">
          <div>
            <strong>Editar pago del pedido {order.code}</strong>
            <span>Solo corrige el método de pago; no altera inventario ni total.</span>
          </div>
          <button className="icon-button" onClick={onClose} title="Cerrar" type="button"><X size={18} /></button>
        </header>
        <div className="compact-card operational-date-body">
          <div className="summary-grid">
            <span>Total <strong>{formatCop(order.total_cop)}</strong></span>
            <span>Pago actual <strong>{paymentLabel(order.payment_method)}</strong></span>
          </div>
          <div className="field">
            <label>Método de pago</label>
            <select name="payment_method" onChange={(event) => setMethod(event.target.value)} value={method}>
              <option value="cash">Efectivo</option>
              <option value="transfer">Transferencia</option>
              <option value="mixed">Mixto</option>
              <option value="pending">Pendiente</option>
            </select>
          </div>
          {method === "cash" ? (
            <div className="form-grid">
              <div className="field"><label>Efectivo recibido</label><input inputMode="numeric" name="cash_received_cop" onChange={(event) => setCashReceived(event.target.value.replace(/\D/g, ""))} value={cashReceived} /></div>
              <div className="field"><label>Cambio</label><input readOnly value={formatCop(Math.max(0, Number(cashReceived || 0) - order.total_cop))} /></div>
            </div>
          ) : null}
          {method === "mixed" ? (
            <div className="form-grid">
              <div className="field"><label>Efectivo</label><input inputMode="numeric" name="mixed_cash_cop" onChange={(event) => setMixedCash(event.target.value.replace(/\D/g, ""))} value={mixedCash} /></div>
              <div className="field"><label>Transferencia</label><input inputMode="numeric" name="mixed_transfer_cop" onChange={(event) => setMixedTransfer(event.target.value.replace(/\D/g, ""))} value={mixedTransfer} /></div>
              <div className="field"><label>Efectivo recibido</label><input inputMode="numeric" name="mixed_cash_received_cop" onChange={(event) => setMixedCashReceived(event.target.value.replace(/\D/g, ""))} value={mixedCashReceived} /></div>
              <div className="field"><label>Validación</label><input readOnly value={`${formatCop(mixedSum)} / ${formatCop(order.total_cop)}`} /></div>
            </div>
          ) : null}
          <div className="field"><label>Motivo</label><textarea name="reason" placeholder="Corrección de método de pago" /></div>
          {order.status === "cancelled" ? <p className="form-status error">Los pedidos cancelados no se pueden modificar.</p> : null}
          {state.status !== "idle" ? <p className={`form-status ${state.status}`}>{state.message}</p> : null}
        </div>
        <footer className="modal-footer">
          <button className="secondary-button" onClick={onClose} type="button">Cancelar</button>
          <UpdatePaymentMethodButton disabled={order.status === "cancelled"} />
        </footer>
      </form>
    </div>
  );
}

function UpdatePaymentMethodButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return <button className="primary-button" disabled={pending || disabled} type="submit">{pending ? "Actualizando..." : "Actualizar pago"}</button>;
}

function PosOrderDetailModal({ canEditOperationalDate, onEditDate, order, onClose }: { canEditOperationalDate: boolean; onEditDate: () => void; order: PosOrderListRow; onClose: () => void }) {
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
            <span>{formatDateTime(order.ordered_at)} · {kindLabel(order.kind)}</span>
          </div>
          <button className="icon-button" onClick={onClose} title="Cerrar" type="button"><X size={18} /></button>
        </header>
        <div className="order-detail-content">
          <div className="order-detail-meta">
            <span className={`stock-pill ${order.status === "cancelled" ? "danger" : "ok"}`}>{statusLabel(order.status)}</span>
            <span><b>Cliente:</b> {order.customer_name ?? "Sin cliente"}</span>
            <span><b>Usuario:</b> {order.created_by_name}</span>
            <span><b>Pago:</b> {paymentLabel(order.payment_method)}</span>
            <span><b>Registro original:</b> {formatDateTime(order.created_at)}</span>
            {canEditOperationalDate ? <button className="ghost-button compact-order-date-action" onClick={onEditDate} type="button"><CalendarClock size={15} /> Editar fecha</button> : null}
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
                      {item.item_kind === "pizza" && item.base_used_name ? <small>Base prevista: {item.base_default_name ?? "—"}</small> : null}
                      {item.item_kind === "pizza" && item.base_used_name ? <small>Base utilizada: {item.base_used_name}{item.base_replaced_by_name ? ` · Sustitución: ${item.base_replaced_by_name}` : ""}</small> : null}
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
            {order.discount_cop > 0 ? <div><span>Subtotal</span><strong>{formatCop(order.subtotal_cop)}</strong></div> : null}
            {order.discount_cop > 0 ? <div><span>{order.discount_type === "percentage" ? `Descuento (${order.discount_value}%)` : "Descuento"}</span><strong>-{formatCop(order.discount_cop)}</strong></div> : null}
            <div><span>{order.discount_cop > 0 ? "Total" : "Total pedido"}</span><strong>{formatCop(order.total_cop)}</strong></div>
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
