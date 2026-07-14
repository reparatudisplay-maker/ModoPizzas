import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Eye, Pencil, X } from "lucide-react";
import { PanelShell } from "@/components/panel-shell";
import { ProductModal, type InventoryProduct, type ItemKind } from "@/components/product-form";
import { createServerSupabaseClient } from "@/lib/supabase-server";

type ProductsPageProps = {
  searchParams: Promise<{ q?: string; edit?: string; item?: string }>;
};

type ProductItem = InventoryProduct & {
  product_categories: { name: string } | null;
};

type ProductCategory = {
  id: string;
  name: string;
  is_active: boolean;
};

const managerRoles = new Set(["gerente", "admin_sistema"]);

export const dynamic = "force-dynamic";

function unitLabel(unit: string) {
  if (unit === "g" || unit === "kg") return "Peso";
  if (unit === "ml" || unit === "l") return "Volumen";
  return "Unidad";
}

function kindLabel(kind?: ItemKind | null) {
  if (kind === "ingredient") return "Ingrediente";
  if (kind === "sale_product") return "Producto para venta";
  if (kind === "supply") return "Insumo";
  return "Sin tipo";
}

function internalCode(id: string) {
  return id.slice(0, 8).toUpperCase();
}

export default async function ProductsPage({ searchParams }: ProductsPageProps) {
  const { q = "", edit = "", item: selectedItemId = "" } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roleNames = roles?.map((role) => role.role) ?? [];
  const canManage = roleNames.some((role) => managerRoles.has(role));
  if (!canManage) {
    notFound();
  }

  const [itemsResult, categoriesResult] = await Promise.all([
    supabase
      .from("inventory_items")
      .select("id, name, unit, item_kind, category_id, is_active, product_categories(name)")
      .is("presentation_quantity", null)
      .order("name"),
    supabase.from("product_categories").select("id, name, is_active").eq("is_active", true).order("name")
  ]);
  const error = itemsResult.error ?? categoriesResult.error;
  const categories = (categoriesResult.data ?? []) as ProductCategory[];
  const items = (itemsResult.data ?? []) as unknown as ProductItem[];
  const normalizedQuery = q.trim().toLowerCase();
  const filteredItems = normalizedQuery
    ? items.filter((product) =>
        [
          internalCode(product.id),
          product.name,
          kindLabel(product.item_kind),
          product.product_categories?.name ?? "",
          unitLabel(product.unit),
          product.is_active ? "Activo" : "Inactivo"
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery)
      )
    : items;
  const suggestions = Array.from(
    new Set(
      items
        .flatMap((product) => [internalCode(product.id), product.name, kindLabel(product.item_kind), product.product_categories?.name ?? ""])
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ).slice(0, 50);
  const editProduct = items.find((product) => product.id === edit) ?? null;
  const selectedProduct = selectedItemId ? items.find((product) => product.id === selectedItemId) ?? null : null;

  return (
    <PanelShell
      active="productos"
      roleNames={roleNames}
      subtitle="Dato maestro para compras, inventario, recetas y venta."
      title="Productos"
      userEmail={user.email ?? "usuario"}
    >
      {error ? <p className="alert">{error.message}</p> : null}
      <section className="form-panel">
        <div className="section-title-row inventory-toolbar-row">
          <h2>Listado de productos</h2>
          <div className="purchase-toolbar">
            <form className="table-filters">
              <input autoComplete="off" defaultValue={q} list="product-search-options" name="q" placeholder="Buscar producto" />
              <datalist id="product-search-options">
                {suggestions.map((suggestion) => (
                  <option key={suggestion} value={suggestion} />
                ))}
              </datalist>
              <button className="ghost-button" type="submit">
                Buscar
              </button>
            </form>
            <ProductModal categories={categories} editProduct={editProduct} key={editProduct?.id ?? "new-product"} />
          </div>
        </div>
        <div className="data-table-wrap">
          <table className="data-table product-table">
            <thead>
              <tr>
                <th>Acciones</th>
                <th>Codigo</th>
                <th>Producto</th>
                <th>Tipo</th>
                <th>Categoria</th>
                <th>Unidad o medida</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((product) => {
                const detailHref =
                  selectedItemId === product.id
                    ? `/panel/productos${q ? `?q=${encodeURIComponent(q)}` : ""}`
                    : `/panel/productos?q=${encodeURIComponent(q)}&item=${product.id}`;
                return (
                  <tr key={product.id}>
                    <td>
                      <span className="row-actions center-actions">
                        <Link className="icon-button" href={`/panel/productos?edit=${product.id}`} title="Editar producto">
                          <Pencil size={16} />
                        </Link>
                        <Link
                          className={`icon-button ${selectedItemId === product.id ? "active-icon-button" : ""}`}
                          href={detailHref}
                          title={selectedItemId === product.id ? "Cerrar detalle" : "Ver detalle"}
                        >
                          <Eye size={16} />
                        </Link>
                      </span>
                    </td>
                    <td>{internalCode(product.id)}</td>
                    <td>
                      <strong>{product.name}</strong>
                    </td>
                    <td>{kindLabel(product.item_kind)}</td>
                    <td>{product.product_categories?.name ?? "Sin categoria"}</td>
                    <td>{unitLabel(product.unit)}</td>
                    <td>
                      <span className={`stock-pill ${product.is_active ? "ok" : "danger"}`}>{product.is_active ? "Activo" : "Inactivo"}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filteredItems.length === 0 ? <p className="muted">No hay productos con ese filtro.</p> : null}
        </div>
      </section>

      {selectedProduct ? (
        <section className="form-panel inventory-detail-panel">
          <div className="section-title-row">
            <div>
              <h2>{selectedProduct.name}</h2>
              <p className="muted">{kindLabel(selectedProduct.item_kind)} - {selectedProduct.product_categories?.name ?? "Sin categoria"}</p>
            </div>
            <div className="detail-header-actions">
              <span className={`stock-pill ${selectedProduct.is_active ? "ok" : "danger"}`}>{selectedProduct.is_active ? "Activo" : "Inactivo"}</span>
              <Link className="icon-button" href={`/panel/productos${q ? `?q=${encodeURIComponent(q)}` : ""}`} title="Cerrar detalle">
                <X size={16} />
              </Link>
            </div>
          </div>
          <div className="data-list">
            <div className="data-row static-row">
              <strong>Codigo</strong>
              <span>{internalCode(selectedProduct.id)}</span>
            </div>
            <div className="data-row static-row">
              <strong>Unidad o tipo de medida</strong>
              <span>{unitLabel(selectedProduct.unit)}</span>
            </div>
            <div className="data-row static-row">
              <strong>Tipo</strong>
              <span>{kindLabel(selectedProduct.item_kind)}</span>
            </div>
          </div>
        </section>
      ) : null}
    </PanelShell>
  );
}
