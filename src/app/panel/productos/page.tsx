import Link from "next/link";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { Eye, Pencil, X } from "lucide-react";
import { PanelShell } from "@/components/panel-shell";
import { ProductDeleteButton, ProductModal, type InventoryProduct, type ItemKind } from "@/components/product-form";
import { createServerSupabaseClient } from "@/lib/supabase-server";

type ProductsPageProps = {
  searchParams: Promise<{ q?: string; edit?: string; item?: string; limit?: string; brand?: string; category?: string; kind?: string }>;
};

type ProductItem = InventoryProduct & {
  product_categories: { name: string } | null;
  brand_name?: string | null;
  created_at: string;
};

type ProductCategory = {
  id: string;
  name: string;
  is_active: boolean;
};

type Brand = {
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

function purchaseModeLabel(mode?: string | null) {
  return mode === "packages" ? "Unidad o Paquetes" : "Peso total";
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

function isDirectImageUrl(value: string) {
  return value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:");
}

export default async function ProductsPage({ searchParams }: ProductsPageProps) {
  const { q = "", edit = "", item: selectedItemId = "", limit = "15", brand = "", category = "", kind = "" } = await searchParams;
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

  let itemsQuery = supabase
    .from("inventory_items")
    .select("id, name, image_url, unit, item_kind, purchase_mode, brand_id, category_id, is_active, created_at, product_categories(name)")
    .is("presentation_quantity", null)
    .order("created_at", { ascending: false });

  if (brand) {
    itemsQuery = itemsQuery.eq("brand_id", brand);
  }
  if (category) {
    itemsQuery = itemsQuery.eq("category_id", category);
  }
  if (kind === "ingredient" || kind === "sale_product" || kind === "supply") {
    itemsQuery = itemsQuery.eq("item_kind", kind);
  }
  if (limit !== "all") {
    itemsQuery = itemsQuery.limit(limit === "30" ? 30 : 15);
  }

  const [itemsResult, categoriesResult, brandsResult] = await Promise.all([
    itemsQuery,
    supabase.from("product_categories").select("id, name, is_active").eq("is_active", true).order("name"),
    supabase.from("brands").select("id, name, is_active").eq("is_active", true).order("name")
  ]);
  const error = itemsResult.error ?? categoriesResult.error ?? brandsResult.error;
  const categories = (categoriesResult.data ?? []) as ProductCategory[];
  const brands = (brandsResult.data ?? []) as Brand[];
  const brandById = new Map(brands.map((brand) => [brand.id, brand.name]));
  const baseItems = ((itemsResult.data ?? []) as unknown as ProductItem[]).map((item) => ({
    ...item,
    brand_name: item.brand_id ? brandById.get(item.brand_id) ?? null : null
  }));
  const signedImageEntries = await Promise.all(
    baseItems.map(async (item) => {
      if (!item.image_url || isDirectImageUrl(item.image_url)) {
        return [item.id, item.image_url] as const;
      }

      const { data } = await supabase.storage.from("product-images").createSignedUrl(item.image_url, 60 * 60);
      return [item.id, data?.signedUrl ?? null] as const;
    })
  );
  const imageSrcById = new Map(signedImageEntries);
  const items = baseItems.map((item) => ({
    ...item,
    image_src: imageSrcById.get(item.id) ?? null
  }));
  const normalizedQuery = q.trim().toLowerCase();
  const filteredItems = normalizedQuery
    ? items.filter((product) =>
        [
          internalCode(product.id),
          product.name,
          kindLabel(product.item_kind),
          product.product_categories?.name ?? "",
          product.brand_name ?? "",
          unitLabel(product.unit),
          purchaseModeLabel(product.purchase_mode),
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
        .flatMap((product) => [internalCode(product.id), product.name, kindLabel(product.item_kind), product.product_categories?.name ?? "", product.brand_name ?? ""])
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ).slice(0, 50);
  const editProduct = items.find((product) => product.id === edit) ?? null;
  const selectedProduct = selectedItemId ? items.find((product) => product.id === selectedItemId) ?? null : null;
  const baseParams = { q, limit, brand, category, kind };
  const productHref = (extra: Record<string, string>) => {
    const params = new URLSearchParams();
    Object.entries({ ...baseParams, ...extra }).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    const query = params.toString();
    return `/panel/productos${query ? `?${query}` : ""}`;
  };

  return (
    <PanelShell
      active="productos"
      hideHeader
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
              <select defaultValue={limit} name="limit" title="Cantidad de registros">
                <option value="15">Ultimos 15</option>
                <option value="30">Ultimos 30</option>
                <option value="all">Todos</option>
              </select>
              <select defaultValue={brand} name="brand" title="Marca">
                <option value="">Todas las marcas</option>
                {brands.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <select defaultValue={category} name="category" title="Categoria">
                <option value="">Todas las categorias</option>
                {categories.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <select defaultValue={kind} name="kind" title="Tipo de producto">
                <option value="">Todos los tipos</option>
                <option value="ingredient">Ingrediente</option>
                <option value="sale_product">Producto para venta</option>
                <option value="supply">Insumo</option>
              </select>
              <datalist id="product-search-options">
                {suggestions.map((suggestion) => (
                  <option key={suggestion} value={suggestion} />
                ))}
              </datalist>
              <button className="ghost-button" type="submit">
                Buscar
              </button>
            </form>
            <ProductModal
              brands={brands}
              categories={categories}
              editProduct={editProduct}
              key={editProduct?.id ?? "new-product"}
              products={items}
              returnHref={productHref({})}
            />
          </div>
        </div>
        <div className="data-table-wrap">
          <table className="data-table product-table">
            <thead>
              <tr>
                <th>Acciones</th>
                <th>Producto</th>
                <th>Foto</th>
                <th>Tipo</th>
                <th>Marca</th>
                <th>Categoria</th>
                <th>Unidad o medida</th>
                <th>Forma compra</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((product) => {
                const detailHref =
                  selectedItemId === product.id
                    ? productHref({})
                    : productHref({ item: product.id });
                return (
                  <tr key={product.id}>
                    <td>
                      <span className="row-actions center-actions">
                        <Link className="icon-button" href={productHref({ edit: product.id })} title="Editar producto">
                          <Pencil size={16} />
                        </Link>
                        <Link
                          className={`icon-button ${selectedItemId === product.id ? "active-icon-button" : ""}`}
                          href={detailHref}
                          title={selectedItemId === product.id ? "Cerrar detalle" : "Ver detalle"}
                        >
                          <Eye size={16} />
                        </Link>
                        <ProductDeleteButton id={product.id} name={product.name} />
                      </span>
                    </td>
                    <td>
                      <strong>{product.name}</strong>
                    </td>
                    <td>
                      {product.image_src ? (
                        <Image alt={product.name} className="product-table-photo" height={44} src={product.image_src} unoptimized width={58} />
                      ) : (
                        <span className="product-photo-placeholder">Sin foto</span>
                      )}
                    </td>
                    <td>{kindLabel(product.item_kind)}</td>
                    <td>{product.brand_name ?? "Sin marca"}</td>
                    <td>{product.product_categories?.name ?? "Sin categoria"}</td>
                    <td>{unitLabel(product.unit)}</td>
                    <td>{purchaseModeLabel(product.purchase_mode)}</td>
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
              <Link className="icon-button" href={productHref({})} title="Cerrar detalle">
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
            <div className="data-row static-row">
              <strong>Marca</strong>
              <span>{selectedProduct.brand_name ?? "Sin marca"}</span>
            </div>
            <div className="data-row static-row">
              <strong>Forma de compra</strong>
              <span>{purchaseModeLabel(selectedProduct.purchase_mode)}</span>
            </div>
          </div>
        </section>
      ) : null}
    </PanelShell>
  );
}
