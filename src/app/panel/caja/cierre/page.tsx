import { notFound, redirect } from "next/navigation";
import { CashClosingModule, type CashSessionRow, type ShiftSaleRow } from "@/components/cash-module";
import { PanelShell } from "@/components/panel-shell";
import { hydrateCashSession, loadCashMovements } from "@/lib/cash-data";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const cashRoles = new Set(["vendedor", "gerente", "admin_sistema"]);

type SessionRecord = Omit<CashSessionRow, "cash_register_name" | "opened_by_name"> & {
  cash_registers: { name: string } | null;
  opened_by: string | null;
};

export default async function CashClosingPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roleNames = roles?.map((role) => role.role) ?? [];
  if (!roleNames.some((role) => cashRoles.has(role))) notFound();

  const [openSessionResult, closedSessionsResult] = await Promise.all([
    supabase
      .from("cash_sessions")
      .select("id, cash_register_id, opened_at, opened_by, opening_cash_cop, status, closed_at, expected_cash_cop, counted_cash_cop, difference_cash_cop, closing_notes, cash_registers(name)")
      .eq("status", "open")
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("cash_sessions")
      .select("id, cash_register_id, opened_at, opened_by, opening_cash_cop, status, closed_at, expected_cash_cop, counted_cash_cop, difference_cash_cop, closing_notes, cash_registers(name)")
      .eq("status", "closed")
      .order("closed_at", { ascending: false })
      .limit(20)
  ]);
  const error = openSessionResult.error ?? closedSessionsResult.error;
  if (error) throw new Error(error.message);

  const openSession = await hydrateCashSession(supabase, openSessionResult.data as unknown as SessionRecord | null);
  const movements = openSession ? await loadCashMovements(supabase, openSession.id) : [];
  const sales = openSession ? await loadShiftSales(supabase, openSession.opened_at) : [];
  const closedSessions = await Promise.all(((closedSessionsResult.data ?? []) as unknown as SessionRecord[]).map((session) => hydrateCashSession(supabase, session)));

  return (
    <PanelShell active="caja-cierre" hideHeader roleNames={roleNames} title="Cierre de caja" userEmail={user.email ?? "usuario"}>
      <CashClosingModule closedSessions={closedSessions.filter((session): session is CashSessionRow => Boolean(session))} movements={movements} openSession={openSession} sales={sales} />
    </PanelShell>
  );
}

async function loadShiftSales(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>, openedAt: string): Promise<ShiftSaleRow[]> {
  const { data, error } = await supabase
    .from("pos_orders")
    .select("id, code, kind, payment_method, total_cop, created_at")
    .gte("created_at", openedAt)
    .neq("status", "cancelled")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as ShiftSaleRow[]).map((sale) => ({
    id: sale.id,
    code: sale.code,
    kind: sale.kind,
    payment_method: sale.payment_method,
    total_cop: Number(sale.total_cop ?? 0),
    created_at: sale.created_at
  }));
}
