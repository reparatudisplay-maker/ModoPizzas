import { notFound, redirect } from "next/navigation";
import { ExpenseCategoriesModule, type ExpenseCategoryRow } from "@/components/expense-categories-module";
import { PanelShell } from "@/components/panel-shell";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const expenseRoles = new Set(["gerente", "admin_sistema"]);

type PageProps = {
  searchParams: Promise<{ q?: string; status?: string }>;
};

export default async function ExpenseCategoriesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roleNames = roles?.map((role) => role.role) ?? [];
  if (!roleNames.some((role) => expenseRoles.has(role))) notFound();

  let query = supabase.from("expense_categories").select("id, name, description, sort_order, is_active").order("sort_order", { ascending: true }).order("name");
  if (params.status === "active") query = query.eq("is_active", true);
  if (params.status === "inactive") query = query.eq("is_active", false);
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const q = params.q?.trim() ?? "";
  const categories = ((data ?? []) as ExpenseCategoryRow[]).filter((category) => (q ? category.name.toLowerCase().includes(q.toLowerCase()) : true));

  return (
    <PanelShell active="gastos-categorias" hideHeader roleNames={roleNames} title="Categorias de gasto" userEmail={user.email ?? "usuario"}>
      <ExpenseCategoriesModule allCategories={(data ?? []) as ExpenseCategoryRow[]} categories={categories} q={q} status={params.status ?? ""} />
    </PanelShell>
  );
}
