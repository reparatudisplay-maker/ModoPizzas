"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, X } from "lucide-react";
import { deleteExpenseCategory, moveExpenseCategory, saveExpenseCategory, type FormActionState } from "@/app/admin/actions";
import { normalizeMasterText, uppercaseMasterName } from "@/lib/master-normalization";

export type ExpenseCategoryRow = {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
};

const initialState: FormActionState = { status: "idle", message: "" };

export function ExpenseCategoriesModule({
  categories,
  allCategories,
  q,
  status
}: {
  categories: ExpenseCategoryRow[];
  allCategories: Pick<ExpenseCategoryRow, "id" | "name" | "is_active">[];
  q: string;
  status: string;
}) {
  const [editing, setEditing] = useState<ExpenseCategoryRow | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <section className="form-panel">
      <div className="section-title-row inventory-toolbar-row">
        <h2>Categorias de gasto</h2>
        <div className="purchase-toolbar">
          <form className="table-filters">
            <input autoComplete="off" defaultValue={q} name="q" placeholder="Buscar categoria" />
            <select defaultValue={status} name="status" title="Estado">
              <option value="">Todos</option>
              <option value="active">Activas</option>
              <option value="inactive">Inactivas</option>
            </select>
            <button className="ghost-button" type="submit">Buscar</button>
          </form>
          <button className="positive-button add-purchase-button" onClick={() => { setEditing(null); setModalOpen(true); }} type="button">
            <Plus size={18} /> Agregar categoria
          </button>
        </div>
      </div>
      <div className="data-table-wrap">
        <table className="data-table master-data-table compact-fit-table">
          <thead>
            <tr>
              <th>Orden</th>
              <th>Nombre</th>
              <th>Descripcion</th>
              <th>Estado</th>
              <th className="actions-column compact-actions-column">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((category, index) => (
              <tr key={category.id}>
                <td>
                  <span className="row-actions center-actions">
                    {categories.length > 1 && index > 0 ? <CategoryOrderButton direction="up" id={category.id} /> : null}
                    {categories.length > 1 && index < categories.length - 1 ? <CategoryOrderButton direction="down" id={category.id} /> : null}
                  </span>
                </td>
                <td><strong>{category.name}</strong></td>
                <td>{category.description || "Sin descripcion"}</td>
                <td><span className={`stock-pill ${category.is_active ? "ok" : "danger"}`}>{category.is_active ? "Activa" : "Inactiva"}</span></td>
                <td className="actions-column compact-actions-column">
                  <span className="row-actions center-actions">
                    <button className="icon-button" onClick={() => { setEditing(category); setModalOpen(true); }} title="Editar" type="button">
                      <Pencil size={16} />
                    </button>
                    <CategoryDeleteButton id={category.id} name={category.name} />
                  </span>
                </td>
              </tr>
            ))}
            {categories.length === 0 ? <tr><td colSpan={5}>Sin categorias.</td></tr> : null}
          </tbody>
        </table>
      </div>
      {modalOpen ? <ExpenseCategoryModal allCategories={allCategories} category={editing} onClose={() => setModalOpen(false)} /> : null}
    </section>
  );
}

