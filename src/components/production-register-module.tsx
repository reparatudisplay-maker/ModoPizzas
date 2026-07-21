"use client";

import Image from "next/image";
import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Edit3, Eye, Plus, Settings, Trash2, X } from "lucide-react";
import { deleteProduction, registerProduction, type FormActionState, type ProductionActionState } from "@/app/admin/actions";
import { formatCop, formatNumber } from "@/lib/format";
import { normalizeMasterText, uppercaseMasterName } from "@/lib/master-normalization";
import { formatStockQuantity, unitLabel } from "@/lib/units";

type StockUnit = "g" | "kg" | "ml" | "l" | "unit";
type UnitKind = "weight" | "volume" | "unit";
type SourceKind = "inventory_item" | "preparation";
type StorageMethod = "ambient" | "refrigerated" | "frozen";

export type ProductionSourceOption = {
  id: string;
  name: string;
  source_kind: SourceKind;
  unit_kind: UnitKind;
  base_unit: StockUnit;
  density: number | null;
  stock_base: number;
  average_unit_cost_cop: number;
};

export type ProductionRecipeItem = {
  id: string;
  source_kind: SourceKind;
  source_id: string;
  source_name: string;
  quantity: number;
  unit: StockUnit;
};

export type ProductionPreparationOption = {
  id: string;
  name: string;
  image_src: string | null;
  unit_kind: UnitKind;
  base_unit: StockUnit;
  alternative_unit: StockUnit | null;
  density: number | null;
  base_yield_quantity: number;
  base_yield_unit: StockUnit;
  conservation_profile_name: string | null;
  conservation_rules: Array<{
    storage_method: StorageMethod;
    duration_value: number;
    duration_unit: "hours" | "days" | "weeks" | "months";
  }>;
  recipe_items: ProductionRecipeItem[];
};

export type ProductionHistoryRow = {
  id: string;
  code: string;
  preparation_name: string;
  storage_method: StorageMethod;
  elaborated_at: string;
  actual_quantity_base: number;
  base_unit: StockUnit;
  stock_base: number;
  expiration_date: string;
  total_cost_cop: number;
  unit_cost_cop: number;
  user_label: string;
  ingredients_consumed: Array<{
    id: string;
    source_kind: SourceKind;
    source_name: string;
    quantity_base: number;
    base_unit: StockUnit;
    cost_cop: number;
    allocations?: Array<{
      id: string;
      origin_label: string;
      quantity_base: number;
      base_unit: StockUnit;
      cost_cop: number;
    }>;
  }>;
};

type DraftLine = {
  key: string;
  source: ProductionSourceOption | null;
  quantity: string;
  unit: StockUnit;
  fromRecipe: boolean;
};

const initialState: ProductionActionState = { status: "idle", message: "" };
type HistoryColumnKey = "preparation" | "elaborated" | "quantity" | "stock" | "expiration" | "totalCost" | "unitCost" | "user" | "status" | "actions";

const historyColumns: HistoryColumnKey[] = ["preparation", "elaborated", "quantity", "stock", "expiration", "totalCost", "unitCost", "user", "status", "actions"];
const defaultHistoryColumns: HistoryColumnKey[] = ["preparation", "elaborated", "quantity", "stock", "expiration", "totalCost", "unitCost", "status", "actions"];
const productionHistoryStorageKey = "modopizzas.productions.history.columns";

function readHistoryColumns() {
  if (typeof window === "undefined") return defaultHistoryColumns;
  const saved = window.localStorage.getItem(productionHistoryStorageKey);
  if (!saved) return defaultHistoryColumns;
  try {
    const parsed = JSON.parse(saved) as HistoryColumnKey[];
    const sanitized = parsed.filter((column) => historyColumns.includes(column));
    return sanitized.length ? sanitized : defaultHistoryColumns;
  } catch {
    window.localStorage.removeItem(productionHistoryStorageKey);
    return defaultHistoryColumns;
  }
}

function historyColumnLabel(column: HistoryColumnKey) {
  const labels: Record<HistoryColumnKey, string> = {
    preparation: "Preparacion",
    elaborated: "Elaboracion",
    quantity: "Cantidad",
    stock: "Saldo",
    expiration: "Vencimiento",
    totalCost: "Costo total",
    unitCost: "Costo unitario",
    user: "Usuario",
    status: "Estado",
    actions: "Acciones"
  };
  return labels[column];
}

function storageMethodLabel(method: StorageMethod) {
  if (method === "ambient") return "Ambiente";
  if (method === "refrigerated") return "Refrigerado";
  return "Congelado";
}

function unitOptionsForKind(unitKind: UnitKind) {
  if (unitKind === "weight") return ["g", "kg"] as StockUnit[];
  if (unitKind === "volume") return ["ml", "l"] as StockUnit[];
  return ["unit"] as StockUnit[];
}

function preferredVisibleUnit(unitKind: UnitKind): StockUnit {
  if (unitKind === "weight") return "kg";
  if (unitKind === "volume") return "l";
  return "unit";
}

