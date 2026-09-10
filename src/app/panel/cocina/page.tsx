import { KitchenKdsBoard, type KitchenKdsItem, type KitchenItemStatus } from "@/components/kitchen-kds-board";
import { PanelShell } from "@/components/panel-shell";
import type { KitchenSettings } from "@/lib/kitchen-estimates";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePanelAccess } from "@/lib/panel-auth";

export const dynamic = "force-dynamic";


type KitchenRow = {
  id: string;
  order_id: string;
  order_item_id: string;
  status: KitchenItemStatus;
  created_at: string;
  received_at: string | null;
  started_at: string | null;
  prepared_at: string | null;
};

type OrderRow = {
  id: string;
  code: string;
  kind: string;
  notes: string | null;
  created_at: string;
};

type OrderItemRow = {
  id: string;
  quantity: number;
  product_name_snapshot: string;
  notes: string | null;
  pizza_price_configs: { size_id: string | null } | { size_id: string | null }[] | null;
};

type AdditionRow = {
  id: string;
  order_item_id: string;
  name_snapshot: string;
  quantity: number;
  scope_label: string | null;
};

type KitchenSettingsRow = {
  oven_count: number | null;
  oven_width_cm: number | null;
  oven_depth_cm: number | null;
  sound_enabled_default: boolean | null;
  warning_threshold_minutes: number | null;
  delay_threshold_minutes: number | null;
};

type KitchenSizeSettingRow = {
  pizza_size_id: string;
  simultaneous_capacity: number | null;
  assembly_minutes: number | null;
  baking_minutes: number | null;
  finishing_minutes: number | null;
};

export default async function CocinaPage() {
  const supabase = await createServerSupabaseClient();
  const { user, roleNames, moduleKeys } = await requirePanelAccess(supabase, "cocina");

  const { data: kitchenRows, error: kitchenError } = await supabase
    .from("kitchen_order_items")
    .select("id, order_id, order_item_id, status, created_at, received_at, started_at, prepared_at")
    .in("status", ["pending", "in_preparation", "prepared"])
    .order("received_at", { ascending: true });

  const kitchenItems = (kitchenRows ?? []) as KitchenRow[];
  const orderIds = [...new Set(kitchenItems.map((item) => item.order_id))];
  const orderItemIds = [...new Set(kitchenItems.map((item) => item.order_item_id))];

  const [ordersResult, orderItemsResult, additionsResult, settingsResult, sizeSettingsResult] = await Promise.all([
    orderIds.length
      ? supabase.from("pos_orders").select("id, code, kind, notes, created_at").in("id", orderIds).neq("status", "cancelled").neq("status", "delivered")
      : Promise.resolve({ data: [], error: null }),
    orderItemIds.length
      ? supabase.from("pos_order_items").select("id, quantity, product_name_snapshot, notes, pizza_price_configs(size_id)").in("id", orderItemIds)
      : Promise.resolve({ data: [], error: null }),
    orderItemIds.length
      ? supabase.from("pos_order_item_additions").select("id, order_item_id, name_snapshot, quantity, scope_label").in("order_item_id", orderItemIds).order("created_at")
      : Promise.resolve({ data: [], error: null }),
    supabase.from("kitchen_settings").select("oven_count, oven_width_cm, oven_depth_cm, sound_enabled_default, warning_threshold_minutes, delay_threshold_minutes").eq("id", true).maybeSingle(),
    supabase.from("kitchen_size_settings").select("pizza_size_id, simultaneous_capacity, assembly_minutes, baking_minutes, finishing_minutes")
  ]);

  const error = kitchenError ?? ordersResult.error ?? orderItemsResult.error ?? additionsResult.error ?? settingsResult.error ?? sizeSettingsResult.error;
  const ordersById = new Map(((ordersResult.data ?? []) as OrderRow[]).map((order) => [order.id, order]));
  const orderItemsById = new Map(((orderItemsResult.data ?? []) as OrderItemRow[]).map((item) => [item.id, item]));
  const additionsByItemId = new Map<string, KitchenKdsItem["additions"]>();

  for (const addition of (additionsResult.data ?? []) as AdditionRow[]) {
    additionsByItemId.set(addition.order_item_id, [
      ...(additionsByItemId.get(addition.order_item_id) ?? []),
      {
        id: addition.id,
        name: addition.name_snapshot,
        quantity: Number(addition.quantity ?? 0),
        scope_label: addition.scope_label
      }
    ]);
  }

  const items = kitchenItems
    .map((item) => {
      const order = ordersById.get(item.order_id);
      const orderItem = orderItemsById.get(item.order_item_id);
      if (!order || !orderItem) return null;
      const priceConfig = Array.isArray(orderItem.pizza_price_configs) ? orderItem.pizza_price_configs[0] : orderItem.pizza_price_configs;
      return {
        id: item.id,
        order_id: item.order_id,
        order_item_id: item.order_item_id,
        order_code: order.code,
        order_kind: order.kind,
        order_notes: order.notes,
        confirmed_at: order.created_at,
        received_at: item.received_at ?? item.created_at,
        started_at: item.started_at,
        prepared_at: item.prepared_at,
        status: item.status,
        quantity: Number(orderItem.quantity ?? 0),
        size_id: priceConfig?.size_id ?? null,
        name: orderItem.product_name_snapshot,
        notes: orderItem.notes,
        additions: additionsByItemId.get(item.order_item_id) ?? []
      } satisfies KitchenKdsItem;
    })
    .filter(Boolean) as KitchenKdsItem[];
  const settingsRow = settingsResult.data as KitchenSettingsRow | null;
  const kitchenSettings: KitchenSettings = {
    oven_count: Number(settingsRow?.oven_count ?? 1),
    oven_width_cm: Number(settingsRow?.oven_width_cm ?? 130),
    oven_depth_cm: Number(settingsRow?.oven_depth_cm ?? 50),
    sound_enabled_default: settingsRow?.sound_enabled_default ?? true,
    warning_threshold_minutes: Number(settingsRow?.warning_threshold_minutes ?? 12),
    delay_threshold_minutes: Number(settingsRow?.delay_threshold_minutes ?? 20),
    sizes: ((sizeSettingsResult.data ?? []) as KitchenSizeSettingRow[]).map((size) => ({
      pizza_size_id: size.pizza_size_id,
      simultaneous_capacity: Number(size.simultaneous_capacity ?? 1),
      assembly_minutes: Number(size.assembly_minutes ?? 2),
      baking_minutes: Number(size.baking_minutes ?? 8),
      finishing_minutes: Number(size.finishing_minutes ?? 1)
    }))
  };

  return (
    <PanelShell active="cocina" hideHeader moduleKeys={moduleKeys} roleNames={roleNames} title="Cocina" userEmail={user.email ?? "usuario"}>
      {error ? <p className="alert">{error.message}</p> : null}
      <KitchenKdsBoard items={items} key={items.map((item) => `${item.id}:${item.status}:${item.prepared_at ?? ""}`).join("|")} settings={kitchenSettings} />
    </PanelShell>
  );
}
