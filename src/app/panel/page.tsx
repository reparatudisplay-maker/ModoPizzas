import { notFound, redirect } from "next/navigation";
import { fallbackModuleAccessForRoles, systemModules, type SystemModuleKey } from "@/lib/system-modules";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export default async function PanelPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [{ data: roles }, moduleKeysResult] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", user.id),
    supabase.rpc("current_user_module_keys")
  ]);
  const roleNames = roles?.map((item) => item.role) ?? [];
  const moduleKeys = moduleKeysResult.error
    ? fallbackModuleAccessForRoles(roleNames)
    : ((moduleKeysResult.data ?? []) as SystemModuleKey[]);
  const firstModule = systemModules.find((module) => module.active && moduleKeys.includes(module.key));
  if (!firstModule) notFound();
  redirect(firstModule.route);
}
