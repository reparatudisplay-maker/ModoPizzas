import Link from "next/link";
import { PrintButton } from "@/components/print-button";
import { formatCop } from "@/lib/format";
import { getPrintableOrder, orderKindText, parseOrderItemSnapshot } from "@/lib/order-print";

type PrintPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ReceiptPage({ params }: PrintPageProps) {
  const { id } = await params;
  const { order, settings } = await getPrintableOrder(id);

  return (
    <main className="print-page receipt-page">
      <div className="print-actions">
        <Link className="ghost-button" href="/panel">
          Volver
        </Link>
        <PrintButton />
      </div>

      <section className="thermal receipt-58">
        <header className="print-header">
          <h1>{settings.business_name}</h1>
          <p>WhatsApp: {settings.whatsapp_number}</p>
          <p>Recibo de caja</p>
        </header>

        <dl className="print-meta">
          <div>
            <dt>Pedido</dt>
            <dd>#{order.order_number}</dd>
          </div>
          <div>
            <dt>Fecha</dt>
            <dd>{new Date(order.created_at).toLocaleString("es-CO")}</dd>
          </div>
          <div>
            <dt>Tipo</dt>
            <dd>{orderKindText(order.kind)}</dd>
          </div>
          <div>
            <dt>Estado</dt>
            <dd>{order.status}</dd>
          </div>
        </dl>

        <div className="print-customer">
          <strong>Cliente</strong>
          <span>{order.customer_name || "Consumidor final"}</span>
          {order.customer_phone ? <span>Tel: {order.customer_phone}</span> : null}
          {order.kind === "delivery" ? (
            <span>
              {order.delivery_address}
              {order.delivery_neighborhood ? ` - ${order.delivery_neighborhood}` : ""}
            </span>
          ) : null}
        </div>

        <ul className="print-items">
          {order.order_items.map((item) => {
            const snapshot = parseOrderItemSnapshot(item.notes);
            return (
              <li key={item.id}>
                <div>
                  <strong>
                    {item.quantity} x Pizza {snapshot.sizeId ?? ""}
                  </strong>
                  <span>
                    {snapshot.flavorAId}
                    {snapshot.flavorBId ? ` / ${snapshot.flavorBId}` : ""}
                  </span>
                  <span>Borde: {snapshot.crustId ?? "normal"}</span>
                  {snapshot.extraIds?.length ? <span>Extras: {snapshot.extraIds.join(", ")}</span> : null}
                  {snapshot.notes ? <span>Notas: {snapshot.notes}</span> : null}
                </div>
                <strong>{formatCop(item.line_total_cop)}</strong>
              </li>
            );
          })}
        </ul>

        <dl className="print-totals">
          <div>
            <dt>Subtotal</dt>
            <dd>{formatCop(order.subtotal_cop)}</dd>
          </div>
          {order.discount_cop > 0 ? (
            <div>
              <dt>Descuento</dt>
              <dd>-{formatCop(order.discount_cop)}</dd>
            </div>
          ) : null}
          {order.delivery_fee_cop > 0 ? (
            <div>
              <dt>Domicilio</dt>
              <dd>{formatCop(order.delivery_fee_cop)}</dd>
            </div>
          ) : null}
          <div className="grand-total">
            <dt>Total</dt>
            <dd>{formatCop(order.total_cop)}</dd>
          </div>
        </dl>

        <footer className="print-footer">
          <p>Pago: {order.payment_method}</p>
          <p>Documento POS no electronico. Preparado para integracion futura con facturacion electronica DIAN.</p>
        </footer>
      </section>
    </main>
  );
}
