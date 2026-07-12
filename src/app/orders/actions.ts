"use server";

import { revalidatePath } from "next/cache";
import { createHash, randomUUID } from "node:crypto";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { calculatePizzaLineTotal, calculatePizzaUnitPrice } from "@/lib/order-pricing";
import type { CustomerDraft, OrderKind, OrderPizza, PublicCatalog } from "@/types/modo-pizzas";

type CreateWebOrderInput = {
  orderKind: OrderKind;
  customer: CustomerDraft;
  pizzas: OrderPizza[];
  catalog: PublicCatalog;
};

type CreateStaffOrderInput = CreateWebOrderInput & {
  paymentMethod?: "pending" | "cash" | "transfer" | "card" | "cash_on_delivery";
};

function requireDeliveryData(orderKind: OrderKind, customer: CustomerDraft) {
  if (orderKind !== "delivery") return;
  if (!customer.name || !customer.phone || !customer.address) {
    throw new Error("Para domicilio necesitamos nombre, telefono y direccion.");
  }
}

function createDuplicateGuardHash(input: CreateWebOrderInput) {
  const bucket = Math.floor(Date.now() / 120000);
  const payload = {
    bucket,
    orderKind: input.orderKind,
    customer: {
      phone: input.customer.phone,
      address: input.customer.address
    },
    pizzas: input.pizzas.map((pizza) => ({
      sizeId: pizza.sizeId,
      flavorAId: pizza.flavorAId,
      flavorBId: pizza.flavorBId,
      crustId: pizza.crustId,
      extraIds: [...pizza.extraIds].sort(),
      quantity: pizza.quantity,
      notes: pizza.notes?.trim() ?? ""
    }))
  };

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function createWebOrder(input: CreateWebOrderInput) {
  requireDeliveryData(input.orderKind, input.customer);

  if (input.pizzas.length === 0) {
    throw new Error("Agrega al menos una pizza.");
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  const priceOptions = {
    flavors: input.catalog.pizzaFlavors,
    crustOptions: input.catalog.crusts,
    extraOptions: input.catalog.extras
  };
  const subtotal = input.pizzas.reduce((sum, pizza) => sum + calculatePizzaLineTotal(pizza, priceOptions), 0);
  const duplicateGuardHash = createDuplicateGuardHash(input);
  const orderId = randomUUID();

  const { error: orderError } = await supabase
    .from("orders")
    .insert({
      id: orderId,
      kind: input.orderKind,
      status: "sent_to_whatsapp",
      auth_user_id: user?.id ?? null,
      customer_name: input.customer.name || null,
      customer_phone: input.customer.phone || null,
      delivery_address: input.orderKind === "delivery" ? input.customer.address : null,
      delivery_neighborhood: input.orderKind === "delivery" ? input.customer.neighborhood || null : null,
      delivery_notes: input.orderKind === "delivery" ? input.customer.deliveryNotes || null : null,
      subtotal_cop: subtotal,
      total_cop: subtotal,
      payment_method: input.orderKind === "delivery" ? "cash_on_delivery" : "pending",
      duplicate_guard_hash: duplicateGuardHash
    });

  if (orderError) {
    if (orderError.code === "23505") {
      throw new Error("Parece que este pedido ya fue enviado hace poco.");
    }
    throw new Error(orderError.message);
  }

  const orderItems = input.pizzas.map((pizza) => ({
    order_id: orderId,
    item_kind: "pizza",
    size_id: null,
    flavor_a_id: null,
    flavor_b_id: null,
    crust_extra_id: null,
    quantity: pizza.quantity,
    unit_price_cop: calculatePizzaUnitPrice(pizza, priceOptions),
    line_total_cop: calculatePizzaLineTotal(pizza, priceOptions),
    notes: JSON.stringify({
      sizeId: pizza.sizeId,
      flavorAId: pizza.flavorAId,
      flavorBId: pizza.flavorBId || null,
      crustId: pizza.crustId || null,
      extraIds: pizza.extraIds,
      notes: pizza.notes || ""
    })
  }));

  const { error: itemsError } = await supabase.from("order_items").insert(orderItems);
  if (itemsError) {
    throw new Error(itemsError.message);
  }

  revalidatePath("/panel");
  return {
    id: orderId
  };
}

export async function createStaffOrder(input: CreateStaffOrderInput) {
  requireDeliveryData(input.orderKind, input.customer);

  if (input.pizzas.length === 0) {
    throw new Error("Agrega al menos una pizza.");
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Debes iniciar sesion.");
  }

  const priceOptions = {
    flavors: input.catalog.pizzaFlavors,
    crustOptions: input.catalog.crusts,
    extraOptions: input.catalog.extras
  };
  const subtotal = input.pizzas.reduce((sum, pizza) => sum + calculatePizzaLineTotal(pizza, priceOptions), 0);
  const orderId = randomUUID();

  const { error: orderError } = await supabase.from("orders").insert({
    id: orderId,
    kind: input.orderKind,
    status: "confirmed",
    auth_user_id: null,
    created_by: user.id,
    customer_name: input.customer.name || null,
    customer_phone: input.customer.phone || null,
    delivery_address: input.orderKind === "delivery" ? input.customer.address : null,
    delivery_neighborhood: input.orderKind === "delivery" ? input.customer.neighborhood || null : null,
    delivery_notes: input.orderKind === "delivery" ? input.customer.deliveryNotes || null : null,
    subtotal_cop: subtotal,
    total_cop: subtotal,
    payment_method: input.paymentMethod ?? (input.orderKind === "delivery" ? "cash_on_delivery" : "pending")
  });

  if (orderError) {
    throw new Error(orderError.message);
  }

  const orderItems = input.pizzas.map((pizza) => ({
    order_id: orderId,
    item_kind: "pizza",
    size_id: null,
    flavor_a_id: null,
    flavor_b_id: null,
    crust_extra_id: null,
    quantity: pizza.quantity,
    unit_price_cop: calculatePizzaUnitPrice(pizza, priceOptions),
    line_total_cop: calculatePizzaLineTotal(pizza, priceOptions),
    notes: JSON.stringify({
      sizeId: pizza.sizeId,
      flavorAId: pizza.flavorAId,
      flavorBId: pizza.flavorBId || null,
      crustId: pizza.crustId || null,
      extraIds: pizza.extraIds,
      notes: pizza.notes || ""
    })
  }));

  const { error: itemsError } = await supabase.from("order_items").insert(orderItems);
  if (itemsError) {
    throw new Error(itemsError.message);
  }

  revalidatePath("/panel");
  return {
    id: orderId
  };
}

export async function updateOrderStatus(formData: FormData) {
  const orderId = String(formData.get("order_id") ?? "");
  const nextStatus = String(formData.get("status") ?? "");
  const supabase = await createServerSupabaseClient();

  const { data: existing, error: readError } = await supabase
    .from("orders")
    .select("status")
    .eq("id", orderId)
    .single();

  if (readError) {
    throw new Error(readError.message);
  }

  const { error } = await supabase
    .from("orders")
    .update({
      status: nextStatus,
      updated_at: new Date().toISOString()
    })
    .eq("id", orderId);

  if (error) {
    throw new Error(error.message);
  }

  await supabase.from("order_status_events").insert({
    order_id: orderId,
    from_status: existing.status,
    to_status: nextStatus
  });

  revalidatePath("/panel");
}
