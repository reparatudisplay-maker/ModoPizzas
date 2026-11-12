"use client";

import { useActionState, useEffect, useState } from "react";
import { reconcilePlatformReceivableAction, registerPlatformSettlementAction, savePlatformPaymentSettings, type FormActionState } from "@/app/admin/actions";
import { formatCop } from "@/lib/format";

export type PlatformPaymentSetting = {
  platform: "rappi" | "didi";
  commission_percent: number;
  fixed_fee_cop: number;
  commission_tax_percent: number;
  settlement_due_days: number;
  didi_tu_negocio_commission_percent: number;
  didi_tu_negocio_fixed_fee_cop: number;
  didi_tu_negocio_commission_tax_percent: number;
  didi_tu_negocio_settlement_due_days: number;
};
export type PlatformReceivableRow = { id: string; platform: "rappi" | "didi"; gross_cop: number; estimated_commission_cop: number; net_expected_cop: number; settled_gross_cop: number; settled_net_cop: number; due_at: string; status: string; order_code: string };
export type PlatformServicePayableRow = { id: string; order_code: string; order_total_cop: number; estimated_charge_cop: number; due_at: string; status: string };
type SettlementTab = "pending" | "register" | "didi-billing" | "reconciliation" | "history";

const idle: FormActionState = { status: "idle", message: "" };

export function PlatformSettingsModule({ settings }: { settings: PlatformPaymentSetting[] }) {
  const [activePlatform, setActivePlatform] = useState<"rappi" | "didi">("rappi");
  useEffect(() => {
    const stored = window.localStorage.getItem("modo-pizzas:platform-settings-tab");
    if (stored === "rappi" || stored === "didi") setActivePlatform(stored);
  }, []);
  const selectPlatform = (platform: "rappi" | "didi") => {
    setActivePlatform(platform);
    window.localStorage.setItem("modo-pizzas:platform-settings-tab", platform);
  };
  const setting = settings.find((item) => item.platform === activePlatform) ?? settings[0];
  if (!setting) return null;
  return <section className="module-stack">
    <div className="section-title-row"><div><h2>Ajustes de plataforma</h2><p className="muted">Configura las tarifas estimadas que se usan al preparar pedidos de plataforma.</p></div></div>
    <div aria-label="Plataforma" className="configuration-subtabs" role="tablist">
      <button aria-selected={activePlatform === "rappi"} className={activePlatform === "rappi" ? "active" : ""} onClick={() => selectPlatform("rappi")} role="tab" type="button">Rappi</button>
      <button aria-selected={activePlatform === "didi"} className={activePlatform === "didi" ? "active" : ""} onClick={() => selectPlatform("didi")} role="tab" type="button">DiDi</button>
    </div>
    <PlatformSettingCard setting={setting} />
  </section>;
}

