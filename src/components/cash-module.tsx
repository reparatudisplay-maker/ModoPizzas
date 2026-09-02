"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, ClipboardCheck, Minus, Plus, Search, Wallet, X } from "lucide-react";
import {
  closeCashSessionAction,
  openCashSessionAction,
  recordCashCountAction,
  registerCashMovementAction,
  type FormActionState
} from "@/app/admin/actions";
import { formatCop } from "@/lib/format";
import { normalizeMasterText, uppercaseMasterName } from "@/lib/master-normalization";

export type CashRegisterOption = {
  id: string;
  name: string;
};

export type CashSessionRow = {
  id: string;
  cash_register_id: string;
  cash_register_name: string;
  opened_at: string;
  opened_by_name: string;
  opening_cash_cop: number;
  status: string;
  closed_at: string | null;
  expected_cash_cop: number | null;
  counted_cash_cop: number | null;
  difference_cash_cop: number | null;
  closing_notes: string | null;
};

export type CashMovementRow = {
  id: string;
  cash_session_id: string;
  movement_kind: string;
  direction: "in" | "out";
  source_kind: string;
  destination: string | null;
  amount_cop: number;
  occurred_at: string;
  reason: string | null;
  order_code: string | null;
  order_kind: string | null;
  expense_description: string | null;
};

export type CashCountRow = {
  id: string;
  cash_session_id: string;
  theoretical_cash_cop: number;
  counted_cash_cop: number;
  difference_cash_cop: number;
  notes: string | null;
  counted_at: string;
};

export type FundBalanceRow = {
  id: string;
  name: string;
  balance_cop: number;
};

export type ShiftSaleRow = {
  id: string;
  code: string;
  kind: string;
  payment_method: string;
  total_cop: number;
  created_at: string;
};

const initialState: FormActionState = { status: "idle", message: "" };

const movementLabels: Record<string, string> = {
  sale_cash: "Venta efectivo",
  expense_cash: "Gasto desde caja",
  withdrawal: "Retiro",
  manual_income: "Otro ingreso",
  manual_out: "Otro egreso",
  refund_cash: "Devolucion efectivo"
};

const orderKindLabels: Record<string, string> = {
  local: "Consumo local",
  pickup: "Recoger",
  delivery: "Domicilio"
};

function formatDateTime(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" });
}

function formatHour(value: string) {
  return new Date(value).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
}

function signedCop(value: number, direction: "in" | "out") {
  return `${direction === "in" ? "+" : "-"}${formatCop(value)}`;
}

function groupTotal(movements: CashMovementRow[], kind: string) {
  return movements.filter((movement) => movement.movement_kind === kind).reduce((sum, movement) => sum + movement.amount_cop, 0);
}

function expectedCash(session: CashSessionRow | null, movements: CashMovementRow[]) {
  if (!session) return 0;
  return session.opening_cash_cop + movements.reduce((sum, movement) => sum + (movement.direction === "in" ? movement.amount_cop : -movement.amount_cop), 0);
}

