"use client";

import Image from "next/image";
import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { Pencil, Settings, X } from "lucide-react";
import { saveSaleProductPrice, type FormActionState } from "@/app/admin/actions";
import { formatCop } from "@/lib/format";
import { normalizeMasterText, uppercaseMasterName } from "@/lib/master-normalization";

type StatusFilter = "" | "enabled" | "disabled" | "without_price";
type ProductPriceColumn = "photo" | "presentation" | "sku" | "cost" | "price" | "profit" | "margin" | "status" | "actions";

export type SaleProductPriceReference = {
  id: string;
  sku: string | null;
  name: string;
  image_src: string | null;
  presentation: string;
  current_cost_cop: number | null;
  sale_price_cop: number;
  sale_is_enabled: boolean;
};

const initialState: FormActionState = { status: "idle", message: "" };
const storageKey = "modopizzas.menu-prices.products.columns";
const defaultColumns: ProductPriceColumn[] = ["photo", "presentation", "sku", "cost", "price", "profit", "margin", "status", "actions"];
const allColumns: ProductPriceColumn[] = ["photo", "presentation", "sku", "cost", "price", "profit", "margin", "status", "actions"];

function readColumns() {
  if (typeof window === "undefined") return defaultColumns;
  const saved = window.localStorage.getItem(storageKey);
  if (!saved) return defaultColumns;
  try {
    const parsed = JSON.parse(saved);
    const clean = Array.isArray(parsed) ? parsed.filter((column): column is ProductPriceColumn => allColumns.includes(column)) : [];
    return clean.length ? clean : defaultColumns;
  } catch {
    window.localStorage.removeItem(storageKey);
    return defaultColumns;
  }
}

function columnLabel(column: ProductPriceColumn) {
  const labels: Record<ProductPriceColumn, string> = {
    photo: "Foto",
    presentation: "Presentacion",
    sku: "SKU",
    cost: "Costo actual",
    price: "Precio venta",
    profit: "Utilidad",
    margin: "Margen",
    status: "Estado",
    actions: "Acciones"
  };
  return labels[column];
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "Sin margen";
  return `${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 }).format(value)}%`;
}

function metricsFor(reference: Pick<SaleProductPriceReference, "current_cost_cop" | "sale_price_cop">) {
  const cost = reference.current_cost_cop && reference.current_cost_cop > 0 ? reference.current_cost_cop : null;
  const price = Number(reference.sale_price_cop ?? 0);
  return {
    profit: cost === null || price <= 0 ? null : price - cost,
    margin: cost === null || price <= 0 ? null : ((price - cost) / price) * 100
  };
}