export function PlatformSettlementsModule({ receivables, servicePayables }: { receivables: PlatformReceivableRow[]; servicePayables: PlatformServicePayableRow[] }) {
  const [platform, setPlatform] = useState<"rappi" | "didi">("rappi");
  const [activeTab, setActiveTab] = useState<SettlementTab>("pending");
  const [selected, setSelected] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Record<string, { gross: string; commission: string; net: string }>>({});
  useEffect(() => {
    const storedTab = window.localStorage.getItem("modo-pizzas:settlements-tab");
    const storedPlatform = window.localStorage.getItem("modo-pizzas:settlements-platform");
    if (storedTab === "pending" || storedTab === "register" || storedTab === "didi-billing" || storedTab === "reconciliation" || storedTab === "history") setActiveTab(storedTab);
    if (storedPlatform === "rappi" || storedPlatform === "didi") setPlatform(storedPlatform);
  }, []);
  const selectTab = (tab: SettlementTab) => {
    setActiveTab(tab);
    window.localStorage.setItem("modo-pizzas:settlements-tab", tab);
  };
  const selectPlatform = (nextPlatform: "rappi" | "didi") => {
    setPlatform(nextPlatform);
    setSelected([]);
    window.localStorage.setItem("modo-pizzas:settlements-platform", nextPlatform);
  };
  const available = receivables.filter((row) => row.platform === platform && row.status === "pending");
  const pendingByPlatform = {
    rappi: receivables.filter((row) => row.platform === "rappi" && row.status === "pending"),
    didi: receivables.filter((row) => row.platform === "didi" && row.status === "pending")
  };
  const settled = receivables.filter((row) => row.status !== "pending" && row.platform === platform);
  const selectedRows = available.filter((row) => selected.includes(row.id));
  const allocations = selectedRows.map((row) => {
    const remainingGross = Math.max(0, row.gross_cop - row.settled_gross_cop);
    const remainingNet = Math.max(0, row.net_expected_cop - row.settled_net_cop);
    return { receivable_id: row.id, gross_cop: Number(overrides[row.id]?.gross || remainingGross), commission_cop: Number(overrides[row.id]?.commission || Math.max(0, remainingGross - remainingNet)), net_cop: Number(overrides[row.id]?.net || remainingNet) };
  });
  const expected = allocations.reduce((sum, row) => sum + row.net_cop, 0);
  const [settlementState, settlementAction] = useActionState(registerPlatformSettlementAction, idle);
  const pendingGross = available.reduce((sum, row) => sum + Math.max(0, row.gross_cop - row.settled_gross_cop), 0);
  const pendingNet = available.reduce((sum, row) => sum + Math.max(0, row.net_expected_cop - row.settled_net_cop), 0);
  const tabs: Array<{ id: SettlementTab; label: string; count?: number }> = [
    { id: "pending", label: "Pendientes", count: pendingByPlatform.rappi.length + pendingByPlatform.didi.length },
    { id: "register", label: "Registrar liquidación" },
    { id: "didi-billing", label: "Facturas DiDi", count: servicePayables.filter((row) => row.status === "pending").length },
    { id: "reconciliation", label: "Conciliación" },
    { id: "history", label: "Historial" }
  ];

  return <section className="module-stack">
    <div className="section-title-row"><div><h1>Liquidaciones de plataformas</h1><p className="muted">Las ventas ya registradas permanecen fuera del efectivo hasta que la plataforma transfiera el dinero.</p></div></div>
    <div className="settlements-tabs" aria-label="Secciones de liquidaciones" role="tablist">{tabs.map((tab) => <button aria-controls={`settlement-${tab.id}`} aria-selected={activeTab === tab.id} className={activeTab === tab.id ? "active" : ""} key={tab.id} onClick={() => selectTab(tab.id)} role="tab" type="button">{tab.label}{tab.count ? <span>{tab.count}</span> : null}</button>)}</div>

    {activeTab !== "didi-billing" ? <PlatformTabs platform={platform} onSelect={selectPlatform} pendingByPlatform={pendingByPlatform} /> : null}

    {activeTab === "pending" ? <section className="form-panel settlement-tab-panel" id="settlement-pending" role="tabpanel">
      <div className="section-title-row"><div><h2>Pedidos pendientes</h2><p className="muted">{platform === "rappi" ? "Rappi" : "DiDi"} debe transferir estos pedidos antes de conciliarlos.</p></div><div className="settlement-total"><span>Neto pendiente</span><strong>{formatCop(pendingNet)}</strong></div></div>
      <div className="settlement-summary-grid"><div><span>Pedidos</span><strong>{available.length}</strong></div><div><span>Bruto pendiente</span><strong>{formatCop(pendingGross)}</strong></div><div><span>Comisión estimada</span><strong>{formatCop(Math.max(0, pendingGross - pendingNet))}</strong></div></div>
      <ReceivablesTable rows={available} />
    </section> : null}

    {activeTab === "register" ? <section className="form-panel settlement-tab-panel" id="settlement-register" role="tabpanel">
      <div className="section-title-row"><div><h2>Registrar liquidación</h2><p className="muted">Selecciona los pedidos recibidos y confirma sus valores reales.</p></div><div className="settlement-total"><span>Seleccionado</span><strong>{formatCop(expected)}</strong></div></div>
      <form action={settlementAction} className="module-stack compact-stack">
        <input name="platform" type="hidden" value={platform} /><input name="allocations" type="hidden" value={JSON.stringify(allocations)} />
        <div className="data-table-wrap"><table className="data-table compact-fit-table"><thead><tr><th>Seleccionar</th><th>Pedido</th><th>Vence</th><th>Bruto pendiente</th><th>Comisión estimada</th><th>Neto pendiente</th></tr></thead><tbody>{available.map((row) => <tr key={row.id}><td><input aria-label={`Seleccionar ${row.order_code}`} checked={selected.includes(row.id)} onChange={() => setSelected((current) => current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id])} type="checkbox" /></td><td>{row.order_code}</td><td>{formatDate(row.due_at)}</td><td>{formatCop(Math.max(0, row.gross_cop - row.settled_gross_cop))}</td><td>{formatCop(row.estimated_commission_cop)}</td><td>{formatCop(Math.max(0, row.net_expected_cop - row.settled_net_cop))}</td></tr>)}{available.length === 0 ? <tr><td colSpan={6}>No hay cuentas pendientes.</td></tr> : null}</tbody></table></div>
        {selectedRows.length > 0 ? <div className="data-table-wrap"><table className="data-table compact-fit-table"><thead><tr><th>Pedido</th><th>Bruto cubierto</th><th>Comisión real</th><th>Recibido por pedido</th></tr></thead><tbody>{selectedRows.map((row) => {
          const remainingGross = Math.max(0, row.gross_cop - row.settled_gross_cop);
          const remainingNet = Math.max(0, row.net_expected_cop - row.settled_net_cop);
          const current = overrides[row.id];
          const update = (value: Partial<{ gross: string; commission: string; net: string }>) => setOverrides((rows) => ({ ...rows, [row.id]: { gross: current?.gross ?? String(remainingGross), commission: current?.commission ?? String(Math.max(0, remainingGross - remainingNet)), net: current?.net ?? String(remainingNet), ...value } }));
          return <tr key={row.id}><td>{row.order_code}</td><td><input aria-label={`Bruto ${row.order_code}`} defaultValue={remainingGross} inputMode="numeric" onChange={(event) => update({ gross: event.target.value })} /></td><td><input aria-label={`Comisión ${row.order_code}`} defaultValue={Math.max(0, remainingGross - remainingNet)} inputMode="numeric" onChange={(event) => update({ commission: event.target.value })} /></td><td><input aria-label={`Recibido ${row.order_code}`} defaultValue={remainingNet} inputMode="numeric" onChange={(event) => update({ net: event.target.value })} /></td></tr>;
        })}</tbody></table></div> : null}
        <div className="form-grid"><label className="field"><span>Recibido total</span><input key={expected} defaultValue={expected || ""} inputMode="numeric" name="received_cop" required /></label><label className="field"><span>Cuenta de destino</span><input name="destination_account" placeholder="Banco / cuenta" required /></label><label className="field"><span>Notas</span><input name="notes" placeholder="Opcional" /></label></div>
        {settlementState.status !== "idle" ? <p className={`form-status ${settlementState.status}`}>{settlementState.message}</p> : null}<div className="form-actions"><button className="primary-button" disabled={selectedRows.length === 0} type="submit">Registrar liquidación</button></div>
      </form>
    </section> : null}

    {activeTab === "didi-billing" ? <section className="form-panel settlement-tab-panel" id="settlement-didi-billing" role="tabpanel"><div className="section-title-row"><div><h2>Facturas DiDi Tu Negocio</h2><p className="muted">El cobro del pedido ya ingresó a la tienda. Estos valores son cargos estimados que DiDi facturará después.</p></div><div className="settlement-total"><span>Facturas pendientes</span><strong>{servicePayables.filter((row) => row.status === "pending").length}</strong></div></div><div className="data-table-wrap"><table className="data-table compact-fit-table"><thead><tr><th>Pedido</th><th>Venta cobrada</th><th>Factura estimada</th><th>Neto operativo</th><th>Vence</th><th>Estado</th></tr></thead><tbody>{servicePayables.map((row) => <tr key={row.id}><td>{row.order_code}</td><td>{formatCop(row.order_total_cop)}</td><td>-{formatCop(row.estimated_charge_cop)}</td><td>{formatCop(Math.max(0, row.order_total_cop - row.estimated_charge_cop))}</td><td>{formatDate(row.due_at)}</td><td>{payableStatusLabel(row.status)}</td></tr>)}{servicePayables.length === 0 ? <tr><td colSpan={6}>No hay facturas de DiDi Tu Negocio.</td></tr> : null}</tbody></table></div></section> : null}

    {activeTab === "reconciliation" ? <section className="form-panel settlement-tab-panel" id="settlement-reconciliation" role="tabpanel"><div className="section-title-row"><div><h2>Conciliación</h2><p className="muted">Compara el valor neto estimado con las liquidaciones registradas.</p></div><div className="settlement-total"><span>Por conciliar</span><strong>{receivables.filter((row) => row.status === "liquidated").length}</strong></div></div><div className="data-table-wrap"><table className="data-table compact-fit-table"><thead><tr><th>Pedido</th><th>Plataforma</th><th>Neto esperado</th><th>Recibido</th><th>Diferencia</th><th>Estado</th><th /></tr></thead><tbody>{receivables.filter((row) => row.platform === platform).map((row) => { const difference = row.settled_net_cop - row.net_expected_cop; return <tr key={row.id}><td>{row.order_code}</td><td>{row.platform === "rappi" ? "Rappi" : "DiDi"}</td><td>{formatCop(row.net_expected_cop)}</td><td>{formatCop(row.settled_net_cop)}</td><td>{formatCop(difference)}</td><td>{receivableStatusLabel(row.status)}</td><td>{row.status === "liquidated" ? <ReconcileButton receivableId={row.id} /> : null}</td></tr>; })}{receivables.filter((row) => row.platform === platform).length === 0 ? <tr><td colSpan={7}>No hay pedidos para conciliar.</td></tr> : null}</tbody></table></div></section> : null}

    {activeTab === "history" ? <section className="form-panel settlement-tab-panel" id="settlement-history" role="tabpanel"><div className="section-title-row"><div><h2>Historial de liquidaciones</h2><p className="muted">Pedidos liquidados o conciliados de {platform === "rappi" ? "Rappi" : "DiDi"}.</p></div><div className="settlement-total"><span>Registros</span><strong>{settled.length}</strong></div></div><div className="data-table-wrap"><table className="data-table compact-fit-table"><thead><tr><th>Pedido</th><th>Bruto</th><th>Comisión estimada</th><th>Neto esperado</th><th>Recibido</th><th>Estado</th></tr></thead><tbody>{settled.map((row) => <tr key={row.id}><td>{row.order_code}</td><td>{formatCop(row.gross_cop)}</td><td>{formatCop(row.estimated_commission_cop)}</td><td>{formatCop(row.net_expected_cop)}</td><td>{formatCop(row.settled_net_cop)}</td><td>{receivableStatusLabel(row.status)}</td></tr>)}{settled.length === 0 ? <tr><td colSpan={6}>No hay liquidaciones realizadas.</td></tr> : null}</tbody></table></div></section> : null}
  </section>;
}

