import { PanelShell } from "@/components/panel-shell";
import { SaleProductPricesWorkspace, type SaleProductPriceReference } from "@/components/sale-product-prices-workspace";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePanelAccess } from "@/lib/panel-auth";
import { convertStockQuantity, formatStockQuantity, type StockUnit } from "@/lib/units";

const productImageBucket = "product-images";

export const dynamic = "force-dynamic";

type ReferenceRow = {
  id: string;
  sku: string | null;
  name: string;
  image_url: string | null;
  presentation_quantity: number | null;
  presentation_unit: StockUnit | null;
  sale_price_cop: number | null;
  sale_is_enabled: boolean | null;
  unit: StockUnit;
};

type PurchaseLine = {
  id: string;
  inventory_item_id: string;
  quantity: number;
  unit: StockUnit;
  line_total_cop: number | null;
};

type AllocationLine = {
  purchase_item_id: string | null;
  quantity_base: number;
  base_unit: StockUnit;
};

type PhysicalCountRow = {
  source_kind: "inventory_item" | "preparation";
  inventory_item_id: string | null;
  difference_quantity_base: number;
  average_cost_cop: number | null;
};

async function signedImage(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>, path: string | null) {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  const { data } = await supabase.storage.from(productImageBucket).createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

export default async function MenuPreciosProductosPage() {
  const supabase = await createServerSupabaseClient();
  const { user, roleNames, moduleKeys } = await requirePanelAccess(supabase, "menu");

  const [referencesResult, purchaseItemsResult, productionAllocationsResult, posAllocationsResult, physicalCountsResult] = await Promise.all([
    supabase
      .from("pos_sale_product_references")
      .select("id, sku, name, image_url, presentation_quantity, presentation_unit, sale_price_cop, sale_is_enabled, unit")
      .order("name"),
    supabase.from("purchase_items").select("id, inventory_item_id, quantity, unit, line_total_cop"),
    supabase.from("production_consumption_allocations").select("purchase_item_id, quantity_base, base_unit").not("purchase_item_id", "is", null),
    supabase
      .from("pos_order_consumption_allocations")
      .select("purchase_item_id, quantity_base, base_unit, pos_order_consumptions!inner(pos_orders!inner(status))")
      .not("purchase_item_id", "is", null)
      .neq("pos_order_consumptions.pos_orders.status", "cancelled"),
    supabase
      .from("physical_inventory_counts")
      .select("source_kind, inventory_item_id, difference_quantity_base, average_cost_cop")
      .is("voided_at", null)
  ]);

  const error =
    referencesResult.error ??
    purchaseItemsResult.error ??
    productionAllocationsResult.error ??
    posAllocationsResult.error ??
    physicalCountsResult.error;

  const purchaseAllocationByLine = new Map<string, number>();
  for (const allocation of [...((productionAllocationsResult.data ?? []) as AllocationLine[]), ...((posAllocationsResult.data ?? []) as unknown as AllocationLine[])]) {
    if (!allocation.purchase_item_id) continue;
    purchaseAllocationByLine.set(allocation.purchase_item_id, (purchaseAllocationByLine.get(allocation.purchase_item_id) ?? 0) + Number(allocation.quantity_base ?? 0));
  }

  const costByReference = new Map<string, { quantity: number; total: number }>();
  for (const line of (purchaseItemsResult.data ?? []) as PurchaseLine[]) {
    let quantity = Number(line.quantity ?? 0);
    try {
      quantity = convertStockQuantity(quantity, line.unit, "unit");
    } catch {
      quantity = Number(line.quantity ?? 0);
    }
    const available = Math.max(0, quantity - (purchaseAllocationByLine.get(line.id) ?? 0));
    const lineTotal = Number(line.line_total_cop ?? 0);
    if (available > 0 && quantity > 0 && lineTotal > 0) {
      const current = costByReference.get(line.inventory_item_id) ?? { quantity: 0, total: 0 };
      current.quantity += available;
      current.total += (lineTotal / quantity) * available;
      costByReference.set(line.inventory_item_id, current);
    }
  }

  for (const count of (physicalCountsResult.data ?? []) as PhysicalCountRow[]) {
    if (count.source_kind !== "inventory_item" || !count.inventory_item_id) continue;
    const delta = Number(count.difference_quantity_base ?? 0);
    const cost = Number(count.average_cost_cop ?? 0);
    if (delta === 0 || cost <= 0) continue;
    const current = costByReference.get(count.inventory_item_id) ?? { quantity: 0, total: 0 };
    current.quantity = Math.max(0, current.quantity + delta);
    current.total = Math.max(0, current.total + delta * cost);
    costByReference.set(count.inventory_item_id, current);
  }

  const references: SaleProductPriceReference[] = await Promise.all(
    ((referencesResult.data ?? []) as ReferenceRow[]).map(async (reference) => {
      const cost = costByReference.get(reference.id);
      return {
        id: reference.id,
        sku: reference.sku,
        name: reference.name,
        image_src: await signedImage(supabase, reference.image_url),
        presentation:
          reference.presentation_quantity && reference.presentation_unit
            ? formatStockQuantity(Number(reference.presentation_quantity), reference.presentation_unit)
            : "Sin presentacion",
        current_cost_cop: cost && cost.quantity > 0 && cost.total > 0 ? cost.total / cost.quantity : null,
        sale_price_cop: Number(reference.sale_price_cop ?? 0),
        sale_is_enabled: Boolean(reference.sale_is_enabled)
      };
    })
  );

  return (
    <PanelShell active="menu-precios-productos" hideHeader moduleKeys={moduleKeys} roleNames={roleNames} title="Precios de productos" userEmail={user.email ?? "usuario"}>
      {error ? <p className="alert">{error.message}</p> : null}
      <SaleProductPricesWorkspace references={references} />
    </PanelShell>
  );
}
