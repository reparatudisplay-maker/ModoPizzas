"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase-server";

const validRoles = new Set(["cliente", "vendedor", "mesero", "cocina", "mensajero", "gerente", "admin_sistema"]);

function getString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function updateSiteSettings(formData: FormData) {
  const businessName = getString(formData, "business_name");
  const whatsappNumber = getString(formData, "whatsapp_number");
  const whatsappButtonText = getString(formData, "whatsapp_button_text");
  const whatsappEnabled = formData.get("whatsapp_enabled") === "on";
  const supabase = await createServerSupabaseClient();

  const { error } = await supabase
    .from("site_settings")
    .update({
      business_name: businessName || "ModoPizzas",
      whatsapp_number: whatsappNumber,
      whatsapp_button_text: whatsappButtonText || "Finalizar por WhatsApp",
      whatsapp_enabled: whatsappEnabled,
      updated_at: new Date().toISOString()
    })
    .eq("id", true);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/");
  revalidatePath("/panel");
}

export async function assignUserRole(formData: FormData) {
  const userId = getString(formData, "user_id");
  const role = getString(formData, "role");
  const supabase = await createServerSupabaseClient();

  if (!validRoles.has(role)) {
    throw new Error("Rol no valido.");
  }

  const { error } = await supabase.from("user_roles").insert({
    user_id: userId,
    role
  });

  if (error && error.code !== "23505") {
    throw new Error(error.message);
  }

  revalidatePath("/panel");
}

export async function removeUserRole(formData: FormData) {
  const userId = getString(formData, "user_id");
  const role = getString(formData, "role");
  const supabase = await createServerSupabaseClient();

  const { error } = await supabase.from("user_roles").delete().eq("user_id", userId).eq("role", role);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/panel");
}
