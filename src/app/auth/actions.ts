"use server";

import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { createServerSupabaseClient } from "@/lib/supabase-server";

function getString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function authMessage(message: string) {
  if (message.toLowerCase().includes("email not confirmed")) {
    return "El correo aun no esta confirmado. Revisa el correo de confirmacion o pide al administrador confirmar la cuenta.";
  }

  return message;
}

export async function signIn(formData: FormData) {
  const email = getString(formData, "email");
  const password = getString(formData, "password");

  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      redirect(`/login?message=${encodeURIComponent(authMessage(error.message))}`);
    }

    redirect("/panel");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirect(`/login?message=${encodeURIComponent(error instanceof Error ? error.message : "No se pudo iniciar sesion.")}`);
  }
}

export async function signUp(formData: FormData) {
  const email = getString(formData, "email");
  const password = getString(formData, "password");
  const fullName = getString(formData, "full_name");
  const phone = getString(formData, "phone");
  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          phone
        }
      }
    });

    if (error) {
      redirect(`/login?message=${encodeURIComponent(authMessage(error.message))}`);
    }

    if (!data.session) {
      redirect(
        `/login?message=${encodeURIComponent(
          "Cuenta creada. Si Supabase solicita confirmacion de correo, revisa tu email antes de entrar."
        )}`
      );
    }

    redirect("/panel");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirect(`/login?message=${encodeURIComponent(error instanceof Error ? error.message : "No se pudo crear la cuenta.")}`);
  }
}

export async function signOut() {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  redirect("/");
}
