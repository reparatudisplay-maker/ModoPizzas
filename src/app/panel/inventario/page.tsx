import { InventoryWorkspace, type InventoryCountHistoryRow, type InventoryListItem, type InventoryLotMovement, type InventoryPurchaseLine, type RegularizedConsumptionHistoryRow } from "@/components/inventory-workspace";
import { PanelShell } from "@/components/panel-shell";
import { buildProductionInventory, type ProductionAllocationInput, type ProductionBatchInput, type ProductionConsumptionInput, type ProductionLotOutboundInput, type ProductionTraceAllocationInput } from "@/lib/production-inventory";
import { requirePanelAccess } from "@/lib/panel-auth";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { convertStockQuantity } from "@/lib/units";

type StockUnit = "g" | "kg" | "ml" | "l" | "unit";
type ItemKind = "ingredient" | "sale_product" | "supply";

type PurchaseLineRow = {
  id: string;
  purchase_id: string;
  inventory_item_id: string;
  purchased_quantity: number | null;
  quantity: number;
  unit: StockUnit;
  presentation_quantity: number | null;
  presentation_unit: StockUnit | null;
  unit_cost_cop: number;
  line_total_cop: number;
  landed_total_cop: number | null;
  expiration_date: string | null;
  inventory_items: {
    id: string;
    sku: string | null;
    name: string;
    image_url: string | null;
    unit: StockUnit;
    item_kind: ItemKind | null;
    purchase_mode: "total_weight" | "packages" | null;
    brand_id: string | null;
    category_id: string | null;
    presentation_quantity: number | null;
    presentation_unit: StockUnit | null;
    is_active: boolean;
  } | null;
  purchases: {
    id: string;
    supplier_id: string | null;
    brand_id: string | null;
    purchased_at: string;
  } | null;
};

type PurchaseAllocationRow = {
  id: string;
  purchase_item_id: string | null;
  quantity_base: number;
  base_unit: StockUnit;
  created_at: string;
  production_consumptions?: {
    productions: { code: string } | { code: string }[] | null;
  } | null;
  pos_order_consumptions?: {
    order_item_id: string;
    pos_orders: { code: string } | { code: string }[] | null;
    pos_order_items: { product_name_snapshot: string; quantity: number } | { product_name_snapshot: string; quantity: number }[] | null;
  } | null;
};

type PhysicalInventoryCountRow = {
  id: string;
  source_kind: "inventory_item" | "preparation";
  inventory_item_id: string | null;
  source_preparation_id: string | null;
  theoretical_quantity_base: number;
  physical_quantity_base: number;
  difference_quantity_base: number;
  base_unit: StockUnit;
  average_cost_cop: number;
  adjustment_kind: "waste" | "adjustment_in";
  reason: string;
  created_at: string;
  created_by: string | null;
  inventory_items: { name: string } | null;
  preparations: { name: string } | null;
};

type StockReconciliationBaselineRow = {
  source_kind: "inventory_item" | "preparation";
  source_id: string;
  effective_at: string;
};

type RegularizationAllocationRow = {
  id: string;
  debt_id: string;
  purchase_item_id: string;
  quantity_base: number;
  base_unit: StockUnit;
  unit_cost_cop: number;
  cost_cop: number;
  created_at: string;
};

type RegularizationDebtHistoryRow = {
  id: string;
  order_id: string;
  source_id: string;
  status: "pending" | "regularized" | "voided";
  regularized_at: string | null;
  regularized_by: string | null;
};

type PosOrderCodeRow = { id: string; code: string };

type PosProductionOutboundRow = {
  id: string;
  production_batch_id: string;
  quantity_base: number;
  base_unit: StockUnit;
  created_at: string;
  pos_order_consumptions: {
    order_item_addition_id: string | null;
    order_item_id: string;
    pos_orders: { code: string } | { code: string }[] | null;
    pos_order_items: { product_name_snapshot: string; quantity: number } | { product_name_snapshot: string; quantity: number }[] | null;
  } | null;
};

