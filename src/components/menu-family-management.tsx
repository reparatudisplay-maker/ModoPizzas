"use client";

import { useActionState, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Box, ChefHat, CircleCheck, CirclePlus, Coins, Copy, FilePenLine, Pencil, Package, Plus, Search, Settings2, Tags, Trash2, UtensilsCrossed, X } from "lucide-react";
import { copyUniversalMenuRecipeBaseComponents, deleteUniversalMenuRecord, reorderUniversalMenuRecipeComponent, saveUniversalMenuRecord, updateMenuFamily, type FormActionState } from "@/app/admin/actions";

type Source = { id: string; name: string; unit: "g" | "ml" | "unit" };
type Presentation = { id: string; name: string; description: string | null };
type Item = { id: string; name: string; sku: string; commercial_description: string | null; image_url: string | null; is_active: boolean };
type Component = { id: string; family_item_id: string; presentation_id: string | null; source_kind: "inventory_item" | "preparation"; inventory_item_id: string | null; source_preparation_id: string | null; quantity_base: number; base_unit: "g" | "ml" | "unit"; option_group: string | null; is_required: boolean; sort_order: number };
type Price = { id: string; family_item_id: string; presentation_id: string | null; sale_price_cop: number; is_active: boolean };
type Addition = { id: string; name: string; sku: string; sale_price_cop: number; quantity_base: number; base_unit: "g" | "ml" | "unit"; max_allowed: number };
type Combo = { id: string; name: string; sku: string; description: string | null };
type Variant = { id: string; combo_id: string; name: string; sale_price_cop: number };
type ComboComponent = { id: string; variant_id: string; name: string; source_kind: "family_item" | "inventory_item"; family_item_id: string | null; inventory_item_id: string | null; presentation_id: string | null; quantity: number; is_required: boolean };
type ComboComponentOption = { id: string; component_id: string; source_kind: "family_item" | "inventory_item"; family_item_id: string | null; inventory_item_id: string | null; presentation_id: string | null; quantity: number };
type PackagingRule = { id: string; family_item_id: string; presentation_id: string | null; packaging_inventory_item_id: string; service_kind: string; quantity_base: number };

export type UniversalMenuFamilyData = {
  family: { id: string; name: string; description: string | null; is_active: boolean };
  presentations: Presentation[];
  items: Item[];
  components: Component[];
  substitutions: Array<{ id: string; component_id: string; source_kind: "inventory_item" | "preparation"; inventory_item_id: string | null; source_preparation_id: string | null; quantity_base: number; base_unit: "g" | "ml" | "unit" }>;
  prices: Price[];
  additions: Addition[];
  combos: Combo[];
  variants: Variant[];
  comboComponents: ComboComponent[];
  comboComponentOptions: ComboComponentOption[];
  packagingRules: PackagingRule[];
  inventorySources: Source[];
  preparationSources: Source[];
  packagingSources: Source[];
};

const initialState: FormActionState = { status: "idle", message: "" };
type Tab = "general" | "recipes" | "presentations" | "prices" | "combos" | "additions" | "packaging";

const tabs: Array<{ id: Tab; label: string; icon: typeof ChefHat }> = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "recipes", label: "Recetas", icon: ChefHat },
  { id: "presentations", label: "Presentaciones", icon: Box },
  { id: "prices", label: "Precios", icon: Coins },
  { id: "combos", label: "Combos", icon: CirclePlus },
  { id: "additions", label: "Adiciones", icon: Tags },
  { id: "packaging", label: "Empaques", icon: Package }
];

function money(value: number) {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(value);
}

function sourceLabel(source: Source | undefined) {
  return source?.name ?? "Fuente eliminada";
}

