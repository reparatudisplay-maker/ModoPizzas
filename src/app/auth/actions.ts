"use server";

import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export type AccountActionState = { status: "idle" | "success" | "error"; message: string };

function getString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function authMessage(message: string) {
  if (message.toLowerCase().includes("email not confirmed")) {
    return "La cuenta quedo pendiente porque Supabase Auth aun tiene activa la confirmacion de correo. Desactiva Confirm email en Authentication > Providers > Email y confirma este usuario desde el administrador.";
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
          "Cuenta creada. Si no puedes entrar de inmediato, desactiva Confirm email en Supabase Auth y confirma el usuario pendiente."
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
  redirect("/login");
}

function accountResult(status: AccountActionState["status"], message: string): AccountActionState {
  return { status, message };
}

async function currentAccount() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Debes iniciar sesion.");
  return { supabase, user };
}

export async function updateMyProfile(_previousState: AccountActionState, formData: FormData): Promise<AccountActionState> {
  try {
    const { supabase, user } = await currentAccount();
    const fullName = getString(formData, "full_name");
    const image = formData.get("profile_image");
    const removeImage = getString(formData, "remove_profile_image") === "1";
    if (!fullName) return accountResult("error", "Ingresa tu nombre.");
    const { data: profile, error: profileError } = await supabase.from("profiles").select("avatar_url").eq("id", user.id).single();
    if (profileError) return accountResult("error", profileError.message);
    let avatarUrl = removeImage ? null : profile.avatar_url;
    let uploadedPath: string | null = null;
    if (image instanceof File && image.size > 0) {
      if (image.type !== "image/webp" || image.size > 400 * 1024) return accountResult("error", "No fue posible procesar la foto. Selecciona otra imagen.");
      uploadedPath = `profiles/${user.id}/${crypto.randomUUID()}.webp`;
      const { error } = await supabase.storage.from("profile-images").upload(uploadedPath, image, { cacheControl: "3600", contentType: "image/webp", upsert: false });
      if (error) return accountResult("error", error.message);
      avatarUrl = uploadedPath;
    }
    const { error } = await supabase.from("profiles").update({ full_name: fullName, avatar_url: avatarUrl, updated_at: new Date().toISOString() }).eq("id", user.id);
    if (error) {
      if (uploadedPath) await supabase.storage.from("profile-images").remove([uploadedPath]);
      return accountResult("error", error.message);
    }
    await supabase.auth.updateUser({ data: { full_name: fullName } });
    if (profile.avatar_url && profile.avatar_url !== avatarUrl) await supabase.storage.from("profile-images").remove([profile.avatar_url]);
    return accountResult("success", "Perfil actualizado.");
  } catch (error) {
    return accountResult("error", error instanceof Error ? error.message : "No se pudo actualizar el perfil.");
  }
}

export async function updateMyEmail(_previousState: AccountActionState, formData: FormData): Promise<AccountActionState> {
  try {
    const { supabase, user } = await currentAccount();
    const email = getString(formData, "email").toLowerCase();
    if (!email || !email.includes("@")) return accountResult("error", "Ingresa un correo valido.");
    const { data, error } = await supabase.auth.updateUser({ email });
    if (error) return accountResult("error", authMessage(error.message));
    const currentEmail = data.user.email ?? user.email ?? email;
    await supabase.from("profiles").update({ email: currentEmail, updated_at: new Date().toISOString() }).eq("id", user.id);
    return accountResult("success", currentEmail === email ? "Correo actualizado." : "Revisa tu correo para confirmar el cambio.");
  } catch (error) {
    return accountResult("error", error instanceof Error ? error.message : "No se pudo actualizar el correo.");
  }
}

export async function updateMyPassword(_previousState: AccountActionState, formData: FormData): Promise<AccountActionState> {
  try {
    const { supabase } = await currentAccount();
    const password = getString(formData, "password");
    if (password.length < 8) return accountResult("error", "La contrasena debe tener al menos 8 caracteres.");
    if (password !== getString(formData, "password_confirmation")) return accountResult("error", "Las contrasenas no coinciden.");
    const { error } = await supabase.auth.updateUser({ password });
    return error ? accountResult("error", authMessage(error.message)) : accountResult("success", "Contrasena actualizada correctamente.");
  } catch (error) {
    return accountResult("error", error instanceof Error ? error.message : "No se pudo actualizar la contrasena.");
  }
}
