import { notFound, redirect } from "next/navigation";
import { PanelShell } from "@/components/panel-shell";
import {
  ProductionRegisterModule,
  type ProductionHistoryRow,
  type ProductionPreparationOption,
  type ProductionRecipeItem,
  type ProductionSourceOption
} from "@/components/production-register-module";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { buildProductionInventory } from "@/lib/production-inventory";
import { canonicalStockUnit, convertStockQuantity } from "@/lib/units";

type StockUnit = "g" | "kg" | "ml" | "l" | "unit";
type UnitKind = "weight" | "volume" | "unit";
type SourceKind = "inventory_item" | "preparation";
type StorageMethod = "ambient" | "refrigerated" | "frozen";

type PreparationRow = {
  id: string;
  name: string;
  image_url: string | null;
  unit_kind: UnitKind;
  base_unit: StockUnit;
  alternative_unit: StockUnit | null;
  density: number | null;
  conservation_profile_id: string | null;
  base_yield_quantity: number;
  base_yield_unit: StockUnit;
  is_active: boolean;
  conservation_profiles: {
    name: string;
    conservation_profile_rules: Array<{
      storage_method: "ambient" | "refrigerated" | "frozen";
      duration_value: number;
      duration_unit: "hours" | "days" | "weeks" | "months";
    }>;
  } | null;
};

type RecipeRow = {
  id: string;
  preparation_id: string;
  source_kind: SourceKind;
  inventory_item_id: string | null;
  source_preparation_id: string | null;
  quantity: number;
  unit: StockUnit;
};

type InventorySourceRow = {
  id: string;
  name: string;
  unit: StockUnit;
  item_kind: "ingredient" | "sale_product" | "supply" | null;
  is_active: boolean;
  presentation_quantity: number | null;
};

type PurchaseLineRow = {
  id: string;
  inventory_item_id: string;
  quantity: number;
  unit: StockUnit;
  line_total_cop: number;
  expiration_date: string | null;
  purchases: { purchased_at: string } | null;
};

type AllocationRow = {
  consumption_id?: string;
  purchase_item_id: string | null;
  production_batch_id: string | null;
  quantity_base: number;
  base_unit: StockUnit;
  cost_cop?: number;
};

type BatchRow = {
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
    storage_method: StorageMethod;
    total_cost_cop: number;
    unit_cost_cop: number;
    created_by: string | null;
  } | null;
  preparations: {
    id: string;
    name: string;
    image_url: string | null;
    unit_kind: UnitKind;
    base_unit: StockUnit;
    is_active: boolean;
  } | null;
};

type ProductionRow = {
  id: string;
  code: string;
  storage_method: StorageMethod;
  elaborated_at: string;
  actual_quantity_base: number;
  base_unit: StockUnit;
  expiration_date: string;
  total_cost_cop: number;
  unit_cost_cop: number;
  created_by: string | null;
  preparations: { name: string } | null;
};

type ProductionConsumptionRow = {
  id: string;
  production_id: string;
  source_kind: SourceKind;
  inventory_item_id: string | null;
  source_preparation_id: string | null;
  quantity_base: number;
  base_unit: StockUnit;
  cost_cop: number;
};

const managerRoles = new Set(["gerente", "admin_sistema"]);

export const dynamic = "force-dynamic";

function isDirectImageUrl(value: string) {
  return value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:");
}

function unitKindForStockUnit(unit: StockUnit): UnitKind {
  if (unit === "g" || unit === "kg") return "weight";
  if (unit === "ml" || unit === "l") return "volume";
  return "unit";
}

function allocationSum(allocations: AllocationRow[], key: "purchase_item_id" | "production_batch_id", id: string, targetUnit?: StockUnit) {
  return allocations.filter((allocation) => allocation[key] === id).reduce((sum, allocation) => {
    const quantity = Number(allocation.quantity_base ?? 0);
    if (!targetUnit || allocation.base_unit === targetUnit) return sum + quantity;
    try {
      return sum + convertStockQuantity(quantity, allocation.base_unit, targetUnit);
    } catch {
      return sum + quantity;
    }
  }, 0);
}

