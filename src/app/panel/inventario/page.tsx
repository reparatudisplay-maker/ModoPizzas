import { notFound, redirect } from "next/navigation";
import { InventoryWorkspace, type InventoryCountHistoryRow, type InventoryListItem, type InventoryPurchaseLine } from "@/components/inventory-workspace";
import { PanelShell } from "@/components/panel-shell";
import { buildProductionInventory, type ProductionAllocationInput, type ProductionBatchInput, type ProductionConsumptionInput, type ProductionTraceAllocationInput } from "@/lib/production-inventory";
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
  purchase_item_id: string | null;
  quantity_base: number;
  base_unit: StockUnit;
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

const managerRoles = new Set(["gerente", "admin_sistema"]);

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
  const adjustedLines = lines.map((line) => ({ ...line }));
  const inventoryCounts = counts
    .filter((count) => count.source_kind === "inventory_item" && count.inventory_item_id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  for (const count of inventoryCounts) {
    const itemId = count.inventory_item_id!;
    const baseUnit = count.base_unit;
    const itemLines = adjustedLines.filter((line) => line.inventory_item_id === itemId);
    if (itemLines.length === 0) continue;

    const currentStockBase = itemLines.reduce((total, line) => total + toUnit(Number(line.quantity ?? 0), line.unit, baseUnit), 0);
    const targetStockBase = Number(count.physical_quantity_base ?? 0);
    const deltaBase = Number((targetStockBase - currentStockBase).toFixed(3));
    if (deltaBase === 0) continue;

    if (deltaBase < 0) {
      let pendingBase = Math.abs(deltaBase);
      const orderedLines = [...itemLines].sort(sortInventoryLotsForAdjustment);
      for (const line of orderedLines) {
        if (pendingBase <= 0) break;
        const availableBase = toUnit(Number(line.quantity ?? 0), line.unit, baseUnit);
        if (availableBase <= 0) continue;
        const takeBase = Math.min(availableBase, pendingBase);
        const takeLineUnit = toUnit(takeBase, baseUnit, line.unit);
        const lineUnitCost = line.quantity > 0 ? line.line_total_cop / line.quantity : 0;
        line.quantity = Number(Math.max(0, line.quantity - takeLineUnit).toFixed(3));
        line.line_total_cop = Number(Math.max(0, line.line_total_cop - takeLineUnit * lineUnitCost).toFixed(2));
        pendingBase = Number(Math.max(0, pendingBase - takeBase).toFixed(3));
      }
      continue;
    }

    const template = itemLines[0];
    const quantity = toUnit(deltaBase, baseUnit, baseUnit);
    adjustedLines.push({
      ...template,
      id: `count-${count.id}`,
      purchase_id: count.id,
      quantity,
      purchased_quantity: quantity,
      unit: baseUnit,
      unit_cost_cop: Number(count.average_cost_cop ?? 0),
      line_total_cop: Number((quantity * Number(count.average_cost_cop ?? 0)).toFixed(2)),
      expiration_date: null,
      purchased_at: count.created_at,
      supplier_name: "Conteo fisico",
      lot_code: `AJ-${count.id.slice(0, 6).toUpperCase()}`
    });
  }

  return adjustedLines;
}

