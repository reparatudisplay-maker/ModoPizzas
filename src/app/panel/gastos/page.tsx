import { notFound, redirect } from "next/navigation";
import { ExpensesModule, type CustodyFundOption, type ExpenseCategoryOption, type ExpenseRow, type SupplierOption } from "@/components/expenses-module";
import { PanelShell } from "@/components/panel-shell";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const expenseRoles = new Set(["gerente", "admin_sistema"]);

type ExpenseRecord = {
  id: string;
  category_id: string;
  description: string;
  amount_cop: number;
  spent_at: string;
  payment_source: string;
  beneficiary_name: string | null;
  document_number: string | null;
  notes: string | null;
  status: string;
  created_by: string | null;
  expense_categories: { name: string } | null;
};

export default async function ExpensesPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roleNames = roles?.map((role) => role.role) ?? [];
  if (!roleNames.some((role) => expenseRoles.has(role))) notFound();

  const [categoriesResult, suppliersResult, fundsResult, expensesResult, sessionsResult] = await Promise.all([
    supabase.from("expense_categories").select("id, name, is_active").order("sort_order", { ascending: true }).order("name"),
    supabase.from("suppliers").select("id, name").eq("is_active", true).order("name"),
    supabase.from("custody_funds").select("id, name, is_active").eq("is_active", true).order("created_at"),
    supabase
      .from("expenses")
      .select("id, category_id, description, amount_cop, spent_at, payment_source, beneficiary_name, document_number, notes, status, created_by, expense_categories(name)")
      .order("spent_at", { ascending: false })
      .limit(120),
    supabase.from("cash_sessions").select("id").eq("status", "open").limit(1)
  ]);

  const error = categoriesResult.error ?? suppliersResult.error ?? fundsResult.error ?? expensesResult.error ?? sessionsResult.error;
  if (error) throw new Error(error.message);

  const rawExpenses = (expensesResult.data ?? []) as unknown as ExpenseRecord[];
  const userIds = rawExpenses.map((expense) => expense.created_by).filter((id): id is string => Boolean(id));
  const { data: profiles } = userIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", userIds)
    : { data: [] as Array<{ id: string; full_name: string | null; email: string | null }> };
  const profilesById = new Map((profiles ?? []).map((profile) => [profile.id, profile.full_name || profile.email || "Usuario"]));

  const funds = await Promise.all(
    (fundsResult.data ?? []).map(async (fund) => {
      const { data } = await supabase.rpc("custody_fund_balance", { p_custody_fund_id: fund.id });
      return { id: fund.id, name: fund.name, balance_cop: Number(data ?? 0) };
    })
  );

  const expenses = rawExpenses.map((expense) => ({
    id: expense.id,
    category_id: expense.category_id,
    category_name: expense.expense_categories?.name ?? "Sin categoria",
    description: expense.description,
    amount_cop: Number(expense.amount_cop ?? 0),
    spent_at: expense.spent_at,
    payment_source: expense.payment_source,
    beneficiary_name: expense.beneficiary_name,
    document_number: expense.document_number,
    notes: expense.notes,
    status: expense.status,
    created_by_name: expense.created_by ? profilesById.get(expense.created_by) ?? "Usuario" : "Sistema"
  })) satisfies ExpenseRow[];

  return (
    <PanelShell active="gastos" hideHeader roleNames={roleNames} title="Gastos" userEmail={user.email ?? "usuario"}>
      <ExpensesModule
        categories={(categoriesResult.data ?? []) as ExpenseCategoryOption[]}
        custodyFunds={funds satisfies CustodyFundOption[]}
        expenses={expenses}
        hasOpenCashSession={(sessionsResult.data ?? []).length > 0}
        suppliers={(suppliersResult.data ?? []) as SupplierOption[]}
      />
    </PanelShell>
  );
}
