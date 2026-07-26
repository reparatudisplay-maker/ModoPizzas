"use client";

import Image from "next/image";
import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ImagePlus, Pencil, Plus, Settings, Trash2, X } from "lucide-react";
import {
  deleteMenuCategory,
  deletePizzaFlavor,
  deletePizzaSize,
  moveMenuPizzaItem,
  saveMenuCategory,
  savePizzaFlavor,
  savePizzaSize,
  type FormActionState
} from "@/app/admin/actions";
import { normalizeMasterText, uppercaseMasterName } from "@/lib/master-normalization";

type SectionKey = "sabores" | "tamanos" | "categorias";
type StatusFilter = "" | "active" | "inactive";
type LimitFilter = "15" | "30" | "all";
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

type FlavorColumn = "sku" | "photo" | "description" | "category" | "half" | "allergens" | "status" | "actions";
type SizeColumn = "sku" | "diameter" | "slices" | "status" | "actions";
type CategoryColumn = "sku" | "description" | "status" | "actions";
type ModalState =
  | { section: "sabores"; item: PizzaFlavorRecord | null }
  | { section: "tamanos"; item: PizzaSizeRecord | null }
  | { section: "categorias"; item: MenuCategoryRecord | null };

const initialState: FormActionState = { status: "idle", message: "" };
const storageKey = "modopizzas.menu-pizzas.columns";
const defaultColumns = {
  sabores: ["sku", "photo", "description", "category", "half", "allergens", "status", "actions"] as FlavorColumn[],
  tamanos: ["sku", "diameter", "slices", "status", "actions"] as SizeColumn[],
  categorias: ["sku", "description", "status", "actions"] as CategoryColumn[]
};
const allColumns = {
  sabores: ["sku", "photo", "description", "category", "half", "allergens", "status", "actions"] as FlavorColumn[],
  tamanos: ["sku", "diameter", "slices", "status", "actions"] as SizeColumn[],
  categorias: ["sku", "description", "status", "actions"] as CategoryColumn[]
};

function readColumns() {
  if (typeof window === "undefined") return defaultColumns;
  const saved = window.localStorage.getItem(storageKey);
  if (!saved) return defaultColumns;
  try {
    const parsed = JSON.parse(saved) as Partial<typeof defaultColumns>;
    return {
      sabores: sanitizeColumns(parsed.sabores, "sabores"),
      tamanos: sanitizeColumns(parsed.tamanos, "tamanos"),
      categorias: sanitizeColumns(parsed.categorias, "categorias")
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
  return "Categorias";
}

function addLabel(section: SectionKey) {
  if (section === "sabores") return "Agregar sabor";
  if (section === "tamanos") return "Agregar tamano";
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
  ingredientSources
}: {
  flavors: PizzaFlavorRecord[];
  sizes: PizzaSizeRecord[];
  categories: MenuCategoryRecord[];
  ingredientSources: FlavorIngredientSource[];
}) {
  const [section, setSection] = useState<SectionKey>("sabores");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [limit, setLimit] = useState<LimitFilter>("15");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [columnsBySection, setColumnsBySection] = useState(readColumns);
  const [showSettings, setShowSettings] = useState(false);
  const [modal, setModal] = useState<ModalState | null>(null);
  const visibleColumns = columnsBySection[section] as string[];
  const normalizedQuery = normalizeMasterText(query);

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(columnsBySection));
  }, [columnsBySection]);

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
        {(["sabores", "tamanos", "categorias"] as SectionKey[]).map((item) => (
          <button className={`ghost-button${section === item ? " active-tab" : ""}`} key={item} onClick={() => changeSection(item)} type="button">
            {sectionTitle(item)}
          </button>
        ))}
      </nav>

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
      </section>

      {modal ? <MenuPizzaModal categories={categories} ingredientSources={ingredientSources} modal={modal} onClose={() => setModal(null)} /> : null}

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
                    <MenuDeleteButton action={deletePizzaFlavor} id={item.id} name={item.name} />
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
                    <MenuDeleteButton action={deletePizzaSize} id={item.id} name={item.name} />
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
                    <MenuDeleteButton action={deleteMenuCategory} id={item.id} name={item.name} />
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

function ReorderControls({
  id,
  section,
  items
}: {
  id: string;
  section: "menu_categories" | "pizza_sizes" | "pizza_flavors";
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
  section: "menu_categories" | "pizza_sizes" | "pizza_flavors";
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
  action
}: {
  id: string;
  name: string;
  action: (previousState: FormActionState, formData: FormData) => Promise<FormActionState>;
}) {
  const [state, formAction] = useActionState(action, initialState);
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

function MenuPizzaModal({
  modal,
  categories,
  ingredientSources,
  onClose
}: {
  modal: ModalState;
  categories: MenuCategoryRecord[];
  ingredientSources: FlavorIngredientSource[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [categoryState, categoryAction] = useActionState(saveMenuCategory, initialState);
  const [sizeState, sizeAction] = useActionState(savePizzaSize, initialState);
  const [flavorState, flavorAction] = useActionState(savePizzaFlavor, initialState);
  const activeState = modal.section === "sabores" ? flavorState : modal.section === "tamanos" ? sizeState : categoryState;

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
            <span>Dato maestro de Menu/Pizzas</span>
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

  return (
    <form action={action} className="compact-card" encType="multipart/form-data">
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
            {item?.image_src && !removeImage ? imageCell(item.image_src, item.name) : <span className="inventory-photo-placeholder">Sin foto</span>}
            <label className="ghost-button icon-text-button">
              <ImagePlus size={16} /> Subir foto
              <input accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" name="flavor_image" type="file" />
            </label>
            {item?.image_url && !removeImage ? (
              <button className="ghost-button" onClick={() => setRemoveImage(true)} type="button">
                Eliminar imagen
              </button>
            ) : null}
          </div>
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

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="primary-button" disabled={pending} type="submit">
      {pending ? "Guardando..." : label}
    </button>
  );
}
