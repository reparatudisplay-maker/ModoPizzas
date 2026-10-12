import type { ReactNode } from "react";
import type { PrintTemplateElement } from "@/lib/print-templates";

export function PrintTemplateElementFrame({ children, element }: { children: ReactNode; element: PrintTemplateElement }) {
  if (!element.visible) return null;
  return (
    <div
      className="print-template-element"
      data-print-align={element.align}
      data-print-bold={element.bold ? "true" : "false"}
      data-print-font-size={element.font_size}
      data-print-spacing-after={element.spacing_after}
      data-print-underline={element.underline ? "true" : "false"}
      style={{
        fontStyle: element.italic ? "italic" : "normal",
        fontWeight: element.bold ? 700 : undefined,
        marginBottom: `${element.spacing_after * 0.35}em`,
        textAlign: element.align,
        textDecoration: element.underline ? "underline" : undefined
      }}
    >
      {children}
    </div>
  );
}

export function PrintTemplateCustomElement({ element }: { element: PrintTemplateElement }) {
  if (!element.visible) return null;
  if (element.type === "separator") return <PrintTemplateElementFrame element={element}><div className="print-template-separator" /></PrintTemplateElementFrame>;
  if (element.type === "spacer") return <PrintTemplateElementFrame element={element}><div style={{ height: `${Math.max(1, element.spacing_after || 1) * 0.7}em` }} /></PrintTemplateElementFrame>;
  if (element.type === "text") return <PrintTemplateElementFrame element={element}><span>{element.text || "Texto personalizado"}</span></PrintTemplateElementFrame>;
  return null;
}

export function PrintTemplateBlankLines({ lines, position }: { lines: number; position: "start" | "end" }) {
  if (lines <= 0) return null;
  return <div aria-hidden="true" className="print-template-blank-lines" data-print-blank-lines={lines} data-print-blank-position={position} style={{ height: `${lines * 1.18}em` }} />;
}
