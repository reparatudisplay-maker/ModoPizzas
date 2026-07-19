import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { deletePurchase } from "@/app/admin/actions";
import { PanelShell } from "@/components/panel-shell";
import { type EditablePurchase, PurchaseModal } from "@/components/purchase-form";
import { formatCop } from "@/lib/format";
import { createServerSupabaseClient } from "@/lib/supabase-server";

type InventoryItem = {
  id: string;
  name: string;
  unit: "g" | "kg" | "ml" | "l" | "unit";
  item_kind?: "ingredient" | "sale_product" | "supply";
  purchase_mode?: "total_weight" | "packages" | null;
  brand_id?: string | null;
  presentation_quantity: number | null;
  presentation_unit: "g" | "kg" | "ml" | "l" | "unit" | null;
  is_active: boolean;
};

type Supplier = {
  id: string;
  name: string;
  is_active: boolean;
};

type Brand = {
  id: string;
  name: string;
  is_active: boolean;
};

type Purchase = {
  id: string;
  supplier_id: string | null;
  brand_id: string | null;
  total_cop: number;
  notes: string | null;
  purchased_at: string;
  suppliers: { name: string } | null;
  brands: { name: string } | null;
  purchase_items: Array<{
    inventory_item_id: string;
    purchased_quantity: number | null;
    quantity: number;
    unit: "g" | "kg" | "ml" | "l" | "unit";
    presentation_quantity: number | null;
    presentation_unit: "g" | "kg" | "ml" | "l" | "unit" | null;
    expiration_date: string | null;
    inventory_items: {
      id: string;
      name: string;
      sku: string | null;
      item_kind: "ingredient" | "sale_product" | "supply" | null;
      presentation_quantity: number | null;
      presentation_unit: "g" | "kg" | "ml" | "l" | "unit" | null;
    } | null;
  }>;
};

type PurchasePageProps = {
  searchParams: Promise<{
    proveedor?: string;
    marca?: string;
    periodo?: string;
    edit?: string;
    q?: string;
    tipo?: string;
  }>;
};

const managerRoles = new Set(["gerente", "admin_sistema"]);

export const dynamic = "force-dynamic";

function getPeriodStart(period: string) {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  if (period === "hoy") return start.toISOString();
  if (period === "semana") {
    start.setDate(start.getDate() - 6);
    return start.toISOString();
  }
  if (period === "15") {
    start.setDate(start.getDate() - 14);
    return start.toISOString();
  }
  if (period === "mes") {
    start.setDate(1);
    return start.toISOString();
  }
  return null;
}

function unitLabel(unit: string) {
  if (unit === "unit") return "UND";
  return unit.toUpperCase();
}

function formatQuantity(value: number, unit: string) {
  const formatted = new Intl.NumberFormat("es-CO", {
    maximumFractionDigits: 3
  }).format(Number(value));
  return `${formatted} ${unitLabel(unit)}`;
}

function presentationCode(quantity: number, unit: string) {
  return formatQuantity(quantity, unit).replace(/\s/g, "");
}

function internalCode(id?: string | null) {
  return id ? id.slice(0, 8).toUpperCase() : "-";
}

function getPurchaseProduct(purchase: Purchase) {
  const item = purchase.purchase_items[0];
  const product = item?.inventory_items;
  if (!product) return "Sin producto";
  if (!item.presentation_quantity || !item.presentation_unit) return product.name;
  const suffix = presentationCode(Number(item.presentation_quantity), item.presentation_unit);
  return product.name.replace(new RegExp(`\\s+${suffix}$`, "i"), "");
}

function kindLabel(kind?: string | null) {
  if (kind === "ingredient") return "Ingrediente";
  if (kind === "sale_product") return "Producto para venta";
  if (kind === "supply") return "Insumo";
  return "Sin tipo";
}

function getPurchaseKind(purchase: Purchase) {
  return purchase.purchase_items[0]?.inventory_items?.item_kind ?? "";
}

function getPurchaseQuantity(purchase: Purchase) {
  const item = purchase.purchase_items[0];
  return item
    ? new Intl.NumberFormat("es-CO", {
        maximumFractionDigits: 3
      }).format(Number(item.purchased_quantity ?? item.quantity))
    : "-";
}

function getPurchasePresentation(purchase: Purchase) {
  const item = purchase.purchase_items[0];
  if (!item?.presentation_quantity || !item.presentation_unit) return "-";
  return formatQuantity(Number(item.presentation_quantity), item.presentation_unit);
}

function getPurchaseSku(purchase: Purchase) {
  return purchase.purchase_items[0]?.inventory_items?.sku ?? "-";
}

function getPurchaseCode(purchase: Purchase) {
  return internalCode(purchase.purchase_items[0]?.inventory_items?.id);
}

