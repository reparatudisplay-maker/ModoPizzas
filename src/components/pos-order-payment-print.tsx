"use client";

import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { getKitchenTicket, getPosOrderReceipt, type PosOrderReceipt } from "@/app/admin/actions";
import { KitchenTicketDocument } from "@/components/kitchen-ticket-print";
import { formatCop } from "@/lib/format";
import { Download, LoaderCircle } from "lucide-react";
import { downloadThermalPdf } from "@/lib/thermal-pdf";
import { printThermalDocuments } from "@/lib/thermal-print";

export type PaymentPrintSelection = {
  kitchen: boolean;
  receipt: boolean;
};

export type PaymentPrintJob = PaymentPrintSelection & {
  id: string;
  orderId: string;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function paymentLabel(method: string) {
  const labels: Record<string, string> = { cash: "Efectivo", card: "Tarjeta", transfer: "Transferencia", mixed: "Mixto", pending: "Pendiente" };
  return labels[method] ?? method;
}

function CustomerReceiptDocument({ receipt, printRef }: { receipt: PosOrderReceipt; printRef?: Ref<HTMLElement> }) {
  const cashPayment = receipt.payments.find((payment) => payment.method === "cash");
  const hasBreakdown = receipt.order.combo_price_adjustment_cop !== 0 || receipt.order.discount_cop > 0 || receipt.order.delivery_cop > 0;

  return (
    <article className="customer-receipt thermal receipt-58" ref={printRef}>
      <header className="customer-receipt-header">
        <strong>MODO PIZZAS</strong>
        <b>TICKET DE COMPRA</b>
        <span>{receipt.order.code} · {formatDate(receipt.order.ordered_at)}</span>
      </header>

      <ul className="customer-receipt-items">
        {receipt.items.map((item) => (
          <li key={item.id}>
            <div><strong>{item.quantity} × {item.name}</strong><span>{formatCop(item.unit_price_cop)} c/u</span></div>
            <b>{formatCop(item.line_subtotal_cop)}</b>
            {item.additions.map((addition, index) => <small key={`${addition.name}-${index}`}>+ {addition.quantity} × {addition.name} <strong>{formatCop(addition.line_subtotal_cop)}</strong></small>)}
          </li>
        ))}
      </ul>

      <section className="customer-receipt-totals">
        {hasBreakdown ? <p><span>Subtotal</span><strong>{formatCop(receipt.order.subtotal_cop)}</strong></p> : null}
        {receipt.order.combo_price_adjustment_cop !== 0 ? <p><span>Ajuste combo</span><strong>{receipt.order.combo_price_adjustment_cop > 0 ? "+" : "-"}{formatCop(Math.abs(receipt.order.combo_price_adjustment_cop))}</strong></p> : null}
        {receipt.order.discount_cop > 0 ? <p><span>Descuento</span><strong>-{formatCop(receipt.order.discount_cop)}</strong></p> : null}
        {receipt.order.delivery_cop > 0 ? <p><span>Domicilio</span><strong>+{formatCop(receipt.order.delivery_cop)}</strong></p> : null}
        <p className="customer-receipt-total"><span>TOTAL</span><strong>{formatCop(receipt.order.total_cop)}</strong></p>
      </section>

      <section className="customer-receipt-payment">
        <p><span>PAGO</span><strong>{paymentLabel(receipt.order.payment_method)}</strong></p>
        {receipt.payments.length > 1 ? receipt.payments.map((payment, index) => <p key={`${payment.method}-${index}`}><span>{paymentLabel(payment.method)}</span><strong>{formatCop(payment.amount_cop)}</strong></p>) : null}
        {cashPayment?.cash_received_cop !== null && cashPayment?.cash_received_cop !== undefined ? <p><span>Recibido</span><strong>{formatCop(cashPayment.cash_received_cop)}</strong></p> : null}
        {cashPayment?.cash_change_cop !== null && cashPayment?.cash_change_cop !== undefined ? <p><span>Cambio</span><strong>{formatCop(cashPayment.cash_change_cop)}</strong></p> : null}
      </section>

      <footer className="customer-receipt-footer">Gracias por tu compra</footer>
    </article>
  );
}

export function CustomerReceiptPdfButton({ orderCode, orderId }: { orderCode: string; orderId: string }) {
  const [receipt, setReceipt] = useState<PosOrderReceipt | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const receiptRef = useRef<HTMLElement>(null);
  const downloadedOrderIdRef = useRef("");

  useEffect(() => {
    if (!receipt || !receiptRef.current || downloadedOrderIdRef.current === orderId) return;
    downloadedOrderIdRef.current = orderId;
    if (!downloadThermalPdf(receiptRef.current, `ticket-${orderCode}.pdf`)) {
      setError("No se pudo generar el PDF del ticket.");
    }
  }, [orderCode, orderId, receipt]);

  const downloadReceipt = async () => {
    setError("");
    setLoading(true);
    const result = await getPosOrderReceipt(orderId);
    setLoading(false);
    if (result.status === "error" || !result.receipt) {
      setError(result.message);
      return;
    }
    downloadedOrderIdRef.current = "";
    setReceipt(result.receipt);
  };

  return (
    <>
      <button aria-label={`Descargar ticket PDF de ${orderCode}`} className="ghost-button kitchen-ticket-trigger" disabled={loading} onClick={() => void downloadReceipt()} type="button">
        {loading ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}
        {loading ? "Generando..." : "Ticket PDF"}
      </button>
      {error ? <span className="row-action-message error">{error}</span> : null}
      {receipt ? <div className="post-payment-print-root" aria-hidden="true"><CustomerReceiptDocument printRef={receiptRef} receipt={receipt} /></div> : null}
    </>
  );
}
export function PostPaymentPrintJob({ job, onError }: { job: PaymentPrintJob; onError: (message: string) => void }) {
  const [documents, setDocuments] = useState<Array<{ kind: "kitchen" | "receipt"; node: ReactNode }>>([]);
  const printRootRef = useRef<HTMLDivElement>(null);
  const printedJobIdRef = useRef("");

  useEffect(() => {
    let active = true;
    const loadDocuments = async () => {
      const [ticketResult, receiptResult] = await Promise.all([
        job.kitchen ? getKitchenTicket(job.orderId) : Promise.resolve(null),
        job.receipt ? getPosOrderReceipt(job.orderId) : Promise.resolve(null)
      ]);
      if (!active) return;

      const nextDocuments: Array<{ kind: "kitchen" | "receipt"; node: ReactNode }> = [];
      const errors: string[] = [];
      if (ticketResult) {
        if (ticketResult.status === "success" && ticketResult.ticket) nextDocuments.push({ kind: "kitchen", node: <KitchenTicketDocument compact ticket={ticketResult.ticket} /> });
        else errors.push(ticketResult.message);
      }
      if (receiptResult) {
        if (receiptResult.status === "success" && receiptResult.receipt) nextDocuments.push({ kind: "receipt", node: <CustomerReceiptDocument receipt={receiptResult.receipt} /> });
        else errors.push(receiptResult.message);
      }
      if (nextDocuments.length === 0) {
        onError(errors.join(" ") || "No se pudo preparar la impresión.");
        return;
      }

      setDocuments(nextDocuments);
      if (errors.length > 0) onError(errors.join(" "));
    };
    void loadDocuments();
    return () => { active = false; };
  }, [job, onError]);

  useEffect(() => {
    if (documents.length === 0 || !printRootRef.current || printedJobIdRef.current === job.id) return;
    printedJobIdRef.current = job.id;
    const printables = Array.from(printRootRef.current.querySelectorAll<HTMLElement>(".post-payment-print-document > article"));
    if (!printThermalDocuments(printables, "Documentos del pedido")) {
      onError("No se pudo abrir el documento térmico para imprimir.");
    }
  }, [documents, job.id, onError]);

  if (documents.length === 0) return null;
  return (
    <div className="post-payment-print-root" aria-hidden="true" ref={printRootRef}>
      {documents.map((document) => <div className="post-payment-print-document" key={document.kind}>{document.node}</div>)}
    </div>
  );
}