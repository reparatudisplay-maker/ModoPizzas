import { PanelShell } from "@/components/panel-shell";
import { PackagingRulesWorkspace } from "@/components/packaging-rules-workspace";
import { requirePanelAccess } from "@/lib/panel-auth";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { formatPresentationQuantity, type StockUnit } from "@/lib/units";

export const dynamic = "force-dynamic";

function getPackagingName(value: unknown) {
  const relation = Array.isArray(value) ? value[0] : value;
  if (!relation || typeof relation !== "object" || !("name" in relation)) return "Empaque";
  return typeof relation.name === "string" && relation.name ? relation.name : "Empaque";
}

export default async function MenuEmpaquesPage() {
  const supabase = await createServerSupabaseClient();
  const { user, roleNames, moduleKeys } = await requirePanelAccess(supabase, "menu");
  const [sizesResult, productsResult, suppliesResult, rulesResult] = await Promise.all([
    supabase.from("pizza_sizes").select("id, name, diameter_cm").eq("is_active", true).order("diameter_cm"),
    supabase.from("inventory_items").select("id, name, presentation_quantity, presentation_unit").eq("item_kind", "sale_product").eq("sale_is_enabled", true).order("name"),
    supabase.from("inventory_items").select("id, name").eq("item_kind", "supply").eq("unit", "unit").eq("is_active", true).order("name"),
    supabase.from("pos_packaging_rules").select("id, target_kind, pizza_size_id, sale_product_id, service_kind, packaging_inventory_item_id, quantity_base, packaging_item:inventory_items!pos_packaging_rules_packaging_inventory_item_id_fkey(name)").eq("is_active", true).order("created_at")
  ]);
  const errors = [sizesResult.error, productsResult.error, suppliesResult.error, rulesResult.error].filter(Boolean);
  const pizzaSizes = (sizesResult.data ?? []).map((size) => ({ id: size.id, name: size.name }));
  const saleProducts = (productsResult.data ?? []).map((item) => ({ id: item.id, name: item.name, presentation: item.presentation_quantity && item.presentation_unit ? formatPresentationQuantity(Number(item.presentation_quantity), item.presentation_unit as StockUnit) : null }));
  const supplies = (suppliesResult.data ?? []).map((item) => ({ id: item.id, name: item.name }));
  const rules = rulesResult.error ? [] : (rulesResult.data ?? []).map((rule) => ({ id: rule.id, target_kind: rule.target_kind as "pizza_size" | "sale_product", target_id: rule.target_kind === "pizza_size" ? rule.pizza_size_id ?? "" : rule.sale_product_id ?? "", service_kind: rule.service_kind, packaging_inventory_item_id: rule.packaging_inventory_item_id, packaging_name: getPackagingName(rule.packaging_item), quantity_base: Number(rule.quantity_base) }));
  return <PanelShell active="menu-empaques" hideHeader moduleKeys={moduleKeys} roleNames={roleNames} title="Empaques" userEmail={user.email ?? "usuario"}>{errors[0] ? <p className="alert">{errors[0].message}</p> : null}<PackagingRulesWorkspace pizzaSizes={pizzaSizes} rules={rules} saleProducts={saleProducts} supplies={supplies} /></PanelShell>;
}
