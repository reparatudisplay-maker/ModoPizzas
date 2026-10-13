"use client";

import { useRef, useState, type ReactNode, type Ref } from "react";
import { Download, LoaderCircle, Printer, X } from "lucide-react";
import { getKitchenTicket, getPrintTemplates, type KitchenTicket } from "@/app/admin/actions";
import { PrintTemplateBlankLines, PrintTemplateCustomElement, PrintTemplateElementFrame, PrintTemplatePart } from "@/components/print-template-elements";
import { defaultPrintTemplate, type PrintTemplate, type PrintTemplateElement } from "@/lib/print-templates";
import { formatStockQuantity } from "@/lib/units";
import { canUseBrowserPrint, printThermalDocuments } from "@/lib/thermal-print";
import { downloadThermalPdf, shareOrOpenThermalPdf } from "@/lib/thermal-pdf";
import { getBleErrorMessage, printBleThermalDocuments, shouldUseBlePrinter } from "@/lib/ble-thermal-printer";

function formatTicketDate(value: string) {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function kindLabel(kind: string) {
  if (kind === "pickup") return "Recoger";
  if (kind === "delivery") return "Domicilio";
  return "Local";
}

function formatQuantity(quantity: number, unit: Parameters<typeof formatStockQuantity>[1]) {
  return formatStockQuantity(quantity, unit);
}

function ComponentList({ components, element }: { components: KitchenTicket["items"][number]["components"]; element: PrintTemplateElement }) {
  return (
    <ul className="kitchen-ticket-quantity-list">
      {components.map((component, index) => (
        <li key={`${component.name}-${component.unit}-${index}`}>
          <PrintTemplatePart element={element} part="label">{component.name}</PrintTemplatePart>
          <PrintTemplatePart as="strong" element={element} part="value">{formatQuantity(component.quantity, component.unit)}</PrintTemplatePart>
        </li>
      ))}
    </ul>
  );
}

export const KitchenTicketDocument = ({ compact = false, template = defaultPrintTemplate("kitchen"), ticket, printRef }: { compact?: boolean; template?: PrintTemplate; ticket: KitchenTicket; printRef?: Ref<HTMLElement> }) => {
  const pizzaItems = ticket.items.filter((item) => item.kind === "pizza");
  const deliveryItems = ticket.items.filter((item) => item.kind === "sale_product");
  const pizzaSection = (element: PrintTemplateElement) => (
    <>
      {pizzaItems.map((item, itemIndex) => {
        const ingredients = item.components.filter((component) => component.type !== "addition");
        const additions = item.components.filter((component) => component.type === "addition");
        return (
          <section className="kitchen-ticket-pizza" key={item.id || `${item.name}-${itemIndex}`}>
            <header>
              <PrintTemplatePart element={element} part="label">{item.quantity} × PIZZA</PrintTemplatePart>
              <PrintTemplatePart as="strong" element={element} part="value">{item.name}</PrintTemplatePart>
              {item.size ? <PrintTemplatePart as="small" element={element} part="value">{item.size}</PrintTemplatePart> : null}
            </header>

            {item.base ? (
              <div className="kitchen-ticket-group">
                <PrintTemplatePart as="b" element={element} part="title">{item.base.mode === "production_dough" ? "MASA DE PRODUCCIÓN" : "BASE"}</PrintTemplatePart>
                <p><PrintTemplatePart element={element} part="label">{item.base.name ?? "Base sin registro"}</PrintTemplatePart><PrintTemplatePart as="strong" element={element} part="value">{formatQuantity(item.base.quantity, item.base.unit)}</PrintTemplatePart></p>
                {item.base.production_batches.map((batch, batchIndex) => (
                  <PrintTemplatePart as="small" element={element} key={`${batch.production_number}-${batchIndex}`} part="value">Producción P{batch.production_number ?? "—"} · {formatQuantity(batch.quantity, batch.unit)}</PrintTemplatePart>
                ))}
              </div>
            ) : null}

            {ingredients.length > 0 ? <div className="kitchen-ticket-group"><PrintTemplatePart as="b" element={element} part="title">INGREDIENTES</PrintTemplatePart><ComponentList components={ingredients} element={element} /></div> : null}
            {additions.length > 0 ? <div className="kitchen-ticket-group kitchen-ticket-additions"><PrintTemplatePart as="b" element={element} part="title">ADICIONES</PrintTemplatePart><ComponentList components={additions} element={element} /></div> : null}
            {item.notes ? <div className="kitchen-ticket-notes"><PrintTemplatePart as="b" element={element} part="title">NOTAS: </PrintTemplatePart><PrintTemplatePart element={element} part="value">{item.notes}</PrintTemplatePart></div> : null}
          </section>
        );
      })}
    </>
  );
  const fields: Record<string, (element: PrintTemplateElement) => ReactNode> = {
    kitchen_header: (element) => <header className="kitchen-ticket-header"><PrintTemplatePart as="strong" element={element} part="title">COMANDA DE COCINA</PrintTemplatePart><PrintTemplatePart as="b" element={element} part="value">{ticket.order.code}</PrintTemplatePart></header>,
    kitchen_order: (element) => <div className="kitchen-ticket-order-notes"><PrintTemplatePart element={element} part="value">{kindLabel(ticket.order.kind)} · {formatTicketDate(ticket.order.ordered_at)}</PrintTemplatePart></div>,
    kitchen_pizzas: pizzaSection,
    kitchen_delivery: (element) => deliveryItems.length > 0 ? <section className="kitchen-ticket-delivery"><PrintTemplatePart as="b" element={element} part="title">PARA ENTREGAR</PrintTemplatePart><ul>{deliveryItems.map((item) => <li key={item.id}><PrintTemplatePart element={element} part="value">{item.quantity} × {item.name}</PrintTemplatePart></li>)}</ul></section> : null,
    kitchen_summary: (element) => <section className="kitchen-ticket-summary">
      <PrintTemplatePart as="b" element={element} part="title">RESUMEN OPERATIVO</PrintTemplatePart>
      <p><PrintTemplatePart element={element} part="label">TOTAL PIZZAS</PrintTemplatePart><PrintTemplatePart as="strong" element={element} part="value">{ticket.summary.pizza_count}</PrintTemplatePart></p>
      {ticket.summary.bases.length > 0 ? <><PrintTemplatePart as="small" element={element} part="title">BASES</PrintTemplatePart><ComponentList element={element} components={ticket.summary.bases.map((base) => ({ type: "ingredient" as const, name: base.name, quantity: base.quantity, unit: base.unit, addition_name: null, addition_scope: null, addition_scope_label: null }))} /></> : null}
      {ticket.summary.components.length > 0 ? <><PrintTemplatePart as="small" element={element} part="title">TOTAL INGREDIENTES</PrintTemplatePart><ComponentList element={element} components={ticket.summary.components.map((component) => ({ ...component, addition_name: null, addition_scope: null, addition_scope_label: null }))} /></> : null}
    </section>
  };

  return (
    <article className={`kitchen-ticket thermal${compact ? " kitchen-ticket-58" : ""}`} data-thermal-leading-blank-lines={template.leading_blank_lines} data-thermal-line-spacing={template.line_spacing} data-thermal-trailing-blank-lines={template.trailing_blank_lines} ref={printRef} style={{ lineHeight: template.line_spacing, paddingInline: `${template.margin_mm}mm` }}>
      <PrintTemplateBlankLines lines={template.leading_blank_lines} position="start" />
      {template.elements.map((element) => element.type === "field"
        ? <PrintTemplateElementFrame element={element} key={element.id}>{fields[element.field ?? ""]?.(element)}</PrintTemplateElementFrame>
        : <PrintTemplateCustomElement element={element} key={element.id} />)}
      <PrintTemplateBlankLines lines={template.trailing_blank_lines} position="end" />
    </article>
  );
};

function KitchenTicketPreview({ onClose, template, ticket }: { onClose: () => void; template: PrintTemplate; ticket: KitchenTicket }) {
  const ticketRef = useRef<HTMLElement>(null);
  const [printError, setPrintError] = useState("");
  const [printMessage, setPrintMessage] = useState("");
  const handlePrint = async () => {
    setPrintError("");
    setPrintMessage("");
    if (!ticketRef.current) {
      setPrintError("No se pudo preparar la comanda para imprimir.");
      return;
    }
    if (shouldUseBlePrinter()) {
      try {
        setPrintMessage(await printBleThermalDocuments([ticketRef.current], { connectIfNeeded: true, leadingBlankLines: template.leading_blank_lines, trailingBlankLines: template.trailing_blank_lines }));
      } catch (error) {
        setPrintError(getBleErrorMessage(error));
      }
      return;
    }
    if (canUseBrowserPrint()) {
      if (!printThermalDocuments([ticketRef.current], `Comanda ${ticket.order.code}`)) {
        setPrintError("No se pudo abrir el documento térmico para imprimir.");
      }
      return;
    }
    const result = await shareOrOpenThermalPdf(ticketRef.current, `comanda-${ticket.order.code}.pdf`);
    if (result === "shared") setPrintMessage("PDF térmico listo para compartir o imprimir.");
    else if (result === "opened") setPrintMessage("PDF térmico abierto para imprimir desde el visor.");
    else if (result !== "cancelled") setPrintError("No se pudo preparar el PDF térmico.");
  };
  const handleDownload = () => {
    setPrintError("");
    if (!ticketRef.current || !downloadThermalPdf(ticketRef.current, `comanda-${ticket.order.code}.pdf`)) {
      setPrintError("No se pudo generar el PDF de la comanda.");
    }
  };

  return (
    <div className="modal-backdrop kitchen-ticket-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-label={`Vista previa de comanda ${ticket.order.code}`} aria-modal="true" className="modal-panel kitchen-ticket-preview-modal" role="dialog" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-header kitchen-ticket-preview-header">
          <div><strong>Vista previa de comanda</strong><span>Formato térmico de 58 mm</span></div>
          <div className="kitchen-ticket-preview-header-actions">
            <button className="ghost-button kitchen-ticket-header-print" onClick={() => void handlePrint()} type="button"><Printer size={17} /> Imprimir</button>
            <button className="icon-button kitchen-ticket-print-action" onClick={handleDownload} title="Descargar PDF de comanda" type="button"><Download size={18} /></button>
            <button className="icon-button kitchen-ticket-print-action" onClick={onClose} title="Cerrar vista previa" type="button"><X size={18} /></button>
          </div>
        </header>
        <div className="kitchen-ticket-print-root kitchen-ticket-print-root-58"><KitchenTicketDocument compact printRef={ticketRef} template={template} ticket={ticket} /></div>
        {printMessage ? <p className="form-status">{printMessage}</p> : null}
        {printError ? <p className="form-status error">{printError}</p> : null}
        <footer className="modal-footer kitchen-ticket-preview-footer">
          <button className="ghost-button" onClick={onClose} type="button">Cerrar</button>
          <div className="kitchen-ticket-preview-actions"><button className="ghost-button" onClick={handleDownload} type="button"><Download size={16} /> Descargar PDF</button><button className="primary-button" onClick={() => void handlePrint()} type="button"><Printer size={17} /> Imprimir comanda</button></div>
        </footer>
      </section>
    </div>
  );
}

export function KitchenTicketPrintButton({ orderCode, orderId }: { orderCode: string; orderId: string }) {
  const [ticket, setTicket] = useState<KitchenTicket | null>(null);
  const [template, setTemplate] = useState<PrintTemplate | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const openPreview = async () => {
    setError("");
    setLoading(true);
    const [result, templatesResult] = await Promise.all([getKitchenTicket(orderId), getPrintTemplates()]);
    setLoading(false);
    if (result.status === "error" || !result.ticket) {
      setError(result.message);
      return;
    }
    setTicket(result.ticket);
    setTemplate(templatesResult.status === "success" && templatesResult.templates ? templatesResult.templates.kitchen : defaultPrintTemplate("kitchen"));
  };

  return (
    <>
      <button aria-label={`Imprimir comanda de ${orderCode}`} className="ghost-button kitchen-ticket-trigger" disabled={loading} onClick={() => void openPreview()} type="button">
        {loading ? <LoaderCircle className="spin" size={16} /> : <Printer size={16} />}
        {loading ? "Cargando..." : "Imprimir comanda"}
      </button>
      {error ? <span className="row-action-message error">{error}</span> : null}
      {ticket && template ? <KitchenTicketPreview onClose={() => { setTicket(null); setTemplate(null); }} template={template} ticket={ticket} /> : null}
    </>
  );
}
