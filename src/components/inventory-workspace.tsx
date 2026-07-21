"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { Eye, Settings, X } from "lucide-react";
import { formatCop } from "@/lib/format";
import { type ProductionInventoryItem, productionItemStatus, productionLotStatus } from "@/lib/production-inventory";
import { formatStockQuantity, unitLabel } from "@/lib/units";

type StockUnit = "g" | "kg" | "ml" | "l" | "unit";
type ItemKind = "ingredient" | "sale_product" | "supply";
type ViewMode = "consolidated" | "decentralized";
type StockFilter = "all" | "available" | "low" | "out" | "hide_out";
type InventorySection = "purchases" | "preparations";

export type InventoryPurchaseLine = {
  id: string;
  purchase_id: string;
  inventory_item_id: string;
  product_name: string;
  sku: string | null;
  image_src: string | null;
  item_kind: ItemKind | null;
  purchase_mode: "total_weight" | "packages" | null;
  purchased_quantity: number | null;
  unit: StockUnit;
  quantity: number;
  presentation_quantity: number | null;
  presentation_unit: StockUnit | null;
  unit_cost_cop: number;
  line_total_cop: number;
  expiration_date: string | null;
  purchased_at: string;
  supplier_name: string | null;
  brand_name: string | null;
  category_name: string | null;
  lot_code: string;
  is_active: boolean;
};

export type InventoryListItem = {
  id: string;
  product_name: string;
  sku: string | null;
  image_src: string | null;
  item_kind: ItemKind | null;
  unit: StockUnit;
  stock: number;
  total_cost_cop: number;
  average_cost_cop: number;
  inventory_value_cop: number;
  is_active: boolean;
  brand_name: string | null;
  category_name: string | null;
  supplier_name: string | null;
  nearest_expiration: string | null;
  last_purchase: string | null;
  lines: InventoryPurchaseLine[];
};

type InventoryWorkspaceProps = {
  items: InventoryListItem[];
  purchaseLines: InventoryPurchaseLine[];
  preparationItems: ProductionInventoryItem[];
};

type InventoryRow = {
  id: string;
  inventory_item_id: string;
  product_name: string;
  sku: string | null;
  image_src: string | null;
  item_kind: ItemKind | null;
  unit: StockUnit;
  stock: number;
  average_cost: number;
  purchase_price: number;
  unit_price: number;
  unit_price_unit: string;
  inventory_value: number;
  expiration_date: string | null;
  lot_code: string;
  supplier_name: string | null;
  brand_name: string | null;
  last_purchase: string | null;
  lines: InventoryPurchaseLine[];
};

type ColumnKey =
  | "photo"
  | "product"
  | "sku"
  | "type"
  | "stock"
  | "unit"
  | "cost"
  | "unitPrice"
  | "inventoryValue"
  | "status"
  | "expiration"
  | "lot"
  | "supplier"
  | "brand"
  | "lastPurchase"
  | "detail";

const allColumns: ColumnKey[] = [
  "photo",
  "product",
  "sku",
  "type",
  "stock",
  "unit",
  "cost",
  "unitPrice",
  "inventoryValue",
  "status",
  "expiration",
  "lot",
  "supplier",
  "brand",
  "lastPurchase",
  "detail"
];

const defaultColumns: ColumnKey[] = ["photo", "product", "type", "stock", "unit", "cost", "unitPrice", "inventoryValue", "status", "expiration", "detail"];
const inventoryViewStorageKey = "modopizzas.inventory.view";
const productionInventoryStorageKey = "modopizzas.inventory.production.columns";
type ProductionColumnKey = "photo" | "unitKind" | "stock" | "cost" | "inventoryValue" | "expiration" | "lots" | "status" | "actions";
const productionColumns: ProductionColumnKey[] = ["photo", "unitKind", "stock", "cost", "inventoryValue", "expiration", "lots", "status", "actions"];
const defaultProductionColumns: ProductionColumnKey[] = ["photo", "unitKind", "stock", "cost", "inventoryValue", "expiration", "lots", "status", "actions"];

function compatibleColumnsForMode(mode: ViewMode): ColumnKey[] {
  return mode === "consolidated"
    ? allColumns.filter((column) => column !== "unitPrice")
    : allColumns.filter((column) => column !== "detail" && column !== "cost");
}

function defaultColumnsForMode(mode: ViewMode) {
  return defaultColumns.filter((column) => compatibleColumnsForMode(mode).includes(column));
}

function sanitizeColumns(columns: ColumnKey[], mode: ViewMode) {
  const compatibleColumns = compatibleColumnsForMode(mode);
  return columns.filter((column) => compatibleColumns.includes(column));
}

function columnLabel(column: ColumnKey, mode: ViewMode) {
  const labels: Record<ColumnKey, string> = {
    photo: "Foto",
    product: "Producto",
    sku: "SKU o referencia",
    type: "Tipo",
    stock: "Stock actual",
    unit: "Unidad",
    cost: "Costo promedio",
    unitPrice: "Precio unitario",
    inventoryValue: mode === "consolidated" ? "Valor inventario" : "Total pagado",
    status: "Estado",
    expiration: "Vencimiento mas proximo",
    lot: "Lote",
    supplier: "Proveedor",
    brand: "Marca",
    lastPurchase: "Ultima compra",
    detail: "Detalle"
  };
  return labels[column];
}

