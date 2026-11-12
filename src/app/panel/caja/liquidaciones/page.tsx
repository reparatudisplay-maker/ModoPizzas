import { PlatformSettlementsModule, type PlatformReceivableRow, type PlatformServicePayableRow } from "@/components/platform-settlements-module";
import { PanelShell } from "@/components/panel-shell";
import { requirePanelAccess } from "@/lib/panel-auth";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export default async function PlatformSettlementsPage() {
  const supabase = await createServerSupabaseClient();
  const { user, roleNames, moduleKeys } = await requirePanelAccess(supabase, "caja");
  const receivablesResult = await supabase.from("platform_receivables").select("id, platform, gross_cop, estimated_commission_cop, net_expected_cop, due_at, status, pos_orders(code), platform_settlement_allocations(gross_cop, net_cop)").order("due_at");
  if (receivablesResult.error) throw new Error(receivablesResult.error.message);
  const receivables = (receivablesResult.data ?? []).map((row) => {
    const allocations = (row.platform_settlement_allocations as { gross_cop: number | string; net_cop: number | string }[] | null) ?? [];
    return { ...row, gross_cop: Number(row.gross_cop), estimated_commission_cop: Number(row.estimated_commission_cop), net_expected_cop: Number(row.net_expected_cop), settled_gross_cop: allocations.reduce((sum, allocation) => sum + Number(allocation.gross_cop), 0), settled_net_cop: allocations.reduce((sum, allocation) => sum + Number(allocation.net_cop), 0), order_code: (row.pos_orders as { code?: string } | null)?.code ?? "—" };
  }) as PlatformReceivableRow[];
  const servicePayablesResult = await supabase.from("platform_service_payables").select("id, order_total_cop, estimated_charge_cop, due_at, status, pos_orders(code)").order("due_at");
  if (servicePayablesResult.error && !["PGRST205", "42P01"].includes(servicePayablesResult.error.code)) throw new Error(servicePayablesResult.error.message);
  const servicePayables = servicePayablesResult.error ? [] : (servicePayablesResult.data ?? []).map((row) => ({
    ...row,
    order_total_cop: Number(row.order_total_cop),
    estimated_charge_cop: Number(row.estimated_charge_cop),
    order_code: (row.pos_orders as { code?: string } | null)?.code ?? "—"
  })) as PlatformServicePayableRow[];
  return <PanelShell active="caja-liquidaciones" hideHeader moduleKeys={moduleKeys} roleNames={roleNames} title="Liquidaciones" userEmail={user.email ?? "usuario"}><PlatformSettlementsModule receivables={receivables} servicePayables={servicePayables} /></PanelShell>;
}