export default async function RegisterProductionPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roleNames = roles?.map((item) => item.role) ?? [];
  if (!roleNames.some((role) => managerRoles.has(role))) notFound();

  const [
    preparationsResult,
    recipeResult,
    inventoryItemsResult,
    purchaseLinesResult,
    allocationsResult,
    batchesResult,
    productionsResult,
    productionConsumptionsResult,
    profilesResult
  ] =
    await Promise.all([
      supabase
        .from("preparations")
        .select(
          "id, name, image_url, unit_kind, base_unit, alternative_unit, density, conservation_profile_id, base_yield_quantity, base_yield_unit, is_active, conservation_profiles(name, conservation_profile_rules(storage_method, duration_value, duration_unit))"
        )
        .eq("is_active", true)
        .order("name"),
      supabase.from("preparation_recipe_items").select("id, preparation_id, source_kind, inventory_item_id, source_preparation_id, quantity, unit").order("created_at"),
      supabase
        .from("inventory_items")
        .select("id, name, unit, item_kind, is_active, presentation_quantity")
        .eq("is_active", true)
        .eq("item_kind", "ingredient")
        .is("presentation_quantity", null)
        .order("name"),
      supabase.from("purchase_items").select("id, inventory_item_id, quantity, unit, line_total_cop, expiration_date, purchases(purchased_at)").order("expiration_date", { ascending: true, nullsFirst: false }),
      supabase.from("production_consumption_allocations").select("consumption_id, purchase_item_id, production_batch_id, quantity_base, base_unit, cost_cop"),
      supabase
        .from("production_batches")
        .select("id, production_id, preparation_id, initial_quantity_base, base_unit, unit_cost_cop, expiration_date, elaborated_at, production_number, productions(id, code, storage_method, total_cost_cop, unit_cost_cop, created_by), preparations(id, name, image_url, unit_kind, base_unit, is_active)"),
      supabase
        .from("productions")
        .select("id, code, storage_method, elaborated_at, actual_quantity_base, base_unit, expiration_date, total_cost_cop, unit_cost_cop, created_by, preparations(name)")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("production_consumptions")
        .select("id, production_id, source_kind, inventory_item_id, source_preparation_id, quantity_base, base_unit, cost_cop")
        .order("id"),
      supabase.from("profiles").select("id, full_name")
    ]);

  const error =
    preparationsResult.error ??
    recipeResult.error ??
    inventoryItemsResult.error ??
    purchaseLinesResult.error ??
    allocationsResult.error ??
    batchesResult.error ??
    productionsResult.error ??
    productionConsumptionsResult.error ??
    profilesResult.error;

  const preparationRows = (preparationsResult.data ?? []) as unknown as PreparationRow[];
  const recipeRows = (recipeResult.data ?? []) as RecipeRow[];
  const inventoryItems = (inventoryItemsResult.data ?? []) as InventorySourceRow[];
  const purchaseLines = (purchaseLinesResult.data ?? []) as unknown as PurchaseLineRow[];
  const allocations = (allocationsResult.data ?? []) as AllocationRow[];
  const batches = (batchesResult.data ?? []) as unknown as BatchRow[];
  const productionRows = (productionsResult.data ?? []) as unknown as ProductionRow[];
  const productionConsumptionRows = (productionConsumptionsResult.data ?? []) as ProductionConsumptionRow[];
  const profileRows = (profilesResult.data ?? []) as Array<{ id: string; full_name: string | null }>;
  const profileById = new Map(profileRows.map((profile) => [profile.id, profile.full_name || profile.id]));

  const signedImageEntries = await Promise.all(
    preparationRows.map(async (preparation) => {
      if (!preparation.image_url || isDirectImageUrl(preparation.image_url)) return [preparation.id, preparation.image_url] as const;
      const { data } = await supabase.storage.from("product-images").createSignedUrl(preparation.image_url, 60 * 60);
      return [preparation.id, data?.signedUrl ?? null] as const;
    })
  );
  const imageSrcById = new Map(signedImageEntries);

  const preparationById = new Map(preparationRows.map((preparation) => [preparation.id, preparation]));
  const inventoryById = new Map(inventoryItems.map((item) => [item.id, item]));
  const recipeByPreparation = new Map<string, ProductionRecipeItem[]>();
  for (const line of recipeRows) {
    const source =
      line.source_kind === "preparation" && line.source_preparation_id
        ? preparationById.get(line.source_preparation_id)
        : line.inventory_item_id
          ? inventoryById.get(line.inventory_item_id)
          : null;
    if (!source) continue;
    recipeByPreparation.set(line.preparation_id, [
      ...(recipeByPreparation.get(line.preparation_id) ?? []),
      {
        id: line.id,
        source_kind: line.source_kind,
        source_id: line.source_kind === "preparation" ? line.source_preparation_id ?? "" : line.inventory_item_id ?? "",
        source_name: source.name,
        quantity: Number(line.quantity),
        unit: line.unit
      }
    ]);
  }

  const inventorySources: ProductionSourceOption[] = inventoryItems.map((item) => {
    const lines = purchaseLines.filter((line) => line.inventory_item_id === item.id);
    const baseUnit = canonicalStockUnit(item.unit);
    const stock = lines.reduce((sum, line) => sum + Number(line.quantity ?? 0) - allocationSum(allocations, "purchase_item_id", line.id, line.unit), 0);
    const cost = lines.reduce((sum, line) => {
      const available = Number(line.quantity ?? 0) - allocationSum(allocations, "purchase_item_id", line.id, line.unit);
      const unitCost = Number(line.quantity ?? 0) > 0 ? Number(line.line_total_cop ?? 0) / Number(line.quantity ?? 0) : 0;
      return sum + available * unitCost;
    }, 0);
    return {
      id: item.id,
      name: item.name,
      source_kind: "inventory_item",
      unit_kind: unitKindForStockUnit(baseUnit),
      base_unit: baseUnit,
      density: null,
      stock_base: stock,
      average_unit_cost_cop: stock > 0 ? cost / stock : 0
    };
  });

  const preparationSources: ProductionSourceOption[] = preparationRows.map((preparation) => {
    const sourceBatches = batches.filter((batch) => batch.preparation_id === preparation.id);
    const stock = sourceBatches.reduce((sum, batch) => sum + Number(batch.initial_quantity_base ?? 0) - allocationSum(allocations, "production_batch_id", batch.id), 0);
    const cost = sourceBatches.reduce((sum, batch) => {
      const available = Number(batch.initial_quantity_base ?? 0) - allocationSum(allocations, "production_batch_id", batch.id);
      return sum + available * Number(batch.unit_cost_cop ?? 0);
    }, 0);
    return {
      id: preparation.id,
      name: preparation.name,
      source_kind: "preparation",
      unit_kind: preparation.unit_kind,
      base_unit: preparation.base_unit,
      density: preparation.density ? Number(preparation.density) : null,
      stock_base: stock,
      average_unit_cost_cop: stock > 0 ? cost / stock : 0
    };
  });

  const preparations: ProductionPreparationOption[] = preparationRows.map((preparation) => ({
    id: preparation.id,
    name: preparation.name,
    image_src: imageSrcById.get(preparation.id) ?? null,
    unit_kind: preparation.unit_kind,
    base_unit: preparation.base_unit,
    alternative_unit: preparation.alternative_unit,
    density: preparation.density ? Number(preparation.density) : null,
    base_yield_quantity: Number(preparation.base_yield_quantity),
    base_yield_unit: preparation.base_yield_unit,
    conservation_profile_name: preparation.conservation_profiles?.name ?? null,
    conservation_rules: preparation.conservation_profiles?.conservation_profile_rules ?? [],
    recipe_items: recipeByPreparation.get(preparation.id) ?? []
  }));

  const productionInventory = buildProductionInventory({
    batches,
    allocations,
    consumptions: productionConsumptionRows,
    traceAllocations: allocations
      .filter((allocation): allocation is AllocationRow & { consumption_id: string } => Boolean(allocation.consumption_id))
      .map((allocation) => ({ ...allocation, cost_cop: Number(allocation.cost_cop ?? 0) })),
    inventoryNames: new Map(inventoryItems.map((item) => [item.id, item.name])),
    preparationNames: new Map(preparationRows.map((preparation) => [preparation.id, preparation.name])),
    imageSrcByPreparationId: imageSrcById
  });
  const productionLotByProductionId = new Map(productionInventory.lots.map((lot) => [lot.production_id, lot]));

  const history: ProductionHistoryRow[] = productionRows.map((production) => {
    const productionBatch = batches.find((item) => item.production_id === production.id);
    const productionLot = productionLotByProductionId.get(production.id);
    const stock = productionLot?.stock_base ?? (productionBatch ? Number(productionBatch.initial_quantity_base ?? 0) - allocationSum(allocations, "production_batch_id", productionBatch.id) : Number(production.actual_quantity_base ?? 0));
    return {
      id: production.id,
      code: production.code,
      preparation_name: production.preparations?.name ?? "Sin preparacion",
      storage_method: production.storage_method,
      elaborated_at: production.elaborated_at,
      actual_quantity_base: Number(production.actual_quantity_base ?? 0),
      base_unit: production.base_unit,
      stock_base: stock,
      expiration_date: production.expiration_date,
      total_cost_cop: Number(production.total_cost_cop ?? 0),
      unit_cost_cop: Number(production.unit_cost_cop ?? 0),
      user_label: production.created_by ? profileById.get(production.created_by) ?? production.created_by : "Sin usuario",
      ingredients_consumed: productionLot?.ingredients_consumed ?? []
    };
  });

  return (
    <PanelShell active="produccion-registrar" hideHeader roleNames={roleNames} title="Produccion" userEmail={user.email ?? "usuario"}>
      {error ? <p className="alert">{error.message}</p> : null}
      <ProductionRegisterModule history={history} preparations={preparations} sources={[...inventorySources, ...preparationSources]} />
    </PanelShell>
  );
}
