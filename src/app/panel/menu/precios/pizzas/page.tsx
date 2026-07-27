import { notFound, redirect } from "next/navigation";
import { PanelShell } from "@/components/panel-shell";
import { createServerSupabaseClient } from "@/lib/supabase-server";

const managerRoles = new Set(["gerente", "admin_sistema"]);

export const dynamic = "force-dynamic";

export default async function MenuPreciosPizzasPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roleNames = roles?.map((item) => item.role) ?? [];
  if (!roleNames.some((role) => managerRoles.has(role))) notFound();

  return (
    <PanelShell active="menu-precios-pizzas" hideHeader roleNames={roleNames} title="Precios de pizzas" userEmail={user.email ?? "usuario"}>
      <section className="form-panel">
        <div className="section-title-row inventory-toolbar-row">
          <h2>Precios de pizzas</h2>
        </div>
        <p className="muted">Pendiente: recetas y precios por sabor y tamano.</p>
      </section>
    </PanelShell>
  );
}
