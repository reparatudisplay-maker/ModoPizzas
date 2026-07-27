import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase-server";

const productImageBucket = "product-images";
const menuTables = new Set(["menu_categories", "pizza_sizes", "pizza_flavors", "pizza_additions"]);

type MenuSection = "menu_categories" | "pizza_sizes" | "pizza_flavors" | "pizza_additions";

async function removeStoredImageIfUnreferenced(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>, imageUrl: string | null) {
  if (!imageUrl) return;
  const tables = ["inventory_items", "preparations", "pizza_flavors"] as const;
  for (const table of tables) {
    const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true }).eq("image_url", imageUrl);
    if (error || (count ?? 0) > 0) return;
  }
  await supabase.storage.from(productImageBucket).remove([imageUrl]);
}

function redirectToMenu(request: Request, status: "success" | "error", message: string, section: MenuSection) {
  const target = section === "pizza_additions" ? "/panel/menu/precios/adiciones" : "/panel/menu/pizzas";
  const url = new URL(target, request.url);
  url.searchParams.set("message_status", status);
  url.searchParams.set("message", message);
  return NextResponse.redirect(url, { status: 303 });
}

async function deleteMenuRecord(request: Request, section: MenuSection, id: string) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return redirectToMenu(request, "error", "Debes iniciar sesion para eliminar registros.", section);
  }

  try {
    let imageUrl: string | null = null;
    if (section === "pizza_flavors") {
      const { data, error } = await supabase.from("pizza_flavors").select("image_url").eq("id", id).single();
      if (error) throw new Error(error.message);
      imageUrl = data.image_url;
    }

    const { error } = await supabase.rpc("delete_menu_item", { p_section: section, p_id: id });
    if (error) throw new Error(error.message || error.details || "No se pudo eliminar el registro.");
    if (section === "pizza_flavors") await removeStoredImageIfUnreferenced(supabase, imageUrl);
    revalidatePath("/panel/menu/pizzas");
    revalidatePath("/panel/menu/precios/adiciones");

    return redirectToMenu(request, "success", "Registro eliminado correctamente.", section);
  } catch (error) {
    return redirectToMenu(request, "error", error instanceof Error ? error.message : "No se pudo eliminar el registro.", section);
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const section = url.searchParams.get("section");
  const id = url.searchParams.get("id");

  if (!id || !section || !menuTables.has(section)) {
    return redirectToMenu(request, "error", "Registro no valido.", "pizza_flavors");
  }

  return deleteMenuRecord(request, section as MenuSection, id);
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const section = formData.get("section");
  const id = formData.get("id");

  if (typeof id !== "string" || typeof section !== "string" || !menuTables.has(section)) {
    return redirectToMenu(request, "error", "Registro no valido.", "pizza_flavors");
  }

  return deleteMenuRecord(request, section as MenuSection, id);
}