function ExpenseCategoryModal({
  category,
  allCategories,
  onClose
}: {
  category: ExpenseCategoryRow | null;
  allCategories: Pick<ExpenseCategoryRow, "id" | "name" | "is_active">[];
  onClose: () => void;
}) {
  const [state, action] = useActionState(saveExpenseCategory, initialState);
  const [name, setName] = useState(category?.name ?? "");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const router = useRouter();
  const normalizedName = normalizeMasterText(name);
  const matches = useMemo(
    () => allCategories.filter((item) => item.id !== category?.id && normalizedName && normalizeMasterText(item.name).includes(normalizedName)).slice(0, 8),
    [allCategories, category?.id, normalizedName]
  );
  const duplicate = allCategories.find((item) => item.id !== category?.id && normalizeMasterText(item.name) === normalizedName);

  useEffect(() => {
    if (state.status !== "success") return;
    const timeout = window.setTimeout(() => {
      onClose();
      router.refresh();
    }, 600);
    return () => window.clearTimeout(timeout);
  }, [onClose, router, state.status]);

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-label="Categoria de gasto" aria-modal="true" className="modal-panel purchase-modal" role="dialog">
        <header className="modal-header">
          <div>
            <strong>{category ? "Editar categoria" : "Agregar categoria"}</strong>
            <span>Maestro de gastos</span>
          </div>
          <button className="icon-button" onClick={onClose} title="Cerrar" type="button"><X size={18} /></button>
        </header>
        <form action={action} className="compact-card">
          {category ? <input name="id" type="hidden" value={category.id} /> : null}
          <div className="form-grid">
            <div className="field autocomplete-field full">
              <label>Nombre</label>
              <input
                autoComplete="off"
                name="name"
                onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
                onChange={(event) => { setName(uppercaseMasterName(event.target.value)); setIsOpen(true); setActiveIndex(0); }}
                onFocus={() => setIsOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") { event.preventDefault(); setIsOpen(true); setActiveIndex((current) => Math.min(current + 1, Math.max(matches.length - 1, 0))); }
                  if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((current) => Math.max(current - 1, 0)); }
                  if (event.key === "Enter" && matches[activeIndex]) { event.preventDefault(); setName(matches[activeIndex].name); setIsOpen(false); }
                  if (event.key === "Escape") setIsOpen(false);
                }}
                required
                value={name}
              />
              {isOpen ? (
                <div className="autocomplete-menu">
                  {matches.map((item, index) => (
                    <button className={`autocomplete-option duplicate-option${index === activeIndex ? " active" : ""}`} key={item.id} onMouseDown={(event) => { event.preventDefault(); setName(item.name); setIsOpen(false); }} type="button">
                      <span>{item.name}</span>
                      <span className="availability-badge danger">- REGISTRADO <X size={14} /></span>
                    </button>
                  ))}
                  {name.trim() ? (
                    <div className={`autocomplete-option availability-row ${duplicate ? "danger" : "ok"}`}>
                      <span>{name}</span>
                      <span className={`availability-badge ${duplicate ? "danger" : "ok"}`}>- {duplicate ? "REGISTRADO" : "REGISTRABLE"} {duplicate ? "✕" : "✔"}</span>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {duplicate ? <p className="field-hint danger">Esta categoria ya esta registrada.</p> : null}
            </div>
            <div className="field full">
              <label>Descripcion</label>
              <textarea defaultValue={category?.description ?? ""} name="description" />
            </div>
          </div>
          <label className="check-option">
            <input defaultChecked={category?.is_active ?? true} name="is_active" type="checkbox" />
            <span>Activa</span>
          </label>
          {state.status !== "idle" ? <p className={`form-status ${state.status}`}>{state.message}</p> : null}
          <div className="form-actions">
            <button className="ghost-button" onClick={onClose} type="button">Cancelar</button>
            <SubmitButton disabled={!normalizedName || Boolean(duplicate)} label={category ? "Actualizar" : "Guardar"} />
          </div>
        </form>
      </section>
    </div>
  );
}

function SubmitButton({ disabled, label }: { disabled: boolean; label: string }) {
  const { pending } = useFormStatus();
  return <button className="positive-button" disabled={disabled || pending} type="submit">{pending ? "Guardando..." : label}</button>;
}

function CategoryOrderButton({ id, direction }: { id: string; direction: "up" | "down" }) {
  const [state, action] = useActionState(moveExpenseCategory, initialState);
  const router = useRouter();
  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.status]);
  return (
    <form action={action} className="inline-form">
      <input name="id" type="hidden" value={id} />
      <input name="direction" type="hidden" value={direction} />
      <button className="icon-button" title={direction === "up" ? "Subir" : "Bajar"} type="submit">
        {direction === "up" ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
      </button>
    </form>
  );
}

function CategoryDeleteButton({ id, name }: { id: string; name: string }) {
  const [state, action] = useActionState(deleteExpenseCategory, initialState);
  const router = useRouter();
  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.status]);
  return (
    <form action={action} className="inline-form product-delete-form">
      <input name="id" type="hidden" value={id} />
      <button className="icon-button danger-button" onClick={(event) => { if (!window.confirm(`Eliminar ${name}?`)) event.preventDefault(); }} title="Eliminar" type="submit">
        <Trash2 size={16} />
      </button>
      {state.status !== "idle" ? <span className={`row-action-message ${state.status}`}>{state.message}</span> : null}
    </form>
  );
}