function productionColumnLabel(column: ProductionColumnKey) {
  const labels: Record<ProductionColumnKey, string> = {
    photo: "Foto",
    unitKind: "Tipo de unidad",
    stock: "Stock consolidado",
    cost: "Costo promedio",
    inventoryValue: "Valor inventario",
    expiration: "Proximo vencimiento",
    lots: "Lotes disponibles",
    status: "Estado",
    actions: "Acciones"
  };
  return labels[column];
}

function kindLabel(kind?: string | null) {
  if (kind === "ingredient") return "Ingrediente";
  if (kind === "sale_product") return "Producto para venta";
  if (kind === "supply") return "Insumo";
  return "Sin tipo";
}

function unitKindLabel(kind: string) {
  if (kind === "weight") return "Peso";
  if (kind === "volume") return "Volumen";
  return "Unidad";
}

function normalizeSearch(value: string) {
  return value
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function dateLabel(value?: string | null) {
  if (!value) return "Sin fecha";
  return new Date(`${value.includes("T") ? value : `${value}T12:00:00`}`).toLocaleDateString("es-CO");
}

function stockStatus(quantity: number) {
  if (quantity <= 0) return { key: "out", label: "Agotado", className: "danger" };
  if (quantity <= 5) return { key: "low", label: "Bajo", className: "warning" };
  return { key: "available", label: "Disponible", className: "ok" };
}

function expirationStatus(value?: string | null) {
  if (!value) return { key: "none", label: "Sin vencimiento", className: "neutral" };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = new Date(`${value}T00:00:00`);
  const diffDays = Math.round((date.getTime() - today.getTime()) / 86400000);
  if (diffDays < 0) return { key: "expired", label: "Vencido", className: "danger" };
  if (diffDays === 0) return { key: "today", label: "Vence hoy", className: "warning" };
  if (diffDays <= 7) return { key: "soon", label: "Proximo a vencer", className: "warning" };
  return { key: "ok", label: "Vigente", className: "ok" };
}

function readInventoryPreferences() {
  if (typeof window === "undefined") return {};
  const saved = window.localStorage.getItem(inventoryViewStorageKey);
  if (!saved) return {};
  try {
    return JSON.parse(saved) as { viewMode?: ViewMode; stockFilter?: StockFilter; visibleColumns?: ColumnKey[] };
  } catch {
    window.localStorage.removeItem(inventoryViewStorageKey);
    return {};
  }
}

function readProductionColumns() {
  if (typeof window === "undefined") return defaultProductionColumns;
  const saved = window.localStorage.getItem(productionInventoryStorageKey);
  if (!saved) return defaultProductionColumns;
  try {
    const parsed = JSON.parse(saved) as ProductionColumnKey[];
    const sanitized = parsed.filter((column) => productionColumns.includes(column));
    return sanitized.length ? sanitized : defaultProductionColumns;
  } catch {
    window.localStorage.removeItem(productionInventoryStorageKey);
    return defaultProductionColumns;
  }
}

function productImage(src: string | null, name: string) {
  return src ? (
    <Image alt={name} className="inventory-product-photo" height={44} src={src} unoptimized width={58} />
  ) : (
    <span className="inventory-photo-placeholder">Sin foto</span>
  );
}

function unitPriceForLine(line: InventoryPurchaseLine) {
  if (line.item_kind === "ingredient" && line.purchase_mode !== "packages") {
    if (line.unit === "g") return { value: line.quantity > 0 ? line.line_total_cop / (line.quantity / 1000) : 0, unit: "KG" };
    if (line.unit === "ml") return { value: line.quantity > 0 ? line.line_total_cop / (line.quantity / 1000) : 0, unit: "L" };
    return { value: line.quantity > 0 ? line.line_total_cop / line.quantity : 0, unit: unitLabel(line.unit) };
  }

  const divisor = Number(line.purchased_quantity ?? line.quantity ?? 0);
  return { value: divisor > 0 ? line.line_total_cop / divisor : 0, unit: line.item_kind === "ingredient" ? "PAQUETE" : "UND" };
}

function formatUnitPrice(value: number, unit: string) {
  return `${formatCop(value)} / ${unit}`;
}

function sortByOption(rows: InventoryRow[], sort: string) {
  const nextRows = [...rows];
  nextRows.sort((a, b) => {
    if (sort === "stock_desc") return b.stock - a.stock;
    if (sort === "stock_asc") return a.stock - b.stock;
    if (sort === "cost_desc") return b.average_cost - a.average_cost;
    if (sort === "cost_asc") return a.average_cost - b.average_cost;
    if (sort === "value_desc") return b.inventory_value - a.inventory_value;
    if (sort === "value_asc") return a.inventory_value - b.inventory_value;
    if (sort === "last_purchase") return (b.last_purchase ?? "").localeCompare(a.last_purchase ?? "");
    return a.product_name.localeCompare(b.product_name);
  });
  return nextRows;
}

function uniqueValues(rows: Array<{ brand_name: string | null; supplier_name: string | null }>, key: "brand_name" | "supplier_name") {
  return Array.from(new Set(rows.map((row) => row[key]).filter((value): value is string => Boolean(value)))).sort((a, b) => a.localeCompare(b));
}

export function InventoryWorkspace({ items, purchaseLines, preparationItems }: InventoryWorkspaceProps) {
  const [section, setSection] = useState<InventorySection>("purchases");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [expiration, setExpiration] = useState("");
  const [sort, setSort] = useState("alpha");
  const [brand, setBrand] = useState("");
  const [supplier, setSupplier] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>(() => readInventoryPreferences().viewMode ?? "consolidated");
  const [stockFilter, setStockFilter] = useState<StockFilter>(() => readInventoryPreferences().stockFilter ?? "all");
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(() => {
    const preferences = readInventoryPreferences();
    const mode = preferences.viewMode ?? "consolidated";
    const savedColumns = preferences.visibleColumns?.filter((column) => allColumns.includes(column));
    const sanitizedColumns = savedColumns?.length ? sanitizeColumns(savedColumns, mode) : defaultColumnsForMode(mode);
    return sanitizedColumns.length ? sanitizedColumns : defaultColumnsForMode(mode);
  });
  const [showSettings, setShowSettings] = useState(false);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [preparationQuery, setPreparationQuery] = useState("");
  const [preparationStatus, setPreparationStatus] = useState("");
  const [preparationUnitKind, setPreparationUnitKind] = useState("");
  const [preparationExpiration, setPreparationExpiration] = useState("");
  const [preparationStock, setPreparationStock] = useState<StockFilter>("all");
  const [visibleProductionColumns, setVisibleProductionColumns] = useState<ProductionColumnKey[]>(readProductionColumns);
  const [showProductionSettings, setShowProductionSettings] = useState(false);
  const [openPreparationId, setOpenPreparationId] = useState<string | null>(null);

  useEffect(() => {
    const sanitizedColumns = sanitizeColumns(visibleColumns, viewMode);
    window.localStorage.setItem(inventoryViewStorageKey, JSON.stringify({ viewMode, stockFilter, visibleColumns: sanitizedColumns }));
  }, [viewMode, stockFilter, visibleColumns]);

  useEffect(() => {
    window.localStorage.setItem(productionInventoryStorageKey, JSON.stringify(visibleProductionColumns.filter((column) => productionColumns.includes(column))));
  }, [visibleProductionColumns]);

  const consolidatedRows = useMemo<InventoryRow[]>(() => {
    return items.map((item) => ({
      id: item.id,
      inventory_item_id: item.id,
      product_name: item.product_name,
      sku: item.sku,
      image_src: item.image_src,
      item_kind: item.item_kind,
      unit: item.unit,
      stock: item.stock,
      average_cost: item.average_cost_cop,
      purchase_price: 0,
      unit_price: 0,
      unit_price_unit: "",
      inventory_value: item.inventory_value_cop,
      expiration_date: item.nearest_expiration,
      lot_code: "-",
      supplier_name: item.supplier_name,
      brand_name: item.brand_name,
      last_purchase: item.last_purchase,
      lines: item.lines
    }));
  }, [items]);

  const decentralizedRows = useMemo<InventoryRow[]>(() => {
    return purchaseLines.map((line) => {
      const unitPrice = unitPriceForLine(line);
      return {
        id: line.id,
        inventory_item_id: line.inventory_item_id,
        product_name: line.product_name,
        sku: line.sku,
        image_src: line.image_src,
        item_kind: line.item_kind,
        unit: line.unit,
        stock: line.quantity,
        average_cost: line.unit_cost_cop,
        purchase_price: line.unit_cost_cop,
        unit_price: unitPrice.value,
        unit_price_unit: unitPrice.unit,
        inventory_value: line.line_total_cop,
        expiration_date: line.expiration_date,
        lot_code: line.lot_code,
        supplier_name: line.supplier_name,
        brand_name: line.brand_name,
        last_purchase: line.purchased_at,
        lines: [line]
      };
    });
  }, [purchaseLines]);

  const allRows = viewMode === "consolidated" ? consolidatedRows : decentralizedRows;
  const effectiveSort = viewMode === "decentralized" && (sort === "cost_desc" || sort === "cost_asc") ? "value_desc" : sort;
  const brands = useMemo(() => uniqueValues(allRows, "brand_name"), [allRows]);
  const suppliers = useMemo(() => uniqueValues(allRows, "supplier_name"), [allRows]);

  const filteredRows = useMemo(() => {
    const sourceRows = viewMode === "consolidated" ? consolidatedRows : decentralizedRows;
    const normalizedQuery = normalizeSearch(query);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expirationLimit = (days: number) => {
      const nextDate = new Date(today);
      nextDate.setDate(nextDate.getDate() + days);
      return nextDate;
    };

    const filtered = sourceRows.filter((row) => {
      const currentStatus = stockStatus(row.stock).key;
      const expirationDate = row.expiration_date ? new Date(`${row.expiration_date}T00:00:00`) : null;
      const haystack = normalizeSearch([row.product_name, row.sku ?? "", row.brand_name ?? "", row.supplier_name ?? "", row.lot_code].join(" "));
      if (normalizedQuery && !haystack.includes(normalizedQuery)) return false;
      if (kind && row.item_kind !== kind) return false;
      if (status && currentStatus !== status) return false;
      if (stockFilter === "available" && currentStatus !== "available") return false;
      if (stockFilter === "low" && currentStatus !== "low") return false;
      if (stockFilter === "out" && currentStatus !== "out") return false;
      if (stockFilter === "hide_out" && currentStatus === "out") return false;
      if (viewMode === "decentralized" && stockFilter !== "out" && row.stock <= 0) return false;
      if (brand && row.brand_name !== brand) return false;
      if (supplier && row.supplier_name !== supplier) return false;
      if (expiration === "none" && expirationDate) return false;
      if (expiration && expiration !== "none" && !expirationDate) return false;
      if (expirationDate) {
        if (expiration === "expired" && expirationDate >= today) return false;
        if (expiration === "today" && expirationDate.getTime() !== today.getTime()) return false;
        if (expiration === "7" && (expirationDate < today || expirationDate > expirationLimit(7))) return false;
        if (expiration === "15" && (expirationDate < today || expirationDate > expirationLimit(15))) return false;
        if (expiration === "30" && (expirationDate < today || expirationDate > expirationLimit(30))) return false;
      }
      return true;
    });
    return sortByOption(filtered, effectiveSort);
  }, [brand, consolidatedRows, decentralizedRows, effectiveSort, expiration, kind, query, status, stockFilter, supplier, viewMode]);

  function toggleColumn(column: ColumnKey) {
    if (!compatibleColumnsForMode(viewMode).includes(column)) return;
    setVisibleColumns((current) => (current.includes(column) ? current.filter((item) => item !== column) : [...current, column]));
  }

  function resetSettings() {
    setViewMode("consolidated");
    setVisibleColumns(defaultColumnsForMode("consolidated"));
    setStockFilter("all");
    setOpenItemId(null);
  }

  function handleViewModeChange(nextMode: ViewMode) {
    setViewMode(nextMode);
    setOpenItemId(null);
    if (nextMode === "decentralized" && (sort === "cost_desc" || sort === "cost_asc")) {
      setSort("value_desc");
    }
    setVisibleColumns((current) => {
      const sanitizedColumns = sanitizeColumns(current, nextMode);
      return sanitizedColumns.length ? sanitizedColumns : defaultColumnsForMode(nextMode);
    });
  }

  function showColumn(column: ColumnKey) {
    return compatibleColumnsForMode(viewMode).includes(column) && visibleColumns.includes(column);
  }

  const openItem = openItemId && viewMode === "consolidated" ? filteredRows.find((row) => row.id === openItemId) : null;
  const filteredPreparationItems = useMemo(() => {
    const normalizedQuery = normalizeSearch(preparationQuery);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expirationLimit = (days: number) => {
      const nextDate = new Date(today);
      nextDate.setDate(nextDate.getDate() + days);
      return nextDate;
    };

    return preparationItems
      .filter((item) => {
        const currentStatus = productionItemStatus(item).key;
        const expirationDate = item.nearest_expiration ? new Date(`${item.nearest_expiration}T00:00:00`) : null;
        if (normalizedQuery && !normalizeSearch(item.preparation_name).includes(normalizedQuery)) return false;
        if (preparationUnitKind && item.unit_kind !== preparationUnitKind) return false;
        if (preparationStatus && currentStatus !== preparationStatus) return false;
        if (preparationStock === "available" && item.stock_base <= 0) return false;
        if (preparationStock === "out" && item.stock_base > 0) return false;
        if (preparationStock === "hide_out" && item.stock_base <= 0) return false;
        if (preparationExpiration === "none" && expirationDate) return false;
        if (preparationExpiration && preparationExpiration !== "none" && !expirationDate) return false;
        if (expirationDate) {
          if (preparationExpiration === "expired" && expirationDate >= today) return false;
          if (preparationExpiration === "today" && expirationDate.getTime() !== today.getTime()) return false;
          if (preparationExpiration === "7" && (expirationDate < today || expirationDate > expirationLimit(7))) return false;
          if (preparationExpiration === "15" && (expirationDate < today || expirationDate > expirationLimit(15))) return false;
          if (preparationExpiration === "30" && (expirationDate < today || expirationDate > expirationLimit(30))) return false;
        }
        return true;
      })
      .sort((a, b) => a.preparation_name.localeCompare(b.preparation_name));
  }, [preparationExpiration, preparationItems, preparationQuery, preparationStatus, preparationStock, preparationUnitKind]);
  const openPreparation = openPreparationId ? filteredPreparationItems.find((item) => item.id === openPreparationId) : null;

  function showProductionColumn(column: ProductionColumnKey) {
    return visibleProductionColumns.includes(column);
  }

  function toggleProductionColumn(column: ProductionColumnKey) {
    setVisibleProductionColumns((current) => (current.includes(column) ? current.filter((item) => item !== column) : [...current, column]));
  }

  return (
    <>
      <nav className="section-tabs inventory-section-tabs" aria-label="Secciones de inventario">
        <button className={`ghost-button ${section === "purchases" ? "active-tab" : ""}`} onClick={() => setSection("purchases")} type="button">
          Ingredientes y productos comprados
        </button>
        <button className={`ghost-button ${section === "preparations" ? "active-tab" : ""}`} onClick={() => setSection("preparations")} type="button">
          Preparaciones producidas
        </button>
      </nav>

      {section === "purchases" ? (
        <>
      <section className="form-panel inventory-module-panel">
        <div className="section-title-row inventory-toolbar-row">
          <h1>{viewMode === "consolidated" ? "Listado consolidado" : "Listado desglosado"}</h1>
          <div className="purchase-toolbar inventory-action-row">
            <button className="ghost-button icon-text-button" onClick={() => setShowSettings(true)} type="button">
              <Settings size={18} /> Configuracion
            </button>
          </div>
        </div>

        <div className="inventory-filter-bar">
          <input autoComplete="off" onChange={(event) => setQuery(event.target.value)} placeholder="Buscar producto, SKU, marca, proveedor o lote" value={query} />
          <select onChange={(event) => setKind(event.target.value)} value={kind}>
            <option value="">Todos los tipos</option>
            <option value="ingredient">Ingrediente</option>
            <option value="sale_product">Producto para venta</option>
            <option value="supply">Insumo</option>
          </select>
          <select onChange={(event) => setStatus(event.target.value)} value={status}>
            <option value="">Todos los estados</option>
            <option value="available">Disponible</option>
            <option value="low">Bajo</option>
            <option value="out">Agotado</option>
          </select>
          <select onChange={(event) => setExpiration(event.target.value)} value={expiration}>
            <option value="">Todos los vencimientos</option>
            <option value="expired">Vencidos</option>
            <option value="today">Vence hoy</option>
            <option value="7">Proximos 7 dias</option>
            <option value="15">Proximos 15 dias</option>
            <option value="30">Proximos 30 dias</option>
            <option value="none">Sin vencimiento</option>
          </select>
          <select onChange={(event) => setSort(event.target.value)} value={effectiveSort}>
            <option value="alpha">Orden alfabetico</option>
            <option value="stock_desc">Mayor stock</option>
            <option value="stock_asc">Menor stock</option>
            {viewMode === "consolidated" ? <option value="cost_desc">Costo promedio mayor a menor</option> : null}
            {viewMode === "consolidated" ? <option value="cost_asc">Costo promedio menor a mayor</option> : null}
            <option value="value_desc">{viewMode === "consolidated" ? "Valor inventario mayor a menor" : "Total pagado mayor a menor"}</option>
            <option value="value_asc">{viewMode === "consolidated" ? "Valor inventario menor a mayor" : "Total pagado menor a mayor"}</option>
            <option value="last_purchase">Ultima compra</option>
          </select>
          <select onChange={(event) => setBrand(event.target.value)} value={brand}>
            <option value="">Todas las marcas</option>
            {brands.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select onChange={(event) => setSupplier(event.target.value)} value={supplier}>
            <option value="">Todos los proveedores</option>
            {suppliers.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        <div className="data-table-wrap">
          <table className="data-table inventory-table rich-inventory-table">
            <thead>
              <tr>
                {showColumn("photo") ? <th>Foto</th> : null}
                {showColumn("product") ? <th>Producto</th> : null}
                {showColumn("sku") ? <th>SKU</th> : null}
                {showColumn("type") ? <th>Tipo</th> : null}
                {showColumn("stock") ? <th>Stock actual</th> : null}
                {showColumn("unit") ? <th>Unidad</th> : null}
                {showColumn("cost") ? <th>{columnLabel("cost", viewMode)}</th> : null}
                {showColumn("unitPrice") ? <th>Precio unitario</th> : null}
                {showColumn("inventoryValue") ? <th>{columnLabel("inventoryValue", viewMode)}</th> : null}
                {showColumn("status") ? <th>Estado</th> : null}
                {showColumn("expiration") ? <th>Vencimiento</th> : null}
                {showColumn("lot") ? <th>Lote</th> : null}
                {showColumn("supplier") ? <th>Proveedor</th> : null}
                {showColumn("brand") ? <th>Marca</th> : null}
                {showColumn("lastPurchase") ? <th>Ultima compra</th> : null}
                {showColumn("detail") ? <th>Detalle</th> : null}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const currentStatus = stockStatus(row.stock);
                const currentExpiration = expirationStatus(row.expiration_date);
                return (
                  <tr key={row.id}>
                    {showColumn("photo") ? <td>{productImage(row.image_src, row.product_name)}</td> : null}
                    {showColumn("product") ? (
                      <td>
                        <strong>{row.product_name}</strong>
                      </td>
                    ) : null}
                    {showColumn("sku") ? <td>{row.sku ?? "-"}</td> : null}
                    {showColumn("type") ? <td>{kindLabel(row.item_kind)}</td> : null}
                    {showColumn("stock") ? <td>{formatStockQuantity(row.stock, row.unit)}</td> : null}
                    {showColumn("unit") ? <td>{unitLabel(row.unit)}</td> : null}
                    {showColumn("cost") ? <td>{formatCop(viewMode === "consolidated" ? row.average_cost : row.purchase_price)}</td> : null}
                    {showColumn("unitPrice") ? <td>{formatUnitPrice(row.unit_price, row.unit_price_unit)}</td> : null}
                    {showColumn("inventoryValue") ? <td>{formatCop(row.inventory_value)}</td> : null}
                    {showColumn("status") ? (
                      <td>
                        <span className={`stock-pill ${currentStatus.className}`}>{currentStatus.label}</span>
                      </td>
                    ) : null}
                    {showColumn("expiration") ? (
                      <td>
                        <span className={`stock-pill ${currentExpiration.className}`}>{dateLabel(row.expiration_date)}</span>
                      </td>
                    ) : null}
                    {showColumn("lot") ? <td>{row.lot_code}</td> : null}
                    {showColumn("supplier") ? <td>{row.supplier_name ?? "Sin proveedor"}</td> : null}
                    {showColumn("brand") ? <td>{row.brand_name ?? "Sin marca"}</td> : null}
                    {showColumn("lastPurchase") ? <td>{dateLabel(row.last_purchase)}</td> : null}
                    {showColumn("detail") ? (
                      <td>
                        <button
                          className={`icon-button ${openItemId === row.id ? "active-icon-button" : ""}`}
                          onClick={() => setOpenItemId((current) => (current === row.id ? null : row.id))}
                          title={openItemId === row.id ? "Cerrar detalle" : "Ver detalle"}
                          type="button"
                        >
                          <Eye size={16} />
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filteredRows.length === 0 ? <p className="muted">No hay inventario porque no existen compras validas para mostrar.</p> : null}
        </div>
      </section>

      {openItem ? (
        <section className="form-panel inventory-detail-panel">
          <div className="section-title-row">
            <div>
              <h2>{openItem.product_name}</h2>
              <p className="muted">Detalle calculado desde compras registradas.</p>
            </div>
            <button className="icon-button" onClick={() => setOpenItemId(null)} title="Cerrar detalle" type="button">
              <X size={16} />
            </button>
          </div>
          <div className="data-table-wrap">
            <table className="data-table compact-data-table">
              <thead>
                <tr>
                  <th>Fecha compra</th>
                  <th>Lote</th>
                  <th>Cantidad</th>
                  <th>Precio unitario</th>
                  <th>Total</th>
                  <th>Vence</th>
                  <th>Proveedor</th>
                  <th>Marca</th>
                </tr>
              </thead>
              <tbody>
                {openItem.lines.map((line) => (
                  (() => {
                    const unitPrice = unitPriceForLine(line);
                    return (
                      <tr key={line.id}>
                        <td>{dateLabel(line.purchased_at)}</td>
                        <td>{line.lot_code}</td>
                        <td>{formatStockQuantity(line.quantity, line.unit)}</td>
                        <td>{formatUnitPrice(unitPrice.value, unitPrice.unit)}</td>
                        <td>{formatCop(line.line_total_cop)}</td>
                        <td>{dateLabel(line.expiration_date)}</td>
                        <td>{line.supplier_name ?? "Sin proveedor"}</td>
                        <td>{line.brand_name ?? "Sin marca"}</td>
                      </tr>
                    );
                  })()
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {showSettings ? (
        <div className="modal-backdrop" role="presentation">
          <section aria-label="Configuracion de inventario" aria-modal="true" className="modal-panel inventory-settings-modal" role="dialog">
            <header className="modal-header">
              <div>
                <strong>Configuracion de vista</strong>
                <span>Preferencias guardadas en este navegador.</span>
              </div>
              <button className="icon-button" onClick={() => setShowSettings(false)} title="Cerrar" type="button">
                <X size={18} />
              </button>
            </header>
            <div className="compact-card">
              <div className="form-grid">
                <div className="field full">
                  <label>Modo de visualizacion</label>
                  <div className="segmented-control compact-segmented">
                    <button className={viewMode === "consolidated" ? "active" : ""} onClick={() => handleViewModeChange("consolidated")} type="button">
                      Consolidado
                    </button>
                    <button className={viewMode === "decentralized" ? "active" : ""} onClick={() => handleViewModeChange("decentralized")} type="button">
                      Desglosado
                    </button>
                  </div>
                </div>
                <div className="field full">
                  <label>Estado visible</label>
                  <select onChange={(event) => setStockFilter(event.target.value as StockFilter)} value={stockFilter}>
                    <option value="all">Mostrar todos</option>
                    <option value="available">Solo disponibles</option>
                    <option value="low">Solo bajo stock</option>
                    <option value="out">Solo agotados</option>
                    <option value="hide_out">Ocultar agotados</option>
                  </select>
                </div>
                <div className="field full">
                  <label>Columnas</label>
                  <div className="column-settings-grid">
                    {compatibleColumnsForMode(viewMode).map((column) => (
                      <label className="check-option" key={column}>
                        <input checked={visibleColumns.includes(column)} onChange={() => toggleColumn(column)} type="checkbox" />
                        <span>{columnLabel(column, viewMode)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <div className="form-actions">
                <button className="ghost-button" onClick={resetSettings} type="button">
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
      ) : (
        <ProductionInventorySection
          filteredItems={filteredPreparationItems}
          openPreparation={openPreparation ?? null}
          openPreparationId={openPreparationId}
          preparationExpiration={preparationExpiration}
          preparationQuery={preparationQuery}
          preparationStatus={preparationStatus}
          preparationStock={preparationStock}
          preparationUnitKind={preparationUnitKind}
          setOpenPreparationId={setOpenPreparationId}
          setPreparationExpiration={setPreparationExpiration}
          setPreparationQuery={setPreparationQuery}
          setPreparationStatus={setPreparationStatus}
          setPreparationStock={setPreparationStock}
          setPreparationUnitKind={setPreparationUnitKind}
          setShowProductionSettings={setShowProductionSettings}
          showProductionColumn={showProductionColumn}
        />
      )}

      {showProductionSettings ? (
        <div className="modal-backdrop" role="presentation">
          <section aria-label="Configuracion de inventario de preparaciones" aria-modal="true" className="modal-panel inventory-settings-modal" role="dialog">
            <header className="modal-header">
              <div>
                <strong>Configuracion de preparaciones</strong>
                <span>Columnas guardadas en este navegador.</span>
              </div>
              <button className="icon-button" onClick={() => setShowProductionSettings(false)} title="Cerrar" type="button">
                <X size={18} />
              </button>
            </header>
            <div className="compact-card">
              <div className="field full">
                <label>Columnas</label>
                <div className="column-settings-grid">
                  {productionColumns.map((column) => (
                    <label className="check-option" key={column}>
                      <input checked={visibleProductionColumns.includes(column)} onChange={() => toggleProductionColumn(column)} type="checkbox" />
                      <span>{productionColumnLabel(column)}</span>
                    </label>
                  ))}
                </div>
                <p className="field-hint">Preparacion siempre permanece visible.</p>
              </div>
              <div className="form-actions">
                <button className="ghost-button" onClick={() => setVisibleProductionColumns(defaultProductionColumns)} type="button">
                  Restablecer columnas
                </button>
                <button className="primary-button" onClick={() => setShowProductionSettings(false)} type="button">
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

function ProductionInventorySection({
  filteredItems,
  openPreparation,
  openPreparationId,
  preparationExpiration,
  preparationQuery,
  preparationStatus,
  preparationStock,
  preparationUnitKind,
  setOpenPreparationId,
  setPreparationExpiration,
  setPreparationQuery,
  setPreparationStatus,
  setPreparationStock,
  setPreparationUnitKind,
  setShowProductionSettings,
  showProductionColumn
}: {
  filteredItems: ProductionInventoryItem[];
  openPreparation: ProductionInventoryItem | null;
  openPreparationId: string | null;
  preparationExpiration: string;
  preparationQuery: string;
  preparationStatus: string;
  preparationStock: StockFilter;
  preparationUnitKind: string;
  setOpenPreparationId: (value: string | null | ((current: string | null) => string | null)) => void;
  setPreparationExpiration: (value: string) => void;
  setPreparationQuery: (value: string) => void;
  setPreparationStatus: (value: string) => void;
  setPreparationStock: (value: StockFilter) => void;
  setPreparationUnitKind: (value: string) => void;
  setShowProductionSettings: (value: boolean) => void;
  showProductionColumn: (column: ProductionColumnKey) => boolean;
}) {
  return (
    <>
      <section className="form-panel inventory-module-panel">
        <div className="section-title-row inventory-toolbar-row">
          <h1>Preparaciones producidas</h1>
          <div className="purchase-toolbar inventory-action-row">
            <button className="ghost-button icon-text-button" onClick={() => setShowProductionSettings(true)} type="button">
              <Settings size={18} /> Configuracion
            </button>
          </div>
        </div>
        <div className="inventory-filter-bar">
          <input autoComplete="off" onChange={(event) => setPreparationQuery(event.target.value)} placeholder="Buscar preparacion" value={preparationQuery} />
          <select onChange={(event) => setPreparationUnitKind(event.target.value)} value={preparationUnitKind}>
            <option value="">Todos los tipos</option>
            <option value="weight">Peso</option>
            <option value="volume">Volumen</option>
            <option value="unit">Unidad</option>
          </select>
          <select onChange={(event) => setPreparationStatus(event.target.value)} value={preparationStatus}>
            <option value="">Todos los estados</option>
            <option value="available">Disponible</option>
            <option value="low">Bajo</option>
            <option value="out">Agotado</option>
            <option value="soon">Proximo a vencer</option>
            <option value="expired">Vencido</option>
          </select>
          <select onChange={(event) => setPreparationExpiration(event.target.value)} value={preparationExpiration}>
            <option value="">Todos los vencimientos</option>
            <option value="expired">Vencidos</option>
            <option value="today">Vence hoy</option>
            <option value="7">Proximos 7 dias</option>
            <option value="15">Proximos 15 dias</option>
            <option value="30">Proximos 30 dias</option>
            <option value="none">Sin vencimiento</option>
          </select>
          <select onChange={(event) => setPreparationStock(event.target.value as StockFilter)} value={preparationStock}>
            <option value="all">Con stock y agotadas</option>
            <option value="available">Con stock</option>
            <option value="out">Agotadas</option>
            <option value="hide_out">Ocultar agotadas</option>
          </select>
        </div>
        <div className="data-table-wrap">
          <table className="data-table production-inventory-table rich-inventory-table">
            <thead>
              <tr>
                {showProductionColumn("photo") ? <th>Foto</th> : null}
                <th>Preparacion</th>
                {showProductionColumn("unitKind") ? <th>Tipo de unidad</th> : null}
                {showProductionColumn("stock") ? <th>Stock consolidado</th> : null}
                {showProductionColumn("cost") ? <th>Costo promedio</th> : null}
                {showProductionColumn("inventoryValue") ? <th>Valor inventario</th> : null}
                {showProductionColumn("expiration") ? <th>Proximo vencimiento</th> : null}
                {showProductionColumn("lots") ? <th>Lotes disponibles</th> : null}
                {showProductionColumn("status") ? <th>Estado</th> : null}
                {showProductionColumn("actions") ? <th>Acciones</th> : null}
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => {
                const status = productionItemStatus(item);
                const expiration = expirationStatus(item.nearest_expiration);
                return (
                  <tr key={item.id}>
                    {showProductionColumn("photo") ? <td>{productImage(item.image_src, item.preparation_name)}</td> : null}
                    <td><strong>{item.preparation_name}</strong></td>
                    {showProductionColumn("unitKind") ? <td>{unitKindLabel(item.unit_kind)}</td> : null}
                    {showProductionColumn("stock") ? <td>{formatStockQuantity(item.stock_base, item.base_unit)}</td> : null}
                    {showProductionColumn("cost") ? <td>{formatCop(item.average_cost_cop, { decimals: true })}</td> : null}
                    {showProductionColumn("inventoryValue") ? <td>{formatCop(item.inventory_value_cop, { decimals: true })}</td> : null}
                    {showProductionColumn("expiration") ? <td><span className={`stock-pill ${expiration.className}`}>{dateLabel(item.nearest_expiration)}</span></td> : null}
                    {showProductionColumn("lots") ? <td>{item.available_lots_count}</td> : null}
                    {showProductionColumn("status") ? <td><span className={`stock-pill ${status.className}`}>{status.label}</span></td> : null}
                    {showProductionColumn("actions") ? (
                      <td>
                        <button
                          className={`icon-button ${openPreparationId === item.id ? "active-icon-button" : ""}`}
                          onClick={() => setOpenPreparationId((current) => (current === item.id ? null : item.id))}
                          title={openPreparationId === item.id ? "Cerrar detalle" : "Ver detalle"}
                          type="button"
                        >
                          <Eye size={16} />
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filteredItems.length === 0 ? <p className="muted">No hay preparaciones producidas con esos filtros.</p> : null}
        </div>
      </section>
      {openPreparation ? <ProductionInventoryDetail item={openPreparation} onClose={() => setOpenPreparationId(null)} /> : null}
    </>
  );
}

function ProductionInventoryDetail({ item, onClose }: { item: ProductionInventoryItem; onClose: () => void }) {
  return (
    <section className="form-panel inventory-detail-panel">
      <div className="section-title-row">
        <div>
          <h2>{item.preparation_name}</h2>
          <p className="muted">Lotes ordenados por FEFO y FIFO.</p>
        </div>
        <button className="icon-button" onClick={onClose} title="Cerrar detalle" type="button">
          <X size={16} />
        </button>
      </div>
      <div className="data-table-wrap">
        <table className="data-table compact-data-table production-lot-detail-table">
          <thead>
            <tr>
              <th>Codigo</th>
              <th>Elaboracion</th>
              <th>Vencimiento</th>
              <th>Cantidad inicial</th>
              <th>Saldo</th>
              <th>Unidad</th>
              <th>Costo original</th>
              <th>Costo unitario</th>
              <th>Valor saldo</th>
              <th>Conservacion</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {item.lots.map((lot) => {
              const status = productionLotStatus(lot);
              return (
                <tr key={lot.id}>
                  <td><strong>{lot.code}</strong></td>
                  <td>{dateLabel(lot.elaborated_at)}</td>
                  <td>{dateLabel(lot.expiration_date)}</td>
                  <td>{formatStockQuantity(lot.initial_quantity_base, lot.base_unit)}</td>
                  <td>{formatStockQuantity(lot.stock_base, lot.base_unit)}</td>
                  <td>{unitLabel(lot.base_unit)}</td>
                  <td>{formatCop(lot.total_cost_cop, { decimals: true })}</td>
                  <td>{formatCop(lot.unit_cost_cop, { decimals: true })}</td>
                  <td>{formatCop(lot.inventory_value_cop, { decimals: true })}</td>
                  <td>{storageMethodLabel(lot.storage_method)}</td>
                  <td><span className={`stock-pill ${status.className}`}>{status.label}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="inventory-detail-grid production-trace-grid">
        {item.lots.map((lot) => (
          <article className="compact-card" key={`${lot.id}-trace`}>
            <div>
              <h3>{lot.code}</h3>
              <span className="stock-pill neutral">Trazabilidad</span>
            </div>
            <div className="data-table-wrap">
              <table className="data-table compact-data-table production-consumption-table">
                <thead>
                  <tr>
                    <th>Ingrediente</th>
                    <th>Tipo</th>
                    <th>Cantidad</th>
                    <th>Costo</th>
                    <th>Origen</th>
                  </tr>
                </thead>
                <tbody>
                  {lot.ingredients_consumed.map((ingredient) => (
                    <tr key={ingredient.id}>
                      <td>{ingredient.source_name}</td>
                      <td>{ingredient.source_kind === "preparation" ? "Preparacion" : "Ingrediente"}</td>
                      <td>{formatStockQuantity(ingredient.quantity_base, ingredient.base_unit)}</td>
                      <td>{formatCop(ingredient.cost_cop, { decimals: true })}</td>
                      <td>
                        {ingredient.allocations.length > 0
                          ? ingredient.allocations.map((allocation) => (
                              <span className="origin-cell" key={allocation.id}>
                                <strong>{allocation.origin_label}</strong>
                                <small>{formatStockQuantity(allocation.quantity_base, allocation.base_unit)}</small>
                              </span>
                            ))
                          : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {lot.ingredients_consumed.length === 0 ? <p className="muted">No hay consumos registrados para este lote.</p> : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function storageMethodLabel(method: string) {
  if (method === "ambient") return "Ambiente";
  if (method === "refrigerated") return "Refrigerado";
  return "Congelado";
}
