import { PublicBusinessSettings, type PublicBusinessSettingsData } from "@/components/public-business-settings";
import { PanelShell } from "@/components/panel-shell";
import { requireAdminPanelAccess } from "@/lib/panel-auth";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export default async function PublicBusinessSettingsPage() {
  const supabase = await createServerSupabaseClient();
  const { user, roleNames, moduleKeys } = await requireAdminPanelAccess(supabase);
  const { data, error } = await supabase
    .from("site_settings")
    .select("business_name, whatsapp_number, public_phone, public_address, public_neighborhood, public_city, public_weekday_hours, public_weekend_hours, public_opening_hours, public_maps_url, public_info_text, public_instagram_url, public_facebook_url")
    .eq("id", true)
    .single();

  if (error) throw new Error(error.message);
  return (
    <PanelShell active="configuracion-negocio" moduleKeys={moduleKeys} roleNames={roleNames} title="Informacion publica" userEmail={user.email ?? "usuario"}>
      <PublicBusinessSettings settings={data as PublicBusinessSettingsData} />
    </PanelShell>
  );
}
