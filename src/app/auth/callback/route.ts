import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { getSupabaseEnv } from "@/lib/supabase-server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const response = NextResponse.redirect(new URL(safeNext, url.origin));
  if (code) {
    const env = getSupabaseEnv();
    if (!env.url || !env.publishableKey) return response;
    const supabase = createServerClient(env.url, env.publishableKey, {
      cookies: {
        getAll: () => request.headers.get("cookie")?.split("; ").filter(Boolean).map((entry) => {
          const [name, ...value] = entry.split("=");
          return { name, value: value.join("=") };
        }) ?? [],
        setAll: (cookies) => cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      }
    });
    await supabase.auth.exchangeCodeForSession(code);
  }
  return response;
}
