"use client";

import { useRef, useState, type Ref } from "react";
import { Download, LoaderCircle, Printer, X } from "lucide-react";
import { createIpadThermalPrintJob, getKitchenTicket, getThermalPrinterSettings, type KitchenTicket } from "@/app/admin/actions";
import { formatStockQuantity } from "@/lib/units";
import { canUseBrowserPrint, printThermalDocuments } from "@/lib/thermal-print";
import { downloadThermalPdf, shareOrOpenThermalPdf } from "@/lib/thermal-pdf";
import { createIpadThermalPayload, runIpadShortcut, shouldUseIpadShortcut } from "@/lib/device-thermal-print";

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

function ComponentList({ components }: { components: KitchenTicket["items"][number]["components"] }) {
  return (
    <ul className="kitchen-ticket-quantity-list">
      {components.map((component, index) => (
        <li key={`${component.name}-${component.unit}-${index}`}>
          <span>{component.name}</span>
          <strong>{formatQuantity(component.quantity, component.unit)}</strong>
        </li>
      ))}
    </ul>
  );
}

export const KitchenTicketDocument = ({ compact = false, ticket, printRef }: { compact?: boolean; ticket: KitchenTicket; printRef?: Ref<HTMLElement> }) => {
  const pizzaItems = ticket.items.filter((item) => item.kind === "pizza");
  const deliveryItems = ticket.items.filter((item) => item.kind === "sale_product");

  return (
    <article className={`kitchen-ticket thermal${compact ? " kitchen-ticket-58" : ""}`} ref={printRef}>
      <header className="kitchen-ticket-header">
        <strong>COMANDA DE COCINA</strong>
        <b>{ticket.order.code}</b>
        <span>{kindLabel(ticket.order.kind)} · {formatTicketDate(ticket.order.ordered_at)}</span>
      </header>

      {pizzaItems.map((item, itemIndex) => {
        const ingredients = item.components.filter((component) => component.type !== "addition");
        const additions = item.components.filter((component) => component.type === "addition");
        return (
          <section className="kitchen-ticket-pizza" key={item.id || `${item.name}-${itemIndex}`}>
            <header>
              <span>{item.quantity} × PIZZA</span>
              <strong>{item.name}</strong>
              {item.size ? <small>{item.size}</small> : null}
            </header>

            {item.base ? (
              <div className="kitchen-ticket-group">
                <b>{item.base.mode === "production_dough" ? "MASA DE PRODUCCIÓN" : "BASE"}</b>
                <p><span>{item.base.name ?? "Base sin registro"}</span><strong>{formatQuantity(item.base.quantity, item.base.unit)}</strong></p>
                {item.base.production_batches.map((batch, batchIndex) => (
                  <small key={`${batch.production_number}-${batchIndex}`}>Producción P{batch.production_number ?? "—"} · {formatQuantity(batch.quantity, batch.unit)}</small>
                ))}
              </div>
            ) : null}

            {ingredients.length > 0 ? <div className="kitchen-ticket-group"><b>INGREDIENTES</b><ComponentList components={ingredients} /></div> : null}
            {additions.length > 0 ? <div className="kitchen-ticket-group kitchen-ticket-additions"><b>ADICIONES</b><ComponentList components={additions} /></div> : null}
            {item.notes ? <div className="kitchen-ticket-notes"><b>NOTAS</b><span>{item.notes}</span></div> : null}
          </section>
        );
      })}

      {deliveryItems.length > 0 ? (
        <section className="kitchen-ticket-delivery">
          <b>PARA ENTREGAR</b>
          <ul>{deliveryItems.map((item) => <li key={item.id}><strong>{item.quantity} ×</strong> {item.name}</li>)}</ul>
        </section>
      ) : null}

      <section className="kitchen-ticket-summary">
        <b>RESUMEN OPERATIVO</b>
        <p><span>TOTAL PIZZAS</span><strong>{ticket.summary.pizza_count}</strong></p>
        {ticket.summary.bases.length > 0 ? <><small>BASES</small><ComponentList components={ticket.summary.bases.map((base) => ({ type: "ingredient" as const, name: base.name, quantity: base.quantity, unit: base.unit, addition_name: null, addition_scope: null, addition_scope_label: null }))} /></> : null}
        {ticket.summary.components.length > 0 ? <><small>TOTAL INGREDIENTES</small><ComponentList components={ticket.summary.components.map((component) => ({ ...component, addition_name: null, addition_scope: null, addition_scope_label: null }))} /></> : null}
      </section>
    </article>
  );
};

function KitchenTicketPreview({ onClose, ticket }: { onClose: () => void; ticket: KitchenTicket }) {
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
    const settingsResult = await getThermalPrinterSettings();
    if (settingsResult.status === "success" && settingsResult.settings && shouldUseIpadShortcut(settingsResult.settings)) {
      const jobResult = await createIpadThermalPrintJob(createIpadThermalPayload([ticketRef.current]));
      if (jobResult.status === "error" || !jobResult.shortcut_input) {
        setPrintError(jobResult.message);
        return;
      }
      setPrintMessage("Comanda enviada al atajo Imprimir Modo Pizzas.");
      runIpadShortcut(jobResult.shortcut_input);
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
        <div className="kitchen-ticket-print-root kitchen-ticket-print-root-58"><KitchenTicketDocument compact printRef={ticketRef} ticket={ticket} /></div>
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
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const openPreview = async () => {
    setError("");
    setLoading(true);
    const result = await getKitchenTicket(orderId);
    setLoading(false);
    if (result.status === "error" || !result.ticket) {
      setError(result.message);
      return;
    }
    setTicket(result.ticket);
  };

  return (
    <>
      <button aria-label={`Imprimir comanda de ${orderCode}`} className="ghost-button kitchen-ticket-trigger" disabled={loading} onClick={() => void openPreview()} type="button">
        {loading ? <LoaderCircle className="spin" size={16} /> : <Printer size={16} />}
        {loading ? "Cargando..." : "Imprimir comanda"}
      </button>
      {error ? <span className="row-action-message error">{error}</span> : null}
      {ticket ? <KitchenTicketPreview onClose={() => setTicket(null)} ticket={ticket} /> : null}
    </>
  );
}