type ProductionOutboundRow = {
  id: string;
  production_batch_id: string;
  quantity_base: number;
  base_unit: StockUnit;
  created_at: string;
  production_consumptions: {
    productions: { code: string } | { code: string }[] | null;
  } | null;
};

const INVENTORY_QUERY_PAGE_SIZE = 1000;

type PagedQueryResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PagedQueryResult<T>>
): Promise<PagedQueryResult<T>> {
  const rows: T[] = [];
  for (let from = 0; ; from += INVENTORY_QUERY_PAGE_SIZE) {
    const result = await fetchPage(from, from + INVENTORY_QUERY_PAGE_SIZE - 1);
    if (result.error) return { data: null, error: result.error };

    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < INVENTORY_QUERY_PAGE_SIZE) return { data: rows, error: null };
  }
}

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export const dynamic = "force-dynamic";

function isDirectImageUrl(value: string) {
  return value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:");
}

function lotCode(lineId: string) {
  return lineId.slice(0, 8).toUpperCase();
}

function masterKey(item: { name: string; item_kind?: string | null }) {
  return `${item.item_kind ?? ""}:${item.name.toUpperCase()}`;
}

function unitLabel(unit: string) {
  if (unit === "unit") return "UND";
  return unit.toUpperCase();
}

function presentationCode(quantity: number, unit: string) {
  const formatted = new Intl.NumberFormat("es-CO", {
    maximumFractionDigits: 3
  }).format(Number(quantity));
  return `${formatted} ${unitLabel(unit)}`.replace(/\s/g, "");
}

function baseProductName(name: string, quantity: number | null, unit: StockUnit | null) {
  if (!quantity || !unit) return name;
  const suffix = presentationCode(Number(quantity), unit);
  return name.replace(new RegExp(`\\s+${suffix}$`, "i"), "");
}

function toUnit(quantity: number, fromUnit: StockUnit, toUnit: StockUnit) {
  if (fromUnit === toUnit) return quantity;
  return convertStockQuantity(quantity, fromUnit, toUnit);
}

function sortInventoryLotsForAdjustment(a: InventoryPurchaseLine, b: InventoryPurchaseLine) {
  if (a.expiration_date && b.expiration_date && a.expiration_date !== b.expiration_date) {
    return a.expiration_date.localeCompare(b.expiration_date);
  }
  if (a.expiration_date && !b.expiration_date) return -1;
  if (!a.expiration_date && b.expiration_date) return 1;
  if (a.purchased_at !== b.purchased_at) return a.purchased_at.localeCompare(b.purchased_at);
  return a.id.localeCompare(b.id);
}

