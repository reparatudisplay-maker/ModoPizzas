"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowUp, Bold, GripVertical, Italic, LoaderCircle, Minus, Plus, Printer, RotateCcw, Trash2, Underline } from "lucide-react";
import { restoreDefaultPrintTemplate, savePrintTemplate, type PrintTemplatesState } from "@/app/admin/actions";
import { PrintTemplateBlankLines, PrintTemplateCustomElement, PrintTemplateElementFrame } from "@/components/print-template-elements";
import { getBleErrorMessage, printBleThermalDocuments, shouldUseBlePrinter } from "@/lib/ble-thermal-printer";
import { canUseBrowserPrint, printThermalDocuments } from "@/lib/thermal-print";
import { fieldLabel, kitchenFieldLabels, receiptFieldLabels, type PrintTemplate, type PrintTemplateAlignment, type PrintTemplateElement, type PrintTemplateFontSize, type PrintTemplateKind, protectedTemplateField } from "@/lib/print-templates";

type Props = { templates: Record<PrintTemplateKind, PrintTemplate> };

const templateNames: Record<PrintTemplateKind, string> = {
  kitchen: "Comanda de cocina",
  receipt: "Ticket de venta"
};

function makeId(prefix: string) {
  return `${prefix}-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Date.now().toString(36)}`;
}

function newElement(type: PrintTemplateElement["type"], field?: string): PrintTemplateElement {
  return { id: makeId(type), type, field, text: type === "text" ? "Texto personalizado" : undefined, visible: true, align: "left", font_size: "normal", bold: false, italic: false, underline: false, spacing_after: type === "spacer" ? 1 : 1 };
}

function updateElement(template: PrintTemplate, id: string, update: Partial<PrintTemplateElement>) {
  return { ...template, elements: template.elements.map((element) => element.id === id ? { ...element, ...update } : element) };
}

function moveElement(template: PrintTemplate, sourceId: string, targetId: string) {
  const source = template.elements.findIndex((element) => element.id === sourceId);
  const target = template.elements.findIndex((element) => element.id === targetId);
  if (source < 0 || target < 0 || source === target) return template;
  const elements = [...template.elements];
  const [element] = elements.splice(source, 1);
  elements.splice(target, 0, element);
  return { ...template, elements };
}

function Stepper({ label, max, min = 0, onChange, value }: { label: string; max: number; min?: number; onChange: (value: number) => void; value: number }) {
  return <div className="print-template-stepper"><span>{label}</span><div><button aria-label={`Reducir ${label}`} className="icon-button" disabled={value <= min} onClick={() => onChange(value - 1)} type="button"><Minus size={15} /></button><strong>{value}</strong><button aria-label={`Aumentar ${label}`} className="icon-button" disabled={value >= max} onClick={() => onChange(value + 1)} type="button"><Plus size={15} /></button></div></div>;
}

function PreviewField({ field, kind }: { field: string; kind: PrintTemplateKind }) {
  const values: Record<string, ReactNode> = {
    kitchen_header: <header className="kitchen-ticket-header"><strong>COMANDA DE COCINA</strong><b>PD124</b></header>,
    kitchen_order: <div className="kitchen-ticket-order-notes">Local · 11/10/2026, 1:30 p. m.</div>,
    kitchen_pizzas: <section className="kitchen-ticket-pizza"><header><span>1 × PIZZA</span><strong>HAWAIANA / PEPPERONI</strong><small>MEDIANA 35 CM</small></header><div className="kitchen-ticket-group"><b>BASE</b><p><span>Base 35 cm</span><strong>1 UND</strong></p></div><div className="kitchen-ticket-group"><b>INGREDIENTES</b><ul className="kitchen-ticket-quantity-list"><li><span>Salsa Napolitana</span><strong>50 G</strong></li><li><span>Mozzarella</span><strong>120 G</strong></li><li><span>Pepperoni</span><strong>45 G</strong></li></ul></div><div className="kitchen-ticket-notes"><b>NOTAS</b><span>Sin cebolla</span></div></section>,
    kitchen_delivery: <section className="kitchen-ticket-delivery"><b>PARA ENTREGAR</b><ul><li><strong>1 ×</strong> COCA-COLA 1,5 L</li></ul></section>,
    kitchen_summary: <section className="kitchen-ticket-summary"><b>RESUMEN OPERATIVO</b><p><span>TOTAL PIZZAS</span><strong>1</strong></p><small>BASES</small><ul className="kitchen-ticket-quantity-list"><li><span>Base 35 cm</span><strong>1 UND</strong></li></ul></section>,
    receipt_header: <header className="customer-receipt-header"><strong>MODO PIZZAS</strong><b>TICKET DE COMPRA</b></header>,
    receipt_order: <div className="customer-receipt-order">PD124 · 11/10/2026, 1:30 p. m.</div>,
    receipt_items: <ul className="customer-receipt-items"><li><div><strong>1 × HAWAIANA MEDIANA</strong><span>$ 35.900 c/u</span></div><b>$ 35.900</b></li><li><div><strong>1 × COCA-COLA 1,5 L</strong><span>$ 12.000 c/u</span></div><b>$ 12.000</b></li></ul>,
    receipt_totals: <section className="customer-receipt-totals"><p><span>Subtotal</span><strong>$ 47.900</strong></p><p className="customer-receipt-total"><span>TOTAL</span><strong>$ 47.900</strong></p></section>,
    receipt_payment: <section className="customer-receipt-payment"><p><span>PAGO</span><strong>Efectivo</strong></p><p><span>Recibido</span><strong>$ 50.000</strong></p><p><span>Cambio</span><strong>$ 2.100</strong></p></section>,
    receipt_footer: <footer className="customer-receipt-footer">Gracias por tu compra</footer>
  };
  return values[field] ?? <span>{fieldLabel(kind, field)}</span>;
}

