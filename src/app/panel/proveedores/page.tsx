import { notFound, redirect } from "next/navigation";
import { MasterDataModule, type MasterRecord } from "@/components/master-data-module";
import { PanelShell } from "@/components/panel-shell";
import { createServerSupabaseClient } from "@/lib/supabase-server";

type SuppliersPageProps = {
  searchParams: Promise<{ q?: string; status?: string; limit?: string }>;
};

type Supplier = MasterRecord & {
  phone: string | null;
  notes: string | null;
};

const managerRoles = new Set(["gerente", "admin_sistema"]);

export const dynamic = "force-dynamic";

export default async function SuppliersPage({ searchParams }: SuppliersPageProps) {
  const { q = "", status = "", limit = "15" } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roleNames = roles?.map((item) => item.role) ?? [];
  if (!roleNames.some((role) => managerRoles.has(role))) notFound();

  let query = supabase.from("suppliers").select("id, name, phone, notes, is_active").order("name");

  if (q.trim()) {
    const term = q.trim();
    query = query.or(`name.ilike.%${term}%,phone.ilike.%${term}%,notes.ilike.%${term}%`);
  }
  if (status === "active") query = query.eq("is_active", true);
  if (status === "inactive") query = query.eq("is_active", false);
  if (limit !== "all") query = query.limit(limit === "30" ? 30 : 15);

  const [recordsResult, allRecordsResult] = await Promise.all([
    query,
    supabase.from("suppliers").select("id, name, is_active").order("name")
  ]);
  const records = (recordsResult.data ?? []) as Supplier[];
  const allRecords = (allRecordsResult.data ?? []) as Pick<MasterRecord, "id" | "name" | "is_active">[];
  const error = recordsResult.error ?? allRecordsResult.error;

  return (
    <PanelShell active="proveedores" hideHeader roleNames={roleNames} subtitle="Proveedores" title="Proveedores" userEmail={user.email ?? "usuario"}>
      {error ? <p className="alert">{error.message}</p> : null}
      <MasterDataModule
        addLabel="Agregar proveedor"
        allRecords={allRecords}
        emptyText="No hay proveedores con esos filtros."
        kind="supplier"
        limit={limit}
        limitLabels={{ fifteen: "Ultimos 15", thirty: "Ultimos 30", all: "Todos" }}
        q={q}
        records={records}
        status={status}
        title="Listado de proveedores"
      />
    </PanelShell>
  );
}
