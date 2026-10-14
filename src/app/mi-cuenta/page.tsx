import { redirect } from "next/navigation";
import { PublicCustomerAccount } from "@/components/public-customer-account";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export default async function MyAccountPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const [profileResult, addressesResult, requestsResult] = await Promise.all([
    supabase.from("profiles").select("id, full_name, phone, email, account_type, is_active").eq("id", user.id).maybeSingle(),
    supabase.from("customer_addresses").select("id, label, address_line, complement, is_default").order("is_default", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("public_order_requests").select("id, channel, status, kind, customer_name, customer_phone, delivery_address, notes, items, total_cop, created_at, accepted_order_id, rejection_reason").order("created_at", { ascending: false }).limit(30)
  ]);
  const profile = profileResult.data;
  if (!profile || profile.account_type !== "client" || profile.is_active === false) redirect("/");

  return <PublicCustomerAccount
    addresses={addressesResult.data ?? []}
    customer={{ id: profile.id, full_name: profile.full_name ?? "", phone: profile.phone ?? "", email: user.email ?? profile.email ?? "" }}
    requests={(requestsResult.data ?? []).map((request) => ({ ...request, total_cop: Number(request.total_cop ?? 0) }))}
  />;
}
