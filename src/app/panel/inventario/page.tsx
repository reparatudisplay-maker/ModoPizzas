import Link from "next/link";
import { notFound, redirect } from "next/navigation";
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

type Purchase = {
  id: string;
  total_cop: number;
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

export const dynamic = "force-dynamic";

function unitLabel(unit: string) {
  if (unit === "unit") return "unidad";
  return unit;
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
    supabase.from("suppliers").select("id").eq("is_active", true),
    supabase.from("purchases").select("id, total_cop, purchased_at, suppliers(name)").order("purchased_at", { ascending: false }).limit(10),
    supabase.from("expenses").select("id, category, description, amount_cop, paid_at").order("paid_at", { ascending: false }).limit(10)
  ]);

  const items = (itemsResult.data ?? []) as InventoryItem[];
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
      subtitle="Resumen de inventario, compras y gastos. Los registros se hacen en modulos separados."
      title="Inventario"
      userEmail={user.email ?? "usuario"}
    >
      <section className="quick-lanes" aria-label="Modulos de inventario">
        <Link href="/panel/insumos">Insumos</Link>
        <Link href="/panel/compras">Compras</Link>
        <Link href="/panel/gastos">Gastos</Link>
        <Link href="/panel/proveedores">Proveedores</Link>
      </section>

      <section className="metrics-grid">
        <div className="metric-card">
          <span>Insumos</span>
          <strong>{items.length}</strong>
        </div>
        <div className="metric-card">
          <span>Proveedores activos</span>
          <strong>{suppliersResult.data?.length ?? 0}</strong>
        </div>
        <div className="metric-card">
          <span>Valor stock</span>
          <strong>{formatCop(stockValue)}</strong>
        </div>
        <div className="metric-card">
          <span>Compras recientes</span>
          <strong>{formatCop(recentPurchases)}</strong>
        </div>
        <div className="metric-card">
          <span>Gastos recientes</span>
          <strong>{formatCop(recentExpenses)}</strong>
        </div>
      </section>

      {error ? <p className="alert">{error.message}</p> : null}

      <section className="panel-list inventory-lists">
        <article className="form-panel">
          <h2>Existencias</h2>
          <div className="data-list">
            {items.map((item) => (
              <div className="data-row static-row" key={item.id}>
                <strong>{item.name}</strong>
                <span>
                  {formatNumber(Number(item.current_quantity), 3)} {unitLabel(item.unit)} - {formatCop(Number(item.average_cost_cop))}
                </span>
              </div>
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
        </article>
      </section>
    </PanelShell>
  );
}
