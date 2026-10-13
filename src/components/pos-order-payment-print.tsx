"use client";

import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { getKitchenTicket, getPosOrderReceipt, getPrintTemplates, type PosOrderReceipt } from "@/app/admin/actions";
import { KitchenTicketDocument } from "@/components/kitchen-ticket-print";
import { PrintTemplateBlankLines, PrintTemplateCustomElement, PrintTemplateElementFrame, PrintTemplatePart } from "@/components/print-template-elements";
import { formatCop } from "@/lib/format";
import { defaultPrintTemplate, type PrintTemplate, type PrintTemplateElement } from "@/lib/print-templates";
import { Download, LoaderCircle, Printer, X } from "lucide-react";
import { downloadThermalPdf, shareOrOpenThermalPdf } from "@/lib/thermal-pdf";
import { canUseBrowserPrint, printThermalDocuments } from "@/lib/thermal-print";
import { getBleErrorMessage, printBleThermalDocuments, shouldUseBlePrinter } from "@/lib/ble-thermal-printer";

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
  const labels: Record<string, string> = { cash: "Efectivo", card: "Tarjeta", transfer: "Transferencia", mixed: "Mixto", pending: "Pendiente", rappi: "Rappi", didi: "DiDi" };
  return labels[method] ?? method;
}

export function CustomerReceiptDocument({ receipt, printRef, template = defaultPrintTemplate("receipt") }: { receipt: PosOrderReceipt; printRef?: Ref<HTMLElement>; template?: PrintTemplate }) {
  const cashPayment = receipt.payments.find((payment) => payment.method === "cash");
  const hasBreakdown = receipt.order.combo_price_adjustment_cop !== 0 || receipt.order.discount_cop > 0 || receipt.order.delivery_cop > 0;
  const fields: Record<string, (element: PrintTemplateElement) => ReactNode> = {
    receipt_header: (element) => <header className="customer-receipt-header"><PrintTemplatePart as="strong" element={element} part="title">MODO PIZZAS</PrintTemplatePart><PrintTemplatePart as="b" element={element} part="value">TICKET DE COMPRA</PrintTemplatePart></header>,
    receipt_order: (element) => <div className="customer-receipt-order"><PrintTemplatePart element={element} part="value">{receipt.order.code} · {formatDate(receipt.order.ordered_at)}</PrintTemplatePart></div>,
    receipt_items: (element) => <ul className="customer-receipt-items">
      {receipt.items.map((item) => (
        <li key={item.id}>
          <div><PrintTemplatePart as="strong" element={element} part="label">{item.quantity} × {item.name}</PrintTemplatePart><PrintTemplatePart element={element} part="value">{formatCop(item.unit_price_cop)} c/u</PrintTemplatePart></div>
          <PrintTemplatePart as="b" element={element} part="value">{formatCop(item.line_subtotal_cop)}</PrintTemplatePart>
          {item.additions.map((addition, index) => <PrintTemplatePart as="small" element={element} key={`${addition.name}-${index}`} part="value">+ {addition.quantity} × {addition.name} {formatCop(addition.line_subtotal_cop)}</PrintTemplatePart>)}
        </li>
      ))}
    </ul>,
    receipt_totals: (element) => <section className="customer-receipt-totals">
      {hasBreakdown ? <p><PrintTemplatePart element={element} part="label">Subtotal</PrintTemplatePart><PrintTemplatePart as="strong" element={element} part="value">{formatCop(receipt.order.subtotal_cop)}</PrintTemplatePart></p> : null}
      {receipt.order.combo_price_adjustment_cop !== 0 ? <p><PrintTemplatePart element={element} part="label">Ajuste combo</PrintTemplatePart><PrintTemplatePart as="strong" element={element} part="value">{receipt.order.combo_price_adjustment_cop > 0 ? "+" : "-"}{formatCop(Math.abs(receipt.order.combo_price_adjustment_cop))}</PrintTemplatePart></p> : null}
      {receipt.order.discount_cop > 0 ? <p><PrintTemplatePart element={element} part="label">Descuento</PrintTemplatePart><PrintTemplatePart as="strong" element={element} part="value">-{formatCop(receipt.order.discount_cop)}</PrintTemplatePart></p> : null}
      {receipt.order.delivery_cop > 0 ? <p><PrintTemplatePart element={element} part="label">Domicilio</PrintTemplatePart><PrintTemplatePart as="strong" element={element} part="value">+{formatCop(receipt.order.delivery_cop)}</PrintTemplatePart></p> : null}
      <p className="customer-receipt-total"><PrintTemplatePart element={element} part="label">TOTAL</PrintTemplatePart><PrintTemplatePart as="strong" element={element} part="value">{formatCop(receipt.order.total_cop)}</PrintTemplatePart></p>
    </section>,
    receipt_payment: (element) => <section className="customer-receipt-payment">
      <p><PrintTemplatePart element={element} part="label">PAGO</PrintTemplatePart><PrintTemplatePart as="strong" element={element} part="value">{paymentLabel(receipt.order.payment_method)}</PrintTemplatePart></p>
      {receipt.payments.length > 1 ? receipt.payments.map((payment, index) => <p key={`${payment.method}-${index}`}><PrintTemplatePart element={element} part="label">{paymentLabel(payment.method)}</PrintTemplatePart><PrintTemplatePart as="strong" element={element} part="value">{formatCop(payment.amount_cop)}</PrintTemplatePart></p>) : null}
      {cashPayment?.cash_received_cop !== null && cashPayment?.cash_received_cop !== undefined ? <p><PrintTemplatePart element={element} part="label">Recibido</PrintTemplatePart><PrintTemplatePart as="strong" element={element} part="value">{formatCop(cashPayment.cash_received_cop)}</PrintTemplatePart></p> : null}
      {cashPayment?.cash_change_cop !== null && cashPayment?.cash_change_cop !== undefined ? <p><PrintTemplatePart element={element} part="label">Cambio</PrintTemplatePart><PrintTemplatePart as="strong" element={element} part="value">{formatCop(cashPayment.cash_change_cop)}</PrintTemplatePart></p> : null}
    </section>,
    receipt_footer: (element) => <footer className="customer-receipt-footer"><PrintTemplatePart element={element} part="value">Gracias por tu compra</PrintTemplatePart></footer>
  };

  return (
    <article className="customer-receipt thermal receipt-58" data-thermal-leading-blank-lines={template.leading_blank_lines} data-thermal-line-spacing={template.line_spacing} data-thermal-trailing-blank-lines={template.trailing_blank_lines} ref={printRef} style={{ lineHeight: template.line_spacing, paddingInline: `${template.margin_mm}mm` }}>
      <PrintTemplateBlankLines lines={template.leading_blank_lines} position="start" />
      {template.elements.map((element) => element.type === "field"
        ? <PrintTemplateElementFrame element={element} key={element.id}>{fields[element.field ?? ""]?.(element)}</PrintTemplateElementFrame>
        : <PrintTemplateCustomElement element={element} key={element.id} />)}
      <PrintTemplateBlankLines lines={template.trailing_blank_lines} position="end" />
    </article>
  );
}

