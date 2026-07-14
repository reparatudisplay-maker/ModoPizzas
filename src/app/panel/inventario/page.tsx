import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Eye, X } from "lucide-react";
import { InventoryAdjustmentModal } from "@/components/inventory-adjustment-modal";
import { PanelShell } from "@/components/panel-shell";
import { formatCop, formatNumber } from "@/lib/format";
import { createServerSupabaseClient } from "@/lib/supabase-server";

type InventoryPageProps = {
  searchParams: Promise<{ q?: string; item?: string }>;
};

type StockUnit = "g" | "kg" | "ml" | "l" | "unit";

type InventoryItem = {
  id: string;
  sku: string | null;
  name: string;
  unit: StockUnit;
  current_quantity: number;
  average_cost_cop: number;
  is_active: boolean;
};

type InventoryMovement = {
  id: string;
  inventory_item_id: string;
  movement_kind: string;
  quantity_delta: number;
  unit: StockUnit;
  source_table: string | null;
  source_id: string | null;
  note: string | null;
  created_at: string;
};

type PurchaseLine = {
  id: string;
  inventory_item_id: string;
  purchased_quantity: number | null;
  quantity: number;
  unit: StockUnit;
  presentation_quantity: number | null;
  presentation_unit: StockUnit | null;
  unit_cost_cop: number;
  line_total_cop: number;
  expiration_date: string | null;
  purchases: {
    id: string;
    purchased_at: string;
    suppliers: { name: string } | null;
    brands: { name: string } | null;
  } | null;
};

const managerRoles = new Set(["gerente", "admin_sistema"]);

export const dynamic = "force-dynamic";

function unitLabel(unit: string) {
  if (unit === "unit") return "unidad";
  return unit;
}

function formatQuantity(value: number, unit: string) {
  return `${formatNumber(Number(value), 3)} ${unitLabel(unit)}`;
}

function inventoryValue(item: InventoryItem) {
  return Number(item.current_quantity ?? 0) * Number(item.average_cost_cop ?? 0);
}

function stockStatus(item: InventoryItem) {
  const quantity = Number(item.current_quantity ?? 0);
  if (quantity <= 0) return { label: "Agotado", className: "danger" };
  if (quantity <= 5) return { label: "Bajo", className: "warning" };
  return { label: "Disponible", className: "ok" };
}

function movementLabel(kind: string) {
  const labels: Record<string, string> = {
    purchase: "Compra",
    sale: "Venta",
    adjustment: "Ajuste",
    adjustment_in: "Ajuste",
    adjustment_out: "Ajuste",
    waste: "Merma",
    return: "Devolución",
    refund: "Devolución"
  };
  return labels[kind] ?? kind;
}

function sourceLabel(sourceTable: string | null, movementKind: string) {
  const labels: Record<string, string> = {
    purchases: "Compra",
    purchase_items: "Compra",
    orders: "Pedido",
    order_items: "Pedido",
    sales: "Venta",
    sale_items: "Venta",
    inventory_adjustments: "Ajuste",
    inventory_waste: "Merma",
    returns: "Devolución",
    refunds: "Devolución"
  };
  return sourceTable ? labels[sourceTable] ?? movementLabel(movementKind) : movementLabel(movementKind);
}

function originReference(label: string, sourceId: string | null) {
  if (!sourceId) return null;
  return `${label} #${sourceId.slice(0, 8)}`;
}

function getPresentation(line: PurchaseLine) {
  if (!line.presentation_quantity || !line.presentation_unit) return "-";
  return formatQuantity(Number(line.presentation_quantity), line.presentation_unit);
}

