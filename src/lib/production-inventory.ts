import type { StockUnit } from "@/lib/units";

export type ProductionStorageMethod = "ambient" | "refrigerated" | "frozen";
export type ProductionUnitKind = "weight" | "volume" | "unit";
export type ProductionSourceKind = "inventory_item" | "preparation";

export type ProductionBatchInput = {
  id: string;
  production_id: string | null;
  preparation_id: string;
  initial_quantity_base: number;
  base_unit: StockUnit;
  unit_cost_cop: number;
  expiration_date: string;
  elaborated_at: string;
  production_number: number | null;
  productions: {
    id: string;
    code: string;
    storage_method: ProductionStorageMethod;
    total_cost_cop: number;
    unit_cost_cop: number;
    created_by: string | null;
  } | null;
  preparations: {
    id: string;
    name: string;
    image_url: string | null;
    unit_kind: ProductionUnitKind;
    base_unit: StockUnit;
    is_active: boolean;
  } | null;
};

export type ProductionAllocationInput = {
  production_batch_id: string | null;
  quantity_base: number;
  base_unit: StockUnit;
};

export type ProductionConsumptionInput = {
  id: string;
  production_id: string;
  source_kind: ProductionSourceKind;
  inventory_item_id: string | null;
  source_preparation_id: string | null;
  quantity_base: number;
  base_unit: StockUnit;
  cost_cop: number;
};

export type ProductionTraceAllocationInput = {
  consumption_id: string;
  purchase_item_id: string | null;
  production_batch_id: string | null;
  quantity_base: number;
  base_unit: StockUnit;
  cost_cop: number;
};

export type ProductionTraceSource = {
  id: string;
  source_kind: ProductionSourceKind;
  source_name: string;
  quantity_base: number;
  base_unit: StockUnit;
  cost_cop: number;
  allocations: Array<{
    id: string;
    origin_label: string;
    quantity_base: number;
    base_unit: StockUnit;
    cost_cop: number;
  }>;
};

export type ProductionInventoryLot = {
  id: string;
  production_id: string;
  code: string;
  production_number: number;
  preparation_id: string;
  preparation_name: string;
  image_src: string | null;
  unit_kind: ProductionUnitKind;
  base_unit: StockUnit;
  is_active: boolean;
  storage_method: ProductionStorageMethod;
  elaborated_at: string;
  expiration_date: string;
  initial_quantity_base: number;
  stock_base: number;
  total_cost_cop: number;
  unit_cost_cop: number;
  inventory_value_cop: number;
  created_by: string | null;
  ingredients_consumed: ProductionTraceSource[];
};

export type ProductionInventoryItem = {
  id: string;
  preparation_name: string;
  image_src: string | null;
  unit_kind: ProductionUnitKind;
  base_unit: StockUnit;
  stock_base: number;
  average_cost_cop: number;
  inventory_value_cop: number;
  nearest_expiration: string | null;
  available_lots_count: number;
  is_active: boolean;
  lots: ProductionInventoryLot[];
};

export function productionAllocationSum(allocations: ProductionAllocationInput[], batchId: string) {
  return allocations
    .filter((allocation) => allocation.production_batch_id === batchId)
    .reduce((sum, allocation) => sum + Number(allocation.quantity_base ?? 0), 0);
}

export function productionLotStatus(lot: Pick<ProductionInventoryLot, "stock_base" | "expiration_date">) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
  if (lot.stock_base <= 0) return { key: "out", label: "Agotado", className: "danger" };
  if (lot.expiration_date < today) return { key: "expired", label: "Vencido", className: "danger" };
  if (lot.expiration_date === today) return { key: "today", label: "Vence hoy", className: "warning" };
  const date = new Date(`${lot.expiration_date}T00:00:00`);
  const limit = new Date(`${today}T00:00:00`);
  limit.setDate(limit.getDate() + 7);
  if (date <= limit) return { key: "soon", label: "Proximo a vencer", className: "warning" };
  return { key: "available", label: "Disponible", className: "ok" };
}

export function productionItemStatus(item: ProductionInventoryItem) {
  if (item.stock_base <= 0) return { key: "out", label: "Agotado", className: "danger" };
  const availableLots = item.lots.filter((lot) => lot.stock_base > 0);
  if (availableLots.some((lot) => productionLotStatus(lot).key === "expired")) return { key: "expired", label: "Vencido", className: "danger" };
  if (availableLots.some((lot) => productionLotStatus(lot).key === "today" || productionLotStatus(lot).key === "soon")) {
    return { key: "soon", label: "Proximo a vencer", className: "warning" };
  }
  if (item.stock_base <= 5) return { key: "low", label: "Bajo", className: "warning" };
  return { key: "available", label: "Disponible", className: "ok" };
}

