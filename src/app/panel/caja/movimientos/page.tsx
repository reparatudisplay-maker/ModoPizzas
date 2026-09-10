import { CashMovementsModule } from "@/components/cash-module";
import { PanelShell } from "@/components/panel-shell";
import { loadCashMovements } from "@/lib/cash-data";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePanelAccess } from "@/lib/panel-auth";

export const dynamic = "force-dynamic";


export default async function CashMovementsPage() {
  const supabase = await createServerSupabaseClient();
  const { user, roleNames, moduleKeys } = await requirePanelAccess(supabase, "caja");

  const { data: openSession, error } = await supabase.from("cash_sessions").select("id").eq("status", "open").order("opened_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  const movements = openSession ? await loadCashMovements(supabase, openSession.id) : [];

  return (
    <PanelShell active="caja-movimientos" hideHeader moduleKeys={moduleKeys} roleNames={roleNames} title="Movimientos de caja" userEmail={user.email ?? "usuario"}>
      <CashMovementsModule movements={movements} />
    </PanelShell>
  );
}
