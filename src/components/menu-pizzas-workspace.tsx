"use client";

import Image from "next/image";
import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, Check, ImagePlus, Pencil, Plus, Settings, Trash2, X } from "lucide-react";
import {
  moveMenuPizzaItem,
  savePizzaAddition,
  saveMenuCategory,
  savePizzaFlavor,
  savePizzaSize,
  type FormActionState
} from "@/app/admin/actions";
import { normalizeMasterText, uppercaseMasterName } from "@/lib/master-normalization";

type SectionKey = "sabores" | "tamanos" | "categorias" | "adiciones";
type StatusFilter = "" | "active" | "inactive";
type LimitFilter = "15" | "30" | "all";
type StockUnit = "g" | "kg" | "ml" | "l" | "unit";
const flavorImageMaxSize = 4 * 1024 * 1024;
const flavorImageMaxSizeMb = flavorImageMaxSize / (1024 * 1024);
const allowedFlavorImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

type FlavorIngredientSource = {
  id: string;
  name: string;
  source_kind: "inventory_item" | "preparation";
};
type FlavorIngredientSelection = {
  source_kind: "inventory_item" | "preparation";
  source_id: string;
  source_name: string;
};
export type AdditionIngredientSource = {
  id: string;
  name: string;
  image_src?: string | null;
  source_kind: "inventory_item";
  unit: StockUnit;
  stock_base: number;
  unit_cost_cop: number | null;
};

export type MenuCategoryRecord = {
  id: string;
  name: string;
  sku: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
};

export type PizzaSizeRecord = {
  id: string;
  name: string;
  sku: string;
  diameter_cm: number;
  slices_count: number;
  sort_order: number;
  is_active: boolean;
  created_at: string;
};

export type PizzaFlavorRecord = {
  id: string;
  name: string;
  sku: string;
  commercial_description: string;
  image_url: string | null;
  image_src?: string | null;
  allows_half_and_half: boolean;
  menu_category_id: string | null;
  menu_category_name: string | null;
  allergens: string | null;
  sort_order: number;
  characteristic_ingredients: FlavorIngredientSelection[];
  is_active: boolean;
  created_at: string;
};

export type PizzaAdditionRecord = {
  id: string;
  sku: string;
  name: string;
  source_kind: "inventory_item" | "preparation";
  source_id: string;
  component_name: string;
  component_image_src?: string | null;
  component_unit: StockUnit;
  component_stock_base: number;
  component_unit_cost_cop: number | null;
  max_allowed: number;
  is_active: boolean;
  is_available: boolean;
  sort_order: number;
  created_at: string;
  sizes: {
    pizza_size_id: string;
    pizza_size_name: string;
    quantity_base: number;
    unit: "g" | "ml" | "unit";
    display_quantity: number;
    display_unit: StockUnit;
    price_cop: number;
  }[];
  compatible_flavors: { id: string; name: string }[];
  compatible_categories: { id: string; name: string }[];
};

type FlavorColumn = "sku" | "photo" | "description" | "category" | "half" | "allergens" | "status" | "actions";
type SizeColumn = "sku" | "diameter" | "slices" | "status" | "actions";
type CategoryColumn = "sku" | "description" | "status" | "actions";
type AdditionColumn = "sku" | "component" | "sizes" | "cost" | "price" | "margin" | "compatibility" | "status" | "actions";
type ModalState =
  | { section: "sabores"; item: PizzaFlavorRecord | null }
  | { section: "tamanos"; item: PizzaSizeRecord | null }
  | { section: "categorias"; item: MenuCategoryRecord | null }
  | { section: "adiciones"; item: PizzaAdditionRecord | null };

const initialState: FormActionState = { status: "idle", message: "" };
const storageKey = "modopizzas.menu-pizzas.columns";
const defaultColumns = {
  sabores: ["sku", "photo", "description", "category", "half", "allergens", "status", "actions"] as FlavorColumn[],
  tamanos: ["sku", "diameter", "slices", "status", "actions"] as SizeColumn[],
  categorias: ["sku", "description", "status", "actions"] as CategoryColumn[],
  adiciones: ["sku", "component", "sizes", "cost", "price", "margin", "compatibility", "status", "actions"] as AdditionColumn[]
};
const allColumns = {
  sabores: ["sku", "photo", "description", "category", "half", "allergens", "status", "actions"] as FlavorColumn[],
  tamanos: ["sku", "diameter", "slices", "status", "actions"] as SizeColumn[],
  categorias: ["sku", "description", "status", "actions"] as CategoryColumn[],
  adiciones: ["sku", "component", "sizes", "cost", "price", "margin", "compatibility", "status", "actions"] as AdditionColumn[]
};

type ColumnsBySection = typeof defaultColumns;

function readColumns(): ColumnsBySection {
  if (typeof window === "undefined") return defaultColumns;
  const saved = window.localStorage.getItem(storageKey);
  if (!saved) return defaultColumns;
  try {
    const parsed = JSON.parse(saved) as Partial<typeof defaultColumns>;
    return {
      sabores: sanitizeColumns(parsed.sabores, "sabores") as FlavorColumn[],
      tamanos: sanitizeColumns(parsed.tamanos, "tamanos") as SizeColumn[],
      categorias: sanitizeColumns(parsed.categorias, "categorias") as CategoryColumn[],
      adiciones: sanitizeColumns(parsed.adiciones, "adiciones") as AdditionColumn[]
    };
  } catch {
    window.localStorage.removeItem(storageKey);
    return defaultColumns;
  }
}

function sanitizeColumns(columns: unknown, section: SectionKey) {
  const allowed = allColumns[section] as string[];
  if (!Array.isArray(columns)) return defaultColumns[section];
  const clean = columns.filter((column): column is never => typeof column === "string" && allowed.includes(column));
  return clean.length ? clean : defaultColumns[section];
}

function sectionTitle(section: SectionKey) {
  if (section === "sabores") return "Sabores";
  if (section === "tamanos") return "Tamanos";
  if (section === "adiciones") return "Adiciones";
  return "Categorias";
}

function addLabel(section: SectionKey) {
  if (section === "sabores") return "Agregar sabor";
  if (section === "tamanos") return "Agregar tamano";
  if (section === "adiciones") return "Agregar adicion";
  return "Agregar categoria";
}

function columnLabel(section: SectionKey, column: string) {
  const labels: Record<string, string> = {
    photo: "Foto",
    description: "Descripcion",
    category: "Categoria",
    half: "Mitad y mitad",
    allergens: "Alergenos",
    sku: "SKU",
    diameter: "Diametro",
    slices: "Porciones",
    component: "Componente",
    sizes: "Tamanos",
    cost: "Costo",
    price: "Precio",
    margin: "Margen",
    compatibility: "Compatibles",
    status: "Estado",
    actions: "Acciones"
  };
  return labels[column] ?? column;
}

function activeLabel(active: boolean) {
  return active ? "Activo" : "Inactivo";
}

function formatCm(value: number) {
  return `${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(value)} cm`;
}

function formatCop(value: number) {
  return `$ ${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(value)}`;
}

function formatDecimal(value: number) {
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 3 }).format(value);
}

