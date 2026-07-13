import Link from "next/link";
import { notFound, redirect } from "next/navigation";
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
  const canCreateOrders = roles?.some((item) => creatorRoles.has(item.role)) ?? false;

  if (!canCreateOrders) {
    notFound();
  }

  const catalog = await getPublicCatalog();

  return (
    <main>
      <div className="panel-shortcut">
        <Link className="ghost-button" href="/panel">
          Volver al panel
        </Link>
      </div>
      <PublicOrderingApp catalog={catalog} mode="staff" />
    </main>
  );
}