function PurchaseFilters({
  suppliers,
  brands,
  currentSupplier,
  currentBrand,
  currentPeriod,
  query,
  suggestions
}: {
  suppliers: Supplier[];
  brands: Brand[];
  currentSupplier: string;
  currentBrand: string;
  currentPeriod: string;
  query: string;
  suggestions: string[];
}) {
  return (
    <form className="table-filters">
      <input autoComplete="off" defaultValue={query} list="purchase-search-options" name="q" placeholder="Buscar compra" />
      <datalist id="purchase-search-options">
        {suggestions.map((suggestion) => (
          <option key={suggestion} value={suggestion} />
        ))}
      </datalist>
      <select defaultValue={currentSupplier} name="proveedor">
        <option value="">Todos los proveedores</option>
        {suppliers.map((supplier) => (
          <option key={supplier.id} value={supplier.id}>
            {supplier.name}
          </option>
        ))}
      </select>
      <select defaultValue={currentBrand} name="marca">
        <option value="">Todas las marcas</option>
        {brands.map((brand) => (
          <option key={brand.id} value={brand.id}>
            {brand.name}
          </option>
        ))}
      </select>
      <select defaultValue={currentPeriod} name="periodo">
        <option value="hoy">Hoy</option>
        <option value="semana">Semana</option>
        <option value="15">Ultimos 15 dias</option>
        <option value="mes">Mes</option>
        <option value="todos">Todos</option>
      </select>
      <button className="ghost-button" type="submit">
        Filtrar
      </button>
    </form>
  );
}

