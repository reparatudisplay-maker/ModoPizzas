"use client";

import { useActionState, useMemo, useState } from "react";
import { regularizePendingInventoryDebtsWithLotReferences, type FormActionState } from "@/app/admin/actions";
import { formatCop } from "@/lib/format";
import { formatStockQuantity, type StockUnit } from "@/lib/units";

const initialState: FormActionState = { status: "idle", message: "" };

export type PendingRegularizationDebt = { id: string; orderCode: string; name: string; sourceKind: string; quantity: number; unit: StockUnit; lots: Array<{ id: string; available: number; purchasedAt: string | null; unitCost: number }> };
type InventoryDebtGroup = {
  key: string;
  name: string;
  unit: StockUnit;
  quantity: number;
  debts: PendingRegularizationDebt[];
  lots: PendingRegularizationDebt["lots"];
};

function lotLabel(lot: PendingRegularizationDebt["lots"][number], unit: StockUnit) {
  return `Compra ${lot.purchasedAt ? new Date(lot.purchasedAt).toLocaleDateString("es-CO") : "sin fecha"} · disponible ${formatStockQuantity(lot.available, unit)} · ${formatCop(lot.unitCost)}/${unit.toUpperCase()}`;
}

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

export function PendingInventoryRegularizationAction({ debts }: { debts: PendingRegularizationDebt[] }) {
  const [open, setOpen] = useState(false);
  const [selectedLots, setSelectedLots] = useState<Record<string, string>>({});
  const [state, formAction, isPending] = useActionState(regularizePendingInventoryDebtsWithLotReferences, initialState);
  const inventoryDebts = useMemo(() => debts.filter((debt) => debt.sourceKind === "inventory_item"), [debts]);
  const productionDebts = useMemo(() => debts.filter((debt) => debt.sourceKind !== "inventory_item"), [debts]);
  const inventoryGroups = useMemo(() => groupDebts(inventoryDebts), [inventoryDebts]);
  const productionGroups = useMemo(() => groupDebts(productionDebts), [productionDebts]);
  const canSubmit =
    productionDebts.length === 0 &&
    inventoryDebts.length > 0 &&
    inventoryDebts.every((debt) => selectedLots[debt.id]);
  const selectGroupLot = (group: InventoryDebtGroup, lotId: string) => {
    setSelectedLots((current) => ({ ...current, ...Object.fromEntries(group.debts.map((debt) => [debt.id, lotId])) }));
  };
  if (!debts.length && state.status !== "success") return null;

  return <div className="pending-inventory-regularization-action">
    {debts.length ? <small>{debts.length} faltantes pendientes</small> : null}
    <button className="secondary-button" disabled={!debts.length} onClick={() => setOpen(true)} type="button">Regularizar faltantes</button>
    {open ? <div aria-modal="true" className="modal-backdrop" role="dialog"><form action={formAction} className="modal pending-regularization-modal">
      <div className="modal-header"><div><h2>Regularizar faltantes</h2><p>Vista consolidada por producto. Expande una fila para revisar o ajustar cada consumo.</p></div><button aria-label="Cerrar" className="icon-button" onClick={() => setOpen(false)} type="button">×</button></div>
      <div className="pending-regularization-content"><p className="field-hint">La regularización técnica no modifica existencias físicas. Cada selección queda registrada en la auditoría.</p>
        {inventoryGroups.map((group) => <section className="pending-regularization-group" key={group.key}><div className="pending-regularization-row"><div><strong>{group.name}</strong><span>{`${group.debts.length} ${group.debts.length === 1 ? "consumo" : "consumos"} · ${formatStockQuantity(group.quantity, group.unit)}`}</span></div>{group.lots.length ? <label>Lote de referencia para todo el producto<select onChange={(event) => selectGroupLot(group, event.target.value)} required value={selectedLots[group.debts[0].id] ?? ""}><option value="">Selecciona un lote</option>{group.lots.map((lot) => <option key={lot.id} value={lot.id}>{lotLabel(lot, group.unit)}</option>)}</select></label> : <p className="alert">No hay lotes con existencia positiva.</p>}</div><details className="pending-regularization-details"><summary>Ver desglose ({group.debts.length})</summary><div>{group.debts.map((debt) => <div className="pending-regularization-detail" key={debt.id}><span>Pedido {debt.orderCode} · {formatStockQuantity(debt.quantity, debt.unit)}</span>{debt.lots.length ? <label>Referencia individual<select onChange={(event) => setSelectedLots((current) => ({ ...current, [debt.id]: event.target.value }))} value={selectedLots[debt.id] ?? ""}><option value="">Selecciona un lote</option>{debt.lots.map((lot) => <option key={lot.id} value={lot.id}>{lotLabel(lot, debt.unit)}</option>)}</select></label> : <small>Sin lote positivo disponible</small>}</div>)}</div></details></section>)}
        {productionGroups.length ? <section className="pending-regularization-production"><strong>Faltantes de producción</strong><p>Primero regularízalos desde Producción. La compra técnica queda bloqueada para conservar la trazabilidad.</p>{productionGroups.map((group) => <details className="pending-regularization-details" key={group.key}><summary>{`${group.name} · ${group.debts.length} ${group.debts.length === 1 ? "consumo" : "consumos"} · ${formatStockQuantity(group.quantity, group.unit)}`}</summary><div>{group.debts.map((debt) => <span className="pending-regularization-production-detail" key={debt.id}>Pedido {debt.orderCode} · {formatStockQuantity(debt.quantity, debt.unit)}</span>)}</div></details>)}</section> : null}
        <input name="lot_references" type="hidden" value={JSON.stringify(inventoryDebts.map((debt) => ({ debt_id: debt.id, lot_id: selectedLots[debt.id] ?? "" })))} />
        {state.message ? <p className={state.status === "error" ? "alert" : "success-message"}>{state.message}</p> : null}
      </div><div className="modal-actions"><button className="secondary-button" onClick={() => setOpen(false)} type="button">Cancelar</button><button className="positive-button" disabled={!canSubmit || isPending} type="submit">{isPending ? "Regularizando..." : "Regularizar seleccionados"}</button></div>
    </form></div> : null}
  </div>;
}