export function SaleProductPricesWorkspace({ references }: { references: SaleProductPriceReference[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [columns, setColumns] = useState<ProductPriceColumn[]>(defaultColumns);
  const [columnsLoaded, setColumnsLoaded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [modal, setModal] = useState<SaleProductPriceReference | null>(null);
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

  const filteredReferences = useMemo(() => {
    return references.filter((reference) => {
      const text = `${reference.name} ${reference.presentation} ${reference.sku ?? ""}`;
      const matchesQuery = !normalizedQuery || normalizeMasterText(text).includes(normalizedQuery);
      const matchesStatus =
        status === "enabled"
          ? reference.sale_is_enabled && reference.sale_price_cop > 0
          : status === "disabled"
            ? !reference.sale_is_enabled
            : status === "without_price"
              ? reference.sale_price_cop <= 0
              : true;
      return matchesQuery && matchesStatus;
    });
  }, [normalizedQuery, references, status]);

  function toggleColumn(column: ProductPriceColumn) {
    setColumns((current) => (current.includes(column) ? current.filter((item) => item !== column) : [...current, column]));
  }

  return (
    <>
      <section className="form-panel">
        <div className="section-title-row inventory-toolbar-row">
          <h2>Precios de productos</h2>
          <div className="purchase-toolbar">
            <form className="table-filters" onSubmit={(event) => event.preventDefault()}>
              <input autoComplete="off" onChange={(event) => setQuery(uppercaseMasterName(event.target.value))} placeholder="Buscar producto" value={query} />
              <select onChange={(event) => setStatus(event.target.value as StatusFilter)} title="Estado" value={status}>
                <option value="">Todos</option>
                <option value="enabled">Habilitados</option>
                <option value="disabled">Deshabilitados</option>
                <option value="without_price">Sin precio</option>
              </select>
            </form>
            <button className="ghost-button icon-text-button" onClick={() => setShowSettings(true)} type="button">
              <Settings size={18} /> Configuracion
            </button>
          </div>
        </div>
        <div className="menu-pizzas-table-wrap">
          <table className="data-table menu-pizzas-table">
            <thead>
              <tr>
                {columns.includes("photo") ? <th>FOTO</th> : null}
                <th>PRODUCTO</th>
                {columns.includes("presentation") ? <th>PRESENTACION</th> : null}
                {columns.includes("sku") ? <th>SKU</th> : null}
                {columns.includes("cost") ? <th>COSTO ACTUAL</th> : null}
                {columns.includes("price") ? <th>PRECIO VENTA</th> : null}
                {columns.includes("profit") ? <th>UTILIDAD</th> : null}
                {columns.includes("margin") ? <th>MARGEN</th> : null}
                {columns.includes("status") ? <th>ESTADO</th> : null}
                {columns.includes("actions") ? <th className="actions-column compact-actions-column">ACCIONES</th> : null}
              </tr>
            </thead>
            <tbody>
              {filteredReferences.map((reference) => {
                const metrics = metricsFor(reference);
                return (
                  <tr key={reference.id}>
                    {columns.includes("photo") ? (
                      <td>
                        <ProductThumb alt={reference.name} src={reference.image_src} />
                      </td>
                    ) : null}
                    <td><strong>{reference.name}</strong></td>
                    {columns.includes("presentation") ? <td>{reference.presentation}</td> : null}
                    {columns.includes("sku") ? <td>{reference.sku ?? "Sin SKU"}</td> : null}
                    {columns.includes("cost") ? <td>{reference.current_cost_cop ? formatCop(reference.current_cost_cop, { decimals: !Number.isInteger(reference.current_cost_cop) }) : "Sin costo"}</td> : null}
                    {columns.includes("price") ? <td>{reference.sale_price_cop > 0 ? formatCop(reference.sale_price_cop) : "Sin precio"}</td> : null}
                    {columns.includes("profit") ? <td>{metrics.profit === null ? "Sin utilidad" : formatCop(metrics.profit, { decimals: !Number.isInteger(metrics.profit) })}</td> : null}
                    {columns.includes("margin") ? <td>{formatPercent(metrics.margin)}</td> : null}
                    {columns.includes("status") ? <td><span className={`stock-pill ${reference.sale_is_enabled && reference.sale_price_cop > 0 ? "ok" : "muted"}`}>{reference.sale_is_enabled && reference.sale_price_cop > 0 ? "Habilitado" : "Deshabilitado"}</span></td> : null}
                    {columns.includes("actions") ? (
                      <td className="actions-column compact-actions-column">
                        <span className="row-actions center-actions">
                          <button className="icon-button" onClick={() => setModal(reference)} title={`Editar precio de ${reference.name}`} type="button"><Pencil size={16} /></button>
                        </span>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
              {filteredReferences.length === 0 ? <tr><td colSpan={10}>Sin referencias vendibles.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      {modal ? <SaleProductPriceModal item={modal} onClose={() => setModal(null)} /> : null}

      {showSettings ? (
        <div className="modal-backdrop" role="presentation">
          <section aria-label="Configuracion de columnas" aria-modal="true" className="modal-panel inventory-settings-modal" role="dialog">
            <header className="modal-header">
              <div><strong>Configuracion de productos</strong><span>Preferencias guardadas en este navegador.</span></div>
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
                <p className="field-hint">Producto siempre permanece visible.</p>
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

function SaleProductPriceModal({ item, onClose }: { item: SaleProductPriceReference; onClose: () => void }) {
  const [state, action] = useActionState(saveSaleProductPrice, initialState);
  const [salePrice, setSalePrice] = useState(item.sale_price_cop > 0 ? String(Math.round(item.sale_price_cop)) : "");
  const [enabled, setEnabled] = useState(item.sale_is_enabled);
  const preview = {
    ...item,
    sale_price_cop: Number(salePrice || 0)
  };
  const metrics = metricsFor(preview);

  useEffect(() => {
    if (state.status === "success") {
      const timeout = window.setTimeout(onClose, 900);
      return () => window.clearTimeout(timeout);
    }
    return undefined;
  }, [onClose, state.status]);

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-label="Editar precio de producto" aria-modal="true" className="modal-panel wide-modal" role="dialog">
        <header className="modal-header">
          <div><strong>Editar precio</strong><span>Precio de venta por referencia vendible.</span></div>
          <button className="icon-button" onClick={onClose} title="Cerrar" type="button"><X size={18} /></button>
        </header>
        <form action={action} className="compact-card">
          <input name="id" type="hidden" value={item.id} />
          <input name="current_cost_cop" type="hidden" value={item.current_cost_cop ?? 0} />
          <div className="sale-product-price-editor">
            <ProductThumb alt={item.name} src={item.image_src} />
            <div>
              <small>Producto</small>
              <strong>{item.name}</strong>
            </div>
            <div>
              <small>Presentacion</small>
              <strong>{item.presentation}</strong>
            </div>
            <div>
              <small>SKU</small>
              <strong>{item.sku ?? "Sin SKU"}</strong>
            </div>
            <div>
              <small>Costo actual</small>
              <strong>{item.current_cost_cop ? formatCop(item.current_cost_cop, { decimals: !Number.isInteger(item.current_cost_cop) }) : "Sin costo"}</strong>
            </div>
          </div>
          <div className="form-grid">
            <div className="field">
              <label>Precio de venta</label>
              <input inputMode="numeric" name="sale_price_cop" onChange={(event) => setSalePrice(event.target.value.replace(/\D/g, ""))} placeholder="$ 0" required value={salePrice} />
            </div>
            <label className="check-option">
              <input checked={enabled} name="sale_is_enabled" onChange={(event) => setEnabled(event.target.checked)} type="checkbox" />
              <span>Habilitado para venta</span>
            </label>
          </div>
          <div className="summary-grid price-summary-grid">
            <div><span>Costo actual</span><strong>{item.current_cost_cop ? formatCop(item.current_cost_cop, { decimals: !Number.isInteger(item.current_cost_cop) }) : "Sin costo"}</strong></div>
            <div><span>Precio venta</span><strong>{salePrice ? formatCop(Number(salePrice)) : "$ 0"}</strong></div>
            <div><span>Utilidad</span><strong>{metrics.profit === null ? "Sin utilidad" : formatCop(metrics.profit, { decimals: !Number.isInteger(metrics.profit) })}</strong></div>
            <div><span>Margen</span><strong>{formatPercent(metrics.margin)}</strong></div>
          </div>
          {item.current_cost_cop === null ? <p className="form-status error">Sin costo disponible; la utilidad y el margen no se pueden calcular.</p> : null}
          {metrics.profit !== null && metrics.profit < 0 ? <p className="form-status error">El precio esta por debajo del costo vigente.</p> : null}
          {state.status !== "idle" ? <p className={`form-status ${state.status}`}>{state.message}</p> : null}
          <div className="form-actions modal-form-actions">
            <button className="ghost-button" onClick={onClose} type="button">Cancelar</button>
            <SubmitButton />
          </div>
        </form>
      </section>
    </div>
  );
}

function ProductThumb({ src, alt }: { src: string | null; alt: string }) {
  return src ? (
    <Image alt={alt} className="product-thumb-image" height={48} src={src} unoptimized width={48} />
  ) : (
    <span className="product-thumb-placeholder">Sin foto</span>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return <button className="primary-button" disabled={pending} type="submit">{pending ? "Guardando..." : "Guardar precio"}</button>;
}
