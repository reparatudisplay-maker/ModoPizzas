"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Settings, Trash2, X } from "lucide-react";
import {
  deleteConservationProfile,
  moveConservationProfile,
  saveConservationProfile,
  type ConservationProfileActionState,
  type FormActionState
} from "@/app/admin/actions";
import { normalizeMasterText, uppercaseMasterName } from "@/lib/master-normalization";

type StorageMethod = "ambient" | "refrigerated" | "frozen";
type DurationUnit = "hours" | "days";
type ColumnKey = "sku" | "method" | "duration" | "temperature" | "description" | "status" | "actions";

export type ConservationRule = {
  id: string;
  storage_method: StorageMethod;
  duration_value: number;
  duration_unit: DurationUnit;
  temperature_min: number | null;
  temperature_max: number | null;
  notes: string | null;
};

type EditableRule = {
  storage_method: StorageMethod;
  enabled: boolean;
  duration_value: string;
  duration_unit: DurationUnit;
  temperature_min: string;
  temperature_max: string;
};

export type ConservationProfile = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  sort_order: number;
  temperature_min: number | null;
  temperature_max: number | null;
  is_active: boolean;
  created_at: string;
  conservation_profile_rules: ConservationRule[];
};

const initialFormActionState: ConservationProfileActionState = { status: "idle", message: "" };
const initialActionState: FormActionState = { status: "idle", message: "" };
const columnStorageKey = "modopizzas.conservation-profiles.columns";
const allColumns: ColumnKey[] = ["sku", "method", "duration", "temperature", "description", "status", "actions"];
const defaultColumns: ColumnKey[] = ["sku", "method", "duration", "temperature", "status", "actions"];

const storageMethods = [
  { value: "ambient", label: "Ambiente" },
  { value: "refrigerated", label: "Refrigerado" },
  { value: "frozen", label: "Congelado" }
] as const;

const durationUnits = [
  { value: "hours", label: "Horas" },
  { value: "days", label: "Dias" }
] as const;

function readColumns() {
  if (typeof window === "undefined") return defaultColumns;
  const saved = window.localStorage.getItem(columnStorageKey);
  if (!saved) return defaultColumns;
  try {
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return defaultColumns;
    const clean = parsed.filter((column): column is ColumnKey => typeof column === "string" && allColumns.includes(column as ColumnKey));
    return clean.length ? clean : defaultColumns;
  } catch {
    window.localStorage.removeItem(columnStorageKey);
    return defaultColumns;
  }
}

function columnLabel(column: ColumnKey) {
  const labels: Record<ColumnKey, string> = {
    sku: "SKU",
    method: "Metodo",
    duration: "Duracion",
    temperature: "Temperatura",
    description: "Descripcion",
    status: "Estado",
    actions: "Acciones"
  };
  return labels[column];
}

function methodLabel(value?: string) {
  return storageMethods.find((item) => item.value === value)?.label ?? "Sin metodo";
}

function unitLabel(value?: string, amount = 2) {
  const singular = amount === 1;
  if (value === "hours") return singular ? "hora" : "horas";
  return singular ? "dia" : "dias";
}

function orderedRules(profile: ConservationProfile) {
  return [...profile.conservation_profile_rules].sort(
    (a, b) => storageMethods.findIndex((method) => method.value === a.storage_method) - storageMethods.findIndex((method) => method.value === b.storage_method)
  );
}

function durationSummary(profile: ConservationProfile) {
  const rules = orderedRules(profile);
  if (rules.length === 0) return "Sin duracion";
  return rules.map((rule) => `${methodLabel(rule.storage_method)}: ${rule.duration_value} ${unitLabel(rule.duration_unit, rule.duration_value)}`).join(" / ");
}

function ruleTemperatureSummary(rule: ConservationRule) {
  const min = rule.temperature_min;
  const max = rule.temperature_max;
  if (min === null && max === null) return "Sin rango";
  if (min !== null && max !== null) return `${min} a ${max} C`;
  if (min !== null) return `Min. ${min} C`;
  return `Max. ${max} C`;
}