function SourceSelect({ name = "source_id", sources, label, required = true }: { name?: string; sources: Source[]; label: string; required?: boolean }) {
  return <div className="field"><label>{label}</label><select name={name} defaultValue="" required={required}><option disabled value="">Selecciona</option>{sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</select></div>;
}

function SourceKindSelect({ inventory, preparations, includeFamilyItems, items }: { inventory: Source[]; preparations: Source[]; includeFamilyItems?: boolean; items?: Item[] }) {
  const [kind, setKind] = useState<"inventory_item" | "preparation" | "family_item">("inventory_item");
  const options = kind === "inventory_item" ? inventory : kind === "preparation" ? preparations : (items ?? []).map((item) => ({ id: item.id, name: item.name, unit: "unit" as const }));
  return <div className="field full family-source-row"><label>Fuente</label><select name="source_kind" onChange={(event) => setKind(event.target.value as typeof kind)} value={kind}><option value="inventory_item">Ingrediente / insumo</option><option value="preparation">Preparación</option>{includeFamilyItems ? <option value="family_item">Plato de la familia</option> : null}</select><select key={kind} name="source_id" defaultValue="" required><option disabled value="">Selecciona fuente</option>{options.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</select></div>;
}

function ComboSourceSelect({ inventory, items }: { inventory: Source[]; items: Item[] }) {
  const [kind, setKind] = useState<"family_item" | "inventory_item">("family_item");
  const options = kind === "family_item" ? items.map((item) => ({ id: item.id, name: item.name })) : inventory;
  return <div className="field full family-source-row"><label>Componente</label><select name="source_kind" onChange={(event) => setKind(event.target.value as typeof kind)} value={kind}><option value="family_item">Plato de la familia</option><option value="inventory_item">Producto de inventario</option></select><select key={kind} defaultValue="" name="source_id" required><option disabled value="">Selecciona</option>{options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></div>;
}

function QuantityFields({ price = false }: { price?: boolean }) {
  return <>{price ? <div className="field"><label>Precio de venta</label><input min="0" name="sale_price_cop" required step="1" type="number" /></div> : null}<div className="field"><label>Cantidad</label><input min="0.001" name="quantity_base" required step="0.001" type="number" /></div><div className="field"><label>Unidad base</label><select defaultValue="unit" name="base_unit"><option value="g">G</option><option value="ml">ML</option><option value="unit">UND</option></select></div></>;
}

function UniversalForm({ entity, familyId, children }: { entity: string; familyId: string; children: ReactNode }) {
  const [state, action] = useActionState(saveUniversalMenuRecord, initialState);
  const router = useRouter();
  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.status]);
  return <form action={action} className="compact-card family-config-form"><input name="entity" type="hidden" value={entity} /><input name="family_id" type="hidden" value={familyId} /><div className="form-grid">{children}</div>{state.status !== "idle" ? <p className={`form-status ${state.status}`}>{state.message}</p> : null}<div className="form-actions"><button className="primary-button" type="submit"><Plus size={16} /> Guardar</button></div></form>;
}

function DeleteRecord({ familyId, id, table, confirmMessage }: { familyId: string; id: string; table: string; confirmMessage?: string }) {
  const [state, action] = useActionState(deleteUniversalMenuRecord, initialState);
  return <form action={action} onSubmit={confirmMessage ? (event) => { if (!window.confirm(confirmMessage)) event.preventDefault(); } : undefined}><input name="family_id" type="hidden" value={familyId} /><input name="id" type="hidden" value={id} /><input name="table" type="hidden" value={table} /><button aria-label="Eliminar" className="icon-button danger" title={state.status === "error" ? state.message : "Eliminar"} type="submit"><Trash2 size={15} /></button></form>;
}

function Empty({ children }: { children: ReactNode }) { return <p className="family-config-empty">{children}</p>; }

type RecipeSource = Source & { kind: "inventory_item" | "preparation" };

function RecipeModal({ children, description, onClose, title }: { children: ReactNode; description: string; onClose: () => void; title: string }) {
  return <div className="modal-backdrop" role="presentation"><section aria-label={title} aria-modal="true" className="modal-panel family-modal family-recipe-modal" role="dialog"><header className="modal-header family-recipe-modal-header"><span className="family-recipe-modal-icon"><FilePenLine size={20} /></span><div><h2>{title}</h2><p>{description}</p></div><button aria-label="Cerrar" className="icon-button" onClick={onClose} type="button"><X size={18} /></button></header>{children}</section></div>;
}

function RecipeCreateModal({ data, onClose }: { data: UniversalMenuFamilyData; onClose: () => void }) {
  const [state, action] = useActionState(saveUniversalMenuRecord, initialState);
  const router = useRouter();
  useEffect(() => { if (state.status === "success") { router.refresh(); onClose(); } }, [onClose, router, state.status]);
  return <RecipeModal description="Crea una receta y agrega sus ingredientes luego." onClose={onClose} title="Nueva receta"><form action={action} className="family-recipe-form"><input name="entity" type="hidden" value="item" /><input name="family_id" type="hidden" value={data.family.id} /><input name="is_active" type="hidden" value="off" /><p className="section-subtitle">Se creará como borrador. Puedes completarla cuando tengas los ingredientes definidos.</p><div className="form-grid"><label className="field"><span>Nombre de la receta *</span><input autoFocus name="name" placeholder="Ej. Alitas" required /></label><label className="field"><span>SKU (automático)</span><input disabled value="Se genera al guardar" /></label><label className="field full"><span>Descripción (opcional)</span><input name="description" placeholder="Ej. Alitas de pollo sazonadas" /></label></div>{state.status !== "idle" ? <p className={`form-status ${state.status}`}>{state.message}</p> : null}<footer className="modal-footer"><button className="ghost-button" onClick={onClose} type="button">Cancelar</button><button className="primary-button" type="submit"><Plus size={16} /> Crear receta</button></footer></form></RecipeModal>;
}

function RecipeIngredientPicker({ components, data, item }: { components: Component[]; data: UniversalMenuFamilyData; item: Item }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<RecipeSource | null>(null);
  const [state, action] = useActionState(saveUniversalMenuRecord, initialState);
  const router = useRouter();
  const sources = useMemo<RecipeSource[]>(() => [
    ...data.inventorySources.map((source) => ({ ...source, kind: "inventory_item" as const })),
    ...data.preparationSources.map((source) => ({ ...source, kind: "preparation" as const }))
  ], [data.inventorySources, data.preparationSources]);
  const selectedKeys = new Set(components.map((component) => `${component.source_kind}:${component.source_kind === "inventory_item" ? component.inventory_item_id : component.source_preparation_id}`));
  const candidates = sources.filter((source) => !selectedKeys.has(`${source.kind}:${source.id}`) && source.name.toLocaleLowerCase("es-CO").includes(query.toLocaleLowerCase("es-CO"))).slice(0, 8);
  useEffect(() => { if (state.status === "success") { setQuery(""); setSelected(null); router.refresh(); } }, [router, state.status]);
  return <form action={action} className="family-ingredient-picker"><input name="entity" type="hidden" value="recipe_component" /><input name="family_id" type="hidden" value={data.family.id} /><input name="family_item_id" type="hidden" value={item.id} /><input name="source_kind" type="hidden" value={selected?.kind ?? ""} /><input name="source_id" type="hidden" value={selected?.id ?? ""} /><input name="quantity_base" type="hidden" value="1" /><input name="base_unit" type="hidden" value={selected?.unit ?? "unit"} /><input name="is_required" type="hidden" value="on" /><label className="pos-search"><Search size={16} /><input aria-label="Buscar y agregar ingrediente" onChange={(event) => { setQuery(event.target.value); setSelected(null); }} placeholder="Buscar y agregar ingrediente..." value={selected ? selected.name : query} /></label>{query && !selected ? <div className="family-autocomplete">{candidates.length ? candidates.map((source) => <button key={`${source.kind}:${source.id}`} onClick={() => { setSelected(source); setQuery(""); }} type="button"><span>{source.name}</span><small>{source.kind === "inventory_item" ? "Ingrediente" : "Preparación"}</small></button>) : <span>Sin coincidencias.</span>}</div> : null}<button className="primary-button" disabled={!selected} type="submit"><Plus size={16} /> Agregar</button>{state.status === "error" ? <p className="form-status error">{state.message}</p> : null}</form>;
}

function RecipeIngredientOrder({ componentId, familyId, swapComponentId, direction }: { componentId: string; familyId: string; swapComponentId: string | null; direction: "up" | "down" }) {
  const [state, action] = useActionState(reorderUniversalMenuRecipeComponent, initialState);
  const router = useRouter();
  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.status]);
  return <form action={action}><input name="family_id" type="hidden" value={familyId} /><input name="component_id" type="hidden" value={componentId} /><input name="swap_component_id" type="hidden" value={swapComponentId ?? ""} /><button aria-label={direction === "up" ? "Subir ingrediente" : "Bajar ingrediente"} className="icon-button" disabled={!swapComponentId} title={state.status === "error" ? state.message : direction === "up" ? "Subir" : "Bajar"} type="submit">{direction === "up" ? <ArrowUp size={14} /> : <ArrowDown size={14} />}</button></form>;
}

