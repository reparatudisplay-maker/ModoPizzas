"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { CalendarDays, ChevronRight, Eye, FileText, Pencil, Settings, X } from "lucide-react";
import { PurchaseDeleteButton } from "@/components/purchase-delete-button";
import { formatCop } from "@/lib/format";

type PurchaseLineSummary = {
  id: string;
  product: string;
  presentation: string;
  quantity: string;
  unit_cost: string;
  total_cop: number;
};

type PurchaseListRow = {
  id: string;
  image_src: string | null;
  invoice_photo_url: string | null;
  sku: string;
  product: string;
  product_lines: PurchaseLineSummary[];
  presentation: string;
  quantity: string;
  supplier: string;
  brand: string;
  total_cop: number;
  unit_cost: string;
  purchased_at: string;
  notes: string;
};

type ColumnKey = "photo" | "sku" | "product" | "presentation" | "quantity" | "supplier" | "brand" | "total" | "unitCost" | "date" | "notes" | "actions";

const allColumns: ColumnKey[] = ["photo", "sku", "product", "presentation", "quantity", "supplier", "brand", "total", "unitCost", "date", "notes", "actions"];
const defaultColumns: ColumnKey[] = ["photo", "actions", "sku", "product", "presentation", "quantity", "supplier", "brand", "total", "unitCost", "date", "notes"];
const storageKey = "modopizzas.purchases.columns";
const unitCostPreferenceKey = "modopizzas.purchases.columns.unit-cost-defaulted";

function readColumns(): ColumnKey[] {
  if (typeof window === "undefined") return defaultColumns;
  const saved = window.localStorage.getItem(storageKey);
  if (!saved) return defaultColumns;
  try {
    const parsed = JSON.parse(saved) as ColumnKey[];
    const sanitized = parsed.filter((column) => allColumns.includes(column));
    if (sanitized.length && !sanitized.includes("unitCost") && window.localStorage.getItem(unitCostPreferenceKey) !== "1") {
      window.localStorage.setItem(unitCostPreferenceKey, "1");
      const totalIndex = sanitized.indexOf("total");
      if (totalIndex >= 0) return [...sanitized.slice(0, totalIndex + 1), "unitCost", ...sanitized.slice(totalIndex + 1)];
      return [...sanitized, "unitCost"];
    }
    return sanitized.length ? sanitized : defaultColumns;
  } catch {
    window.localStorage.removeItem(storageKey);
    return defaultColumns;
  }
}

function columnLabel(column: ColumnKey) {
  const labels: Record<ColumnKey, string> = {
    photo: "Foto",
    sku: "SKU o referencia",
    product: "Producto",
    presentation: "Presentacion",
    quantity: "Cantidad",
    supplier: "Proveedor",
    brand: "Marca",
    total: "Total pagado",
    unitCost: "Costo unitario",
    date: "Fecha",
    notes: "Notas",
    actions: "Acciones"
  };
  return labels[column];
}

function productImage(src: string | null, name: string) {
  return src ? (
    <Image alt={name} className="inventory-product-photo" height={44} src={src} unoptimized width={58} />
  ) : (
    <span className="inventory-photo-placeholder">Sin foto</span>
  );
}

