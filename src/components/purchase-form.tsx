"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Plus, Search, Trash2, X } from "lucide-react";
import { registerPurchase, type FormActionState } from "@/app/admin/actions";
import { normalizeColombianDecimalInput } from "@/lib/number-format";

type StockUnit = "g" | "kg" | "ml" | "l" | "unit";
type PurchaseKind = "ingredient" | "sale_product" | "supply";
type PurchaseMode = "total_weight" | "packages";
type InventoryItem = { id: string; name: string; sku?: string | null; unit: StockUnit; item_kind?: PurchaseKind; purchase_mode?: PurchaseMode | null; brand_id?: string | null; presentation_quantity: number | null; presentation_unit: StockUnit | null; is_active: boolean };
type LookupOption = { id: string; name: string; is_active: boolean };
type EditablePurchaseLine = { inventory_item_id: string; brand_id: string | null; purchased_quantity: number; quantity: number; unit: StockUnit; presentation_quantity: number | null; presentation_unit: StockUnit | null; merchandise_total_cop: number; expiration_date: string | null };
export type EditablePurchase = { id: string; supplier_id: string | null; notes: string | null; purchase_date: string; transport_cost_cop: number; lines: EditablePurchaseLine[] };
type DraftLine = { key: string; inventory_item_id: string; brand_id: string; purchase_kind: PurchaseKind | ""; purchase_mode: PurchaseMode; quantity: string; package_content_quantity: string; presentation_unit: StockUnit; presentation_quantity: string; merchandise_total_cop: string; expiration_date: string; reference_sku: string };