function temperatureSummary(profile: ConservationProfile) {
  const rules = orderedRules(profile);
  if (rules.length === 0) return "Sin rango";
  return rules.map((rule) => `${methodLabel(rule.storage_method)}: ${ruleTemperatureSummary(rule)}`).join(" / ");
}

function editableRules(profile: ConservationProfile | null): EditableRule[] {
  return storageMethods.map((method, index) => {
    const rule = profile?.conservation_profile_rules.find((item) => item.storage_method === method.value);
    return {
      storage_method: method.value,
      enabled: Boolean(rule) || (!profile && index === 0),
      duration_value: rule?.duration_value?.toString() ?? "",
      duration_unit: rule?.duration_unit ?? "days",
      temperature_min: rule?.temperature_min?.toString() ?? "",
      temperature_max: rule?.temperature_max?.toString() ?? ""
    };
  });
}

export function ConservationProfilesModule({
  profiles,
  allProfiles,
  q,
  status
}: {
  profiles: ConservationProfile[];
  allProfiles: Pick<ConservationProfile, "id" | "name" | "is_active">[];
  q: string;
  status: string;
}) {
  const [editingProfile, setEditingProfile] = useState<ConservationProfile | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(defaultColumns);
  const [columnsLoaded, setColumnsLoaded] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setVisibleColumns(readColumns());
      setColumnsLoaded(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (columnsLoaded) window.localStorage.setItem(columnStorageKey, JSON.stringify(visibleColumns));
  }, [columnsLoaded, visibleColumns]);

  function showColumn(column: ColumnKey) {
    return visibleColumns.includes(column);
  }

  function toggleColumn(column: ColumnKey) {
    setVisibleColumns((current) => {
      if (current.includes(column)) return current.filter((item) => item !== column);
      return [...current, column];
    });
  }

  return (
    <section className="form-panel">
      <div className="section-title-row inventory-toolbar-row">
        <h2>Perfiles de conservacion</h2>
        <div className="purchase-toolbar">
          <form className="table-filters">
            <input autoComplete="off" defaultValue={q} name="q" placeholder="Buscar perfil" />
            <select defaultValue={status} name="status" title="Estado">
              <option value="">Todos</option>
              <option value="active">Activos</option>
              <option value="inactive">Inactivos</option>
            </select>
            <button className="ghost-button" type="submit">
              Buscar
            </button>
          </form>
          <button className="ghost-button icon-text-button" onClick={() => setShowSettings(true)} type="button">
            <Settings size={18} /> Configuracion
          </button>
          <button
            className="positive-button add-purchase-button"
            onClick={() => {
              setEditingProfile(null);
              setIsModalOpen(true);
            }}
            type="button"
          >
            <Plus size={18} /> Agregar perfil
          </button>
        </div>
      </div>
      <div className="data-table-wrap">
        <table className="data-table master-data-table">
          <thead>
            <tr>
              <th>Orden</th>
              {showColumn("sku") ? <th>SKU</th> : null}
              <th>Nombre</th>
              {showColumn("method") ? <th>Metodo</th> : null}
              {showColumn("duration") ? <th>Duracion</th> : null}
              {showColumn("temperature") ? <th>Temperatura</th> : null}
              {showColumn("description") ? <th>Descripcion</th> : null}
              {showColumn("status") ? <th>Estado</th> : null}
              {showColumn("actions") ? <th>Acciones</th> : null}
            </tr>
          </thead>
          <tbody>
            {profiles.map((profile, index) => {
              return (
                <tr key={profile.id}>
                  <td>
                    <span className="row-actions center-actions">
                      {profiles.length > 1 && index > 0 ? <ProfileOrderButton direction="up" id={profile.id} /> : null}
                      {profiles.length > 1 && index < profiles.length - 1 ? <ProfileOrderButton direction="down" id={profile.id} /> : null}
                    </span>
                  </td>
                  {showColumn("sku") ? <td>{profile.sku}</td> : null}
                  <td>
                    <strong>{profile.name}</strong>
                  </td>
                  {showColumn("method") ? <td>{orderedRules(profile).map((rule) => methodLabel(rule.storage_method)).join(" / ") || "Sin metodo"}</td> : null}
                  {showColumn("duration") ? <td>{durationSummary(profile)}</td> : null}
                  {showColumn("temperature") ? <td>{temperatureSummary(profile)}</td> : null}
                  {showColumn("description") ? <td>{profile.description || "Sin descripcion"}</td> : null}
                  {showColumn("status") ? (
                    <td>
                      <span className={`stock-pill ${profile.is_active ? "ok" : "danger"}`}>{profile.is_active ? "Activo" : "Inactivo"}</span>
                    </td>
                  ) : null}
                  {showColumn("actions") ? (
                    <td>
                      <span className="row-actions center-actions">
                        <button
                          className="icon-button"
                          onClick={() => {
                            setEditingProfile(profile);
                            setIsModalOpen(true);
                          }}
                          title={`Editar ${profile.name}`}
                          type="button"
                        >
                          <Pencil size={16} />
                        </button>
                        <ProfileDeleteButton id={profile.id} name={profile.name} />
                      </span>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
        {profiles.length === 0 ? <p className="muted">No hay perfiles de conservacion con esos filtros.</p> : null}
      </div>
      {isModalOpen ? (
        <ConservationProfileModal
          allProfiles={allProfiles}
          onClose={() => setIsModalOpen(false)}
          profile={editingProfile}
          title={editingProfile ? `Editar ${editingProfile.name}` : "Agregar perfil"}
        />
      ) : null}
      {showSettings ? (
        <div className="modal-backdrop" role="presentation">
          <section aria-label="Configuracion de columnas" aria-modal="true" className="modal-panel inventory-settings-modal" role="dialog">
            <header className="modal-header">
              <div>
                <strong>Configuracion de perfiles</strong>
                <span>Preferencias guardadas en este navegador.</span>
              </div>
              <button className="icon-button" onClick={() => setShowSettings(false)} title="Cerrar" type="button">
                <X size={18} />
              </button>
            </header>
            <div className="compact-card">
              <div className="field full">
                <label>Columnas</label>
                <div className="column-settings-grid">
                  {allColumns.map((column) => (
                    <label className="check-option" key={column}>
                      <input checked={visibleColumns.includes(column)} onChange={() => toggleColumn(column)} type="checkbox" />
                      <span>{columnLabel(column)}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="form-actions">
                <button className="ghost-button" onClick={() => setVisibleColumns(defaultColumns)} type="button">
                  Restablecer columnas
                </button>
                <button className="positive-button" onClick={() => setShowSettings(false)} type="button">
                  Cerrar
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

export function ConservationProfileModal({
  title,
  profile,
  allProfiles,
  onClose,
  onSaved,
  nested = false
}: {
  title: string;
  profile: ConservationProfile | null;
  allProfiles: Pick<ConservationProfile, "id" | "name" | "is_active">[];
  onClose: () => void;
  onSaved?: (profile: ConservationProfileActionState["profile"]) => void;
  nested?: boolean;
}) {
  const [state, formAction] = useActionState(saveConservationProfile, initialFormActionState);
  const [name, setName] = useState(profile?.name ?? "");
  const [description, setDescription] = useState(profile?.description ?? "");
  const [rules, setRules] = useState<EditableRule[]>(() => editableRules(profile));
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const router = useRouter();
  const normalizedName = normalizeMasterText(name);
  const matchingProfiles = useMemo(() => {
    if (!normalizedName) return [];
    return allProfiles.filter((item) => item.id !== profile?.id && normalizeMasterText(item.name).includes(normalizedName)).slice(0, 8);
  }, [allProfiles, normalizedName, profile?.id]);
  const duplicateProfile = allProfiles.find((item) => item.id !== profile?.id && normalizeMasterText(item.name) === normalizedName);
  const canRegisterName = normalizedName.length > 0 && !duplicateProfile;
  const enabledRules = rules.filter((ruleItem) => ruleItem.enabled);
  const invalidDuration = enabledRules.some((ruleItem) => Number(ruleItem.duration_value.replace(",", ".")) <= 0 || !ruleItem.duration_value.trim());
  const invalidTemperature = enabledRules.some((ruleItem) => {
    const minNumber = ruleItem.temperature_min.trim() ? Number(ruleItem.temperature_min.replace(",", ".")) : null;
    const maxNumber = ruleItem.temperature_max.trim() ? Number(ruleItem.temperature_max.replace(",", ".")) : null;
    return minNumber !== null && maxNumber !== null && minNumber > maxNumber;
  });
  const invalidRules = enabledRules.length === 0 || invalidDuration || invalidTemperature;

  function updateRule(index: number, patch: Partial<EditableRule>) {
    setRules((current) => current.map((ruleItem, currentIndex) => (currentIndex === index ? { ...ruleItem, ...patch } : ruleItem)));
  }

  useEffect(() => {
    if (state.status !== "success") return;
    const timeout = window.setTimeout(() => {
      onSaved?.(state.profile);
      onClose();
      router.refresh();
    }, 1000);
    return () => window.clearTimeout(timeout);
  }, [onClose, onSaved, router, state.profile, state.status]);

  return (
    <div className={`modal-backdrop${nested ? " nested-modal-backdrop" : ""}`} role="presentation">
      <section aria-label={title} aria-modal="true" className="modal-panel purchase-modal" role="dialog">
        <header className="modal-header">
          <div>
            <strong>{title}</strong>
            <span>Perfil maestro para calcular vencimientos.</span>
          </div>
          <button className="icon-button" onClick={onClose} title="Cerrar" type="button">
            <X size={18} />
          </button>
        </header>
        <form action={formAction} className="compact-card">
          {profile ? <input name="id" type="hidden" value={profile.id} /> : null}
          {profile ? (
            <div className="field">
              <label>SKU</label>
              <input readOnly value={profile.sku} />
            </div>
          ) : null}
          <div className="form-grid">
            <div className="field autocomplete-field full">
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
                    setActiveIndex((current) => Math.min(current + 1, Math.max(matchingProfiles.length - 1, 0)));
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActiveIndex((current) => Math.max(current - 1, 0));
                  }
                  if (event.key === "Enter" && matchingProfiles[activeIndex]) {
                    event.preventDefault();
                    setName(matchingProfiles[activeIndex].name);
                    setIsOpen(false);
                  }
                  if (event.key === "Escape") setIsOpen(false);
                }}
                required
                value={name}
              />
              {isOpen ? (
                <div className="autocomplete-menu">
                  {matchingProfiles.map((item, index) => (
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
                      <span className="availability-badge danger">- REGISTRADO <X size={14} /></span>
                    </button>
                  ))}
                  {name.trim() ? (
                    <div className={`autocomplete-option availability-row ${canRegisterName ? "ok" : "danger"}`}>
                      <span>{name}</span>
                      <span className={`availability-badge ${canRegisterName ? "ok" : "danger"}`}>
                        - {canRegisterName ? "REGISTRABLE" : "REGISTRADO"} {canRegisterName ? <Check size={14} /> : <X size={14} />}
                      </span>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {duplicateProfile ? <p className="field-hint danger">Este perfil ya esta registrado.</p> : null}
            </div>
            <div className="field full">
              <label>Metodos de conservacion</label>
              <div className="conservation-rule-grid">
                {rules.map((ruleItem, index) => (
                  <div className={`conservation-rule-card${ruleItem.enabled ? " active" : ""}`} key={ruleItem.storage_method}>
                    <input name={`rules[${index}][storage_method]`} type="hidden" value={ruleItem.storage_method} />
                    <label className="check-option">
                      <input
                        checked={ruleItem.enabled}
                        name={`rules[${index}][enabled]`}
                        onChange={(event) => updateRule(index, { enabled: event.target.checked })}
                        type="checkbox"
                      />
                      <span>{methodLabel(ruleItem.storage_method)}</span>
                    </label>
                    <div className="conservation-rule-fields">
                      <div className="field">
                        <label>Duracion</label>
                        <input
                          disabled={!ruleItem.enabled}
                          min="1"
                          name={`rules[${index}][duration_value]`}
                          onChange={(event) => updateRule(index, { duration_value: event.target.value })}
                          placeholder="Ej. 8"
                          required={ruleItem.enabled}
                          type="number"
                          value={ruleItem.duration_value}
                        />
                      </div>
                      <div className="field">
                        <label>Unidad</label>
                        <select
                          disabled={!ruleItem.enabled}
                          name={`rules[${index}][duration_unit]`}
                          onChange={(event) => updateRule(index, { duration_unit: event.target.value as DurationUnit })}
                          value={ruleItem.duration_unit}
                        >
                          {durationUnits.map((unit) => (
                            <option key={unit.value} value={unit.value}>
                              {unit.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="field">
                        <label>Min. C</label>
                        <input
                          disabled={!ruleItem.enabled}
                          name={`rules[${index}][temperature_min]`}
                          onChange={(event) => updateRule(index, { temperature_min: event.target.value })}
                          placeholder="Opcional"
                          type="number"
                          value={ruleItem.temperature_min}
                        />
                      </div>
                      <div className="field">
                        <label>Max. C</label>
                        <input
                          disabled={!ruleItem.enabled}
                          name={`rules[${index}][temperature_max]`}
                          onChange={(event) => updateRule(index, { temperature_max: event.target.value })}
                          placeholder="Opcional"
                          type="number"
                          value={ruleItem.temperature_max}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {enabledRules.length === 0 ? <p className="field-hint danger">Habilita al menos un metodo.</p> : null}
              {invalidDuration ? <p className="field-hint danger">Los metodos habilitados necesitan duracion mayor que cero.</p> : null}
              {invalidTemperature ? <p className="field-hint danger">La temperatura minima no puede superar la maxima.</p> : null}
            </div>
            <div className="field full">
              <label>Descripcion</label>
              <textarea name="description" onChange={(event) => setDescription(event.target.value.toUpperCase())} value={description} />
            </div>
          </div>
          <label className="check-option">
            <input defaultChecked={profile?.is_active ?? true} name="is_active" type="checkbox" />
            <span>Activo</span>
          </label>
          {state.status !== "idle" ? <p className={`form-status ${state.status}`}>{state.message}</p> : null}
          <div className="form-actions">
            <button className="ghost-button" onClick={onClose} type="button">
              Cancelar
            </button>
            <SubmitButton disabled={Boolean(duplicateProfile) || !normalizedName || invalidRules} isEditing={Boolean(profile)} />
          </div>
        </form>
      </section>
    </div>
  );
}

function SubmitButton({ disabled, isEditing }: { disabled: boolean; isEditing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className="positive-button" disabled={disabled || pending} type="submit">
      {pending ? "Guardando..." : isEditing ? "Actualizar perfil" : "Guardar perfil"}
    </button>
  );
}

function ProfileOrderButton({ id, direction }: { id: string; direction: "up" | "down" }) {
  const [state, formAction] = useActionState(moveConservationProfile, initialActionState);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state.status]);

  return (
    <form action={formAction} className="inline-form">
      <input name="id" type="hidden" value={id} />
      <input name="direction" type="hidden" value={direction} />
      <button className="icon-button" title={direction === "up" ? "Subir" : "Bajar"} type="submit">
        {direction === "up" ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
      </button>
    </form>
  );
}

function ProfileDeleteButton({ id, name }: { id: string; name: string }) {
  const [state, formAction] = useActionState(deleteConservationProfile, initialActionState);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state.status]);

  return (
    <form action={formAction} className="inline-form product-delete-form">
      <input name="id" type="hidden" value={id} />
      <button
        className="icon-button danger-button"
        onClick={(event) => {
          if (!window.confirm(`Eliminar ${name}? Esta accion no se puede deshacer.`)) event.preventDefault();
        }}
        title={`Eliminar ${name}`}
        type="submit"
      >
        <Trash2 size={16} />
      </button>
      {state.status !== "idle" ? <span className={`row-action-message ${state.status}`}>{state.message}</span> : null}
    </form>
  );
}
