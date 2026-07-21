"use client";

import Image from "next/image";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Check, Copy, Eye, ImagePlus, Power, Plus, Settings, X } from "lucide-react";
import { savePreparation, togglePreparationState, type FormActionState } from "@/app/admin/actions";
import { ConservationProfileModal } from "@/components/conservation-profiles-module";
import { normalizeMasterText, uppercaseMasterName } from "@/lib/master-normalization";

type StockUnit = "g" | "kg" | "ml" | "l" | "unit";
type UnitKind = "weight" | "volume" | "unit";
type SourceKind = "inventory_item" | "preparation";
type DensityDisplayUnit = "g_ml" | "kg_l";

export type PreparationSource = {
  id: string;
  name: string;
  source_kind: SourceKind;
  unit_kind: UnitKind;
  base_unit: StockUnit;
};

export type ConservationProfileOption = {
  id: string;
  name: string;
  is_active: boolean;
  conservation_profile_rules?: Array<{
    id: string;
    storage_method: "ambient" | "refrigerated" | "frozen";
    duration_value: number;
    duration_unit: "hours" | "days" | "weeks" | "months";
    notes: string | null;
  }>;
};

export type PreparationRecipeLine = {
  id: string;
  source_kind: SourceKind;
  source_id: string;
  source_name: string;
  quantity: number;
  unit: StockUnit;
};

export type PreparationRecord = {
  id: string;
  name: string;
  image_url: string | null;
  image_src?: string | null;
  unit_kind: UnitKind;
  base_unit: StockUnit;
  alternative_unit: StockUnit | null;
  density: number | null;
  conservation_profile_id: string | null;
  conservation_profile_name: string | null;
  base_yield_quantity: number;
  base_yield_unit: StockUnit;
  is_active: boolean;
  recipe_items: PreparationRecipeLine[];
};

type RecipeDraftLine = {
  key: string;
  source: PreparationSource | null;
  quantity: string;
  unit: StockUnit;
};

type PreparationColumnKey = "photo" | "unit" | "yield" | "profile" | "recipe" | "status" | "actions";

const initialFormActionState: FormActionState = { status: "idle", message: "" };
const preparationColumns: PreparationColumnKey[] = ["photo", "unit", "yield", "profile", "recipe", "status", "actions"];
const defaultPreparationColumns: PreparationColumnKey[] = ["photo", "yield", "profile", "recipe", "status", "actions"];
const preparationColumnsStorageKey = "modopizzas.preparations.columns";

function readPreparationColumns() {
  if (typeof window === "undefined") return defaultPreparationColumns;
  const saved = window.localStorage.getItem(preparationColumnsStorageKey);
  if (!saved) return defaultPreparationColumns;
  try {
    const parsed = JSON.parse(saved) as PreparationColumnKey[];
    const sanitized = parsed.filter((column) => preparationColumns.includes(column));
    return sanitized.length ? sanitized : defaultPreparationColumns;
  } catch {
    window.localStorage.removeItem(preparationColumnsStorageKey);
    return defaultPreparationColumns;
  }
}

function preparationColumnLabel(column: PreparationColumnKey) {
  const labels: Record<PreparationColumnKey, string> = {
    photo: "Foto",
    unit: "Unidad",
    yield: "Rendimiento",
    profile: "Perfil",
    recipe: "Receta",
    status: "Estado",
    actions: "Acciones"
  };
  return labels[column];
}

const unitKindOptions = [
  { value: "weight", label: "Peso" },
  { value: "volume", label: "Volumen" },
  { value: "unit", label: "Unidad" }
] as const;

function unitOptionsForKind(unitKind: UnitKind): StockUnit[] {
  if (unitKind === "weight") return ["g", "kg"];
  if (unitKind === "volume") return ["ml", "l"];
  return ["unit"];
}

function alternativeOptions(unitKind: UnitKind): StockUnit[] {
  if (unitKind === "weight") return ["kg"];
  if (unitKind === "volume") return ["l"];
  return [];
}

function unitLabel(unit: StockUnit) {
  if (unit === "g") return "G";
  if (unit === "kg") return "KG";
  if (unit === "ml") return "ML";
  if (unit === "l") return "L";
  return "UND";
}

function unitKindLabel(unitKind: UnitKind) {
  if (unitKind === "weight") return "Peso";
  if (unitKind === "volume") return "Volumen";
  return "Unidad";
}

function storageMethodLabel(value: string) {
  if (value === "ambient") return "Ambiente";
  if (value === "refrigerated") return "Refrigerado";
  if (value === "frozen") return "Congelado";
  return value;
}

function durationUnitLabel(value: string, amount: number) {
  const singular = amount === 1;
  if (value === "hours") return singular ? "hora" : "horas";
  if (value === "days") return singular ? "dia" : "dias";
  if (value === "weeks") return singular ? "semana" : "semanas";
  if (value === "months") return singular ? "mes" : "meses";
  return value;
}

