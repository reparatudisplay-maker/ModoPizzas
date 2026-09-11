"use client";

import { useMemo, useState } from "react";
import { BarChart3, ChevronRight, CircleDollarSign, Package, Pizza, ReceiptText, TrendingDown, TrendingUp, Users, X } from "lucide-react";
import { formatCop } from "@/lib/format";

type Summary = { sales_cop: number; cost_cop: number; gross_profit_cop: number; expenses_cop: number; operating_result_cop: number; gross_margin_pct: number | null; operating_margin_pct: number | null; orders: number; average_ticket_cop: number; cancelled_orders: number; cancelled_amount_cop: number };
type MetricRow = { name: string; units: number; sales_cop: number; cost_cop: number; profit_cop: number; margin_pct: number | null };
type ReportRow = { label?: string; sales_cop?: number; cost_cop?: number; gross_profit_cop?: number; orders?: number; hour?: number; profit_cop?: number; category?: string; amount_cop?: number; count?: number; kind?: string; ticket_cop?: number; method?: string };
export type ReportData = { summary: Summary; series: ReportRow[]; pizzas: MetricRow[]; products: MetricRow[]; additions: MetricRow[]; expenses: ReportRow[]; types: ReportRow[]; payments: ReportRow[]; users: Array<{ name: string; orders: number; sales_cop: number; cost_cop: number; profit_cop: number; ticket_cop: number }>; hours: ReportRow[]; cancellations: Array<{ code: string; amount_cop: number; reason: string | null; cancelled_at: string; user: string }> };

const tabs = ["Resumen", "Pizzas", "Productos", "Gastos", "Horarios", "Usuarios"] as const;
type Tab = (typeof tabs)[number];

function pct(value: number | null | undefined) { return value === null || value === undefined ? "—" : `${value.toLocaleString("es-CO", { maximumFractionDigits: 1 })}%`; }
function number(value: number | null | undefined) { return Number(value ?? 0).toLocaleString("es-CO", { maximumFractionDigits: 1 }); }
function kindLabel(kind?: string) { return kind === "local" ? "Consumo local" : kind === "pickup" ? "Recoger" : kind === "delivery" ? "Domicilio" : kind ?? "—"; }
function paymentLabel(method?: string) { return ({ cash: "Efectivo", transfer: "Transferencia", mixed: "Mixto", pending: "Pendiente" } as Record<string, string>)[method ?? ""] ?? method ?? "—"; }
function localDateInput(value: string) { return new Date(value).toISOString().slice(0, 16); }

