import { notFound, redirect } from "next/navigation";
import { assignUserRole, removeUserRole, updateSiteSettings } from "@/app/admin/actions";
import { PanelShell } from "@/components/panel-shell";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getCurrentPanelUser, managerRoles } from "@/lib/panel-orders";

const assignableRoles = ["cliente", "vendedor", "mesero", "cocina", "mensajero", "gerente", "admin_sistema"];

export const dynamic = "force-dynamic";

export default async function SettingsPanelPage() {
  const { user, roleNames } = await getCurrentPanelUser();

  if (!user) {
    redirect("/login");
  }

  const isManager = roleNames.some((role) => managerRoles.has(role));
  const isAdmin = roleNames.includes("admin_sistema");
  if (!isManager) {
    notFound();
  }

  const supabase = await createServerSupabaseClient();
  const [{ data: settings }, { data: profiles }] = await Promise.all([
    supabase.from("site_settings").select("business_name, whatsapp_number, whatsapp_enabled, whatsapp_button_text").single(),
    isAdmin
      ? supabase
          .from("profiles")
          .select("id, full_name, phone, user_roles(role)")
          .order("created_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: null })
  ]);

  return (
    <PanelShell
      active="configuracion"
      roleNames={roleNames}
      subtitle="Ajustes publicos, WhatsApp y roles de empleados."
      title="Configuracion"
      userEmail={user.email ?? "usuario"}
    >
      {settings ? (
        <section className="admin-grid">
          <form action={updateSiteSettings} className="form-panel">
            <h2>Ajustes publicos</h2>
            <div className="field">
              <label htmlFor="business_name">Nombre del negocio</label>
              <input defaultValue={settings.business_name} id="business_name" name="business_name" />
            </div>
            <div className="field">
              <label htmlFor="whatsapp_number">WhatsApp</label>
              <input defaultValue={settings.whatsapp_number} id="whatsapp_number" name="whatsapp_number" />
            </div>
            <div className="field">
              <label htmlFor="whatsapp_button_text">Texto del boton</label>
              <input defaultValue={settings.whatsapp_button_text} id="whatsapp_button_text" name="whatsapp_button_text" />
            </div>
            <label className="check-option">
              <input defaultChecked={settings.whatsapp_enabled} name="whatsapp_enabled" type="checkbox" />
              <span>WhatsApp activo</span>
            </label>
            <button className="primary-button" type="submit">
              Guardar ajustes
            </button>
          </form>

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
          ) : null}
        </section>
      ) : null}
    </PanelShell>
  );
}
