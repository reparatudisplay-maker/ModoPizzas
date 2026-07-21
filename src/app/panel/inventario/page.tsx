import { notFound, redirect } from "next/navigation";
import { InventoryWorkspace, type InventoryListItem, type InventoryPurchaseLine } from "@/components/inventory-workspace";
import { PanelShell } from "@/components/panel-shell";
import { buildProductionInventory, type ProductionAllocationInput, type ProductionBatchInput, type ProductionConsumptionInput, type ProductionTraceAllocationInput } from "@/lib/production-inventory";
import { createServerSupabaseClient } from "@/lib/supabase-server";

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

  const [purchaseLinesResult, masterItemsResult, brandsResult, suppliersResult, categoriesResult] = await Promise.all([
    supabase
      .from("purchase_items")
      .select(
        "id, purchase_id, inventory_item_id, purchased_quantity, quantity, unit, presentation_quantity, presentation_unit, unit_cost_cop, line_total_cop, expiration_date, inventory_items(id, sku, name, image_url, unit, item_kind, purchase_mode, brand_id, category_id, presentation_quantity, presentation_unit, is_active), purchases(id, supplier_id, brand_id, purchased_at)"
      )
      .order("expiration_date", { ascending: true, nullsFirst: false })
      .limit(1000),
    supabase.from("inventory_items").select("id, name, image_url, item_kind").is("presentation_quantity", null),
    supabase.from("brands").select("id, name").order("name"),
    supabase.from("suppliers").select("id, name").order("name"),
    supabase.from("product_categories").select("id, name").order("name")
  ]);

  const error = purchaseLinesResult.error ?? masterItemsResult.error ?? brandsResult.error ?? suppliersResult.error ?? categoriesResult.error;
  const purchaseLines = (purchaseLinesResult.data ?? []) as unknown as PurchaseLineRow[];
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

  const lineItems: InventoryPurchaseLine[] = purchaseLines
    .filter((line) => line.inventory_items && line.purchases)
    .map((line) => {
      const item = line.inventory_items!;
      const purchase = line.purchases!;
      const displayName = baseProductName(item.name, line.presentation_quantity, line.presentation_unit);
      const masterItem = masterByKey.get(`${item.item_kind ?? ""}:${displayName.toUpperCase()}`) ?? masterByKey.get(masterKey(item));
      const imageItemId = masterItem?.image_url ? masterItem.id : item.id;
      const purchaseBrand = purchase.brand_id ? brandById.get(purchase.brand_id) ?? null : null;
      const productBrand = item.brand_id ? brandById.get(item.brand_id) ?? null : null;
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
        quantity: Number(line.quantity ?? 0),
        presentation_quantity: line.presentation_quantity,
        presentation_unit: line.presentation_unit,
        unit_cost_cop: Number(line.unit_cost_cop ?? 0),
        line_total_cop: Number(line.line_total_cop ?? 0),
        expiration_date: line.expiration_date,
        purchased_at: purchase.purchased_at,
        supplier_name: purchase.supplier_id ? supplierById.get(purchase.supplier_id) ?? null : null,
        brand_name: purchaseBrand ?? productBrand,
        category_name: item.category_id ? categoryById.get(item.category_id) ?? null : null,
        lot_code: lotCode(line.id),
        is_active: item.is_active
      };
    });

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

  return (
    <PanelShell active="inventario" hideHeader roleNames={roleNames} title="Inventario" userEmail={user.email ?? "usuario"}>
      {error ? <p className="alert">{error.message}</p> : null}
      {productionError ? <p className="alert">{productionError.message}</p> : null}
      <InventoryWorkspace items={[...groupedItems.values()]} preparationItems={productionInventory.items} purchaseLines={lineItems} />
    </PanelShell>
  );
}
