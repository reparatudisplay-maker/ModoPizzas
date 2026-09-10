import { redirect } from "next/navigation";
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
  const initialModule = moduleKeys.includes("pedidos")
    ? systemModules.find((module) => module.key === "pedidos")
    : systemModules.find((module) => module.active && moduleKeys.includes(module.key));

  if (!initialModule) {
    return (
      <main className="auth-page">
        <section className="auth-shell">
          <div className="empty-state">
            <h1>No tienes modulos asignados.</h1>
            <p>Contacta al administrador.</p>
          </div>
        </section>
      </main>
    );
  }

  redirect(initialModule.route);
}