function storageMethodOrder(value: string) {
  if (value === "ambient") return 1;
  if (value === "refrigerated") return 2;
  if (value === "frozen") return 3;
  return 4;
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 3 }).format(value);
}

function recipeFullSummary(items: PreparationRecipeLine[]) {
  if (items.length === 0) return "Sin ingredientes";
  return items.map((item) => item.source_name).join(", ");
}

function recipeShortSummary(items: PreparationRecipeLine[]) {
  if (items.length === 0) return "Sin ingredientes";
  const visibleNames = items.slice(0, 3).map((item) => item.source_name);
  const remaining = items.length - visibleNames.length;
  return remaining > 0 ? `${visibleNames.join(", ")} y ${remaining} mas` : visibleNames.join(", ");
}

function internalStorageHint(unitKind: UnitKind) {
  if (unitKind === "weight") return "Se almacenara internamente en gramos.";
  if (unitKind === "volume") return "Se almacenara internamente en mililitros.";
  return "Se almacenara internamente por unidades.";
}

function storageUnitText(unitKind: UnitKind) {
  if (unitKind === "weight") return "G";
  if (unitKind === "volume") return "ML";
  return "Unidad";
}

function parseUiNumber(value: string) {
  return Number(value.replace(/\./g, "").replace(",", "."));
}

function formatDecimal(value: number) {
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 3 }).format(value);
}

function suggestedDensityDisplayUnit(unit: StockUnit): DensityDisplayUnit {
  return unit === "kg" || unit === "l" ? "kg_l" : "g_ml";
}

function densityUnitLabel(unit: DensityDisplayUnit) {
  return unit === "kg_l" ? "KG/L" : "G/ML";
}

function normalizeYieldForStorage(quantity: number, fromUnit: StockUnit, unitKind: UnitKind) {
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  if (unitKind === "weight") return fromUnit === "kg" ? quantity * 1000 : quantity;
  if (unitKind === "volume") return fromUnit === "l" ? quantity * 1000 : quantity;
  return quantity;
}

function createsPreparationCycle(sourceId: string, targetId: string, preparations: PreparationRecord[]) {
  const byId = new Map(preparations.map((item) => [item.id, item]));
  const visited = new Set<string>();

  function walk(id: string): boolean {
    if (id === targetId) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    const preparation = byId.get(id);
    if (!preparation) return false;
    return preparation.recipe_items.some((line) => line.source_kind === "preparation" && walk(line.source_id));
  }

  return walk(sourceId);
}

function initialRecipeLines(item?: PreparationRecord | null): RecipeDraftLine[] {
  if (!item?.recipe_items.length) {
    return [];
  }
  return item.recipe_items.map((line) => ({
    key: crypto.randomUUID(),
    source: {
      id: line.source_id,
      name: line.source_name,
      source_kind: line.source_kind,
      unit_kind: line.unit === "g" || line.unit === "kg" ? "weight" : line.unit === "ml" || line.unit === "l" ? "volume" : "unit",
      base_unit: line.unit
    },
    quantity: formatQuantity(line.quantity),
    unit: line.unit
  }));
}