function RecipeEditModal({ data, item, onClose }: { data: UniversalMenuFamilyData; item: Item; onClose: () => void }) {
  const [state, action] = useActionState(saveUniversalMenuRecord, initialState);
  const router = useRouter();
  const inventoryById = new Map(data.inventorySources.map((source) => [source.id, source.name]));
  const preparationById = new Map(data.preparationSources.map((source) => [source.id, source.name]));
  const components = data.components.filter((component) => component.family_item_id === item.id).sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id));
  const sourceName = (component: Component) => component.source_kind === "inventory_item" ? inventoryById.get(component.inventory_item_id ?? "") : preparationById.get(component.source_preparation_id ?? "");
  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.status]);
  return <RecipeModal description="Modifica el plato y los ingredientes que contiene." onClose={onClose} title="Editar receta"><div className="family-recipe-editor"><form action={action} className="family-recipe-form"><input name="entity" type="hidden" value="item" /><input name="family_id" type="hidden" value={data.family.id} /><input name="record_id" type="hidden" value={item.id} /><div className="family-recipe-edit-heading"><span className="family-recipe-thumb" style={item.image_url ? { backgroundImage: `url(${item.image_url})` } : undefined}>{item.image_url ? null : <ChefHat size={20} />}</span><div><strong>{item.name}</strong><small>SKU: {item.sku}</small></div><label className="checkbox-field"><input defaultChecked={item.is_active} name="is_active" type="checkbox" /> Activa</label></div><div className="form-grid"><label className="field"><span>Nombre *</span><input defaultValue={item.name} name="name" required /></label><label className="field full"><span>Descripción</span><input defaultValue={item.commercial_description ?? ""} name="description" placeholder="Opcional" /></label></div>{state.status !== "idle" ? <p className={`form-status ${state.status}`}>{state.message}</p> : null}<button className="secondary-button" type="submit">Guardar datos</button></form><section className="family-recipe-ingredients"><div className="family-recipe-section-heading"><div><h3>Ingredientes de la receta</h3><p className="section-subtitle">Solo ingredientes y preparaciones activas. Las cantidades se configuran posteriormente.</p></div><span>{components.length} {components.length === 1 ? "ingrediente" : "ingredientes"}</span></div><RecipeIngredientPicker components={components} data={data} item={item} /><div className="family-recipe-ingredient-list">{components.length ? components.map((component, index) => <article key={component.id}><span className="family-ingredient-order"><RecipeIngredientOrder componentId={component.id} direction="up" familyId={data.family.id} swapComponentId={components[index - 1]?.id ?? null} /><RecipeIngredientOrder componentId={component.id} direction="down" familyId={data.family.id} swapComponentId={components[index + 1]?.id ?? null} /></span><span>{sourceName(component) ?? "Ingrediente eliminado"}</span><DeleteRecord familyId={data.family.id} id={component.id} table="menu_family_recipe_components" /></article>) : <Empty>Aún no hay ingredientes.</Empty>}</div></section><footer className="modal-footer"><button className="ghost-button" onClick={onClose} type="button">Cerrar</button></footer></div></RecipeModal>;
}