function applyPhysicalCountsToPurchaseLines(lines: InventoryPurchaseLine[], counts: PhysicalInventoryCountRow[]) {
  const adjustedLines = lines.map((line) => ({ ...line, quantity: 0, line_total_cop: 0 }));
  const lineById = new Map(adjustedLines.map((line) => [line.id, line]));

  for (const itemId of new Set(adjustedLines.map((line) => line.inventory_item_id))) {
    const itemLines = adjustedLines.filter((line) => line.inventory_item_id === itemId);
    const itemCounts = counts.filter((count) => count.source_kind === "inventory_item" && count.inventory_item_id === itemId);
    const events = [
      ...itemLines.map((line) => ({ at: line.purchased_at, kind: "entry" as const, line })),
      ...itemLines.flatMap((line) => line.movements
        .filter((movement) => movement.kind !== "adjustment")
        .map((movement) => ({ at: movement.occurred_at, kind: "consumption" as const, line, movement }))),
      ...itemCounts.map((count) => ({ at: count.created_at, kind: "count" as const, count }))
    ].sort((a, b) => {
      const time = a.at.localeCompare(b.at);
      if (time !== 0) return time;
      const order = { entry: 0, consumption: 1, count: 2 };
      return order[a.kind] - order[b.kind];
    });

    for (const event of events) {
      if (event.kind === "entry") {
        event.line.quantity = event.line.initial_quantity;
        event.line.line_total_cop = event.line.initial_quantity * event.line.unit_cost_cop;
        continue;
      }

      const eligibleLines = itemLines
        .filter((line) => line.purchased_at <= event.at)
        .sort(sortInventoryLotsForAdjustment);

      if (event.kind === "consumption") {
        let pending = toUnit(event.movement.quantity_base, event.movement.base_unit, event.line.unit);
        const target = lineById.get(event.line.id);
        const consume = (line: InventoryPurchaseLine) => {
          if (pending <= 0 || line.unit !== event.line.unit) return;
          const used = Math.min(line.quantity, pending);
          line.quantity = Math.max(0, line.quantity - used);
          line.line_total_cop = Math.max(0, line.line_total_cop - used * line.unit_cost_cop);
          pending -= used;
        };
        if (target) consume(target);
        for (const line of eligibleLines) {
          if (line.id !== target?.id) consume(line);
        }
        continue;
      }

      const delta = toUnit(event.count.difference_quantity_base, event.count.base_unit, itemLines[0]?.unit ?? event.count.base_unit);
      if (delta < 0) {
        let pending = Math.abs(delta);
        for (const line of eligibleLines) {
          if (pending <= 0) break;
          const used = Math.min(line.quantity, pending);
          line.quantity = Math.max(0, line.quantity - used);
          line.line_total_cop = Math.max(0, line.line_total_cop - used * line.unit_cost_cop);
          line.movements = [...line.movements, { id: `count-${event.count.id}-${line.id}`, kind: "adjustment", occurred_at: event.count.created_at, quantity_base: -used, base_unit: line.unit, reference: "Conteo físico", detail: event.count.reason }];
          pending -= used;
        }
      } else if (delta > 0 && eligibleLines[0]) {
        const line = eligibleLines[0];
        line.quantity += delta;
        line.line_total_cop += delta * line.unit_cost_cop;
        line.movements = [...line.movements, { id: `count-${event.count.id}-${line.id}`, kind: "adjustment", occurred_at: event.count.created_at, quantity_base: delta, base_unit: line.unit, reference: "Conteo físico", detail: event.count.reason }];
      }
    }
  }

  return adjustedLines;
}