export function PreparationsModule({
  preparations,
  profiles,
  sources
}: {
  preparations: PreparationRecord[];
  profiles: ConservationProfileOption[];
  sources: PreparationSource[];
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [modalMode, setModalMode] = useState<"new" | "edit" | "duplicate">("new");
  const [selectedPreparation, setSelectedPreparation] = useState<PreparationRecord | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<PreparationColumnKey[]>(readPreparationColumns);
  const [showSettings, setShowSettings] = useState(false);
  const normalizedQuery = normalizeMasterText(query);
  const filteredPreparations = preparations.filter((preparation) => {
    const matchesQuery = !normalizedQuery || normalizeMasterText(`${preparation.name} ${preparation.conservation_profile_name ?? ""}`).includes(normalizedQuery);
    const matchesStatus = status === "active" ? preparation.is_active : status === "inactive" ? !preparation.is_active : true;
    return matchesQuery && matchesStatus;
  });

  useEffect(() => {
    window.localStorage.setItem(
      preparationColumnsStorageKey,
      JSON.stringify(visibleColumns.filter((column) => preparationColumns.includes(column)))
    );
  }, [visibleColumns]);

  function openModal(mode: "new" | "edit" | "duplicate", preparation: PreparationRecord | null) {
    setModalMode(mode);
    setSelectedPreparation(preparation);
    setIsModalOpen(true);
  }

  function showColumn(column: PreparationColumnKey) {
    return visibleColumns.includes(column);
  }

  function toggleColumn(column: PreparationColumnKey) {
    setVisibleColumns((current) => (current.includes(column) ? current.filter((item) => item !== column) : [...current, column]));
  }

  return (
    <>
      <section className="form-panel">
      <div className="section-title-row inventory-toolbar-row">
        <h2>Preparaciones</h2>
        <div className="purchase-toolbar">
          <form className="table-filters" onSubmit={(event) => event.preventDefault()}>
            <input autoComplete="off" onChange={(event) => setQuery(uppercaseMasterName(event.target.value))} placeholder="Buscar preparacion" value={query} />
            <select onChange={(event) => setStatus(event.target.value)} value={status}>
              <option value="">Todos</option>
              <option value="active">Activas</option>
              <option value="inactive">Inactivas</option>
            </select>
          </form>
          <button className="ghost-button icon-text-button" onClick={() => setShowSettings(true)} type="button">
            <Settings size={18} /> Configuracion
          </button>
          <button className="primary-button add-purchase-button" onClick={() => openModal("new", null)} type="button">
            <Plus size={18} /> Agregar preparacion
          </button>
        </div>
      </div>
      <div className="data-table-wrap">
        <table className="data-table preparations-table">
          <thead>
            <tr>
              {showColumn("photo") ? <th>Foto</th> : null}
              <th>Nombre</th>
              {showColumn("unit") ? <th>Unidad</th> : null}
              {showColumn("yield") ? <th>Rendimiento</th> : null}
              {showColumn("profile") ? <th>Perfil</th> : null}
              {showColumn("recipe") ? <th>Receta</th> : null}
              {showColumn("status") ? <th>Estado</th> : null}
              {showColumn("actions") ? <th className="actions-column">Acciones</th> : null}
            </tr>
          </thead>
          <tbody>
            {filteredPreparations.map((preparation) => (
              <tr key={preparation.id}>
                {showColumn("photo") ? (
                  <td>
                    {preparation.image_src ? (
                      <Image alt={preparation.name} className="inventory-product-photo" height={44} src={preparation.image_src} unoptimized width={58} />
                    ) : (
                      <span className="inventory-photo-placeholder">Sin foto</span>
                    )}
                  </td>
                ) : null}
                <td>
                  <strong>{preparation.name}</strong>
                </td>
                {showColumn("unit") ? <td>{unitKindLabel(preparation.unit_kind)}</td> : null}
                {showColumn("yield") ? (
                  <td>
                    {formatQuantity(preparation.base_yield_quantity)} {unitLabel(preparation.base_yield_unit)}
                  </td>
                ) : null}
                {showColumn("profile") ? <td>{preparation.conservation_profile_name ?? "Sin perfil"}</td> : null}
                {showColumn("recipe") ? (
                  <td>
                    <span className="recipe-summary" title={recipeFullSummary(preparation.recipe_items)}>
                      {recipeShortSummary(preparation.recipe_items)}
                    </span>
                  </td>
                ) : null}
                {showColumn("status") ? (
                  <td>
                    <span className={`stock-pill ${preparation.is_active ? "ok" : "danger"}`}>{preparation.is_active ? "Activa" : "Inactiva"}</span>
                  </td>
                ) : null}
                {showColumn("actions") ? (
                  <td className="actions-column">
                    <span className="row-actions preparation-row-actions">
                      <button className="icon-button" onClick={() => openModal("edit", preparation)} title="Ver o editar" type="button">
                        <Eye size={16} />
                      </button>
                      <button className="icon-button" onClick={() => openModal("duplicate", preparation)} title="Duplicar" type="button">
                        <Copy size={16} />
                      </button>
                      <PreparationToggleButton id={preparation.id} isActive={preparation.is_active} name={preparation.name} />
                    </span>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
        {filteredPreparations.length === 0 ? <p className="muted">No hay preparaciones con esos filtros.</p> : null}
      </div>
      {isModalOpen ? (
        <PreparationModal
          allPreparations={preparations}
          mode={modalMode}
          onClose={() => setIsModalOpen(false)}
          preparation={selectedPreparation}
          profiles={profiles}
          sources={sources}
        />
      ) : null}
      {showSettings ? (
        <div className="modal-backdrop" role="presentation">
          <section aria-label="Configuracion de preparaciones" aria-modal="true" className="modal-panel inventory-settings-modal" role="dialog">
            <header className="modal-header">
              <div>
                <strong>Configuracion de preparaciones</strong>
                <span>Columnas guardadas en este navegador.</span>
              </div>
              <button className="icon-button" onClick={() => setShowSettings(false)} title="Cerrar" type="button">
                <X size={18} />
              </button>
            </header>
            <div className="compact-card">
              <div className="field full">
                <label>Columnas</label>
                <div className="column-settings-grid">
                  {preparationColumns.map((column) => (
                    <label className="check-option" key={column}>
                      <input checked={visibleColumns.includes(column)} onChange={() => toggleColumn(column)} type="checkbox" />
                      <span>{preparationColumnLabel(column)}</span>
                    </label>
                  ))}
                </div>
                <p className="field-hint">Nombre siempre permanece visible.</p>
              </div>
              <div className="form-actions">
                <button className="ghost-button" onClick={() => setVisibleColumns(defaultPreparationColumns)} type="button">
                  Restablecer columnas
                </button>
                <button className="primary-button" onClick={() => setShowSettings(false)} type="button">
                  Aplicar
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
      </section>
    </>
  );
}

function PreparationModal({
  mode,
  preparation,
  allPreparations,
  profiles,
  sources,
  onClose
}: {
  mode: "new" | "edit" | "duplicate";
  preparation: PreparationRecord | null;
  allPreparations: PreparationRecord[];
  profiles: ConservationProfileOption[];
  sources: PreparationSource[];
  onClose: () => void;
}) {
  const isEditing = mode === "edit";
  const [state, formAction] = useActionState(savePreparation, initialFormActionState);
  const [name, setName] = useState(isEditing ? preparation?.name ?? "" : "");
  const [unitKind, setUnitKind] = useState<UnitKind>(preparation?.unit_kind ?? "weight");
  const [yieldQuantity, setYieldQuantity] = useState(preparation ? formatQuantity(preparation.base_yield_quantity) : "");
  const [yieldUnit, setYieldUnit] = useState<StockUnit>(preparation?.base_yield_unit ?? "g");
  const [alternativeUnit, setAlternativeUnit] = useState<StockUnit | "">(preparation?.alternative_unit ?? "");
  const [density, setDensity] = useState(preparation?.density ? String(preparation.density).replace(".", ",") : "");
  const [densityDisplayUnit, setDensityDisplayUnit] = useState<DensityDisplayUnit>(suggestedDensityDisplayUnit(preparation?.base_yield_unit ?? "g"));
  const [densityUnitChangedManually, setDensityUnitChangedManually] = useState(false);
  const [conversionEnabled, setConversionEnabled] = useState(Boolean(preparation?.density) && preparation?.unit_kind !== "unit");
  const [profileId, setProfileId] = useState(preparation?.conservation_profile_id ?? "");
  const [profileOptions, setProfileOptions] = useState<ConservationProfileOption[]>(profiles);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [imagePreview, setImagePreview] = useState(preparation?.image_src ?? preparation?.image_url ?? "");
  const [removeImage, setRemoveImage] = useState(false);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [recipeLines, setRecipeLines] = useState<RecipeDraftLine[]>(initialRecipeLines(preparation));
  const [isNameOpen, setIsNameOpen] = useState(false);
  const [activeNameIndex, setActiveNameIndex] = useState(0);
  const [yieldTouched, setYieldTouched] = useState(false);
  const [recipeTouched, setRecipeTouched] = useState(false);
  const [densityTouched, setDensityTouched] = useState(false);
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const router = useRouter();
  const normalizedName = normalizeMasterText(name);
  const duplicatePreparation = allPreparations.find((item) => item.id !== (isEditing ? preparation?.id : "") && normalizeMasterText(item.name) === normalizedName);
  const matchingPreparations = allPreparations
    .filter((item) => item.id !== (isEditing ? preparation?.id : "") && normalizeMasterText(item.name).includes(normalizedName))
    .slice(0, 8);
  const selectedSourceIds = recipeLines.map((line) => line.source?.id).filter(Boolean);
  const hasDuplicateRecipeSource = new Set(selectedSourceIds).size !== selectedSourceIds.length;
  const yieldValue = parseUiNumber(yieldQuantity);
  const hasInvalidYield = !yieldQuantity.trim() || !Number.isFinite(yieldValue) || yieldValue <= 0;
  const hasInvalidRecipeLine = recipeLines.some((line) => {
    const quantityValue = parseUiNumber(line.quantity);
    return !line.source || !line.quantity.trim() || !Number.isFinite(quantityValue) || quantityValue <= 0;
  });
  const selectedProfile = profileOptions.find((profile) => profile.id === profileId);
  const profileRules = [...(selectedProfile?.conservation_profile_rules ?? [])].sort(
    (a, b) => storageMethodOrder(a.storage_method) - storageMethodOrder(b.storage_method)
  );
  const allowedAlternativeUnits = alternativeOptions(unitKind);
  const effectiveAlternativeUnit = alternativeUnit && allowedAlternativeUnits.includes(alternativeUnit) ? alternativeUnit : "";
  const densityValue = parseUiNumber(density);
  const canUseConversion = unitKind !== "unit";
  const hasInvalidDensity = conversionEnabled && (!density.trim() || !Number.isFinite(densityValue) || densityValue <= 0);
  const densityHelpText =
    densityDisplayUnit === "kg_l" ? "Ingresa cuantos kilogramos pesa 1 litro." : "Ingresa cuantos gramos pesa 1 mililitro.";
  const densityEquivalence =
    conversionEnabled && Number.isFinite(densityValue) && densityValue > 0
      ? densityDisplayUnit === "kg_l"
        ? `1 L equivale a ${formatDecimal(densityValue)} KG.`
        : `1 ML equivale a ${formatDecimal(densityValue)} G.`
      : `Ingresa la densidad en ${densityUnitLabel(densityDisplayUnit)} para ver la equivalencia.`;
  const showYieldError = hasInvalidYield && (yieldTouched || attemptedSubmit);
  const showRecipeError = hasInvalidRecipeLine && (recipeTouched || attemptedSubmit);
  const showDensityError = hasInvalidDensity && (densityTouched || attemptedSubmit);
  const hasCycleRecipeSource = Boolean(
    preparation?.id &&
      recipeLines.some((line) => line.source?.source_kind === "preparation" && createsPreparationCycle(line.source.id, preparation.id, allPreparations))
  );
  const normalizedYieldForStorage = normalizeYieldForStorage(yieldValue, yieldUnit, unitKind);
  const displayStockUnit = effectiveAlternativeUnit ? unitLabel(effectiveAlternativeUnit) : storageUnitText(unitKind);
  const title = isEditing ? `Editar ${preparation?.name}` : mode === "duplicate" ? "Duplicar preparacion" : "Agregar preparacion";

  useEffect(() => {
    if (state.status !== "success") return;
    const timeout = window.setTimeout(() => {
      onClose();
      router.refresh();
    }, 1000);
    return () => window.clearTimeout(timeout);
  }, [onClose, router, state.status]);

  useEffect(() => {
    return () => {
      if (imagePreview.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  function addRecipeLine() {
    setRecipeTouched(true);
    setRecipeLines((current) => [...current, { key: crypto.randomUUID(), source: null, quantity: "", unit: unitOptionsForKind("weight")[0] }]);
  }

  function updateRecipeLine(key: string, patch: Partial<RecipeDraftLine>) {
    setRecipeTouched(true);
    setRecipeLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function handleUnitKindChange(nextKind: UnitKind) {
    setUnitKind(nextKind);
    const nextUnit = unitOptionsForKind(nextKind)[0];
    setYieldUnit(nextUnit);
    setAlternativeUnit("");
    if (nextKind === "unit") {
      setConversionEnabled(false);
      setDensity("");
      setDensityTouched(false);
      setDensityUnitChangedManually(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-label={title} aria-modal="true" className="modal-panel production-modal" role="dialog">
        <header className="modal-header">
          <div>
            <strong>{title}</strong>
            <span>Informacion general, conservacion y receta base.</span>
          </div>
          <button className="icon-button" onClick={onClose} title="Cerrar" type="button">
            <X size={18} />
          </button>
        </header>
        <form action={formAction} className="compact-card" onSubmit={() => setAttemptedSubmit(true)}>
          {isEditing && preparation ? <input name="id" type="hidden" value={preparation.id} /> : null}
          <section className="form-section">
            <h3>Informacion general</h3>
            <div className="form-grid">
              <div className="field autocomplete-field full">
                <label>Nombre</label>
                <input
                  autoComplete="off"
                  name="name"
                  onBlur={() => window.setTimeout(() => setIsNameOpen(false), 120)}
                  onChange={(event) => {
                    setName(uppercaseMasterName(event.target.value));
                    setIsNameOpen(true);
                    setActiveNameIndex(0);
                  }}
                  onFocus={() => setIsNameOpen(true)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setIsNameOpen(true);
                      setActiveNameIndex((current) => Math.min(current + 1, Math.max(matchingPreparations.length - 1, 0)));
                    }
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setActiveNameIndex((current) => Math.max(current - 1, 0));
                    }
                    if (event.key === "Enter" && matchingPreparations[activeNameIndex]) {
                      event.preventDefault();
                      setName(matchingPreparations[activeNameIndex].name);
                      setIsNameOpen(false);
                    }
                    if (event.key === "Escape") setIsNameOpen(false);
                  }}
                  required
                  value={name}
                />
                {isNameOpen ? (
                  <div className="autocomplete-menu">
                    {matchingPreparations.map((item, index) => (
                      <button
                        className={`autocomplete-option duplicate-option${index === activeNameIndex ? " active" : ""}`}
                        key={item.id}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          setName(item.name);
                          setIsNameOpen(false);
                        }}
                        type="button"
                      >
                        <span>{item.name}</span>
                        <span className="availability-badge danger">- REGISTRADO <X size={14} /></span>
                      </button>
                    ))}
                    {name.trim() ? (
                      <div className={`autocomplete-option availability-row ${duplicatePreparation ? "danger" : "ok"}`}>
                        <span>{name}</span>
                        <span className={`availability-badge ${duplicatePreparation ? "danger" : "ok"}`}>
                          - {duplicatePreparation ? "REGISTRADO" : "REGISTRABLE"} {duplicatePreparation ? <X size={14} /> : <Check size={14} />}
                        </span>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {duplicatePreparation ? <p className="field-hint danger">Esa preparacion ya esta registrada.</p> : null}
              </div>
              <div className="field full">
                <label>Tipo de unidad</label>
                <input name="unit_kind" type="hidden" value={unitKind} />
                <div className="segmented-control triple-segmented">
                  {unitKindOptions.map((option) => (
                    <button
                      aria-pressed={unitKind === option.value}
                      className={unitKind === option.value ? "active" : ""}
                      key={option.value}
                      onClick={() => handleUnitKindChange(option.value)}
                      type="button"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="field-hint">Unidad principal de almacenamiento: {storageUnitText(unitKind)}.</p>
              </div>
              <div className="field">
                <label>Cantidad producida por receta base</label>
                <div className="split-input">
                  <input
                    name="base_yield_quantity"
                    onBlur={() => setYieldTouched(true)}
                    onChange={(event) => {
                      setYieldTouched(true);
                      setYieldQuantity(event.target.value.replace(/[^\d.,]/g, ""));
                    }}
                    placeholder="Ej. 500, 1000, 3000"
                    required
                    value={yieldQuantity}
                  />
                  <select
                    aria-label="Unidad del rendimiento"
                    name="base_yield_unit"
                    onChange={(event) => {
                      const nextUnit = event.target.value as StockUnit;
                      setYieldUnit(nextUnit);
                      if (!densityUnitChangedManually) setDensityDisplayUnit(suggestedDensityDisplayUnit(nextUnit));
                    }}
                    value={yieldUnit}
                  >
                    {unitOptionsForKind(unitKind).map((unit) => (
                      <option key={unit} value={unit}>
                        {unitLabel(unit)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="yield-help">
                  <span>Cantidad y unidad del rendimiento: {yieldQuantity.trim() ? `${yieldQuantity} ${unitLabel(yieldUnit)}` : "pendiente"}.</span>
                  <span>
                    Cantidad normalizada que se almacenara:{" "}
                    {normalizedYieldForStorage ? `${formatDecimal(normalizedYieldForStorage)} ${storageUnitText(unitKind)}` : "pendiente"}.
                  </span>
                  <span>Unidad preferida para mostrar stock: {displayStockUnit}.</span>
                  <span>{internalStorageHint(unitKind)}</span>
                </div>
              </div>
              {allowedAlternativeUnits.length ? (
                <div className="field">
                  <label>Unidad alternativa de visualizacion</label>
                  <select name="alternative_unit" onChange={(event) => setAlternativeUnit(event.target.value as StockUnit | "")} value={effectiveAlternativeUnit}>
                    <option value="">Sin unidad alternativa</option>
                    {allowedAlternativeUnits.map((unit) => (
                      <option key={unit} value={unit}>
                        {unitLabel(unit)}
                      </option>
                    ))}
                  </select>
                  <p className="field-hint">Solo cambia como se mostrara esta preparacion; no cambia el almacenamiento.</p>
                </div>
              ) : null}
            </div>
          </section>

          {canUseConversion ? (
            <section className="form-section">
              <h3>Conversion peso-volumen opcional</h3>
              <div className="form-grid">
                <label className="check-option full">
                  <input
                    checked={conversionEnabled}
                    name="conversion_enabled"
                    onChange={(event) => {
                      setConversionEnabled(event.target.checked);
                      if (!event.target.checked) {
                        setDensity("");
                        setDensityTouched(false);
                      }
                    }}
                    type="checkbox"
                  />
                  <span>Permitir conversion entre peso y volumen</span>
                </label>
                {conversionEnabled ? (
                  <div className="field">
                    <label>Densidad</label>
                    <div className="split-input">
                      <input
                        name="density"
                        onBlur={() => setDensityTouched(true)}
                        onChange={(event) => {
                          setDensityTouched(true);
                          setDensity(event.target.value.replace(/[^\d.,]/g, ""));
                        }}
                        placeholder="Ej. 1,03"
                        value={density}
                      />
                      <select
                        aria-label="Unidad visible de densidad"
                        onChange={(event) => {
                          setDensityDisplayUnit(event.target.value as DensityDisplayUnit);
                          setDensityUnitChangedManually(true);
                        }}
                        value={densityDisplayUnit}
                      >
                        <option value="g_ml">G/ML</option>
                        <option value="kg_l">KG/L</option>
                      </select>
                    </div>
                    <p className="field-hint">{densityHelpText}</p>
                    <p className="field-hint">{densityEquivalence}</p>
                    <p className="field-hint">Se usara posteriormente al registrar produccion.</p>
                    {showDensityError ? <p className="field-hint danger">Ingresa una densidad mayor a cero.</p> : null}
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          <section className="form-section">
            <h3>Conservacion</h3>
            <div className="form-grid">
              <div className="field">
                <label>Perfil</label>
                <div className="linked-field">
                  <select name="conservation_profile_id" onChange={(event) => setProfileId(event.target.value)} value={profileId}>
                    <option value="">Sin perfil</option>
                    {profileOptions.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                  <button className="icon-button" onClick={() => setIsProfileModalOpen(true)} title="Agregar perfil" type="button">
                    <Plus size={17} />
                  </button>
                </div>
              </div>
              {profileRules.length ? (
                <div className="field full">
                  <label>Reglas del perfil</label>
                  <div className="profile-rule-preview">
                    {profileRules.map((rule) => (
                      <span className="stock-pill" key={rule.id}>
                        {storageMethodLabel(rule.storage_method)}: {rule.duration_value} {durationUnitLabel(rule.duration_unit, rule.duration_value)}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <section className="form-section">
            <div className="section-title-row">
              <h3>Receta base</h3>
              <button className="ghost-button" onClick={addRecipeLine} type="button">
                <Plus size={16} /> Agregar ingrediente
              </button>
            </div>
            <div className="recipe-lines">
              {recipeLines.length === 0 ? <p className="muted compact-empty-state">Aun no hay componentes.</p> : null}
              {recipeLines.map((line, index) => (
                <RecipeLineEditor
                  currentPreparationId={isEditing ? preparation?.id ?? "" : ""}
                  index={index}
                  key={line.key}
                  line={line}
                  onChange={(patch) => updateRecipeLine(line.key, patch)}
                  onRemove={() => {
                    setRecipeTouched(true);
                    setRecipeLines((current) => current.filter((item) => item.key !== line.key));
                  }}
                  sources={sources}
                />
              ))}
            </div>
            {hasDuplicateRecipeSource ? <p className="field-hint danger">No repitas productos o preparaciones en la receta.</p> : null}
            {hasCycleRecipeSource ? <p className="field-hint danger">Esa preparacion generaria un ciclo en la receta.</p> : null}
            {showRecipeError ? <p className="field-hint danger">Las cantidades de la receta deben ser mayores a cero.</p> : null}
            {showYieldError ? <p className="field-hint danger">El rendimiento debe ser mayor a cero.</p> : null}
          </section>

          <section className="form-section">
            <h3>Imagen opcional</h3>
            <div className="form-grid">
              <div className="field full">
                <label>Imagen (opcional)</label>
                <input name="existing_image_url" type="hidden" value={preparation?.image_url ?? ""} />
                <input name="remove_image" type="hidden" value={removeImage ? "1" : "0"} />
                <div className="image-upload-row">
                  <label className="upload-dropzone compact-upload-dropzone">
                    <input
                      accept="image/gif,image/jpeg,image/png,image/webp"
                      key={fileInputKey}
                      name="preparation_image"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        if (imagePreview.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
                        setImagePreview(URL.createObjectURL(file));
                        setRemoveImage(false);
                      }}
                      type="file"
                    />
                    {imagePreview ? (
                      <Image alt="Foto de preparacion" className="upload-preview compact-upload-preview" height={96} src={imagePreview} unoptimized width={96} />
                    ) : (
                      <span>
                        <ImagePlus size={18} /> Subir foto
                      </span>
                    )}
                  </label>
                  {imagePreview ? (
                    <div className="inline-actions image-inline-actions">
                      <label className="ghost-button compact-file-button">
                        Cambiar
                        <input
                          accept="image/gif,image/jpeg,image/png,image/webp"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (!file) return;
                            if (imagePreview.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
                            setImagePreview(URL.createObjectURL(file));
                            setRemoveImage(false);
                          }}
                          type="file"
                        />
                      </label>
                      <button
                        className="ghost-button"
                        onClick={() => {
                          if (imagePreview.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
                          setImagePreview("");
                          setRemoveImage(true);
                          setFileInputKey((current) => current + 1);
                        }}
                        type="button"
                      >
                        Eliminar imagen
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </section>

          <section className="form-section">
            <h3>Estado</h3>
            <label className="check-option">
              <input defaultChecked={preparation?.is_active ?? true} name="is_active" type="checkbox" />
              <span>Activa</span>
            </label>
          </section>

          {state.status !== "idle" ? <p className={`form-status ${state.status}`}>{state.message}</p> : null}
          <div className="form-actions modal-form-actions">
            <button className="ghost-button" onClick={onClose} type="button">
              Cancelar
            </button>
            <PreparationSubmitButton
              disabled={Boolean(duplicatePreparation) || !normalizedName || hasInvalidYield || hasInvalidDensity || hasDuplicateRecipeSource || hasCycleRecipeSource || hasInvalidRecipeLine}
              isEditing={isEditing}
            />
          </div>
        </form>
        {isProfileModalOpen ? (
          <ConservationProfileModal
            allProfiles={profileOptions}
            nested
            onClose={() => setIsProfileModalOpen(false)}
            onSaved={(profile) => {
              if (!profile) return;
              setProfileOptions((current) => [profile, ...current.filter((item) => item.id !== profile.id)]);
              setProfileId(profile.id);
            }}
            profile={null}
            title="Agregar perfil"
          />
        ) : null}
      </section>
    </div>
  );
}

function RecipeLineEditor({
  index,
  line,
  sources,
  currentPreparationId,
  onChange,
  onRemove
}: {
  index: number;
  line: RecipeDraftLine;
  sources: PreparationSource[];
  currentPreparationId: string;
  onChange: (patch: Partial<RecipeDraftLine>) => void;
  onRemove: () => void;
}) {
  const [query, setQuery] = useState(line.source?.name ?? "");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const filteredSources = sources
    .filter((source) => source.id !== currentPreparationId)
    .filter((source) => normalizeMasterText(source.name).includes(normalizeMasterText(query)))
    .slice(0, 12);
  const unitOptions: StockUnit[] = line.source ? unitOptionsForKind(line.source.unit_kind) : ["g", "kg", "ml", "l", "unit"];

  function pickSource(source: PreparationSource) {
    onChange({ source, unit: unitOptionsForKind(source.unit_kind)[0] });
    setQuery(source.name);
    setIsOpen(false);
    setActiveIndex(0);
  }

  return (
    <div className="recipe-line">
      <input name={`recipe[${index}][source_kind]`} type="hidden" value={line.source?.source_kind ?? ""} />
      <input name={`recipe[${index}][source_id]`} type="hidden" value={line.source?.id ?? ""} />
      <div className="field autocomplete-field recipe-source-field">
        <label>Ingrediente o preparacion</label>
        <div className="locked-input">
          <input
            autoComplete="off"
            disabled={Boolean(line.source)}
            onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
            onChange={(event) => {
              setQuery(uppercaseMasterName(event.target.value));
              setIsOpen(true);
              setActiveIndex(0);
            }}
            onFocus={() => setIsOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setIsOpen(true);
                setActiveIndex((current) => Math.min(current + 1, Math.max(filteredSources.length - 1, 0)));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((current) => Math.max(current - 1, 0));
              }
              if (event.key === "Enter" && filteredSources[activeIndex]) {
                event.preventDefault();
                pickSource(filteredSources[activeIndex]);
              }
              if (event.key === "Escape") setIsOpen(false);
            }}
            placeholder="Buscar ingrediente o preparacion"
            value={line.source?.name ?? query}
          />
          {line.source ? (
            <button
              aria-label="Limpiar ingrediente"
              className="clear-selection-button"
              onClick={() => {
                onChange({ source: null, unit: "g" });
                setQuery("");
              }}
              type="button"
            >
              <X size={15} />
            </button>
          ) : null}
        </div>
        {isOpen && !line.source ? (
          <div className="autocomplete-menu">
            {filteredSources.map((source, optionIndex) => (
              <button
                className={`autocomplete-option${optionIndex === activeIndex ? " active" : ""}`}
                key={`${source.source_kind}-${source.id}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  pickSource(source);
                }}
                type="button"
              >
                <span>{source.name}</span>
                <span className={`source-type-badge ${source.source_kind === "preparation" ? "preparation" : "product"}`}>
                  {source.source_kind === "preparation" ? "Preparacion" : "Ingrediente"}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="field">
        <label>Cantidad</label>
        <input
          name={`recipe[${index}][quantity]`}
          onChange={(event) => onChange({ quantity: event.target.value.replace(/[^\d.,]/g, "") })}
          placeholder="Ejemplo: 250"
          value={line.quantity}
        />
      </div>
      <div className="field">
        <label>Unidad</label>
        <select name={`recipe[${index}][unit]`} onChange={(event) => onChange({ unit: event.target.value as StockUnit })} value={line.unit}>
          {unitOptions.map((unit) => (
            <option key={unit} value={unit}>
              {unitLabel(unit)}
            </option>
          ))}
        </select>
      </div>
      <button className="icon-button danger-button" onClick={onRemove} title="Eliminar ingrediente" type="button">
        <X size={16} />
      </button>
    </div>
  );
}

function PreparationToggleButton({ id, name, isActive }: { id: string; name: string; isActive: boolean }) {
  const [state, formAction] = useActionState(togglePreparationState, initialFormActionState);
  const router = useRouter();

  useEffect(() => {
    if (state.status !== "success") return;
    router.refresh();
  }, [router, state.status]);

  return (
    <form action={formAction} className="inline-form product-delete-form">
      <input name="id" type="hidden" value={id} />
      <input name="is_active" type="hidden" value={String(!isActive)} />
      <button
        className={`icon-button ${isActive ? "danger-button" : ""}`}
        onClick={(event) => {
          if (!window.confirm(`${isActive ? "Desactivar" : "Activar"} ${name}?`)) event.preventDefault();
        }}
        title={isActive ? "Desactivar" : "Activar"}
        type="submit"
      >
        <Power size={16} />
      </button>
      {state.status !== "idle" ? <span className={`row-action-message ${state.status}`}>{state.message}</span> : null}
    </form>
  );
}

function PreparationSubmitButton({ disabled, isEditing }: { disabled: boolean; isEditing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className="primary-button" disabled={disabled || pending} type="submit">
      {pending ? "Guardando..." : isEditing ? "Actualizar preparacion" : "Guardar preparacion"}
    </button>
  );
}
