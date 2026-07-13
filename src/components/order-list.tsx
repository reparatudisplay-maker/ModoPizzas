import Link from "next/link";
import { updateOrderStatus } from "@/app/orders/actions";
import { formatCop } from "@/lib/format";
import {
  nextStatuses,
  orderKindLabel,
  parseSnapshot,
  type PanelOrder,
  statusLabel
} from "@/lib/panel-orders";

type OrderListProps = {
  orders: PanelOrder[];
  compact?: boolean;
};

export function OrderList({ orders, compact = false }: OrderListProps) {
  if (orders.length === 0) {
    return (
      <section className="empty-state">
        <strong>No hay pedidos para este modulo.</strong>
        <span>Cuando lleguen pedidos nuevos apareceran aqui.</span>
      </section>
    );
  }

  return (
    <section className={compact ? "order-board compact" : "order-board"} aria-label="Pedidos">
      {orders.map((order) => (
        <article className="order-ticket" key={order.id}>
          <header>
            <div>
              <h2>#{order.order_number}</h2>
              <span>{orderKindLabel(order.kind)}</span>
            </div>
            <span className={`badge status-badge status-${order.status}`}>{statusLabel(order.status)}</span>
          </header>
          <div className="order-details">
            <span>{new Date(order.created_at).toLocaleString("es-CO")}</span>
            <span>{order.customer_name || "Cliente sin nombre"}</span>
            {order.customer_phone ? <span>{order.customer_phone}</span> : null}
            {order.kind === "delivery" ? (
              <span>
                {order.delivery_address} {order.delivery_neighborhood ? `- ${order.delivery_neighborhood}` : ""}
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
            <strong>{formatCop(order.total_cop)}</strong>
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
  );
}
