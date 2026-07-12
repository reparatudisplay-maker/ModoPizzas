import Link from "next/link";
import { PrintButton } from "@/components/print-button";
import { getPrintableOrder, orderKindText, parseOrderItemSnapshot } from "@/lib/order-print";

type PrintPageProps = {
  params: Promise<{ id: string }>;
};

export default async function KitchenLabelPage({ params }: PrintPageProps) {
  const { id } = await params;
  const { order, settings } = await getPrintableOrder(id);

  return (
    <main className="print-page label-page">
      <div className="print-actions">
        <Link className="ghost-button" href="/panel">
          Volver
        </Link>
        <PrintButton />
      </div>

      <section className="thermal label-80x130">
        <header className="print-header">
          <h1>{settings.business_name}</h1>
          <p>Comanda / etiqueta</p>
          <strong>Pedido #{order.order_number}</strong>
        </header>

        <dl className="print-meta">
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

        <div className="print-customer label-customer">
          <strong>Cliente</strong>
          <span>{order.customer_name || "Sin nombre"}</span>
          {order.customer_phone ? <span>Tel: {order.customer_phone}</span> : null}
          {order.kind === "delivery" ? (
            <>
              <span>{order.delivery_address}</span>
              {order.delivery_neighborhood ? <span>Barrio: {order.delivery_neighborhood}</span> : null}
              {order.delivery_notes ? <span>Notas envio: {order.delivery_notes}</span> : null}
            </>
          ) : null}
        </div>

        <ol className="label-items">
          {order.order_items.map((item) => {
            const snapshot = parseOrderItemSnapshot(item.notes);
            return (
              <li key={item.id}>
                <strong>
                  {item.quantity} x Pizza {snapshot.sizeId ?? ""}
                </strong>
                <span>
                  Sabor: {snapshot.flavorAId}
                  {snapshot.flavorBId ? ` / ${snapshot.flavorBId}` : ""}
                </span>
                <span>Borde: {snapshot.crustId ?? "normal"}</span>
                {snapshot.extraIds?.length ? <span>Extras: {snapshot.extraIds.join(", ")}</span> : null}
                {snapshot.notes ? <span>Nota cocina: {snapshot.notes}</span> : null}
              </li>
            );
          })}
        </ol>

        <footer className="print-footer">
          <p>Etiqueta 80 x 130 mm</p>
        </footer>
      </section>
    </main>
  );
}