const initialFormActionState: FormActionState = { status: "idle", message: "" };
const newKey = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const moneyFormatter = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 2 });
const formatInteger = (value: string | number) => String(value).replace(/\D/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const formatDecimal = (value: string | number) => normalizeColombianDecimalInput(String(value), 3);
const parseMoney = (value: string) => Number(value.replace(/\./g, "")) || 0;
const parseDecimal = (value: string) => Number(value.replace(/\./g, "").replace(",", ".")) || 0;
const unitLabel = (unit: StockUnit) => unit === "unit" ? "UND" : unit.toUpperCase();
const normalSearch = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

function todayDateValue() { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function emptyLine(): DraftLine { return { key: newKey(), inventory_item_id: "", brand_id: "", purchase_kind: "", purchase_mode: "total_weight", quantity: "", package_content_quantity: "", presentation_unit: "unit", presentation_quantity: "", merchandise_total_cop: "", expiration_date: "", reference_sku: "" }; }
function unitsFor(unit: StockUnit) { if (unit === "g" || unit === "kg") return [{ value: "g", label: "Gramos" }, { value: "kg", label: "Kilogramos" }] as const; if (unit === "ml" || unit === "l") return [{ value: "ml", label: "Mililitros" }, { value: "l", label: "Litros" }] as const; return [{ value: "unit", label: "Unidades" }] as const; }
const saleProductPresentationUnits = [{ value: "ml", label: "Mililitros" }, { value: "l", label: "Litros" }, { value: "g", label: "Gramos" }, { value: "kg", label: "Kilogramos" }, { value: "unit", label: "Unidades" }] as const;
function kindLabel(kind: PurchaseKind) { return kind === "ingredient" ? "Ingrediente" : kind === "sale_product" ? "Producto para venta" : "Insumo"; }
function packageContentLabel(unit: StockUnit) { return unit === "g" || unit === "kg" ? "Peso por paquete" : unit === "ml" || unit === "l" ? "Volumen por paquete" : unit === "unit" ? "Unidades por paquete" : "Cantidad por paquete"; }
function selectedMaster(items: InventoryItem[], id: string) { return items.find((item) => item.id === id); }

function lineFromEditable(line: EditablePurchaseLine, items: InventoryItem[]): DraftLine {
  const item = selectedMaster(items, line.inventory_item_id);
  const isSaleProduct = item?.item_kind === "sale_product";
  const isPackage = isSaleProduct
    ? Boolean(line.presentation_quantity && line.presentation_unit)
    : Boolean(line.presentation_quantity && line.presentation_unit && Number(line.presentation_quantity) !== Number(line.purchased_quantity));
  const unitsPerPackage = isPackage && isSaleProduct && Number(line.purchased_quantity) > 0
    ? Number(line.quantity) / Number(line.purchased_quantity)
    : line.presentation_quantity ?? "";
  return {
    key: newKey(),
    inventory_item_id: line.inventory_item_id,
    brand_id: line.brand_id ?? item?.brand_id ?? "",
    purchase_kind: item?.item_kind ?? "",
    purchase_mode: isPackage ? "packages" : "total_weight",
    quantity: formatDecimal(line.purchased_quantity),
    package_content_quantity: isPackage ? formatDecimal(unitsPerPackage) : "",
    presentation_unit: line.presentation_unit ?? item?.unit ?? "unit",
    presentation_quantity: isSaleProduct && isPackage
      ? formatDecimal(line.presentation_quantity ?? "")
      : !isPackage && line.presentation_quantity ? formatDecimal(line.presentation_quantity) : "",
    merchandise_total_cop: formatInteger(line.merchandise_total_cop),
    expiration_date: line.expiration_date ?? "",
    reference_sku: ""
  };
}

function LookupSelect({ label, name, options, value, emptyLabel, onChange }: { label: string; name: string; options: LookupOption[]; value: string; emptyLabel: string; onChange: (value: string) => void }) {
  return <div className="field"><label>{label}</label><select name={name} onChange={(event) => onChange(event.target.value)} value={value}><option value="">{emptyLabel}</option>{options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></div>;
}

function ProductAutocomplete({ items, selected, onSelect }: { items: InventoryItem[]; selected?: InventoryItem; onSelect: (item: InventoryItem | null) => void }) {
  const [query, setQuery] = useState(selected?.name ?? "");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const matches = useMemo(() => { const queryValue = normalSearch(query); return items.filter((item) => !queryValue || normalSearch(`${item.name} ${item.sku ?? ""}`).includes(queryValue)).slice(0, 12); }, [items, query]);
  const choose = (item: InventoryItem) => { onSelect(item); setQuery(item.name); setIsOpen(false); };
  return <div className="field full product-autocomplete"><label>Producto</label><div className="autocomplete-control"><Search aria-hidden="true" size={17} /><input autoComplete="off" disabled={Boolean(selected)} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); setIsOpen(true); }} onFocus={() => !selected && setIsOpen(true)} onKeyDown={(event) => { if (selected) return; if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((current) => Math.min(current + 1, Math.max(matches.length - 1, 0))); } if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((current) => Math.max(current - 1, 0)); } if (event.key === "Enter" && matches[activeIndex]) { event.preventDefault(); choose(matches[activeIndex]); } if (event.key === "Escape") setIsOpen(false); }} placeholder="Buscar por nombre o SKU" type="text" value={query} />{selected ? <button aria-label="Limpiar producto" className="icon-button" onClick={() => { onSelect(null); setQuery(""); setIsOpen(true); }} title="Cambiar producto" type="button"><X size={16} /></button> : <ChevronDown aria-hidden="true" size={17} />}</div>{isOpen && !selected ? <div className="autocomplete-results" role="listbox">{matches.length ? matches.map((item, index) => <button aria-selected={index === activeIndex} className={index === activeIndex ? "active" : ""} key={item.id} onMouseDown={(event) => { event.preventDefault(); choose(item); }} role="option" type="button"><span><strong>{item.name}</strong>{item.sku ? <small>{item.sku}</small> : null}</span><small>{item.item_kind ? kindLabel(item.item_kind) : "Producto"}</small></button>) : <p className="muted">No hay productos que coincidan.</p>}</div> : null}</div>;
}

