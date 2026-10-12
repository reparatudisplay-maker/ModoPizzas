import { PrintTemplateEditor } from "@/components/print-template-editor";
import { PanelShell } from "@/components/panel-shell";
import { normalizePrintTemplate } from "@/lib/print-templates";
import { requirePanelAccess } from "@/lib/panel-auth";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export default async function PrintTemplatesPage() {
  const supabase = await createServerSupabaseClient();
  const { user, roleNames, moduleKeys } = await requirePanelAccess(supabase, "configuracion");
  const { data, error } = await supabase
    .from("print_templates")
    .select("kind, elements, margin_mm, line_spacing, leading_blank_lines, trailing_blank_lines")
    .in("kind", ["kitchen", "receipt"]);

  if (error) throw new Error(error.message);
  const rows = new Map((data ?? []).map((row) => [row.kind, row]));
  const readTemplate = (kind: "kitchen" | "receipt") => {
    const row = rows.get(kind);
    return normalizePrintTemplate(kind, {
      elements: Array.isArray(row?.elements) ? row.elements : undefined,
      margin_mm: row?.margin_mm,
      line_spacing: row?.line_spacing,
      leading_blank_lines: row?.leading_blank_lines,
      trailing_blank_lines: row?.trailing_blank_lines
    });
  };

  return <PanelShell active="configuracion-plantillas-impresion" hideHeader moduleKeys={moduleKeys} roleNames={roleNames} title="Plantillas de impresión" userEmail={user.email ?? "usuario"}>
    <PrintTemplateEditor templates={{ kitchen: readTemplate("kitchen"), receipt: readTemplate("receipt") }} />
  </PanelShell>;
}
