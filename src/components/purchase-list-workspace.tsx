"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Pencil, Settings, X } from "lucide-react";
import { PurchaseDeleteButton } from "@/components/purchase-delete-button";
import { formatCop } from "@/lib/format";

type PurchaseListRow = {
  id: string;
  image_src: string | null;
  sku: string;
  product: string;
  presentation: string;
  quantity: string;
  supplier: string;
  brand: string;
  total_cop: number;
  purchased_at: string;
  notes: string;
};

type ColumnKey = "photo" | "sku" | "product" | "presentation" | "quantity" | "supplier" | "brand" | "total" | "date" | "notes" | "actions";

const allColumns: ColumnKey[] = ["photo", "sku", "product", "presentation", "quantity", "supplier", "brand", "total", "date", "notes", "actions"];
const defaultColumns: ColumnKey[] = ["photo", "actions", "sku", "product", "presentation", "quantity", "supplier", "brand", "total", "date", "notes"];
const storageKey = "modopizzas.purchases.columns";

function readColumns() {
  if (typeof window === "undefined") return defaultColumns;
  const saved = window.localStorage.getItem(storageKey);
  if (!saved) return defaultColumns;
  try {
    const parsed = JSON.parse(saved) as ColumnKey[];
    const sanitized = parsed.filter((column) => allColumns.includes(column));
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

  return (
    <>
      <div className="section-title-row purchase-list-settings-row">
        <span className="muted">{purchases.length} compras visibles</span>
        <button className="ghost-button icon-text-button" onClick={() => setShowSettings(true)} type="button">
          <Settings size={18} /> Configuracion
        </button>
      </div>
      <div className="data-table-wrap">
        <table className="data-table purchase-table rich-inventory-table">
          <thead>
            <tr>
              {showColumn("photo") ? <th>Foto</th> : null}
              {showColumn("actions") ? <th>Acciones</th> : null}
              {showColumn("sku") ? <th>SKU</th> : null}
              {showColumn("product") ? <th>Producto</th> : null}
              {showColumn("presentation") ? <th>Presentacion</th> : null}
              {showColumn("quantity") ? <th>Cantidad</th> : null}
              {showColumn("supplier") ? <th>Proveedor</th> : null}
              {showColumn("brand") ? <th>Marca</th> : null}
              {showColumn("total") ? <th>Total pagado</th> : null}
              {showColumn("date") ? <th>Fecha</th> : null}
              {showColumn("notes") ? <th>Notas</th> : null}
            </tr>
          </thead>
          <tbody>
            {purchases.map((purchase) => (
              <tr key={purchase.id}>
                {showColumn("photo") ? <td>{productImage(purchase.image_src, purchase.product)}</td> : null}
                {showColumn("actions") ? (
                  <td>
                    <span className="row-actions">
                      <Link className="icon-button" href={editHref(purchase.id)} title="Editar compra">
                        <Pencil size={16} />
                      </Link>
                      <PurchaseDeleteButton id={purchase.id} />
                    </span>
                  </td>
                ) : null}
                {showColumn("sku") ? <td>{purchase.sku}</td> : null}
                {showColumn("product") ? (
                  <td>
                    <strong>{purchase.product}</strong>
                  </td>
                ) : null}
                {showColumn("presentation") ? <td>{purchase.presentation}</td> : null}
                {showColumn("quantity") ? <td>{purchase.quantity}</td> : null}
                {showColumn("supplier") ? <td>{purchase.supplier}</td> : null}
                {showColumn("brand") ? <td>{purchase.brand}</td> : null}
                {showColumn("total") ? <td>{formatCop(Number(purchase.total_cop))}</td> : null}
                {showColumn("date") ? <td>{new Date(purchase.purchased_at).toLocaleDateString("es-CO")}</td> : null}
                {showColumn("notes") ? <td>{purchase.notes}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
        {purchases.length === 0 ? <p className="muted">No hay compras con esos filtros.</p> : null}
      </div>

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
