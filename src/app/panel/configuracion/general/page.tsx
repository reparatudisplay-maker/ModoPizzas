import Link from "next/link";
import { PlatformSettingsModule, type PlatformPaymentSetting } from "@/components/platform-settlements-module";
import { PanelShell } from "@/components/panel-shell";
import { ConfigurationTabs } from "@/components/configuration-tabs";
import { ThemePreferencesModule } from "@/components/theme-preferences-module";
import { requireAdminPanelAccess } from "@/lib/panel-auth";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export default async function GeneralSettingsPage({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const { section } = await searchParams;
  const activeSection = section === "plataformas" ? "platforms" : section === "diseno" ? "design" : "general";
  const supabase = await createServerSupabaseClient();
  const { user, roleNames, moduleKeys } = await requireAdminPanelAccess(supabase);
  const { data, error } = await supabase.from("platform_payment_settings").select("*").order("platform");
  if (error) throw new Error(error.message);
  const settings = (data ?? []).map((setting) => ({
    platform: setting.platform,
    commission_percent: Number(setting.commission_percent ?? 0),
    fixed_fee_cop: Number(setting.fixed_fee_cop ?? 0),
    commission_tax_percent: Number(setting.commission_tax_percent ?? 0),
    settlement_due_days: Number(setting.settlement_due_days ?? 0),
    didi_tu_negocio_commission_percent: Number(setting.didi_tu_negocio_commission_percent ?? 9.5),
    didi_tu_negocio_fixed_fee_cop: Number(setting.didi_tu_negocio_fixed_fee_cop ?? 0),
    didi_tu_negocio_commission_tax_percent: Number(setting.didi_tu_negocio_commission_tax_percent ?? 0),
    didi_tu_negocio_settlement_due_days: Number(setting.didi_tu_negocio_settlement_due_days ?? 7)
  })) as PlatformPaymentSetting[];

  return <PanelShell active="configuracion-general" hideHeader moduleKeys={moduleKeys} roleNames={roleNames} title="Configuración general" userEmail={user.email ?? "usuario"}>
    <ConfigurationTabs active={activeSection} isAdmin>
      {activeSection === "general" ? <section className="form-panel settings-overview"><div className="section-title-row"><div><h1>General</h1><p className="muted">Accesos, datos públicos, plataformas, diseño, cocina e impresión se organizan por secciones.</p></div></div><div className="settings-general-grid"><Link className="settings-general-link" href="/panel/configuracion"><strong>Usuarios y permisos</strong><span>Roles, accesos y usuarios internos.</span></Link><Link className="settings-general-link" href="/panel/configuracion/negocio"><strong>Información pública</strong><span>Datos visibles de Modo Pizzas.</span></Link></div></section> : null}
      {activeSection === "platforms" ? <PlatformSettingsModule settings={settings} /> : null}
      {activeSection === "design" ? <ThemePreferencesModule /> : null}
    </ConfigurationTabs>
  </PanelShell>;
}