function totalQuantity(line: DraftLine) {
  const quantity = parseDecimal(line.quantity);
  if (line.purchase_mode !== "packages") return quantity ? `${formatDecimal(quantity)} ${unitLabel(line.presentation_unit)}` : null;
  const content = parseDecimal(line.package_content_quantity);
  return quantity && content ? `${formatDecimal(quantity * content)} ${unitLabel(line.presentation_unit)}` : null;
}
function formatReferenceQuantity(quantity: number, unit: StockUnit) {
  if (unit === "ml") return quantity >= 1000 ? `${formatDecimal(quantity / 1000)} L` : `${formatDecimal(quantity)} ML`;
  if (unit === "l") return quantity < 1 ? `${formatDecimal(quantity * 1000)} ML` : `${formatDecimal(quantity)} L`;
  if (unit === "g") return quantity >= 1000 ? `${formatDecimal(quantity / 1000)} KG` : `${formatDecimal(quantity)} G`;
  if (unit === "kg") return quantity < 1 ? `${formatDecimal(quantity * 1000)} G` : `${formatDecimal(quantity)} KG`;
  return `${formatDecimal(quantity)} UND`;
}
function formatUnitCost(value: number, unit: StockUnit) { return `${moneyFormatter.format(value)} / ${unitLabel(unit)}`; }

function PurchaseCostSummary({ baseQuantity, effectiveCost, merchandiseTotal, packageCount, packageMode, transportAllocation, unit }: { baseQuantity: number; effectiveCost: number; merchandiseTotal: number; packageCount: number; packageMode: boolean; transportAllocation: number; unit: StockUnit }) {
  if (merchandiseTotal <= 0 || baseQuantity <= 0) return null;

  return <div className="purchase-cost-reference"><div className="purchase-cost-grid"><span><small>Costo unitario sin domicilio</small><b>{formatUnitCost(merchandiseTotal / baseQuantity, unit)}</b></span><span><small>Domicilio proporcional asignado</small><b>{moneyFormatter.format(transportAllocation)}</b></span><span className="purchase-final-unit-cost"><small>Costo unitario final con domicilio</small><b>{formatUnitCost(effectiveCost / baseQuantity, unit)}</b></span>{packageMode && packageCount > 0 ? <span><small>Costo final por paquete</small><b>{moneyFormatter.format(effectiveCost / packageCount)}</b></span> : null}</div></div>;
}