export default async function PurchasesPage({ searchParams }: PurchasePageProps) {
  const params = await searchParams;
  const supplierFilter = params.proveedor ?? "";
  const brandFilter = params.marca ?? "";
  const periodFilter = params.periodo ?? "todos";
  const kindFilter = params.tipo ?? "";
  const editId = params.edit ?? "";
  const periodStart = getPeriodStart(periodFilter);
  const query = params.q?.trim() ?? "";
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

  let purchasesQuery = supabase
    .from("purchases")
    .select(
      "id, supplier_id, brand_id, total_cop, notes, purchased_at, suppliers(name), brands(name), purchase_items(inventory_item_id, purchased_quantity, quantity, unit, presentation_quantity, presentation_unit, expiration_date, inventory_items(id, name, sku, item_kind, presentation_quantity, presentation_unit))"
    )
    .order("purchased_at", { ascending: false })
    .limit(60);

  if (supplierFilter) {
    purchasesQuery = purchasesQuery.eq("supplier_id", supplierFilter);
  }

  if (brandFilter) {
    purchasesQuery = purchasesQuery.eq("brand_id", brandFilter);
  }

  if (periodStart) {
    purchasesQuery = purchasesQuery.gte("purchased_at", periodStart);
  }

  const [itemsResult, suppliersResult, brandsResult, purchasesResult] = await Promise.all([
    supabase
      .from("inventory_items")
      .select("id, name, unit, item_kind, purchase_mode, brand_id, presentation_quantity, presentation_unit, is_active")
      .eq("is_active", true)
      .is("presentation_quantity", null)
      .order("name"),
    supabase.from("suppliers").select("id, name, is_active").eq("is_active", true).order("name"),
    supabase.from("brands").select("id, name, is_active").eq("is_active", true).order("name"),
    purchasesQuery
  ]);
  const items = (itemsResult.data ?? []) as InventoryItem[];
  const suppliers = (suppliersResult.data ?? []) as Supplier[];
  const brands = (brandsResult.data ?? []) as Brand[];
  const purchases = (purchasesResult.data ?? []) as unknown as Purchase[];
  const editPurchaseSource = purchases.find((purchase) => purchase.id === editId);
  const editLine = editPurchaseSource?.purchase_items[0];
  const editPurchase: EditablePurchase | null =
    editPurchaseSource && editLine
      ? {
          id: editPurchaseSource.id,
          inventory_item_id: editLine.inventory_item_id,
          supplier_id: editPurchaseSource.supplier_id,
          brand_id: editPurchaseSource.brand_id,
          purchased_quantity: Number(editLine.purchased_quantity ?? editLine.quantity ?? 0),
          presentation_quantity: editLine.presentation_quantity,
          presentation_unit: editLine.presentation_unit,
          total_cop: Number(editPurchaseSource.total_cop ?? 0),
          notes: editPurchaseSource.notes,
          purchase_date: new Date(editPurchaseSource.purchased_at).toISOString().slice(0, 10),
          expiration_date: editLine.expiration_date
        }
      : null;
  const error = itemsResult.error ?? suppliersResult.error ?? brandsResult.error ?? purchasesResult.error;
  const normalizedQuery = query.toLowerCase();
  const filteredPurchases = normalizedQuery
    ? purchases.filter((purchase) =>
        [
          getPurchaseProduct(purchase),
          purchase.suppliers?.name ?? "",
          purchase.brands?.name ?? "",
          purchase.notes ?? "",
          new Date(purchase.purchased_at).toLocaleDateString("es-CO")
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery)
      )
    : purchases;
  const kindFilteredPurchases = kindFilter ? filteredPurchases.filter((purchase) => getPurchaseKind(purchase) === kindFilter) : filteredPurchases;
  const searchSuggestions = Array.from(
    new Set(
      purchases
        .flatMap((purchase) => [
          getPurchaseProduct(purchase),
          purchase.suppliers?.name ?? "",
          purchase.brands?.name ?? "",
          kindLabel(getPurchaseKind(purchase)),
          purchase.notes ?? ""
        ])
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ).slice(0, 40);
  const tabBaseParams = new URLSearchParams();
  if (query) tabBaseParams.set("q", query);
  if (supplierFilter) tabBaseParams.set("proveedor", supplierFilter);
  if (brandFilter) tabBaseParams.set("marca", brandFilter);
  if (periodFilter !== "todos") tabBaseParams.set("periodo", periodFilter);
  const tabHref = (kind: string) => {
    const nextParams = new URLSearchParams(tabBaseParams);
    if (kind) nextParams.set("tipo", kind);
    const queryString = nextParams.toString();
    return `/panel/compras${queryString ? `?${queryString}` : ""}`;
  };

  return (
    <PanelShell
      active="compras"
      roleNames={roleNames}
      subtitle="Registra compras de insumos. Esta operacion aumenta stock y recalcula costo promedio."
      title="Compras"
      userEmail={user.email ?? "usuario"}
    >
      {error ? <p className="alert">{error.message}</p> : null}
      <section className="form-panel">
        <div className="section-title-row purchase-list-header">
          <h2>Listado de compras</h2>
          <div className="purchase-toolbar">
            <PurchaseFilters
              brands={brands}
              currentBrand={brandFilter}
              currentPeriod={periodFilter}
              currentSupplier={supplierFilter}
              query={query}
              suggestions={searchSuggestions}
              suppliers={suppliers}
            />
            <PurchaseModal
              brands={brands}
              editPurchase={editPurchase}
              items={items}
              key={editPurchase?.id ?? "new-purchase"}
              suppliers={suppliers}
            />
          </div>
        </div>
        <nav aria-label="Secciones de compras" className="purchase-tabs">
          <Link className={!kindFilter ? "active-tab" : ""} href={tabHref("")}>
            Todos
          </Link>
          <Link className={kindFilter === "ingredient" ? "active-tab" : ""} href={tabHref("ingredient")}>
            Ingredientes
          </Link>
          <Link className={kindFilter === "sale_product" ? "active-tab" : ""} href={tabHref("sale_product")}>
            Productos
          </Link>
          <Link className={kindFilter === "supply" ? "active-tab" : ""} href={tabHref("supply")}>
            Insumos
          </Link>
        </nav>
        <div className="data-table-wrap">
          <table className="data-table purchase-table">
            <thead>
              <tr>
                <th>Acciones</th>
                <th>Codigo</th>
                <th>SKU</th>
                <th>Producto</th>
                <th>Presentacion</th>
                <th>Cantidad</th>
                <th>Proveedor</th>
                <th>Marca</th>
                <th>Total</th>
                <th>Fecha</th>
                <th>Notas</th>
              </tr>
            </thead>
            <tbody>
              {kindFilteredPurchases.map((purchase) => (
                <tr key={purchase.id}>
                  <td colSpan={11}>
                    <details className="table-details">
                      <summary>
                        <span className="row-actions">
                          <Link className="icon-button" href={`/panel/compras?edit=${purchase.id}`} title="Editar compra">
                            <Pencil size={16} />
                          </Link>
                          <form action={deletePurchase}>
                            <input name="purchase_id" type="hidden" value={purchase.id} />
                            <button className="icon-button danger-button" title="Eliminar compra" type="submit">
                              <Trash2 size={16} />
                            </button>
                          </form>
                        </span>
                        <span>{getPurchaseCode(purchase)}</span>
                        <span>{getPurchaseSku(purchase)}</span>
                        <span>{getPurchaseProduct(purchase)}</span>
                        <span>{getPurchasePresentation(purchase)}</span>
                        <span>{getPurchaseQuantity(purchase)}</span>
                        <span>{purchase.suppliers?.name ?? "Sin proveedor"}</span>
                        <span>{purchase.brands?.name ?? "Sin marca"}</span>
                        <strong>{formatCop(Number(purchase.total_cop))}</strong>
                        <span>{new Date(purchase.purchased_at).toLocaleDateString("es-CO")}</span>
                        <span>{purchase.notes || "Sin notas"}</span>
                      </summary>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {kindFilteredPurchases.length === 0 ? <p className="muted">No hay compras con esos filtros.</p> : null}
        </div>
      </section>
    </PanelShell>
  );
}
