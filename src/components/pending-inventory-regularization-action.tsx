"use client";

import { useActionState, useMemo, useState } from "react";
import { regularizePendingInventoryDebtsFifo, type FormActionState } from "@/app/admin/actions";
import { formatCop } from "@/lib/format";
import { formatStockQuantity, type StockUnit } from "@/lib/units";

const initialState: FormActionState = { status: "idle", message: "" };

type Lot = { id: string; available: number; purchasedAt: string | null; unitCost: number };
export type PendingRegularizationDebt = { id: string; orderCode: string; name: string; sourceKind: string; quantity: number; unit: StockUnit; lots: Lot[] };
type InventoryDebtGroup = { key: string; name: string; unit: StockUnit; quantity: number; debts: PendingRegularizationDebt[]; lots: Lot[] };
type PlannedLot = Lot & { planned: number };

function groupDebts(debts: PendingRegularizationDebt[]) {
  return Array.from(debts.reduce<Map<string, InventoryDebtGroup>>((groups, debt) => {
    const key = `${debt.name}:${debt.unit}`;
    const group = groups.get(key) ?? { key, name: debt.name, unit: debt.unit, quantity: 0, debts: [], lots: [] };
    group.quantity += debt.quantity;
    group.debts.push(debt);
    debt.lots.forEach((lot) => {
      if (!group.lots.some((candidate) => candidate.id === lot.id)) group.lots.push(lot);
    });
    groups.set(key, group);
    return groups;
  }, new Map<string, InventoryDebtGroup>()).values());
}

function fifoPlan(group: InventoryDebtGroup) {
  let remaining = group.quantity;
  const lots: PlannedLot[] = [...group.lots]
    .sort((left, right) => (left.purchasedAt ?? "9999-12-31").localeCompare(right.purchasedAt ?? "9999-12-31") || left.id.localeCompare(right.id))
    .map((lot) => {
      const planned = Math.min(Math.max(lot.available, 0), Math.max(remaining, 0));
      remaining = Math.max(0, remaining - planned);
      return { ...lot, planned };
    });
  return { lots, shortage: remaining };
}

function lotDate(lot: Lot) {
  return lot.purchasedAt ? new Date(lot.purchasedAt).toLocaleDateString("es-CO") : "Sin fecha";
}

