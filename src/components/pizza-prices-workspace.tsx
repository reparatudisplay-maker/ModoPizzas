"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { Pencil, Plus, Settings, Trash2, X } from "lucide-react";
import { deletePizzaPrice, savePizzaPrice, type FormActionState } from "@/app/admin/actions";
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

function totalsFor(components: PizzaPriceRecord["components"] | PriceComponentState[], sourcesByKey: Map<string, PizzaPriceSource>, salePrice: number) {
  let hasMissingCost = false;
  const cost = components.reduce((sum, component) => {
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

type ModalState = PizzaPriceRecord | null;

export function PizzaPricesWorkspace({
  prices,
  flavors,
  sizes,
  categories,
  sources
}: {
  prices: PizzaPriceRecord[];
  flavors: PizzaPriceFlavor[];
  sizes: PizzaPriceSize[];
  categories: PizzaPriceCategory[];
  sources: PizzaPriceSource[];
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
                const totals = totalsFor(price.components, sourcesByKey, price.sale_price_cop);
                return (
                  <tr key={price.id}>
                    {columns.includes("sku") ? <td>{price.sku}</td> : null}
                    <td><strong>{price.flavor_name}</strong></td>
                    {columns.includes("category") ? <td>{price.category_name ?? "Sin categoria"}</td> : null}
                    {columns.includes("size") ? <td>{price.size_name}</td> : null}
                    {columns.includes("components") ? <td title={price.components.map((component) => component.source_name).join(", ")}>{price.components.length} componentes</td> : null}
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

function PizzaPriceModal({ item, flavors, sizes, sources, onClose }: { item: PizzaPriceRecord | null; flavors: PizzaPriceFlavor[]; sizes: PizzaPriceSize[]; sources: PizzaPriceSource[]; onClose: () => void }) {
  const [state, action] = useActionState(savePizzaPrice, initialState);
  const [flavorId, setFlavorId] = useState(item?.flavor_id ?? "");
  const [sizeId, setSizeId] = useState(item?.size_id ?? "");
  const [salePrice, setSalePrice] = useState(item?.sale_price_cop ? String(item.sale_price_cop) : "");
  const sourcesByKey = useMemo(() => new Map(sources.map((source) => [`${source.source_kind}:${source.id}`, source])), [sources]);
  const initialRows = item?.components.map((component) => ({
    key: `${component.source_kind}:${component.source_id}`,
    source_kind: component.source_kind,
    source_id: component.source_id,
    source_name: component.source_name,
    display_quantity: String(component.display_quantity || ""),
    display_unit: component.display_unit
  })) ?? [];
  const [components, setComponents] = useState<PriceComponentState[]>(initialRows);

  function componentsFromFlavor(flavor: PizzaPriceFlavor) {
    return flavor.characteristic_ingredients.map((component) => {
      const source = sourcesByKey.get(`${component.source_kind}:${component.source_id}`);
      return {
        key: `${component.source_kind}:${component.source_id}`,
        source_kind: component.source_kind,
        source_id: component.source_id,
        source_name: component.source_name,
        display_quantity: "",
        display_unit: unitOptionsFor(source?.unit ?? "unit")[0]
      };
    });
  }

  useEffect(() => {
    if (state.status === "success") {
      const timeout = window.setTimeout(onClose, 900);
      return () => window.clearTimeout(timeout);
    }
  }, [onClose, state.status]);

  const totals = totalsFor(components, sourcesByKey, Number(salePrice || 0));
  const componentsPayload = components.map((component) => ({
    source_kind: component.source_kind,
    source_id: component.source_id,
    quantity: Number(String(component.display_quantity).replace(",", ".")),
    unit: component.display_unit,
    estimated_cost_cop: componentCost(Number(String(component.display_quantity).replace(",", ".")), component.display_unit, sourcesByKey.get(component.key))
  }));
  const availableSources = sources.filter((source) => !components.some((component) => component.key === `${source.source_kind}:${source.id}`));

  function updateComponent(key: string, patch: Partial<PriceComponentState>) {
    setComponents((current) => current.map((component) => (component.key === key ? { ...component, ...patch } : component)));
  }

  function addComponent(sourceId: string) {
    const source = sources.find((item) => `${item.source_kind}:${item.id}` === sourceId);
    if (!source) return;
    setComponents((current) => [
      ...current,
      {
        key: `${source.source_kind}:${source.id}`,
        source_kind: source.source_kind,
        source_id: source.id,
        source_name: source.name,
        display_quantity: "",
        display_unit: unitOptionsFor(source.unit)[0]
      }
    ]);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-label={item ? "Editar precio de pizza" : "Agregar precio de pizza"} aria-modal="true" className="modal-panel wide-modal" role="dialog">
        <header className="modal-header">
          <div><strong>{item ? "Editar precio" : "Agregar precio"}</strong><span>Receta, costo vigente y precio por sabor + tamano.</span></div>
          <button className="icon-button" onClick={onClose} title="Cerrar" type="button"><X size={18} /></button>
        </header>
        <form action={action} className="compact-card">
          {item ? <input name="id" type="hidden" value={item.id} /> : null}
          <input name="components" type="hidden" value={JSON.stringify(componentsPayload)} />
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
                  if (!item) {
                    const nextFlavor = flavors.find((flavor) => flavor.id === nextFlavorId);
                    setComponents(nextFlavor ? componentsFromFlavor(nextFlavor) : []);
                  }
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
              <select name="size_id" onChange={(event) => setSizeId(event.target.value)} required value={sizeId}>
                <option value="">Selecciona tamano</option>
                {sizes.map((size) => <option key={size.id} value={size.id}>{size.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Precio de venta</label>
              <input inputMode="numeric" name="sale_price_cop" onChange={(event) => setSalePrice(event.target.value.replace(/\D/g, ""))} placeholder="$ 0" required value={salePrice} />
            </div>
          </div>
          <div className="field full">
            <label>Componentes</label>
            <div className="pizza-price-component-list">
              {components.map((component) => {
                const source = sourcesByKey.get(component.key);
                const units = unitOptionsFor(source?.unit ?? component.display_unit);
                const cost = componentCost(Number(String(component.display_quantity).replace(",", ".")), component.display_unit, source);
                return (
                  <div className="pizza-price-component-row" key={component.key}>
                    <strong>{component.source_name}</strong>
                    <input inputMode="decimal" onChange={(event) => updateComponent(component.key, { display_quantity: event.target.value })} placeholder="Cantidad" value={component.display_quantity} />
                    <select onChange={(event) => updateComponent(component.key, { display_unit: event.target.value as StockUnit })} value={component.display_unit}>
                      {units.map((unit) => <option key={unit} value={unit}>{formatUnit(unit)}</option>)}
                    </select>
                    <span className="readonly-chip">{cost === null ? "Sin costo disponible" : `Costo ${formatCop(cost)}`}</span>
                    <button className="icon-button danger-button" onClick={() => setComponents((current) => current.filter((item) => item.key !== component.key))} title="Eliminar componente" type="button"><X size={16} /></button>
                  </div>
                );
              })}
              {components.length === 0 ? <p className="muted">Selecciona un sabor o agrega componentes manualmente.</p> : null}
            </div>
            <div className="quick-actions-row">
              <select onChange={(event) => { addComponent(event.target.value); event.currentTarget.value = ""; }} value="">
                <option value="">Agregar ingrediente o preparacion</option>
                {availableSources.map((source) => <option key={`${source.source_kind}:${source.id}`} value={`${source.source_kind}:${source.id}`}>{source.name}</option>)}
              </select>
            </div>
          </div>
          <div className="summary-grid price-summary-grid">
            <div><span>Costo estimado</span><strong>{totals.cost === null ? "Sin costo disponible" : formatCop(totals.cost)}</strong></div>
            <div><span>Precio de venta</span><strong>{salePrice ? formatCop(Number(salePrice)) : "$ 0"}</strong></div>
            <div><span>Utilidad</span><strong>{totals.profit === null ? "Sin utilidad" : formatCop(totals.profit)}</strong></div>
            <div><span>Margen</span><strong>{formatPercent(totals.margin)}</strong></div>
          </div>
          {totals.cost !== null && Number(salePrice || 0) < totals.cost ? <p className="form-status error">El precio esta por debajo del costo vigente.</p> : null}
          {totals.cost === null ? <p className="form-status error">Hay componentes sin costo disponible; el margen no puede calcularse.</p> : null}
          <label className="check-option">
            <input defaultChecked={item?.is_active ?? true} name="is_active" type="checkbox" />
            <span>Activo</span>
          </label>
          {state.status !== "idle" ? <p className={`form-status ${state.status}`}>{state.message}</p> : null}
          <div className="form-actions modal-form-actions">
            <button className="ghost-button" onClick={onClose} type="button">Cancelar</button>
            <SubmitButton label={item ? "Actualizar precio" : "Guardar precio"} />
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

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <button className="primary-button" disabled={pending} type="submit">{pending ? "Guardando..." : label}</button>;
}
