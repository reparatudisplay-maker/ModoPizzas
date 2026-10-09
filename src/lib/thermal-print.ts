"use client";

const CSS_PIXELS_PER_MILLIMETER = 96 / 25.4;

const thermalDocumentStyles = `
  @page { margin: 0; }
  * { box-sizing: border-box; }
  html, body { width: 58mm; min-height: 0; margin: 0; padding: 0; background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; }
  #thermal-print-root { width: 48mm; margin: 0; padding: 0; color: #000; background: #fff; font-size: 10px; line-height: 1.18; }
  .thermal-print-document { break-inside: avoid; }
  .thermal-print-document + .thermal-print-document { margin: 0; padding: 0; border-top: 2px dashed #111; }
  .kitchen-ticket, .customer-receipt { width: 100%; margin: 0; padding: 0; color: #000; background: #fff; font: inherit; }
  .kitchen-ticket-header, .customer-receipt-header { display: grid; gap: 1px; padding-bottom: 5px; border-bottom: 2px solid #111; text-align: left; }
  .kitchen-ticket-header strong, .customer-receipt-header strong { font-size: .95rem; letter-spacing: .035em; }
  .kitchen-ticket-header b { font-size: 1.2rem; }
  .customer-receipt-header b { font-size: .92rem; }
  .kitchen-ticket-header span, .customer-receipt-header span { font-size: .72rem; }
  .kitchen-ticket-pizza, .kitchen-ticket-delivery, .kitchen-ticket-order-notes, .kitchen-ticket-summary { display: grid; gap: 4px; padding: 6px 0; border-bottom: 1px dashed #555; break-inside: avoid; }
  .kitchen-ticket-pizza > header { display: grid; gap: 1px; }
  .kitchen-ticket-pizza > header span, .kitchen-ticket-group > b, .kitchen-ticket-delivery > b, .kitchen-ticket-order-notes > b, .kitchen-ticket-summary > b, .kitchen-ticket-summary > small { font-size: .67rem; font-weight: 800; letter-spacing: .035em; }
  .kitchen-ticket-pizza > header strong { font-size: .96rem; }
  .kitchen-ticket-pizza > header small, .kitchen-ticket-group > small { color: #222; font-size: .76rem; }
  .kitchen-ticket-group { display: grid; gap: 2px; }
  .kitchen-ticket-group p, .kitchen-ticket-summary p, .customer-receipt-totals p, .customer-receipt-payment p { display: flex; justify-content: space-between; gap: 6px; margin: 0; }
  .kitchen-ticket-quantity-list, .kitchen-ticket-delivery ul, .customer-receipt-items { display: grid; gap: 2px; margin: 0; padding: 0; list-style: none; }
  .kitchen-ticket-quantity-list li { display: flex; justify-content: space-between; gap: 6px; }
  .kitchen-ticket-quantity-list li > span, .kitchen-ticket-group p > span, .kitchen-ticket-summary p > span, .customer-receipt-items li > div > strong { min-width: 0; overflow-wrap: anywhere; }
  .kitchen-ticket-quantity-list li > strong, .kitchen-ticket-group p > strong, .kitchen-ticket-summary p > strong { flex: 0 0 auto; white-space: nowrap; text-align: right; }
  .kitchen-ticket-additions, .kitchen-ticket-notes, .kitchen-ticket-order-notes { display: grid; gap: 2px; padding: 4px; background: transparent; }
  .kitchen-ticket-additions { border-left: 2px solid #111; }
  .kitchen-ticket-summary { border-bottom: 0; }
  .customer-receipt { display: grid; gap: 7px; }
  .customer-receipt-items { gap: 7px; }
  .customer-receipt-items li { display: grid; gap: 2px; padding-bottom: 6px; border-bottom: 1px dashed #555; break-inside: avoid; }
  .customer-receipt-items li > div, .customer-receipt-items li > b, .customer-receipt-items small { display: flex; justify-content: space-between; gap: 6px; }
  .customer-receipt-items li > div span, .customer-receipt-items small { color: #222; font-size: .72rem; }
  .customer-receipt-items li > b { justify-self: end; }
  .customer-receipt-totals, .customer-receipt-payment { display: grid; gap: 4px; }
  .customer-receipt-total { margin-top: 2px !important; padding-top: 6px; border-top: 2px solid #111; font-size: 1rem; }
  .customer-receipt-footer { padding-top: 6px; border-top: 1px dashed #555; font-size: .78rem; text-align: center; }
`;

export function printThermalDocuments(documents: HTMLElement[], title: string) {
  if (documents.length === 0) return false;

  const frame = window.document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:48mm;height:100vh;border:0;opacity:0;pointer-events:none;";
  window.document.body.append(frame);

  const documentForPrint = frame.contentDocument;
  const windowForPrint = frame.contentWindow;
  if (!documentForPrint || !windowForPrint) {
    frame.remove();
    return false;
  }

  let scheduled = false;
  let cleanupTimer: number | undefined;
  const cleanup = () => {
    if (cleanupTimer) window.clearTimeout(cleanupTimer);
    frame.remove();
  };
  const printWhenReady = () => {
    if (scheduled) return;
    scheduled = true;
    window.setTimeout(() => {
      const root = documentForPrint.getElementById("thermal-print-root");
      if (!root) {
        cleanup();
        return;
      }
      const heightMm = Math.max(30, Math.ceil(((root.getBoundingClientRect().height / CSS_PIXELS_PER_MILLIMETER) + 1) * 10) / 10);
      const pageStyle = documentForPrint.createElement("style");
      pageStyle.textContent = `@page { size: 58mm ${heightMm}mm; margin: 0; }`;
      documentForPrint.head.append(pageStyle);
      windowForPrint.addEventListener("afterprint", cleanup, { once: true });
      windowForPrint.focus();
      windowForPrint.requestAnimationFrame(() => windowForPrint.requestAnimationFrame(() => windowForPrint.print()));
      cleanupTimer = window.setTimeout(cleanup, 60_000);
    }, 100);
  };

  frame.addEventListener("load", printWhenReady, { once: true });
  documentForPrint.open();
  documentForPrint.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>${thermalDocumentStyles}</style></head><body><main id="thermal-print-root">${documents.map((document) => `<div class="thermal-print-document">${document.outerHTML}</div>`).join("")}</main></body></html>`);
  documentForPrint.close();
  window.setTimeout(printWhenReady, 300);
  return true;
}