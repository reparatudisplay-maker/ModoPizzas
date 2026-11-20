"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Box, ChefHat, CirclePlus, Coins, Package, Plus, Tags, Trash2, UtensilsCrossed } from "lucide-react";
import { deleteUniversalMenuRecord, saveUniversalMenuRecord, type FormActionState } from "@/app/admin/actions";

type Source = { id: string; name: string; unit: "g" | "ml" | "unit" };
type Presentation = { id: string; name: string; description: string | null };
type Item = { id: string; name: string; sku: string; commercial_description: string | null };
type Component = { id: string; family_item_id: string; presentation_id: string | null; source_kind: "inventory_item" | "preparation"; inventory_item_id: string | null; source_preparation_id: string | null; quantity_base: number; base_unit: "g" | "ml" | "unit"; option_group: string | null; is_required: boolean };
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
type Tab = "recipes" | "presentations" | "prices" | "combos" | "additions" | "packaging";

const tabs: Array<{ id: Tab; label: string; icon: typeof ChefHat }> = [
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

function DeleteRecord({ familyId, id, table }: { familyId: string; id: string; table: string }) {
  const [state, action] = useActionState(deleteUniversalMenuRecord, initialState);
  return <form action={action}><input name="family_id" type="hidden" value={familyId} /><input name="id" type="hidden" value={id} /><input name="table" type="hidden" value={table} /><button aria-label="Eliminar" className="icon-button danger" title={state.status === "error" ? state.message : "Eliminar"} type="submit"><Trash2 size={15} /></button></form>;
}

function Empty({ children }: { children: ReactNode }) { return <p className="family-config-empty">{children}</p>; }

export function MenuFamilyManagement({ data }: { data: UniversalMenuFamilyData }) {
  const [tab, setTab] = useState<Tab>("recipes");
  const inventoryById = new Map(data.inventorySources.map((source) => [source.id, source]));
  const preparationById = new Map(data.preparationSources.map((source) => [source.id, source]));
  const itemById = new Map(data.items.map((item) => [item.id, item]));
  const presentationById = new Map(data.presentations.map((presentation) => [presentation.id, presentation]));
  const sourceName = (kind: string, inventoryId: string | null, preparationId: string | null) => kind === "inventory_item" ? sourceLabel(inventoryById.get(inventoryId ?? "")) : sourceLabel(preparationById.get(preparationId ?? ""));

  return <section className="family-workspace family-management">
    <header className="family-workspace-header"><div className="family-workspace-title"><span><UtensilsCrossed size={24} /></span><div><p>MENÚ / FAMILIA</p><h1>{data.family.name}</h1><small>{data.family.description || "Configuración reutilizable para venta, cocina e inventario."}</small></div></div><span className={data.family.is_active ? "status-pill success" : "status-pill"}>{data.family.is_active ? "Activa" : "Inactiva"}</span></header>
    <nav aria-label="Configuración de familia" className="family-tabs">{tabs.map(({ id, label, icon: Icon }) => <button className={tab === id ? "active" : ""} key={id} onClick={() => setTab(id)} type="button"><Icon size={16} />{label}</button>)}</nav>

    {tab === "presentations" ? <section className="family-config-section"><h2>Presentaciones</h2><UniversalForm entity="presentation" familyId={data.family.id}><div className="field"><label>Nombre</label><input name="name" placeholder="Ej. PERSONAL" required /></div><div className="field"><label>Descripción</label><input name="description" placeholder="Opcional" /></div></UniversalForm>{data.presentations.length ? <div className="family-config-list">{data.presentations.map((record) => <article key={record.id}><div><strong>{record.name}</strong><small>{record.description || "Sin descripción"}</small></div><DeleteRecord familyId={data.family.id} id={record.id} table="menu_family_presentations" /></article>)}</div> : <Empty>No hay presentaciones configuradas.</Empty>}</section> : null}

    {tab === "recipes" ? <section className="family-config-section"><h2>Platos y recetas</h2><div className="family-config-grid"><div><h3>Plato</h3><UniversalForm entity="item" familyId={data.family.id}><div className="field"><label>Nombre</label><input name="name" placeholder="Ej. SALSA BBQ" required /></div><div className="field"><label>Código</label><input name="sku" placeholder="FAM-001" required /></div><div className="field full"><label>Descripción comercial</label><input name="description" /></div></UniversalForm></div><div><h3>Ingrediente</h3><UniversalForm entity="recipe_component" familyId={data.family.id}><SourceSelect label="Plato" name="family_item_id" sources={data.items.map((item) => ({ id: item.id, name: item.name, unit: "unit" }))} /><div className="field"><label>Presentación</label><select defaultValue="" name="presentation_id"><option value="">Todas</option>{data.presentations.map((record) => <option key={record.id} value={record.id}>{record.name}</option>)}</select></div><SourceKindSelect inventory={data.inventorySources} preparations={data.preparationSources} /><QuantityFields /><div className="field"><label>Grupo de opciones</label><input name="option_group" placeholder="Opcional" /></div><label className="checkbox-field"><input defaultChecked name="is_required" type="checkbox" /> Obligatorio</label></UniversalForm></div><div><h3>Sustitución permitida</h3><UniversalForm entity="recipe_substitution" familyId={data.family.id}><SourceSelect label="Componente" name="component_id" sources={data.components.map((component) => ({ id: component.id, name: `${itemById.get(component.family_item_id)?.name ?? "Plato"} · ${sourceName(component.source_kind, component.inventory_item_id, component.source_preparation_id)}`, unit: component.base_unit }))} /><SourceKindSelect inventory={data.inventorySources} preparations={data.preparationSources} /><QuantityFields /></UniversalForm></div></div>{data.items.length ? <div className="family-config-list">{data.items.map((item) => <article key={item.id}><div><strong>{item.name}</strong><small>{item.sku}{item.commercial_description ? ` · ${item.commercial_description}` : ""}</small><span>{data.components.filter((component) => component.family_item_id === item.id).map((component) => `${sourceName(component.source_kind, component.inventory_item_id, component.source_preparation_id)} ${component.quantity_base} ${component.base_unit.toUpperCase()}`).join(" · ") || "Sin ingredientes"}</span></div><DeleteRecord familyId={data.family.id} id={item.id} table="menu_family_items" /></article>)}</div> : <Empty>Crea un plato antes de configurar su receta.</Empty>}</section> : null}

    {tab === "prices" ? <section className="family-config-section"><h2>Precios</h2><UniversalForm entity="price" familyId={data.family.id}><SourceSelect label="Plato" name="family_item_id" sources={data.items.map((item) => ({ id: item.id, name: item.name, unit: "unit" }))} /><div className="field"><label>Presentación</label><select defaultValue="" name="presentation_id"><option value="">Precio general</option>{data.presentations.map((record) => <option key={record.id} value={record.id}>{record.name}</option>)}</select></div><QuantityFields price /></UniversalForm>{data.prices.length ? <div className="family-config-list">{data.prices.map((price) => <article key={price.id}><div><strong>{itemById.get(price.family_item_id)?.name ?? "Plato"}</strong><small>{presentationById.get(price.presentation_id ?? "")?.name ?? "General"}</small></div><b>{money(price.sale_price_cop)}</b><DeleteRecord familyId={data.family.id} id={price.id} table="menu_family_prices" /></article>)}</div> : <Empty>No hay precios vigentes.</Empty>}</section> : null}

    {tab === "additions" ? <section className="family-config-section"><h2>Adiciones</h2><div className="family-config-grid"><div><h3>Nueva adición</h3><UniversalForm entity="addition" familyId={data.family.id}><div className="field"><label>Nombre</label><input name="name" required /></div><div className="field"><label>Código</label><input name="sku" required /></div><SourceKindSelect inventory={data.inventorySources} preparations={data.preparationSources} /><QuantityFields price /><div className="field"><label>Máximo por pedido</label><input defaultValue="1" min="1" name="max_allowed" type="number" /></div></UniversalForm></div><div><h3>Disponibilidad por plato</h3><UniversalForm entity="addition_item" familyId={data.family.id}><SourceSelect label="Adición" name="addition_id" sources={data.additions.map((addition) => ({ id: addition.id, name: addition.name, unit: "unit" }))} /><SourceSelect label="Plato" name="family_item_id" sources={data.items.map((item) => ({ id: item.id, name: item.name, unit: "unit" }))} /><div className="field"><label>Presentación</label><select defaultValue="" name="presentation_id"><option value="">Todas</option>{data.presentations.map((record) => <option key={record.id} value={record.id}>{record.name}</option>)}</select></div></UniversalForm></div></div>{data.additions.length ? <div className="family-config-list">{data.additions.map((addition) => <article key={addition.id}><div><strong>{addition.name}</strong><small>{addition.sku} · {addition.quantity_base} {addition.base_unit.toUpperCase()} · máximo {addition.max_allowed}</small></div><b>{money(addition.sale_price_cop)}</b><DeleteRecord familyId={data.family.id} id={addition.id} table="menu_family_additions" /></article>)}</div> : <Empty>No hay adiciones configuradas.</Empty>}</section> : null}

    {tab === "combos" ? <section className="family-config-section"><h2>Combos y variantes</h2><div className="family-config-grid"><div><h3>Combo</h3><UniversalForm entity="combo" familyId={data.family.id}><div className="field"><label>Nombre</label><input name="name" required /></div><div className="field"><label>Código</label><input name="sku" required /></div><div className="field full"><label>Descripción</label><input name="description" /></div></UniversalForm></div><div><h3>Variante</h3><UniversalForm entity="combo_variant" familyId={data.family.id}><SourceSelect label="Combo" name="combo_id" sources={data.combos.map((combo) => ({ id: combo.id, name: combo.name, unit: "unit" }))} /><div className="field"><label>Nombre</label><input name="name" placeholder="Precio general" required /></div><div className="field"><label>Precio</label><input min="0" name="sale_price_cop" required step="1" type="number" /></div></UniversalForm></div><div><h3>Componente</h3><UniversalForm entity="combo_component" familyId={data.family.id}><SourceSelect label="Variante" name="variant_id" sources={data.variants.map((variant) => ({ id: variant.id, name: variant.name, unit: "unit" }))} /><div className="field"><label>Nombre visible</label><input name="name" placeholder="Ej. Bebida" required /></div><ComboSourceSelect inventory={data.inventorySources} items={data.items} /><div className="field"><label>Presentación</label><select defaultValue="" name="presentation_id"><option value="">Cualquiera</option>{data.presentations.map((record) => <option key={record.id} value={record.id}>{record.name}</option>)}</select></div><div className="field"><label>Cantidad</label><input defaultValue="1" min="1" name="quantity" type="number" /></div><label className="checkbox-field"><input defaultChecked name="is_required" type="checkbox" /> Obligatorio</label></UniversalForm></div><div><h3>Alternativa</h3><UniversalForm entity="combo_component_option" familyId={data.family.id}><SourceSelect label="Componente" name="component_id" sources={data.comboComponents.map((component) => ({ id: component.id, name: component.name, unit: "unit" }))} /><ComboSourceSelect inventory={data.inventorySources} items={data.items} /><div className="field"><label>Presentación</label><select defaultValue="" name="presentation_id"><option value="">Cualquiera</option>{data.presentations.map((record) => <option key={record.id} value={record.id}>{record.name}</option>)}</select></div><div className="field"><label>Cantidad</label><input defaultValue="1" min="1" name="quantity" type="number" /></div></UniversalForm></div></div>{data.combos.length ? <div className="family-config-list">{data.combos.map((combo) => <article key={combo.id}><div><strong>{combo.name}</strong><small>{combo.sku}{combo.description ? ` · ${combo.description}` : ""}</small><span>{data.variants.filter((variant) => variant.combo_id === combo.id).map((variant) => { const components = data.comboComponents.filter((component) => component.variant_id === variant.id); return `${variant.name}: ${money(variant.sale_price_cop)}${components.length ? ` · ${components.map((component) => component.name).join(", ")}` : ""}`; }).join(" · ") || "Sin variantes"}</span></div><DeleteRecord familyId={data.family.id} id={combo.id} table="menu_family_combos" /></article>)}</div> : <Empty>No hay combos configurados.</Empty>}</section> : null}

    {tab === "packaging" ? <section className="family-config-section"><h2>Empaques por modalidad</h2><UniversalForm entity="packaging_rule" familyId={data.family.id}><SourceSelect label="Plato" name="family_item_id" sources={data.items.map((item) => ({ id: item.id, name: item.name, unit: "unit" }))} /><div className="field"><label>Presentación</label><select defaultValue="" name="presentation_id"><option value="">Todas</option>{data.presentations.map((record) => <option key={record.id} value={record.id}>{record.name}</option>)}</select></div><SourceSelect label="Empaque" name="packaging_inventory_item_id" sources={data.packagingSources} /><div className="field"><label>Modalidad</label><select defaultValue="delivery" name="service_kind"><option value="local">Local</option><option value="pickup">Recoger</option><option value="takeaway">Llevar</option><option value="delivery">Domicilio</option></select></div><QuantityFields /></UniversalForm>{data.packagingRules.length ? <div className="family-config-list">{data.packagingRules.map((rule) => <article key={rule.id}><div><strong>{itemById.get(rule.family_item_id)?.name ?? "Plato"}</strong><small>{presentationById.get(rule.presentation_id ?? "")?.name ?? "Todas"} · {rule.service_kind}</small></div><span>{sourceLabel(data.packagingSources.find((source) => source.id === rule.packaging_inventory_item_id))} × {rule.quantity_base}</span><DeleteRecord familyId={data.family.id} id={rule.id} table="menu_family_packaging_rules" /></article>)}</div> : <Empty>No hay reglas de empaque configuradas.</Empty>}</section> : null}
  </section>;
}
