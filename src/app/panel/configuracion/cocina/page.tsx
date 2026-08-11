import { notFound, redirect } from "next/navigation";
import { KitchenSettingsModule, type KitchenSettingsFormData, type KitchenSizeSettingsFormData } from "@/components/kitchen-settings-module";
import { PanelShell } from "@/components/panel-shell";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const managerRoles = new Set(["gerente", "admin_sistema"]);

type KitchenSettingsRow = {
  oven_count: number | null;
  oven_width_cm: number | null;
  oven_depth_cm: number | null;
  sound_enabled_default: boolean | null;
  warning_threshold_minutes: number | null;
  delay_threshold_minutes: number | null;
};

type PizzaSizeRow = {
  id: string;
  name: string;
  diameter_cm: number | null;
  sort_order: number | null;
};

type KitchenSizeSettingRow = {
  pizza_size_id: string;
  simultaneous_capacity: number | null;
  assembly_minutes: number | null;
  baking_minutes: number | null;
  finishing_minutes: number | null;
};

function suggestedCapacity(diameterCm: number | null, widthCm: number, depthCm: number) {
  if (!diameterCm || diameterCm <= 0) return 1;
  return Math.max(1, Math.floor(widthCm / diameterCm) * Math.floor(depthCm / diameterCm));
}

export default async function KitchenSettingsPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roleNames = roles?.map((roleRow) => roleRow.role) ?? [];
  if (!roleNames.some((role) => managerRoles.has(role))) notFound();

  const [settingsResult, sizesResult, sizeSettingsResult] = await Promise.all([
    supabase.from("kitchen_settings").select("oven_count, oven_width_cm, oven_depth_cm, sound_enabled_default, warning_threshold_minutes, delay_threshold_minutes").eq("id", true).maybeSingle(),
    supabase.from("pizza_sizes").select("id, name, diameter_cm, sort_order").order("sort_order").order("diameter_cm"),
    supabase.from("kitchen_size_settings").select("pizza_size_id, simultaneous_capacity, assembly_minutes, baking_minutes, finishing_minutes")
  ]);

  const settingsRow = settingsResult.data as KitchenSettingsRow | null;
  const settings: KitchenSettingsFormData = {
    oven_count: Number(settingsRow?.oven_count ?? 1),
    oven_width_cm: Number(settingsRow?.oven_width_cm ?? 130),
    oven_depth_cm: Number(settingsRow?.oven_depth_cm ?? 50),
    sound_enabled_default: settingsRow?.sound_enabled_default ?? true,
    warning_threshold_minutes: Number(settingsRow?.warning_threshold_minutes ?? 12),
    delay_threshold_minutes: Number(settingsRow?.delay_threshold_minutes ?? 20)
  };
  const sizeSettingsById = new Map(
    ((sizeSettingsResult.data ?? []) as KitchenSizeSettingRow[]).map((item) => [item.pizza_size_id, item])
  );
  const sizes: KitchenSizeSettingsFormData[] = ((sizesResult.data ?? []) as PizzaSizeRow[]).map((size) => {
    const configured = sizeSettingsById.get(size.id);
    return {
      pizza_size_id: size.id,
      name: size.name,
      diameter_cm: size.diameter_cm === null ? null : Number(size.diameter_cm),
      simultaneous_capacity: Number(configured?.simultaneous_capacity ?? suggestedCapacity(size.diameter_cm === null ? null : Number(size.diameter_cm), settings.oven_width_cm, settings.oven_depth_cm)),
      assembly_minutes: Number(configured?.assembly_minutes ?? 2),
      baking_minutes: Number(configured?.baking_minutes ?? 8),
      finishing_minutes: Number(configured?.finishing_minutes ?? 1)
    };
  });
  const error = settingsResult.error ?? sizesResult.error ?? sizeSettingsResult.error;

  return (
    <PanelShell active="configuracion-cocina" hideHeader roleNames={roleNames} title="Configuracion de cocina" userEmail={user.email ?? "usuario"}>
      {error ? <p className="alert">{error.message}</p> : null}
      <KitchenSettingsModule settings={settings} sizes={sizes} />
    </PanelShell>
  );
}