export function PurchaseListWorkspace({ purchases }: { purchases: PurchaseListRow[] }) {
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(readColumns);
  const [showSettings, setShowSettings] = useState(false);
  const [expandedPurchaseIds, setExpandedPurchaseIds] = useState<Set<string>>(() => new Set());
  const [openInvoicePhotoId, setOpenInvoicePhotoId] = useState<string | null>(null);
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(visibleColumns.filter((column) => allColumns.includes(column))));
  }, [visibleColumns]);

  function showColumn(column: ColumnKey) {
    return visibleColumns.includes(column);
  }

  function toggleColumn(column: ColumnKey) {
    setVisibleColumns((current) => (current.includes(column) ? current.filter((item) => item !== column) : [...current, column]));
  }

  function editHref(id: string) {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("edit", id);
    return `${pathname}?${nextParams.toString()}`;
  }

  function togglePurchase(id: string) {
    setExpandedPurchaseIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const openInvoicePhoto = purchases.find((purchase) => purchase.id === openInvoicePhotoId) ?? null;

  return (
    <>
      <div className="section-title-row purchase-list-settings-row">
        <span className="muted">{purchases.length} compras visibles</span>
        <button className="ghost-button icon-text-button" onClick={() => setShowSettings(true)} type="button">
          <Settings size={18} /> Configuracion
        </button>
      </div>
      <div className="purchase-list" aria-label="Compras registradas">
        {purchases.map((purchase) => {
          const isMultiproduct = purchase.product_lines.length > 1;
          const isExpanded = expandedPurchaseIds.has(purchase.id);
          const date = new Date(purchase.purchased_at).toLocaleDateString("es-CO");
          return (
            <article className={`purchase-list-row${isExpanded ? " is-expanded" : ""}`} key={purchase.id}>
              <div className="purchase-list-row-summary">
                <button
                  aria-controls={`purchase-lines-${purchase.id}`}
                  aria-expanded={isExpanded}
                  className="purchase-expand-button"
                  onClick={() => togglePurchase(purchase.id)}
                  title={isExpanded ? "Ocultar detalle de compra" : "Ver detalle de compra"}
                  type="button"
                >
                  <ChevronRight size={19} />
                </button>
                <div className="purchase-row-identity">
                  {showColumn("photo") && purchase.image_src && !isMultiproduct ? (
                    productImage(purchase.image_src, purchase.product)
                  ) : (
                    <span className="purchase-row-document-icon"><FileText size={20} /></span>
                  )}
                  <div>
                    <strong>{purchase.product}</strong>
                    <span>{isMultiproduct ? `Factura multiproducto · ${purchase.product_lines.length} productos` : "Compra individual"}</span>
                    <div className="purchase-row-meta">
                      {showColumn("sku") && !isMultiproduct && purchase.sku !== "-" ? <small>{purchase.sku}</small> : null}
                      {showColumn("supplier") && purchase.supplier !== "Sin proveedor" ? <small>{purchase.supplier}</small> : null}
                      {showColumn("brand") && purchase.brand !== "Sin marca" ? <small>{purchase.brand}</small> : null}
                    </div>
                  </div>
                </div>
                <div className="purchase-row-date">
                  <CalendarDays size={17} />
                  <span>{date}</span>
                </div>
                <div className="purchase-row-total">
                  <small>Total pagado</small>
                  <strong>{formatCop(Number(purchase.total_cop))}</strong>
                </div>
                <div className="purchase-row-actions" aria-label={`Acciones para ${purchase.product}`}>
                  {purchase.invoice_photo_url ? (
                    <button className="icon-button" onClick={() => setOpenInvoicePhotoId(purchase.id)} title="Ver foto de factura" type="button">
                      <Eye size={16} />
                    </button>
                  ) : null}
                  <Link className="icon-button" href={editHref(purchase.id)} title="Editar compra">
                    <Pencil size={16} />
                  </Link>
                  <PurchaseDeleteButton id={purchase.id} />
                </div>
              </div>
              {isExpanded ? (
                <div className="purchase-list-row-details" id={`purchase-lines-${purchase.id}`}>
                  <div className="purchase-line-grid purchase-line-grid-header" aria-hidden="true">
                    <span>Producto</span>
                    <span>Presentacion</span>
                    <span>Cantidad</span>
                    <span>Costo unitario</span>
                    <span>Subtotal</span>
                  </div>
                  <div className="purchase-line-list" aria-label={`Detalle de ${purchase.product}`}>
                    {purchase.product_lines.map((line, index) => (
                      <div className="purchase-line-grid" key={line.id}>
                        <div className="purchase-line-product"><small>{index + 1}</small><strong>{line.product}</strong></div>
                        <div><small>Presentacion</small><span>{line.presentation}</span></div>
                        <div><small>Cantidad</small><span>{line.quantity}</span></div>
                        <div><small>Costo unitario</small><span>{line.unit_cost}</span></div>
                        <div className="purchase-line-subtotal"><small>Subtotal</small><strong>{formatCop(line.total_cop)}</strong></div>
                      </div>
                    ))}
                  </div>
                  {showColumn("notes") ? (
                    <div className="purchase-list-notes"><strong>Notas:</strong><span>{purchase.notes}</span></div>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })}
        {purchases.length === 0 ? <p className="muted compact-empty-state">No hay compras con esos filtros.</p> : null}
      </div>

      {openInvoicePhoto?.invoice_photo_url ? (
        <div className="modal-backdrop nested-modal-backdrop" role="presentation">
          <section aria-label="Foto de factura" aria-modal="true" className="modal-panel purchase-invoice-photo-viewer" role="dialog">
            <header className="modal-header">
              <div><strong>Foto de factura</strong><span>{new Date(openInvoicePhoto.purchased_at).toLocaleDateString("es-CO")}</span></div>
              <button className="icon-button" onClick={() => setOpenInvoicePhotoId(null)} title="Cerrar" type="button"><X size={18} /></button>
            </header>
            <Image alt={`Factura de ${openInvoicePhoto.product}`} height={1200} src={openInvoicePhoto.invoice_photo_url} unoptimized width={900} />
          </section>
        </div>
      ) : null}

      {showSettings ? (
        <div className="modal-backdrop" role="presentation">
          <section aria-label="Configuracion de compras" aria-modal="true" className="modal-panel inventory-settings-modal" role="dialog">
            <header className="modal-header">
              <div>
                <strong>Configuracion de compras</strong>
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
                  {allColumns.map((column) => (
                    <label className="check-option" key={column}>
                      <input checked={visibleColumns.includes(column)} onChange={() => toggleColumn(column)} type="checkbox" />
                      <span>{columnLabel(column)}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="form-actions">
                <button className="ghost-button" onClick={() => setVisibleColumns(defaultColumns)} type="button">
                  Restablecer configuracion
                </button>
                <button className="primary-button" onClick={() => setShowSettings(false)} type="button">
                  Aplicar
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