function PurchaseLineEditor({ brands, items, line, index, canRemove, transportAllocation, duplicate, onChange, onRemove }: { brands: LookupOption[]; items: InventoryItem[]; line: DraftLine; index: number; canRemove: boolean; transportAllocation: number; duplicate: boolean; onChange: (next: DraftLine) => void; onRemove: () => void }) {
  const selected = selectedMaster(items, line.inventory_item_id);
  const kind = selected?.item_kind ?? line.purchase_kind;
  const packageMode = line.purchase_mode === "packages";
  const saleProductPackage = packageMode && kind === "sale_product";
  const unitOptions = unitsFor(selected?.unit ?? line.presentation_unit);
  const presentationUnitOptions = kind === "sale_product" ? saleProductPresentationUnits : unitOptions;
  const canPickMode = selected?.unit === "unit" && kind !== "sale_product";
  const merchandiseTotal = parseMoney(line.merchandise_total_cop);
  const packageCount = parseDecimal(line.quantity);
  const effectiveCost = merchandiseTotal + transportAllocation;
  const unitsPerPackage = parseDecimal(line.package_content_quantity);
  const baseQuantity = packageMode ? packageCount * unitsPerPackage : parseDecimal(line.quantity);
  const totalPresentationQuantity = saleProductPackage ? baseQuantity * parseDecimal(line.presentation_quantity) : 0;
  const presentationReferenceLabel = line.presentation_unit === "ml" || line.presentation_unit === "l"
    ? "Volumen total de referencia"
    : line.presentation_unit === "g" || line.presentation_unit === "kg"
      ? "Peso total de referencia"
      : "Presentación total de referencia";
  const update = (patch: Partial<DraftLine>) => onChange({ ...line, ...patch });
  const selectProduct = (item: InventoryItem | null) => update({ inventory_item_id: item?.id ?? "", brand_id: item?.brand_id ?? "", purchase_kind: item?.item_kind ?? "", purchase_mode: item?.purchase_mode ?? "total_weight", presentation_unit: item?.unit ?? "unit", package_content_quantity: "", presentation_quantity: "", reference_sku: "" });
  return <fieldset className="purchase-line-card">
    <legend>Línea {index + 1}</legend>
    <div className="purchase-line-heading">
      <p>{selected ? kindLabel(kind as PurchaseKind) : "Selecciona el producto de esta línea"}</p>
      {canRemove ? <button className="icon-button danger-button" onClick={onRemove} title="Quitar producto" type="button"><Trash2 size={16} /></button> : null}
    </div>
    <div className="form-grid purchase-line-grid">
      <ProductAutocomplete items={items} onSelect={selectProduct} selected={selected} />
      {selected ? <>
        <div className="field"><label>Tipo</label><input disabled value={kindLabel(kind as PurchaseKind)} /></div>
        <div className="field"><label>Forma de compra</label>{canPickMode ? <select onChange={(event) => update({ purchase_mode: event.target.value as PurchaseMode, package_content_quantity: "" })} value={line.purchase_mode}><option value="total_weight">Unidades</option><option value="packages">Paquetes</option></select> : <input disabled value={packageMode ? "Paquetes" : "Peso o volumen"} />}</div>
        <div className="field"><label>{packageMode ? "Cantidad de paquetes" : selected.unit === "unit" ? "Cantidad" : "Peso o volumen"}</label><input inputMode="decimal" onBlur={() => update({ quantity: formatDecimal(line.quantity) })} onChange={(event) => update({ quantity: event.target.value.replace(/[^\d.,]/g, "") })} placeholder="0" type="text" value={line.quantity} /></div>
        {packageMode ? saleProductPackage ? <><div className="field"><label>Unidades por paquete</label><input inputMode="decimal" onBlur={() => update({ package_content_quantity: formatDecimal(line.package_content_quantity) })} onChange={(event) => update({ package_content_quantity: event.target.value.replace(/[^\d.,]/g, "") })} placeholder="Ej. 12" type="text" value={line.package_content_quantity} /></div><div className="field"><label>Presentaci&oacute;n por unidad</label><input inputMode="decimal" onBlur={() => update({ presentation_quantity: formatDecimal(line.presentation_quantity) })} onChange={(event) => update({ presentation_quantity: event.target.value.replace(/[^\d.,]/g, "") })} placeholder="Ej. 250" type="text" value={line.presentation_quantity} /></div><div className="field"><label>Unidad presentaci&oacute;n</label><select onChange={(event) => update({ presentation_unit: event.target.value as StockUnit })} value={line.presentation_unit}>{presentationUnitOptions.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}</select></div></> : <><div className="field"><label>{packageContentLabel(line.presentation_unit)}</label><input inputMode="decimal" onBlur={() => update({ package_content_quantity: formatDecimal(line.package_content_quantity) })} onChange={(event) => update({ package_content_quantity: event.target.value.replace(/[^\d.,]/g, "") })} placeholder="Ej. 1,5" type="text" value={line.package_content_quantity} /></div><div className="field"><label>Unidad</label><select onChange={(event) => update({ presentation_unit: event.target.value as StockUnit })} value={line.presentation_unit}>{unitOptions.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}</select></div></> : selected.unit !== "unit" ? <div className="field"><label>Unidad</label><select onChange={(event) => update({ presentation_unit: event.target.value as StockUnit })} value={line.presentation_unit}>{unitOptions.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}</select></div> : null}
        {selected.sku ? <div className="field"><label>SKU</label><input disabled value={selected.sku} /></div> : null}
        <LookupSelect emptyLabel="Sin marca" label="Marca" name={`line-brand-${line.key}`} onChange={(brand_id) => update({ brand_id })} options={brands} value={line.brand_id} />
        <div className="field"><label>Vencimiento</label><input onChange={(event) => update({ expiration_date: event.target.value })} type="date" value={line.expiration_date} /></div>
        <div className="field"><label>Valor mercancía COP</label><input inputMode="numeric" onChange={(event) => update({ merchandise_total_cop: formatInteger(event.target.value) })} placeholder="$ 0" type="text" value={line.merchandise_total_cop} /></div>
        {totalQuantity(line) || merchandiseTotal > 0 ? <aside className="purchase-line-calculation">
          {saleProductPackage && baseQuantity ? <><strong>{formatDecimal(packageCount)} {packageCount === 1 ? "paquete" : "paquetes"} × {formatDecimal(unitsPerPackage)} UND = {formatDecimal(baseQuantity)} UND</strong>{line.presentation_quantity ? <span>Presentaci&oacute;n: {formatDecimal(parseDecimal(line.presentation_quantity))} {unitLabel(line.presentation_unit).toLowerCase()} c/u</span> : null}{totalPresentationQuantity > 0 && line.presentation_unit !== "unit" ? <span>{presentationReferenceLabel}: {formatReferenceQuantity(totalPresentationQuantity, line.presentation_unit)}</span> : null}</> : totalQuantity(line) ? <strong>{packageMode ? `${formatDecimal(packageCount)} paquetes × ${formatDecimal(unitsPerPackage)} ${unitLabel(line.presentation_unit)} = ${totalQuantity(line)}` : `Cantidad total: ${totalQuantity(line)}`}</strong> : null}
          <PurchaseCostSummary baseQuantity={baseQuantity} effectiveCost={effectiveCost} merchandiseTotal={merchandiseTotal} packageCount={packageCount} packageMode={packageMode} transportAllocation={transportAllocation} unit={saleProductPackage ? "unit" : line.presentation_unit} />
          {duplicate ? <p className="purchase-duplicate-warning">Este producto ya está en otra línea. Conserva ambas solo si cambian lote, marca, vencimiento o presentación.</p> : null}
        </aside> : null}
      </> : null}
    </div>
  </fieldset>;
}