export function CashStatusModule({
  registers,
  openSession,
  movements,
  counts,
  fundBalances
}: {
  registers: CashRegisterOption[];
  openSession: CashSessionRow | null;
  movements: CashMovementRow[];
  counts: CashCountRow[];
  fundBalances: FundBalanceRow[];
}) {
  const [openModal, setOpenModal] = useState(false);
  const [movementModal, setMovementModal] = useState<"income" | "withdrawal" | null>(null);
  const [countModal, setCountModal] = useState(false);
  const expected = expectedCash(openSession, movements);
  const latestCount = counts[0];

  return (
    <section className="form-panel cash-dashboard">
      <div className="section-title-row inventory-toolbar-row">
        <div>
          <h2>Estado / Apertura</h2>
          <p className="section-subtitle">Una caja abierta recibe ventas en efectivo y movimientos autorizados.</p>
        </div>
        {openSession ? (
          <div className="purchase-toolbar">
            <button className="ghost-button" onClick={() => setCountModal(true)} type="button"><ClipboardCheck size={18} /> Realizar arqueo</button>
            <button className="positive-button" onClick={() => setMovementModal("income")} type="button"><Plus size={18} /> Movimiento</button>
            <button className="ghost-button danger-button" onClick={() => setMovementModal("withdrawal")} type="button"><Minus size={18} /> Retiro</button>
          </div>
        ) : (
          <button className="positive-button" onClick={() => setOpenModal(true)} type="button"><Wallet size={18} /> Abrir caja</button>
        )}
      </div>

      <div className="cash-summary-strip prominent">
        <article>
          <span>Estado</span>
          <strong>{openSession ? "Abierta" : "Sin caja abierta"}</strong>
        </article>
        <article>
          <span>Efectivo esperado</span>
          <strong>{formatCop(expected)}</strong>
        </article>
        <article>
          <span>Base inicial</span>
          <strong>{openSession ? formatCop(openSession.opening_cash_cop) : "-"}</strong>
        </article>
        <article>
          <span>Fondo de resguardo</span>
          <strong>{fundBalances[0] ? formatCop(fundBalances[0].balance_cop) : "$ 0"}</strong>
        </article>
      </div>

      {openSession ? (
        <div className="cash-two-column">
          <article className="compact-card">
            <h3>{openSession.cash_register_name}</h3>
            <p>Abierta por {openSession.opened_by_name}</p>
            <p>{formatDateTime(openSession.opened_at)}</p>
          </article>
          <article className="compact-card">
            <h3>Ultimo arqueo</h3>
            {latestCount ? (
              <>
                <p>Contado: <strong>{formatCop(latestCount.counted_cash_cop)}</strong></p>
                <p>Diferencia: <strong className={latestCount.difference_cash_cop < 0 ? "text-danger" : "text-success"}>{formatCop(latestCount.difference_cash_cop, { decimals: true })}</strong></p>
              </>
            ) : <p>Sin arqueos en esta sesion.</p>}
          </article>
        </div>
      ) : <p className="alert">Abre una caja para registrar ventas en efectivo, gastos desde caja, retiros y arqueos.</p>}

      {openModal ? <OpenCashModal onClose={() => setOpenModal(false)} registers={registers} /> : null}
      {movementModal && openSession ? <CashMovementModal mode={movementModal} onClose={() => setMovementModal(null)} sessionId={openSession.id} /> : null}
      {countModal && openSession ? <CashCountModal expected={expected} onClose={() => setCountModal(false)} sessionId={openSession.id} /> : null}
    </section>
  );
}

