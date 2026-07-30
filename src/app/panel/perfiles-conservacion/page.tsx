import { notFound, redirect } from "next/navigation";
import { ConservationProfilesModule, type ConservationProfile } from "@/components/conservation-profiles-module";
import { PanelShell } from "@/components/panel-shell";
import { createServerSupabaseClient } from "@/lib/supabase-server";

type ConservationProfilesPageProps = {
  searchParams: Promise<{ q?: string; status?: string }>;
};

const managerRoles = new Set(["gerente", "admin_sistema"]);

export const dynamic = "force-dynamic";

export default async function ConservationProfilesPage({ searchParams }: ConservationProfilesPageProps) {
  const { q = "", status = "" } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roleNames = roles?.map((item) => item.role) ?? [];
  if (!roleNames.some((role) => managerRoles.has(role))) notFound();

  let query = supabase
    .from("conservation_profiles")
    .select(
      "id, sku, name, description, sort_order, temperature_min, temperature_max, is_active, created_at, conservation_profile_rules(id, storage_method, duration_value, duration_unit, temperature_min, temperature_max, notes)"
    )
    .order("sort_order", { ascending: true });

  if (q.trim()) query = query.ilike("name", `%${q.trim()}%`);
  if (status === "active") query = query.eq("is_active", true);
  if (status === "inactive") query = query.eq("is_active", false);

  const [profilesResult, allProfilesResult] = await Promise.all([
    query,
    supabase.from("conservation_profiles").select("id, name, is_active").order("name")
  ]);
  const profiles = (profilesResult.data ?? []) as unknown as ConservationProfile[];
  const allProfiles = (allProfilesResult.data ?? []) as Pick<ConservationProfile, "id" | "name" | "is_active">[];
  const error = profilesResult.error ?? allProfilesResult.error;

  return (
    <PanelShell
      active="perfiles-conservacion"
      hideHeader
      roleNames={roleNames}
      subtitle="Perfiles de conservacion"
      title="Perfiles de conservacion"
      userEmail={user.email ?? "usuario"}
    >
      {error ? <p className="alert">{error.message}</p> : null}
      <ConservationProfilesModule allProfiles={allProfiles} profiles={profiles} q={q} status={status} />
    </PanelShell>
  );
}