function transportAllocations(lines: DraftLine[], transportCost: number) {
  const subtotal = lines.reduce((sum, line) => sum + parseMoney(line.merchandise_total_cop), 0);
  let allocated = 0;
  return lines.map((line, index) => { if (!subtotal || !transportCost) return 0; if (index === lines.length - 1) return transportCost - allocated; const amount = Math.floor(transportCost * (parseMoney(line.merchandise_total_cop) / subtotal)); allocated += amount; return amount; });
}

export function PurchaseForm({ items, suppliers, brands, editPurchase, onSaved, onCancel }: { items: InventoryItem[]; suppliers: LookupOption[]; brands: LookupOption[]; editPurchase?: EditablePurchase | null; onSaved?: () => void; onCancel?: () => void }) {
  const [state, formAction] = useActionState(registerPurchase, initialFormActionState);
  const masters = useMemo(() => items.filter((item) => item.is_active && item.presentation_quantity === null), [items]);
  const [lines, setLines] = useState<DraftLine[]>(() => editPurchase?.lines.length ? editPurchase.lines.map((line) => lineFromEditable(line, masters)) : [emptyLine()]);
  const [supplierId, setSupplierId] = useState(editPurchase?.supplier_id ?? "");
  const [notes, setNotes] = useState(editPurchase?.notes ?? "");
  const [transport, setTransport] = useState(editPurchase ? formatInteger(editPurchase.transport_cost_cop) : "");
  const merchandiseSubtotal = lines.reduce((sum, line) => sum + parseMoney(line.merchandise_total_cop), 0);
  const transportCost = parseMoney(transport);
  const allocations = transportAllocations(lines, transportCost);
  const total = merchandiseSubtotal + transportCost;
  const duplicateIds = new Set(lines.filter((line) => line.inventory_item_id).map((line) => line.inventory_item_id).filter((id, _, all) => all.filter((value) => value === id).length > 1));
  useEffect(() => { if (state.status !== "success") return; const timeout = window.setTimeout(() => onSaved?.(), 900); return () => window.clearTimeout(timeout); }, [onSaved, state.status]);
  return <form action={formAction} className="purchase-form-layout">{editPurchase ? <input name="purchase_id" type="hidden" value={editPurchase.id} /> : null}<input name="purchase_lines_json" type="hidden" value={JSON.stringify(lines)} /><section className="purchase-invoice-details"><div className="form-grid"><div className="field"><label>Fecha de compra</label><input defaultValue={editPurchase?.purchase_date ?? todayDateValue()} name="purchase_date" required type="date" /></div><LookupSelect emptyLabel="Sin proveedor" label="Proveedor" name="supplier_id" onChange={setSupplierId} options={suppliers} value={supplierId} /><div className="field"><label>Domicilio o transporte COP</label><input inputMode="numeric" name="transport_cost_cop" onChange={(event) => setTransport(formatInteger(event.target.value))} placeholder="$ 0" type="text" value={transport} /></div><div className="field full"><label>Notas de factura</label><input name="notes" onChange={(event) => setNotes(event.target.value.toUpperCase())} placeholder="Factura, observaciones o referencia" value={notes} /></div></div></section><section className="purchase-lines-section"><div className="section-title-row"><div><h3>Productos de la factura</h3><p className="muted">Cada línea conserva su presentación, vencimiento, marca y costo de mercancía.</p></div><button className="ghost-button icon-text-button" onClick={() => setLines((current) => [...current, emptyLine()])} type="button"><Plus size={18} /> Agregar producto</button></div><div className="purchase-lines-list">{lines.map((line, index) => <PurchaseLineEditor brands={brands} canRemove={lines.length > 1} duplicate={duplicateIds.has(line.inventory_item_id)} index={index} items={masters} key={line.key} line={line} onChange={(next) => setLines((current) => current.map((candidate) => candidate.key === line.key ? next : candidate))} onRemove={() => setLines((current) => current.filter((candidate) => candidate.key !== line.key))} transportAllocation={allocations[index]} />)}</div></section><section className="purchase-cost-summary" aria-label="Resumen de costos"><span>Mercancía <b>{moneyFormatter.format(merchandiseSubtotal)}</b></span><span>Domicilio <b>{moneyFormatter.format(transportCost)}</b></span><strong>Total factura <b>{moneyFormatter.format(total)}</b></strong><small>El domicilio se reparte proporcionalmente entre las líneas al guardar.</small></section>{state.status !== "idle" ? <p className={`form-status ${state.status}`}>{state.message}</p> : null}<div className="form-actions purchase-form-actions">{editPurchase ? <button className="ghost-button" onClick={onCancel} type="button">Cancelar</button> : null}<PurchaseSubmitButton disabled={!masters.length || lines.some((line) => !line.inventory_item_id)} isEditing={Boolean(editPurchase)} /></div></form>;
}