export function SalesProfitabilityDashboard({ report, comparison, range, from, to }: { report: ReportData; comparison: ReportData | null; range: string; from: string; to: string }) {
  const [tab, setTab] = useState<Tab>("Resumen");
  const [metric, setMetric] = useState<"sales_cop" | "gross_profit_cop" | "orders">("sales_cop");
  const [detail, setDetail] = useState<MetricRow | null>(null);
  const summary = report.summary;
  const highest = Math.max(1, ...report.series.map((point) => Number(point[metric] ?? 0)));
  const comparisonChange = comparison && comparison.summary.sales_cop > 0 ? ((summary.sales_cop - comparison.summary.sales_cop) * 100) / comparison.summary.sales_cop : null;
  const opportunities = useMemo(() => {
    const notes: string[] = [];
    const best = [...report.pizzas, ...report.products].sort((a, b) => b.profit_cop - a.profit_cop)[0];
    if (best?.profit_cop > 0) notes.push(`${best.name} genera la mayor utilidad del periodo.`);
    const lowMargin = [...report.pizzas, ...report.products].filter((row) => row.margin_pct !== null).sort((a, b) => (a.margin_pct ?? 0) - (b.margin_pct ?? 0))[0];
    if (lowMargin && summary.gross_margin_pct !== null && (lowMargin.margin_pct ?? 0) + 5 < summary.gross_margin_pct) notes.push(`${lowMargin.name} tiene margen por debajo del promedio.`);
    if (summary.sales_cop > 0 && summary.expenses_cop / summary.sales_cop >= 0.15) notes.push(`Los gastos representan ${pct(summary.expenses_cop * 100 / summary.sales_cop)} de las ventas.`);
    if (comparisonChange !== null && Math.abs(comparisonChange) >= 5) notes.push(`Las ventas ${comparisonChange > 0 ? "aumentaron" : "disminuyeron"} ${pct(Math.abs(comparisonChange))} frente al periodo anterior.`);
    return notes;
  }, [comparisonChange, report.pizzas, report.products, summary.expenses_cop, summary.gross_margin_pct, summary.sales_cop]);

  return <section className="reports-dashboard">
    <form className="report-filters" action="/panel/reportes">
      <select defaultValue={range} name="range" onChange={(event) => event.currentTarget.form?.requestSubmit()} aria-label="Periodo">
        <option value="today">Hoy</option><option value="yesterday">Ayer</option><option value="week">Esta semana</option><option value="month">Este mes</option><option value="previous_month">Mes anterior</option><option value="custom">Personalizado</option>
      </select>
      <label>Desde<input defaultValue={localDateInput(from)} name="from" type="datetime-local" /></label>
      <label>Hasta<input defaultValue={localDateInput(to)} name="to" type="datetime-local" /></label>
      <label className="report-compare"><input defaultChecked={Boolean(comparison)} name="compare" type="checkbox" value="1" /> Comparar período anterior</label>
      <button className="secondary-button" type="submit">Actualizar</button>
    </form>
    <div className="report-tabs" role="tablist">{tabs.map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)} role="tab" type="button">{item}</button>)}</div>
    {tab === "Resumen" ? <>
      <div className="report-kpis">
        <Kpi icon={CircleDollarSign} label="Resultado operativo" value={formatCop(summary.operating_result_cop)} positive priority />
        <Kpi icon={TrendingUp} label="Ventas" value={formatCop(summary.sales_cop)} change={comparisonChange} />
        <Kpi icon={BarChart3} label="Utilidad bruta" value={formatCop(summary.gross_profit_cop)} />
        <Kpi icon={TrendingDown} label="Gastos" value={formatCop(summary.expenses_cop)} />
        <Kpi label="Margen bruto" value={pct(summary.gross_margin_pct)} />
        <Kpi label="Margen operativo" value={pct(summary.operating_margin_pct)} />
        <Kpi label="Pedidos" value={number(summary.orders)} />
        <Kpi label="Ticket promedio" value={formatCop(summary.average_ticket_cop)} />
      </div>
      <div className="report-grid summary-grid">
        <section className="report-card report-chart"><div className="report-card-title"><div><h2>Comportamiento del período</h2><p>Costos históricos congelados por venta.</p></div><select onChange={(event) => setMetric(event.target.value as typeof metric)} value={metric}><option value="sales_cop">Ventas</option><option value="gross_profit_cop">Utilidad</option><option value="orders">Pedidos</option></select></div>
          <div className="report-bars">{report.series.length ? report.series.map((point) => <div className="report-bar" key={point.label}><span title={String(point[metric] ?? 0)} style={{ height: `${Math.max(4, Number(point[metric] ?? 0) * 100 / highest)}%` }} /><small>{point.label}</small></div>) : <Empty />}</div>
        </section>
        <section className="report-card"><h2>Oportunidades</h2>{opportunities.length ? <ul className="report-insights">{opportunities.map((note) => <li key={note}><ChevronRight size={16} />{note}</li>)}</ul> : <Empty text="Aún no hay suficientes datos en este período." />}</section>
        <section className="report-card"><h2>Ventas por tipo</h2><Breakdown rows={report.types} label={(row) => kindLabel(row.kind)} /></section>
        <section className="report-card"><h2>Pagos</h2><Breakdown rows={report.payments} label={(row) => paymentLabel(row.method)} /></section>
      </div>
      <section className="report-card management-indicators"><h2>Indicadores de gestión</h2><div><span>Costo de ventas / ventas<strong>{pct(summary.sales_cop ? summary.cost_cop * 100 / summary.sales_cop : null)}</strong></span><span>Gastos / ventas<strong>{pct(summary.sales_cop ? summary.expenses_cop * 100 / summary.sales_cop : null)}</strong></span><span>Cancelaciones<strong>{number(summary.cancelled_orders)}</strong></span><span>Ventas pendientes<strong>{formatCop((report.payments.find((row) => row.method === "pending")?.amount_cop ?? 0) as number)}</strong></span><span>Utilidad por pedido<strong>{formatCop(summary.orders ? summary.gross_profit_cop / summary.orders : 0)}</strong></span></div></section>
    </> : null}
    {tab === "Pizzas" ? <Ranking title="Rentabilidad de pizzas" rows={report.pizzas} onDetail={setDetail} icon={Pizza} /> : null}
    {tab === "Productos" ? <><Ranking title="Productos para venta" rows={report.products} onDetail={setDetail} icon={Package} /><Ranking title="Adiciones" rows={report.additions} onDetail={setDetail} icon={ReceiptText} compact /></> : null}
    {tab === "Gastos" ? <section className="report-grid"><section className="report-card"><h2>Gastos por categoría</h2><Breakdown rows={report.expenses} label={(row) => row.category ?? "Sin categoría"} /></section><section className="report-card"><h2>Resultado del período</h2><div className="report-statement"><span>Ventas<strong>{formatCop(summary.sales_cop)}</strong></span><span>Costo de ventas<strong>-{formatCop(summary.cost_cop)}</strong></span><span>Utilidad bruta<strong>{formatCop(summary.gross_profit_cop)}</strong></span><span>Gastos<strong>-{formatCop(summary.expenses_cop)}</strong></span><span className="result">Resultado operativo<strong>{formatCop(summary.operating_result_cop)}</strong></span></div></section></section> : null}
    {tab === "Horarios" ? <section className="report-card"><h2>Ventas por hora</h2><div className="hour-grid">{Array.from({ length: 24 }, (_, hour) => { const row = report.hours.find((item) => item.hour === hour); return <div className={row?.sales_cop ? "active" : ""} key={hour}><small>{hour}:00</small><strong>{row?.sales_cop ? formatCop(row.sales_cop) : "—"}</strong><span>{number(row?.orders)} pedidos</span></div>; })}</div></section> : null}
    {tab === "Usuarios" ? <><Ranking title="Usuarios / cajeros" rows={report.users.map((user) => ({ ...user, margin_pct: user.sales_cop ? user.profit_cop * 100 / user.sales_cop : null, units: user.orders }))} onDetail={setDetail} icon={Users} /><section className="report-card"><h2>Cancelaciones</h2>{report.cancellations.length ? <div className="report-list">{report.cancellations.map((row) => <span key={row.code}><strong>{row.code}</strong><em>{row.user}</em><small>{row.reason ?? "Sin motivo"}</small><b>{formatCop(row.amount_cop)}</b></span>)}</div> : <Empty text="No hubo pedidos cancelados." />}</section></> : null}
    {detail ? <MetricDetailModal row={detail} onClose={() => setDetail(null)} /> : null}
  </section>;
}

