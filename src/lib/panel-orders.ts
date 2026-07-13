import { createServerSupabaseClient } from "@/lib/supabase-server";

export type OrderItemSnapshot = {
  sizeId?: string;
  flavorAId?: string;
  flavorBId?: string | null;
  crustId?: string | null;
  extraIds?: string[];
  notes?: string;
};

export type PanelOrder = {
  id: string;
  order_number: number;
  kind: "delivery" | "pickup" | "local";
  status: string;
  customer_name: string | null;
  customer_phone: string | null;
  delivery_address: string | null;
  delivery_neighborhood: string | null;
  total_cop: number;
  created_at: string;
  order_items: Array<{
    id: string;
    quantity: number;
    unit_price_cop: number;
    line_total_cop: number;
    notes: string | null;
  }>;
};

export const staffRoles = new Set(["vendedor", "mesero", "cocina", "mensajero", "gerente", "admin_sistema"]);
export const orderCreatorRoles = new Set(["vendedor", "mesero", "gerente", "admin_sistema"]);
export const managerRoles = new Set(["gerente", "admin_sistema"]);
export const nextStatuses = ["confirmed", "in_kitchen", "in_preparation", "prepared", "on_the_way", "delivered", "cancelled"];

export const statusLabels: Record<string, string> = {
  sent_to_whatsapp: "WhatsApp",
  confirmed: "Confirmado",
  in_kitchen: "Cocina",
  in_preparation: "Preparacion",
  prepared: "Preparado",
  on_the_way: "En camino",
  delivered: "Entregado",
  cancelled: "Cancelado"
};

export function parseSnapshot(value: string | null): OrderItemSnapshot {
  if (!value) return {};
  try {
    return JSON.parse(value) as OrderItemSnapshot;
  } catch {
    return {};
  }
}

export function orderKindLabel(kind: PanelOrder["kind"]) {
  if (kind === "delivery") return "Domicilio";
  if (kind === "pickup") return "Recoger";
  return "Local";
}

export function statusLabel(status: string) {
  return statusLabels[status] ?? status;
}

export async function getCurrentPanelUser() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return { supabase, user: null, roleNames: [] };
  }

  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  return {
    supabase,
    user,
    roleNames: roles?.map((item) => item.role) ?? []
  };
}

export async function getPanelOrders(statuses?: string[], kind?: PanelOrder["kind"]) {
  const supabase = await createServerSupabaseClient();
  let query = supabase
    .from("orders")
    .select(
      "id, order_number, kind, status, customer_name, customer_phone, delivery_address, delivery_neighborhood, total_cop, created_at, order_items(id, quantity, unit_price_cop, line_total_cop, notes)"
    )
    .order("created_at", { ascending: false })
    .limit(40);

  if (statuses?.length) {
    query = query.in("status", statuses);
  }

  if (kind) {
    query = query.eq("kind", kind);
  }

  const { data, error } = await query;
  return {
    orders: (data ?? []) as unknown as PanelOrder[],
    error
  };
}