function PurchaseSubmitButton({ disabled, isEditing }: { disabled: boolean; isEditing: boolean }) { const { pending } = useFormStatus(); return <button className="primary-button" disabled={disabled || pending} type="submit">{pending ? "Guardando..." : isEditing ? "Actualizar factura" : "Registrar compra"}</button>; }

export function PurchaseModal({ items, suppliers, brands, editPurchase }: { items: InventoryItem[]; suppliers: LookupOption[]; brands: LookupOption[]; editPurchase?: EditablePurchase | null }) {
  const [isOpen, setIsOpen] = useState(Boolean(editPurchase)); const [mode, setMode] = useState<"new" | "edit">(editPurchase ? "edit" : "new"); const router = useRouter(); const pathname = usePathname(); const searchParams = useSearchParams(); const activeEditPurchase = mode === "edit" ? editPurchase : null;
  const cleanPurchaseHref = () => { const next = new URLSearchParams(searchParams.toString()); next.delete("edit"); return `${pathname}${next.size ? `?${next}` : ""}`; }; const closeModal = () => { setIsOpen(false); setMode("new"); router.replace(cleanPurchaseHref(), { scroll: false }); }; const handleSaved = () => { closeModal(); router.refresh(); };
  return <><button className="primary-button add-purchase-button" onClick={() => { setMode("new"); setIsOpen(true); }} type="button"><Plus size={18} /> Agregar compra</button>{isOpen ? <div className="modal-backdrop" role="presentation"><section aria-label={activeEditPurchase ? "Editar compra" : "Agregar compra"} aria-modal="true" className="modal-panel purchase-modal" role="dialog"><header className="modal-header"><div><strong>{activeEditPurchase ? "Editar factura de compra" : "Agregar factura de compra"}</strong><span>Registra varios productos bajo una sola factura.</span></div><button className="icon-button" onClick={closeModal} title="Cerrar" type="button"><X size={18} /></button></header><PurchaseForm brands={brands} editPurchase={activeEditPurchase} items={items} onCancel={closeModal} onSaved={handleSaved} suppliers={suppliers} /></section></div> : null}</>;
}
