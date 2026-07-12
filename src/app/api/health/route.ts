import { NextResponse } from "next/server";
import { createServerSupabaseClient, getSupabaseEnv } from "@/lib/supabase-server";

export async function GET() {
  const env = getSupabaseEnv();

  if (!env.isConfigured) {
    return NextResponse.json(
      {
        ok: false,
        configured: false,
        supabaseUrl: Boolean(env.url),
        supabaseKey: Boolean(env.publishableKey),
        error: "Faltan variables de Supabase en el entorno de despliegue."
      },
      { status: 500 }
    );
  }

  try {
    const supabase = await createServerSupabaseClient();
    const { count, error } = await supabase
      .from("pizza_flavors")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true);

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          configured: true,
          error: error.message
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      configured: true,
      activeFlavors: count ?? 0
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        configured: true,
        error: error instanceof Error ? error.message : "Error desconocido."
      },
      { status: 500 }
    );
  }
}