function CustomerReceiptPreview({ onClose, receipt, template }: { onClose: () => void; receipt: PosOrderReceipt; template: PrintTemplate }) {
  const receiptRef = useRef<HTMLElement>(null);
  const [printError, setPrintError] = useState("");
  const [printMessage, setPrintMessage] = useState("");

  const handleDownload = () => {
    setPrintError("");
    setPrintMessage("");
    if (!receiptRef.current || !downloadThermalPdf(receiptRef.current, `ticket-${receipt.order.code}.pdf`)) {
      setPrintError("No se pudo generar el PDF del ticket.");
    }
  };

  const handlePrint = async () => {
    setPrintError("");
    setPrintMessage("");
    if (!receiptRef.current) {
      setPrintError("No se pudo preparar el ticket para imprimir.");
      return;
    }
    if (shouldUseBlePrinter()) {
      try {
        setPrintMessage(await printBleThermalDocuments([receiptRef.current], { connectIfNeeded: true, leadingBlankLines: template.leading_blank_lines, trailingBlankLines: template.trailing_blank_lines }));
      } catch (error) {
        setPrintError(getBleErrorMessage(error));
      }
      return;
    }
    if (canUseBrowserPrint()) {
      if (!printThermalDocuments([receiptRef.current], `Ticket ${receipt.order.code}`)) {
        setPrintError("No se pudo abrir el documento térmico para imprimir.");
      }
      return;
    }
    const result = await shareOrOpenThermalPdf(receiptRef.current, `ticket-${receipt.order.code}.pdf`);
    if (result === "shared") setPrintMessage("PDF térmico listo para compartir o imprimir.");
    else if (result === "opened") setPrintMessage("PDF térmico abierto para imprimir desde el visor.");
    else if (result !== "cancelled") setPrintError("No se pudo preparar el PDF térmico.");
  };

  return (
    <div className="modal-backdrop kitchen-ticket-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-label={`Vista previa de ticket ${receipt.order.code}`} aria-modal="true" className="modal-panel kitchen-ticket-preview-modal" role="dialog" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-header kitchen-ticket-preview-header">
          <div><strong>Vista previa de ticket</strong><span>Formato térmico de 58 mm</span></div>
          <div className="kitchen-ticket-preview-header-actions">
            <button className="ghost-button kitchen-ticket-header-print" onClick={() => void handlePrint()} type="button"><Printer size={17} /> Imprimir</button>
            <button className="icon-button kitchen-ticket-print-action" onClick={handleDownload} title="Descargar PDF de ticket" type="button"><Download size={18} /></button>
            <button className="icon-button kitchen-ticket-print-action" onClick={onClose} title="Cerrar vista previa" type="button"><X size={18} /></button>
          </div>
        </header>
        <div className="kitchen-ticket-print-root kitchen-ticket-print-root-58"><CustomerReceiptDocument printRef={receiptRef} receipt={receipt} template={template} /></div>
        {printMessage ? <p className="form-status">{printMessage}</p> : null}
        {printError ? <p className="form-status error">{printError}</p> : null}
        <footer className="modal-footer kitchen-ticket-preview-footer">
          <button className="ghost-button" onClick={onClose} type="button">Cerrar</button>
          <div className="kitchen-ticket-preview-actions"><button className="ghost-button" onClick={handleDownload} type="button"><Download size={16} /> Descargar PDF</button><button className="primary-button" onClick={() => void handlePrint()} type="button"><Printer size={17} /> Imprimir ticket</button></div>
        </footer>
      </section>
    </div>
  );
}

