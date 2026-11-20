import { CashClosingModule, CashStatusModule, type CashRegisterOption, type CashSessionRow } from "@/components/cash-module";
import { PanelShell } from "@/components/panel-shell";
import { hydrateCashSession, loadCashCounts, loadCashMovements, loadFundBalances, loadShiftPlatformReceivables, loadShiftSales } from "@/lib/cash-data";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePanelAccess } from "@/lib/panel-auth";

export const dynamic = "force-dynamic";


type SessionRecord = Omit<CashSessionRow, "cash_register_name" | "opened_by_name"> & {
  cash_registers: { name: string } | null;
  opened_by: string | null;
};

export default async function CashStatusPage() {
  const supabase = await createServerSupabaseClient();
  const { user, roleNames, moduleKeys } = await requirePanelAccess(supabase, "caja");

  const [registersResult, sessionResult, fundsResult, closedSessionsResult] = await Promise.all([
    supabase.from("cash_registers").select("id, name").eq("is_active", true).order("created_at"),
    supabase
      .from("cash_sessions")
      .select("id, cash_register_id, opened_at, opened_by, opening_cash_cop, status, closed_at, expected_cash_cop, counted_cash_cop, difference_cash_cop, closing_notes, cash_registers(name)")
      .eq("status", "open")
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("custody_funds").select("id, name").eq("is_active", true).order("created_at"),
    supabase
      .from("cash_sessions")
      .select("id, cash_register_id, opened_at, opened_by, opening_cash_cop, status, closed_at, expected_cash_cop, counted_cash_cop, difference_cash_cop, closing_notes, cash_registers(name)")
      .eq("status", "closed")
      .order("closed_at", { ascending: false })
      .limit(20)
  ]);
  const error = registersResult.error ?? sessionResult.error ?? fundsResult.error ?? closedSessionsResult.error;
  if (error) throw new Error(error.message);

  const openSessionRecord = sessionResult.data as unknown as SessionRecord | null;
  const openSession = await hydrateCashSession(supabase, openSessionRecord);
  const [movements, counts, fundBalances, sales, platformReceivables, closedSessions] = await Promise.all([
    openSession ? loadCashMovements(supabase, openSession.id) : Promise.resolve([]),
    openSession ? loadCashCounts(supabase, openSession.id) : Promise.resolve([]),
    loadFundBalances(supabase, (fundsResult.data ?? []) as Array<{ id: string; name: string }>),
    openSession ? loadShiftSales(supabase, openSession.opened_at) : Promise.resolve([]),
    openSession ? loadShiftPlatformReceivables(supabase, openSession.opened_at) : Promise.resolve([]),
    Promise.all(((closedSessionsResult.data ?? []) as unknown as SessionRecord[]).map((session) => hydrateCashSession(supabase, session)))
  ]);

  return (
    <PanelShell active="caja-estado" hideHeader moduleKeys={moduleKeys} roleNames={roleNames} title="Caja" userEmail={user.email ?? "usuario"}>
      <div className="cash-module-stack">
        <CashStatusModule
          counts={counts}
          fundBalances={fundBalances}
          movements={movements}
          openSession={openSession}
          registers={(registersResult.data ?? []) as CashRegisterOption[]}
        />
        <div id="cierre">
        <CashClosingModule
          closedSessions={closedSessions.filter((session): session is CashSessionRow => Boolean(session))}
          movements={movements}
          openSession={openSession}
          platformReceivables={platformReceivables}
          sales={sales}
        />
        </div>
      </div>
    </PanelShell>
  );
}
