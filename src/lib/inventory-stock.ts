import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { convertStockQuantity, type StockUnit } from "@/lib/units";

type ServerSupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;
type AdminSupabaseClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
type StockSupabaseClient = ServerSupabaseClient | AdminSupabaseClient;
type PagedQueryResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

const STOCK_QUERY_PAGE_SIZE = 1000;

async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PagedQueryResult<T>>
): Promise<PagedQueryResult<T>> {
  const rows: T[] = [];
  for (let from = 0; ; from += STOCK_QUERY_PAGE_SIZE) {
    const result = await fetchPage(from, from + STOCK_QUERY_PAGE_SIZE - 1);
    if (result.error) return { data: null, error: result.error };

    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < STOCK_QUERY_PAGE_SIZE) return { data: rows, error: null };
  }
}

type Allocation = {
  purchase_item_id?: string | null;
  production_batch_id?: string | null;
  quantity_base: number;
  base_unit: StockUnit;
  created_at?: string;
};

export type StockOrigin = {
  id: string;
  available: number;
  occurredAt: string;
  expiration: string;
  sequence: number;
};

export type PhysicalStockAdjustment = {
  difference_quantity_base: number;
  base_unit: StockUnit;
  created_at: string;
};

export type AppliedPhysicalStockAdjustment = {
  occurred_at: string;
  quantity: number;
};

export type StockReconciliationBaseline = {
  source_kind: "inventory_item" | "preparation";
  source_id: string;
  effective_at: string;
};

export function applyStockReconciliationBaseline(
  origins: StockOrigin[],
  originStock: Map<string, number>,
  allocations: Allocation[],
  baseline: StockReconciliationBaseline | null,
  unit: StockUnit
) {
  if (!baseline) return originStock;

  for (const origin of origins) {
    if (origin.available > 0) continue;
    const consumed = allocations
      .filter((allocation) => {
        const originId = baseline.source_kind === "inventory_item"
          ? allocation.purchase_item_id
          : allocation.production_batch_id;
        return originId === origin.id && (allocation.created_at ?? "") >= baseline.effective_at;
      })
      .reduce(
        (total, allocation) => total + convertStockQuantity(Number(allocation.quantity_base ?? 0), allocation.base_unit, unit),
        0
      );
    if (consumed > 0) {
      originStock.set(origin.id, Math.max(0, (originStock.get(origin.id) ?? 0) - consumed));
    }
  }

  return originStock;
}

// Mirrors app_private.inventory_source_lots: adjustments are distributed only
// across origins that already existed when the physical count was recorded.
export function applyPhysicalStockAdjustments(
  origins: StockOrigin[],
  counts: PhysicalStockAdjustment[],
  unit: StockUnit
) {
  const stockByOrigin = new Map(origins.map((origin) => [origin.id, origin.available]));
  const adjustmentsByOrigin = new Map<string, AppliedPhysicalStockAdjustment[]>();
  const recordAdjustment = (originId: string, quantity: number, occurredAt: string) => {
    if (quantity === 0) return;
    adjustmentsByOrigin.set(originId, [
      ...(adjustmentsByOrigin.get(originId) ?? []),
      { occurred_at: occurredAt, quantity }
    ]);
  };
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
        recordAdjustment(origin.id, -waste, count.created_at);
        pending -= waste;
      }
    } else if (adjustment > 0 && eligible[0]) {
      const origin = eligible[0];
      stockByOrigin.set(origin.id, (stockByOrigin.get(origin.id) ?? 0) + adjustment);
      recordAdjustment(origin.id, adjustment, count.created_at);
    }
  }

  const stock = [...stockByOrigin.values()].reduce((sum, value) => sum + value, 0);
  return { stock: Number(stock.toFixed(6)), originStock: stockByOrigin, adjustmentsByOrigin };
}

