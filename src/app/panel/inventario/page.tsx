import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { registerExpense, registerPurchase, saveInventoryItem, saveSupplier } from "@/app/admin/actions";
import { PanelShell } from "@/components/panel-shell";
import { formatCop, formatNumber } from "@/lib/format";
import { createServerSupabaseClient } from "@/lib/supabase-server";

type InventoryItem = {
  id: string;
  sku: string | null;
  name: string;
  unit: "g" | "kg" | "ml" | "l" | "unit";
  current_quantity: number;
  average_cost_cop: number;
  is_active: boolean;
};

type Supplier = {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
  is_active: boolean;
};

type Purchase = {
  id: string;
  total_cop: number;
  notes: string | null;
  purchased_at: string;
  suppliers: { name: string } | null;
};

type Expense = {
  id: string;
  category: string;
  description: string;
  amount_cop: number;
  paid_at: string;
};

const managerRoles = new Set(["gerente", "admin_sistema"]);
const stockUnits = ["g", "kg", "ml", "l", "unit"];

export const dynamic = "force-dynamic";

function unitLabel(unit: string) {
  if (unit === "unit") return "unidad";
  return unit;
}

function ItemForm({ item }: { item?: InventoryItem }) {
  return (
    <form action={saveInventoryItem} className="compact-card">
      {item ? <input name="id" type="hidden" value={item.id} /> : null}
      <div>
        <h3>{item ? item.name : "Nuevo insumo"}</h3>
        {item ? <span className="badge">{item.is_active ? "Activo" : "Inactivo"}</span> : null}
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Nombre</label>
          <input defaultValue={item?.name} name="name" required />
        </div>
        <div className="field">
          <label>SKU</label>
          <input defaultValue={item?.sku ?? ""} name="sku" />
        </div>
        <div className="field">
          <label>Unidad</label>
          <select defaultValue={item?.unit ?? "unit"} name="unit">
            {stockUnits.map((unit) => (
              <option key={unit} value={unit}>
                {unitLabel(unit)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Cantidad actual</label>
          <input defaultValue={item?.current_quantity ?? 0} min="0" name="current_quantity" step="0.001" type="number" />
        </div>
        <div className="field">
          <label>Costo promedio COP</label>
          <input defaultValue={item?.average_cost_cop ?? 0} min="0" name="average_cost_cop" step="0.01" type="number" />
        </div>
      </div>
      <label className="check-option">
        <input defaultChecked={item?.is_active ?? true} name="is_active" type="checkbox" />
        <span>Activo</span>
      </label>
      <button className="primary-button" type="submit">
        Guardar insumo
      </button>
    </form>
  );
}

function SupplierForm({ supplier }: { supplier?: Supplier }) {
  return (
    <form action={saveSupplier} className="compact-card">
      {supplier ? <input name="id" type="hidden" value={supplier.id} /> : null}
      <div>
        <h3>{supplier ? supplier.name : "Nuevo proveedor"}</h3>
        {supplier ? <span className="badge">{supplier.is_active ? "Activo" : "Inactivo"}</span> : null}
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Nombre</label>
          <input defaultValue={supplier?.name} name="name" required />
        </div>
        <div className="field">
          <label>Telefono</label>
          <input defaultValue={supplier?.phone ?? ""} name="phone" />
        </div>
        <div className="field full">
          <label>Notas</label>
          <input defaultValue={supplier?.notes ?? ""} name="notes" />
        </div>
      </div>
      <label className="check-option">
        <input defaultChecked={supplier?.is_active ?? true} name="is_active" type="checkbox" />
        <span>Activo</span>
      </label>
      <button className="primary-button" type="submit">
        Guardar proveedor
      </button>
    </form>
  );
}

function PurchaseForm({ items, suppliers }: { items: InventoryItem[]; suppliers: Supplier[] }) {
  return (
    <form action={registerPurchase} className="compact-card">
      <div>
        <h3>Registrar compra</h3>
        <span className="badge">Stock</span>
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Insumo</label>
          <select name="inventory_item_id" required>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({unitLabel(item.unit)})
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Proveedor</label>
          <select name="supplier_id">
            <option value="">Sin proveedor</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Cantidad</label>
          <input min="0.001" name="quantity" required step="0.001" type="number" />
        </div>
        <div className="field">
          <label>Costo unitario COP</label>
          <input min="0" name="unit_cost_cop" required step="0.01" type="number" />
        </div>
        <div className="field full">
          <label>Notas</label>
          <input name="notes" placeholder="Factura, observaciones, lote" />
        </div>
      </div>
      <button className="primary-button" disabled={items.length === 0} type="submit">
        Registrar compra
      </button>
    </form>
  );
}

function ExpenseForm() {
  return (
    <form action={registerExpense} className="compact-card">
      <div>
        <h3>Registrar gasto</h3>
        <span className="badge">Caja</span>
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Categoria</label>
          <input name="category" placeholder="arriendo, servicios, aseo" required />
        </div>
        <div className="field">
          <label>Valor COP</label>
          <input min="0" name="amount_cop" required step="0.01" type="number" />
        </div>
        <div className="field full">
          <label>Descripcion</label>
          <input name="description" required />
        </div>
      </div>
      <button className="primary-button" type="submit">
        Registrar gasto
      </button>
    </form>
  );
}

export default async function InventoryPage() {
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

  const [itemsResult, suppliersResult, purchasesResult, expensesResult] = await Promise.all([
    supabase.from("inventory_items").select("*").order("name"),
    supabase.from("suppliers").select("*").order("name"),
    supabase.from("purchases").select("id, total_cop, notes, purchased_at, suppliers(name)").order("purchased_at", { ascending: false }).limit(12),
    supabase.from("expenses").select("id, category, description, amount_cop, paid_at").order("paid_at", { ascending: false }).limit(12)
  ]);

  const items = (itemsResult.data ?? []) as InventoryItem[];
  const suppliers = (suppliersResult.data ?? []) as Supplier[];
  const purchases = (purchasesResult.data ?? []) as unknown as Purchase[];
  const expenses = (expensesResult.data ?? []) as Expense[];
  const stockValue = items.reduce(
    (sum, item) => sum + Number(item.current_quantity ?? 0) * Number(item.average_cost_cop ?? 0),
    0
  );
  const recentPurchases = purchases.reduce((sum, purchase) => sum + Number(purchase.total_cop ?? 0), 0);
  const recentExpenses = expenses.reduce((sum, expense) => sum + Number(expense.amount_cop ?? 0), 0);
  const error = itemsResult.error ?? suppliersResult.error ?? purchasesResult.error ?? expensesResult.error;

  return (
    <PanelShell
      active="inventario"
      roleNames={roleNames}
      subtitle="Registra insumos en gramos, kilos, mililitros, litros o unidades; compras y gastos en COP."
      title="Inventario y contabilidad basica"
      userEmail={user.email ?? "usuario"}
      actions={
        <div className="print-links">
          <Link className="ghost-button" href="/panel/proveedores">
            Proveedores
          </Link>
          <Link className="primary-button" href="/panel/menu">
            Menu
          </Link>
        </div>
      }
    >
      <section className="metrics-grid">
        <div className="metric-card">
          <span>Insumos</span>
          <strong>{items.length}</strong>
        </div>
        <div className="metric-card">
          <span>Valor stock</span>
          <strong>{formatCop(stockValue)}</strong>
        </div>
        <div className="metric-card">
          <span>Compras recientes</span>
          <strong>{formatCop(recentPurchases)}</strong>
        </div>
      </section>

      {error ? <p className="alert">{error.message}</p> : null}

      <section className="admin-grid">
        <PurchaseForm items={items.filter((item) => item.is_active)} suppliers={suppliers.filter((supplier) => supplier.is_active)} />
        <ExpenseForm />
      </section>

      <section className="editor-grid">
        <ItemForm />
        <SupplierForm />
      </section>

      <section className="panel-list inventory-lists">
        <article className="form-panel">
          <h2>Insumos</h2>
          <div className="data-list">
            {items.map((item) => (
              <details className="data-row" key={item.id}>
                <summary>
                  <strong>{item.name}</strong>
                  <span>
                    {formatNumber(Number(item.current_quantity), 3)} {unitLabel(item.unit)} - {formatCop(Number(item.average_cost_cop))}
                  </span>
                </summary>
                <ItemForm item={item} />
              </details>
            ))}
          </div>
        </article>

        <article className="form-panel">
          <h2>Proveedores</h2>
          <div className="data-list">
            {suppliers.map((supplier) => (
              <details className="data-row" key={supplier.id}>
                <summary>
                  <strong>{supplier.name}</strong>
                  <span>{supplier.phone || "Sin telefono"}</span>
                </summary>
                <SupplierForm supplier={supplier} />
              </details>
            ))}
          </div>
        </article>

        <article className="form-panel">
          <h2>Movimientos recientes</h2>
          <div className="data-list">
            {purchases.map((purchase) => (
              <div className="data-row static-row" key={purchase.id}>
                <strong>Compra {formatCop(Number(purchase.total_cop))}</strong>
                <span>
                  {purchase.suppliers?.name ?? "Sin proveedor"} - {new Date(purchase.purchased_at).toLocaleDateString("es-CO")}
                </span>
              </div>
            ))}
            {expenses.map((expense) => (
              <div className="data-row static-row" key={expense.id}>
                <strong>Gasto {formatCop(Number(expense.amount_cop))}</strong>
                <span>
                  {expense.category}: {expense.description} - {new Date(expense.paid_at).toLocaleDateString("es-CO")}
                </span>
              </div>
            ))}
          </div>
          <p className="muted">Gastos recientes: {formatCop(recentExpenses)}</p>
        </article>
      </section>
    </PanelShell>
  );
}