export default async function InventoryPage() {
  const supabase = await createServerSupabaseClient();
  const { user, roleNames, moduleKeys } = await requirePanelAccess(supabase, "inventario");

  const [purchaseLinesResult, purchaseAllocationsResult, posPurchaseAllocationsResult, physicalCountsResult, masterItemsResult, brandsResult, suppliersResult, categoriesResult, profilesResult, reconciliationBaselinesResult, regularizationAllocationsResult, regularizationDebtsResult, orderCodesResult] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase
        .from("purchase_items")
        .select(
          "id, purchase_id, inventory_item_id, purchased_quantity, quantity, unit, presentation_quantity, presentation_unit, unit_cost_cop, line_total_cop, landed_total_cop, expiration_date, inventory_items(id, sku, name, image_url, unit, item_kind, purchase_mode, brand_id, category_id, presentation_quantity, presentation_unit, is_active), purchases(id, supplier_id, brand_id, purchased_at)"
        )
        .order("expiration_date", { ascending: true, nullsFirst: false })
        .order("id", { ascending: true })
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("production_consumption_allocations")
        .select("id, purchase_item_id, quantity_base, base_unit, created_at, production_consumptions!inner(productions!inner(code))")
        .not("purchase_item_id", "is", null)
        .order("id", { ascending: true })
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("pos_order_consumption_allocations")
        .select("id, purchase_item_id, quantity_base, base_unit, created_at, pos_order_consumptions!inner(order_item_id, pos_orders!inner(code, status), pos_order_items!inner(product_name_snapshot, quantity))")
        .not("purchase_item_id", "is", null)
        .neq("pos_order_consumptions.pos_orders.status", "cancelled")
        .order("id", { ascending: true })
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("physical_inventory_counts")
        .select("id, source_kind, inventory_item_id, source_preparation_id, theoretical_quantity_base, physical_quantity_base, difference_quantity_base, base_unit, average_cost_cop, adjustment_kind, reason, created_at, created_by, inventory_items(name), preparations(name)")
        .is("voided_at", null)
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to)
    ),
    supabase.from("inventory_items").select("id, name, image_url, item_kind").is("presentation_quantity", null),
    supabase.from("brands").select("id, name").order("name"),
    supabase.from("suppliers").select("id, name").order("name"),
    supabase.from("product_categories").select("id, name").order("name"),
    supabase.from("profiles").select("id, full_name, email"),
    supabase.from("inventory_stock_reconciliation_baselines").select("source_kind, source_id, effective_at"),
    supabase.from("pos_inventory_regularization_allocations").select("id, debt_id, purchase_item_id, quantity_base, base_unit, unit_cost_cop, cost_cop, created_at").order("created_at", { ascending: false }),
    supabase.from("pos_inventory_regularization_debts").select("id, order_id, source_id, status, regularized_at, regularized_by").neq("status", "voided"),
    supabase.from("pos_orders").select("id, code")
  ]);

  const error =
    purchaseLinesResult.error ??
    purchaseAllocationsResult.error ??
    posPurchaseAllocationsResult.error ??
    physicalCountsResult.error ??
    masterItemsResult.error ??
    brandsResult.error ??
    suppliersResult.error ??
    categoriesResult.error ??
    profilesResult.error ??
    reconciliationBaselinesResult.error ??
    regularizationAllocationsResult.error ??
    regularizationDebtsResult.error ??
    orderCodesResult.error;
  const purchaseLines = (purchaseLinesResult.data ?? []) as unknown as PurchaseLineRow[];
  const purchaseAllocations = [
    ...((purchaseAllocationsResult.data ?? []) as unknown as PurchaseAllocationRow[]),
    ...((posPurchaseAllocationsResult.data ?? []) as unknown as PurchaseAllocationRow[])
  ];
  const physicalCounts = (physicalCountsResult.data ?? []) as unknown as PhysicalInventoryCountRow[];
  const reconciliationBaselines = (reconciliationBaselinesResult.data ?? []) as StockReconciliationBaselineRow[];
  const regularizationAllocations = (regularizationAllocationsResult.data ?? []) as unknown as RegularizationAllocationRow[];
  const regularizationDebts = (regularizationDebtsResult.data ?? []) as unknown as RegularizationDebtHistoryRow[];
  const orderCodes = (orderCodesResult.data ?? []) as PosOrderCodeRow[];
  const masterItems = (masterItemsResult.data ?? []) as Array<{ id: string; name: string; image_url: string | null; item_kind: ItemKind | null }>;
  const brands = brandsResult.data ?? [];
  const suppliers = suppliersResult.data ?? [];
  const categories = categoriesResult.data ?? [];
  const profileById = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile.full_name?.trim() || profile.email?.trim() || profile.id.slice(0, 8).toUpperCase()]));
  const brandById = new Map(brands.map((brand) => [brand.id, brand.name]));
  const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier.name]));
  const categoryById = new Map(categories.map((category) => [category.id, category.name]));

  const masterByKey = new Map(masterItems.map((item) => [masterKey(item), item]));
  const productImagePaths = new Map<string, string | null>();
  masterItems.forEach((item) => productImagePaths.set(item.id, item.image_url));
  purchaseLines.forEach((line) => {
    if (line.inventory_items && !productImagePaths.has(line.inventory_items.id)) {
      productImagePaths.set(line.inventory_items.id, line.inventory_items.image_url);
    }
  });

  const signedImageEntries = await Promise.all(
    [...productImagePaths.entries()].map(async ([id, imageUrl]) => {
      if (!imageUrl || isDirectImageUrl(imageUrl)) {
        return [id, imageUrl] as const;
      }
      const { data } = await supabase.storage.from("product-images").createSignedUrl(imageUrl, 60 * 60);
      return [id, data?.signedUrl ?? null] as const;
    })
  );
  const imageSrcById = new Map(signedImageEntries);

  const [productionBatchesResult, productionAllocationsResult, posProductionAllocationsResult, productionConsumptionsResult, productionTraceAllocationsResult, posProductionOutboundResult, productionOutboundResult, productionItemsResult, productionPreparationsResult] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase
        .from("production_batches")
        .select("id, production_id, preparation_id, initial_quantity_base, base_unit, unit_cost_cop, expiration_date, elaborated_at, production_number, productions(id, code, storage_method, total_cost_cop, unit_cost_cop, created_by), preparations(id, name, image_url, unit_kind, base_unit, is_active)")
        .order("expiration_date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("production_consumption_allocations")
        .select("production_batch_id, quantity_base, base_unit, created_at")
        .order("id", { ascending: true })
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("pos_order_consumption_allocations")
        .select("production_batch_id, quantity_base, base_unit, created_at, pos_order_consumptions!inner(pos_orders!inner(status))")
        .not("production_batch_id", "is", null)
        .neq("pos_order_consumptions.pos_orders.status", "cancelled")
        .order("id", { ascending: true })
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("production_consumptions")
        .select("id, production_id, source_kind, inventory_item_id, source_preparation_id, quantity_base, base_unit, cost_cop")
        .order("id", { ascending: true })
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("production_consumption_allocations")
        .select("consumption_id, purchase_item_id, production_batch_id, quantity_base, base_unit, cost_cop")
        .order("id", { ascending: true })
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("pos_order_consumption_allocations")
        .select("id, production_batch_id, quantity_base, base_unit, created_at, pos_order_consumptions!inner(order_item_id, order_item_addition_id, pos_orders!inner(code, status), pos_order_items!inner(product_name_snapshot, quantity))")
        .not("production_batch_id", "is", null)
        .neq("pos_order_consumptions.pos_orders.status", "cancelled")
        .order("id", { ascending: true })
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("production_consumption_allocations")
        .select("id, production_batch_id, quantity_base, base_unit, created_at, production_consumptions!inner(productions!inner(code))")
        .not("production_batch_id", "is", null)
        .order("id", { ascending: true })
        .range(from, to)
    ),
    supabase.from("inventory_items").select("id, name"),
    supabase.from("preparations").select("id, name, image_url")
  ]);

  const productionError =
    productionBatchesResult.error ??
    productionAllocationsResult.error ??
    posProductionAllocationsResult.error ??
    productionConsumptionsResult.error ??
    productionTraceAllocationsResult.error ??
    posProductionOutboundResult.error ??
    productionOutboundResult.error ??
    productionItemsResult.error ??
    productionPreparationsResult.error;

  const productionPreparationImages = new Map((productionPreparationsResult.data ?? []).map((preparation) => [preparation.id, preparation.image_url as string | null]));
  const signedPreparationImageEntries = await Promise.all(
    [...productionPreparationImages.entries()].map(async ([id, imageUrl]) => {
      if (!imageUrl || isDirectImageUrl(imageUrl)) return [id, imageUrl] as const;
      const { data } = await supabase.storage.from("product-images").createSignedUrl(imageUrl, 60 * 60);
      return [id, data?.signedUrl ?? null] as const;
    })
  );
  const productionInventory = buildProductionInventory({
    batches: (productionBatchesResult.data ?? []) as unknown as ProductionBatchInput[],
    allocations: [
      ...((productionAllocationsResult.data ?? []) as ProductionAllocationInput[]),
      ...((posProductionAllocationsResult.data ?? []) as ProductionAllocationInput[])
    ],
    consumptions: (productionConsumptionsResult.data ?? []) as ProductionConsumptionInput[],
    traceAllocations: (productionTraceAllocationsResult.data ?? []) as ProductionTraceAllocationInput[],
    physicalAdjustments: physicalCounts
      .filter((count) => count.source_kind === "preparation")
      .map((count) => ({
        source_preparation_id: count.source_preparation_id,
        difference_quantity_base: Number(count.difference_quantity_base ?? 0),
        physical_quantity_base: Number(count.physical_quantity_base ?? 0),
        base_unit: count.base_unit,
        created_at: count.created_at
      })),
    outboundConsumptions: [
      ...((posProductionOutboundResult.data ?? []) as unknown as PosProductionOutboundRow[]).map((allocation) => {
        const consumption = allocation.pos_order_consumptions;
        const order = firstRelation(consumption?.pos_orders);
        const item = firstRelation(consumption?.pos_order_items);
        return {
          id: allocation.id,
          production_batch_id: allocation.production_batch_id,
          quantity_base: Number(allocation.quantity_base ?? 0),
          base_unit: allocation.base_unit,
          occurred_at: allocation.created_at,
          kind: "sale" as const,
          order_code: order?.code ?? "Pedido",
          order_item_id: consumption?.order_item_id ?? null,
          pizza_name: item?.product_name_snapshot ?? "Pizza no disponible",
          pizza_quantity: Number(item?.quantity ?? 0)
        };
      }),
      ...((productionOutboundResult.data ?? []) as unknown as ProductionOutboundRow[]).map((allocation) => ({
        id: allocation.id,
        production_batch_id: allocation.production_batch_id,
        quantity_base: Number(allocation.quantity_base ?? 0),
        base_unit: allocation.base_unit,
        occurred_at: allocation.created_at,
        kind: "production" as const,
        production_code: firstRelation(allocation.production_consumptions?.productions)?.code ?? "Produccion"
      }))
    ] satisfies ProductionLotOutboundInput[],
    inventoryNames: new Map((productionItemsResult.data ?? []).map((item) => [item.id, item.name])),
    preparationNames: new Map((productionPreparationsResult.data ?? []).map((preparation) => [preparation.id, preparation.name])),
    imageSrcByPreparationId: new Map(signedPreparationImageEntries)
  });

  const purchaseAllocatedByLine = new Map<string, number>();
  const purchaseMovementsByLine = new Map<string, InventoryLotMovement[]>();
  for (const allocation of purchaseAllocations) {
    if (!allocation.purchase_item_id) continue;
    const current = purchaseAllocatedByLine.get(allocation.purchase_item_id) ?? 0;
    purchaseAllocatedByLine.set(allocation.purchase_item_id, current + Number(allocation.quantity_base ?? 0));

    const production = firstRelation(allocation.production_consumptions?.productions);
    const order = firstRelation(allocation.pos_order_consumptions?.pos_orders);
    const orderItem = firstRelation(allocation.pos_order_consumptions?.pos_order_items);
    const movement: InventoryLotMovement = production
      ? {
          id: allocation.id,
          kind: "production",
          occurred_at: allocation.created_at,
          quantity_base: Number(allocation.quantity_base ?? 0),
          base_unit: allocation.base_unit,
          reference: production.code,
          detail: "Consumo para producción"
        }
      : {
          id: allocation.id,
          kind: "sale",
          occurred_at: allocation.created_at,
          quantity_base: Number(allocation.quantity_base ?? 0),
          base_unit: allocation.base_unit,
          reference: order?.code ?? "Pedido",
          detail: orderItem ? `${orderItem.product_name_snapshot} · ${orderItem.quantity} ${Number(orderItem.quantity) === 1 ? "unidad" : "unidades"}` : "Consumo en pedido"
        };
    purchaseMovementsByLine.set(allocation.purchase_item_id, [...(purchaseMovementsByLine.get(allocation.purchase_item_id) ?? []), movement]);
  }

  const overdrawnPurchaseLineIds = new Set<string>();
  const baseLineItems: InventoryPurchaseLine[] = purchaseLines
    .filter((line) => line.inventory_items && line.purchases)
    .map((line) => {
      const item = line.inventory_items!;
      const purchase = line.purchases!;
      const displayName = baseProductName(item.name, line.presentation_quantity, line.presentation_unit);
      const masterItem = masterByKey.get(`${item.item_kind ?? ""}:${displayName.toUpperCase()}`) ?? masterByKey.get(masterKey(item));
      const imageItemId = masterItem?.image_url ? masterItem.id : item.id;
      const purchaseBrand = purchase.brand_id ? brandById.get(purchase.brand_id) ?? null : null;
      const productBrand = item.brand_id ? brandById.get(item.brand_id) ?? null : null;
      const allocatedRaw = purchaseAllocatedByLine.get(line.id) ?? 0;
      let allocatedQuantity = allocatedRaw;
      if (allocatedRaw > 0 && line.unit !== "unit") {
        try {
          allocatedQuantity = convertStockQuantity(allocatedRaw, "g", line.unit);
        } catch {
          try {
            allocatedQuantity = convertStockQuantity(allocatedRaw, "ml", line.unit);
          } catch {
            allocatedQuantity = allocatedRaw;
          }
        }
      }
      const originalQuantity = Number(line.quantity ?? 0);
      if (allocatedQuantity > originalQuantity) overdrawnPurchaseLineIds.add(line.id);
      const availableQuantity = Math.max(0, originalQuantity - allocatedQuantity);
      const landedTotal = Number(line.landed_total_cop ?? line.line_total_cop ?? 0);
      const unitCost = originalQuantity > 0 ? landedTotal / originalQuantity : 0;
      const availableTotal = originalQuantity > 0 ? landedTotal * availableQuantity / originalQuantity : 0;
      return {
        id: line.id,
        purchase_id: line.purchase_id,
        inventory_item_id: item.id,
        product_name: displayName,
        sku: item.sku,
        image_src: imageSrcById.get(imageItemId) ?? null,
        item_kind: item.item_kind,
        purchase_mode: item.purchase_mode ?? "total_weight",
        purchased_quantity: line.purchased_quantity,
        initial_quantity: originalQuantity,
        unit: line.unit,
        quantity: availableQuantity,
        presentation_quantity: line.presentation_quantity,
        presentation_unit: line.presentation_unit,
        product_presentation_quantity: item.presentation_quantity,
        product_presentation_unit: item.presentation_unit,
        unit_cost_cop: unitCost,
        line_total_cop: availableTotal,
        expiration_date: line.expiration_date,
        purchased_at: purchase.purchased_at,
        supplier_name: purchase.supplier_id ? supplierById.get(purchase.supplier_id) ?? null : null,
        brand_name: purchaseBrand ?? productBrand,
        category_name: item.category_id ? categoryById.get(item.category_id) ?? null : null,
        lot_code: lotCode(line.id),
        is_active: item.is_active,
        movements: purchaseMovementsByLine.get(line.id) ?? []
      };
    });
  const lineItems = applyPhysicalCountsToPurchaseLines(baseLineItems, physicalCounts);

  for (const baseline of reconciliationBaselines.filter((row) => row.source_kind === "inventory_item")) {
    const affectedLots = new Set(
      baseLineItems
        .filter((line) => line.inventory_item_id === baseline.source_id && overdrawnPurchaseLineIds.has(line.id))
        .map((line) => line.id)
    );
    if (affectedLots.size === 0) continue;

    const countLine = lineItems
      .filter((line) =>
        line.inventory_item_id === baseline.source_id &&
        line.id.startsWith("count-") &&
        line.purchased_at <= baseline.effective_at &&
        line.initial_quantity > 0
      )
      .sort((a, b) => b.purchased_at.localeCompare(a.purchased_at))[0];
    if (!countLine) continue;

    const consumed = purchaseAllocations
      .filter((allocation) => affectedLots.has(allocation.purchase_item_id ?? "") && allocation.created_at >= baseline.effective_at)
      .reduce((total, allocation) => total + toUnit(Number(allocation.quantity_base ?? 0), allocation.base_unit, countLine.unit), 0);
    if (consumed <= 0) continue;

    const availableBefore = countLine.quantity;
    const deducted = Math.min(availableBefore, consumed);
    countLine.quantity = Math.max(0, availableBefore - deducted);
    countLine.line_total_cop = availableBefore > 0
      ? countLine.line_total_cop * (countLine.quantity / availableBefore)
      : 0;
  }

  const groupedItems = new Map<string, InventoryListItem>();
  for (const line of lineItems) {
    const current = groupedItems.get(line.inventory_item_id);
    if (!current) {
      groupedItems.set(line.inventory_item_id, {
        id: line.inventory_item_id,
        product_name: line.product_name,
        sku: line.sku,
        image_src: line.image_src,
        item_kind: line.item_kind,
        unit: line.unit,
        presentation_quantity: line.product_presentation_quantity,
        presentation_unit: line.product_presentation_unit,
        stock: line.quantity,
        total_cost_cop: line.line_total_cop,
        average_cost_cop: line.quantity > 0 ? line.line_total_cop / line.quantity : 0,
        inventory_value_cop: line.line_total_cop,
        is_active: line.is_active,
        brand_name: line.brand_name,
        category_name: line.category_name,
        supplier_name: line.supplier_name,
        nearest_expiration: line.expiration_date,
        last_purchase: line.purchased_at,
        lines: [line]
      });
      continue;
    }

    current.stock += line.quantity;
    current.total_cost_cop += line.line_total_cop;
    current.average_cost_cop = current.stock > 0 ? current.total_cost_cop / current.stock : 0;
    current.inventory_value_cop = current.total_cost_cop;
    current.lines.push(line);
    if (line.purchased_at > (current.last_purchase ?? "")) {
      current.last_purchase = line.purchased_at;
      current.supplier_name = line.supplier_name;
    }
    if (line.expiration_date && (!current.nearest_expiration || line.expiration_date < current.nearest_expiration)) {
      current.nearest_expiration = line.expiration_date;
    }
  }

  const countHistory: InventoryCountHistoryRow[] = physicalCounts.map((count) => ({
    id: count.id,
    created_at: count.created_at,
    product_name: count.source_kind === "preparation" ? count.preparations?.name ?? "Preparacion no disponible" : count.inventory_items?.name ?? "Producto no disponible",
    source_label: count.source_kind === "preparation" ? "Preparacion" : "Producto",
    source_kind: count.source_kind,
    theoretical_quantity_base: Number(count.theoretical_quantity_base ?? 0),
    physical_quantity_base: Number(count.physical_quantity_base ?? 0),
    difference_quantity_base: Number(count.difference_quantity_base ?? 0),
    base_unit: count.base_unit,
    adjustment_kind: count.adjustment_kind,
    reason: count.reason,
    user_label: count.created_by ? profileById.get(count.created_by) ?? count.created_by.slice(0, 8).toUpperCase() : "Sistema"
  }));
  const regularizationDebtById = new Map(regularizationDebts.map((debt) => [debt.id, debt]));
  const orderCodeById = new Map(orderCodes.map((order) => [order.id, order.code]));
  const itemNameById = new Map(purchaseLines.map((line) => [line.inventory_item_id, line.inventory_items?.name ?? "Producto no disponible"]));
  const lotById = new Map(purchaseLines.map((line) => [line.id, line]));
  const regularizedConsumptionHistory: RegularizedConsumptionHistoryRow[] = regularizationAllocations.flatMap((allocation) => {
    const debt = regularizationDebtById.get(allocation.debt_id);
    if (!debt) return [];
    const lot = lotById.get(allocation.purchase_item_id);
    return [{
      id: allocation.id,
      created_at: allocation.created_at,
      product_name: itemNameById.get(debt.source_id) ?? "Producto no disponible",
      order_code: orderCodeById.get(debt.order_id) ?? "Pedido no disponible",
      quantity_base: Number(allocation.quantity_base ?? 0),
      base_unit: allocation.base_unit,
      lot_label: lot ? `${lotCode(lot.id)} · ${lot.purchases?.purchased_at ? new Date(lot.purchases.purchased_at).toLocaleDateString("es-CO") : "Sin fecha"}` : allocation.purchase_item_id.slice(0, 8).toUpperCase(),
      cost_cop: Number(allocation.cost_cop ?? 0),
      status: debt.status === "regularized" ? "Regularizado" : "Parcial",
      user_label: debt.regularized_by ? profileById.get(debt.regularized_by) ?? debt.regularized_by.slice(0, 8).toUpperCase() : "Sistema"
    }];
  });

  return (
    <PanelShell active="inventario" hideHeader moduleKeys={moduleKeys} roleNames={roleNames} title="Inventario" userEmail={user.email ?? "usuario"}>
      {error ? <p className="alert">{error.message}</p> : null}
      {productionError ? <p className="alert">{productionError.message}</p> : null}
      <InventoryWorkspace countHistory={countHistory} items={[...groupedItems.values()]} preparationItems={productionInventory.items} purchaseLines={lineItems} regularizedConsumptionHistory={regularizedConsumptionHistory} />
    </PanelShell>
  );
}
