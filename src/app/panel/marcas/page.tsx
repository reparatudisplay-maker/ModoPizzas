import { notFound, redirect } from "next/navigation";
import { MasterDataModule, type MasterRecord } from "@/components/master-data-module";
import { PanelShell } from "@/components/panel-shell";
import { createServerSupabaseClient } from "@/lib/supabase-server";

type BrandsPageProps = {
  searchParams: Promise<{ q?: string; status?: string; limit?: string }>;
};

type Brand = MasterRecord & {
  category: string | null;
  notes: string | null;
  created_at: string;
};

const managerRoles = new Set(["gerente", "admin_sistema"]);

export const dynamic = "force-dynamic";

export default async function BrandsPage({ searchParams }: BrandsPageProps) {
  const { q = "", status = "", limit = "15" } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roleNames = roles?.map((item) => item.role) ?? [];
  if (!roleNames.some((role) => managerRoles.has(role))) notFound();

  let query = supabase.from("brands").select("id, name, category, notes, is_active, created_at").order("created_at", { ascending: false });

  if (q.trim()) query = query.ilike("name", `%${q.trim()}%`);
  if (status === "active") query = query.eq("is_active", true);
  if (status === "inactive") query = query.eq("is_active", false);
  if (limit !== "all") query = query.limit(limit === "30" ? 30 : 15);

  const [recordsResult, allRecordsResult] = await Promise.all([
    query,
    supabase.from("brands").select("id, name, is_active").order("name")
  ]);
  const records = (recordsResult.data ?? []) as Brand[];
  const allRecords = (allRecordsResult.data ?? []) as Pick<MasterRecord, "id" | "name" | "is_active">[];
  const error = recordsResult.error ?? allRecordsResult.error;

  return (
    <PanelShell active="marcas" hideHeader roleNames={roleNames} subtitle="Marcas" title="Marcas" userEmail={user.email ?? "usuario"}>
      {error ? <p className="alert">{error.message}</p> : null}
      <MasterDataModule
        addLabel="Agregar marca"
        allRecords={allRecords}
        emptyText="No hay marcas con esos filtros."
        kind="brand"
        limit={limit}
        limitLabels={{ fifteen: "Ultimas 15", thirty: "Ultimas 30", all: "Todas" }}
        q={q}
        records={records}
        status={status}
        title="Listado de marcas"
      />
    </PanelShell>
  );
}