function TemplatePreview({ template, printRef }: { template: PrintTemplate; printRef?: React.Ref<HTMLElement> }) {
  const articleClass = template.kind === "kitchen" ? "kitchen-ticket thermal kitchen-ticket-58" : "customer-receipt thermal receipt-58";
  return <article className={articleClass} data-thermal-leading-blank-lines={template.leading_blank_lines} data-thermal-line-spacing={template.line_spacing} data-thermal-trailing-blank-lines={template.trailing_blank_lines} ref={printRef} style={{ lineHeight: template.line_spacing, paddingInline: `${template.margin_mm}mm` }}>
    <PrintTemplateBlankLines lines={template.leading_blank_lines} position="start" />
    {template.elements.map((element) => element.type === "field"
      ? <PrintTemplateElementFrame element={element} key={element.id}><PreviewField field={element.field ?? ""} kind={template.kind} /></PrintTemplateElementFrame>
      : <PrintTemplateCustomElement element={element} key={element.id} />)}
    <PrintTemplateBlankLines lines={template.trailing_blank_lines} position="end" />
  </article>;
}

export function PrintTemplateEditor({ templates: initialTemplates }: Props) {
  const [templates, setTemplates] = useState(initialTemplates);
  const [kind, setKind] = useState<PrintTemplateKind>("kitchen");
  const [selectedId, setSelectedId] = useState(initialTemplates.kitchen.elements[0]?.id ?? "");
  const [newField, setNewField] = useState("kitchen_header");
  const [dragId, setDragId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const previewRef = useRef<HTMLElement>(null);
  const template = templates[kind];
  const selected = useMemo(() => template.elements.find((element) => element.id === selectedId) ?? template.elements[0] ?? null, [selectedId, template.elements]);
  const fieldOptions = kind === "kitchen" ? kitchenFieldLabels : receiptFieldLabels;

  const setTemplate = (next: PrintTemplate) => setTemplates((current) => ({ ...current, [kind]: next }));
  const selectKind = (nextKind: PrintTemplateKind) => {
    setKind(nextKind);
    setSelectedId(templates[nextKind].elements[0]?.id ?? "");
    setNewField(Object.keys(nextKind === "kitchen" ? kitchenFieldLabels : receiptFieldLabels)[0] ?? "");
    setMessage("");
    setError("");
  };
  const addElement = (element: PrintTemplateElement) => {
    setTemplate({ ...template, elements: [...template.elements, element] });
    setSelectedId(element.id);
  };
  const save = async () => {
    setSaving(true); setError(""); setMessage("");
    const result = await savePrintTemplate(template);
    setSaving(false);
    if (result.status === "success") setMessage(result.message);
    else setError(result.message);
  };
  const restore = async () => {
    if (!window.confirm(`¿Restaurar la plantilla predeterminada de ${templateNames[kind].toLowerCase()}?`)) return;
    setSaving(true); setError(""); setMessage("");
    const result: PrintTemplatesState = await restoreDefaultPrintTemplate(kind);
    setSaving(false);
    if (result.status === "success" && result.templates) {
      setTemplates(result.templates);
      setSelectedId(result.templates[kind].elements[0]?.id ?? "");
      setMessage(result.message);
    } else setError(result.message);
  };
  const printTest = async () => {
    if (!previewRef.current) return;
    setError(""); setMessage("");
    if (shouldUseBlePrinter()) {
      try {
        setMessage(await printBleThermalDocuments([previewRef.current], { connectIfNeeded: true, leadingBlankLines: template.leading_blank_lines, trailingBlankLines: template.trailing_blank_lines }));
      } catch (printError) {
        setError(getBleErrorMessage(printError));
      }
      return;
    }
    if (!canUseBrowserPrint() || !printThermalDocuments([previewRef.current], `Prueba ${templateNames[kind]}`)) setError("No se pudo abrir la prueba de impresión.");
    else setMessage("Se abrió la prueba en el servicio de impresión del dispositivo.");
  };

  return <section className="module-stack print-template-editor">
    <div className="section-title-row"><div><h1>Plantillas de impresión</h1><p className="muted">Define el orden y el formato de cada documento térmico de 58 mm.</p></div><div className="print-template-tabs" role="tablist"><button aria-selected={kind === "kitchen"} className={kind === "kitchen" ? "active" : ""} onClick={() => selectKind("kitchen")} role="tab" type="button">Comanda</button><button aria-selected={kind === "receipt"} className={kind === "receipt" ? "active" : ""} onClick={() => selectKind("receipt")} role="tab" type="button">Ticket</button></div></div>
    <div className="print-template-layout">
      <section className="form-panel print-template-elements-panel"><div className="section-title-row"><div><h2>Elementos</h2><p className="muted">Arrastra para cambiar el orden.</p></div></div>
        <div className="print-template-add-row"><select aria-label="Campo dinámico" onChange={(event) => setNewField(event.target.value)} value={newField}>{Object.entries(fieldOptions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button className="ghost-button" onClick={() => addElement(newElement("field", newField))} type="button"><Plus size={15} /> Campo</button></div>
        <div className="print-template-add-actions"><button className="ghost-button" onClick={() => addElement(newElement("text"))} type="button"><Plus size={15} /> Texto</button><button className="ghost-button" onClick={() => addElement(newElement("separator"))} type="button">Separador</button><button className="ghost-button" onClick={() => addElement(newElement("spacer"))} type="button">Espacio</button></div>
        <div className="print-template-element-list">{template.elements.map((element, index) => <div aria-pressed={selected?.id === element.id} className={`print-template-element-row ${selected?.id === element.id ? "selected" : ""}`} draggable key={element.id} onClick={() => setSelectedId(element.id)} onDragEnd={() => setDragId(null)} onDragOver={(event) => event.preventDefault()} onDragStart={() => setDragId(element.id)} onDrop={() => { if (dragId) setTemplate(moveElement(template, dragId, element.id)); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedId(element.id); }} role="button" tabIndex={0}><GripVertical size={16} /><span>{element.type === "field" ? fieldLabel(kind, element.field) : element.type === "text" ? element.text || "Texto personalizado" : element.type === "separator" ? "Separador" : "Espacio"}</span><small>{element.visible ? "Visible" : "Oculto"}</small><span className="print-template-row-move"><button aria-label="Subir elemento" disabled={index === 0} onClick={(event) => { event.stopPropagation(); setTemplate(moveElement(template, element.id, template.elements[index - 1].id)); }} type="button"><ArrowUp size={14} /></button><button aria-label="Bajar elemento" disabled={index === template.elements.length - 1} onClick={(event) => { event.stopPropagation(); setTemplate(moveElement(template, element.id, template.elements[index + 1].id)); }} type="button"><ArrowDown size={14} /></button></span></div>)}</div>
      </section>
      <section className="form-panel print-template-properties"><div className="section-title-row"><div><h2>Formato</h2><p className="muted">La cursiva se muestra en la vista previa; ESC/POS no la aplica.</p></div></div>
        {selected ? <>
          <label className="field"><span>Elemento</span><input disabled value={selected.type === "field" ? fieldLabel(kind, selected.field) : selected.type} /></label>
          {selected.type === "text" ? <label className="field"><span>Texto</span><textarea maxLength={240} onChange={(event) => setTemplate(updateElement(template, selected.id, { text: event.target.value }))} rows={3} value={selected.text ?? ""} /></label> : null}
          <label className="toggle-field"><input checked={selected.visible} disabled={protectedTemplateField(kind, selected.field)} onChange={(event) => setTemplate(updateElement(template, selected.id, { visible: event.target.checked }))} type="checkbox" /><span>Mostrar elemento</span></label>
          <div className="print-template-toolbar"><button aria-label="Negrita" aria-pressed={selected.bold} className={selected.bold ? "active" : ""} onClick={() => setTemplate(updateElement(template, selected.id, { bold: !selected.bold }))} type="button"><Bold size={16} /></button><button aria-label="Cursiva" aria-pressed={selected.italic} className={selected.italic ? "active" : ""} onClick={() => setTemplate(updateElement(template, selected.id, { italic: !selected.italic }))} type="button"><Italic size={16} /></button><button aria-label="Subrayado" aria-pressed={selected.underline} className={selected.underline ? "active" : ""} onClick={() => setTemplate(updateElement(template, selected.id, { underline: !selected.underline }))} type="button"><Underline size={16} /></button><span />{([ ["left", AlignLeft], ["center", AlignCenter], ["right", AlignRight] ] as const).map(([alignment, Icon]) => <button aria-label={`Alinear ${alignment}`} aria-pressed={selected.align === alignment} className={selected.align === alignment ? "active" : ""} key={alignment} onClick={() => setTemplate(updateElement(template, selected.id, { align: alignment as PrintTemplateAlignment }))} type="button"><Icon size={16} /></button>)}</div>
          <div className="form-grid"><label className="field"><span>Tamaño</span><select onChange={(event) => setTemplate(updateElement(template, selected.id, { font_size: event.target.value as PrintTemplateFontSize }))} value={selected.font_size}><option value="small">Pequeño</option><option value="normal">Normal</option><option value="large">Destacado</option></select></label><Stepper label="Espacio después" max={8} onChange={(value) => setTemplate(updateElement(template, selected.id, { spacing_after: value }))} value={selected.spacing_after} /></div>
          {!protectedTemplateField(kind, selected.field) ? <button className="danger-button print-template-remove" onClick={() => { const next = template.elements.filter((element) => element.id !== selected.id); setTemplate({ ...template, elements: next }); setSelectedId(next[0]?.id ?? ""); }} type="button"><Trash2 size={16} /> Eliminar elemento</button> : <p className="muted">Este campo se conserva por trazabilidad del documento.</p>}
        </> : <p className="empty-state">Agrega o selecciona un elemento.</p>}
        <hr />
        <h3>Espaciado de papel</h3><div className="print-template-steppers"><Stepper label="Márgenes laterales (mm)" max={4} onChange={(value) => setTemplate({ ...template, margin_mm: value })} value={template.margin_mm} /><Stepper label="Interlineado" max={3} min={1} onChange={(value) => setTemplate({ ...template, line_spacing: value })} value={template.line_spacing} /><Stepper label="Líneas en blanco al inicio" max={20} onChange={(value) => setTemplate({ ...template, leading_blank_lines: value })} value={template.leading_blank_lines} /><Stepper label="Líneas en blanco al final" max={20} onChange={(value) => setTemplate({ ...template, trailing_blank_lines: value })} value={template.trailing_blank_lines} /></div>
      </section>
      <section className="form-panel print-template-preview-panel"><div className="section-title-row"><div><h2>Vista previa</h2><p className="muted">Papel térmico de 58 mm · área útil de 48 mm.</p></div></div><div className="print-template-paper"><TemplatePreview printRef={previewRef} template={template} /></div><button className="ghost-button" onClick={() => void printTest()} type="button"><Printer size={16} /> Imprimir prueba</button></section>
    </div>
    {message ? <p className="form-status success">{message}</p> : null}{error ? <p className="form-status error">{error}</p> : null}
    <div className="form-actions"><button className="primary-button" disabled={saving} onClick={() => void save()} type="button">{saving ? <LoaderCircle className="spin" size={16} /> : null} Guardar plantilla</button><button className="ghost-button" disabled={saving} onClick={() => void restore()} type="button"><RotateCcw size={16} /> Restaurar predeterminada</button></div>
  </section>;
}