function RecipesTab({ data }: { data: UniversalMenuFamilyData }) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase("es-CO");
  const recipes = data.items.filter((item) => !normalizedQuery || `${item.name} ${item.sku} ${item.commercial_description ?? ""}`.toLocaleLowerCase("es-CO").includes(normalizedQuery));
  return <section className="family-config-section family-recipes-section"><div className="family-recipes-heading"><div className="family-recipes-title"><span><ChefHat size={24} /></span><div><h2>Recetas</h2><p className="section-subtitle">Define los platos y sus ingredientes.</p></div></div><button className="primary-button" onClick={() => setCreating(true)} type="button"><Plus size={17} /> Nueva receta</button></div><div className="family-recipes-toolbar"><label className="pos-search family-recipe-search"><Search size={18} /><input onChange={(event) => setQuery(event.target.value)} placeholder="Buscar receta por nombre" value={query} /></label><span className="family-recipe-total"><CircleCheck size={15} /> {data.items.length} recetas</span></div><div className="family-recipe-table-wrap"><table className="family-recipe-table"><thead><tr><th>Receta</th><th>SKU</th><th>Ingredientes</th><th>Estado</th><th aria-label="Acciones" /></tr></thead><tbody>{recipes.map((item) => { const ingredientCount = data.components.filter((component) => component.family_item_id === item.id).length; return <tr key={item.id}><td><div className="family-recipe-name"><span className="family-recipe-thumb" style={item.image_url ? { backgroundImage: `url(${item.image_url})` } : undefined}>{item.image_url ? null : <ChefHat size={18} />}</span><span><strong>{item.name}</strong><small>{item.commercial_description || "Sin descripción"}</small></span></div></td><td><code>{item.sku}</code></td><td><span className="family-ingredient-count"><ChefHat size={14} /> {ingredientCount} {ingredientCount === 1 ? "ingrediente" : "ingredientes"}</span></td><td><span className={item.is_active ? "status-pill success" : "status-pill"}>{item.is_active ? "Activa" : "Borrador"}</span></td><td><div className="family-recipe-actions"><button aria-label={`Editar ${item.name}`} className="icon-button" onClick={() => setEditing(item)} title="Editar receta" type="button"><Pencil size={16} /></button><DeleteRecord confirmMessage={`¿Eliminar la receta ${item.name}? Esta acción no se puede deshacer.`} familyId={data.family.id} id={item.id} table="menu_family_items" /></div></td></tr>; })}{recipes.length === 0 ? <tr><td colSpan={5}><Empty>{data.items.length ? "Sin recetas para esta búsqueda." : "Crea una receta para esta familia."}</Empty></td></tr> : null}</tbody></table></div><p className="family-recipe-count">Mostrando {recipes.length} receta{recipes.length === 1 ? "" : "s"}</p>{creating ? <RecipeCreateModal data={data} onClose={() => setCreating(false)} /> : null}{editing ? <RecipeEditModal data={data} item={editing} onClose={() => setEditing(null)} /> : null}</section>;
}

function PresentationCreateForm({ data }: { data: UniversalMenuFamilyData }) {
  const [state, action] = useActionState(saveUniversalMenuRecord, initialState);
  const router = useRouter();
  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.status]);
  return <form action={action} className="family-presentation-create"><input name="entity" type="hidden" value="presentation" /><input name="family_id" type="hidden" value={data.family.id} /><label className="field"><span>Nueva presentación</span><input name="name" placeholder="Ej. PERSONAL" required /></label><label className="field"><span>Descripción</span><input name="description" placeholder="Ej. 4 alitas + 150 G de papas" /></label><button className="primary-button" type="submit"><Plus size={16} /> Agregar</button>{state.status !== "idle" ? <p className={`form-status ${state.status}`}>{state.message}</p> : null}</form>;
}

