import { NextResponse } from "next/server";
import { getSupabaseEnv } from "@/lib/supabase-server";

export async function GET() {
  const env = getSupabaseEnv();

  return NextResponse.json({
    ok: env.isConfigured,
    configured: env.isConfigured,
    supabaseUrl: Boolean(env.url),
    supabaseKey: Boolean(env.publishableKey)
  });
}
