"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Plus, Search, Trash2, X } from "lucide-react";
import { registerExpenseAction, voidExpenseAction, type FormActionState } from "@/app/admin/actions";
import { formatCop } from "@/lib/format";
import { normalizeMasterText, uppercaseMasterName } from "@/lib/master-normalization";

export type ExpenseCategoryOption = {
  id: string;
  name: string;
  is_active: boolean;
};

export type SupplierOption = {
  id: string;
  name: string;
};

export type CustodyFundOption = {
  id: string;
  name: string;
  balance_cop: number;
};

export type ExpenseRow = {
  id: string;
  category_id: string;
  category_name: string;
  description: string;
  amount_cop: number;
  spent_at: string;
  payment_source: string;
  beneficiary_name: string | null;
  document_number: string | null;
  notes: string | null;
  status: string;
  created_by_name: string;
};

const initialState: FormActionState = { status: "idle", message: "" };

const paymentSourceLabels: Record<string, string> = {
  cash_session: "Caja actual",
  bank_transfer: "Banco / Transferencia",
  custody_fund: "Fondo de resguardo",
  other: "Otro / No afecta caja"
};

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" });
}

function localDateTimeValue(value?: string) {
  const date = value ? new Date(value) : new Date();
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function ExpensesModule({
  categories,
  suppliers,
  custodyFunds,
  expenses,
  hasOpenCashSession
}: {
  categories: ExpenseCategoryOption[];
  suppliers: SupplierOption[];
  custodyFunds: CustodyFundOption[];
  expenses: ExpenseRow[];
  hasOpenCashSession: boolean;
}) {
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const normalizedQuery = normalizeMasterText(query);

  const filteredExpenses = useMemo(
    () =>
      expenses.filter((expense) => {
        const haystack = normalizeMasterText(`${expense.description} ${expense.category_name} ${expense.beneficiary_name ?? ""} ${expense.document_number ?? ""}`);
        const matchesQuery = !normalizedQuery || haystack.includes(normalizedQuery);
        const matchesCategory = categoryFilter ? expense.category_id === categoryFilter : true;
        const matchesSource = sourceFilter ? expense.payment_source === sourceFilter : true;
        const matchesStatus = statusFilter ? expense.status === statusFilter : true;
        return matchesQuery && matchesCategory && matchesSource && matchesStatus;
      }),
    [categoryFilter, expenses, normalizedQuery, sourceFilter, statusFilter]
  );

  const totalActive = filteredExpenses.filter((expense) => expense.status === "active").reduce((sum, expense) => sum + expense.amount_cop, 0);

  return (
    <section className="form-panel">
      <div className="section-title-row inventory-toolbar-row">
        <div>
          <h2>Gastos</h2>
          <p className="section-subtitle">Registrar gasto no siempre mueve caja; depende del origen de pago seleccionado.</p>
        </div>
        <div className="purchase-toolbar">
          <form className="table-filters" onSubmit={(event) => event.preventDefault()}>
            <label className="pos-search compact-search">
              <Search size={18} />
              <input onChange={(event) => setQuery(uppercaseMasterName(event.target.value))} placeholder="Buscar gasto" value={query} />
            </label>
            <select onChange={(event) => setCategoryFilter(event.target.value)} title="Categoria" value={categoryFilter}>
              <option value="">Todas las categorias</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
            <select onChange={(event) => setSourceFilter(event.target.value)} title="Origen" value={sourceFilter}>
              <option value="">Todos los origenes</option>
              {Object.entries(paymentSourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select onChange={(event) => setStatusFilter(event.target.value)} title="Estado" value={statusFilter}>
              <option value="">Todos</option>
              <option value="active">Activos</option>
              <option value="voided">Anulados</option>
            </select>
          </form>
          <button className="positive-button add-purchase-button" onClick={() => setModalOpen(true)} type="button">
            <Plus size={18} /> Registrar gasto
          </button>
        </div>
      </div>

      <div className="cash-summary-strip">
        <article>
          <span>Total listado activo</span>
          <strong>{formatCop(totalActive)}</strong>
        </article>
        <article>
          <span>Caja abierta</span>
          <strong>{hasOpenCashSession ? "Si" : "No"}</strong>
        </article>
        <article>
          <span>Fondo de resguardo</span>
          <strong>{custodyFunds[0] ? formatCop(custodyFunds[0].balance_cop) : "Sin fondo"}</strong>
        </article>
      </div>

      <div className="data-table-wrap">
        <table className="data-table compact-fit-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Categoria</th>
              <th>Concepto</th>
              <th>Origen</th>
              <th>Valor</th>
              <th>Beneficiario</th>
              <th>Estado</th>
              <th>Usuario</th>
              <th className="actions-column compact-actions-column">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filteredExpenses.map((expense) => (
              <tr key={expense.id}>
                <td>{formatDateTime(expense.spent_at)}</td>
                <td>{expense.category_name}</td>
                <td title={expense.notes ?? expense.description}><strong>{expense.description}</strong></td>
                <td>{paymentSourceLabels[expense.payment_source] ?? expense.payment_source}</td>
                <td>{formatCop(expense.amount_cop)}</td>
                <td>{expense.beneficiary_name ?? expense.document_number ?? "-"}</td>
                <td><span className={`stock-pill ${expense.status === "active" ? "ok" : "danger"}`}>{expense.status === "active" ? "Activo" : "Anulado"}</span></td>
                <td>{expense.created_by_name}</td>
                <td className="actions-column compact-actions-column">
                  {expense.status === "active" ? <VoidExpenseButton id={expense.id} /> : <span className="muted-text">Sin acciones</span>}
                </td>
              </tr>
            ))}
            {filteredExpenses.length === 0 ? <tr><td colSpan={9}>Sin gastos.</td></tr> : null}
          </tbody>
        </table>
      </div>
      {modalOpen ? (
        <ExpenseModal
          categories={categories.filter((category) => category.is_active)}
          custodyFunds={custodyFunds}
          hasOpenCashSession={hasOpenCashSession}
          onClose={() => setModalOpen(false)}
          suppliers={suppliers}
        />
      ) : null}
    </section>
  );
}

function ExpenseModal({
  categories,
  suppliers,
  custodyFunds,
  hasOpenCashSession,
  onClose
}: {
  categories: ExpenseCategoryOption[];
  suppliers: SupplierOption[];
  custodyFunds: CustodyFundOption[];
  hasOpenCashSession: boolean;
  onClose: () => void;
}) {
  const [state, action] = useActionState(registerExpenseAction, initialState);
  const [source, setSource] = useState("cash_session");
  const router = useRouter();

  useEffect(() => {
    if (state.status !== "success") return;
    const timeout = window.setTimeout(() => {
      onClose();
      router.refresh();
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [onClose, router, state.status]);

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-label="Registrar gasto" aria-modal="true" className="modal-panel purchase-modal" role="dialog">
        <header className="modal-header">
          <div>
            <strong>Registrar gasto</strong>
            <span>Elige si afecta caja, banco, fondo o solo queda registrado.</span>
          </div>
          <button className="icon-button" onClick={onClose} title="Cerrar" type="button"><X size={18} /></button>
        </header>
        <form action={action} className="compact-card">
          <div className="form-grid">
            <div className="field">
              <label>Categoria</label>
              <select name="category_id" required>
                <option value="">Seleccionar</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Valor</label>
              <input inputMode="decimal" min="0.01" name="amount_cop" placeholder="$ 0" required type="number" />
            </div>
            <div className="field">
              <label>Fecha y hora</label>
              <input defaultValue={localDateTimeValue()} name="spent_at" required type="datetime-local" />
            </div>
            <div className="field">
              <label>Origen del pago</label>
              <select name="payment_source" onChange={(event) => setSource(event.target.value)} value={source}>
                <option value="cash_session">Caja actual</option>
                <option value="bank_transfer">Banco / Transferencia</option>
                <option value="custody_fund">Fondo de resguardo</option>
                <option value="other">Otro / No afecta caja</option>
              </select>
            </div>
            <div className="field full">
              <label>Concepto / descripcion</label>
              <input autoComplete="off" name="description" placeholder="Concepto del gasto" required />
            </div>
            {source === "custody_fund" ? (
              <div className="field">
                <label>Fondo de resguardo</label>
                <select name="custody_fund_id" required>
                  {custodyFunds.map((fund) => <option key={fund.id} value={fund.id}>{fund.name} - {formatCop(fund.balance_cop)}</option>)}
                </select>
              </div>
            ) : null}
            <div className="field">
              <label>Proveedor</label>
              <select name="supplier_id">
                <option value="">Sin proveedor</option>
                {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Proveedor / beneficiario</label>
              <input autoComplete="off" name="beneficiary_name" placeholder="Opcional" />
            </div>
            <div className="field">
              <label>Documento / factura</label>
              <input autoComplete="off" name="document_number" placeholder="Opcional" />
            </div>
            <div className="field full">
              <label>Comprobante</label>
              <input autoComplete="off" name="receipt_url" placeholder="URL o referencia opcional" />
            </div>
            <div className="field full">
              <label>Observaciones</label>
              <textarea name="notes" placeholder="Opcional" />
            </div>
          </div>
          {source === "cash_session" && !hasOpenCashSession ? <p className="alert">No hay caja abierta. Abre caja antes de pagar gastos desde Caja actual.</p> : null}
          {state.status !== "idle" ? <p className={`form-status ${state.status}`}>{state.message}</p> : null}
          <div className="form-actions">
            <button className="ghost-button" onClick={onClose} type="button">Cancelar</button>
            <SubmitButton disabled={source === "cash_session" && !hasOpenCashSession} label="Guardar gasto" />
          </div>
        </form>
      </section>
    </div>
  );
}

function VoidExpenseButton({ id }: { id: string }) {
  const [state, action] = useActionState(voidExpenseAction, initialState);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state.status]);

  return (
    <form action={action} className="inline-form product-delete-form">
      <input name="id" type="hidden" value={id} />
      <input name="reason" type="hidden" value="Anulado desde gastos" />
      <button
        className="icon-button danger-button"
        onClick={(event) => {
          if (!window.confirm("Anular este gasto? Si afecto caja o fondo, se intentara revertir el movimiento.")) event.preventDefault();
        }}
        title="Anular gasto"
        type="submit"
      >
        <Trash2 size={16} />
      </button>
      {state.status !== "idle" ? <span className={`row-action-message ${state.status}`}>{state.message}</span> : null}
    </form>
  );
}

function SubmitButton({ disabled, label }: { disabled?: boolean; label: string }) {
  const { pending } = useFormStatus();
  return <button className="positive-button" disabled={disabled || pending} type="submit">{pending ? "Guardando..." : label}</button>;
}
