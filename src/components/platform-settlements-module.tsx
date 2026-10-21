"use client";

import { useActionState, useMemo, useState } from "react";
import { reconcilePlatformReceivableAction, registerPlatformSettlementAction, savePlatformPaymentSettings, type FormActionState } from "@/app/admin/actions";
import { formatCop } from "@/lib/format";

type Setting = { platform: "rappi" | "didi"; commission_percent: number; fixed_fee_cop: number; commission_tax_percent: number; settlement_due_days: number };
export type PlatformReceivableRow = { id: string; platform: "rappi" | "didi"; gross_cop: number; estimated_commission_cop: number; net_expected_cop: number; settled_gross_cop: number; settled_net_cop: number; due_at: string; status: string; order_code: string };
const idle: FormActionState = { status: "idle", message: "" };

export function PlatformSettlementsModule({ settings, receivables }: { settings: Setting[]; receivables: PlatformReceivableRow[] }) {
  const [platform, setPlatform] = useState<"rappi" | "didi">("rappi");
  const [selected, setSelected] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Record<string, { gross: string; commission: string; net: string }>>({});
  const available = receivables.filter((row) => row.platform === platform && row.status === "pending");
  const selectedRows = available.filter((row) => selected.includes(row.id));
  const allocations = useMemo(() => selectedRows.map((row) => {
    const remainingGross = Math.max(0, row.gross_cop - row.settled_gross_cop);
    const remainingNet = Math.max(0, row.net_expected_cop - row.settled_net_cop);
    return { receivable_id: row.id, gross_cop: Number(overrides[row.id]?.gross || remainingGross), commission_cop: Number(overrides[row.id]?.commission || Math.max(0, remainingGross - remainingNet)), net_cop: Number(overrides[row.id]?.net || remainingNet) };
  }), [overrides, selectedRows]);
  const expected = allocations.reduce((sum, row) => sum + row.net_cop, 0);
  const [settlementState, settlementAction] = useActionState(registerPlatformSettlementAction, idle);

  return <section className="module-stack">
    <div className="section-title-row"><div><h1>Liquidaciones de plataformas</h1><p className="muted">Las ventas ya registradas permanecen fuera del efectivo hasta que la plataforma transfiera el dinero.</p></div></div>
    <div className="form-grid">{settings.map((setting) => <PlatformSettingCard key={setting.platform} setting={setting} />)}</div>
    <section className="form-panel">
      <div className="section-title-row"><div><h2>Registrar liquidación</h2><p className="muted">Puedes agrupar pedidos y corregir la comisión en la siguiente liquidación desde el detalle contable.</p></div><select onChange={(event) => { setPlatform(event.target.value as "rappi" | "didi"); setSelected([]); }} value={platform}><option value="rappi">Rappi</option><option value="didi">DiDi</option></select></div>
      <form action={settlementAction} className="module-stack compact-stack">
        <input name="platform" type="hidden" value={platform} /><input name="allocations" type="hidden" value={JSON.stringify(allocations)} />
        <div className="data-table-wrap"><table className="data-table compact-fit-table"><thead><tr><th>Seleccionar</th><th>Pedido</th><th>Vence</th><th>Bruto pendiente</th><th>Comisión estimada</th><th>Neto pendiente</th><th>Estado</th></tr></thead><tbody>{available.map((row) => <tr key={row.id}><td><input checked={selected.includes(row.id)} onChange={() => setSelected((current) => current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id])} type="checkbox" /></td><td>{row.order_code}</td><td>{new Date(`${row.due_at}T00:00:00`).toLocaleDateString("es-CO")}</td><td>{formatCop(Math.max(0, row.gross_cop - row.settled_gross_cop))}</td><td>{formatCop(row.estimated_commission_cop)}</td><td>{formatCop(Math.max(0, row.net_expected_cop - row.settled_net_cop))}</td><td>Pendiente</td></tr>)}{available.length === 0 ? <tr><td colSpan={7}>No hay cuentas pendientes.</td></tr> : null}</tbody></table></div>
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
    </section>
    <section className="form-panel"><h2>Conciliación</h2><div className="data-table-wrap"><table className="data-table compact-fit-table"><thead><tr><th>Pedido</th><th>Plataforma</th><th>Neto esperado</th><th>Estado</th><th /></tr></thead><tbody>{receivables.map((row) => <tr key={row.id}><td>{row.order_code}</td><td>{row.platform === "rappi" ? "Rappi" : "DiDi"}</td><td>{formatCop(row.net_expected_cop)}</td><td>{row.status === "reconciled" ? "Conciliado" : row.status === "liquidated" ? "Liquidado" : "Pendiente"}</td><td>{row.status === "liquidated" ? <ReconcileButton receivableId={row.id} /> : null}</td></tr>)}</tbody></table></div></section>
  </section>;
}

function PlatformSettingCard({ setting }: { setting: Setting }) {
  const [state, action] = useActionState(savePlatformPaymentSettings, idle);
  return <form action={action} className="form-panel compact-card"><input name="platform" type="hidden" value={setting.platform} /><h2>{setting.platform === "rappi" ? "Rappi" : "DiDi"}</h2><div className="form-grid"><label className="field"><span>Comisión %</span><input defaultValue={setting.commission_percent} inputMode="decimal" name="commission_percent" required /></label><label className="field"><span>IVA sobre comisión %</span><input defaultValue={setting.commission_tax_percent} inputMode="decimal" name="commission_tax_percent" required /></label><label className="field"><span>Cargo fijo</span><input defaultValue={setting.fixed_fee_cop} inputMode="numeric" name="fixed_fee_cop" required /></label><label className="field"><span>Pago esperado (días)</span><input defaultValue={setting.settlement_due_days} inputMode="numeric" name="settlement_due_days" required /></label></div>{state.status !== "idle" ? <p className={`form-status ${state.status}`}>{state.message}</p> : null}<button className="ghost-button" type="submit">Guardar</button></form>;
}

function ReconcileButton({ receivableId }: { receivableId: string }) {
  const [state, action] = useActionState(async () => reconcilePlatformReceivableAction(receivableId), idle);
  return <form action={action}><button className="ghost-button" type="submit">Conciliar</button>{state.status === "error" ? <small className="text-danger">{state.message}</small> : null}</form>;
}
