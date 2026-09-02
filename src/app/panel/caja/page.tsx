import { notFound, redirect } from "next/navigation";
import { CashStatusModule, type CashRegisterOption, type CashSessionRow } from "@/components/cash-module";
import { PanelShell } from "@/components/panel-shell";
import { hydrateCashSession, loadCashCounts, loadCashMovements, loadFundBalances } from "@/lib/cash-data";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const cashRoles = new Set(["vendedor", "gerente", "admin_sistema"]);

type SessionRecord = Omit<CashSessionRow, "cash_register_name" | "opened_by_name"> & {
  cash_registers: { name: string } | null;
  opened_by: string | null;
};

export default async function CashStatusPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roleNames = roles?.map((role) => role.role) ?? [];
  if (!roleNames.some((role) => cashRoles.has(role))) notFound();

  const [registersResult, sessionResult, fundsResult] = await Promise.all([
    supabase.from("cash_registers").select("id, name").eq("is_active", true).order("created_at"),
    supabase
      .from("cash_sessions")
      .select("id, cash_register_id, opened_at, opened_by, opening_cash_cop, status, closed_at, expected_cash_cop, counted_cash_cop, difference_cash_cop, closing_notes, cash_registers(name)")
      .eq("status", "open")
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("custody_funds").select("id, name").eq("is_active", true).order("created_at")
  ]);
  const error = registersResult.error ?? sessionResult.error ?? fundsResult.error;
  if (error) throw new Error(error.message);

  const openSessionRecord = sessionResult.data as unknown as SessionRecord | null;
  const openSession = await hydrateCashSession(supabase, openSessionRecord);
  const movements = openSession ? await loadCashMovements(supabase, openSession.id) : [];
  const counts = openSession ? await loadCashCounts(supabase, openSession.id) : [];
  const fundBalances = await loadFundBalances(supabase, (fundsResult.data ?? []) as Array<{ id: string; name: string }>);

  return (
    <PanelShell active="caja-estado" hideHeader roleNames={roleNames} title="Caja" userEmail={user.email ?? "usuario"}>
      <CashStatusModule
        counts={counts}
        fundBalances={fundBalances}
        movements={movements}
        openSession={openSession}
        registers={(registersResult.data ?? []) as CashRegisterOption[]}
      />
    </PanelShell>
  );
}