export function buildProductionInventory({
  batches,
  allocations,
  consumptions,
  traceAllocations,
  inventoryNames,
  preparationNames,
  imageSrcByPreparationId = new Map()
}: {
  batches: ProductionBatchInput[];
  allocations: ProductionAllocationInput[];
  consumptions: ProductionConsumptionInput[];
  traceAllocations: ProductionTraceAllocationInput[];
  inventoryNames: Map<string, string>;
  preparationNames: Map<string, string>;
  imageSrcByPreparationId?: Map<string, string | null>;
}) {
  const traceAllocationsByConsumption = new Map<string, ProductionTraceAllocationInput[]>();
  for (const allocation of traceAllocations) {
    traceAllocationsByConsumption.set(allocation.consumption_id, [
      ...(traceAllocationsByConsumption.get(allocation.consumption_id) ?? []),
      allocation
    ]);
  }

  const consumptionsByProduction = new Map<string, ProductionTraceSource[]>();
  for (const consumption of consumptions) {
    const sourceName =
      consumption.source_kind === "preparation" && consumption.source_preparation_id
        ? preparationNames.get(consumption.source_preparation_id)
        : consumption.inventory_item_id
          ? inventoryNames.get(consumption.inventory_item_id)
          : null;
    const details = (traceAllocationsByConsumption.get(consumption.id) ?? []).map((allocation) => ({
      id: `${consumption.id}:${allocation.purchase_item_id ?? allocation.production_batch_id ?? "origen"}`,
      origin_label: allocation.purchase_item_id
        ? `Compra ${allocation.purchase_item_id.slice(0, 8).toUpperCase()}`
        : `Lote ${allocation.production_batch_id ? allocation.production_batch_id.slice(0, 8).toUpperCase() : "-"}`,
      quantity_base: Number(allocation.quantity_base ?? 0),
      base_unit: allocation.base_unit,
      cost_cop: Number(allocation.cost_cop ?? 0)
    }));

    consumptionsByProduction.set(consumption.production_id, [
      ...(consumptionsByProduction.get(consumption.production_id) ?? []),
      {
        id: consumption.id,
        source_kind: consumption.source_kind,
        source_name: sourceName ?? (consumption.source_kind === "preparation" ? "Preparacion no disponible" : "Ingrediente no disponible"),
        quantity_base: Number(consumption.quantity_base ?? 0),
        base_unit: consumption.base_unit,
        cost_cop: Number(consumption.cost_cop ?? 0),
        allocations: details
      }
    ]);
  }

  const lots = batches
    .filter((batch) => batch.production_id && batch.productions && batch.preparations)
    .map((batch) => {
      const initialQuantity = Number(batch.initial_quantity_base ?? 0);
      const consumedQuantity = productionAllocationSum(allocations, batch.id);
      const stock = Math.max(0, initialQuantity - consumedQuantity);
      const unitCost = Number(batch.unit_cost_cop ?? 0);
      return {
        id: batch.id,
        production_id: batch.production_id!,
        code: batch.productions!.code,
        production_number: Number(batch.production_number ?? 0),
        preparation_id: batch.preparation_id,
        preparation_name: batch.preparations!.name,
        image_src: imageSrcByPreparationId.get(batch.preparation_id) ?? batch.preparations!.image_url,
        unit_kind: batch.preparations!.unit_kind,
        base_unit: batch.base_unit,
        is_active: batch.preparations!.is_active,
        storage_method: batch.productions!.storage_method,
        elaborated_at: batch.elaborated_at,
        expiration_date: batch.expiration_date,
        initial_quantity_base: initialQuantity,
        stock_base: stock,
        total_cost_cop: Number(batch.productions!.total_cost_cop ?? initialQuantity * unitCost),
        unit_cost_cop: unitCost,
        inventory_value_cop: stock * unitCost,
        created_by: batch.productions!.created_by,
        ingredients_consumed: consumptionsByProduction.get(batch.production_id!) ?? []
      } satisfies ProductionInventoryLot;
    })
    .sort((a, b) => {
      const expirationOrder = a.expiration_date.localeCompare(b.expiration_date);
      if (expirationOrder !== 0) return expirationOrder;
      const elaboratedOrder = a.elaborated_at.localeCompare(b.elaborated_at);
      if (elaboratedOrder !== 0) return elaboratedOrder;
      return a.production_number - b.production_number;
    });

  const itemsByPreparation = new Map<string, ProductionInventoryItem>();
  for (const lot of lots) {
    const current = itemsByPreparation.get(lot.preparation_id);
    if (!current) {
      itemsByPreparation.set(lot.preparation_id, {
        id: lot.preparation_id,
        preparation_name: lot.preparation_name,
        image_src: lot.image_src,
        unit_kind: lot.unit_kind,
        base_unit: lot.base_unit,
        stock_base: lot.stock_base,
        average_cost_cop: lot.stock_base > 0 ? lot.inventory_value_cop / lot.stock_base : 0,
        inventory_value_cop: lot.inventory_value_cop,
        nearest_expiration: lot.stock_base > 0 ? lot.expiration_date : null,
        available_lots_count: lot.stock_base > 0 ? 1 : 0,
        is_active: lot.is_active,
        lots: [lot]
      });
      continue;
    }

    current.stock_base += lot.stock_base;
    current.inventory_value_cop += lot.inventory_value_cop;
    current.available_lots_count += lot.stock_base > 0 ? 1 : 0;
    current.average_cost_cop = current.stock_base > 0 ? current.inventory_value_cop / current.stock_base : 0;
    current.lots.push(lot);
    if (lot.stock_base > 0 && (!current.nearest_expiration || lot.expiration_date < current.nearest_expiration)) {
      current.nearest_expiration = lot.expiration_date;
    }
  }

  return {
    lots,
    items: [...itemsByPreparation.values()].sort((a, b) => a.preparation_name.localeCompare(b.preparation_name))
  };
}
