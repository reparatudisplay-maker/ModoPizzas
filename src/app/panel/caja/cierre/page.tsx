import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePanelAccess } from "@/lib/panel-auth";

export default async function CashClosingRedirectPage() {
  const supabase = await createServerSupabaseClient();
  await requirePanelAccess(supabase, "caja");
  redirect("/panel/caja#cierre");
}
