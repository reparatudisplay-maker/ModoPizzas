"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Pencil, Plus, X } from "lucide-react";
import {
  deleteBrand,
  deleteProductCategory,
  deleteSupplier,
  saveBrandState,
  saveProductCategoryState,
  saveSupplierState,
  type CategoryActionState,
  type FormActionState
} from "@/app/admin/actions";
import { normalizeMasterText, uppercaseMasterName } from "@/lib/master-normalization";

type MasterKind = "category" | "brand" | "supplier";

export type MasterRecord = {
  id: string;
  name: string;
  is_active: boolean;
  description?: string | null;
  category?: string | null;
  phone?: string | null;
  notes?: string | null;
};

type MasterModuleProps = {
  kind: MasterKind;
  title: string;
  addLabel: string;
  records: MasterRecord[];
  allRecords: Pick<MasterRecord, "id" | "name" | "is_active">[];
  q: string;
  status: string;
  limit: string;
  limitLabels: {
    fifteen: string;
    thirty: string;
    all: string;
  };
  emptyText: string;
};

const initialFormActionState: FormActionState = { status: "idle", message: "" };
const initialCategoryActionState: CategoryActionState = { status: "idle", message: "" };

function saveActionFor(kind: MasterKind) {
  if (kind === "category") return saveProductCategoryState;
  if (kind === "brand") return saveBrandState;
  return saveSupplierState;
}

function deleteActionFor(kind: MasterKind) {
  if (kind === "category") return deleteProductCategory;
  if (kind === "brand") return deleteBrand;
  return deleteSupplier;
}

function statusLabel(active: boolean) {
  return active ? "Activo" : "Inactivo";
}

function registeredText(kind: MasterKind) {
  if (kind === "category") return "categoria";
  if (kind === "brand") return "marca";
  return "proveedor";
}

export function MasterDataModule({ kind, title, addLabel, records, allRecords, q, status, limit, limitLabels, emptyText }: MasterModuleProps) {
  const [editingRecord, setEditingRecord] = useState<MasterRecord | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <section className="form-panel">
      <div className="section-title-row inventory-toolbar-row">
        <h2>{title}</h2>
        <div className="purchase-toolbar">
          <form className="table-filters">
            <input autoComplete="off" defaultValue={q} name="q" placeholder="Buscar" />
            <select defaultValue={status} name="status" title="Estado">
              <option value="">Todos</option>
              <option value="active">Activos</option>
              <option value="inactive">Inactivos</option>
            </select>
            <select defaultValue={limit} name="limit" title="Cantidad de registros">
              <option value="15">{limitLabels.fifteen}</option>
              <option value="30">{limitLabels.thirty}</option>
              <option value="all">{limitLabels.all}</option>
            </select>
            <button className="ghost-button" type="submit">
              Buscar
            </button>
          </form>
          <button
            className="primary-button add-purchase-button"
            onClick={() => {
              setEditingRecord(null);
              setIsModalOpen(true);
            }}
            type="button"
          >
            <Plus size={18} /> {addLabel}
          </button>
        </div>
      </div>
      <div className="data-table-wrap">
        <table className="data-table master-data-table">
          <thead>
            <tr>
              <th>Acciones</th>
              <th>Nombre</th>
              {kind === "category" ? <th>Descripcion</th> : null}
              {kind === "brand" ? <th>Categoria</th> : null}
              {kind === "supplier" ? <th>Telefono</th> : null}
              <th>Notas</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={record.id}>
                <td>
                  <span className="row-actions center-actions">
                    <button
                      className="icon-button"
                      onClick={() => {
                        setEditingRecord(record);
                        setIsModalOpen(true);
                      }}
                      title={`Editar ${record.name}`}
                      type="button"
                    >
                      <Pencil size={16} />
                    </button>
                    <MasterDeleteButton id={record.id} kind={kind} name={record.name} />
                  </span>
                </td>
                <td>
                  <strong>{record.name}</strong>
                </td>
                {kind === "category" ? <td>{record.description || "Sin descripcion"}</td> : null}
                {kind === "brand" ? <td>{record.category || "Sin categoria"}</td> : null}
                {kind === "supplier" ? <td>{record.phone || "Sin telefono"}</td> : null}
                <td>{record.notes || "Sin notas"}</td>
                <td>
                  <span className={`stock-pill ${record.is_active ? "ok" : "danger"}`}>{statusLabel(record.is_active)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {records.length === 0 ? <p className="muted">{emptyText}</p> : null}
      </div>
      {isModalOpen ? (
        <MasterFormModal
          allRecords={allRecords}
          kind={kind}
          onClose={() => setIsModalOpen(false)}
          record={editingRecord}
          title={editingRecord ? `Editar ${editingRecord.name}` : addLabel}
        />
      ) : null}
    </section>
  );
}

