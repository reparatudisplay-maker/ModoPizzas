import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  return {
    url,
    publishableKey,
    isConfigured: Boolean(url && publishableKey)
  };
}

export async function createServerSupabaseClient() {
  const env = getSupabaseEnv();
  if (!env.url || !env.publishableKey) {
    throw new Error(
      "Supabase no esta configurado. Revisa NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY en Vercel."
    );
  }

  const cookieStore = await cookies();

  return createServerClient(
    env.url,
    env.publishableKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Components cannot set cookies. Server Actions and Route Handlers can.
          }
        }
      }
    }
  );
}
