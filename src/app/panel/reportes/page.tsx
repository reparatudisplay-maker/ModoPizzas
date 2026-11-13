import { SalesProfitabilityDashboard, type ReportData } from "@/components/sales-profitability-dashboard";
import { PanelShell } from "@/components/panel-shell";
import { requirePanelAccess } from "@/lib/panel-auth";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ range?: string; from?: string; to?: string; compare?: string }>;

const BOGOTA_TIME_ZONE = "America/Bogota";

function bogotaDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BOGOTA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

function bogotaDayStart(date: Date) {
  const { year, month, day } = bogotaDateParts(date);
  // Colombia has a fixed UTC-5 offset, so this is midnight in America/Bogota.
  return new Date(Date.UTC(year, month - 1, day, 5));
}

function rangeFromParams(params: { range?: string; from?: string; to?: string }) {
  const now = new Date();
  const today = bogotaDayStart(now);
  const range = params.range ?? "today";
  let from = today;
  let to = new Date(today);
  to.setDate(to.getDate() + 1);
  if (range === "yesterday") {
    to = today;
    from = new Date(today);
    from.setDate(from.getDate() - 1);
  } else if (range === "week") {
    from = new Date(today);
    from.setDate(from.getDate() - 6);
  } else if (range === "month") {
    from = new Date(today.getFullYear(), today.getMonth(), 1);
    to = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  } else if (range === "previous_month") {
    from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    to = new Date(today.getFullYear(), today.getMonth(), 1);
  } else if (range === "custom" && params.from && params.to) {
    const customFrom = new Date(params.from);
    const customTo = new Date(params.to);
    if (!Number.isNaN(customFrom.getTime()) && !Number.isNaN(customTo.getTime()) && customTo > customFrom) {
      from = customFrom;
      to = customTo;
    }
  }
  return { range, from, to };
}

function bucketFor(range: string, from: Date, to: Date) {
  const days = (to.getTime() - from.getTime()) / 86_400_000;
  if (range === "today" || range === "yesterday") return "hour";
  if (days > 62) return "month";
  if (days > 21) return "week";
  return "day";
}

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const supabase = await createServerSupabaseClient();
  const { user, roleNames, moduleKeys } = await requirePanelAccess(supabase, "reportes");
  const { range, from, to } = rangeFromParams(params);
  const bucket = bucketFor(range, from, to);
  const previousFrom = new Date(from.getTime() - (to.getTime() - from.getTime()));
  const [reportResult, comparisonResult] = await Promise.all([
    supabase.rpc("get_sales_profitability_report", { p_from: from.toISOString(), p_to: to.toISOString(), p_bucket: bucket }),
    params.compare === "1" ? supabase.rpc("get_sales_profitability_report", { p_from: previousFrom.toISOString(), p_to: from.toISOString(), p_bucket: bucket }) : Promise.resolve({ data: null, error: null })
  ]);
  if (reportResult.error) throw new Error(reportResult.error.message);
  if (comparisonResult.error) throw new Error(comparisonResult.error.message);

  return (
    <PanelShell active="reportes-ventas" hideHeader moduleKeys={moduleKeys} roleNames={roleNames} title="Ventas y rentabilidad" userEmail={user.email ?? "usuario"}>
      <SalesProfitabilityDashboard
        comparison={comparisonResult.data as ReportData | null}
        from={from.toISOString()}
        range={range}
        report={reportResult.data as ReportData}
        to={to.toISOString()}
      />
    </PanelShell>
  );
}
