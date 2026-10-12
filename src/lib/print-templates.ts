export type PrintTemplateKind = "kitchen" | "receipt";
export type PrintTemplateAlignment = "left" | "center" | "right";
export type PrintTemplateFontSize = "small" | "normal" | "large";
export type PrintTemplateElementType = "field" | "text" | "separator" | "spacer";

export type PrintTemplateElement = {
  id: string;
  type: PrintTemplateElementType;
  field?: string;
  text?: string;
  visible: boolean;
  align: PrintTemplateAlignment;
  font_size: PrintTemplateFontSize;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  spacing_after: number;
};

export type PrintTemplate = {
  kind: PrintTemplateKind;
  elements: PrintTemplateElement[];
  margin_mm: number;
  line_spacing: number;
  leading_blank_lines: number;
  trailing_blank_lines: number;
};

export const kitchenFieldLabels: Record<string, string> = {
  kitchen_header: "Encabezado de comanda",
  kitchen_order: "Pedido, fecha, hora y tipo",
  kitchen_pizzas: "Pizzas, tamaños y sabores",
  kitchen_delivery: "Productos para entregar",
  kitchen_summary: "Resumen operativo"
};

export const receiptFieldLabels: Record<string, string> = {
  receipt_header: "Encabezado de ticket",
  receipt_order: "Código y fecha",
  receipt_items: "Productos, cantidades y precios",
  receipt_totals: "Subtotal, ajuste, descuento, domicilio y total",
  receipt_payment: "Método, recibido y cambio",
  receipt_footer: "Mensaje final"
};

const kitchenElements: PrintTemplateElement[] = [
  { id: "kitchen-header", type: "field", field: "kitchen_header", visible: true, align: "left", font_size: "normal", bold: true, italic: false, underline: false, spacing_after: 1 },
  { id: "kitchen-order", type: "field", field: "kitchen_order", visible: true, align: "left", font_size: "normal", bold: false, italic: false, underline: false, spacing_after: 1 },
  { id: "kitchen-pizzas", type: "field", field: "kitchen_pizzas", visible: true, align: "left", font_size: "normal", bold: false, italic: false, underline: false, spacing_after: 1 },
  { id: "kitchen-delivery", type: "field", field: "kitchen_delivery", visible: true, align: "left", font_size: "normal", bold: true, italic: false, underline: false, spacing_after: 1 },
  { id: "kitchen-summary", type: "field", field: "kitchen_summary", visible: true, align: "left", font_size: "small", bold: false, italic: false, underline: false, spacing_after: 0 }
];

const receiptElements: PrintTemplateElement[] = [
  { id: "receipt-header", type: "field", field: "receipt_header", visible: true, align: "center", font_size: "normal", bold: true, italic: false, underline: false, spacing_after: 1 },
  { id: "receipt-order", type: "field", field: "receipt_order", visible: true, align: "center", font_size: "small", bold: false, italic: false, underline: false, spacing_after: 1 },
  { id: "receipt-items", type: "field", field: "receipt_items", visible: true, align: "left", font_size: "normal", bold: false, italic: false, underline: false, spacing_after: 1 },
  { id: "receipt-totals", type: "field", field: "receipt_totals", visible: true, align: "left", font_size: "normal", bold: true, italic: false, underline: false, spacing_after: 1 },
  { id: "receipt-payment", type: "field", field: "receipt_payment", visible: true, align: "left", font_size: "normal", bold: false, italic: false, underline: false, spacing_after: 1 },
  { id: "receipt-footer", type: "field", field: "receipt_footer", visible: true, align: "center", font_size: "small", bold: false, italic: false, underline: false, spacing_after: 0 }
];

function cloneElements(elements: PrintTemplateElement[]) {
  return elements.map((element) => ({ ...element }));
}

export function defaultPrintTemplate(kind: PrintTemplateKind): PrintTemplate {
  return {
    kind,
    elements: cloneElements(kind === "kitchen" ? kitchenElements : receiptElements),
    margin_mm: 0,
    line_spacing: 1,
    leading_blank_lines: 0,
    trailing_blank_lines: 3
  };
}

function isElement(value: unknown): value is PrintTemplateElement {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string"
    && ["field", "text", "separator", "spacer"].includes(String(item.type))
    && typeof item.visible === "boolean";
}

function normalizeElement(value: PrintTemplateElement): PrintTemplateElement {
  return {
    id: value.id.slice(0, 80),
    type: value.type,
    field: typeof value.field === "string" ? value.field.slice(0, 80) : undefined,
    text: typeof value.text === "string" ? value.text.slice(0, 240) : undefined,
    visible: value.visible,
    align: value.align === "center" || value.align === "right" ? value.align : "left",
    font_size: value.font_size === "small" || value.font_size === "large" ? value.font_size : "normal",
    bold: Boolean(value.bold),
    italic: Boolean(value.italic),
    underline: Boolean(value.underline),
    spacing_after: Math.max(0, Math.min(8, Math.round(Number(value.spacing_after) || 0)))
  };
}

export function normalizePrintTemplate(kind: PrintTemplateKind, value: Partial<PrintTemplate> | null | undefined): PrintTemplate {
  const fallback = defaultPrintTemplate(kind);
  const elements = Array.isArray(value?.elements) && value.elements.every(isElement)
    ? value.elements.map(normalizeElement)
    : fallback.elements;
  return {
    kind,
    elements: elements.length > 0 ? elements : fallback.elements,
    margin_mm: Math.max(0, Math.min(4, Number(value?.margin_mm) || 0)),
    line_spacing: Math.max(1, Math.min(3, Math.round(Number(value?.line_spacing) || 1))),
    leading_blank_lines: Math.max(0, Math.min(20, Math.round(Number(value?.leading_blank_lines) || 0))),
    trailing_blank_lines: Math.max(0, Math.min(20, Math.round(Number(value?.trailing_blank_lines) || 0)))
  };
}

export function fieldLabel(kind: PrintTemplateKind, field: string | undefined) {
  return (kind === "kitchen" ? kitchenFieldLabels : receiptFieldLabels)[field ?? ""] ?? "Elemento";
}

export function protectedTemplateField(kind: PrintTemplateKind, field: string | undefined) {
  return (kind === "kitchen" && field === "kitchen_order")
    || (kind === "receipt" && (field === "receipt_order" || field === "receipt_totals"));
}