export async function getAdjustedSourceStock(
  supabase: StockSupabaseClient,
  sourceKind: "inventory_item" | "preparation",
  sourceId: string,
  unit: StockUnit
) {
  if (sourceKind === "inventory_item") {
    const { data: lots, error: lotsError } = await fetchAllRows((from, to) =>
      supabase
        .from("purchase_items")
        .select("id, quantity, unit, expiration_date, purchases(purchased_at)")
        .eq("inventory_item_id", sourceId)
        .order("id", { ascending: true })
        .range(from, to)
    );
    if (lotsError) throw new Error(lotsError.message);

    const ids = (lots ?? []).map((lot) => lot.id);
    const [productionResult, posResult, countsResult, baselineResult] = await Promise.all([
      ids.length
        ? fetchAllRows((from, to) =>
            supabase
              .from("production_consumption_allocations")
              .select("purchase_item_id, quantity_base, base_unit, created_at")
              .in("purchase_item_id", ids)
              .order("id", { ascending: true })
              .range(from, to)
          )
        : Promise.resolve({ data: [], error: null }),
      ids.length
        ? fetchAllRows((from, to) =>
            supabase
              .from("pos_order_consumption_allocations")
              .select("purchase_item_id, quantity_base, base_unit, created_at, pos_order_consumptions!inner(pos_orders!inner(status))")
              .in("purchase_item_id", ids)
              .neq("pos_order_consumptions.pos_orders.status", "cancelled")
              .order("id", { ascending: true })
              .range(from, to)
          )
        : Promise.resolve({ data: [], error: null }),
      fetchAllRows((from, to) =>
        supabase
          .from("physical_inventory_counts")
          .select("difference_quantity_base, base_unit, created_at")
          .eq("inventory_item_id", sourceId)
          .is("voided_at", null)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to)
      ),
      supabase
        .from("inventory_stock_reconciliation_baselines")
        .select("source_kind, source_id, effective_at")
        .eq("source_kind", sourceKind)
        .eq("source_id", sourceId)
        .maybeSingle()
    ]);
    if (productionResult.error) throw new Error(productionResult.error.message);
    if (posResult.error) throw new Error(posResult.error.message);
    if (countsResult.error) throw new Error(countsResult.error.message);
    if (baselineResult.error) throw new Error(baselineResult.error.message);

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

    const adjusted = applyPhysicalStockAdjustments(
      origins,
      (countsResult.data ?? []) as PhysicalStockAdjustment[],
      unit
    );
    const originStock = applyStockReconciliationBaseline(
      origins,
      adjusted.originStock,
      [...(productionResult.data ?? []), ...(posResult.data ?? [])] as unknown as Allocation[],
      (baselineResult.data ?? null) as StockReconciliationBaseline | null,
      unit
    );
    return {
      ...adjusted,
      originStock,
      stock: Number([...originStock.values()].reduce((total, value) => total + value, 0).toFixed(6))
    };
  }

  const { data: batches, error: batchesError } = await fetchAllRows((from, to) =>
    supabase
      .from("production_batches")
      .select("id, initial_quantity_base, base_unit, expiration_date, elaborated_at, production_number")
      .eq("preparation_id", sourceId)
      .order("id", { ascending: true })
      .range(from, to)
  );
  if (batchesError) throw new Error(batchesError.message);

  const ids = (batches ?? []).map((batch) => batch.id);
  const [productionResult, posResult, countsResult, baselineResult] = await Promise.all([
    ids.length
      ? fetchAllRows((from, to) =>
          supabase
            .from("production_consumption_allocations")
            .select("production_batch_id, quantity_base, base_unit, created_at")
            .in("production_batch_id", ids)
            .order("id", { ascending: true })
            .range(from, to)
        )
      : Promise.resolve({ data: [], error: null }),
    ids.length
      ? fetchAllRows((from, to) =>
          supabase
            .from("pos_order_consumption_allocations")
            .select("production_batch_id, quantity_base, base_unit, created_at, pos_order_consumptions!inner(pos_orders!inner(status))")
            .in("production_batch_id", ids)
            .neq("pos_order_consumptions.pos_orders.status", "cancelled")
            .order("id", { ascending: true })
            .range(from, to)
        )
      : Promise.resolve({ data: [], error: null }),
    fetchAllRows((from, to) =>
      supabase
        .from("physical_inventory_counts")
        .select("difference_quantity_base, base_unit, created_at")
        .eq("source_preparation_id", sourceId)
        .is("voided_at", null)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
    ),
    supabase
      .from("inventory_stock_reconciliation_baselines")
      .select("source_kind, source_id, effective_at")
      .eq("source_kind", sourceKind)
      .eq("source_id", sourceId)
      .maybeSingle()
  ]);
  if (productionResult.error) throw new Error(productionResult.error.message);
  if (posResult.error) throw new Error(posResult.error.message);
  if (countsResult.error) throw new Error(countsResult.error.message);
  if (baselineResult.error) throw new Error(baselineResult.error.message);

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

  const adjusted = applyPhysicalStockAdjustments(
    origins,
    (countsResult.data ?? []) as PhysicalStockAdjustment[],
    unit
  );
  const originStock = applyStockReconciliationBaseline(
    origins,
    adjusted.originStock,
    [...(productionResult.data ?? []), ...(posResult.data ?? [])] as unknown as Allocation[],
    (baselineResult.data ?? null) as StockReconciliationBaseline | null,
    unit
  );
  return {
    ...adjusted,
    originStock,
    stock: Number([...originStock.values()].reduce((total, value) => total + value, 0).toFixed(6))
  };
}
