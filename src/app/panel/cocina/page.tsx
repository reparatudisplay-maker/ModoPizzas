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
  base_used_source_kind: "inventory_item" | "preparation" | null;
  base_used_inventory_item_id: string | null;
  base_used_preparation_id: string | null;
  pizza_price_configs: { id: string; size_id: string | null } | { id: string; size_id: string | null }[] | null;
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

type ConsumptionRow = {
  order_item_id: string;
  order_item_addition_id: string | null;
  source_kind: "inventory_item" | "preparation";
  inventory_item_id: string | null;
  source_preparation_id: string | null;
  quantity_base: number;
  base_unit: "g" | "kg" | "ml" | "l" | "unit";
};

type SourceNameRow = { id: string; name: string };

type PizzaComponentRow = {
  source_kind: "inventory_item" | "preparation";
  inventory_item_id: string | null;
  source_preparation_id: string | null;
};

type PizzaConfigRow = {
  id: string;
  size_id: string;
  pizza_flavors: { name: string } | { name: string }[] | null;
  pizza_price_components: PizzaComponentRow[] | null;
};

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function sourceKey(sourceKind: "inventory_item" | "preparation", inventoryItemId: string | null, preparationId: string | null) {
  return `${sourceKind}:${sourceKind === "inventory_item" ? inventoryItemId : preparationId}`;
}

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

  const [ordersResult, orderItemsResult, additionsResult, consumptionsResult, pizzaConfigsResult, settingsResult, sizeSettingsResult] = await Promise.all([
    orderIds.length
      ? supabase.from("pos_orders").select("id, code, kind, notes, created_at").in("id", orderIds).neq("status", "cancelled").neq("status", "delivered")
      : Promise.resolve({ data: [], error: null }),
    orderItemIds.length
      ? supabase.from("pos_order_items").select("id, quantity, product_name_snapshot, notes, base_used_source_kind, base_used_inventory_item_id, base_used_preparation_id, pizza_price_configs(id, size_id)").in("id", orderItemIds)
      : Promise.resolve({ data: [], error: null }),
    orderItemIds.length
      ? supabase.from("pos_order_item_additions").select("id, order_item_id, name_snapshot, quantity, scope_label").in("order_item_id", orderItemIds).order("created_at")
      : Promise.resolve({ data: [], error: null }),
    orderItemIds.length
      ? supabase.from("pos_order_consumptions").select("order_item_id, order_item_addition_id, source_kind, inventory_item_id, source_preparation_id, quantity_base, base_unit").in("order_item_id", orderItemIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("pizza_price_configs").select("id, size_id, pizza_flavors(name), pizza_price_components(source_kind, inventory_item_id, source_preparation_id)").eq("is_active", true),
    supabase.from("kitchen_settings").select("oven_count, oven_width_cm, oven_depth_cm, sound_enabled_default, warning_threshold_minutes, delay_threshold_minutes").eq("id", true).maybeSingle(),
    supabase.from("kitchen_size_settings").select("pizza_size_id, simultaneous_capacity, assembly_minutes, baking_minutes, finishing_minutes")
  ]);

  const consumptions = (consumptionsResult.data ?? []) as ConsumptionRow[];
  const inventorySourceIds = [...new Set(consumptions.flatMap((row) => row.source_kind === "inventory_item" && row.inventory_item_id ? [row.inventory_item_id] : []))];
  const preparationSourceIds = [...new Set(consumptions.flatMap((row) => row.source_kind === "preparation" && row.source_preparation_id ? [row.source_preparation_id] : []))];
  const [inventorySourcesResult, preparationSourcesResult] = await Promise.all([
    inventorySourceIds.length ? supabase.from("inventory_items").select("id, name").in("id", inventorySourceIds) : Promise.resolve({ data: [], error: null }),
    preparationSourceIds.length ? supabase.from("preparations").select("id, name").in("id", preparationSourceIds) : Promise.resolve({ data: [], error: null })
  ]);
  const error = kitchenError ?? ordersResult.error ?? orderItemsResult.error ?? additionsResult.error ?? consumptionsResult.error ?? pizzaConfigsResult.error ?? inventorySourcesResult.error ?? preparationSourcesResult.error ?? settingsResult.error ?? sizeSettingsResult.error;
  const ordersById = new Map(((ordersResult.data ?? []) as OrderRow[]).map((order) => [order.id, order]));
  const orderItemsById = new Map(((orderItemsResult.data ?? []) as OrderItemRow[]).map((item) => [item.id, item]));
  const additionsByItemId = new Map<string, KitchenKdsItem["additions"]>();
  const sourceNames = new Map<string, string>();
  for (const source of (inventorySourcesResult.data ?? []) as SourceNameRow[]) sourceNames.set(`inventory_item:${source.id}`, source.name);
  for (const source of (preparationSourcesResult.data ?? []) as SourceNameRow[]) sourceNames.set(`preparation:${source.id}`, source.name);
  const consumptionsByItemId = new Map<string, ConsumptionRow[]>();
  const pizzaConfigsById = new Map(((pizzaConfigsResult.data ?? []) as unknown as PizzaConfigRow[]).map((config) => [config.id, config]));
  for (const consumption of consumptions) consumptionsByItemId.set(consumption.order_item_id, [...(consumptionsByItemId.get(consumption.order_item_id) ?? []), consumption]);

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
      const primaryConfig = priceConfig ? pizzaConfigsById.get((priceConfig as { id?: string }).id ?? "") : null;
      const isHalfAndHalf = orderItem.product_name_snapshot.includes("/");
      const [primaryName, secondaryName] = isHalfAndHalf ? orderItem.product_name_snapshot.split("/").map((name) => name.trim()) : [null, null];
      const secondaryConfig = isHalfAndHalf && priceConfig
        ? [...pizzaConfigsById.values()].find((config) => {
            if (config.size_id !== priceConfig.size_id || config.id === primaryConfig?.id) return false;
            const flavor = firstRelation(config.pizza_flavors)?.name;
            return Boolean(flavor && secondaryName?.toUpperCase().startsWith(flavor.toUpperCase()));
          }) ?? null
        : null;
      const primarySources = new Set((primaryConfig?.pizza_price_components ?? []).map((component) => sourceKey(component.source_kind, component.inventory_item_id, component.source_preparation_id)));
      const secondarySources = new Set((secondaryConfig?.pizza_price_components ?? []).map((component) => sourceKey(component.source_kind, component.inventory_item_id, component.source_preparation_id)));
      const recipeBySource = new Map<string, KitchenKdsItem["recipe"][number]>();
      for (const consumption of consumptionsByItemId.get(item.order_item_id) ?? []) {
        const sourceId = consumption.source_kind === "inventory_item" ? consumption.inventory_item_id : consumption.source_preparation_id;
        if (!sourceId) continue;
        const isBase = consumption.source_kind === orderItem.base_used_source_kind && (
          (consumption.source_kind === "inventory_item" && sourceId === orderItem.base_used_inventory_item_id)
          || (consumption.source_kind === "preparation" && sourceId === orderItem.base_used_preparation_id)
        );
        const name = sourceNames.get(`${consumption.source_kind}:${sourceId}`) ?? "Componente sin nombre";
        const componentSourceKey = sourceKey(consumption.source_kind, consumption.inventory_item_id, consumption.source_preparation_id);
        const section = isHalfAndHalf && !isBase && !consumption.order_item_addition_id
          ? primarySources.has(componentSourceKey) && secondarySources.has(componentSourceKey)
            ? "common"
            : primarySources.has(componentSourceKey)
              ? "left"
              : secondarySources.has(componentSourceKey)
                ? "right"
                : "common"
          : "common";
        const key = `${componentSourceKey}:${isBase}:${consumption.order_item_addition_id ?? ""}:${section}`;
        const existing = recipeBySource.get(key);
        if (existing) existing.quantity += Number(consumption.quantity_base ?? 0);
        else recipeBySource.set(key, { name, quantity: Number(consumption.quantity_base ?? 0), unit: consumption.base_unit, is_base: isBase, is_addition: Boolean(consumption.order_item_addition_id), is_sauce: !consumption.order_item_addition_id && /SALSA\s+NAPOLITANA/i.test(name), section, primary_flavor: primaryName, secondary_flavor: secondaryName });
      }
      const recipe = [...recipeBySource.values()];
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
        additions: additionsByItemId.get(item.order_item_id) ?? [],
        recipe
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