function PresentationIngredientQuantity({ component, data, item, presentationId }: { component: Component; data: UniversalMenuFamilyData; item: Item; presentationId: string }) {
  const [state, action] = useActionState(saveUniversalMenuRecord, initialState);
  const router = useRouter();
  const source = component.source_kind === "inventory_item"
    ? data.inventorySources.find((entry) => entry.id === component.inventory_item_id)
    : data.preparationSources.find((entry) => entry.id === component.source_preparation_id);
  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.status]);
  return <form action={action} className="family-presentation-ingredient"><input name="entity" type="hidden" value="recipe_component" /><input name="family_id" type="hidden" value={data.family.id} /><input name="record_id" type="hidden" value={component.id} /><input name="family_item_id" type="hidden" value={item.id} /><input name="presentation_id" type="hidden" value={presentationId} /><input name="source_kind" type="hidden" value={component.source_kind} /><input name="source_id" type="hidden" value={component.source_kind === "inventory_item" ? component.inventory_item_id ?? "" : component.source_preparation_id ?? ""} /><input name="option_group" type="hidden" value={component.option_group ?? ""} /><input name="is_required" type="hidden" value={component.is_required ? "on" : "off"} /><span className="family-presentation-ingredient-name"><strong>{source?.name ?? "Ingrediente eliminado"}</strong><small>{component.source_kind === "inventory_item" ? "Ingrediente" : "Preparación"}</small></span><label><span className="sr-only">Cantidad de {source?.name ?? "ingrediente"}</span><input defaultValue={component.quantity_base} min="0.001" name="quantity_base" step="0.001" type="number" /></label><select aria-label={`Unidad de ${source?.name ?? "ingrediente"}`} defaultValue={component.base_unit} name="base_unit"><option value="g">G</option><option value="ml">ML</option><option value="unit">UND</option></select><button className="icon-button" title="Guardar cantidad" type="submit"><CircleCheck size={16} /></button><DeleteRecord confirmMessage={`¿Quitar ${source?.name ?? "este ingrediente"} de esta presentación?`} familyId={data.family.id} id={component.id} table="menu_family_recipe_components" />{state.status === "error" ? <small className="form-status error">{state.message}</small> : null}</form>;
}

function PresentationIngredientPicker({ components, data, item, presentationId }: { components: Component[]; data: UniversalMenuFamilyData; item: Item; presentationId: string }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<RecipeSource | null>(null);
  const [state, action] = useActionState(saveUniversalMenuRecord, initialState);
  const router = useRouter();
  const sources = useMemo<RecipeSource[]>(() => [...data.inventorySources.map((source) => ({ ...source, kind: "inventory_item" as const })), ...data.preparationSources.map((source) => ({ ...source, kind: "preparation" as const }))], [data.inventorySources, data.preparationSources]);
  const selectedKeys = new Set(components.map((component) => `${component.source_kind}:${component.source_kind === "inventory_item" ? component.inventory_item_id : component.source_preparation_id}`));
  const candidates = sources.filter((source) => !selectedKeys.has(`${source.kind}:${source.id}`) && source.name.toLocaleLowerCase("es-CO").includes(query.toLocaleLowerCase("es-CO"))).slice(0, 8);
  useEffect(() => { if (state.status === "success") { setQuery(""); setSelected(null); router.refresh(); } }, [router, state.status]);
  return <form action={action} className="family-presentation-ingredient-picker"><input name="entity" type="hidden" value="recipe_component" /><input name="family_id" type="hidden" value={data.family.id} /><input name="family_item_id" type="hidden" value={item.id} /><input name="presentation_id" type="hidden" value={presentationId} /><input name="source_kind" type="hidden" value={selected?.kind ?? ""} /><input name="source_id" type="hidden" value={selected?.id ?? ""} /><input name="quantity_base" type="hidden" value="1" /><input name="base_unit" type="hidden" value={selected?.unit ?? "unit"} /><input name="is_required" type="hidden" value="on" /><label className="pos-search"><Search size={16} /><input aria-label="Agregar ingrediente a la presentación" onChange={(event) => { setQuery(event.target.value); setSelected(null); }} placeholder="Agregar ingrediente o preparación" value={selected ? selected.name : query} /></label>{query && !selected ? <div className="family-autocomplete">{candidates.length ? candidates.map((source) => <button key={`${source.kind}:${source.id}`} onClick={() => { setSelected(source); setQuery(""); }} type="button"><span>{source.name}</span><small>{source.kind === "inventory_item" ? "Ingrediente" : "Preparación"}</small></button>) : <span>Sin coincidencias.</span>}</div> : null}<button className="secondary-button" disabled={!selected} type="submit"><Plus size={16} /> Agregar ingrediente</button>{state.status === "error" ? <p className="form-status error">{state.message}</p> : null}</form>;
}

function PresentationBaseCopy({ data, item, presentationId, disabled }: { data: UniversalMenuFamilyData; item: Item; presentationId: string; disabled: boolean }) {
  const [state, action] = useActionState(copyUniversalMenuRecipeBaseComponents, initialState);
  const router = useRouter();
  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.status]);
  return <form action={action}><input name="family_id" type="hidden" value={data.family.id} /><input name="family_item_id" type="hidden" value={item.id} /><input name="presentation_id" type="hidden" value={presentationId} /><button className="secondary-button" disabled={disabled} title="Copia los ingredientes sin presentación para ajustar esta presentación" type="submit"><Copy size={15} /> Copiar ingredientes base</button>{state.status !== "idle" ? <p className={`form-status ${state.status}`}>{state.message}</p> : null}</form>;
}

