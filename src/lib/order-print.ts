import { notFound, redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export type PrintableOrderItemSnapshot = {
  sizeId?: string;
  flavorAId?: string;
  flavorBId?: string | null;
  crustId?: string | null;
  extraIds?: string[];
  notes?: string;
};

export type PrintableOrder = {
  id: string;
  order_number: number;
  kind: "delivery" | "pickup" | "local";
  status: string;
  customer_name: string | null;
  customer_phone: string | null;
  delivery_address: string | null;
  delivery_neighborhood: string | null;
  delivery_notes: string | null;
  subtotal_cop: number;
  discount_cop: number;
  delivery_fee_cop: number;
  total_cop: number;
  payment_method: string;
  created_at: string;
  order_items: Array<{
    id: string;
    quantity: number;
    unit_price_cop: number;
    line_total_cop: number;
    notes: string | null;
  }>;
};

export type PrintableSiteSettings = {
  business_name: string;
  whatsapp_number: string;
};

const staffRoles = new Set(["vendedor", "mesero", "cocina", "mensajero", "gerente", "admin_sistema"]);

export function parseOrderItemSnapshot(value: string | null): PrintableOrderItemSnapshot {
  if (!value) return {};
  try {
    return JSON.parse(value) as PrintableOrderItemSnapshot;
  } catch {
    return {};
  }
}

export function orderKindText(kind: PrintableOrder["kind"]) {
  if (kind === "delivery") return "Domicilio";
  if (kind === "pickup") return "Recoger";
  return "Local";
}

export async function getPrintableOrder(orderId: string) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const canPrint = roles?.some((item) => staffRoles.has(item.role)) ?? false;
  if (!canPrint) {
    notFound();
  }

  const [settingsResult, orderResult] = await Promise.all([
    supabase.from("site_settings").select("business_name, whatsapp_number").single(),
    supabase
      .from("orders")
      .select(
        "id, order_number, kind, status, customer_name, customer_phone, delivery_address, delivery_neighborhood, delivery_notes, subtotal_cop, discount_cop, delivery_fee_cop, total_cop, payment_method, created_at, order_items(id, quantity, unit_price_cop, line_total_cop, notes)"
      )
      .eq("id", orderId)
      .single()
  ]);

  if (orderResult.error || !orderResult.data) {
    notFound();
  }

  return {
    settings: (settingsResult.data ?? {
      business_name: "ModoPizzas",
      whatsapp_number: ""
    }) as PrintableSiteSettings,
    order: orderResult.data as PrintableOrder
  };
}
