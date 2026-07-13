import { notFound, redirect } from "next/navigation";
import { registerExpense } from "@/app/admin/actions";
import { PanelShell } from "@/components/panel-shell";
import { formatCop } from "@/lib/format";
import { createServerSupabaseClient } from "@/lib/supabase-server";

type Expense = {
  id: string;
  category: string;
  description: string;
  amount_cop: number;
  paid_at: string;
};

const managerRoles = new Set(["gerente", "admin_sistema"]);

export const dynamic = "force-dynamic";

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

export default async function ExpensesPage() {
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

  const { data, error } = await supabase
    .from("expenses")
    .select("id, category, description, amount_cop, paid_at")
    .order("paid_at", { ascending: false })
    .limit(40);
  const expenses = (data ?? []) as Expense[];
  const total = expenses.reduce((sum, expense) => sum + Number(expense.amount_cop ?? 0), 0);

  return (
    <PanelShell
      active="gastos"
      roleNames={roleNames}
      subtitle="Registra gastos no asociados directamente a compras de inventario."
      title="Gastos"
      userEmail={user.email ?? "usuario"}
    >
      {error ? <p className="alert">{error.message}</p> : null}
      <section className="metrics-grid">
        <div className="metric-card">
          <span>Gastos listados</span>
          <strong>{expenses.length}</strong>
        </div>
        <div className="metric-card">
          <span>Total reciente</span>
          <strong>{formatCop(total)}</strong>
        </div>
      </section>
      <section className="admin-grid">
        <ExpenseForm />
        <article className="form-panel">
          <h2>Ejemplos</h2>
          <p className="muted">Arriendo, servicios publicos, detergentes, empaques no inventariados, impuestos y gastos varios.</p>
        </article>
      </section>
      <section className="form-panel">
        <h2>Gastos recientes</h2>
        <div className="data-list">
          {expenses.map((expense) => (
            <div className="data-row static-row" key={expense.id}>
              <strong>{formatCop(Number(expense.amount_cop))}</strong>
              <span>
                {expense.category}: {expense.description} - {new Date(expense.paid_at).toLocaleDateString("es-CO")}
              </span>
            </div>
          ))}
        </div>
      </section>
    </PanelShell>
  );
}