export function CustomerReceiptPrintButton({ orderCode, orderId }: { orderCode: string; orderId: string }) {
  const [receipt, setReceipt] = useState<PosOrderReceipt | null>(null);
  const [template, setTemplate] = useState<PrintTemplate | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const openPreview = async () => {
    setError("");
    setLoading(true);
    const [result, templatesResult] = await Promise.all([getPosOrderReceipt(orderId), getPrintTemplates()]);
    setLoading(false);
    if (result.status === "error" || !result.receipt) {
      setError(result.message);
      return;
    }
    setReceipt(result.receipt);
    setTemplate(templatesResult.status === "success" && templatesResult.templates ? templatesResult.templates.receipt : defaultPrintTemplate("receipt"));
  };

  return (
    <>
      <button aria-label={`Ver e imprimir ticket de ${orderCode}`} className="ghost-button kitchen-ticket-trigger" disabled={loading} onClick={() => void openPreview()} type="button">
        {loading ? <LoaderCircle className="spin" size={16} /> : <Printer size={16} />}
        {loading ? "Cargando..." : "Ticket"}
      </button>
      {error ? <span className="row-action-message error">{error}</span> : null}
      {receipt && template ? <CustomerReceiptPreview onClose={() => { setReceipt(null); setTemplate(null); }} receipt={receipt} template={template} /> : null}
    </>
  );
}

export function CustomerReceiptPdfButton(props: { orderCode: string; orderId: string }) {
  return <CustomerReceiptPrintButton {...props} />;
}
export function PostPaymentPrintJob({ job, onError }: { job: PaymentPrintJob; onError: (message: string) => void }) {
  const [documents, setDocuments] = useState<Array<{ kind: "kitchen" | "receipt"; node: ReactNode }>>([]);
  const printRootRef = useRef<HTMLDivElement>(null);
  const printedJobIdRef = useRef("");

  useEffect(() => {
    let active = true;
    const loadDocuments = async () => {
      const [ticketResult, receiptResult, templatesResult] = await Promise.all([
        job.kitchen ? getKitchenTicket(job.orderId) : Promise.resolve(null),
        job.receipt ? getPosOrderReceipt(job.orderId) : Promise.resolve(null),
        getPrintTemplates()
      ]);
      if (!active) return;

      const nextDocuments: Array<{ kind: "kitchen" | "receipt"; node: ReactNode }> = [];
      const errors: string[] = [];
      const kitchenTemplate = templatesResult.status === "success" && templatesResult.templates ? templatesResult.templates.kitchen : defaultPrintTemplate("kitchen");
      const receiptTemplate = templatesResult.status === "success" && templatesResult.templates ? templatesResult.templates.receipt : defaultPrintTemplate("receipt");
      if (ticketResult) {
        if (ticketResult.status === "success" && ticketResult.ticket) nextDocuments.push({ kind: "kitchen", node: <KitchenTicketDocument compact template={kitchenTemplate} ticket={ticketResult.ticket} /> });
        else errors.push(ticketResult.message);
      }
      if (receiptResult) {
        if (receiptResult.status === "success" && receiptResult.receipt) nextDocuments.push({ kind: "receipt", node: <CustomerReceiptDocument receipt={receiptResult.receipt} template={receiptTemplate} /> });
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
    const printDocuments = async () => {
      if (shouldUseBlePrinter()) {
        try {
          for (const printable of printables) await printBleThermalDocuments([printable]);
          return;
        } catch (error) {
          onError(`No se pudo enviar por Bluetooth; se abrirá la impresión original. ${getBleErrorMessage(error)}`);
        }
      }
      if (!printThermalDocuments(printables, "Documentos del pedido")) {
        onError("No se pudo abrir el documento térmico para imprimir.");
      }
    };
    void printDocuments();
  }, [documents, job.id, onError]);

  if (documents.length === 0) return null;
  return (
    <div className="post-payment-print-root" aria-hidden="true" ref={printRootRef}>
      {documents.map((document) => <div className="post-payment-print-document" key={document.kind}>{document.node}</div>)}
    </div>
  );
}