export default async function InventoryPage({ searchParams }: InventoryPageProps) {
  const { q = "", item: selectedItemId = "" } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roleNames = roles?.map((item) => item.role) ?? [];
  const canManage = roleNames.some((role) => managerRoles.has(role));
  if (!canManage) {
    notFound();
  }

  const [itemsResult, movementsResult, purchaseLinesResult] = await Promise.all([
    supabase.from("inventory_items").select("id, sku, name, unit, current_quantity, average_cost_cop, is_active").order("name"),
    supabase
      .from("inventory_movements")
      .select("id, inventory_item_id, movement_kind, quantity_delta, unit, source_table, source_id, note, created_at")
      .order("created_at", { ascending: false })
      .limit(160),
    supabase
      .from("purchase_items")
      .select(
        "id, inventory_item_id, purchased_quantity, quantity, unit, presentation_quantity, presentation_unit, unit_cost_cop, line_total_cop, expiration_date, purchases(id, purchased_at, suppliers(name), brands(name))"
      )
      .order("expiration_date", { ascending: true, nullsFirst: false })
      .limit(160)
  ]);

  const items = (itemsResult.data ?? []) as InventoryItem[];
  const movements = (movementsResult.data ?? []) as InventoryMovement[];
  const purchaseLines = (purchaseLinesResult.data ?? []) as unknown as PurchaseLine[];
  const error = itemsResult.error ?? movementsResult.error ?? purchaseLinesResult.error;
  const normalizedQuery = q.trim().toLowerCase();
  const filteredItems = normalizedQuery
    ? items.filter((inventoryItem) => [inventoryItem.name, inventoryItem.sku ?? "", unitLabel(inventoryItem.unit)].join(" ").toLowerCase().includes(normalizedQuery))
    : items;
  const selectedItem = selectedItemId ? items.find((inventoryItem) => inventoryItem.id === selectedItemId) ?? null : null;
  const selectedMovements = selectedItem ? movements.filter((movement) => movement.inventory_item_id === selectedItem.id).slice(0, 30) : [];
  const selectedPurchaseLines = selectedItem ? purchaseLines.filter((line) => line.inventory_item_id === selectedItem.id).slice(0, 30) : [];

  return (
    <PanelShell
      active="inventario"
      roleNames={roleNames}
      subtitle="Stock operativo por producto, movimientos y trazabilidad."
      title="Inventario"
      userEmail={user.email ?? "usuario"}
    >
      {error ? <p className="alert">{error.message}</p> : null}

      <section className="form-panel">
        <div className="section-title-row inventory-toolbar-row">
          <h2>Listado consolidado</h2>
          <div className="purchase-toolbar">
            <form className="table-filters">
              <input autoComplete="off" defaultValue={q} list="inventory-search-options" name="q" placeholder="Buscar producto" />
              <datalist id="inventory-search-options">
                {items.map((inventoryItem) => (
                  <option key={inventoryItem.id} value={inventoryItem.name} />
                ))}
              </datalist>
              <button className="ghost-button" type="submit">
                Buscar
              </button>
            </form>
            <InventoryAdjustmentModal items={items} />
          </div>
        </div>

        <div className="data-table-wrap">
          <table className="data-table inventory-table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Stock actual</th>
                <th>Unidad</th>
                <th>Costo promedio</th>
                <th>Valor inventario</th>
                <th>Estado</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((inventoryItem) => {
                const status = stockStatus(inventoryItem);
                const detailHref =
                  selectedItemId === inventoryItem.id
                    ? `/panel/inventario${q ? `?q=${encodeURIComponent(q)}` : ""}`
                    : `/panel/inventario?q=${encodeURIComponent(q)}&item=${inventoryItem.id}`;
                return (
                  <tr key={inventoryItem.id}>
                    <td>
                      <strong>{inventoryItem.name}</strong>
                      <span>{inventoryItem.sku ?? "Sin SKU"}</span>
                    </td>
                    <td>{formatNumber(Number(inventoryItem.current_quantity), 3)}</td>
                    <td>{unitLabel(inventoryItem.unit)}</td>
                    <td>{formatCop(Number(inventoryItem.average_cost_cop))}</td>
                    <td>{formatCop(inventoryValue(inventoryItem))}</td>
                    <td>
                      <span className={`stock-pill ${status.className}`}>{status.label}</span>
                    </td>
                    <td>
                      <Link
                        className={`icon-button ${selectedItemId === inventoryItem.id ? "active-icon-button" : ""}`}
                        href={detailHref}
                        title={selectedItemId === inventoryItem.id ? "Cerrar detalle" : "Ver detalle"}
                      >
                        <Eye size={16} />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filteredItems.length === 0 ? <p className="muted">No hay productos con ese filtro.</p> : null}
        </div>
      </section>

      {selectedItem ? (
        <section className="form-panel inventory-detail-panel">
          <div className="section-title-row">
            <div>
              <h2>{selectedItem.name}</h2>
              <p className="muted">
                Stock {formatQuantity(Number(selectedItem.current_quantity), selectedItem.unit)} - Costo promedio {formatCop(Number(selectedItem.average_cost_cop))}
              </p>
            </div>
            <div className="detail-header-actions">
              <span className={`stock-pill ${stockStatus(selectedItem).className}`}>{stockStatus(selectedItem).label}</span>
              <Link className="icon-button" href={`/panel/inventario${q ? `?q=${encodeURIComponent(q)}` : ""}`} title="Cerrar detalle">
                <X size={16} />
              </Link>
            </div>
          </div>

          <div className="inventory-detail-grid">
            <article>
              <h3>Movimientos</h3>
              <div className="data-table-wrap">
                <table className="data-table compact-data-table">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Tipo</th>
                      <th>Cantidad</th>
                      <th>Origen</th>
                      <th>Nota</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedMovements.map((movement) => (
                      (() => {
                        const origin = sourceLabel(movement.source_table, movement.movement_kind);
                        return (
                          <tr key={movement.id}>
                            <td>{new Date(movement.created_at).toLocaleDateString("es-CO")}</td>
                            <td>{movementLabel(movement.movement_kind)}</td>
                            <td>{formatQuantity(Number(movement.quantity_delta), movement.unit)}</td>
                            <td>
                              <span className="origin-cell">
                                <strong>{origin}</strong>
                                {originReference(origin, movement.source_id) ? <small>{originReference(origin, movement.source_id)}</small> : null}
                              </span>
                            </td>
                            <td>{movement.note ?? "Sin nota"}</td>
                          </tr>
                        );
                      })()
                    ))}
                  </tbody>
                </table>
                {selectedMovements.length === 0 ? <p className="muted">Sin movimientos recientes.</p> : null}
              </div>
            </article>

            <article>
              <h3>Compras, lotes y vencimientos</h3>
              <div className="data-table-wrap">
                <table className="data-table compact-data-table">
                  <thead>
                    <tr>
                      <th>Compra</th>
                      <th>Proveedor</th>
                      <th>Marca</th>
                      <th>Cantidad</th>
                      <th>Presentacion</th>
                      <th>Vence</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedPurchaseLines.map((line) => (
                      <tr key={line.id}>
                        <td>{line.purchases ? new Date(line.purchases.purchased_at).toLocaleDateString("es-CO") : "-"}</td>
                        <td>{line.purchases?.suppliers?.name ?? "Sin proveedor"}</td>
                        <td>{line.purchases?.brands?.name ?? "Sin marca"}</td>
                        <td>{formatQuantity(Number(line.quantity), line.unit)}</td>
                        <td>{getPresentation(line)}</td>
                        <td>{line.expiration_date ? new Date(`${line.expiration_date}T12:00:00`).toLocaleDateString("es-CO") : "Sin fecha"}</td>
                        <td>{formatCop(Number(line.line_total_cop))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {selectedPurchaseLines.length === 0 ? <p className="muted">Sin compras registradas para este producto.</p> : null}
              </div>
            </article>
          </div>
        </section>
      ) : null}
    </PanelShell>
  );
}
