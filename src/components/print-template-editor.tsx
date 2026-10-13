"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowUp, Bold, GripVertical, Italic, LoaderCircle, Minus, Plus, Printer, RotateCcw, Trash2, Underline } from "lucide-react";
import { restoreDefaultPrintTemplate, savePrintTemplate, type PrintTemplatesState } from "@/app/admin/actions";
import { PrintTemplateBlankLines, PrintTemplateCustomElement, PrintTemplateElementFrame, PrintTemplatePart } from "@/components/print-template-elements";
import { getBleErrorMessage, printBleThermalDocuments, shouldUseBlePrinter } from "@/lib/ble-thermal-printer";
import { canUseBrowserPrint, printThermalDocuments } from "@/lib/thermal-print";
import { fieldLabel, kitchenFieldLabels, printTemplatePartStyle, receiptFieldLabels, type PrintTemplate, type PrintTemplateAlignment, type PrintTemplateElement, type PrintTemplateFontSize, type PrintTemplateKind, type PrintTemplatePart as TemplatePart, type PrintTemplatePartStyle, protectedTemplateField } from "@/lib/print-templates";

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

function updatePartStyle(template: PrintTemplate, id: string, part: TemplatePart, update: Partial<PrintTemplatePartStyle>) {
  return {
    ...template,
    elements: template.elements.map((element) => {
      if (element.id !== id) return element;
      const current = printTemplatePartStyle(element, part);
      return { ...element, part_styles: { ...element.part_styles, [part]: { ...current, ...update } } };
    })
  };
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

function PartFormatControls({ element, onChange, part, title }: { element: PrintTemplateElement; onChange: (update: Partial<PrintTemplatePartStyle>) => void; part: TemplatePart; title: string }) {
  const style = printTemplatePartStyle(element, part);
  return <div className="print-template-part-controls">
    <strong>{title}</strong>
    <button aria-label={`Negrita de ${title}`} aria-pressed={style.bold} className={style.bold ? "active" : ""} onClick={() => onChange({ bold: !style.bold })} type="button"><Bold size={15} /></button>
    <select aria-label={`Tamaño de ${title}`} onChange={(event) => onChange({ font_size: event.target.value as PrintTemplateFontSize })} value={style.font_size}><option value="small">Pequeño</option><option value="normal">Normal</option><option value="large">Destacado</option></select>
    {([ ["left", AlignLeft], ["center", AlignCenter], ["right", AlignRight] ] as const).map(([alignment, Icon]) => <button aria-label={`Alinear ${title} a ${alignment}`} aria-pressed={style.align === alignment} className={style.align === alignment ? "active" : ""} key={alignment} onClick={() => onChange({ align: alignment })} type="button"><Icon size={15} /></button>)}
  </div>;
}

function PreviewField({ element, kind }: { element: PrintTemplateElement; kind: PrintTemplateKind }) {
  const field = element.field ?? "";
  const values: Record<string, ReactNode> = {
    kitchen_header: <header className="kitchen-ticket-header"><PrintTemplatePart as="strong" element={element} part="title">COMANDA DE COCINA</PrintTemplatePart><PrintTemplatePart as="b" element={element} part="value">PD124</PrintTemplatePart></header>,
    kitchen_order: <div className="kitchen-ticket-order-notes"><PrintTemplatePart element={element} part="value">Local · 11/10/2026, 1:30 p. m.</PrintTemplatePart></div>,
    kitchen_pizzas: <section className="kitchen-ticket-pizza"><header><PrintTemplatePart element={element} part="label">1 × PIZZA</PrintTemplatePart><PrintTemplatePart as="strong" element={element} part="value">HAWAIANA / PEPPERONI</PrintTemplatePart><PrintTemplatePart as="small" element={element} part="value">MEDIANA 35 CM</PrintTemplatePart></header><div className="kitchen-ticket-group"><PrintTemplatePart as="b" element={element} part="title">BASE</PrintTemplatePart><p><PrintTemplatePart element={element} part="label">Base 35 cm</PrintTemplatePart><PrintTemplatePart as="strong" element={element} part="value">1 UND</PrintTemplatePart></p></div><div className="kitchen-ticket-group"><PrintTemplatePart as="b" element={element} part="title">INGREDIENTES</PrintTemplatePart><ul className="kitchen-ticket-quantity-list">{[["Salsa Napolitana", "50 G"], ["Mozzarella", "120 G"], ["Pepperoni", "45 G"]].map(([name, quantity]) => <li key={name}><PrintTemplatePart element={element} part="label">{name}</PrintTemplatePart><PrintTemplatePart as="strong" element={element} part="value">{quantity}</PrintTemplatePart></li>)}</ul></div><div className="kitchen-ticket-notes"><PrintTemplatePart as="b" element={element} part="title">NOTAS: </PrintTemplatePart><PrintTemplatePart element={element} part="value">Sin cebolla</PrintTemplatePart></div></section>,
    kitchen_delivery: <section className="kitchen-ticket-delivery"><PrintTemplatePart as="b" element={element} part="title">PARA ENTREGAR</PrintTemplatePart><ul><li><PrintTemplatePart element={element} part="value">1 × COCA-COLA 1,5 L</PrintTemplatePart></li></ul></section>,
    kitchen_summary: <section className="kitchen-ticket-summary"><PrintTemplatePart as="b" element={element} part="title">RESUMEN OPERATIVO</PrintTemplatePart><p><PrintTemplatePart element={element} part="label">TOTAL PIZZAS</PrintTemplatePart><PrintTemplatePart as="strong" element={element} part="value">1</PrintTemplatePart></p><PrintTemplatePart as="small" element={element} part="title">BASES</PrintTemplatePart><ul className="kitchen-ticket-quantity-list"><li><PrintTemplatePart element={element} part="label">Base 35 cm</PrintTemplatePart><PrintTemplatePart as="strong" element={element} part="value">1 UND</PrintTemplatePart></li></ul></section>,
    receipt_header: <header className="customer-receipt-header"><PrintTemplatePart as="strong" element={element} part="title">MODO PIZZAS</PrintTemplatePart><PrintTemplatePart as="b" element={element} part="value">TICKET DE COMPRA</PrintTemplatePart></header>,
    receipt_order: <div className="customer-receipt-order"><PrintTemplatePart element={element} part="value">PD124 · 11/10/2026, 1:30 p. m.</PrintTemplatePart></div>,
    receipt_items: <ul className="customer-receipt-items"><li><div><PrintTemplatePart as="strong" element={element} part="label">1 × HAWAIANA MEDIANA</PrintTemplatePart><PrintTemplatePart element={element} part="value">$ 35.900 c/u</PrintTemplatePart></div><PrintTemplatePart as="b" element={element} part="value">$ 35.900</PrintTemplatePart></li><li><div><PrintTemplatePart as="strong" element={element} part="label">1 × COCA-COLA 1,5 L</PrintTemplatePart><PrintTemplatePart element={element} part="value">$ 12.000 c/u</PrintTemplatePart></div><PrintTemplatePart as="b" element={element} part="value">$ 12.000</PrintTemplatePart></li></ul>,
    receipt_totals: <section className="customer-receipt-totals"><p><PrintTemplatePart element={element} part="label">Subtotal</PrintTemplatePart><PrintTemplatePart as="strong" element={element} part="value">$ 47.900</PrintTemplatePart></p><p className="customer-receipt-total"><PrintTemplatePart element={element} part="label">TOTAL</PrintTemplatePart><PrintTemplatePart as="strong" element={element} part="value">$ 47.900</PrintTemplatePart></p></section>,
    receipt_payment: <section className="customer-receipt-payment"><p><PrintTemplatePart element={element} part="label">PAGO</PrintTemplatePart><PrintTemplatePart as="strong" element={element} part="value">Efectivo</PrintTemplatePart></p><p><PrintTemplatePart element={element} part="label">Recibido</PrintTemplatePart><PrintTemplatePart as="strong" element={element} part="value">$ 50.000</PrintTemplatePart></p><p><PrintTemplatePart element={element} part="label">Cambio</PrintTemplatePart><PrintTemplatePart as="strong" element={element} part="value">$ 2.100</PrintTemplatePart></p></section>,
    receipt_footer: <footer className="customer-receipt-footer"><PrintTemplatePart element={element} part="value">Gracias por tu compra</PrintTemplatePart></footer>
  };
  return values[field] ?? <span>{fieldLabel(kind, field)}</span>;
}

function TemplatePreview({ template, printRef }: { template: PrintTemplate; printRef?: React.Ref<HTMLElement> }) {
  const articleClass = template.kind === "kitchen" ? "kitchen-ticket thermal kitchen-ticket-58" : "customer-receipt thermal receipt-58";
  return <article className={articleClass} data-thermal-leading-blank-lines={template.leading_blank_lines} data-thermal-line-spacing={template.line_spacing} data-thermal-trailing-blank-lines={template.trailing_blank_lines} ref={printRef} style={{ lineHeight: template.line_spacing, paddingInline: `${template.margin_mm}mm` }}>
    <PrintTemplateBlankLines lines={template.leading_blank_lines} position="start" />
    {template.elements.map((element) => element.type === "field"
      ? <PrintTemplateElementFrame element={element} key={element.id}><PreviewField element={element} kind={template.kind} /></PrintTemplateElementFrame>
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
          {selected.type === "field" ? <div className="print-template-parts-panel"><p className="muted">Formato interno del bloque</p><PartFormatControls element={selected} onChange={(update) => setTemplate(updatePartStyle(template, selected.id, "title", update))} part="title" title="Título" /><PartFormatControls element={selected} onChange={(update) => setTemplate(updatePartStyle(template, selected.id, "label", update))} part="label" title="Etiqueta" /><PartFormatControls element={selected} onChange={(update) => setTemplate(updatePartStyle(template, selected.id, "value", update))} part="value" title="Valor y contenido" /></div> : null}
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
