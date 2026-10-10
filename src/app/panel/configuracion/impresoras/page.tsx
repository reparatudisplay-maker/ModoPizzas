import { PrinterSettingsModule } from "@/components/printer-settings-module";
import { PanelShell } from "@/components/panel-shell";
import { requirePanelAccess } from "@/lib/panel-auth";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export default async function PrinterSettingsPage() {
  const supabase = await createServerSupabaseClient();
  const { user, roleNames, moduleKeys } = await requirePanelAccess(supabase, "configuracion");
  const { data, error } = await supabase
    .from("printer_settings")
    .select("ip_address, port, model, paper_width_mm, printable_width_mm, preferred_print_method")
    .eq("id", true)
    .single();

  if (error || !data) throw new Error(error?.message ?? "No se encontró la configuración de impresora.");
  return (
    <PanelShell active="configuracion-impresoras" hideHeader moduleKeys={moduleKeys} roleNames={roleNames} title="Impresoras" userEmail={user.email ?? "usuario"}>
      <PrinterSettingsModule settings={{
        ip_address: String(data.ip_address).replace(/\/\d+$/, ""),
        port: Number(data.port),
        model: String(data.model),
        paper_width_mm: Number(data.paper_width_mm),
        printable_width_mm: Number(data.printable_width_mm),
        preferred_print_method: data.preferred_print_method === "browser" || data.preferred_print_method === "ipad_shortcut" ? data.preferred_print_method : "auto"
      }} />
    </PanelShell>
  );
}
