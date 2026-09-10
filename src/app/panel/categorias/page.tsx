import { MasterDataModule, type MasterRecord } from "@/components/master-data-module";
import { PanelShell } from "@/components/panel-shell";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePanelAccess } from "@/lib/panel-auth";

type CategoriesPageProps = {
  searchParams: Promise<{ q?: string; status?: string; limit?: string }>;
};

type ProductCategory = MasterRecord & {
  created_at: string;
};


export const dynamic = "force-dynamic";

export default async function CategoriesPage({ searchParams }: CategoriesPageProps) {
  const { q = "", status = "", limit = "15" } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const { user, roleNames, moduleKeys } = await requirePanelAccess(supabase, "maestros");

  let query = supabase.from("product_categories").select("id, name, description, is_active, created_at").order("created_at", { ascending: false });

  if (q.trim()) query = query.ilike("name", `%${q.trim()}%`);
  if (status === "active") query = query.eq("is_active", true);
  if (status === "inactive") query = query.eq("is_active", false);
  if (limit !== "all") query = query.limit(limit === "30" ? 30 : 15);

  const [recordsResult, allRecordsResult] = await Promise.all([
    query,
    supabase.from("product_categories").select("id, name, is_active").order("name")
  ]);
  const records = (recordsResult.data ?? []) as ProductCategory[];
  const allRecords = (allRecordsResult.data ?? []) as Pick<MasterRecord, "id" | "name" | "is_active">[];
  const error = recordsResult.error ?? allRecordsResult.error;

  return (
    <PanelShell
      active="categorias"
      hideHeader
      moduleKeys={moduleKeys} roleNames={roleNames}
      subtitle="Categorias"
      title="Categorias"
      userEmail={user.email ?? "usuario"}
    >
      {error ? <p className="alert">{error.message}</p> : null}
      <MasterDataModule
        addLabel="Agregar categoria"
        allRecords={allRecords}
        emptyText="No hay categorias con esos filtros."
        kind="category"
        limit={limit}
        limitLabels={{ fifteen: "Ultimos 15", thirty: "Ultimos 30", all: "Todos" }}
        q={q}
        records={records}
        status={status}
        title="Listado de categorias"
      />
    </PanelShell>
  );
}