function PresentationsTab({ data }: { data: UniversalMenuFamilyData }) {
  const [itemId, setItemId] = useState(data.items[0]?.id ?? "");
  const selectedItem = data.items.find((item) => item.id === itemId) ?? data.items[0];
  const presentationIds = new Set(data.components.filter((component) => component.family_item_id === selectedItem?.id && component.presentation_id).map((component) => component.presentation_id as string));
  const [presentationId, setPresentationId] = useState("");
  const activePresentationId = data.presentations.some((presentation) => presentation.id === presentationId) ? presentationId : data.presentations.find((presentation) => presentationIds.has(presentation.id))?.id ?? data.presentations[0]?.id ?? "";
  const selectedPresentation = data.presentations.find((presentation) => presentation.id === activePresentationId);
  const baseComponents = data.components.filter((component) => component.family_item_id === selectedItem?.id && component.presentation_id === null);
  const presentationComponents = data.components.filter((component) => component.family_item_id === selectedItem?.id && component.presentation_id === activePresentationId).sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id));
  if (!selectedItem) return <section className="family-config-section"><h2>Presentaciones</h2><Empty>Crea una receta antes de configurar presentaciones.</Empty></section>;
  return <section className="family-config-section family-presentations-workspace"><header className="family-presentations-heading"><div><h2>Presentaciones por receta</h2><p className="section-subtitle">Elige una receta y define sus tamaños, unidades y cantidades de ingredientes.</p></div><span className="family-recipe-total">{data.items.length} recetas</span></header><div className="family-presentations-layout"><aside className="family-presentation-recipes" aria-label="Recetas"><strong>Recetas</strong>{data.items.map((item) => { const count = new Set(data.components.filter((component) => component.family_item_id === item.id && component.presentation_id).map((component) => component.presentation_id)).size; return <button className={item.id === selectedItem.id ? "active" : ""} key={item.id} onClick={() => { setItemId(item.id); setPresentationId(""); }} type="button"><ChefHat size={16} /><span><b>{item.name}</b><small>{count} {count === 1 ? "presentación" : "presentaciones"}</small></span></button>; })}</aside><div className="family-presentation-editor"><header><div><span>RECETA SELECCIONADA</span><h3>{selectedItem.name}</h3><p>{selectedItem.commercial_description || "Define presentaciones y cantidades para esta receta."}</p></div></header><PresentationCreateForm data={data} /><section className="family-presentation-selector"><div><strong>Presentaciones</strong><small>Una presentación puede reutilizarse en la familia, con cantidades propias para esta receta.</small></div><div className="family-presentation-chips">{data.presentations.map((presentation) => <button className={presentation.id === activePresentationId ? "active" : ""} key={presentation.id} onClick={() => setPresentationId(presentation.id)} type="button"><Box size={14} />{presentation.name}<small>{presentationIds.has(presentation.id) ? "Configurada" : "Sin configurar"}</small></button>)}</div></section>{selectedPresentation ? <section className="family-presentation-detail"><header><div><h3>{selectedPresentation.name}</h3><p>{selectedPresentation.description || "Configura los ingredientes de esta presentación."}</p></div><PresentationBaseCopy data={data} disabled={!baseComponents.length} item={selectedItem} presentationId={selectedPresentation.id} /></header><div className="family-presentation-ingredients-head"><span>Ingrediente</span><span>Cantidad</span><span>Unidad</span><span aria-label="Acciones" /></div>{presentationComponents.length ? presentationComponents.map((component) => <PresentationIngredientQuantity component={component} data={data} item={selectedItem} key={component.id} presentationId={selectedPresentation.id} />) : <Empty>{baseComponents.length ? "Aún no hay ingredientes para esta presentación. Copia la receta base o agrega los necesarios." : "Agrega los ingredientes que aplican a esta presentación."}</Empty>}<PresentationIngredientPicker components={presentationComponents} data={data} item={selectedItem} presentationId={selectedPresentation.id} /></section> : <Empty>Agrega una presentación para comenzar.</Empty>}</div></div></section>;
}

function FamilySettingsForm({ data, readyItems, incompleteItems, incompleteCombos }: { data: UniversalMenuFamilyData; readyItems: number; incompleteItems: string[]; incompleteCombos: string[] }) {
  const [state, action] = useActionState(updateMenuFamily, initialState);
  const router = useRouter();
  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.status]);
  const isReady = incompleteItems.length === 0 && incompleteCombos.length === 0 && readyItems > 0;
  return <section className="family-config-section family-general-section">
    <div className="family-general-heading"><div><h2>Estado de la familia</h2><p>La publicación operativa requiere precios y receta para cada plato activo.</p></div><span className={isReady ? "status-pill success" : "status-pill"}>{isReady ? "Lista para integrar" : "Configuración pendiente"}</span></div>
    <div className="family-readiness-grid">
      <article><strong>{data.items.length}</strong><span>Platos configurados</span></article>
      <article><strong>{readyItems}</strong><span>Platos completos</span></article>
      <article><strong>{data.combos.length}</strong><span>Combos configurados</span></article>
    </div>
    {!isReady ? <div className="family-readiness-notes">
      {readyItems === 0 ? <p>Agrega al menos un plato con precio vigente y receta.</p> : null}
      {incompleteItems.length ? <p>Platos pendientes: {incompleteItems.join(", ")}.</p> : null}
      {incompleteCombos.length ? <p>Combos pendientes de variante o componentes: {incompleteCombos.join(", ")}.</p> : null}
    </div> : <p className="family-readiness-ok">La configuración tiene el mínimo necesario para preparar su integración con POS, cocina, inventario y catálogo público.</p>}
    <form action={action} className="compact-card family-config-form family-settings-form"><input name="family_id" type="hidden" value={data.family.id} /><div className="form-grid"><div className="field full"><label>Descripción</label><input defaultValue={data.family.description ?? ""} name="description" placeholder="Describe esta familia de platos" /></div><label className="checkbox-field"><input defaultChecked={data.family.is_active} name="is_active" type="checkbox" /> Familia activa</label></div>{state.status !== "idle" ? <p className={`form-status ${state.status}`}>{state.message}</p> : null}<div className="form-actions"><button className="primary-button" type="submit">Guardar estado</button></div></form>
  </section>;
}