function formatUnit(unit: StockUnit) {
  if (unit === "unit") return "UND";
  return unit.toUpperCase();
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

function formatAdditionQuantity(quantity: number, unit: StockUnit) {
  return `${formatDecimal(quantity)} ${formatUnit(unit)}`;
}

function additionCost(quantityBase: number, unitCost: number | null) {
  if (!unitCost || unitCost <= 0) return null;
  return quantityBase * unitCost;
}

function additionMargin(price: number, cost: number | null) {
  if (!cost || cost <= 0 || price <= 0) return null;
  return ((price - cost) / price) * 100;
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "Sin margen";
  return `${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 }).format(value)}%`;
}

function costLabel(value: number | null) {
  return value === null ? "Sin costo disponible" : formatCop(value);
}

function skuStem(value: string) {
  const normalized = value
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]/g, "");
  return (normalized || "XXX").slice(0, 3).padEnd(3, "X");
}

function additionSkuPreview(value: string) {
  return `AD${skuStem(value)}`;
}

function orderedFirst<T extends { sort_order: number; name: string }>(items: T[]) {
  return [...items].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}

function limitItems<T>(items: T[], limit: LimitFilter) {
  if (limit === "all") return items;
  return items.slice(0, limit === "30" ? 30 : 15);
}

function imageCell(src: string | null | undefined, name: string) {
  return src ? (
    <Image alt={name} className="inventory-product-photo" height={44} src={src} unoptimized width={58} />
  ) : (
    <span className="inventory-photo-placeholder">Sin foto</span>
  );
}