function Kpi({ label, value, icon: Icon, positive, priority, change }: { label: string; value: string; icon?: typeof TrendingUp; positive?: boolean; priority?: boolean; change?: number | null }) { return <article className={["report-kpi", positive ? "positive" : "", priority ? "priority" : ""].join(" ")}>{Icon ? <Icon size={20} /> : null}<span>{label}</span><strong>{value}</strong>{change !== null && change !== undefined ? <small className={change >= 0 ? "up" : "down"}>{change >= 0 ? "+" : ""}{pct(change)} vs. anterior</small> : null}</article>; }
function Empty({ text = "Sin datos para este período." }: { text?: string }) { return <p className="report-empty">{text}</p>; }
function Breakdown({ rows, label }: { rows: ReportRow[]; label: (row: ReportRow) => string }) { const total = Math.max(1, rows.reduce((sum, row) => sum + Number(row.amount_cop ?? row.sales_cop ?? 0), 0)); return rows.length ? <div className="report-breakdown">{rows.map((row, index) => { const amount = Number(row.amount_cop ?? row.sales_cop ?? 0); return <div key={`${label(row)}-${index}`}><span>{label(row)}<small>{row.count ?? row.orders ?? 0} registros</small></span><strong>{formatCop(amount)}</strong><i><b style={{ width: `${amount * 100 / total}%` }} /></i></div>; })}</div> : <Empty />; }
function Ranking({ title, rows, onDetail, icon: Icon, compact = false }: { title: string; rows: MetricRow[]; onDetail: (row: MetricRow) => void; icon: typeof Pizza; compact?: boolean }) { return <section className={["report-card", "report-ranking", compact ? "compact" : ""].join(" ")}><div className="report-card-title"><h2><Icon size={20} />{title}</h2><span>{rows.length} referencias</span></div>{rows.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>REFERENCIA</th><th>UNIDADES</th><th>VENTAS</th><th>COSTO REAL</th><th>UTILIDAD</th><th>MARGEN</th><th /></tr></thead><tbody>{rows.map((row) => <tr key={row.name}><td><strong>{row.name}</strong></td><td>{number(row.units)}</td><td>{formatCop(row.sales_cop)}</td><td>{formatCop(row.cost_cop)}</td><td className={row.profit_cop >= 0 ? "positive-text" : "danger-text"}>{formatCop(row.profit_cop)}</td><td>{pct(row.margin_pct)}</td><td><button className="icon-button" onClick={() => onDetail(row)} title={`Ver detalle de ${row.name}`} type="button"><ChevronRight size={16} /></button></td></tr>)}</tbody></table></div> : <Empty />}</section>; }
function MetricDetailModal({ row, onClose }: { row: MetricRow; onClose: () => void }) { return <div className="modal-backdrop" onMouseDown={onClose}><section aria-modal="true" className="modal-panel report-detail-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog"><header className="modal-header"><div><span>Rentabilidad histórica</span><h2>{row.name}</h2></div><button className="icon-button" onClick={onClose} type="button"><X /></button></header><div className="report-detail-body"><Kpi label="Vendidas" value={number(row.units)} /><Kpi label="Ventas" value={formatCop(row.sales_cop)} /><Kpi label="Costo real" value={formatCop(row.cost_cop)} /><Kpi label="Utilidad" value={formatCop(row.profit_cop)} positive /><Kpi label="Margen" value={pct(row.margin_pct)} /></div></section></div>; }