export function MenuFamilyManagement({ data }: { data: UniversalMenuFamilyData }) {
  const [tab, setTab] = useState<Tab>("recipes");
  const inventoryById = new Map(data.inventorySources.map((source) => [source.id, source]));
  const preparationById = new Map(data.preparationSources.map((source) => [source.id, source]));
  const itemById = new Map(data.items.map((item) => [item.id, item]));
  const presentationById = new Map(data.presentations.map((presentation) => [presentation.id, presentation]));
  const sourceName = (kind: string, inventoryId: string | null, preparationId: string | null) => kind === "inventory_item" ? sourceLabel(inventoryById.get(inventoryId ?? "")) : sourceLabel(preparationById.get(preparationId ?? ""));
  const activePriceItemIds = new Set(data.prices.filter((price) => price.is_active).map((price) => price.family_item_id));
  const componentItemIds = new Set(data.components.map((component) => component.family_item_id));
  const completeItems = data.items.filter((item) => activePriceItemIds.has(item.id) && componentItemIds.has(item.id));
  const incompleteItems = data.items.filter((item) => !activePriceItemIds.has(item.id) || !componentItemIds.has(item.id)).map((item) => item.name);
  const incompleteCombos = data.combos.filter((combo) => {
    const variants = data.variants.filter((variant) => variant.combo_id === combo.id);
    return variants.length === 0 || variants.some((variant) => !data.comboComponents.some((component) => component.variant_id === variant.id));
  }).map((combo) => combo.name);

  return <section className="family-workspace family-management">
    <header className="family-workspace-header"><div className="family-workspace-title"><span><UtensilsCrossed size={24} /></span><div><p>MENÚ / FAMILIA</p><h1>{data.family.name}</h1><small>{data.family.description || "Configuración reutilizable para venta, cocina e inventario."}</small></div></div><span className={data.family.is_active ? "status-pill success" : "status-pill"}>{data.family.is_active ? "Activa" : "Inactiva"}</span></header>
    <nav aria-label="Configuración de familia" className="family-tabs">{tabs.map(({ id, label, icon: Icon }) => <button className={tab === id ? "active" : ""} key={id} onClick={() => setTab(id)} type="button"><Icon size={16} />{label}</button>)}</nav>

    {tab === "general" ? <FamilySettingsForm data={data} incompleteCombos={incompleteCombos} incompleteItems={incompleteItems} readyItems={completeItems.length} /> : null}

    {tab === "presentations" ? <PresentationsTab data={data} /> : null}

    {tab === "recipes" ? <RecipesTab data={data} /> : null}

    {tab === "prices" ? <section className="family-config-section"><h2>Precios</h2><UniversalForm entity="price" familyId={data.family.id}><SourceSelect label="Plato" name="family_item_id" sources={data.items.map((item) => ({ id: item.id, name: item.name, unit: "unit" }))} /><div className="field"><label>Presentación</label><select defaultValue="" name="presentation_id"><option value="">Precio general</option>{data.presentations.map((record) => <option key={record.id} value={record.id}>{record.name}</option>)}</select></div><QuantityFields price /></UniversalForm>{data.prices.length ? <div className="family-config-list">{data.prices.map((price) => <article key={price.id}><div><strong>{itemById.get(price.family_item_id)?.name ?? "Plato"}</strong><small>{presentationById.get(price.presentation_id ?? "")?.name ?? "General"}</small></div><b>{money(price.sale_price_cop)}</b><DeleteRecord familyId={data.family.id} id={price.id} table="menu_family_prices" /></article>)}</div> : <Empty>No hay precios vigentes.</Empty>}</section> : null}

    {tab === "additions" ? <section className="family-config-section"><h2>Adiciones</h2><div className="family-config-grid"><div><h3>Nueva adición</h3><UniversalForm entity="addition" familyId={data.family.id}><div className="field"><label>Nombre</label><input name="name" required /></div><div className="field"><label>Código</label><input name="sku" required /></div><SourceKindSelect inventory={data.inventorySources} preparations={data.preparationSources} /><QuantityFields price /><div className="field"><label>Máximo por pedido</label><input defaultValue="1" min="1" name="max_allowed" type="number" /></div></UniversalForm></div><div><h3>Disponibilidad por plato</h3><UniversalForm entity="addition_item" familyId={data.family.id}><SourceSelect label="Adición" name="addition_id" sources={data.additions.map((addition) => ({ id: addition.id, name: addition.name, unit: "unit" }))} /><SourceSelect label="Plato" name="family_item_id" sources={data.items.map((item) => ({ id: item.id, name: item.name, unit: "unit" }))} /><div className="field"><label>Presentación</label><select defaultValue="" name="presentation_id"><option value="">Todas</option>{data.presentations.map((record) => <option key={record.id} value={record.id}>{record.name}</option>)}</select></div></UniversalForm></div></div>{data.additions.length ? <div className="family-config-list">{data.additions.map((addition) => <article key={addition.id}><div><strong>{addition.name}</strong><small>{addition.sku} · {addition.quantity_base} {addition.base_unit.toUpperCase()} · máximo {addition.max_allowed}</small></div><b>{money(addition.sale_price_cop)}</b><DeleteRecord familyId={data.family.id} id={addition.id} table="menu_family_additions" /></article>)}</div> : <Empty>No hay adiciones configuradas.</Empty>}</section> : null}

    {tab === "combos" ? <section className="family-config-section"><h2>Combos y variantes</h2><div className="family-config-grid"><div><h3>Combo</h3><UniversalForm entity="combo" familyId={data.family.id}><div className="field"><label>Nombre</label><input name="name" required /></div><div className="field"><label>Código</label><input name="sku" required /></div><div className="field full"><label>Descripción</label><input name="description" /></div></UniversalForm></div><div><h3>Variante</h3><UniversalForm entity="combo_variant" familyId={data.family.id}><SourceSelect label="Combo" name="combo_id" sources={data.combos.map((combo) => ({ id: combo.id, name: combo.name, unit: "unit" }))} /><div className="field"><label>Nombre</label><input name="name" placeholder="Precio general" required /></div><div className="field"><label>Precio</label><input min="0" name="sale_price_cop" required step="1" type="number" /></div></UniversalForm></div><div><h3>Componente</h3><UniversalForm entity="combo_component" familyId={data.family.id}><SourceSelect label="Variante" name="variant_id" sources={data.variants.map((variant) => ({ id: variant.id, name: variant.name, unit: "unit" }))} /><div className="field"><label>Nombre visible</label><input name="name" placeholder="Ej. Bebida" required /></div><ComboSourceSelect inventory={data.inventorySources} items={data.items} /><div className="field"><label>Presentación</label><select defaultValue="" name="presentation_id"><option value="">Cualquiera</option>{data.presentations.map((record) => <option key={record.id} value={record.id}>{record.name}</option>)}</select></div><div className="field"><label>Cantidad</label><input defaultValue="1" min="1" name="quantity" type="number" /></div><label className="checkbox-field"><input defaultChecked name="is_required" type="checkbox" /> Obligatorio</label></UniversalForm></div><div><h3>Alternativa</h3><UniversalForm entity="combo_component_option" familyId={data.family.id}><SourceSelect label="Componente" name="component_id" sources={data.comboComponents.map((component) => ({ id: component.id, name: component.name, unit: "unit" }))} /><ComboSourceSelect inventory={data.inventorySources} items={data.items} /><div className="field"><label>Presentación</label><select defaultValue="" name="presentation_id"><option value="">Cualquiera</option>{data.presentations.map((record) => <option key={record.id} value={record.id}>{record.name}</option>)}</select></div><div className="field"><label>Cantidad</label><input defaultValue="1" min="1" name="quantity" type="number" /></div></UniversalForm></div></div>{data.combos.length ? <div className="family-config-list">{data.combos.map((combo) => <article key={combo.id}><div><strong>{combo.name}</strong><small>{combo.sku}{combo.description ? ` · ${combo.description}` : ""}</small><span>{data.variants.filter((variant) => variant.combo_id === combo.id).map((variant) => { const components = data.comboComponents.filter((component) => component.variant_id === variant.id); return `${variant.name}: ${money(variant.sale_price_cop)}${components.length ? ` · ${components.map((component) => component.name).join(", ")}` : ""}`; }).join(" · ") || "Sin variantes"}</span></div><DeleteRecord familyId={data.family.id} id={combo.id} table="menu_family_combos" /></article>)}</div> : <Empty>No hay combos configurados.</Empty>}</section> : null}

    {tab === "packaging" ? <section className="family-config-section"><h2>Empaques por modalidad</h2><UniversalForm entity="packaging_rule" familyId={data.family.id}><SourceSelect label="Plato" name="family_item_id" sources={data.items.map((item) => ({ id: item.id, name: item.name, unit: "unit" }))} /><div className="field"><label>Presentación</label><select defaultValue="" name="presentation_id"><option value="">Todas</option>{data.presentations.map((record) => <option key={record.id} value={record.id}>{record.name}</option>)}</select></div><SourceSelect label="Empaque" name="packaging_inventory_item_id" sources={data.packagingSources} /><div className="field"><label>Modalidad</label><select defaultValue="delivery" name="service_kind"><option value="local">Local</option><option value="pickup">Recoger</option><option value="takeaway">Llevar</option><option value="delivery">Domicilio</option></select></div><QuantityFields /></UniversalForm>{data.packagingRules.length ? <div className="family-config-list">{data.packagingRules.map((rule) => <article key={rule.id}><div><strong>{itemById.get(rule.family_item_id)?.name ?? "Plato"}</strong><small>{presentationById.get(rule.presentation_id ?? "")?.name ?? "Todas"} · {rule.service_kind}</small></div><span>{sourceLabel(data.packagingSources.find((source) => source.id === rule.packaging_inventory_item_id))} × {rule.quantity_base}</span><DeleteRecord familyId={data.family.id} id={rule.id} table="menu_family_packaging_rules" /></article>)}</div> : <Empty>No hay reglas de empaque configuradas.</Empty>}</section> : null}
  </section>;
}