function PlatformTabs({ platform, onSelect, pendingByPlatform }: { platform: "rappi" | "didi"; onSelect: (platform: "rappi" | "didi") => void; pendingByPlatform: { rappi: PlatformReceivableRow[]; didi: PlatformReceivableRow[] } }) {
  return <div className="settlement-platform-tabs" aria-label="Plataforma"><button className={platform === "rappi" ? "active" : ""} onClick={() => onSelect("rappi")} type="button">Rappi <span>{pendingByPlatform.rappi.length}</span></button><button className={platform === "didi" ? "active" : ""} onClick={() => onSelect("didi")} type="button">DiDi <span>{pendingByPlatform.didi.length}</span></button></div>;
}

function ReceivablesTable({ rows }: { rows: PlatformReceivableRow[] }) {
  return <div className="data-table-wrap"><table className="data-table compact-fit-table"><thead><tr><th>Pedido</th><th>Vence</th><th>Bruto pendiente</th><th>Comisión estimada</th><th>Neto pendiente</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.order_code}</td><td>{formatDate(row.due_at)}</td><td>{formatCop(Math.max(0, row.gross_cop - row.settled_gross_cop))}</td><td>{formatCop(row.estimated_commission_cop)}</td><td>{formatCop(Math.max(0, row.net_expected_cop - row.settled_net_cop))}</td></tr>)}{rows.length === 0 ? <tr><td colSpan={5}>No hay cuentas pendientes.</td></tr> : null}</tbody></table></div>;
}

