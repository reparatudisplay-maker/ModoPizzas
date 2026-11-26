import { type CashCountRow, type CashMovementRow, type CashSessionRow, type FundBalanceRow, type PlatformShiftReceivableRow, type ShiftSaleRow } from "@/components/cash-module";
import { createServerSupabaseClient } from "@/lib/supabase-server";

type SupabaseServerClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

type SessionRecord = Omit<CashSessionRow, "cash_register_name" | "opened_by_name"> & {
  cash_registers: { name: string } | null;
  opened_by: string | null;
};

type MovementRecord = Omit<CashMovementRow, "order_code" | "order_kind" | "expense_description"> & {
  pos_orders: { code: string; kind: string } | null;
  expenses: { description: string } | null;
};

export async function hydrateCashSession(supabase: SupabaseServerClient, session: SessionRecord | null): Promise<CashSessionRow | null> {
  if (!session) return null;
  const { data: profile } = session.opened_by ? await supabase.from("profiles").select("full_name, email").eq("id", session.opened_by).maybeSingle() : { data: null };
  return {
    id: session.id,
    cash_register_id: session.cash_register_id,
    cash_register_name: session.cash_registers?.name ?? "Caja",
    opened_at: session.opened_at,
    opened_by_name: profile?.full_name || profile?.email || "Usuario",
    opening_cash_cop: Number(session.opening_cash_cop ?? 0),
    status: session.status,
    closed_at: session.closed_at,
    expected_cash_cop: session.expected_cash_cop === null ? null : Number(session.expected_cash_cop),
    counted_cash_cop: session.counted_cash_cop === null ? null : Number(session.counted_cash_cop),
    difference_cash_cop: session.difference_cash_cop === null ? null : Number(session.difference_cash_cop),
    closing_notes: session.closing_notes
  };
}

export async function loadCashMovements(supabase: SupabaseServerClient, sessionId: string): Promise<CashMovementRow[]> {
  const { data, error } = await supabase
    .from("cash_movements")
    .select("id, cash_session_id, movement_kind, direction, source_kind, destination, amount_cop, occurred_at, reason, pos_orders(code, kind), expenses!cash_movements_expense_id_fkey(description)")
    .eq("cash_session_id", sessionId)
    .order("occurred_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as MovementRecord[]).map((movement) => ({
    id: movement.id,
    cash_session_id: movement.cash_session_id,
    movement_kind: movement.movement_kind,
    direction: movement.direction,
    source_kind: movement.source_kind,
    destination: movement.destination,
    amount_cop: Number(movement.amount_cop ?? 0),
    occurred_at: movement.occurred_at,
    reason: movement.reason,
    order_code: movement.pos_orders?.code ?? null,
    order_kind: movement.pos_orders?.kind ?? null,
    expense_description: movement.expenses?.description ?? null
  }));
}

export async function loadCashCounts(supabase: SupabaseServerClient, sessionId: string): Promise<CashCountRow[]> {
  const { data, error } = await supabase
    .from("cash_counts")
    .select("id, cash_session_id, theoretical_cash_cop, counted_cash_cop, difference_cash_cop, notes, counted_at")
    .eq("cash_session_id", sessionId)
    .order("counted_at", { ascending: false })
    .limit(5);
  if (error) throw new Error(error.message);
  return ((data ?? []) as CashCountRow[]).map((count) => ({
    ...count,
    theoretical_cash_cop: Number(count.theoretical_cash_cop ?? 0),
    counted_cash_cop: Number(count.counted_cash_cop ?? 0),
    difference_cash_cop: Number(count.difference_cash_cop ?? 0)
  }));
}

export async function loadFundBalances(supabase: SupabaseServerClient, funds: Array<{ id: string; name: string }>): Promise<FundBalanceRow[]> {
  return Promise.all(
    funds.map(async (fund) => {
      const { data } = await supabase.rpc("custody_fund_balance", { p_custody_fund_id: fund.id });
      return { id: fund.id, name: fund.name, balance_cop: Number(data ?? 0) };
    })
  );
}

export async function loadShiftSales(supabase: SupabaseServerClient, openedAt: string): Promise<ShiftSaleRow[]> {
  const { data, error } = await supabase
    .from("pos_orders")
    .select("id, code, kind, payment_method, total_cop, created_at, pos_order_items(id, quantity, product_name_snapshot, unit_price_cop, line_subtotal_cop)")
    .gte("created_at", openedAt)
    .neq("status", "cancelled")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<ShiftSaleRow & { pos_order_items?: ShiftSaleRow["items"] }>).map((sale) => ({
    id: sale.id,
    code: sale.code,
    kind: sale.kind,
    payment_method: sale.payment_method,
    total_cop: Number(sale.total_cop ?? 0),
    created_at: sale.created_at,
    items: (sale.pos_order_items ?? []).map((item) => ({
      id: item.id,
      quantity: Number(item.quantity ?? 0),
      product_name_snapshot: item.product_name_snapshot,
      unit_price_cop: Number(item.unit_price_cop ?? 0),
      line_subtotal_cop: Number(item.line_subtotal_cop ?? 0)
    }))
  }));
}

export async function loadShiftPlatformReceivables(supabase: SupabaseServerClient, openedAt: string): Promise<PlatformShiftReceivableRow[]> {
  const { data, error } = await supabase
    .from("platform_receivables")
    .select("id, platform, gross_cop, estimated_commission_cop, net_expected_cop, status, pos_orders!inner(created_at), platform_settlement_allocations(net_cop)")
    .gte("pos_orders.created_at", openedAt);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    platform: row.platform as "rappi" | "didi",
    gross_cop: Number(row.gross_cop),
    estimated_commission_cop: Number(row.estimated_commission_cop),
    net_expected_cop: Number(row.net_expected_cop),
    settled_net_cop: ((row.platform_settlement_allocations as { net_cop: number | string }[] | null) ?? []).reduce((sum, allocation) => sum + Number(allocation.net_cop), 0),
    status: row.status
  }));
}
