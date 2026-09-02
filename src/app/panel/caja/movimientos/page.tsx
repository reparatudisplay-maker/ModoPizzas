import { notFound, redirect } from "next/navigation";
import { CashMovementsModule } from "@/components/cash-module";
import { PanelShell } from "@/components/panel-shell";
import { loadCashMovements } from "@/lib/cash-data";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const cashRoles = new Set(["vendedor", "gerente", "admin_sistema"]);

export default async function CashMovementsPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roleNames = roles?.map((role) => role.role) ?? [];
  if (!roleNames.some((role) => cashRoles.has(role))) notFound();

  const { data: openSession, error } = await supabase.from("cash_sessions").select("id").eq("status", "open").order("opened_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  const movements = openSession ? await loadCashMovements(supabase, openSession.id) : [];

  return (
    <PanelShell active="caja-movimientos" hideHeader roleNames={roleNames} title="Movimientos de caja" userEmail={user.email ?? "usuario"}>
      <CashMovementsModule movements={movements} />
    </PanelShell>
  );
}
