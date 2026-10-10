import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) {
    return new Response("No encontrado", { status: 404 });
  }

  const admin = createSupabaseAdminClient();
  if (!admin) return new Response("Impresión no disponible", { status: 503 });

  const { data, error } = await admin
    .from("thermal_print_jobs")
    .update({ consumed_at: new Date().toISOString() })
    .eq("token", token)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("payload_base64")
    .maybeSingle();

  if (error || !data?.payload_base64) return new Response("No encontrado", { status: 404 });

  return new Response(Buffer.from(data.payload_base64, "base64"), {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Content-Type": "application/octet-stream",
      "Content-Disposition": "inline; filename=modo-pizzas-print.bin"
    }
  });
}
