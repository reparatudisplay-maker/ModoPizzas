import { MenuFamilyWorkspace, type MenuFamilyRecord } from "@/components/menu-family-workspace";
import { PanelShell } from "@/components/panel-shell";
import { requirePanelAccess } from "@/lib/panel-auth";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

function isMissingFamiliesSchema(message: string) {
  return /menu_families|schema cache|does not exist/i.test(message);
}

export default async function MenuFamiliesPage() {
  const supabase = await createServerSupabaseClient();
  const { user, roleNames, moduleKeys } = await requirePanelAccess(supabase, "menu");
  const result = await supabase
    .from("menu_families")
    .select("id, name, slug, description, is_active")
    .order("sort_order")
    .order("name");
  const migrationReady = !result.error;
  const error = result.error && !isMissingFamiliesSchema(result.error.message) ? result.error.message : null;

  return (
    <PanelShell active="menu-familias" hideHeader moduleKeys={moduleKeys} roleNames={roleNames} title="Familias de menú" userEmail={user.email ?? "usuario"}>
      {error ? <p className="alert">{error}</p> : null}
      <MenuFamilyWorkspace families={(result.data ?? []) as MenuFamilyRecord[]} migrationReady={migrationReady} />
    </PanelShell>
  );
}
