import { PlatformSettlementsModule, type PlatformReceivableRow } from "@/components/platform-settlements-module";
import { PanelShell } from "@/components/panel-shell";
import { requirePanelAccess } from "@/lib/panel-auth";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export default async function PlatformSettlementsPage() {
  const supabase = await createServerSupabaseClient();
  const { user, roleNames, moduleKeys } = await requirePanelAccess(supabase, "caja");
  const [settingsResult, receivablesResult] = await Promise.all([
    supabase.from("platform_payment_settings").select("*").order("platform"),
    supabase.from("platform_receivables").select("id, platform, gross_cop, estimated_commission_cop, net_expected_cop, due_at, status, pos_orders(code), platform_settlement_allocations(gross_cop, net_cop)").order("due_at")
  ]);
  if (settingsResult.error ?? receivablesResult.error) throw new Error((settingsResult.error ?? receivablesResult.error)?.message);
  const receivables = (receivablesResult.data ?? []).map((row) => {
    const allocations = (row.platform_settlement_allocations as { gross_cop: number | string; net_cop: number | string }[] | null) ?? [];
    return { ...row, gross_cop: Number(row.gross_cop), estimated_commission_cop: Number(row.estimated_commission_cop), net_expected_cop: Number(row.net_expected_cop), settled_gross_cop: allocations.reduce((sum, allocation) => sum + Number(allocation.gross_cop), 0), settled_net_cop: allocations.reduce((sum, allocation) => sum + Number(allocation.net_cop), 0), order_code: (row.pos_orders as { code?: string } | null)?.code ?? "—" };
  }) as PlatformReceivableRow[];
  return <PanelShell active="caja-liquidaciones" hideHeader moduleKeys={moduleKeys} roleNames={roleNames} title="Liquidaciones" userEmail={user.email ?? "usuario"}><PlatformSettlementsModule settings={(settingsResult.data ?? []).map((row) => ({ ...row, commission_percent: Number(row.commission_percent), fixed_fee_cop: Number(row.fixed_fee_cop), commission_tax_percent: Number(row.commission_tax_percent ?? 0) })) as never} receivables={receivables} /></PanelShell>;
}
