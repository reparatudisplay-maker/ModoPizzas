import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PanelShell } from "@/components/panel-shell";
import { PublicOrderingApp } from "@/components/public-ordering-app";
import { getPublicCatalog } from "@/lib/public-catalog";
import { createServerSupabaseClient } from "@/lib/supabase-server";

const creatorRoles = new Set(["vendedor", "mesero", "gerente", "admin_sistema"]);

export const dynamic = "force-dynamic";

export default async function NewPanelOrderPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roleNames = roles?.map((item) => item.role) ?? [];
  const canCreateOrders = roleNames.some((role) => creatorRoles.has(role));

  if (!canCreateOrders) {
    notFound();
  }

  const catalog = await getPublicCatalog();

  return (
    <PanelShell
      active="pedidos"
      roleNames={roleNames}
      subtitle="Crea pedidos internos para caja, local, recoger o domicilio."
      title="Nuevo pedido"
      userEmail={user.email ?? "usuario"}
      actions={
        <Link className="ghost-button" href="/panel">
          Pedidos
        </Link>
      }
    >
      <PublicOrderingApp catalog={catalog} mode="staff" />
    </PanelShell>
  );
}