export function MenuPizzasWorkspace({
  flavors,
  sizes,
  categories,
  additions,
  ingredientSources,
  additionIngredientSources,
  sections = ["sabores", "tamanos", "categorias"],
  initialSection
}: {
  flavors: PizzaFlavorRecord[];
  sizes: PizzaSizeRecord[];
  categories: MenuCategoryRecord[];
  additions: PizzaAdditionRecord[];
  ingredientSources: FlavorIngredientSource[];
  additionIngredientSources: AdditionIngredientSource[];
  sections?: SectionKey[];
  initialSection?: SectionKey;
}) {
  const availableSections = sections.length > 0 ? sections : (["sabores"] as SectionKey[]);
  const [section, setSection] = useState<SectionKey>(initialSection && availableSections.includes(initialSection) ? initialSection : availableSections[0]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [limit, setLimit] = useState<LimitFilter>("15");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [columnsBySection, setColumnsBySection] = useState<ColumnsBySection>(defaultColumns);
  const [columnsLoaded, setColumnsLoaded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [modal, setModal] = useState<ModalState | null>(null);
  const searchParams = useSearchParams();
  const routeMessage = searchParams.get("message");
  const routeMessageStatus = searchParams.get("message_status") === "success" ? "success" : "error";
  const visibleColumns = columnsBySection[section] as string[];
  const normalizedQuery = normalizeMasterText(query);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setColumnsBySection(readColumns());
      setColumnsLoaded(true);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!columnsLoaded) return;
    window.localStorage.setItem(storageKey, JSON.stringify(columnsBySection));
  }, [columnsBySection, columnsLoaded]);

  const filteredFlavors = useMemo(() => {
    const filtered = orderedFirst(flavors).filter((item) => {
      const matchesQuery =
        !normalizedQuery ||
        normalizeMasterText(`${item.name} ${item.commercial_description ?? ""} ${item.menu_category_name ?? ""} ${item.allergens ?? ""}`).includes(
          normalizedQuery
        );
      const matchesStatus = status === "active" ? item.is_active : status === "inactive" ? !item.is_active : true;
      const matchesCategory = categoryFilter ? item.menu_category_id === categoryFilter : true;
      return matchesQuery && matchesStatus && matchesCategory;
    });
    return limitItems(filtered, limit);
  }, [categoryFilter, flavors, limit, normalizedQuery, status]);

  const filteredSizes = useMemo(() => {
    const filtered = orderedFirst(sizes).filter((item) => {
      const matchesQuery = !normalizedQuery || normalizeMasterText(`${item.name} ${item.diameter_cm} ${item.slices_count}`).includes(normalizedQuery);
      const matchesStatus = status === "active" ? item.is_active : status === "inactive" ? !item.is_active : true;
      return matchesQuery && matchesStatus;
    });
    return limitItems(filtered, limit);
  }, [limit, normalizedQuery, sizes, status]);

  const filteredCategories = useMemo(() => {
    const filtered = orderedFirst(categories).filter((item) => {
      const matchesQuery = !normalizedQuery || normalizeMasterText(`${item.name} ${item.description ?? ""}`).includes(normalizedQuery);
      const matchesStatus = status === "active" ? item.is_active : status === "inactive" ? !item.is_active : true;
      return matchesQuery && matchesStatus;
    });
    return limitItems(filtered, limit);
  }, [categories, limit, normalizedQuery, status]);

  const filteredAdditions = useMemo(() => {
    const filtered = orderedFirst(additions)
      .filter((item) => {
        const compatibleText = [...item.compatible_flavors, ...item.compatible_categories].map((compatible) => compatible.name).join(" ");
        const matchesQuery =
          !normalizedQuery || normalizeMasterText(`${item.sku} ${item.name} ${item.component_name} ${compatibleText}`).includes(normalizedQuery);
        const matchesStatus = status === "active" ? item.is_active : status === "inactive" ? !item.is_active : true;
        return matchesQuery && matchesStatus;
      });
    return limitItems(filtered, limit);
  }, [additions, limit, normalizedQuery, status]);

  function showColumn(column: string) {
    return visibleColumns.includes(column);
  }

  function toggleColumn(column: string) {
    setColumnsBySection((current) => ({
      ...current,
      [section]: current[section].includes(column as never)
        ? current[section].filter((item) => item !== column)
        : [...current[section], column as never]
    }));
  }

  function resetColumns() {
    setColumnsBySection((current) => ({ ...current, [section]: defaultColumns[section] }));
  }

  function changeSection(nextSection: SectionKey) {
    setSection(nextSection);
    setQuery("");
    setStatus("");
    setCategoryFilter("");
    setLimit("15");
  }

  return (
    <>
      <nav aria-label="Secciones de pizzas" className="section-tabs inventory-section-tabs">
        {availableSections.map((item) => (
          <button className={`ghost-button${section === item ? " active-tab" : ""}`} key={item} onClick={() => changeSection(item)} type="button">
            {sectionTitle(item)}
          </button>
        ))}
      </nav>

      {routeMessage ? <p className={`form-status ${routeMessageStatus}`}>{routeMessage}</p> : null}

      <section className="form-panel">
        <div className="section-title-row inventory-toolbar-row">
          <h2>{sectionTitle(section)}</h2>
          <div className="purchase-toolbar">
            <form className="table-filters" onSubmit={(event) => event.preventDefault()}>
              <input
                autoComplete="off"
                onChange={(event) => setQuery(uppercaseMasterName(event.target.value))}
                placeholder={`Buscar ${sectionTitle(section).toLowerCase()}`}
                value={query}
              />
              <select onChange={(event) => setStatus(event.target.value as StatusFilter)} title="Estado" value={status}>
                <option value="">Todos</option>
                <option value="active">Activos</option>
                <option value="inactive">Inactivos</option>
              </select>
              <select onChange={(event) => setLimit(event.target.value as LimitFilter)} title="Cantidad de registros" value={limit}>
                <option value="15">Ultimos 15</option>
                <option value="30">Ultimos 30</option>
                <option value="all">Todos</option>
              </select>
              {section === "sabores" ? (
                <select onChange={(event) => setCategoryFilter(event.target.value)} title="Categoria" value={categoryFilter}>
                  <option value="">Todas las categorias</option>
                  {categories.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              ) : null}
            </form>
            <button className="ghost-button icon-text-button" onClick={() => setShowSettings(true)} type="button">
              <Settings size={18} /> Configuracion
            </button>
            <button className="primary-button add-purchase-button" onClick={() => setModal({ section, item: null } as ModalState)} type="button">
              <Plus size={18} /> {addLabel(section)}
            </button>
          </div>
        </div>

        {section === "sabores" ? (
          <FlavorsTable allItems={orderedFirst(flavors)} flavors={filteredFlavors} onEdit={(item) => setModal({ section: "sabores", item })} showColumn={showColumn} />
        ) : null}
        {section === "tamanos" ? (
          <SizesTable allItems={orderedFirst(sizes)} onEdit={(item) => setModal({ section: "tamanos", item })} showColumn={showColumn} sizes={filteredSizes} />
        ) : null}
        {section === "categorias" ? (
          <CategoriesTable allItems={orderedFirst(categories)} categories={filteredCategories} onEdit={(item) => setModal({ section: "categorias", item })} showColumn={showColumn} />
        ) : null}
        {section === "adiciones" ? (
          <AdditionsTable additions={filteredAdditions} allItems={orderedFirst(additions)} onEdit={(item) => setModal({ section: "adiciones", item })} showColumn={showColumn} />
        ) : null}
      </section>

      {modal ? (
        <MenuPizzaModal
          additionIngredientSources={additionIngredientSources}
          categories={categories}
          flavors={flavors}
          ingredientSources={ingredientSources}
          modal={modal}
          onClose={() => setModal(null)}
          sizes={sizes}
        />
      ) : null}

      {showSettings ? (
        <div className="modal-backdrop" role="presentation">
          <section aria-label="Configuracion de columnas" aria-modal="true" className="modal-panel inventory-settings-modal" role="dialog">
            <header className="modal-header">
              <div>
                <strong>Configuracion de {sectionTitle(section).toLowerCase()}</strong>
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
                  {allColumns[section].map((column) => (
                    <label className="check-option" key={column}>
                      <input checked={visibleColumns.includes(column)} onChange={() => toggleColumn(column)} type="checkbox" />
                      <span>{columnLabel(section, column)}</span>
                    </label>
                  ))}
                </div>
                <p className="field-hint">Nombre siempre permanece visible.</p>
              </div>
              <div className="form-actions">
                <button className="ghost-button" onClick={resetColumns} type="button">
                  Restablecer columnas
                </button>
                <button className="primary-button" onClick={() => setShowSettings(false)} type="button">
                  Cerrar
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function FlavorsTable({
  flavors,
  allItems,
  showColumn,
  onEdit
}: {
  flavors: PizzaFlavorRecord[];
  allItems: PizzaFlavorRecord[];
  showColumn: (column: string) => boolean;
  onEdit: (item: PizzaFlavorRecord) => void;
}) {
  return (
    <div className="data-table-wrap menu-pizzas-table-wrap">
      <table className="data-table rich-inventory-table menu-pizzas-table">
        <thead>
          <tr>
            <th></th>
            {showColumn("sku") ? <th>SKU</th> : null}
            {showColumn("photo") ? <th>Foto</th> : null}
            <th>Nombre</th>
            {showColumn("description") ? <th>Descripcion</th> : null}
            {showColumn("category") ? <th>Categoria</th> : null}
            {showColumn("half") ? <th>Mitad y mitad</th> : null}
            {showColumn("allergens") ? <th>Alergenos</th> : null}
            {showColumn("status") ? <th>Estado</th> : null}
            {showColumn("actions") ? <th className="actions-column compact-actions-column">Acciones</th> : null}
          </tr>
        </thead>
        <tbody>
          {flavors.map((item) => (
            <tr key={item.id}>
              <td>
                <ReorderControls id={item.id} items={allItems} section="pizza_flavors" />
              </td>
              {showColumn("sku") ? <td>{item.sku}</td> : null}
              {showColumn("photo") ? <td>{imageCell(item.image_src, item.name)}</td> : null}
              <td>
                <strong>{item.name}</strong>
              </td>
              {showColumn("description") ? <td>{item.commercial_description || "Sin descripcion"}</td> : null}
              {showColumn("category") ? <td>{item.menu_category_name ?? "Sin categoria"}</td> : null}
              {showColumn("half") ? <td>{item.allows_half_and_half ? "Si" : "No"}</td> : null}
              {showColumn("allergens") ? <td>{item.allergens || "Sin alergenos"}</td> : null}
              {showColumn("status") ? (
                <td>
                  <span className={`stock-pill ${item.is_active ? "ok" : "danger"}`}>{activeLabel(item.is_active)}</span>
                </td>
              ) : null}
              {showColumn("actions") ? (
                <td className="actions-column compact-actions-column">
                  <span className="row-actions center-actions">
                    <button className="icon-button" onClick={() => onEdit(item)} title={`Editar ${item.name}`} type="button">
                      <Pencil size={16} />
                    </button>
                    <MenuDeleteButton id={item.id} name={item.name} section="pizza_flavors" />
                  </span>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
      {flavors.length === 0 ? <p className="muted">No hay sabores con esos filtros.</p> : null}
    </div>
  );
}

function SizesTable({
  sizes,
  allItems,
  showColumn,
  onEdit
}: {
  sizes: PizzaSizeRecord[];
  allItems: PizzaSizeRecord[];
  showColumn: (column: string) => boolean;
  onEdit: (item: PizzaSizeRecord) => void;
}) {
  return (
    <div className="data-table-wrap menu-pizzas-table-wrap">
      <table className="data-table rich-inventory-table menu-pizzas-table">
        <thead>
          <tr>
            <th></th>
            {showColumn("sku") ? <th>SKU</th> : null}
            <th>Nombre</th>
            {showColumn("diameter") ? <th>Diametro</th> : null}
            {showColumn("slices") ? <th>Porciones</th> : null}
            {showColumn("status") ? <th>Estado</th> : null}
            {showColumn("actions") ? <th className="actions-column compact-actions-column">Acciones</th> : null}
          </tr>
        </thead>
        <tbody>
          {sizes.map((item) => (
            <tr key={item.id}>
              <td>
                <ReorderControls id={item.id} items={allItems} section="pizza_sizes" />
              </td>
              {showColumn("sku") ? <td>{item.sku}</td> : null}
              <td>
                <strong>{item.name}</strong>
              </td>
              {showColumn("diameter") ? <td>{formatCm(item.diameter_cm)}</td> : null}
              {showColumn("slices") ? <td>{item.slices_count}</td> : null}
              {showColumn("status") ? (
                <td>
                  <span className={`stock-pill ${item.is_active ? "ok" : "danger"}`}>{activeLabel(item.is_active)}</span>
                </td>
              ) : null}
              {showColumn("actions") ? (
                <td className="actions-column compact-actions-column">
                  <span className="row-actions center-actions">
                    <button className="icon-button" onClick={() => onEdit(item)} title={`Editar ${item.name}`} type="button">
                      <Pencil size={16} />
                    </button>
                    <MenuDeleteButton id={item.id} name={item.name} section="pizza_sizes" />
                  </span>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
      {sizes.length === 0 ? <p className="muted">No hay tamanos con esos filtros.</p> : null}
    </div>
  );
}

function CategoriesTable({
  categories,
  allItems,
  showColumn,
  onEdit
}: {
  categories: MenuCategoryRecord[];
  allItems: MenuCategoryRecord[];
  showColumn: (column: string) => boolean;
  onEdit: (item: MenuCategoryRecord) => void;
}) {
  return (
    <div className="data-table-wrap menu-pizzas-table-wrap">
      <table className="data-table rich-inventory-table menu-pizzas-table">
        <thead>
          <tr>
            <th></th>
            {showColumn("sku") ? <th>SKU</th> : null}
            <th>Nombre</th>
            {showColumn("description") ? <th>Descripcion</th> : null}
            {showColumn("status") ? <th>Estado</th> : null}
            {showColumn("actions") ? <th className="actions-column compact-actions-column">Acciones</th> : null}
          </tr>
        </thead>
        <tbody>
          {categories.map((item) => (
            <tr key={item.id}>
              <td>
                <ReorderControls id={item.id} items={allItems} section="menu_categories" />
              </td>
              {showColumn("sku") ? <td>{item.sku}</td> : null}
              <td>
                <strong>{item.name}</strong>
              </td>
              {showColumn("description") ? <td>{item.description || "Sin descripcion"}</td> : null}
              {showColumn("status") ? (
                <td>
                  <span className={`stock-pill ${item.is_active ? "ok" : "danger"}`}>{activeLabel(item.is_active)}</span>
                </td>
              ) : null}
              {showColumn("actions") ? (
                <td className="actions-column compact-actions-column">
                  <span className="row-actions center-actions">
                    <button className="icon-button" onClick={() => onEdit(item)} title={`Editar ${item.name}`} type="button">
                      <Pencil size={16} />
                    </button>
                    <MenuDeleteButton id={item.id} name={item.name} section="menu_categories" />
                  </span>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
      {categories.length === 0 ? <p className="muted">No hay categorias con esos filtros.</p> : null}
    </div>
  );
}

function AdditionsTable({
  additions,
  allItems,
  showColumn,
  onEdit
}: {
  additions: PizzaAdditionRecord[];
  allItems: PizzaAdditionRecord[];
  showColumn: (column: string) => boolean;
  onEdit: (item: PizzaAdditionRecord) => void;
}) {
  return (
    <div className="data-table-wrap menu-pizzas-table-wrap">
      <table className="data-table rich-inventory-table menu-pizzas-table menu-additions-table">
        <thead>
          <tr>
            <th></th>
            {showColumn("sku") ? <th>SKU</th> : null}
            <th>Nombre</th>
            {showColumn("component") ? <th>Componente</th> : null}
            {showColumn("sizes") ? <th>Tamanos</th> : null}
            {showColumn("cost") ? <th>Costo desde</th> : null}
            {showColumn("price") ? <th>Precio desde</th> : null}
            {showColumn("margin") ? <th>Margen</th> : null}
            {showColumn("compatibility") ? <th>Compatibles</th> : null}
            {showColumn("status") ? <th>Estado</th> : null}
            {showColumn("actions") ? <th className="actions-column compact-actions-column">Acciones</th> : null}
          </tr>
        </thead>
        <tbody>
          {additions.map((item) => {
            const sizeSummary = item.sizes.map((size) => `${size.pizza_size_name}: ${formatAdditionQuantity(size.display_quantity, size.display_unit)}`).join(", ");
            const costs = item.sizes.map((size) => additionCost(size.quantity_base, item.component_unit_cost_cop)).filter((value): value is number => value !== null);
            const prices = item.sizes.map((size) => Number(size.price_cop ?? 0)).filter((value) => value > 0);
            const minCost = costs.length ? Math.min(...costs) : null;
            const minPrice = prices.length ? Math.min(...prices) : 0;
            const margin = minPrice > 0 ? additionMargin(minPrice, minCost) : null;
            const compatibility = [
              ...item.compatible_categories.map((category) => category.name),
              ...item.compatible_flavors.map((flavor) => flavor.name)
            ].join(", ");
            return (
              <tr key={item.id}>
                <td>
                  <ReorderControls id={item.id} items={allItems} section="pizza_additions" />
                </td>
                {showColumn("sku") ? <td>{item.sku}</td> : null}
                <td>
                  <strong>{item.name}</strong>
                </td>
                {showColumn("component") ? (
                  <td>
                    {item.component_name}
                    <small className="muted block-text">Ingrediente</small>
                  </td>
                ) : null}
                {showColumn("sizes") ? (
                  <td title={sizeSummary || "Sin tamanos"}>
                    <span className="truncated-cell">{sizeSummary || "Sin tamanos"}</span>
                  </td>
                ) : null}
                {showColumn("cost") ? <td>{costLabel(minCost)}</td> : null}
                {showColumn("price") ? <td>{minPrice > 0 ? formatCop(minPrice) : "Sin precio"}</td> : null}
                {showColumn("margin") ? <td className={margin !== null && margin < 0 ? "danger-text" : ""}>{formatPercent(margin)}</td> : null}
                {showColumn("compatibility") ? (
                  <td title={compatibility || "Todos"}>
                    <span className="truncated-cell">{compatibility || "Todos"}</span>
                  </td>
                ) : null}
                {showColumn("status") ? (
                  <td>
                    <span className={`stock-pill ${item.is_active && item.is_available ? "ok" : "danger"}`}>
                      {item.is_active ? (item.is_available ? "Activo" : "No disponible") : "Inactivo"}
                    </span>
                  </td>
                ) : null}
                {showColumn("actions") ? (
                  <td className="actions-column compact-actions-column">
                    <span className="row-actions center-actions">
                      <button className="icon-button" onClick={() => onEdit(item)} title={`Editar ${item.name}`} type="button">
                        <Pencil size={16} />
                      </button>
                      <MenuDeleteButton id={item.id} name={item.name} section="pizza_additions" />
                    </span>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
      {additions.length === 0 ? <p className="muted">No hay adiciones con esos filtros.</p> : null}
    </div>
  );
}

function ReorderControls({
  id,
  section,
  items
}: {
  id: string;
  section: "menu_categories" | "pizza_sizes" | "pizza_flavors" | "pizza_additions";
  items: Array<{ id: string }>;
}) {
  const index = items.findIndex((item) => item.id === id);
  const isOnly = items.length <= 1;
  const isFirst = index <= 0;
  const isLast = index === items.length - 1;

  if (isOnly) return null;

  return (
    <span className="row-actions center-actions">
      {!isFirst ? <ReorderButton direction="up" id={id} section={section} /> : null}
      {!isLast ? <ReorderButton direction="down" id={id} section={section} /> : null}
    </span>
  );
}

function ReorderButton({
  id,
  section,
  direction
}: {
  id: string;
  section: "menu_categories" | "pizza_sizes" | "pizza_flavors" | "pizza_additions";
  direction: "up" | "down";
}) {
  const [state, formAction] = useActionState(moveMenuPizzaItem, initialState);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state.status]);

  return (
    <form action={formAction} className="inline-form">
      <input name="section" type="hidden" value={section} />
      <input name="id" type="hidden" value={id} />
      <input name="direction" type="hidden" value={direction} />
      <button className="icon-button" title={direction === "up" ? "Subir" : "Bajar"} type="submit">
        {direction === "up" ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
      </button>
    </form>
  );
}

function MenuDeleteButton({
  id,
  name,
  section
}: {
  id: string;
  name: string;
  section: "menu_categories" | "pizza_sizes" | "pizza_flavors" | "pizza_additions";
}) {
  const [confirming, setConfirming] = useState(false);
  const href = `/api/admin/menu/delete?section=${encodeURIComponent(section)}&id=${encodeURIComponent(id)}`;

  return (
    <span className="product-delete-form">
      {confirming ? (
        <span className="row-actions compact-confirm-actions">
          <a className="ghost-button danger-button compact-confirm-button" href={href} title={`Confirmar eliminacion de ${name}`}>
            <Check size={15} /> Eliminar
          </a>
          <button className="icon-button" onClick={() => setConfirming(false)} title="Cancelar eliminacion" type="button">
            <X size={16} />
          </button>
        </span>
      ) : (
        <button className="icon-button danger-button" onClick={() => setConfirming(true)} title={`Eliminar ${name}`} type="button">
          <Trash2 size={16} />
        </button>
      )}
    </span>
  );
}

function MenuPizzaModal({
  modal,
  categories,
  sizes,
  flavors,
  ingredientSources,
  additionIngredientSources,
  onClose
}: {
  modal: ModalState;
  categories: MenuCategoryRecord[];
  sizes: PizzaSizeRecord[];
  flavors: PizzaFlavorRecord[];
  ingredientSources: FlavorIngredientSource[];
  additionIngredientSources: AdditionIngredientSource[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [categoryState, categoryAction] = useActionState(saveMenuCategory, initialState);
  const [sizeState, sizeAction] = useActionState(savePizzaSize, initialState);
  const [flavorState, flavorAction] = useActionState(savePizzaFlavor, initialState);
  const [additionState, additionAction] = useActionState(savePizzaAddition, initialState);
  const activeState = modal.section === "sabores" ? flavorState : modal.section === "tamanos" ? sizeState : modal.section === "adiciones" ? additionState : categoryState;

  useEffect(() => {
    if (activeState.status !== "success") return;
    const timeout = window.setTimeout(() => {
      onClose();
      router.refresh();
    }, 1000);
    return () => window.clearTimeout(timeout);
  }, [activeState.status, onClose, router]);

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-label={modal.item ? `Editar ${sectionTitle(modal.section)}` : addLabel(modal.section)} aria-modal="true" className="modal-panel purchase-modal" role="dialog">
        <header className="modal-header">
          <div>
            <strong>{modal.item ? `Editar ${sectionTitle(modal.section).slice(0, -1).toLowerCase()}` : addLabel(modal.section)}</strong>
            <span>{modal.section === "adiciones" ? "Menu/Precios" : "Menu/Pizzas"}</span>
          </div>
          <button className="icon-button" onClick={onClose} title="Cerrar" type="button">
            <X size={18} />
          </button>
        </header>
        {modal.section === "sabores" ? (
          <FlavorForm action={flavorAction} categories={categories} ingredientSources={ingredientSources} item={modal.item} state={flavorState} onClose={onClose} />
        ) : null}
        {modal.section === "tamanos" ? <SizeForm action={sizeAction} item={modal.item} state={sizeState} onClose={onClose} /> : null}
        {modal.section === "categorias" ? <CategoryForm action={categoryAction} item={modal.item} state={categoryState} onClose={onClose} /> : null}
        {modal.section === "adiciones" ? (
          <AdditionForm
            action={additionAction}
            categories={categories}
            flavors={flavors}
            ingredientSources={additionIngredientSources}
            item={modal.item}
            sizes={sizes}
            state={additionState}
            onClose={onClose}
          />
        ) : null}
      </section>
    </div>
  );
}

function FlavorForm({
  item,
  categories,
  ingredientSources,
  state,
  action,
  onClose
}: {
  item: PizzaFlavorRecord | null;
  categories: MenuCategoryRecord[];
  ingredientSources: FlavorIngredientSource[];
  state: FormActionState;
  action: (payload: FormData) => void;
  onClose: () => void;
}) {
  const [removeImage, setRemoveImage] = useState(false);
  const [imagePreview, setImagePreview] = useState(item?.image_src ?? "");
  const [imageError, setImageError] = useState("");
  const [fileInputKey, setFileInputKey] = useState(0);
  const [ingredientQuery, setIngredientQuery] = useState("");
  const [selectedIngredients, setSelectedIngredients] = useState<FlavorIngredientSelection[]>(item?.characteristic_ingredients ?? []);
  const selectedKeys = new Set(selectedIngredients.map((ingredient) => `${ingredient.source_kind}:${ingredient.source_id}`));
  const filteredSources = ingredientSources
    .filter((source) => !selectedKeys.has(`${source.source_kind}:${source.id}`))
    .filter((source) => normalizeMasterText(source.name).includes(normalizeMasterText(ingredientQuery)))
    .slice(0, 8);

  function addIngredient(source: FlavorIngredientSource) {
    setSelectedIngredients((current) => [
      ...current,
      {
        source_kind: source.source_kind,
        source_id: source.id,
        source_name: source.name
      }
    ]);
    setIngredientQuery("");
  }

  function removeIngredient(key: string) {
    setSelectedIngredients((current) => current.filter((ingredient) => `${ingredient.source_kind}:${ingredient.source_id}` !== key));
  }

  function revokePreviewIfNeeded() {
    if (imagePreview.startsWith("blob:")) {
      URL.revokeObjectURL(imagePreview);
    }
  }

  useEffect(() => {
    return () => {
      if (imagePreview.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  return (
    <form action={action} className="compact-card">
      {item ? <input name="id" type="hidden" value={item.id} /> : null}
      {item?.image_url ? <input name="existing_image_url" type="hidden" value={item.image_url} /> : null}
      <input name="remove_image" type="hidden" value={removeImage ? "1" : "0"} />
      <input name="characteristic_ingredients" type="hidden" value={JSON.stringify(selectedIngredients.map(({ source_kind, source_id }) => ({ source_kind, source_id })))} />
      <div className="form-grid">
        <div className="field">
          <label>Nombre</label>
          <input defaultValue={item?.name ?? ""} name="name" onInput={(event) => (event.currentTarget.value = uppercaseMasterName(event.currentTarget.value))} required />
        </div>
        <div className="field">
          <label>Categoria</label>
          <select defaultValue={item?.menu_category_id ?? ""} name="menu_category_id">
            <option value="">Sin categoria</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field full">
          <label>Descripcion comercial</label>
          <textarea defaultValue={item?.commercial_description ?? ""} name="commercial_description" placeholder="Descripcion visible en menu mas adelante" />
        </div>
        <div className="field">
          <label>Alergenos</label>
          <input defaultValue={item?.allergens ?? ""} name="allergens" onInput={(event) => (event.currentTarget.value = uppercaseMasterName(event.currentTarget.value))} placeholder="GLUTEN, LACTEOS" />
        </div>
        <label className="check-option menu-check-option">
          <input defaultChecked={item?.allows_half_and_half ?? true} name="allows_half_and_half" type="checkbox" />
          <span>Permite mitad y mitad</span>
        </label>
        <div className="field full autocomplete-field">
          <label>Ingredientes caracteristicos</label>
          <input
            autoComplete="off"
            onChange={(event) => setIngredientQuery(uppercaseMasterName(event.target.value))}
            placeholder="Buscar ingrediente o preparacion"
            value={ingredientQuery}
          />
          {ingredientQuery ? (
            <div className="autocomplete-menu static-autocomplete-menu">
              {filteredSources.map((source) => (
                <button
                  className="autocomplete-option"
                  key={`${source.source_kind}:${source.id}`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    addIngredient(source);
                  }}
                  type="button"
                >
                  <span>{source.name}</span>
                  <span className={`source-type-badge ${source.source_kind === "preparation" ? "preparation" : "product"}`}>
                    {source.source_kind === "preparation" ? "Preparacion" : "Ingrediente"}
                  </span>
                </button>
              ))}
              {filteredSources.length === 0 ? <span className="autocomplete-option muted">Sin resultados</span> : null}
            </div>
          ) : null}
          <div className="selected-ingredient-list">
            {selectedIngredients.length === 0 ? <span className="muted">Sin ingredientes asociados.</span> : null}
            {selectedIngredients.map((ingredient) => {
              const key = `${ingredient.source_kind}:${ingredient.source_id}`;
              return (
                <span className="selected-ingredient-pill" key={key}>
                  {ingredient.source_name}
                  <small>{ingredient.source_kind === "preparation" ? "Preparacion" : "Ingrediente"}</small>
                  <button aria-label={`Quitar ${ingredient.source_name}`} onClick={() => removeIngredient(key)} type="button">
                    <X size={13} />
                  </button>
                </span>
              );
            })}
          </div>
          <p className="field-hint">Solo define ingredientes caracteristicos. Las cantidades se asignaran despues por tamano.</p>
        </div>
        <div className="field full">
          <label>Foto (opcional)</label>
          <div className="menu-image-field">
            {imagePreview && !removeImage ? <Image alt={item?.name ?? "Foto del sabor"} className="menu-image-preview" height={72} src={imagePreview} unoptimized width={72} /> : <span className="inventory-photo-placeholder">Sin foto</span>}
            <label className="ghost-button icon-text-button">
              <ImagePlus size={16} /> {imagePreview && !removeImage ? "Cambiar" : "Subir foto"}
              <input
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="sr-only"
                key={fileInputKey}
                name="flavor_image"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  if (!allowedFlavorImageTypes.has(file.type)) {
                    setImageError("No se puede cargar la imagen. Usa JPG, PNG, WEBP o GIF.");
                    event.currentTarget.value = "";
                    return;
                  }
                  if (file.size > flavorImageMaxSize) {
                    setImageError(`No se puede cargar la imagen. El tamaño máximo permitido es ${flavorImageMaxSizeMb} MB.`);
                    event.currentTarget.value = "";
                    return;
                  }
                  revokePreviewIfNeeded();
                  setImagePreview(URL.createObjectURL(file));
                  setRemoveImage(false);
                  setImageError("");
                }}
                type="file"
              />
            </label>
            {imagePreview && !removeImage ? (
              <button
                className="ghost-button"
                onClick={() => {
                  revokePreviewIfNeeded();
                  setImagePreview("");
                  setRemoveImage(true);
                  setImageError("");
                  setFileInputKey((current) => current + 1);
                }}
                type="button"
              >
                Eliminar imagen
              </button>
            ) : null}
          </div>
          {imageError ? <p className="form-status error">{imageError}</p> : <p className="field-hint">Formatos permitidos: JPG, PNG, WEBP o GIF. Máximo {flavorImageMaxSizeMb} MB.</p>}
        </div>
      </div>
      <label className="check-option">
        <input defaultChecked={item?.is_active ?? true} name="is_active" type="checkbox" />
        <span>Activo</span>
      </label>
      {state.status !== "idle" ? <p className={`form-status ${state.status}`}>{state.message}</p> : null}
      <div className="form-actions modal-form-actions">
        <button className="ghost-button" onClick={onClose} type="button">
          Cancelar
        </button>
        <SubmitButton label={item ? "Actualizar sabor" : "Guardar sabor"} />
      </div>
    </form>
  );
}

function SizeForm({
  item,
  state,
  action,
  onClose
}: {
  item: PizzaSizeRecord | null;
  state: FormActionState;
  action: (payload: FormData) => void;
  onClose: () => void;
}) {
  return (
    <form action={action} className="compact-card">
      {item ? <input name="id" type="hidden" value={item.id} /> : null}
      <div className="form-grid">
        <div className="field">
          <label>Nombre</label>
          <input defaultValue={item?.name ?? ""} name="name" onInput={(event) => (event.currentTarget.value = uppercaseMasterName(event.currentTarget.value))} required />
        </div>
        <div className="field">
          <label>Diametro en cm</label>
          <input defaultValue={item?.diameter_cm ?? ""} min="0.01" name="diameter_cm" placeholder="Ej. 30" step="0.01" type="number" />
        </div>
        <div className="field">
          <label>Numero de porciones</label>
          <input defaultValue={item?.slices_count ?? ""} min="1" name="slices_count" placeholder="Ej. 8" type="number" />
        </div>
      </div>
      <label className="check-option">
        <input defaultChecked={item?.is_active ?? true} name="is_active" type="checkbox" />
        <span>Activo</span>
      </label>
      {state.status !== "idle" ? <p className={`form-status ${state.status}`}>{state.message}</p> : null}
      <div className="form-actions modal-form-actions">
        <button className="ghost-button" onClick={onClose} type="button">
          Cancelar
        </button>
        <SubmitButton label={item ? "Actualizar tamano" : "Guardar tamano"} />
      </div>
    </form>
  );
}

function CategoryForm({
  item,
  state,
  action,
  onClose
}: {
  item: MenuCategoryRecord | null;
  state: FormActionState;
  action: (payload: FormData) => void;
  onClose: () => void;
}) {
  return (
    <form action={action} className="compact-card">
      {item ? <input name="id" type="hidden" value={item.id} /> : null}
      <div className="form-grid">
        <div className="field">
          <label>Nombre</label>
          <input defaultValue={item?.name ?? ""} name="name" onInput={(event) => (event.currentTarget.value = uppercaseMasterName(event.currentTarget.value))} required />
        </div>
        <div className="field full">
          <label>Descripcion</label>
          <textarea defaultValue={item?.description ?? ""} name="description" placeholder="Descripcion interna o comercial opcional" />
        </div>
      </div>
      <label className="check-option">
        <input defaultChecked={item?.is_active ?? true} name="is_active" type="checkbox" />
        <span>Activo</span>
      </label>
      {state.status !== "idle" ? <p className={`form-status ${state.status}`}>{state.message}</p> : null}
      <div className="form-actions modal-form-actions">
        <button className="ghost-button" onClick={onClose} type="button">
          Cancelar
        </button>
        <SubmitButton label={item ? "Actualizar categoria" : "Guardar categoria"} />
      </div>
    </form>
  );
}

function AdditionForm({
  item,
  sizes,
  categories,
  flavors,
  ingredientSources,
  state,
  action,
  onClose
}: {
  item: PizzaAdditionRecord | null;
  sizes: PizzaSizeRecord[];
  categories: MenuCategoryRecord[];
  flavors: PizzaFlavorRecord[];
  ingredientSources: AdditionIngredientSource[];
  state: FormActionState;
  action: (payload: FormData) => void;
  onClose: () => void;
}) {
  const activeCategories = categories.filter((category) => category.is_active);
  const activeFlavors = flavors.filter((flavor) => flavor.is_active);
  const initialComponent = ingredientSources.find((source) => source.id === item?.source_id) ?? null;
  const [selectedIngredientId, setSelectedIngredientId] = useState(initialComponent?.id ?? "");
  const selectedComponent = ingredientSources.find((source) => source.id === selectedIngredientId) ?? null;
  const [ingredientQuery, setIngredientQuery] = useState(initialComponent?.name ?? "");
  const [showIngredientOptions, setShowIngredientOptions] = useState(false);
  const [highlightedIngredient, setHighlightedIngredient] = useState(0);
  const [useAlternateName, setUseAlternateName] = useState(Boolean(item && normalizeMasterText(item.name) !== normalizeMasterText(item.component_name)));
  const [alternateName, setAlternateName] = useState(item && normalizeMasterText(item.name) !== normalizeMasterText(item.component_name) ? item.name : "");
  const initialRows = sizes.map((size) => {
    const existing = item?.sizes.find((row) => row.pizza_size_id === size.id);
    const unit = existing?.display_unit ?? unitOptionsFor(selectedComponent?.unit ?? "unit")[0];
    return {
      pizza_size_id: size.id,
      pizza_size_name: size.name,
      enabled: Boolean(existing),
      quantity: existing?.display_quantity ? String(existing.display_quantity) : "",
      unit,
      price_cop: existing?.price_cop ? String(existing.price_cop) : ""
    };
  });
  const [sizeRows, setSizeRows] = useState(initialRows);
  const [compatibleFlavorIds, setCompatibleFlavorIds] = useState<string[]>(
    item ? (item.compatible_flavors.length > 0 ? item.compatible_flavors.map((flavor) => flavor.id) : activeFlavors.map((flavor) => flavor.id)) : activeFlavors.map((flavor) => flavor.id)
  );
  const [compatibleCategoryIds, setCompatibleCategoryIds] = useState<string[]>(
    item
      ? item.compatible_categories.length > 0
        ? item.compatible_categories.map((category) => category.id)
        : activeCategories.map((category) => category.id)
      : activeCategories.map((category) => category.id)
  );
  const unitOptions = useMemo(() => unitOptionsFor(selectedComponent?.unit ?? "unit"), [selectedComponent?.unit]);
  const filteredIngredientSources = ingredientSources
    .filter((source) => !ingredientQuery || normalizeMasterText(source.name).includes(normalizeMasterText(ingredientQuery)))
    .slice(0, 8);

  const rowsPayload = sizeRows
    .filter((row) => row.enabled)
    .map((row) => ({
      pizza_size_id: row.pizza_size_id,
      quantity: Number(String(row.quantity).replace(",", ".")),
      unit: row.unit,
      price_cop: Number(String(row.price_cop).replace(/\D/g, ""))
    }))
    .filter((row) => row.quantity > 0);

  function updateRow(sizeId: string, patch: Partial<(typeof sizeRows)[number]>) {
    setSizeRows((current) => current.map((row) => (row.pizza_size_id === sizeId ? { ...row, ...patch } : row)));
  }

  function toggleValue(values: string[], value: string) {
    return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
  }

  function selectIngredient(source: AdditionIngredientSource) {
    const nextOptions = unitOptionsFor(source.unit);
    setSelectedIngredientId(source.id);
    setIngredientQuery(source.name);
    setShowIngredientOptions(false);
    setHighlightedIngredient(0);
    setSizeRows((current) =>
      current.map((row) => ({
        ...row,
        unit: nextOptions.includes(row.unit) ? row.unit : nextOptions[0]
      }))
    );
  }

  function clearIngredient() {
    setSelectedIngredientId("");
    setIngredientQuery("");
    setShowIngredientOptions(false);
  }

  function estimatedCost(row: (typeof sizeRows)[number]) {
    if (!selectedComponent?.unit_cost_cop) return null;
    const quantity = Number(String(row.quantity).replace(",", "."));
    if (quantity <= 0) return null;
    return convertQuantity(quantity, row.unit, canonicalUnit(row.unit)) * selectedComponent.unit_cost_cop;
  }

  const displayedName = useAlternateName && alternateName ? alternateName : selectedComponent?.name ?? "";
  const skuValue = item?.sku ?? (displayedName ? additionSkuPreview(displayedName) : "Se generara al guardar");

  return (
    <form action={action} className="compact-card">
      {item ? <input name="id" type="hidden" value={item.id} /> : null}
      <input name="source_kind" type="hidden" value={selectedComponent ? "inventory_item" : ""} />
      <input name="source_id" type="hidden" value={selectedComponent?.id ?? ""} />
      <input name="use_alternate_name" type="hidden" value={useAlternateName ? "on" : ""} />
      <input name="alternate_name" type="hidden" value={useAlternateName ? alternateName : ""} />
      <input name="addition_sizes" type="hidden" value={JSON.stringify(rowsPayload)} />
      <input name="compatible_flavor_ids" type="hidden" value={JSON.stringify(compatibleFlavorIds)} />
      <input name="compatible_category_ids" type="hidden" value={JSON.stringify(compatibleCategoryIds)} />
      <div className="form-grid">
        <div className="field autocomplete-field">
          <label>Ingrediente</label>
          <div className="linked-field">
            <input
              autoComplete="off"
              onBlur={() => window.setTimeout(() => setShowIngredientOptions(false), 120)}
              onChange={(event) => {
                setSelectedIngredientId("");
                setIngredientQuery(uppercaseMasterName(event.target.value));
                setShowIngredientOptions(true);
                setHighlightedIngredient(0);
              }}
              onFocus={() => setShowIngredientOptions(true)}
              onKeyDown={(event) => {
                if (!showIngredientOptions && (event.key === "ArrowDown" || event.key === "ArrowUp")) setShowIngredientOptions(true);
                if (event.key === "Escape") setShowIngredientOptions(false);
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setHighlightedIngredient((current) => Math.min(current + 1, Math.max(0, filteredIngredientSources.length - 1)));
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setHighlightedIngredient((current) => Math.max(0, current - 1));
                }
                if (event.key === "Enter" && showIngredientOptions && filteredIngredientSources[highlightedIngredient]) {
                  event.preventDefault();
                  selectIngredient(filteredIngredientSources[highlightedIngredient]);
                }
              }}
              placeholder="Buscar ingrediente"
              readOnly={Boolean(selectedComponent)}
              required
              value={ingredientQuery}
            />
            {selectedComponent ? (
              <button className="icon-button" onClick={clearIngredient} title="Cambiar ingrediente" type="button">
                <X size={16} />
              </button>
            ) : null}
          </div>
          {showIngredientOptions && !selectedComponent ? (
            <div className="autocomplete-menu static-autocomplete-menu">
              {filteredIngredientSources.map((source, index) => (
                <button
                  className={`autocomplete-option${highlightedIngredient === index ? " active" : ""}`}
                  key={source.id}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    selectIngredient(source);
                  }}
                  type="button"
                >
                  <span>{source.name}</span>
                </button>
              ))}
              {filteredIngredientSources.length === 0 ? <span className="autocomplete-option muted">Sin resultados</span> : null}
            </div>
          ) : null}
          <p className="field-hint">Solo ingredientes activos. No consume preparaciones, productos para venta ni insumos.</p>
        </div>
        <div className="field">
          <label>Foto</label>
          <div className="menu-image-field compact-menu-image-field">
            {selectedComponent?.image_src ? imageCell(selectedComponent.image_src, selectedComponent.name) : <span className="inventory-photo-placeholder">Sin foto</span>}
          </div>
        </div>
        <label className="check-option menu-check-option">
          <input checked={useAlternateName} onChange={(event) => setUseAlternateName(event.target.checked)} type="checkbox" />
          <span>Usar nombre alternativo</span>
        </label>
        {useAlternateName ? (
          <div className="field">
            <label>Nombre alternativo</label>
            <input onChange={(event) => setAlternateName(uppercaseMasterName(event.target.value))} placeholder={selectedComponent?.name ?? "Nombre comercial"} value={alternateName} />
          </div>
        ) : null}
        <div className="field">
          <label>Maximo permitido</label>
          <input defaultValue={item?.max_allowed ?? 1} min="1" name="max_allowed" type="number" />
        </div>
        <div className="field full">
          <label>Cantidad y precio por tamano</label>
          <div className="addition-size-grid">
            {sizeRows.map((row) => (
              <div className="addition-size-row" key={row.pizza_size_id}>
                <label className="check-option addition-enable-option">
                  <input checked={row.enabled} onChange={(event) => updateRow(row.pizza_size_id, { enabled: event.target.checked })} type="checkbox" />
                  <span>Habilitar</span>
                </label>
                <strong>{row.pizza_size_name}</strong>
                <input
                  disabled={!row.enabled}
                  inputMode="decimal"
                  onChange={(event) => updateRow(row.pizza_size_id, { quantity: event.target.value })}
                  placeholder="Cantidad"
                  value={row.quantity}
                />
                <select disabled={!row.enabled} onChange={(event) => updateRow(row.pizza_size_id, { unit: event.target.value as StockUnit })} value={row.unit}>
                  {unitOptions.map((unit) => (
                    <option key={unit} value={unit}>
                      {formatUnit(unit)}
                    </option>
                  ))}
                </select>
                <span className="readonly-chip">Costo {costLabel(estimatedCost(row))}</span>
                <input
                  disabled={!row.enabled}
                  inputMode="numeric"
                  onChange={(event) => updateRow(row.pizza_size_id, { price_cop: event.target.value.replace(/\D/g, "") })}
                  placeholder="Precio adicional"
                  value={row.price_cop}
                />
                {row.enabled ? <AdditionProfit cost={estimatedCost(row)} price={Number(row.price_cop || 0)} /> : null}
              </div>
            ))}
          </div>
          <p className="field-hint">Deja en blanco los tamanos donde esta adicion no aplique.</p>
        </div>
        <div className="field full">
          <label>Compatibilidad por categorias</label>
          <div className="quick-actions-row">
            <button className="ghost-button compact-action-button" onClick={() => setCompatibleCategoryIds(activeCategories.map((category) => category.id))} type="button">
              Seleccionar todas
            </button>
            <button className="ghost-button compact-action-button" onClick={() => setCompatibleCategoryIds([])} type="button">
              Quitar todas
            </button>
          </div>
          <div className="compact-check-grid">
            {activeCategories.map((category) => (
              <label className="check-option compact-check-option" key={category.id}>
                <input checked={compatibleCategoryIds.includes(category.id)} onChange={() => setCompatibleCategoryIds((current) => toggleValue(current, category.id))} type="checkbox" />
                <span>{category.name}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="field full">
          <label>Compatibilidad por sabores</label>
          <div className="quick-actions-row">
            <button className="ghost-button compact-action-button" onClick={() => setCompatibleFlavorIds(activeFlavors.map((flavor) => flavor.id))} type="button">
              Seleccionar todos
            </button>
            <button className="ghost-button compact-action-button" onClick={() => setCompatibleFlavorIds([])} type="button">
              Quitar todos
            </button>
          </div>
          <div className="compact-check-grid">
            {activeFlavors.map((flavor) => (
              <label className="check-option compact-check-option" key={flavor.id}>
                <input checked={compatibleFlavorIds.includes(flavor.id)} onChange={() => setCompatibleFlavorIds((current) => toggleValue(current, flavor.id))} type="checkbox" />
                <span>{flavor.name}</span>
              </label>
            ))}
          </div>
          <p className="field-hint">Si no eliges categorias ni sabores, la adicion queda disponible para todos.</p>
        </div>
      </div>
      <div className="form-grid">
        <label className="check-option">
          <input defaultChecked={item?.is_active ?? true} name="is_active" type="checkbox" />
          <span>Activo</span>
        </label>
        <label className="check-option">
          <input defaultChecked={item?.is_available ?? true} name="is_available" type="checkbox" />
          <span>Disponible</span>
        </label>
        <div className="field">
          <label>SKU</label>
          <input readOnly value={skuValue} />
        </div>
      </div>
      {state.status !== "idle" ? <p className={`form-status ${state.status}`}>{state.message}</p> : null}
      <div className="form-actions modal-form-actions">
        <button className="ghost-button" onClick={onClose} type="button">
          Cancelar
        </button>
        <SubmitButton label={item ? "Actualizar adicion" : "Guardar adicion"} />
      </div>
    </form>
  );
}

function AdditionProfit({ cost, price }: { cost: number | null; price: number }) {
  const profit = cost !== null ? price - cost : null;
  const margin = additionMargin(price, cost);
  if (cost === null) {
    return <span className="addition-warning">Sin costo disponible. Margen no calculable.</span>;
  }
  return (
    <span className={profit !== null && profit < 0 ? "addition-warning" : "readonly-chip"}>
      Utilidad {formatCop(profit ?? 0)} · Margen {formatPercent(margin)}
    </span>
  );
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="primary-button" disabled={pending} type="submit">
      {pending ? "Guardando..." : label}
    </button>
  );
}
