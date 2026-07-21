"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Check, Pencil, Plus, X } from "lucide-react";
import { saveConservationProfile, type ConservationProfileActionState } from "@/app/admin/actions";
import { normalizeMasterText, uppercaseMasterName } from "@/lib/master-normalization";

export type ConservationRule = {
  id: string;
  storage_method: "ambient" | "refrigerated" | "frozen";
  duration_value: number;
  duration_unit: "hours" | "days" | "weeks" | "months";
  notes: string | null;
};

export type ConservationProfile = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  conservation_profile_rules: ConservationRule[];
};

const initialFormActionState: ConservationProfileActionState = { status: "idle", message: "" };

const storageMethods = [
  { value: "ambient", label: "Ambiente" },
  { value: "refrigerated", label: "Refrigerado" },
  { value: "frozen", label: "Congelado" }
] as const;

const durationUnits = [
  { value: "hours", label: "Horas" },
  { value: "days", label: "Dias" },
  { value: "weeks", label: "Semanas" },
  { value: "months", label: "Meses" }
] as const;

function ruleSummary(profile: ConservationProfile) {
  if (profile.conservation_profile_rules.length === 0) return "Sin reglas";
  return profile.conservation_profile_rules
    .map((rule) => {
      const method = storageMethods.find((item) => item.value === rule.storage_method)?.label ?? rule.storage_method;
      const unit = durationUnits.find((item) => item.value === rule.duration_unit)?.label ?? rule.duration_unit;
      return `${method}: ${rule.duration_value} ${unit}`;
    })
    .join(" / ");
}

export function ConservationProfilesModule({
  profiles,
  allProfiles
}: {
  profiles: ConservationProfile[];
  allProfiles: Pick<ConservationProfile, "id" | "name" | "is_active">[];
}) {
  const [editingProfile, setEditingProfile] = useState<ConservationProfile | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <section className="form-panel">
      <div className="section-title-row inventory-toolbar-row">
        <h2>Perfiles de conservacion</h2>
        <button
          className="primary-button add-purchase-button"
          onClick={() => {
            setEditingProfile(null);
            setIsModalOpen(true);
          }}
          type="button"
        >
          <Plus size={18} /> Agregar perfil
        </button>
      </div>
      <div className="data-table-wrap">
        <table className="data-table master-data-table">
          <thead>
            <tr>
              <th>Acciones</th>
              <th>Nombre</th>
              <th>Reglas</th>
              <th>Descripcion</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((profile) => (
              <tr key={profile.id}>
                <td>
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
                </td>
                <td>
                  <strong>{profile.name}</strong>
                </td>
                <td>{ruleSummary(profile)}</td>
                <td>{profile.description || "Sin descripcion"}</td>
                <td>
                  <span className={`stock-pill ${profile.is_active ? "ok" : "danger"}`}>{profile.is_active ? "Activo" : "Inactivo"}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {profiles.length === 0 ? <p className="muted">No hay perfiles de conservacion.</p> : null}
      </div>
      {isModalOpen ? (
        <ConservationProfileModal
          allProfiles={allProfiles}
          onClose={() => setIsModalOpen(false)}
          profile={editingProfile}
          title={editingProfile ? `Editar ${editingProfile.name}` : "Agregar perfil"}
        />
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
            <span>Perfil maestro con reglas por conservacion.</span>
          </div>
          <button className="icon-button" onClick={onClose} title="Cerrar" type="button">
            <X size={18} />
          </button>
        </header>
        <form action={formAction} className="compact-card">
          {profile ? <input name="id" type="hidden" value={profile.id} /> : null}
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
                  if (event.key === "Escape") {
                    setIsOpen(false);
                  }
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
              {duplicateProfile ? <p className="field-hint danger">Ese perfil ya esta registrado.</p> : null}
            </div>
            <div className="field full">
              <label>Descripcion</label>
              <textarea name="description" onChange={(event) => setDescription(event.target.value.toUpperCase())} value={description} />
            </div>
            <div className="field full">
              <label>Reglas</label>
              <div className="recipe-lines">
                {storageMethods.map((method, index) => {
                  const existingRule = profile?.conservation_profile_rules.find((rule) => rule.storage_method === method.value);
                  return (
                    <div className="recipe-line conservation-rule-line" key={method.value}>
                      <input name={`rules[${index}][storage_method]`} type="hidden" value={method.value} />
                      <label className="check-option">
                        <input defaultChecked={Boolean(existingRule) || (!profile && index === 0)} name={`rules[${index}][enabled]`} type="checkbox" />
                        <span>{method.label}</span>
                      </label>
                      <input defaultValue={existingRule?.duration_value ?? ""} min="1" name={`rules[${index}][duration_value]`} placeholder="Duracion" type="number" />
                      <select defaultValue={existingRule?.duration_unit ?? "days"} name={`rules[${index}][duration_unit]`}>
                        {durationUnits.map((unit) => (
                          <option key={unit.value} value={unit.value}>
                            {unit.label}
                          </option>
                        ))}
                      </select>
                      <input defaultValue={existingRule?.notes ?? ""} name={`rules[${index}][notes]`} placeholder="Notas" />
                    </div>
                  );
                })}
              </div>
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
            <SubmitButton disabled={Boolean(duplicateProfile) || !normalizedName} isEditing={Boolean(profile)} />
          </div>
        </form>
      </section>
    </div>
  );
}

function SubmitButton({ disabled, isEditing }: { disabled: boolean; isEditing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className="primary-button" disabled={disabled || pending} type="submit">
      {pending ? "Guardando..." : isEditing ? "Actualizar perfil" : "Guardar perfil"}
    </button>
  );
}
