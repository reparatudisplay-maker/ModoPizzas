"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { Bike, CheckCircle2, CupSoda, HandPlatter, Package, PackagePlus, Pencil, Pizza, ShoppingBag, Store, Trash2, UtensilsCrossed, X, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { deletePosPackagingRule, savePosPackagingRule, type FormActionState } from "@/app/admin/actions";

type Target = { id: string; name: string; presentation?: string | null };
type Rule = { id: string; target_kind: "pizza_size" | "sale_product"; target_id: string; service_kind: string; packaging_inventory_item_id: string; packaging_name: string; quantity_base: number };
type ServiceKind = "local" | "pickup" | "takeaway" | "delivery";
const initialState: FormActionState = { status: "idle", message: "" };
const services: Array<{ id: ServiceKind; label: string; icon: LucideIcon }> = [
  { id: "local", label: "Local", icon: Store }, { id: "pickup", label: "Recoger", icon: ShoppingBag }, { id: "takeaway", label: "Llevar", icon: HandPlatter }, { id: "delivery", label: "Domicilio", icon: Bike }
];
const tabs = [
  { id: "pizzas", label: "Pizzas", icon: Pizza }, { id: "bebidas", label: "Bebidas", icon: CupSoda }, { id: "otros", label: "Otros platos", icon: UtensilsCrossed }
] as const;

export function PackagingRulesWorkspace({ pizzaSizes, saleProducts, supplies, rules }: { pizzaSizes: Target[]; saleProducts: Target[]; supplies: Target[]; rules: Rule[] }) {
  const [tab, setTab] = useState<"pizzas" | "bebidas" | "otros">("pizzas");
  const [editing, setEditing] = useState<{ targetId: string; service: ServiceKind; rule?: Rule } | null>(null);
  const router = useRouter();
  const [saveState, saveAction] = useActionState(savePosPackagingRule, initialState);
  const [deleteState, deleteAction] = useActionState(deletePosPackagingRule, initialState);
  const products = useMemo(() => saleProducts.filter((product) => tab === "bebidas" ? Boolean(product.presentation) : !product.presentation), [saleProducts, tab]);
  const targets = tab === "pizzas" ? pizzaSizes : products;
  const targetKind = tab === "pizzas" ? "pizza_size" : "sale_product";
  const visibleRules = rules.filter((rule) => rule.target_kind === targetKind && (tab === "pizzas" || products.some((product) => product.id === rule.target_id)));
  const feedback = saveState.status !== "idle" ? saveState : deleteState;

  useEffect(() => {
    if (saveState.status === "success" || deleteState.status === "success") {
      setEditing(null);
      router.refresh();
    }
  }, [deleteState.status, router, saveState.status]);

  return <section className="packaging-rules-workspace">
    <div className="packaging-workspace-heading">
      <span className="packaging-workspace-heading-icon"><Package size={22} /></span>
      <div><h1>Empaques</h1><p>Configura el consumo automático por producto y modalidad.</p></div>
    </div>
    <div className="packaging-tab-row" role="tablist" aria-label="Tipo de producto">
      {tabs.map(({ id, label, icon: Icon }) => <button className={tab === id ? "active" : ""} key={id} onClick={() => { setTab(id); setEditing(null); }} role="tab" type="button"><Icon size={15} />{label}</button>)}
    </div>
    <div className="table-wrap packaging-rules-table-wrap"><table className="packaging-rules-matrix"><thead><tr><th>Tamaño / Producto</th>{services.map((service) => { const Icon = service.icon; return <th key={service.id}><span><Icon size={14} />{service.label}</span></th>; })}</tr></thead><tbody>
      {targets.length ? targets.map((target) => <tr key={target.id}><th scope="row"><span className="packaging-target-icon">{tab === "pizzas" ? <Pizza size={15} /> : <Package size={15} />}</span><span><strong>{target.name}</strong>{target.presentation ? <small>{target.presentation}</small> : null}</span></th>{services.map((service) => {
        const cellRules = visibleRules.filter((rule) => rule.target_id === target.id && rule.service_kind === service.id);
        const isEditing = editing?.targetId === target.id && editing.service === service.id;
        return <td key={service.id}><div className="packaging-rule-cell">
          {cellRules.map((rule) => <div className="packaging-rule-chip" key={rule.id}><span><Package size={14} />{rule.packaging_name} <b>x{rule.quantity_base}</b></span><div className="packaging-rule-actions"><button aria-label={`Editar ${rule.packaging_name}`} className="icon-button" onClick={() => setEditing({ targetId: target.id, service: service.id, rule })} title="Editar empaque" type="button"><Pencil size={14} /></button><form action={deleteAction}><input name="rule_id" type="hidden" value={rule.id} /><button aria-label={`Quitar ${rule.packaging_name}`} className="icon-button" title="Quitar empaque" type="submit"><Trash2 size={14} /></button></form></div></div>)}
          {isEditing ? <form action={saveAction} className="packaging-rule-inline-form">{editing?.rule ? <input name="rule_id" type="hidden" value={editing.rule.id} /> : null}<input name="target_kind" type="hidden" value={targetKind} /><input name="target_id" type="hidden" value={target.id} /><input name="service_kind" type="hidden" value={service.id} /><select aria-label={`Empaque para ${target.name} ${service.label}`} defaultValue={editing?.rule?.packaging_inventory_item_id ?? ""} name="packaging_inventory_item_id" required><option disabled value="">Empaque</option>{supplies.map((supply) => <option key={supply.id} value={supply.id}>{supply.name}</option>)}</select><input aria-label="Cantidad" defaultValue={editing?.rule?.quantity_base ?? 1} inputMode="numeric" min="0.001" name="quantity_base" step="0.001" type="number" /><button className="positive-button" type="submit">Guardar</button><button aria-label="Cancelar" className="icon-button" onClick={() => setEditing(null)} type="button"><X size={14} /></button></form> : <button className="packaging-rule-add" onClick={() => setEditing({ targetId: target.id, service: service.id })} type="button"><PackagePlus size={14} /> Agregar</button>}
        </div></td>;
      })}</tr>) : <tr><td colSpan={5}>No hay destinos disponibles para esta sección.</td></tr>}
    </tbody></table></div>
    {feedback.status !== "idle" ? <p className={`packaging-rule-feedback ${feedback.status}`} role="status">{feedback.status === "success" ? <CheckCircle2 size={16} /> : <X size={16} />}{feedback.message}</p> : null}
  </section>;
}
