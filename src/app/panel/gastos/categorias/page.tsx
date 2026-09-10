import { ExpenseCategoriesModule, type ExpenseCategoryRow } from "@/components/expense-categories-module";
import { PanelShell } from "@/components/panel-shell";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePanelAccess } from "@/lib/panel-auth";

export const dynamic = "force-dynamic";


type PageProps = {
  searchParams: Promise<{ q?: string; status?: string }>;
};

export default async function ExpenseCategoriesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const supabase = await createServerSupabaseClient();
  const { user, roleNames, moduleKeys } = await requirePanelAccess(supabase, "gastos");

  let query = supabase.from("expense_categories").select("id, name, description, sort_order, is_active").order("sort_order", { ascending: true }).order("name");
  if (params.status === "active") query = query.eq("is_active", true);
  if (params.status === "inactive") query = query.eq("is_active", false);
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const q = params.q?.trim() ?? "";
  const categories = ((data ?? []) as ExpenseCategoryRow[]).filter((category) => (q ? category.name.toLowerCase().includes(q.toLowerCase()) : true));

  return (
    <PanelShell active="gastos-categorias" hideHeader moduleKeys={moduleKeys} roleNames={roleNames} title="Categorias de gasto" userEmail={user.email ?? "usuario"}>
      <ExpenseCategoriesModule allCategories={(data ?? []) as ExpenseCategoryRow[]} categories={categories} q={q} status={params.status ?? ""} />
    </PanelShell>
  );
}
