"use client";

import { useActionState, useCallback, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { Pencil, Plus, Save, Settings, Trash2, X } from "lucide-react";
import { deletePizzaPrice, savePizzaPrice, savePizzaSizeBaseSource, savePizzaSizeComponentQuantities, type FormActionState } from "@/app/admin/actions";
import { normalizeMasterText, uppercaseMasterName } from "@/lib/master-normalization";

type StockUnit = "g" | "kg" | "ml" | "l" | "unit";
type StatusFilter = "" | "active" | "inactive";
type PriceColumn = "sku" | "category" | "size" | "components" | "cost" | "price" | "profit" | "margin" | "status" | "actions";
type SourceKind = "inventory_item" | "preparation";

export type PizzaPriceSource = {
  id: string;
  name: string;
  source_kind: SourceKind;
  unit: StockUnit;
  unit_cost_cop: number | null;
  stock_base: number;
};

export type PizzaPriceFlavor = {
  id: string;
  name: string;
  menu_category_id: string | null;
  menu_category_name: string | null;
  is_active: boolean;
  characteristic_ingredients: { source_kind: SourceKind; source_id: string; source_name: string }[];
};

export type PizzaPriceSize = {
  id: string;
  name: string;
  is_active: boolean;
};

export type PizzaPriceCategory = {
  id: string;
  name: string;
  is_active: boolean;
};

export type PizzaPriceRecord = {
  id: string;
  sku: string;
  flavor_id: string;
  flavor_name: string;
  category_id: string | null;
  category_name: string | null;
  size_id: string;
  size_name: string;
  sale_price_cop: number;
  is_active: boolean;
  components: {
    source_kind: SourceKind;
    source_id: string;
    source_name: string;
    quantity_base: number;
    unit: StockUnit;
    display_quantity: number;
    display_unit: StockUnit;
  }[];
};

export type PizzaPriceBaseSource = {
  size_id: string;
  source_kind: SourceKind;
  source_id: string;
  source_name: string;
  quantity_base: number;
  unit: StockUnit;
  display_quantity: number;
  display_unit: StockUnit;
};

export type PizzaSizeComponentQuantity = {
  pizza_size_id: string;
  source_kind: SourceKind;
  source_id: string;
  quantity_base: number;
  unit: StockUnit;
};

const initialState: FormActionState = { status: "idle", message: "" };
const storageKey = "modopizzas.menu-prices.pizzas.columns";
const defaultColumns: PriceColumn[] = ["sku", "category", "size", "components", "cost", "price", "profit", "margin", "status", "actions"];
const allColumns: PriceColumn[] = ["sku", "category", "size", "components", "cost", "price", "profit", "margin", "status", "actions"];

function readColumns() {
  if (typeof window === "undefined") return defaultColumns;
  const saved = window.localStorage.getItem(storageKey);
  if (!saved) return defaultColumns;
  try {
    const parsed = JSON.parse(saved);
    const clean = Array.isArray(parsed) ? parsed.filter((column): column is PriceColumn => allColumns.includes(column)) : [];
    return clean.length ? clean : defaultColumns;
  } catch {
    window.localStorage.removeItem(storageKey);
    return defaultColumns;
  }
}

function formatCop(value: number) {
  return `$ ${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(value)}`;
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "Sin margen";
  return `${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 }).format(value)}%`;
}

function formatUnit(unit: StockUnit) {
  return unit === "unit" ? "UND" : unit.toUpperCase();
}

function isDoughSource(source: Pick<PizzaPriceSource, "name">) {
  return normalizeMasterText(source.name).includes("MASA");
}

function canonicalUnit(unit: StockUnit) {
  if (unit === "kg" || unit === "g") return "g";
  if (unit === "l" || unit === "ml") return "ml";
  return "unit";
}

function convertQuantity(quantity: number, fromUnit: StockUnit, toUnit: StockUnit) {
  if (fromUnit === toUnit) return quantity;
  if (fromUnit === "kg" && toUnit === "g") return quantity * 1000;
  if (fromUnit === "g" && toUnit === "kg") return quantity / 1000;
  if (fromUnit === "l" && toUnit === "ml") return quantity * 1000;
  if (fromUnit === "ml" && toUnit === "l") return quantity / 1000;
  return quantity;
}

function unitOptionsFor(unit: StockUnit) {
  const baseUnit = canonicalUnit(unit);
  if (baseUnit === "g") return ["g", "kg"] as StockUnit[];
  if (baseUnit === "ml") return ["ml", "l"] as StockUnit[];
  return ["unit"] as StockUnit[];
}

function componentCost(quantity: number, unit: StockUnit, source?: PizzaPriceSource) {
  if (!source?.unit_cost_cop || source.unit_cost_cop <= 0) return null;
  const baseUnit = canonicalUnit(unit);
  if (baseUnit !== canonicalUnit(source.unit)) return null;
  return convertQuantity(quantity, unit, baseUnit) * source.unit_cost_cop;
}

function totalsFor(
  components: PizzaPriceRecord["components"] | PriceComponentState[],
  sourcesByKey: Map<string, PizzaPriceSource>,
  salePrice: number,
  baseSource?: PizzaPriceBaseSource | BaseSourceState | null
) {
  let hasMissingCost = false;
  let cost = 0;
  if (baseSource) {
    const baseKey = `${baseSource.source_kind}:${baseSource.source_id}`;
    const baseCost = componentCost(Number(String(baseSource.display_quantity).replace(",", ".")), baseSource.display_unit, sourcesByKey.get(baseKey));
    if (baseCost === null) hasMissingCost = true;
    cost += baseCost ?? 0;
  } else {
    hasMissingCost = true;
  }
  cost += components.reduce((sum, component) => {
    const quantity = Number(String(component.display_quantity).replace(",", "."));
    const sourceId = "source_id" in component ? component.source_id : "";
    const key = `${component.source_kind}:${sourceId}`;
    const rowCost = componentCost(quantity, component.display_unit, sourcesByKey.get(key));
    if (rowCost === null) hasMissingCost = true;
    return sum + (rowCost ?? 0);
  }, 0);
  const finalCost = hasMissingCost ? null : cost;
  return {
    cost: finalCost,
    profit: finalCost === null ? null : salePrice - finalCost,
    margin: finalCost === null || salePrice <= 0 ? null : ((salePrice - finalCost) / salePrice) * 100
  };
}

function columnLabel(column: PriceColumn) {
  const labels: Record<PriceColumn, string> = {
    sku: "SKU",
    category: "Categoria",
    size: "Tamano",
    components: "Componentes",
    cost: "Costo estimado",
    price: "Precio venta",
    profit: "Utilidad",
    margin: "Margen",
    status: "Estado",
    actions: "Acciones"
  };
  return labels[column];
}

type PriceComponentState = {
  key: string;
  source_kind: SourceKind;
  source_id: string;
  source_name: string;
  display_quantity: string;
  display_unit: StockUnit;
};

type BaseSourceState = {
  source_kind: SourceKind;
  source_id: string;
  display_quantity: string;
  display_unit: StockUnit;
};

type ModalState = PizzaPriceRecord | null;

export function PizzaPricesWorkspace({
  prices,
  flavors,
  sizes,
  categories,
  sources,
  baseSources,
  componentQuantities
}: {
  prices: PizzaPriceRecord[];
  flavors: PizzaPriceFlavor[];
  sizes: PizzaPriceSize[];
  categories: PizzaPriceCategory[];
  sources: PizzaPriceSource[];
  baseSources: PizzaPriceBaseSource[];
  componentQuantities: PizzaSizeComponentQuantity[];
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [sizeFilter, setSizeFilter] = useState("");
  const [columns, setColumns] = useState<PriceColumn[]>(defaultColumns);
  const [columnsLoaded, setColumnsLoaded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [modal, setModal] = useState<ModalState | undefined>(undefined);
  const sourcesByKey = useMemo(() => new Map(sources.map((source) => [`${source.source_kind}:${source.id}`, source])), [sources]);
  const baseSourcesBySize = useMemo(() => new Map(baseSources.map((base) => [base.size_id, base])), [baseSources]);
  const normalizedQuery = normalizeMasterText(query);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setColumns(readColumns());
      setColumnsLoaded(true);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (columnsLoaded) window.localStorage.setItem(storageKey, JSON.stringify(columns));
  }, [columns, columnsLoaded]);

  const filteredPrices = useMemo(() => {
    return prices.filter((price) => {
      const text = `${price.sku} ${price.flavor_name} ${price.category_name ?? ""} ${price.size_name} ${price.components.map((component) => component.source_name).join(" ")}`;
      const matchesQuery = !normalizedQuery || normalizeMasterText(text).includes(normalizedQuery);
      const matchesStatus = status === "active" ? price.is_active : status === "inactive" ? !price.is_active : true;
      const matchesCategory = categoryFilter ? price.category_id === categoryFilter : true;
      const matchesSize = sizeFilter ? price.size_id === sizeFilter : true;
      return matchesQuery && matchesStatus && matchesCategory && matchesSize;
    });
  }, [categoryFilter, normalizedQuery, prices, sizeFilter, status]);

  function toggleColumn(column: PriceColumn) {
    setColumns((current) => (current.includes(column) ? current.filter((item) => item !== column) : [...current, column]));
  }

  return (
    <>
      <section className="form-panel">
        <div className="section-title-row inventory-toolbar-row">
          <h2>Precios de pizzas</h2>
          <div className="purchase-toolbar">
            <form className="table-filters" onSubmit={(event) => event.preventDefault()}>
              <input autoComplete="off" onChange={(event) => setQuery(uppercaseMasterName(event.target.value))} placeholder="Buscar precio" value={query} />
              <select onChange={(event) => setCategoryFilter(event.target.value)} title="Categoria" value={categoryFilter}>
                <option value="">Todas las categorias</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
              <select onChange={(event) => setSizeFilter(event.target.value)} title="Tamano" value={sizeFilter}>
                <option value="">Todos los tamanos</option>
                {sizes.map((size) => (
                  <option key={size.id} value={size.id}>
                    {size.name}
                  </option>
                ))}
              </select>
              <select onChange={(event) => setStatus(event.target.value as StatusFilter)} title="Estado" value={status}>
                <option value="">Todos</option>
                <option value="active">Activos</option>
                <option value="inactive">Inactivos</option>
              </select>
            </form>
            <button className="ghost-button icon-text-button" onClick={() => setShowSettings(true)} type="button">
              <Settings size={18} /> Configuracion
            </button>
            <button className="primary-button add-purchase-button" onClick={() => setModal(null)} type="button">
              <Plus size={18} /> Agregar precio
            </button>
          </div>
        </div>
        <div className="menu-pizzas-table-wrap">
          <table className="data-table menu-pizzas-table">
            <thead>
              <tr>
                {columns.includes("sku") ? <th>SKU</th> : null}
                <th>SABOR</th>
                {columns.includes("category") ? <th>CATEGORIA</th> : null}
                {columns.includes("size") ? <th>TAMANO</th> : null}
                {columns.includes("components") ? <th>COMPONENTES</th> : null}
                {columns.includes("cost") ? <th>COSTO ESTIMADO</th> : null}
                {columns.includes("price") ? <th>PRECIO VENTA</th> : null}
                {columns.includes("profit") ? <th>UTILIDAD</th> : null}
                {columns.includes("margin") ? <th>MARGEN</th> : null}
                {columns.includes("status") ? <th>ESTADO</th> : null}
                {columns.includes("actions") ? <th className="actions-column compact-actions-column">ACCIONES</th> : null}
              </tr>
            </thead>
            <tbody>
              {filteredPrices.map((price) => {
                const totals = totalsFor(price.components, sourcesByKey, price.sale_price_cop, baseSourcesBySize.get(price.size_id));
                return (
                  <tr key={price.id}>
                    {columns.includes("sku") ? <td>{price.sku}</td> : null}
                    <td><strong>{price.flavor_name}</strong></td>
                    {columns.includes("category") ? <td>{price.category_name ?? "Sin categoria"}</td> : null}
                    {columns.includes("size") ? <td>{price.size_name}</td> : null}
                    {columns.includes("components") ? (
                      <td title={["Base", ...price.components.map((component) => component.source_name)].join(", ")}>
                        {baseSourcesBySize.has(price.size_id) ? `Base + ${price.components.length} componentes` : `${price.components.length} componentes`}
                      </td>
                    ) : null}
                    {columns.includes("cost") ? <td>{totals.cost === null ? "Sin costo disponible" : formatCop(totals.cost)}</td> : null}
                    {columns.includes("price") ? <td>{formatCop(price.sale_price_cop)}</td> : null}
                    {columns.includes("profit") ? <td>{totals.profit === null ? "Sin utilidad" : formatCop(totals.profit)}</td> : null}
                    {columns.includes("margin") ? <td>{formatPercent(totals.margin)}</td> : null}
                    {columns.includes("status") ? <td><span className={`stock-pill ${price.is_active ? "ok" : "muted"}`}>{price.is_active ? "Activo" : "Inactivo"}</span></td> : null}
                    {columns.includes("actions") ? (
                      <td className="actions-column compact-actions-column">
                        <span className="row-actions center-actions">
                          <button className="icon-button" onClick={() => setModal(price)} title={`Editar ${price.flavor_name} ${price.size_name}`} type="button"><Pencil size={16} /></button>
                          <DeletePriceButton id={price.id} name={`${price.flavor_name} ${price.size_name}`} />
                        </span>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
              {filteredPrices.length === 0 ? <tr><td colSpan={11}>Sin precios configurados.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
      {modal !== undefined ? (
        <PizzaPriceModal
          flavors={flavors.filter((flavor) => flavor.is_active || flavor.id === modal?.flavor_id)}
          item={modal}
          onClose={() => setModal(undefined)}
          sizes={sizes.filter((size) => size.is_active || size.id === modal?.size_id)}
          sources={sources}
          baseSourcesBySize={baseSourcesBySize}
          componentQuantities={componentQuantities}
        />
      ) : null}
      {showSettings ? (
        <div className="modal-backdrop" role="presentation">
          <section aria-label="Configuracion de columnas" aria-modal="true" className="modal-panel inventory-settings-modal" role="dialog">
            <header className="modal-header">
              <div><strong>Configuracion de precios</strong><span>Preferencias guardadas en este navegador.</span></div>
              <button className="icon-button" onClick={() => setShowSettings(false)} title="Cerrar" type="button"><X size={18} /></button>
            </header>
            <div className="compact-card">
              <div className="field full">
                <label>Columnas</label>
                <div className="column-settings-grid">
                  {allColumns.map((column) => (
                    <label className="check-option" key={column}>
                      <input checked={columns.includes(column)} onChange={() => toggleColumn(column)} type="checkbox" />
                      <span>{columnLabel(column)}</span>
                    </label>
                  ))}
                </div>
                <p className="field-hint">Sabor siempre permanece visible.</p>
              </div>
              <div className="form-actions">
                <button className="ghost-button" onClick={() => setColumns(defaultColumns)} type="button">Restablecer columnas</button>
                <button className="primary-button" onClick={() => setShowSettings(false)} type="button">Cerrar</button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

export function PizzaSizeBaseSourcesWorkspace({
  sizes,
  sources,
  baseSources
}: {
  sizes: PizzaPriceSize[];
  sources: PizzaPriceSource[];
  baseSources: PizzaPriceBaseSource[];
}) {
  const sourcesByKey = useMemo(() => new Map(sources.map((source) => [`${source.source_kind}:${source.id}`, source])), [sources]);
  const baseSourcesBySize = useMemo(() => new Map(baseSources.map((base) => [base.size_id, base])), [baseSources]);

  return (
    <div className="pizza-base-source-grid">
      {sizes.map((size) => (
        <PizzaSizeBaseSourceRow baseSource={baseSourcesBySize.get(size.id) ?? null} key={size.id} size={size} sources={sources} sourcesByKey={sourcesByKey} />
      ))}
    </div>
  );
}

export function PizzaSizeComponentQuantitiesWorkspace({
  sizes,
  sources,
  baseSources,
  componentQuantities
}: {
  sizes: PizzaPriceSize[];
  sources: PizzaPriceSource[];
  baseSources: PizzaPriceBaseSource[];
  componentQuantities: PizzaSizeComponentQuantity[];
}) {
  const [state, action] = useActionState(savePizzaSizeComponentQuantities, initialState);
  const [showAdd, setShowAdd] = useState(false);
  const [addedSources, setAddedSources] = useState<PizzaPriceSource[]>([]);
  const [removedKeys, setRemovedKeys] = useState<Set<string>>(() => new Set());
  const baseKeys = useMemo(
    () => new Set(baseSources.map((source) => `${source.source_kind}:${source.source_id}`)),
    [baseSources]
  );
  const quantitiesByKey = useMemo(() => new Map(componentQuantities.map((quantity) => [`${quantity.pizza_size_id}:${quantity.source_kind}:${quantity.source_id}`, quantity])), [componentQuantities]);
  const configuredKeys = useMemo(() => new Set(componentQuantities.map((quantity) => `${quantity.source_kind}:${quantity.source_id}`)), [componentQuantities]);
  const editableSources = useMemo(() => {
    const sourceByKey = new Map(sources.map((source) => [`${source.source_kind}:${source.id}`, source]));
    const configured = Array.from(configuredKeys, (key) => sourceByKey.get(key)).filter((source): source is PizzaPriceSource => Boolean(source));
    return [...configured, ...addedSources].filter((source, index, all) => {
      const key = `${source.source_kind}:${source.id}`;
      return !baseKeys.has(key) && !removedKeys.has(key) && !isDoughSource(source) && all.findIndex((item) => `${item.source_kind}:${item.id}` === key) === index;
    });
  }, [addedSources, baseKeys, configuredKeys, removedKeys, sources]);

  function addIngredient(source: PizzaPriceSource) {
    setAddedSources((current) => [...current, source]);
    setShowAdd(false);
  }

  function removeIngredient(source: PizzaPriceSource) {
    const key = `${source.source_kind}:${source.id}`;
    setRemovedKeys((current) => new Set(current).add(key));
    setAddedSources((current) => current.filter((item) => `${item.source_kind}:${item.id}` !== key));
  }

  return (
    <form action={action} className="pizza-grammage-form" onSubmit={(event) => {
      const rows = Array.from(event.currentTarget.querySelectorAll<HTMLInputElement>("input[data-grammage-cell='true']"))
        .map((input) => ({
          pizza_size_id: input.dataset.sizeId,
          source_kind: input.dataset.sourceKind,
          source_id: input.dataset.sourceId,
          unit: input.dataset.unit,
          quantity_base: input.value.trim() || "0"
        }));
      const payload = event.currentTarget.elements.namedItem("rows");
      if (payload instanceof HTMLInputElement) payload.value = JSON.stringify(rows);
    }}>
      <input name="rows" type="hidden" value="[]" />
      <div className="section-title-row">
        <h2>Gramajes por tamano</h2>
        <button className="primary-button" onClick={() => setShowAdd(true)} type="button"><Plus size={18} /> Agregar ingrediente</button>
      </div>
      <div className="pizza-grammage-wrap">
        <table className="data-table pizza-grammage-table">
          <thead>
            <tr>
              <th>INGREDIENTE</th>
              {sizes.map((size) => <th key={size.id}>{size.name}</th>)}
              <th className="actions-column">ACCIONES</th>
            </tr>
          </thead>
          <tbody>
            {editableSources.map((source) => (
              <tr key={`${source.source_kind}:${source.id}`}>
                <td><strong>{source.name}</strong><small>{source.source_kind === "preparation" ? "Preparacion" : "Ingrediente"}</small></td>
                {sizes.map((size) => {
                  const quantity = quantitiesByKey.get(`${size.id}:${source.source_kind}:${source.id}`);
                  return (
                    <td key={size.id}>
                      <input
                        aria-label={`${source.name} ${size.name}`}
                        data-grammage-cell="true"
                        data-size-id={size.id}
                        data-source-id={source.id}
                        data-source-kind={source.source_kind}
                        data-unit={canonicalUnit(source.unit)}
                        defaultValue={quantity?.quantity_base ?? "0"}
                        inputMode="decimal"
                        min="0"
                        placeholder="—"
                        step="0.001"
                      />
                      <small>{formatUnit(canonicalUnit(source.unit) as StockUnit)}</small>
                    </td>
                  );
                })}
                <td className="actions-column"><RemoveGrammageSourceButton onRemove={() => removeIngredient(source)} source={source} /></td>
              </tr>
            ))}
            {editableSources.length === 0 ? <tr><td colSpan={sizes.length + 2}>Agrega un ingrediente para configurar sus gramajes.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className="form-actions">
        {state.status !== "idle" ? <p className={`form-status ${state.status}`}>{state.message}</p> : null}
        <MatrixSubmitButton />
      </div>
      {showAdd ? <AddGrammageIngredientModal existingKeys={new Set(editableSources.map((source) => `${source.source_kind}:${source.id}`))} onClose={() => setShowAdd(false)} onSelect={addIngredient} sources={sources.filter((source) => source.source_kind === "inventory_item")} /> : null}
    </form>
  );
}

function AddGrammageIngredientModal({
  sources,
  existingKeys,
  onSelect,
  onClose
}: {
  sources: PizzaPriceSource[];
  existingKeys: Set<string>;
  onSelect: (source: PizzaPriceSource) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const available = useMemo(() => sources.filter((source) => !existingKeys.has(`${source.source_kind}:${source.id}`) && !isDoughSource(source) && normalizeMasterText(source.name).includes(normalizeMasterText(query))), [existingKeys, query, sources]);

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-label="Agregar ingrediente a gramajes" aria-modal="true" className="modal-panel compact-modal" role="dialog">
        <header className="modal-header">
          <div><strong>Agregar ingrediente</strong><span>Solo ingredientes activos que no sean base comun.</span></div>
          <button className="icon-button" onClick={onClose} title="Cerrar" type="button"><X size={18} /></button>
        </header>
        <div className="compact-card">
          <div className="field full">
            <label>Ingrediente</label>
            <input autoComplete="off" autoFocus onChange={(event) => {
              setQuery(uppercaseMasterName(event.target.value));
              setHighlighted(0);
            }} onKeyDown={(event) => {
              if (event.key === "ArrowDown") { event.preventDefault(); setHighlighted((current) => Math.min(current + 1, Math.max(available.length - 1, 0))); }
              if (event.key === "ArrowUp") { event.preventDefault(); setHighlighted((current) => Math.max(current - 1, 0)); }
              if (event.key === "Enter" && available[highlighted]) { event.preventDefault(); onSelect(available[highlighted]); }
              if (event.key === "Escape") { event.preventDefault(); onClose(); }
            }} placeholder="Buscar ingrediente activo" value={query} />
            <div className="autocomplete-list" role="listbox">
              {available.map((source, index) => <button className={`autocomplete-option${highlighted === index ? " selected" : ""}`} key={source.id} onClick={() => onSelect(source)} onMouseEnter={() => setHighlighted(index)} type="button">{source.name}</button>)}
              {available.length === 0 ? <p className="muted">No hay ingredientes disponibles.</p> : null}
            </div>
          </div>
          <div className="form-actions"><button className="ghost-button" onClick={onClose} type="button">Cancelar</button></div>
        </div>
      </section>
    </div>
  );
}

function RemoveGrammageSourceButton({ source, onRemove }: { source: PizzaPriceSource; onRemove: () => void }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <span className="inline-form compact-confirm-actions">
      {confirming ? <><button className="ghost-button danger-button compact-confirm-button" onClick={onRemove} type="button">Eliminar</button><button className="icon-button" onClick={() => setConfirming(false)} title="Cancelar" type="button"><X size={16} /></button></> : <button className="icon-button danger-button" onClick={() => setConfirming(true)} title={`Quitar ${source.name} de gramajes`} type="button"><Trash2 size={16} /></button>}
    </span>
  );
}

function PizzaSizeBaseSourceRow({
  size,
  baseSource,
  sources,
  sourcesByKey
}: {
  size: PizzaPriceSize;
  baseSource: PizzaPriceBaseSource | null;
  sources: PizzaPriceSource[];
  sourcesByKey: Map<string, PizzaPriceSource>;
}) {
  const [state, action] = useActionState(savePizzaSizeBaseSource, initialState);
  const [sourceKind, setSourceKind] = useState<SourceKind>(baseSource?.source_kind ?? "inventory_item");
  const [sourceId, setSourceId] = useState(baseSource?.source_id ?? "");
  const [quantity, setQuantity] = useState(baseSource?.display_quantity ? String(baseSource.display_quantity) : "1");
  const [unit, setUnit] = useState<StockUnit>(baseSource?.display_unit ?? "unit");
  const sourceOptions = sources.filter((source) => source.source_kind === sourceKind);
  const selectedSource = sourcesByKey.get(`${sourceKind}:${sourceId}`);
  const unitOptions = unitOptionsFor(selectedSource?.unit ?? unit);
  const effectiveUnit = unitOptions.includes(unit) ? unit : unitOptions[0];
  const cost = selectedSource ? componentCost(Number(String(quantity).replace(",", ".")), effectiveUnit, selectedSource) : null;

  return (
    <form action={action} className="pizza-base-source-row">
      <input name="pizza_size_id" type="hidden" value={size.id} />
      <strong>{size.name}</strong>
      <select
        name="source_kind"
        onChange={(event) => {
          setSourceKind(event.target.value as SourceKind);
          setSourceId("");
          setUnit("unit");
        }}
        value={sourceKind}
      >
        <option value="inventory_item">Ingrediente</option>
        <option value="preparation">Preparacion</option>
      </select>
      <select
        name="source_id"
        onChange={(event) => {
          const nextSourceId = event.target.value;
          setSourceId(nextSourceId);
          const nextSource = sourcesByKey.get(`${sourceKind}:${nextSourceId}`);
          setUnit(unitOptionsFor(nextSource?.unit ?? "unit")[0]);
        }}
        required
        value={sourceId}
      >
        <option value="">Selecciona componente</option>
        {sourceOptions.map((source) => (
          <option key={source.id} value={source.id}>
            {source.name}
          </option>
        ))}
      </select>
      <input inputMode="decimal" name="quantity" onChange={(event) => setQuantity(event.target.value)} placeholder="Cantidad" required value={quantity} />
      <select name="unit" onChange={(event) => setUnit(event.target.value as StockUnit)} value={effectiveUnit}>
        {unitOptions.map((option) => (
          <option key={option} value={option}>
            {formatUnit(option)}
          </option>
        ))}
      </select>
      <span className="readonly-chip">{cost === null ? "Sin costo disponible" : `Costo ${formatCop(cost)}`}</span>
      <BaseSubmitButton />
      {state.status !== "idle" ? <span className={`row-action-message ${state.status}`}>{state.message}</span> : null}
    </form>
  );
}

function PizzaPriceModal({
  item,
  flavors,
  sizes,
  sources,
  baseSourcesBySize,
  componentQuantities,
  onClose
}: {
  item: PizzaPriceRecord | null;
  flavors: PizzaPriceFlavor[];
  sizes: PizzaPriceSize[];
  sources: PizzaPriceSource[];
  baseSourcesBySize: Map<string, PizzaPriceBaseSource>;
  componentQuantities: PizzaSizeComponentQuantity[];
  onClose: () => void;
}) {
  const [state, action] = useActionState(savePizzaPrice, initialState);
  const [flavorId, setFlavorId] = useState(item?.flavor_id ?? "");
  const [sizeId, setSizeId] = useState(item?.size_id ?? "");
  const [salePrice, setSalePrice] = useState(item?.sale_price_cop ? String(item.sale_price_cop) : "");
  const sourcesByKey = useMemo(() => new Map(sources.map((source) => [`${source.source_kind}:${source.id}`, source])), [sources]);
  const selectedBaseSource = sizeId ? baseSourcesBySize.get(sizeId) ?? null : null;
  const selectedBaseKey = selectedBaseSource ? `${selectedBaseSource.source_kind}:${selectedBaseSource.source_id}` : null;
  const reservedBaseKeys = useMemo(
    () => new Set(Array.from(baseSourcesBySize.values(), (base) => `${base.source_kind}:${base.source_id}`)),
    [baseSourcesBySize]
  );
  const isReservedBase = useCallback((key: string) => {
    const source = sourcesByKey.get(key);
    return reservedBaseKeys.has(key) || Boolean(source && isDoughSource(source));
  }, [reservedBaseKeys, sourcesByKey]);
  const quantitiesByKey = useMemo(
    () => new Map(componentQuantities.map((quantity) => [`${quantity.pizza_size_id}:${quantity.source_kind}:${quantity.source_id}`, quantity])),
    [componentQuantities]
  );
  const selectedFlavor = flavors.find((flavor) => flavor.id === flavorId) ?? null;
  const components = useMemo(() => (selectedFlavor?.characteristic_ingredients ?? [])
    .filter((component) => !isReservedBase(`${component.source_kind}:${component.source_id}`))
    .map((component) => {
      const source = sourcesByKey.get(`${component.source_kind}:${component.source_id}`);
      const quantity = sizeId ? quantitiesByKey.get(`${sizeId}:${component.source_kind}:${component.source_id}`) : undefined;
      return {
        key: `${component.source_kind}:${component.source_id}`,
        source_kind: component.source_kind,
        source_id: component.source_id,
        source_name: component.source_name,
        display_quantity: quantity ? String(quantity.quantity_base) : "",
        display_unit: quantity?.unit ?? canonicalUnit(source?.unit ?? "unit") as StockUnit
      };
    }), [isReservedBase, quantitiesByKey, selectedFlavor, sizeId, sourcesByKey]);

  useEffect(() => {
    if (state.status === "success") {
      const timeout = window.setTimeout(onClose, 900);
      return () => window.clearTimeout(timeout);
    }
  }, [onClose, state.status]);

  const hasMissingGrammage = Boolean(selectedFlavor && components.some((component) => Number(component.display_quantity) <= 0));
  const totals = totalsFor(components, sourcesByKey, Number(salePrice || 0), selectedBaseSource);

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-label={item ? "Editar precio de pizza" : "Agregar precio de pizza"} aria-modal="true" className="modal-panel wide-modal" role="dialog">
        <header className="modal-header">
          <div><strong>{item ? "Editar precio" : "Agregar precio"}</strong><span>Receta, costo vigente y precio por sabor + tamano.</span></div>
          <button className="icon-button" onClick={onClose} title="Cerrar" type="button"><X size={18} /></button>
        </header>
        <form action={action} className="compact-card">
          {item ? <input name="id" type="hidden" value={item.id} /> : null}
          <input name="estimated_cost_cop" type="hidden" value={totals.cost ?? 0} />
          <input name="margin_percent" type="hidden" value={totals.margin ?? 0} />
          <div className="form-grid">
            <div className="field">
              <label>Sabor</label>
              <select
                name="flavor_id"
                onChange={(event) => {
                  const nextFlavorId = event.target.value;
                  setFlavorId(nextFlavorId);
                }}
                required
                value={flavorId}
              >
                <option value="">Selecciona sabor</option>
                {flavors.map((flavor) => <option key={flavor.id} value={flavor.id}>{flavor.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Tamano</label>
              <select
                name="size_id"
                onChange={(event) => {
                  const nextSizeId = event.target.value;
                  setSizeId(nextSizeId);
                }}
                required
                value={sizeId}
              >
                <option value="">Selecciona tamano</option>
                {sizes.map((size) => <option key={size.id} value={size.id}>{size.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Precio de venta</label>
              <input inputMode="numeric" name="sale_price_cop" onChange={(event) => setSalePrice(event.target.value.replace(/\D/g, ""))} placeholder="$ 0" required value={salePrice} />
            </div>
          </div>
          <div className={`automatic-base-summary ${selectedBaseSource ? "" : "missing"}`}>
            <div>
              <span>Base del tamano</span>
              <strong>{selectedBaseSource?.source_name ?? "Sin base comun configurada"}</strong>
              <small>
                {selectedBaseSource
                  ? `${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 3 }).format(selectedBaseSource.display_quantity)} ${formatUnit(selectedBaseSource.display_unit)} · Automatica`
                  : "Configura la base comun por tamano en Menu → Recetas."}
              </small>
            </div>
            <span className="readonly-chip">
              {selectedBaseSource && sourcesByKey.has(selectedBaseKey ?? "")
                ? (() => {
                    const cost = componentCost(selectedBaseSource.display_quantity, selectedBaseSource.display_unit, sourcesByKey.get(selectedBaseKey ?? ""));
                    return cost === null ? "Sin costo disponible" : `Costo ${formatCop(cost)}`;
                  })()
                : "Sin costo disponible"}
            </span>
          </div>
          <div className="field full">
            <label>Componentes del sabor</label>
            <div className="pizza-price-component-list">
              {components.map((component) => {
                const source = sourcesByKey.get(component.key);
                const cost = componentCost(Number(String(component.display_quantity).replace(",", ".")), component.display_unit, source);
                return (
                  <div className="pizza-price-component-row" key={component.key}>
                    <strong>{component.source_name}</strong>
                    <span className="readonly-chip">{Number(component.display_quantity) > 0 ? `${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 3 }).format(Number(component.display_quantity))} ${formatUnit(component.display_unit)}` : "Sin gramaje configurado"}</span>
                    <span className="readonly-chip">{cost === null ? "Sin costo disponible" : `Costo ${formatCop(cost)}`}</span>
                  </div>
                );
              })}
              {components.length === 0 ? <p className="muted">Selecciona un sabor con ingredientes caracteristicos.</p> : null}
            </div>
            <p className="field-hint">Los gramajes se administran globalmente por tamano en Menu → Recetas.</p>
          </div>
          <div className="summary-grid price-summary-grid">
            <div><span>Costo estimado</span><strong>{totals.cost === null ? "Sin costo disponible" : formatCop(totals.cost)}</strong></div>
            <div><span>Precio de venta</span><strong>{salePrice ? formatCop(Number(salePrice)) : "$ 0"}</strong></div>
            <div><span>Utilidad</span><strong>{totals.profit === null ? "Sin utilidad" : formatCop(totals.profit)}</strong></div>
            <div><span>Margen</span><strong>{formatPercent(totals.margin)}</strong></div>
          </div>
          {totals.cost !== null && Number(salePrice || 0) < totals.cost ? <p className="form-status error">El precio esta por debajo del costo vigente.</p> : null}
          {hasMissingGrammage ? <p className="form-status error">Configura los gramajes globales de todos los ingredientes del sabor para este tamano.</p> : null}
          {!hasMissingGrammage && totals.cost === null ? <p className="form-status error">Hay componentes sin costo disponible; el margen no puede calcularse.</p> : null}
          <label className="check-option">
            <input defaultChecked={item?.is_active ?? true} name="is_active" type="checkbox" />
            <span>Activo</span>
          </label>
          {state.status !== "idle" ? <p className={`form-status ${state.status}`}>{state.message}</p> : null}
          <div className="form-actions modal-form-actions">
            <button className="ghost-button" onClick={onClose} type="button">Cancelar</button>
            <SubmitButton disabled={!selectedBaseSource || hasMissingGrammage} label={item ? "Actualizar precio" : "Guardar precio"} />
          </div>
        </form>
      </section>
    </div>
  );
}

function DeletePriceButton({ id, name }: { id: string; name: string }) {
  const [state, action] = useActionState(deletePizzaPrice, initialState);
  const [confirming, setConfirming] = useState(false);
  return (
    <span className="product-delete-form">
      {confirming ? (
        <form action={action} className="inline-form compact-confirm-actions">
          <input name="id" type="hidden" value={id} />
          <button className="ghost-button danger-button compact-confirm-button" title={`Confirmar eliminacion de ${name}`} type="submit">Eliminar</button>
          <button className="icon-button" onClick={() => setConfirming(false)} title="Cancelar eliminacion" type="button"><X size={16} /></button>
        </form>
      ) : (
        <button className="icon-button danger-button" onClick={() => setConfirming(true)} title={`Eliminar ${name}`} type="button"><Trash2 size={16} /></button>
      )}
      {state.status !== "idle" ? <span className={`row-action-message ${state.status}`}>{state.message}</span> : null}
    </span>
  );
}

function SubmitButton({ label, disabled = false }: { label: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return <button className="primary-button" disabled={pending || disabled} type="submit">{pending ? "Guardando..." : label}</button>;
}

function BaseSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="ghost-button icon-text-button" disabled={pending} type="submit">
      <Save size={16} /> {pending ? "Guardando..." : "Guardar"}
    </button>
  );
}

function MatrixSubmitButton() {
  const { pending } = useFormStatus();
  return <button className="primary-button" disabled={pending} type="submit">{pending ? "Guardando..." : "Guardar gramajes"}</button>;
}
