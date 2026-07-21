import { notFound, redirect } from "next/navigation";
import { assignUserRole, removeUserRole } from "@/app/admin/actions";
import { ConservationProfilesModule, type ConservationProfile } from "@/components/conservation-profiles-module";
import { PanelShell } from "@/components/panel-shell";
import { createServerSupabaseClient } from "@/lib/supabase-server";

const managerRoles = new Set(["gerente", "admin_sistema"]);
const assignableRoles = ["vendedor", "gerente", "admin_sistema"];

export const dynamic = "force-dynamic";

export default async function SettingsPanelPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roleNames = roles?.map((roleRow) => roleRow.role) ?? [];
  const isManager = roleNames.some((role) => managerRoles.has(role));
  const isAdmin = roleNames.includes("admin_sistema");

  if (!isManager) {
    notFound();
  }

  const { data: profiles } = isAdmin
    ? await supabase
        .from("profiles")
        .select("id, full_name, phone, user_roles(role)")
        .order("created_at", { ascending: false })
        .limit(50)
    : { data: null };
  const [conservationProfilesResult, allConservationProfilesResult] = await Promise.all([
    supabase
      .from("conservation_profiles")
      .select("id, name, description, is_active, created_at, conservation_profile_rules(id, storage_method, duration_value, duration_unit, notes)")
      .order("created_at", { ascending: false }),
    supabase.from("conservation_profiles").select("id, name, is_active").order("name")
  ]);
  const conservationProfiles = (conservationProfilesResult.data ?? []) as unknown as ConservationProfile[];
  const allConservationProfiles = (allConservationProfilesResult.data ?? []) as Pick<ConservationProfile, "id" | "name" | "is_active">[];
  const conservationError = conservationProfilesResult.error ?? allConservationProfilesResult.error;

  return (
    <PanelShell active="configuracion" hideHeader roleNames={roleNames} title="Configuracion" userEmail={user.email ?? "usuario"}>
      <section className="module-stack">
        <div className="section-title-row">
          <h1>Configuracion</h1>
        </div>
        {conservationError ? <p className="alert">{conservationError.message}</p> : null}
        <ConservationProfilesModule allProfiles={allConservationProfiles} profiles={conservationProfiles} />

        {isAdmin ? (
          <section className="form-panel">
            <h2>Roles de usuarios</h2>
            <div className="role-list">
              {profiles?.map((profile) => {
                const profileRoles = profile.user_roles?.map((roleRow) => roleRow.role) ?? [];
                return (
                  <article className="role-row" key={profile.id}>
                    <div>
                      <strong>{profile.full_name || "Sin nombre"}</strong>
                      <small>{profile.phone || profile.id}</small>
                      <span className="muted">{profileRoles.length ? profileRoles.join(", ") : "sin rol"}</span>
                    </div>
                    <form action={assignUserRole} className="status-form">
                      <input name="user_id" type="hidden" value={profile.id} />
                      <select name="role">
                        {assignableRoles.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                      <button className="primary-button" type="submit">
                        Asignar
                      </button>
                    </form>
                    {profileRoles.map((role) => (
                      <form action={removeUserRole} className="inline-form" key={role}>
                        <input name="user_id" type="hidden" value={profile.id} />
                        <input name="role" type="hidden" value={role} />
                        <button className="ghost-button" type="submit">
                          Quitar {role}
                        </button>
                      </form>
                    ))}
                  </article>
                );
              })}
            </div>
          </section>
        ) : (
          <section className="form-panel">
            <h2>Acceso limitado</h2>
            <p className="muted">Solo el administrador del sistema puede cambiar roles.</p>
          </section>
        )}
      </section>
    </PanelShell>
  );
}