export function CashMovementsModule({ movements }: { movements: CashMovementRow[] }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const normalizedQuery = normalizeMasterText(query);
  const filteredMovements = useMemo(
    () =>
      movements.filter((movement) => {
        const haystack = normalizeMasterText(`${movement.order_code ?? ""} ${movement.expense_description ?? ""} ${movement.reason ?? ""} ${movement.destination ?? ""}`);
        return (!normalizedQuery || haystack.includes(normalizedQuery)) && (!kind || movement.movement_kind === kind);
      }),
    [kind, movements, normalizedQuery]
  );

  return (
    <section className="form-panel">
      <div className="section-title-row inventory-toolbar-row">
        <h2>Movimientos de caja</h2>
        <form className="table-filters" onSubmit={(event) => event.preventDefault()}>
          <label className="pos-search compact-search">
            <Search size={18} />
            <input onChange={(event) => setQuery(uppercaseMasterName(event.target.value))} placeholder="Buscar movimiento" value={query} />
          </label>
          <select onChange={(event) => setKind(event.target.value)} title="Tipo" value={kind}>
            <option value="">Todos</option>
            {Object.entries(movementLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </form>
      </div>
      <div className="data-table-wrap">
        <table className="data-table compact-fit-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Tipo</th>
              <th>Referencia</th>
              <th>Destino</th>
              <th>Valor</th>
              <th>Observacion</th>
            </tr>
          </thead>
          <tbody>
            {filteredMovements.map((movement) => (
              <tr key={movement.id}>
                <td>{formatDateTime(movement.occurred_at)}</td>
                <td>{movementLabels[movement.movement_kind] ?? movement.movement_kind}</td>
                <td>{movement.order_code ?? movement.expense_description ?? movement.source_kind}</td>
                <td>{movement.destination ? movement.destination.replace(/_/g, " ") : "-"}</td>
                <td><strong className={movement.direction === "in" ? "text-success" : "text-danger"}>{signedCop(movement.amount_cop, movement.direction)}</strong></td>
                <td>{movement.reason ?? "-"}</td>
              </tr>
            ))}
            {filteredMovements.length === 0 ? <tr><td colSpan={6}>Sin movimientos.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function CashClosingModule({
  openSession,
  movements,
  sales,
  closedSessions
}: {
  openSession: CashSessionRow | null;
  movements: CashMovementRow[];
  sales: ShiftSaleRow[];
  closedSessions: CashSessionRow[];
}) {
  const [closeModal, setCloseModal] = useState(false);
  const expected = expectedCash(openSession, movements);
  const salesByMethod = {
    cash: sales.filter((sale) => sale.payment_method === "cash"),
    transfer: sales.filter((sale) => sale.payment_method === "transfer"),
    mixed: sales.filter((sale) => sale.payment_method === "mixed"),
    pending: sales.filter((sale) => sale.payment_method === "pending")
  };

  return (
    <section className="form-panel cash-closing-panel">
      <div className="section-title-row inventory-toolbar-row">
        <div>
          <h2>Cierre de caja</h2>
          <p className="section-subtitle">El efectivo esperado se calcula desde movimientos auditables; no se edita manualmente.</p>
        </div>
        {openSession ? <button className="positive-button" onClick={() => setCloseModal(true)} type="button">Cerrar caja</button> : null}
      </div>
      {openSession ? (
        <>
          <div className="cash-close-card">
            <CashGroup label="Base inicial" total={openSession.opening_cash_cop} rows={[{ key: "base", label: `${formatHour(openSession.opened_at)} · ${openSession.opened_by_name}`, value: openSession.opening_cash_cop }]} />
            <CashMovementGroup kind="sale_cash" label="Ventas efectivo" movements={movements} />
            <CashMovementGroup kind="manual_income" label="Otros ingresos" movements={movements} />
            <CashMovementGroup kind="expense_cash" label="Gastos pagados desde caja" movements={movements} negative />
            <CashMovementGroup kind="withdrawal" label="Retiros" movements={movements} negative />
            <CashMovementGroup kind="refund_cash" label="Devoluciones" movements={movements} negative />
            <CashMovementGroup kind="manual_out" label="Otros egresos" movements={movements} negative />
            <div className="cash-expected-row">
              <span>Efectivo esperado</span>
              <strong>{formatCop(expected)}</strong>
            </div>
          </div>
          <div className="cash-close-card">
            <h3>Ventas del turno</h3>
            <SalesGroup label="Efectivo" sales={salesByMethod.cash} />
            <SalesGroup label="Transferencias" sales={salesByMethod.transfer} />
            <SalesGroup label="Mixto" sales={salesByMethod.mixed} />
            <SalesGroup label="Pendiente" sales={salesByMethod.pending} />
            <div className="cash-expected-row">
              <span>Ventas totales</span>
              <strong>{formatCop(sales.reduce((sum, sale) => sum + sale.total_cop, 0))}</strong>
            </div>
          </div>
        </>
      ) : <p className="alert">No hay una caja abierta para cerrar.</p>}
      <section className="compact-card">
        <h3>Cierres historicos</h3>
        <div className="data-table-wrap">
          <table className="data-table compact-fit-table">
            <thead>
              <tr>
                <th>Caja</th>
                <th>Apertura</th>
                <th>Cierre</th>
                <th>Esperado</th>
                <th>Contado</th>
                <th>Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {closedSessions.map((session) => (
                <tr key={session.id}>
                  <td>{session.cash_register_name}</td>
                  <td>{formatDateTime(session.opened_at)}</td>
                  <td>{formatDateTime(session.closed_at)}</td>
                  <td>{formatCop(session.expected_cash_cop ?? 0)}</td>
                  <td>{formatCop(session.counted_cash_cop ?? 0)}</td>
                  <td><strong className={(session.difference_cash_cop ?? 0) < 0 ? "text-danger" : "text-success"}>{formatCop(session.difference_cash_cop ?? 0, { decimals: true })}</strong></td>
                </tr>
              ))}
              {closedSessions.length === 0 ? <tr><td colSpan={6}>Sin cierres historicos.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
      {closeModal && openSession ? <CloseCashModal expected={expected} onClose={() => setCloseModal(false)} sessionId={openSession.id} /> : null}
    </section>
  );
}

function CashGroup({ label, total, rows, negative = false }: { label: string; total: number; rows: Array<{ key: string; label: string; value: number }>; negative?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="cash-group">
      <button className="cash-group-row" onClick={() => setOpen((current) => !current)} type="button">
        <span>{rows.length > 0 ? (open ? <ChevronUp size={16} /> : <ChevronDown size={16} />) : null}{label}</span>
        <strong className={negative ? "text-danger" : ""}>{negative ? `-${formatCop(total)}` : formatCop(total)}</strong>
      </button>
      {open ? (
        <div className="cash-group-detail">
          {rows.slice(0, 5).map((row) => (
            <p key={row.key}><span>{row.label}</span><strong>{formatCop(row.value)}</strong></p>
          ))}
          {rows.length > 5 ? <small>Ver todas en Movimientos.</small> : null}
        </div>
      ) : null}
    </div>
  );
}

function CashMovementGroup({ label, movements, kind, negative = false }: { label: string; movements: CashMovementRow[]; kind: string; negative?: boolean }) {
  const rows = movements
    .filter((movement) => movement.movement_kind === kind)
    .map((movement) => ({
      key: movement.id,
      label: `${formatHour(movement.occurred_at)} · ${movement.order_code ?? movement.expense_description ?? movement.reason ?? movement.destination ?? movementLabels[movement.movement_kind]}`,
      value: movement.amount_cop
    }));
  return <CashGroup label={label} negative={negative} rows={rows} total={groupTotal(movements, kind)} />;
}

function SalesGroup({ label, sales }: { label: string; sales: ShiftSaleRow[] }) {
  const rows = sales.map((sale) => ({
    key: sale.id,
    label: `${sale.code} · ${formatHour(sale.created_at)} · ${orderKindLabels[sale.kind] ?? sale.kind}`,
    value: sale.total_cop
  }));
  return <CashGroup label={label} rows={rows} total={sales.reduce((sum, sale) => sum + sale.total_cop, 0)} />;
}

function OpenCashModal({ registers, onClose }: { registers: CashRegisterOption[]; onClose: () => void }) {
  const [state, action] = useActionState(openCashSessionAction, initialState);
  useCloseOnSuccess(state, onClose);
  return (
    <CashModal title="Abrir caja" onClose={onClose}>
      <form action={action} className="compact-card">
        <div className="form-grid">
          <div className="field">
            <label>Caja</label>
            <select name="cash_register_id">
              {registers.map((register) => <option key={register.id} value={register.id}>{register.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Base inicial</label>
            <input inputMode="decimal" min="0" name="opening_cash_cop" placeholder="$ 0" required type="number" />
          </div>
        </div>
        <ActionStatus state={state} />
        <ModalActions label="Abrir caja" onClose={onClose} />
      </form>
    </CashModal>
  );
}

function CashMovementModal({ mode, sessionId, onClose }: { mode: "income" | "withdrawal"; sessionId: string; onClose: () => void }) {
  const [state, action] = useActionState(registerCashMovementAction, initialState);
  const [kind, setKind] = useState(mode === "withdrawal" ? "withdrawal" : "manual_income");
  useCloseOnSuccess(state, onClose);
  return (
    <CashModal title={mode === "withdrawal" ? "Registrar retiro" : "Registrar movimiento"} onClose={onClose}>
      <form action={action} className="compact-card">
        <input name="cash_session_id" type="hidden" value={sessionId} />
        <div className="form-grid">
          <div className="field">
            <label>Tipo</label>
            <select name="movement_kind" onChange={(event) => setKind(event.target.value)} value={kind}>
              {mode === "withdrawal" ? <option value="withdrawal">Retiro</option> : null}
              {mode === "income" ? <option value="manual_income">Otro ingreso</option> : null}
              {mode === "income" ? <option value="manual_out">Otro egreso</option> : null}
            </select>
          </div>
          <div className="field">
            <label>Valor</label>
            <input inputMode="decimal" min="0.01" name="amount_cop" placeholder="$ 0" required type="number" />
          </div>
          <div className="field">
            <label>Destino</label>
            <select name="destination" required={kind === "withdrawal"}>
              {kind === "withdrawal" ? <option value="custody_fund">Fondo de resguardo</option> : null}
              {kind === "withdrawal" ? <option value="external_admin">Administrador / retiro externo</option> : null}
              <option value="other">Otro</option>
            </select>
          </div>
          <div className="field">
            <label>Motivo</label>
            <input autoComplete="off" name="reason" placeholder="Motivo u observacion" required />
          </div>
        </div>
        <ActionStatus state={state} />
        <ModalActions label="Guardar movimiento" onClose={onClose} />
      </form>
    </CashModal>
  );
}

function CashCountModal({ sessionId, expected, onClose }: { sessionId: string; expected: number; onClose: () => void }) {
  const [state, action] = useActionState(recordCashCountAction, initialState);
  const [counted, setCounted] = useState("");
  const difference = (Number(counted) || 0) - expected;
  useCloseOnSuccess(state, onClose);
  return (
    <CashModal title="Realizar arqueo" onClose={onClose}>
      <form action={action} className="compact-card">
        <input name="cash_session_id" type="hidden" value={sessionId} />
        <div className="cash-summary-strip">
          <article><span>Esperado</span><strong>{formatCop(expected)}</strong></article>
          <article><span>Contado</span><strong>{counted ? formatCop(Number(counted)) : "-"}</strong></article>
          <article><span>Diferencia</span><strong className={difference < 0 ? "text-danger" : "text-success"}>{counted ? formatCop(difference, { decimals: true }) : "-"}</strong></article>
        </div>
        <div className="form-grid">
          <div className="field">
            <label>Efectivo contado</label>
            <input inputMode="decimal" min="0" name="counted_cash_cop" onChange={(event) => setCounted(event.target.value)} placeholder="$ 0" required type="number" value={counted} />
          </div>
          <div className="field">
            <label>Observaciones</label>
            <input autoComplete="off" name="notes" placeholder="Opcional" />
          </div>
        </div>
        <ActionStatus state={state} />
        <ModalActions label="Registrar arqueo" onClose={onClose} />
      </form>
    </CashModal>
  );
}

function CloseCashModal({ sessionId, expected, onClose }: { sessionId: string; expected: number; onClose: () => void }) {
  const [state, action] = useActionState(closeCashSessionAction, initialState);
  const [counted, setCounted] = useState("");
  const difference = (Number(counted) || 0) - expected;
  useCloseOnSuccess(state, onClose);
  return (
    <CashModal title="Cerrar caja" onClose={onClose}>
      <form action={action} className="compact-card">
        <input name="cash_session_id" type="hidden" value={sessionId} />
        <div className="cash-summary-strip prominent">
          <article><span>Efectivo esperado</span><strong>{formatCop(expected)}</strong></article>
          <article><span>Efectivo contado</span><strong>{counted ? formatCop(Number(counted)) : "-"}</strong></article>
          <article><span>Diferencia</span><strong className={difference < 0 ? "text-danger" : "text-success"}>{counted ? formatCop(difference, { decimals: true }) : "-"}</strong></article>
        </div>
        <div className="form-grid">
          <div className="field">
            <label>Efectivo contado</label>
            <input inputMode="decimal" min="0" name="counted_cash_cop" onChange={(event) => setCounted(event.target.value)} placeholder="$ 0" required type="number" value={counted} />
          </div>
          <div className="field">
            <label>Observaciones de cierre</label>
            <input autoComplete="off" name="notes" placeholder={Math.abs(difference) > 0 ? "Explica la diferencia" : "Opcional"} required={counted ? Math.abs(difference) >= 1000 : false} />
          </div>
        </div>
        <ActionStatus state={state} />
        <ModalActions label="Confirmar cierre" onClose={onClose} />
      </form>
    </CashModal>
  );
}

function CashModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-label={title} aria-modal="true" className="modal-panel purchase-modal cash-action-modal" role="dialog">
        <header className="modal-header">
          <div><strong>{title}</strong><span>Caja</span></div>
          <button className="icon-button" onClick={onClose} title="Cerrar" type="button"><X size={18} /></button>
        </header>
        {children}
      </section>
    </div>
  );
}

function useCloseOnSuccess(state: FormActionState, onClose: () => void) {
  const router = useRouter();
  useEffect(() => {
    if (state.status !== "success") return;
    const timeout = window.setTimeout(() => {
      onClose();
      router.refresh();
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [onClose, router, state.status]);
}

function ActionStatus({ state }: { state: FormActionState }) {
  return state.status !== "idle" ? <p className={`form-status ${state.status}`}>{state.message}</p> : null;
}

function ModalActions({ label, onClose }: { label: string; onClose: () => void }) {
  const { pending } = useFormStatus();
  return (
    <div className="form-actions">
      <button className="ghost-button" onClick={onClose} type="button">Cancelar</button>
      <button className="positive-button" disabled={pending} type="submit">{pending ? "Guardando..." : label}</button>
    </div>
  );
}