export default async function InventoryPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roleNames = roles?.map((item) => item.role) ?? [];
  const canManage = roleNames.some((role) => managerRoles.has(role));
  if (!canManage) {
    notFound();
  }

  const [purchaseLinesResult, purchaseAllocationsResult, physicalCountsResult, masterItemsResult, brandsResult, suppliersResult, categoriesResult] = await Promise.all([
    supabase
      .from("purchase_items")
      .select(
        "id, purchase_id, inventory_item_id, purchased_quantity, quantity, unit, presentation_quantity, presentation_unit, unit_cost_cop, line_total_cop, expiration_date, inventory_items(id, sku, name, image_url, unit, item_kind, purchase_mode, brand_id, category_id, presentation_quantity, presentation_unit, is_active), purchases(id, supplier_id, brand_id, purchased_at)"
      )
      .order("expiration_date", { ascending: true, nullsFirst: false })
      .limit(1000),
    supabase.from("production_consumption_allocations").select("purchase_item_id, quantity_base, base_unit").not("purchase_item_id", "is", null),
    supabase
      .from("physical_inventory_counts")
      .select("id, source_kind, inventory_item_id, source_preparation_id, theoretical_quantity_base, physical_quantity_base, difference_quantity_base, base_unit, average_cost_cop, adjustment_kind, reason, created_at, created_by, inventory_items(name), preparations(name)")
      .order("created_at", { ascending: false }),
    supabase.from("inventory_items").select("id, name, image_url, item_kind").is("presentation_quantity", null),
    supabase.from("brands").select("id, name").order("name"),
    supabase.from("suppliers").select("id, name").order("name"),
    supabase.from("product_categories").select("id, name").order("name")
  ]);

  const error =
    purchaseLinesResult.error ??
    purchaseAllocationsResult.error ??
    physicalCountsResult.error ??
    masterItemsResult.error ??
    brandsResult.error ??
    suppliersResult.error ??
    categoriesResult.error;
  const purchaseLines = (purchaseLinesResult.data ?? []) as unknown as PurchaseLineRow[];
  const purchaseAllocations = (purchaseAllocationsResult.data ?? []) as PurchaseAllocationRow[];
  const physicalCounts = (physicalCountsResult.data ?? []) as unknown as PhysicalInventoryCountRow[];
  const masterItems = (masterItemsResult.data ?? []) as Array<{ id: string; name: string; image_url: string | null; item_kind: ItemKind | null }>;
  const brands = brandsResult.data ?? [];
  const suppliers = suppliersResult.data ?? [];
  const categories = categoriesResult.data ?? [];
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

  const [productionBatchesResult, productionAllocationsResult, productionConsumptionsResult, productionTraceAllocationsResult, productionItemsResult, productionPreparationsResult] = await Promise.all([
    supabase
      .from("production_batches")
      .select("id, production_id, preparation_id, initial_quantity_base, base_unit, unit_cost_cop, expiration_date, elaborated_at, production_number, productions(id, code, storage_method, total_cost_cop, unit_cost_cop, created_by), preparations(id, name, image_url, unit_kind, base_unit, is_active)")
      .order("expiration_date", { ascending: true }),
    supabase.from("production_consumption_allocations").select("production_batch_id, quantity_base, base_unit"),
    supabase.from("production_consumptions").select("id, production_id, source_kind, inventory_item_id, source_preparation_id, quantity_base, base_unit, cost_cop"),
    supabase.from("production_consumption_allocations").select("consumption_id, purchase_item_id, production_batch_id, quantity_base, base_unit, cost_cop"),
    supabase.from("inventory_items").select("id, name"),
    supabase.from("preparations").select("id, name, image_url")
  ]);

  const productionError =
    productionBatchesResult.error ??
    productionAllocationsResult.error ??
    productionConsumptionsResult.error ??
    productionTraceAllocationsResult.error ??
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
    allocations: (productionAllocationsResult.data ?? []) as ProductionAllocationInput[],
    consumptions: (productionConsumptionsResult.data ?? []) as ProductionConsumptionInput[],
    traceAllocations: (productionTraceAllocationsResult.data ?? []) as ProductionTraceAllocationInput[],
    inventoryNames: new Map((productionItemsResult.data ?? []).map((item) => [item.id, item.name])),
    preparationNames: new Map((productionPreparationsResult.data ?? []).map((preparation) => [preparation.id, preparation.name])),
    imageSrcByPreparationId: new Map(signedPreparationImageEntries)
  });

  const preparationAdjustmentsById = new Map<string, { quantity: number; unit: StockUnit; value: number }>();
  for (const count of physicalCounts) {
    const quantity = Number(count.difference_quantity_base ?? 0);
    const value = quantity * Number(count.average_cost_cop ?? 0);
    if (count.source_kind === "preparation" && count.source_preparation_id) {
      const current = preparationAdjustmentsById.get(count.source_preparation_id) ?? { quantity: 0, unit: count.base_unit, value: 0 };
      current.quantity += quantity;
      current.value += value;
      preparationAdjustmentsById.set(count.source_preparation_id, current);
    }
  }

  const purchaseAllocatedByLine = new Map<string, number>();
  for (const allocation of purchaseAllocations) {
    if (!allocation.purchase_item_id) continue;
    const current = purchaseAllocatedByLine.get(allocation.purchase_item_id) ?? 0;
    purchaseAllocatedByLine.set(allocation.purchase_item_id, current + Number(allocation.quantity_base ?? 0));
  }

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
      const availableQuantity = Math.max(0, originalQuantity - allocatedQuantity);
      const unitCost = originalQuantity > 0 ? Number(line.line_total_cop ?? 0) / originalQuantity : 0;
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
        unit: line.unit,
        quantity: availableQuantity,
        presentation_quantity: line.presentation_quantity,
        presentation_unit: line.presentation_unit,
        unit_cost_cop: Number(line.unit_cost_cop ?? 0),
        line_total_cop: availableQuantity * unitCost,
        expiration_date: line.expiration_date,
        purchased_at: purchase.purchased_at,
        supplier_name: purchase.supplier_id ? supplierById.get(purchase.supplier_id) ?? null : null,
        brand_name: purchaseBrand ?? productBrand,
        category_name: item.category_id ? categoryById.get(item.category_id) ?? null : null,
        lot_code: lotCode(line.id),
        is_active: item.is_active
      };
    });
  const lineItems = applyPhysicalCountsToPurchaseLines(baseLineItems, physicalCounts);

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

  const adjustedProductionItems = productionInventory.items.map((item) => {
    const adjustment = preparationAdjustmentsById.get(item.id);
    if (!adjustment) return item;
    let adjustedQuantity = adjustment.quantity;
    if (adjustment.unit !== item.base_unit) {
      try {
        adjustedQuantity = convertStockQuantity(adjustment.quantity, adjustment.unit, item.base_unit);
      } catch {
        adjustedQuantity = adjustment.quantity;
      }
    }
    const stock = Math.max(0, item.stock_base + adjustedQuantity);
    const value = Math.max(0, item.inventory_value_cop + adjustment.value);
    return {
      ...item,
      stock_base: stock,
      inventory_value_cop: value,
      average_cost_cop: stock > 0 ? value / stock : 0
    };
  });

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
    user_label: count.created_by ? count.created_by.slice(0, 8).toUpperCase() : "Sistema"
  }));

  return (
    <PanelShell active="inventario" hideHeader roleNames={roleNames} title="Inventario" userEmail={user.email ?? "usuario"}>
      {error ? <p className="alert">{error.message}</p> : null}
      {productionError ? <p className="alert">{productionError.message}</p> : null}
      <InventoryWorkspace countHistory={countHistory} items={[...groupedItems.values()]} preparationItems={adjustedProductionItems} purchaseLines={lineItems} />
    </PanelShell>
  );
}
