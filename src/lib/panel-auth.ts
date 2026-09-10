import { notFound, redirect } from "next/navigation";
import type { createServerSupabaseClient } from "@/lib/supabase-server";
import type { SystemModuleKey } from "@/lib/system-modules";
import { fallbackModuleAccessForRoles } from "@/lib/system-modules";

type SupabaseServerClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

export type PanelAccessContext = {
  user: NonNullable<Awaited<ReturnType<SupabaseServerClient["auth"]["getUser"]>>["data"]["user"]>;
  roleNames: string[];
  moduleKeys: SystemModuleKey[];
};

function cleanModuleKeys(values: unknown): SystemModuleKey[] {
  return Array.isArray(values) ? (values.filter((value) => typeof value === "string") as SystemModuleKey[]) : [];
}

export async function requirePanelAccess(supabase: SupabaseServerClient, moduleKey: SystemModuleKey): Promise<PanelAccessContext> {
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const [{ data: roles }, moduleKeysResult, moduleAccessResult] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", user.id),
    supabase.rpc("current_user_module_keys"),
    supabase.rpc("current_user_can_access_module", { p_module_key: moduleKey })
  ]);

  const roleNames = roles?.map((roleRow) => roleRow.role) ?? [];
  const moduleKeys = moduleKeysResult.error ? fallbackModuleAccessForRoles(roleNames) : cleanModuleKeys(moduleKeysResult.data);
  const isAdmin = roleNames.includes("admin_sistema");
  const canAccessModule = moduleAccessResult.error ? fallbackModuleAccessForRoles(roleNames).includes(moduleKey) : Boolean(moduleAccessResult.data);

  if (!isAdmin && !canAccessModule) notFound();

  return { user, roleNames, moduleKeys };
}

export async function requireAdminPanelAccess(supabase: SupabaseServerClient): Promise<PanelAccessContext> {
  const access = await requirePanelAccess(supabase, "configuracion");
  if (!access.roleNames.includes("admin_sistema")) notFound();
  return access;
}