function MasterFormModal({
  kind,
  title,
  record,
  allRecords,
  onClose
}: {
  kind: MasterKind;
  title: string;
  record: MasterRecord | null;
  allRecords: Pick<MasterRecord, "id" | "name" | "is_active">[];
  onClose: () => void;
}) {
  const action = saveActionFor(kind);
  const [state, formAction] = useActionState(action, kind === "category" ? initialCategoryActionState : initialFormActionState);
  const [name, setName] = useState(record?.name ?? "");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const router = useRouter();
  const normalizedName = normalizeMasterText(name);
  const matchingRecords = useMemo(() => {
    if (!normalizedName) return [];
    return allRecords
      .filter((item) => item.id !== record?.id && normalizeMasterText(item.name).includes(normalizedName))
      .slice(0, 8);
  }, [allRecords, normalizedName, record?.id]);
  const duplicateRecord = allRecords.find((item) => item.id !== record?.id && normalizeMasterText(item.name) === normalizedName);
  const canRegisterName = normalizedName.length > 0 && !duplicateRecord;

  useEffect(() => {
    if (state.status !== "success") return;
    const timeout = window.setTimeout(() => {
      onClose();
      router.refresh();
    }, 1000);
    return () => window.clearTimeout(timeout);
  }, [onClose, router, state.status]);

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-label={title} aria-modal="true" className="modal-panel purchase-modal" role="dialog">
        <header className="modal-header">
          <div>
            <strong>{title}</strong>
            <span>{registeredText(kind)} maestro</span>
          </div>
          <button className="icon-button" onClick={onClose} title="Cerrar" type="button">
            <X size={18} />
          </button>
        </header>
        <form action={formAction} className="compact-card">
          {record ? <input name="id" type="hidden" value={record.id} /> : null}
          <div className="form-grid">
            <div className="field autocomplete-field">
              <label>Nombre</label>
              <input
                autoComplete="off"
                name="name"
                onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
                onChange={(event) => {
                  setName(uppercaseMasterName(event.target.value));
                  setIsOpen(true);
                  setActiveIndex(0);
                }}
                onFocus={() => setIsOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setIsOpen(true);
                    setActiveIndex((current) => Math.min(current + 1, Math.max(matchingRecords.length - 1, 0)));
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActiveIndex((current) => Math.max(current - 1, 0));
                  }
                  if (event.key === "Enter" && matchingRecords[activeIndex]) {
                    event.preventDefault();
                    setName(matchingRecords[activeIndex].name);
                    setIsOpen(false);
                  }
                  if (event.key === "Escape") {
                    setIsOpen(false);
                  }
                }}
                required
                value={name}
              />
              {isOpen ? (
                <div className="autocomplete-menu">
                  {matchingRecords.map((item, index) => (
                    <button
                      className={`autocomplete-option duplicate-option${index === activeIndex ? " active" : ""}`}
                      key={item.id}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        setName(item.name);
                        setIsOpen(false);
                      }}
                      type="button"
                    >
                      <span>{item.name}</span>
                      <span className="availability-badge danger">— REGISTRADO <X size={14} /></span>
                    </button>
                  ))}
                  {name.trim() ? (
                    <div className={`autocomplete-option availability-row ${canRegisterName ? "ok" : "danger"}`}>
                      <span>{name}</span>
                      <span className={`availability-badge ${canRegisterName ? "ok" : "danger"}`}>
                        — {canRegisterName ? "REGISTRABLE" : "REGISTRADO"} {canRegisterName ? "✔" : <X size={14} />}
                      </span>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {duplicateRecord ? <p className="field-hint danger">Ese nombre ya esta registrado.</p> : null}
            </div>
            {kind === "category" ? (
              <div className="field full">
                <label>Descripcion</label>
                <textarea defaultValue={record?.description ?? ""} name="description" placeholder="Uso, tipo de productos o notas internas" />
              </div>
            ) : null}
            {kind === "brand" ? (
              <>
                <div className="field">
                  <label>Categoria</label>
                  <input defaultValue={record?.category ?? ""} name="category" placeholder="Harinas, quesos, carnes frias" />
                </div>
                <div className="field full">
                  <label>Notas</label>
                  <textarea defaultValue={record?.notes ?? ""} name="notes" />
                </div>
              </>
            ) : null}
            {kind === "supplier" ? (
              <>
                <div className="field">
                  <label>Telefono</label>
                  <input defaultValue={record?.phone ?? ""} name="phone" />
                </div>
                <div className="field full">
                  <label>Notas</label>
                  <textarea defaultValue={record?.notes ?? ""} name="notes" placeholder="Contacto, direccion, condiciones de pago o productos que suministra" />
                </div>
              </>
            ) : null}
          </div>
          <label className="check-option">
            <input defaultChecked={record?.is_active ?? true} name="is_active" type="checkbox" />
            <span>Activo</span>
          </label>
          {state.status !== "idle" ? <p className={`form-status ${state.status}`}>{state.message}</p> : null}
          <div className="form-actions">
            <button className="ghost-button" onClick={onClose} type="button">
              Cancelar
            </button>
            <MasterSubmitButton disabled={Boolean(duplicateRecord) || !normalizedName} isEditing={Boolean(record)} />
          </div>
        </form>
      </section>
    </div>
  );
}

function MasterSubmitButton({ disabled, isEditing }: { disabled: boolean; isEditing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className="primary-button" disabled={disabled || pending} type="submit">
      {pending ? "Guardando..." : isEditing ? "Actualizar" : "Guardar"}
    </button>
  );
}

function MasterDeleteButton({ kind, id, name }: { kind: MasterKind; id: string; name: string }) {
  const action = deleteActionFor(kind);
  const [state, formAction] = useActionState(action, initialFormActionState);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
    }
  }, [router, state.status]);

  return (
    <form action={formAction} className="inline-form product-delete-form">
      <input name="id" type="hidden" value={id} />
      <button
        className="icon-button danger-button"
        onClick={(event) => {
          if (!window.confirm(`Eliminar ${name}? Esta accion no se puede deshacer.`)) {
            event.preventDefault();
          }
        }}
        title={`Eliminar ${name}`}
        type="submit"
      >
        <X size={16} />
      </button>
      {state.status !== "idle" ? <span className={`row-action-message ${state.status}`}>{state.message}</span> : null}
    </form>
  );
}
