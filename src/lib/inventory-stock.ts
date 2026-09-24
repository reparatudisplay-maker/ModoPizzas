import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { convertStockQuantity, type StockUnit } from "@/lib/units";

type ServerSupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;
type AdminSupabaseClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
type StockSupabaseClient = ServerSupabaseClient | AdminSupabaseClient;
type Allocation = {
  purchase_item_id?: string | null;
  production_batch_id?: string | null;
  quantity_base: number;
  base_unit: StockUnit;
};

type StockOrigin = {
  id: string;
  available: number;
  occurredAt: string;
  expiration: string;
  sequence: number;
};

function applyAdjustments(
  origins: StockOrigin[],
  counts: Array<{ difference_quantity_base: number; base_unit: StockUnit; created_at: string }>,
  unit: StockUnit
) {
  const stockByOrigin = new Map(origins.map((origin) => [origin.id, origin.available]));
  const orderedCounts = [...counts].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const count of orderedCounts) {
    const adjustment = convertStockQuantity(
      Number(count.difference_quantity_base ?? 0),
      count.base_unit,
      unit
    );
    const eligible = origins.filter((origin) => !origin.occurredAt || origin.occurredAt <= count.created_at);

    if (adjustment < 0) {
      let pending = Math.abs(adjustment);
      for (const origin of eligible) {
        if (pending <= 0) break;
        const current = stockByOrigin.get(origin.id) ?? 0;
        const waste = Math.min(current, pending);
        stockByOrigin.set(origin.id, Math.max(0, current - waste));
        pending -= waste;
      }
    } else if (adjustment > 0 && eligible[0]) {
      stockByOrigin.set(eligible[0].id, (stockByOrigin.get(eligible[0].id) ?? 0) + adjustment);
    }
  }

  const stock = [...stockByOrigin.values()].reduce((sum, value) => sum + value, 0);
  return { stock: Number(stock.toFixed(3)), originStock: stockByOrigin };
}

export async function getAdjustedSourceStock(
  supabase: StockSupabaseClient,
  sourceKind: "inventory_item" | "preparation",
  sourceId: string,
  unit: StockUnit
) {
  if (sourceKind === "inventory_item") {
    const { data: lots, error: lotsError } = await supabase
      .from("purchase_items")
      .select("id, quantity, unit, expiration_date, purchases(purchased_at)")
      .eq("inventory_item_id", sourceId);
    if (lotsError) throw new Error(lotsError.message);

    const ids = (lots ?? []).map((lot) => lot.id);
    const [productionResult, posResult, countsResult] = await Promise.all([
      ids.length
        ? supabase.from("production_consumption_allocations").select("purchase_item_id, quantity_base, base_unit").in("purchase_item_id", ids)
        : Promise.resolve({ data: [], error: null }),
      ids.length
        ? supabase
            .from("pos_order_consumption_allocations")
            .select("purchase_item_id, quantity_base, base_unit, pos_order_consumptions!inner(pos_orders!inner(status))")
            .in("purchase_item_id", ids)
            .neq("pos_order_consumptions.pos_orders.status", "cancelled")
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("physical_inventory_counts")
        .select("difference_quantity_base, base_unit, created_at")
        .eq("inventory_item_id", sourceId)
        .is("voided_at", null)
        .order("created_at", { ascending: true })
    ]);
    if (productionResult.error) throw new Error(productionResult.error.message);
    if (posResult.error) throw new Error(posResult.error.message);
    if (countsResult.error) throw new Error(countsResult.error.message);

    const used = new Map<string, number>();
    for (const row of [...(productionResult.data ?? []), ...(posResult.data ?? [])] as unknown as Allocation[]) {
      if (!row.purchase_item_id) continue;
      const quantity = convertStockQuantity(Number(row.quantity_base ?? 0), row.base_unit, unit);
      used.set(row.purchase_item_id, (used.get(row.purchase_item_id) ?? 0) + quantity);
    }

    const origins: StockOrigin[] = (lots ?? [])
      .map((lot) => {
        const purchase = Array.isArray(lot.purchases) ? lot.purchases[0] : lot.purchases;
        return {
          id: lot.id,
          available: Math.max(
            0,
            convertStockQuantity(Number(lot.quantity ?? 0), lot.unit as StockUnit, unit) - (used.get(lot.id) ?? 0)
          ),
          occurredAt: purchase?.purchased_at ?? "",
          expiration: lot.expiration_date ?? "",
          sequence: 0
        };
      })
      .sort((a, b) => {
        if (a.expiration && b.expiration && a.expiration !== b.expiration) return a.expiration.localeCompare(b.expiration);
        if (a.expiration && !b.expiration) return -1;
        if (!a.expiration && b.expiration) return 1;
        return a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id);
      });

    return applyAdjustments(
      origins,
      (countsResult.data ?? []) as Array<{ difference_quantity_base: number; base_unit: StockUnit; created_at: string }>,
      unit
    );
  }

  const { data: batches, error: batchesError } = await supabase
    .from("production_batches")
    .select("id, initial_quantity_base, base_unit, expiration_date, elaborated_at, production_number")
    .eq("preparation_id", sourceId);
  if (batchesError) throw new Error(batchesError.message);

  const ids = (batches ?? []).map((batch) => batch.id);
  const [productionResult, posResult, countsResult] = await Promise.all([
    ids.length
      ? supabase.from("production_consumption_allocations").select("production_batch_id, quantity_base, base_unit").in("production_batch_id", ids)
      : Promise.resolve({ data: [], error: null }),
    ids.length
      ? supabase
          .from("pos_order_consumption_allocations")
          .select("production_batch_id, quantity_base, base_unit, pos_order_consumptions!inner(pos_orders!inner(status))")
          .in("production_batch_id", ids)
          .neq("pos_order_consumptions.pos_orders.status", "cancelled")
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("physical_inventory_counts")
      .select("difference_quantity_base, base_unit, created_at")
      .eq("source_preparation_id", sourceId)
      .is("voided_at", null)
      .order("created_at", { ascending: true })
  ]);
  if (productionResult.error) throw new Error(productionResult.error.message);
  if (posResult.error) throw new Error(posResult.error.message);
  if (countsResult.error) throw new Error(countsResult.error.message);

  const used = new Map<string, number>();
  for (const row of [...(productionResult.data ?? []), ...(posResult.data ?? [])] as unknown as Allocation[]) {
    if (!row.production_batch_id) continue;
    const quantity = convertStockQuantity(Number(row.quantity_base ?? 0), row.base_unit, unit);
    used.set(row.production_batch_id, (used.get(row.production_batch_id) ?? 0) + quantity);
  }

  const origins: StockOrigin[] = (batches ?? [])
    .map((batch) => ({
      id: batch.id,
      available: Math.max(
        0,
        convertStockQuantity(Number(batch.initial_quantity_base ?? 0), batch.base_unit as StockUnit, unit) -
          (used.get(batch.id) ?? 0)
      ),
      occurredAt: batch.elaborated_at ?? "",
      expiration: batch.expiration_date ?? "",
      sequence: Number(batch.production_number ?? 0)
    }))
    .sort(
      (a, b) =>
        a.expiration.localeCompare(b.expiration) ||
        a.occurredAt.localeCompare(b.occurredAt) ||
        a.sequence - b.sequence
    );

  return applyAdjustments(
    origins,
    (countsResult.data ?? []) as Array<{ difference_quantity_base: number; base_unit: StockUnit; created_at: string }>,
    unit
  );
}