export function PendingInventoryRegularizationAction({ debts }: { debts: PendingRegularizationDebt[] }) {
  const [open, setOpen] = useState(false);
  const [allowShortage, setAllowShortage] = useState(false);
  const [state, formAction, isPending] = useActionState(regularizePendingInventoryDebtsFifo, initialState);
  const inventoryDebts = useMemo(() => debts.filter((debt) => debt.sourceKind === "inventory_item"), [debts]);
  const productionDebts = useMemo(() => debts.filter((debt) => debt.sourceKind !== "inventory_item"), [debts]);
  const inventoryGroups = useMemo(() => groupDebts(inventoryDebts), [inventoryDebts]);
  const productionGroups = useMemo(() => groupDebts(productionDebts), [productionDebts]);
  const plans = useMemo(() => inventoryGroups.map((group) => ({ group, ...fifoPlan(group) })), [inventoryGroups]);
  const hasShortage = plans.some((plan) => plan.shortage > 0.000001);
  const canSubmit = productionDebts.length === 0 && inventoryDebts.length > 0 && (!hasShortage || allowShortage);

  if (!debts.length && state.status !== "success") return null;

  return <div className="pending-inventory-regularization-action">
    {debts.length ? <small>{debts.length} faltantes pendientes</small> : null}
    <button className="secondary-button" disabled={!debts.length} onClick={() => setOpen(true)} type="button">Regularizar faltantes</button>
    {open ? <div aria-modal="true" className="modal-backdrop" role="dialog"><form action={formAction} className="modal pending-regularization-modal">
      <div className="modal-header"><div><h2>Regularizar faltantes</h2><p>Vista consolidada por producto. El sistema usa los lotes más antiguos primero.</p></div><button aria-label="Cerrar" className="icon-button" onClick={() => setOpen(false)} type="button">×</button></div>
      <div className="pending-regularization-content">
        <p className="pending-regularization-intro">Se asignarán consumos históricos contra existencias reales, respetando FIFO. No se crea una compra nueva ni se altera la cantidad consumida.</p>
        {plans.map(({ group, lots, shortage }) => <section className="pending-regularization-group" key={group.key}>
          <div className="pending-regularization-row">
            <div><span className="pending-regularization-eyebrow">Consolidado</span><strong>{group.name}</strong><span>{`${group.debts.length} ${group.debts.length === 1 ? "consumo" : "consumos"} · ${formatStockQuantity(group.quantity, group.unit)}`}</span></div>
            <div className="pending-regularization-fifo"><strong>{lots.length} {lots.length === 1 ? "lote" : "lotes"} disponible{lots.length === 1 ? "" : "s"}</strong><span>{shortage > 0.000001 ? `Se asignarán ${formatStockQuantity(group.quantity - shortage, group.unit)} por FIFO` : "Cobertura completa por FIFO"}</span></div>
          </div>
          {shortage > 0.000001 ? <p className="pending-regularization-shortage">Se requieren {formatStockQuantity(group.quantity, group.unit)} de {group.name}, pero hay {formatStockQuantity(group.quantity - shortage, group.unit)} disponibles. Quedará una deuda de {formatStockQuantity(shortage, group.unit)}.</p> : null}
          <details className="pending-regularization-details"><summary>Ver desglose ({group.debts.length})</summary><div className="pending-regularization-breakdown">
            <table><thead><tr><th>Pedido</th><th>Consumo pendiente</th></tr></thead><tbody>{group.debts.map((debt) => <tr key={debt.id}><td>{debt.orderCode}</td><td>{formatStockQuantity(debt.quantity, debt.unit)}</td></tr>)}</tbody></table>
            <table><thead><tr><th>Lote FIFO</th><th>Disponible</th><th>Aplicará</th></tr></thead><tbody>{lots.length ? lots.map((lot) => <tr key={lot.id}><td>Compra {lotDate(lot)} · {formatCop(lot.unitCost)}/{group.unit.toUpperCase()}</td><td>{formatStockQuantity(lot.available, group.unit)}</td><td>{lot.planned > 0 ? formatStockQuantity(lot.planned, group.unit) : "—"}</td></tr>) : <tr><td colSpan={3}>Sin lotes con existencia positiva.</td></tr>}</tbody></table>
          </div></details>
        </section>)}
        {productionGroups.length ? <section className="pending-regularization-production"><strong>Faltantes de producción</strong><p>Regularízalos desde Producción; no se pueden asignar a lotes de compra.</p>{productionGroups.map((group) => <span className="pending-regularization-production-detail" key={group.key}>{group.name} · {formatStockQuantity(group.quantity, group.unit)} · {group.debts.length} consumos</span>)}</section> : null}
        {hasShortage ? <label className="pending-regularization-confirm"><input checked={allowShortage} name="allow_shortage" onChange={(event) => setAllowShortage(event.target.checked)} type="checkbox" value="true" /> <span>Entiendo que los lotes disponibles se consumirán por FIFO y que los saldos sin cobertura continuarán pendientes de regularización.</span></label> : <input name="allow_shortage" type="hidden" value="false" />}
        {state.message ? <p className={state.status === "error" ? "alert" : "success-message"}>{state.message}</p> : null}
      </div>
      <div className="modal-actions"><button className="secondary-button" onClick={() => setOpen(false)} type="button">Cancelar</button><button className="positive-button" disabled={!canSubmit || isPending} type="submit">{isPending ? "Regularizando..." : hasShortage ? "Regularizar lo disponible" : "Regularizar por FIFO"}</button></div>
    </form></div> : null}
  </div>;
}