function productionUnits(preparation: ProductionPreparationOption | null) {
  if (!preparation) return ["unit"] as StockUnit[];
  const baseUnits = unitOptionsForKind(preparation.unit_kind);
  const units = new Set<StockUnit>(baseUnits);
  if (preparation.alternative_unit) units.add(preparation.alternative_unit);
  if (preparation.density && preparation.unit_kind === "weight") {
    units.add("ml");
    units.add("l");
  }
  if (preparation.density && preparation.unit_kind === "volume") {
    units.add("g");
    units.add("kg");
  }
  return [...units];
}

function parseUiNumber(value: string) {
  const parsed = Number(value.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function productionStatus(row: ProductionHistoryRow) {
  const today = todayBogota();
  if (row.stock_base <= 0) return { label: "Agotada", className: "danger" };
  if (row.expiration_date < today) return { label: "Vencida", className: "danger" };
  if (row.expiration_date === today) return { label: "Vence hoy", className: "warning" };
  return { label: "Disponible", className: "ok" };
}

function convertQuantity(quantity: number, fromUnit: StockUnit, toUnit: StockUnit, density: number | null) {
  const fromKind = fromUnit === "g" || fromUnit === "kg" ? "weight" : fromUnit === "ml" || fromUnit === "l" ? "volume" : "unit";
  const toKind = toUnit === "g" || toUnit === "kg" ? "weight" : toUnit === "ml" || toUnit === "l" ? "volume" : "unit";
  if (quantity <= 0) return 0;
  if (fromUnit === toUnit) return quantity;
  if (fromKind === toKind) {
    if (fromUnit === "kg" && toUnit === "g") return quantity * 1000;
    if (fromUnit === "g" && toUnit === "kg") return quantity / 1000;
    if (fromUnit === "l" && toUnit === "ml") return quantity * 1000;
    if (fromUnit === "ml" && toUnit === "l") return quantity / 1000;
    return quantity;
  }
  if (!density || fromKind === "unit" || toKind === "unit") return NaN;
  if (fromKind === "weight") {
    const grams = fromUnit === "kg" ? quantity * 1000 : quantity;
    const ml = grams / density;
    return toUnit === "l" ? ml / 1000 : ml;
  }
  const ml = fromUnit === "l" ? quantity * 1000 : quantity;
  const grams = ml * density;
  return toUnit === "kg" ? grams / 1000 : grams;
}

function addDuration(dateValue: string, value: number, unit: string) {
  const date = new Date(`${dateValue}T00:00:00`);
  if (unit === "hours") date.setDate(date.getDate() + Math.ceil(value / 24));
  if (unit === "days") date.setDate(date.getDate() + value);
  if (unit === "weeks") date.setDate(date.getDate() + value * 7);
  if (unit === "months") date.setMonth(date.getMonth() + value);
  return date.toISOString().slice(0, 10);
}

function todayBogota() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
}

function lineKey(sourceKind: SourceKind, sourceId: string) {
  return `${sourceKind}:${sourceId}`;
}

export function ProductionRegisterModule({
  preparations,
  sources,
  history
}: {
  preparations: ProductionPreparationOption[];
  sources: ProductionSourceOption[];
  history: ProductionHistoryRow[];
}) {
  const [state, formAction] = useActionState(registerProduction, initialState);
  const router = useRouter();
  const [preparationQuery, setPreparationQuery] = useState("");
  const [selectedPreparation, setSelectedPreparation] = useState<ProductionPreparationOption | null>(null);
  const [isPreparationOpen, setIsPreparationOpen] = useState(false);
  const [activePreparationIndex, setActivePreparationIndex] = useState(0);
  const [elaboratedAt, setElaboratedAt] = useState(todayBogota());
  const [storageMethod, setStorageMethod] = useState<StorageMethod | "">("");
  const [expirationDate, setExpirationDate] = useState("");
  const [expirationTouched, setExpirationTouched] = useState(false);
  const [expectedQuantity, setExpectedQuantity] = useState("");
  const [expectedUnit, setExpectedUnit] = useState<StockUnit>("unit");
  const [actualQuantity, setActualQuantity] = useState("");
  const [actualUnit, setActualUnit] = useState<StockUnit>("unit");
  const [actualTouched, setActualTouched] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyStatus, setHistoryStatus] = useState("");
  const [visibleHistoryColumns, setVisibleHistoryColumns] = useState<HistoryColumnKey[]>(readHistoryColumns);
  const [showHistorySettings, setShowHistorySettings] = useState(false);
  const [detailProduction, setDetailProduction] = useState<ProductionHistoryRow | null>(null);
  const [editBlockedProduction, setEditBlockedProduction] = useState<ProductionHistoryRow | null>(null);

  const sourceByKey = useMemo(() => new Map(sources.map((source) => [lineKey(source.source_kind, source.id), source])), [sources]);
  const preparationMatches = preparations
    .filter((preparation) => normalizeMasterText(preparation.name).includes(normalizeMasterText(preparationQuery)))
    .slice(0, 10);
  const allowedMethods = selectedPreparation?.conservation_rules.map((rule) => rule.storage_method) ?? [];
  const availableUnits = productionUnits(selectedPreparation);
  const expectedBase = selectedPreparation ? convertQuantity(parseUiNumber(expectedQuantity), expectedUnit, selectedPreparation.base_unit, selectedPreparation.density) : 0;
  const actualBase = selectedPreparation ? convertQuantity(parseUiNumber(actualQuantity), actualUnit, selectedPreparation.base_unit, selectedPreparation.density) : 0;
  const lineStates = lines.map((line) => {
    const quantity = parseUiNumber(line.quantity);
    const baseQuantity = line.source ? convertQuantity(quantity, line.unit, line.source.base_unit, line.source.density) : 0;
    const missing = line.source ? Math.max(0, baseQuantity - line.source.stock_base) : 0;
    const cost = line.source ? baseQuantity * line.source.average_unit_cost_cop : 0;
    return { key: line.key, baseQuantity, missing, cost, isValid: Boolean(line.source) && quantity > 0 && Number.isFinite(baseQuantity) && baseQuantity > 0 };
  });
  const duplicateLine = new Set(lines.filter((line) => line.source).map((line) => lineKey(line.source!.source_kind, line.source!.id))).size !== lines.filter((line) => line.source).length;
  const hasInvalidLine = lineStates.some((line) => !line.isValid);
  const hasMissingStock = lineStates.some((line) => line.missing > 0);
  const totalCost = lineStates.reduce((sum, line) => sum + line.cost, 0);
  const unitCost = actualBase > 0 ? totalCost / actualBase : 0;
  const normalizedHistoryQuery = normalizeMasterText(historyQuery);
  const filteredHistory = history.filter((row) => {
    const matchesQuery = !normalizedHistoryQuery || normalizeMasterText(`${row.code} ${row.preparation_name} ${row.user_label}`).includes(normalizedHistoryQuery);
    const matchesStatus = !historyStatus || productionStatus(row).label === historyStatus;
    return matchesQuery && matchesStatus;
  });
  const canSubmit =
    Boolean(selectedPreparation) &&
    expectedBase > 0 &&
    actualBase > 0 &&
    Boolean(storageMethod) &&
    Boolean(expirationDate) &&
    lines.length > 0 &&
    !hasInvalidLine &&
    !duplicateLine &&
    !hasMissingStock;

  useEffect(() => {
    if (state.status !== "success") return;
    const timeout = window.setTimeout(() => router.refresh(), 1200);
    return () => window.clearTimeout(timeout);
  }, [router, state.status]);

  useEffect(() => {
    window.localStorage.setItem(
      productionHistoryStorageKey,
      JSON.stringify(visibleHistoryColumns.filter((column) => historyColumns.includes(column)))
    );
  }, [visibleHistoryColumns]);

  function pickPreparation(preparation: ProductionPreparationOption) {
    setSelectedPreparation(preparation);
    setPreparationQuery(preparation.name);
    setIsPreparationOpen(false);
    setExpectedQuantity("");
    setActualQuantity("");
    setExpectedUnit(preferredVisibleUnit(preparation.unit_kind));
    setActualUnit(preferredVisibleUnit(preparation.unit_kind));
    setActualTouched(false);
    const firstMethod = preparation.conservation_rules[0]?.storage_method ?? "";
    setStorageMethod(firstMethod);
    setExpirationDate(firstMethod ? suggestedExpiration(preparation, firstMethod, elaboratedAt) : "");
    setExpirationTouched(false);
    setLines(
      preparation.recipe_items.map((item) => {
        const source = sourceByKey.get(lineKey(item.source_kind, item.source_id)) ?? null;
        return {
          key: crypto.randomUUID(),
          source,
          quantity: "",
          unit: item.unit,
          fromRecipe: true
        };
      })
    );
  }

  function suggestedExpiration(preparation: ProductionPreparationOption, method: string, dateValue: string) {
    const rule = preparation.conservation_rules.find((item) => item.storage_method === method);
    return rule ? addDuration(dateValue, rule.duration_value, rule.duration_unit) : "";
  }

  function rescaleRecipe(nextExpectedQuantity: string, nextExpectedUnit: StockUnit) {
    if (!selectedPreparation) return;
    const nextBase = convertQuantity(parseUiNumber(nextExpectedQuantity), nextExpectedUnit, selectedPreparation.base_unit, selectedPreparation.density);
    const nextScale = selectedPreparation.base_yield_quantity > 0 && nextBase > 0 ? nextBase / selectedPreparation.base_yield_quantity : 0;
    setLines((current) =>
      current.map((line) => {
        if (!line.fromRecipe || !line.source) return line;
        const recipeLine = selectedPreparation.recipe_items.find((item) => lineKey(item.source_kind, item.source_id) === lineKey(line.source!.source_kind, line.source!.id));
        if (!recipeLine) return line;
        const quantity = recipeLine.quantity * nextScale;
        return { ...line, quantity: quantity > 0 ? formatNumber(quantity, quantity % 1 === 0 ? 0 : 3) : "" };
      })
    );
  }

  function updateExpected(quantity: string, unit = expectedUnit) {
    const cleaned = quantity.replace(/[^\d.,]/g, "");
    setExpectedQuantity(cleaned);
    rescaleRecipe(cleaned, unit);
    if (!actualTouched) {
      setActualQuantity(cleaned);
      setActualUnit(unit);
    }
  }

  function resetForm() {
    setSelectedPreparation(null);
    setPreparationQuery("");
    setIsPreparationOpen(false);
    setActivePreparationIndex(0);
    setElaboratedAt(todayBogota());
    setStorageMethod("");
    setExpirationDate("");
    setExpirationTouched(false);
    setExpectedQuantity("");
    setExpectedUnit("unit");
    setActualQuantity("");
    setActualUnit("unit");
    setActualTouched(false);
    setLines([]);
    setSubmitted(false);
  }

  function cancelForm() {
    const hasChanges = Boolean(selectedPreparation || expectedQuantity || actualQuantity || lines.some((line) => line.quantity || line.source));
    if (hasChanges && !window.confirm("Cancelar y limpiar esta produccion sin registrar?")) return;
    resetForm();
  }

  function addManualLine() {
    setLines((current) => [...current, { key: crypto.randomUUID(), source: null, quantity: "", unit: "g", fromRecipe: false }]);
  }

  function showHistoryColumn(column: HistoryColumnKey) {
    return visibleHistoryColumns.includes(column);
  }

  function toggleHistoryColumn(column: HistoryColumnKey) {
    setVisibleHistoryColumns((current) => (current.includes(column) ? current.filter((item) => item !== column) : [...current, column]));
  }

  function payloadItems() {
    return JSON.stringify(
      lines
        .filter((line) => line.source)
        .map((line) => ({
          source_kind: line.source!.source_kind,
          source_id: line.source!.id,
          quantity: parseUiNumber(line.quantity),
          unit: line.unit
        }))
    );
  }

  return (
    <section className="module-stack">
      <form action={formAction} className="form-panel production-register-panel" onSubmit={() => setSubmitted(true)}>
        <div className="section-title-row">
          <h2>Registrar produccion</h2>
          <span className="stock-pill neutral">Codigo automatico</span>
        </div>

        <section className="form-section">
          <h3>Seleccion</h3>
          <div className="form-grid">
            <div className="field autocomplete-field full">
              <label>Preparacion</label>
              <div className="locked-input">
                <input
                  autoComplete="off"
                  disabled={Boolean(selectedPreparation)}
                  onBlur={() => window.setTimeout(() => setIsPreparationOpen(false), 120)}
                  onChange={(event) => {
                    setPreparationQuery(uppercaseMasterName(event.target.value));
                    setIsPreparationOpen(true);
                    setActivePreparationIndex(0);
                  }}
                  onFocus={() => setIsPreparationOpen(true)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setIsPreparationOpen(true);
                      setActivePreparationIndex((current) => Math.min(current + 1, Math.max(preparationMatches.length - 1, 0)));
                    }
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setActivePreparationIndex((current) => Math.max(current - 1, 0));
                    }
                    if (event.key === "Enter" && preparationMatches[activePreparationIndex]) {
                      event.preventDefault();
                      pickPreparation(preparationMatches[activePreparationIndex]);
                    }
                    if (event.key === "Escape") setIsPreparationOpen(false);
                  }}
                  placeholder="Buscar preparacion activa"
                  value={selectedPreparation?.name ?? preparationQuery}
                />
                {selectedPreparation ? (
                  <button
                    aria-label="Limpiar preparacion"
                    className="clear-selection-button"
                    onClick={() => {
                      setSelectedPreparation(null);
                      setPreparationQuery("");
                      setLines([]);
                      setExpectedQuantity("");
                      setActualQuantity("");
                      setActualTouched(false);
                    }}
                    type="button"
                  >
                    <X size={15} />
                  </button>
                ) : null}
              </div>
              {isPreparationOpen && !selectedPreparation ? (
                <div className="autocomplete-menu">
                  {preparationMatches.map((preparation, index) => (
                    <button
                      className={`autocomplete-option${index === activePreparationIndex ? " active" : ""}`}
                      disabled={preparation.recipe_items.length === 0}
                      key={preparation.id}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        if (preparation.recipe_items.length > 0) pickPreparation(preparation);
                      }}
                      type="button"
                    >
                      <span>{preparation.name}</span>
                      <span className={`availability-badge ${preparation.recipe_items.length ? "ok" : "danger"}`}>
                        {preparation.recipe_items.length ? "CON RECETA" : "SIN RECETA"}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {selectedPreparation ? (
              <div className="production-selected-card full">
                {selectedPreparation.image_src ? (
                  <Image alt={selectedPreparation.name} className="inventory-product-photo" height={44} src={selectedPreparation.image_src} unoptimized width={58} />
                ) : (
                  <span className="inventory-photo-placeholder">Sin foto</span>
                )}
                <div>
                  <strong>{selectedPreparation.name}</strong>
                  <span>
                    Rendimiento base: {formatStockQuantity(selectedPreparation.base_yield_quantity, selectedPreparation.base_unit)} / {selectedPreparation.conservation_profile_name ?? "Sin perfil"}
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        {selectedPreparation ? (
          <>
            <section className="form-section">
              <h3>Datos de produccion</h3>
              <div className="production-dates-grid">
                <div className="field">
                  <label>Fecha de elaboracion</label>
                  <input
                    name="elaborated_at"
                    onChange={(event) => {
                      setElaboratedAt(event.target.value);
                      if (!expirationTouched && storageMethod) setExpirationDate(suggestedExpiration(selectedPreparation, storageMethod, event.target.value));
                    }}
                    type="date"
                    value={elaboratedAt}
                  />
                </div>
                <div className="field">
                  <label>Metodo de conservacion</label>
                  <select
                    name="storage_method"
                    onChange={(event) => {
                      const nextMethod = event.target.value as StorageMethod;
                      setStorageMethod(nextMethod);
                      if (!expirationTouched) setExpirationDate(suggestedExpiration(selectedPreparation, nextMethod, elaboratedAt));
                    }}
                    value={storageMethod}
                  >
                    <option value="">Seleccionar</option>
                    {allowedMethods.map((method) => (
                      <option key={method} value={method}>
                        {storageMethodLabel(method)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Vencimiento</label>
                  <input
                    name="expiration_date"
                    onChange={(event) => {
                      setExpirationDate(event.target.value);
                      setExpirationTouched(true);
                    }}
                    type="date"
                    value={expirationDate}
                  />
                </div>
              </div>
            </section>

            <section className="form-section">
              <h3>Cantidad planificada</h3>
              <p className="section-help">Indica cuanto deseas producir. Se usara para precargar los ingredientes; podras ajustarlos antes de registrar.</p>
              <div className="production-quantity-grid">
                <div className="field">
                  <label>Cantidad planificada</label>
                  <div className="split-input">
                    <input name="expected_quantity" onChange={(event) => updateExpected(event.target.value)} value={expectedQuantity} />
                    <select
                      name="expected_unit"
                      onChange={(event) => {
                        const nextUnit = event.target.value as StockUnit;
                        setExpectedUnit(nextUnit);
                        updateExpected(expectedQuantity, nextUnit);
                      }}
                      value={expectedUnit}
                    >
                      {availableUnits.map((unit) => (
                        <option key={unit} value={unit}>
                          {unitLabel(unit)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </section>

            <section className="form-section">
              <div className="section-title-row">
                <h3>Ingredientes escalados</h3>
              </div>
              <div className="recipe-lines">
                {lines.map((line, index) => {
                  const status = lineStates.find((item) => item.key === line.key);
                  return (
                    <ProductionLineEditor
                      index={index}
                      key={line.key}
                      line={line}
                      onlyAvailable={!line.fromRecipe}
                      onChange={(patch) => setLines((current) => current.map((item) => (item.key === line.key ? { ...item, ...patch } : item)))}
                      onRemove={() => setLines((current) => current.filter((item) => item.key !== line.key))}
                      sources={sources}
                      status={status}
                    />
                  );
                })}
                <div className="ingredient-add-row">
                  <button className="ghost-button" onClick={addManualLine} type="button">
                    <Plus size={16} /> Agregar ingrediente
                  </button>
                </div>
              </div>
              {duplicateLine ? <p className="field-hint danger">No repitas ingredientes o preparaciones.</p> : null}
              {hasMissingStock ? <p className="field-hint danger">Hay ingredientes con stock insuficiente.</p> : null}
              {submitted && hasInvalidLine ? <p className="field-hint danger">Completa todos los ingredientes con cantidades mayores a cero.</p> : null}
            </section>

            <section className="form-section">
              <h3>Cantidad realmente obtenida</h3>
              <p className="section-help">Despues de revisar los ingredientes, registra la cantidad final que realmente obtuviste.</p>
              <div className="production-quantity-grid">
                <div className="field">
                  <label>Cantidad realmente obtenida</label>
                  <div className="split-input">
                    <input
                      name="actual_quantity"
                      onChange={(event) => {
                        setActualTouched(true);
                        setActualQuantity(event.target.value.replace(/[^\d.,]/g, ""));
                      }}
                      value={actualQuantity}
                    />
                    <select
                      name="actual_unit"
                      onChange={(event) => {
                        setActualTouched(true);
                        setActualUnit(event.target.value as StockUnit);
                      }}
                      value={actualUnit}
                    >
                      {availableUnits.map((unit) => (
                        <option key={unit} value={unit}>
                          {unitLabel(unit)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </section>

            <section className="form-section">
              <h3>Resumen</h3>
              <div className="production-summary-grid">
                <div><strong>Preparacion</strong><span>{selectedPreparation.name}</span></div>
                <div><strong>Elaboracion</strong><span>{elaboratedAt}</span></div>
                <div className="highlight"><strong>Vencimiento</strong><span>{expirationDate || "Pendiente"}</span></div>
                <div><strong>Cantidad planificada</strong><span>{expectedBase > 0 ? formatStockQuantity(expectedBase, selectedPreparation.base_unit) : "Pendiente"}</span></div>
                <div className="highlight"><strong>Cantidad realmente obtenida</strong><span>{actualBase > 0 ? formatStockQuantity(actualBase, selectedPreparation.base_unit) : "Pendiente"}</span></div>
                <div className="highlight"><strong>Costo total estimado</strong><span>{formatCop(totalCost, { decimals: true })}</span></div>
                <div className="highlight"><strong>Costo unitario estimado</strong><span>{formatCop(unitCost, { decimals: true })}</span></div>
                <div><strong>Ingredientes</strong><span>{lines.length}</span></div>
              </div>
            </section>
          </>
        ) : null}

        <input name="preparation_id" type="hidden" value={selectedPreparation?.id ?? ""} />
        <input name="items" type="hidden" value={payloadItems()} />
        {state.status !== "idle" ? (
          <p className={`form-status ${state.status}`}>
            {state.status === "success" && state.production
              ? `${state.message} ${state.production.code}: ${formatCop(Number(state.production.total_cost_cop), { decimals: true })}, vence ${state.production.expiration_date}.`
              : state.message}
          </p>
        ) : null}
        <div className="form-actions modal-form-actions">
          <button className="ghost-button" onClick={cancelForm} type="button">
            Cancelar
          </button>
          <ProductionSubmitButton disabled={!canSubmit} />
        </div>
      </form>

      <section className="form-panel">
        <div className="section-title-row inventory-toolbar-row">
          <h2>Historial de producciones</h2>
          <div className="purchase-toolbar">
            <form className="table-filters" onSubmit={(event) => event.preventDefault()}>
              <input autoComplete="off" onChange={(event) => setHistoryQuery(uppercaseMasterName(event.target.value))} placeholder="Buscar produccion" value={historyQuery} />
              <select onChange={(event) => setHistoryStatus(event.target.value)} value={historyStatus}>
                <option value="">Todos</option>
                <option value="Disponible">Disponibles</option>
                <option value="Agotada">Agotadas</option>
                <option value="Vencida">Vencidas</option>
                <option value="Vence hoy">Vence hoy</option>
              </select>
            </form>
            <button className="ghost-button icon-text-button" onClick={() => setShowHistorySettings(true)} type="button">
              <Settings size={18} /> Configuracion
            </button>
          </div>
        </div>
        <div className="data-table-wrap">
          <table className="data-table production-history-table">
            <thead>
              <tr>
                <th>Codigo</th>
                {showHistoryColumn("preparation") ? <th>Preparacion</th> : null}
                {showHistoryColumn("elaborated") ? <th>Elaboracion</th> : null}
                {showHistoryColumn("quantity") ? <th>Cantidad</th> : null}
                {showHistoryColumn("stock") ? <th>Saldo</th> : null}
                {showHistoryColumn("expiration") ? <th>Vencimiento</th> : null}
                {showHistoryColumn("totalCost") ? <th>Costo total</th> : null}
                {showHistoryColumn("unitCost") ? <th>Costo unitario</th> : null}
                {showHistoryColumn("user") ? <th>Usuario</th> : null}
                {showHistoryColumn("status") ? <th>Estado</th> : null}
                {showHistoryColumn("actions") ? <th className="actions-column">Acciones</th> : null}
              </tr>
            </thead>
            <tbody>
              {filteredHistory.map((row) => {
                const status = productionStatus(row);
                return (
                  <tr key={row.id}>
                    <td><strong>{row.code}</strong></td>
                    {showHistoryColumn("preparation") ? <td><span className="truncate-cell" title={row.preparation_name}>{row.preparation_name}</span></td> : null}
                    {showHistoryColumn("elaborated") ? <td>{row.elaborated_at}</td> : null}
                    {showHistoryColumn("quantity") ? <td>{formatStockQuantity(row.actual_quantity_base, row.base_unit)}</td> : null}
                    {showHistoryColumn("stock") ? <td>{formatStockQuantity(row.stock_base, row.base_unit)}</td> : null}
                    {showHistoryColumn("expiration") ? <td>{row.expiration_date}</td> : null}
                    {showHistoryColumn("totalCost") ? <td>{formatCop(row.total_cost_cop, { decimals: true })}</td> : null}
                    {showHistoryColumn("unitCost") ? <td>{formatCop(row.unit_cost_cop, { decimals: true })}</td> : null}
                    {showHistoryColumn("user") ? <td><span className="truncate-cell" title={row.user_label}>{row.user_label}</span></td> : null}
                    {showHistoryColumn("status") ? <td><span className={`stock-pill ${status.className}`}>{status.label}</span></td> : null}
                    {showHistoryColumn("actions") ? (
                      <td className="actions-column">
                        <div className="row-actions production-row-actions">
                          <button className="icon-button" onClick={() => setDetailProduction(row)} title="Ver detalle" type="button">
                            <Eye size={16} />
                          </button>
                          <button className="icon-button" onClick={() => setEditBlockedProduction(row)} title="Editar" type="button">
                            <Edit3 size={16} />
                          </button>
                          <ProductionDeleteButton production={row} />
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filteredHistory.length === 0 ? <p className="muted">No hay producciones con esos filtros.</p> : null}
        </div>
        {showHistorySettings ? (
          <div className="modal-backdrop" role="presentation">
            <section aria-label="Configuracion de historial de producciones" aria-modal="true" className="modal-panel inventory-settings-modal" role="dialog">
              <header className="modal-header">
                <div>
                  <strong>Configuracion de historial</strong>
                  <span>Columnas guardadas en este navegador.</span>
                </div>
                <button className="icon-button" onClick={() => setShowHistorySettings(false)} title="Cerrar" type="button">
                  <X size={18} />
                </button>
              </header>
              <div className="compact-card">
                <div className="field full">
                  <label>Columnas</label>
                  <div className="column-settings-grid">
                    {historyColumns.map((column) => (
                      <label className="check-option" key={column}>
                        <input checked={visibleHistoryColumns.includes(column)} onChange={() => toggleHistoryColumn(column)} type="checkbox" />
                        <span>{historyColumnLabel(column)}</span>
                      </label>
                    ))}
                  </div>
                  <p className="field-hint">Codigo siempre permanece visible.</p>
                </div>
                <div className="form-actions">
                  <button className="ghost-button" onClick={() => setVisibleHistoryColumns(defaultHistoryColumns)} type="button">
                    Restablecer columnas
                  </button>
                  <button className="primary-button" onClick={() => setShowHistorySettings(false)} type="button">
                    Aplicar
                  </button>
                </div>
              </div>
            </section>
          </div>
        ) : null}
        {detailProduction ? (
          <ProductionDetailModal production={detailProduction} onClose={() => setDetailProduction(null)} />
        ) : null}
        {editBlockedProduction ? (
          <div className="modal-backdrop" role="presentation">
            <section aria-label="Editar produccion" aria-modal="true" className="modal-panel production-detail-modal" role="dialog">
              <header className="modal-header">
                <div>
                  <strong>Editar {editBlockedProduction.code}</strong>
                  <span>{editBlockedProduction.preparation_name}</span>
                </div>
                <button className="icon-button" onClick={() => setEditBlockedProduction(null)} title="Cerrar" type="button">
                  <X size={18} />
                </button>
              </header>
              <div className="compact-card">
                <p className="field-hint">
                  Esta produccion ya fue confirmada y por ahora no se edita directamente para conservar trazabilidad de consumos,
                  costos y lote producido. La correccion auditada de fecha, vencimiento o conservacion queda pendiente para una RPC
                  especifica.
                </p>
                <div className="form-actions">
                  <button className="primary-button" onClick={() => setEditBlockedProduction(null)} type="button">
                    Entendido
                  </button>
                </div>
              </div>
            </section>
          </div>
        ) : null}
      </section>
    </section>
  );
}

function ProductionDetailModal({ production, onClose }: { production: ProductionHistoryRow; onClose: () => void }) {
  const status = productionStatus(production);
  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-label={`Detalle de produccion ${production.code}`} aria-modal="true" className="modal-panel production-detail-modal" role="dialog">
        <header className="modal-header">
          <div>
            <strong>{production.code}</strong>
            <span>{production.preparation_name}</span>
          </div>
          <button className="icon-button" onClick={onClose} title="Cerrar" type="button">
            <X size={18} />
          </button>
        </header>
        <div className="production-summary-grid production-detail-grid">
          <div><strong>Preparacion</strong><span>{production.preparation_name}</span></div>
          <div><strong>Elaboracion</strong><span>{production.elaborated_at}</span></div>
          <div><strong>Vencimiento</strong><span>{production.expiration_date}</span></div>
          <div><strong>Conservacion</strong><span>{storageMethodLabel(production.storage_method)}</span></div>
          <div className="highlight"><strong>Cantidad producida</strong><span>{formatStockQuantity(production.actual_quantity_base, production.base_unit)}</span></div>
          <div><strong>Saldo</strong><span>{formatStockQuantity(production.stock_base, production.base_unit)}</span></div>
          <div className="highlight"><strong>Costo total</strong><span>{formatCop(production.total_cost_cop, { decimals: true })}</span></div>
          <div className="highlight"><strong>Costo unitario</strong><span>{formatCop(production.unit_cost_cop, { decimals: true })}</span></div>
          <div><strong>Usuario</strong><span>{production.user_label}</span></div>
          <div><strong>Estado</strong><span className={`stock-pill ${status.className}`}>{status.label}</span></div>
        </div>
        <div className="compact-card production-consumption-card">
          <h3>Ingredientes consumidos</h3>
          {production.ingredients_consumed.length > 0 ? (
            <div className="data-table-wrap">
              <table className="data-table compact-data-table production-consumption-table">
                <thead>
                  <tr>
                    <th>Ingrediente</th>
                    <th>Tipo</th>
                    <th>Cantidad</th>
                    <th>Costo</th>
                    <th>Origen</th>
                  </tr>
                </thead>
                <tbody>
                  {production.ingredients_consumed.map((ingredient) => (
                    <tr key={ingredient.id}>
                      <td>{ingredient.source_name}</td>
                      <td>{ingredient.source_kind === "preparation" ? "Preparacion" : "Ingrediente"}</td>
                      <td>{formatStockQuantity(ingredient.quantity_base, ingredient.base_unit)}</td>
                      <td>{formatCop(ingredient.cost_cop, { decimals: true })}</td>
                      <td>
                        {(ingredient.allocations ?? []).length > 0
                          ? (ingredient.allocations ?? []).map((allocation) => (
                              <span className="origin-cell" key={allocation.id} title={`${formatStockQuantity(allocation.quantity_base, allocation.base_unit)} - ${formatCop(allocation.cost_cop, { decimals: true })}`}>
                                <strong>{allocation.origin_label}</strong>
                                <small>{formatStockQuantity(allocation.quantity_base, allocation.base_unit)}</small>
                              </span>
                            ))
                          : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">No hay ingredientes consumidos registrados.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function ProductionDeleteButton({ production }: { production: ProductionHistoryRow }) {
  const router = useRouter();
  const [state, formAction] = useActionState(deleteProduction, { status: "idle", message: "" } satisfies FormActionState);

  useEffect(() => {
    if (state.status !== "success") return;
    const timeout = window.setTimeout(() => router.refresh(), 900);
    return () => window.clearTimeout(timeout);
  }, [router, state.status]);

  return (
    <form
      action={formAction}
      className="inline-action-form"
      onSubmit={(event) => {
        if (!window.confirm(`Eliminar la produccion ${production.code}? Solo se eliminara si no tiene dependencias posteriores.`)) {
          event.preventDefault();
        }
      }}
    >
      <input name="production_id" type="hidden" value={production.id} />
      <ProductionDeleteSubmitButton />
      {state.status === "error" ? <span className="row-action-message error" title={state.message}>{state.message}</span> : null}
      {state.status === "success" ? <span className="row-action-message success" title={state.message}>{state.message}</span> : null}
    </form>
  );
}

function ProductionDeleteSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="icon-button danger-button" disabled={pending} title={pending ? "Eliminando" : "Eliminar"} type="submit">
      <Trash2 size={16} />
    </button>
  );
}

function ProductionLineEditor({
  index,
  line,
  sources,
  status,
  onlyAvailable,
  onChange,
  onRemove
}: {
  index: number;
  line: DraftLine;
  sources: ProductionSourceOption[];
  status?: { baseQuantity: number; missing: number; cost: number; isValid: boolean };
  onlyAvailable: boolean;
  onChange: (patch: Partial<DraftLine>) => void;
  onRemove: () => void;
}) {
  const [query, setQuery] = useState(line.source?.name ?? "");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const filteredSources = sources
    .filter((source) => !onlyAvailable || source.stock_base > 0)
    .filter((source) => normalizeMasterText(source.name).includes(normalizeMasterText(query)))
    .slice(0, 12);
  const unitOptions = line.source ? unitOptionsForKind(line.source.unit_kind) : (["g", "kg", "ml", "l", "unit"] as StockUnit[]);

  function pickSource(source: ProductionSourceOption) {
    onChange({ source, unit: unitOptionsForKind(source.unit_kind)[0] });
    setQuery(source.name);
    setIsOpen(false);
    setActiveIndex(0);
  }
  const stockText = line.source
    ? status && status.missing > 0
      ? `Disponible: ${formatStockQuantity(line.source.stock_base, line.source.base_unit)} · Faltan ${formatStockQuantity(status.missing, line.source.base_unit)}`
      : formatStockQuantity(line.source.stock_base, line.source.base_unit)
    : "Pendiente";

  return (
    <div className="recipe-line production-line">
      <input name={`production_items[${index}][source_kind]`} type="hidden" value={line.source?.source_kind ?? ""} />
      <input name={`production_items[${index}][source_id]`} type="hidden" value={line.source?.id ?? ""} />
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
        <input onChange={(event) => onChange({ quantity: event.target.value.replace(/[^\d.,]/g, "") })} placeholder="Ingrese cantidad" value={line.quantity} />
      </div>
      <div className="field">
        <label>Unidad</label>
        <select onChange={(event) => onChange({ unit: event.target.value as StockUnit })} value={line.unit}>
          {unitOptions.map((unit) => (
            <option key={unit} value={unit}>
              {unitLabel(unit)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Stock</label>
        <div aria-readonly="true" className={`readonly-stock-control ${status && status.missing <= 0 ? "ok" : "danger"}`} role="textbox" title={stockText}>
          <span>{stockText}</span>
        </div>
      </div>
      <button className="icon-button danger-button" onClick={onRemove} title="Eliminar ingrediente" type="button">
        <X size={16} />
      </button>
    </div>
  );
}

function ProductionSubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className="primary-button" disabled={disabled || pending} type="submit">
      {pending ? "Registrando..." : "Registrar produccion"}
    </button>
  );
}