function formatDate(value: string) { return new Date(`${value}T00:00:00`).toLocaleDateString("es-CO"); }
function receivableStatusLabel(status: string) { return status === "reconciled" ? "Conciliado" : status === "liquidated" ? "Liquidado" : "Pendiente"; }
function payableStatusLabel(status: string) { return status === "paid" ? "Pagada" : status === "void" ? "Anulada" : "Pendiente"; }

function PlatformSettingCard({ setting }: { setting: PlatformPaymentSetting }) {
  const [state, action] = useActionState(savePlatformPaymentSettings, idle);
  return <form action={action} className="form-panel compact-card"><input name="platform" type="hidden" value={setting.platform} /><h2>{setting.platform === "rappi" ? "Rappi" : "DiDi"}</h2><div className="form-grid"><label className="field"><span>Comisión %</span><input defaultValue={setting.commission_percent} inputMode="decimal" name="commission_percent" required /></label><label className="field"><span>IVA sobre comisión %</span><input defaultValue={setting.commission_tax_percent} inputMode="decimal" name="commission_tax_percent" required /></label><label className="field"><span>Cargo fijo</span><input defaultValue={setting.fixed_fee_cop} inputMode="numeric" name="fixed_fee_cop" required /></label><label className="field"><span>Pago esperado (días)</span><input defaultValue={setting.settlement_due_days} inputMode="numeric" name="settlement_due_days" required /></label></div>{setting.platform === "didi" ? <fieldset className="platform-settings-variant"><legend>DiDi Tu Negocio</legend><div className="form-grid"><label className="field"><span>Comisión %</span><input defaultValue={setting.didi_tu_negocio_commission_percent} inputMode="decimal" name="didi_tu_negocio_commission_percent" required /></label><label className="field"><span>IVA sobre comisión % (0 si está incluido)</span><input defaultValue={setting.didi_tu_negocio_commission_tax_percent} inputMode="decimal" name="didi_tu_negocio_commission_tax_percent" required /></label><label className="field"><span>Cargo fijo</span><input defaultValue={setting.didi_tu_negocio_fixed_fee_cop} inputMode="numeric" name="didi_tu_negocio_fixed_fee_cop" required /></label><label className="field"><span>Factura estimada (días)</span><input defaultValue={setting.didi_tu_negocio_settlement_due_days} inputMode="numeric" name="didi_tu_negocio_settlement_due_days" required /></label></div></fieldset> : null}{state.status !== "idle" ? <p className={`form-status ${state.status}`}>{state.message}</p> : null}<button className="ghost-button" type="submit">Guardar</button></form>;
}

function ReconcileButton({ receivableId }: { receivableId: string }) {
  const [state, action] = useActionState(async () => reconcilePlatformReceivableAction(receivableId), idle);
  return <form action={action}><button className="ghost-button" type="submit">Conciliar</button>{state.status === "error" ? <small className="text-danger">{state.message}</small> : null}</form>;
}
