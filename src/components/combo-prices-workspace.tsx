"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { deleteComboConfig, saveComboConfig, type FormActionState } from "@/app/admin/actions";
import { optimizeImageInput } from "@/lib/client-images";
import { formatCop } from "@/lib/format";
import { normalizeMasterText, uppercaseMasterName } from "@/lib/master-normalization";

export type ComboPizzaFlavorOption = {
  id: string;
  name: string;
  image_src: string | null;
  prices: Array<{ price_config_id: string; size_id: string; sale_price_cop: number }>;
};

export type ComboSaleProductOption = {
  id: string;
  name: string;
  sku: string | null;
  presentation: string;
  image_src: string | null;
  sale_price_cop: number;
  sale_is_enabled: boolean;
  stock_base: number;
};

export type ComboSizeOption = {
  id: string;
  name: string;
};

export type ComboGroupDraft = {
  id?: string | null;
  name: string;
  group_kind: "pizza" | "sale_product";
  quantity_to_choose: number;
  is_required: boolean;
  pizza_size_id: string | null;
  allow_all_flavors: boolean;
  sort_order: number;
  options: Array<{
    id?: string | null;
    pizza_flavor_id: string | null;
    inventory_item_id: string | null;
    supplement_cop: number;
    is_active: boolean;
    sort_order: number;
  }>;
};

export type ComboPriceRecord = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  image_src: string | null;
  image_url: string | null;
  sale_price_cop: number;
  is_active: boolean;
  sort_order: number;
  normal_price_cop: number;
  estimated_cost_cop: number | null;
  groups: ComboGroupDraft[];
};

const initialState: FormActionState = { status: "idle", message: "" };

function emptyPizzaGroup(sortOrder: number): ComboGroupDraft {
  return {
    name: "PIZZA",
    group_kind: "pizza",
    quantity_to_choose: 1,
    is_required: true,
    pizza_size_id: null,
    allow_all_flavors: false,
    sort_order: sortOrder,
    options: []
  };
}

function emptyProductGroup(sortOrder: number): ComboGroupDraft {
  return {
    name: "PRODUCTO",
    group_kind: "sale_product",
    quantity_to_choose: 1,
    is_required: true,
    pizza_size_id: null,
    allow_all_flavors: false,
    sort_order: sortOrder,
    options: []
  };
}

function comboMetrics(combo: Pick<ComboPriceRecord, "normal_price_cop" | "sale_price_cop" | "estimated_cost_cop">) {
  const normal = Number(combo.normal_price_cop ?? 0);
  const price = Number(combo.sale_price_cop ?? 0);
  const cost = combo.estimated_cost_cop && combo.estimated_cost_cop > 0 ? combo.estimated_cost_cop : null;
  return {
    savings: Math.max(0, normal - price),
    profit: cost === null || price <= 0 ? null : price - cost,
    margin: cost === null || price <= 0 ? null : ((price - cost) / price) * 100
  };
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "Sin margen";
  return `${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 }).format(value)}%`;
}

export function ComboPricesWorkspace({
  combos,
  pizzaFlavors,
  saleProducts,
  sizes
}: {
  combos: ComboPriceRecord[];
  pizzaFlavors: ComboPizzaFlavorOption[];
  saleProducts: ComboSaleProductOption[];
  sizes: ComboSizeOption[];
}) {
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<ComboPriceRecord | null | "new">(null);
  const normalizedQuery = normalizeMasterText(query);
  const filtered = combos.filter((combo) => {
    const text = `${combo.sku} ${combo.name} ${combo.description ?? ""}`;
    return !normalizedQuery || normalizeMasterText(text).includes(normalizedQuery);
  });

  return (
    <>
      <section className="form-panel">
        <div className="section-title-row inventory-toolbar-row">
          <h2>Combos</h2>
          <div className="purchase-toolbar">
            <form className="table-filters" onSubmit={(event) => event.preventDefault()}>
              <input autoComplete="off" onChange={(event) => setQuery(uppercaseMasterName(event.target.value))} placeholder="Buscar combo" value={query} />
            </form>
            <button className="primary-button icon-text-button" onClick={() => setModal("new")} type="button">
              <Plus size={18} /> Agregar combo
            </button>
          </div>
        </div>
        <div className="menu-pizzas-table-wrap">
          <table className="data-table menu-pizzas-table">
            <thead>
              <tr>
                <th>FOTO</th>
                <th>SKU</th>
                <th>COMBO</th>
                <th>CONTENIDO</th>
                <th>PRECIO NORMAL</th>
                <th>PRECIO COMBO</th>
                <th>AHORRO</th>
                <th>COSTO</th>
                <th>UTILIDAD</th>
                <th>MARGEN</th>
                <th>ESTADO</th>
                <th>ACCIONES</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((combo) => {
                const metrics = comboMetrics(combo);
                return (
                  <tr key={combo.id}>
                    <td><ComboThumb alt={combo.name} src={combo.image_src} /></td>
                    <td>{combo.sku}</td>
                    <td><strong>{combo.name}</strong><br /><small>{combo.description ?? "Sin descripcion"}</small></td>
                    <td>{combo.groups.map((group) => `${group.quantity_to_choose} ${group.name}`).join(" + ") || "Sin grupos"}</td>
                    <td>{combo.normal_price_cop > 0 ? formatCop(combo.normal_price_cop) : "Sin calculo"}</td>
                    <td>{formatCop(combo.sale_price_cop)}</td>
                    <td>{metrics.savings > 0 ? formatCop(metrics.savings) : "$0"}</td>
                    <td>{combo.estimated_cost_cop ? formatCop(combo.estimated_cost_cop, { decimals: !Number.isInteger(combo.estimated_cost_cop) }) : "Sin costo"}</td>
                    <td>{metrics.profit === null ? "Sin utilidad" : formatCop(metrics.profit, { decimals: !Number.isInteger(metrics.profit) })}</td>
                    <td>{formatPercent(metrics.margin)}</td>
                    <td><span className={`stock-pill ${combo.is_active ? "ok" : "muted"}`}>{combo.is_active ? "Activo" : "Inactivo"}</span></td>
                    <td>
                      <span className="row-actions center-actions">
                        <button className="icon-button" onClick={() => setModal(combo)} title="Editar combo" type="button"><Pencil size={16} /></button>
                        <DeleteComboButton combo={combo} />
                      </span>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 ? <tr><td colSpan={12}>Sin combos configurados.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      {modal ? (
        <ComboModal
          combo={modal === "new" ? null : modal}
          onClose={() => setModal(null)}
          pizzaFlavors={pizzaFlavors}
          saleProducts={saleProducts}
          sizes={sizes}
        />
      ) : null}
    </>
  );
}

function ComboModal({
  combo,
  onClose,
  pizzaFlavors,
  saleProducts,
  sizes
}: {
  combo: ComboPriceRecord | null;
  onClose: () => void;
  pizzaFlavors: ComboPizzaFlavorOption[];
  saleProducts: ComboSaleProductOption[];
  sizes: ComboSizeOption[];
}) {
  const [state, action] = useActionState(saveComboConfig, initialState);
  const [name, setName] = useState(combo?.name ?? "");
  const [description, setDescription] = useState(combo?.description ?? "");
  const [salePrice, setSalePrice] = useState(combo?.sale_price_cop ? String(Math.round(combo.sale_price_cop)) : "");
  const [sortOrder, setSortOrder] = useState(String(combo?.sort_order ?? 0));
  const [isActive, setIsActive] = useState(combo?.is_active ?? true);
  const [groups, setGroups] = useState<ComboGroupDraft[]>(combo?.groups.length ? combo.groups : [emptyPizzaGroup(0), emptyProductGroup(1)]);
  const [preview, setPreview] = useState(combo?.image_src ?? "");
  const fileRef = useRef<HTMLInputElement>(null);
  const draft: ComboPriceRecord = {
    id: combo?.id ?? "",
    sku: combo?.sku ?? "AUTO",
    name,
    description,
    image_src: preview,
    image_url: combo?.image_url ?? null,
    sale_price_cop: Number(salePrice || 0),
    is_active: isActive,
    sort_order: Number(sortOrder || 0),
    normal_price_cop: combo?.normal_price_cop ?? estimateNormalPrice(groups, pizzaFlavors, saleProducts),
    estimated_cost_cop: combo?.estimated_cost_cop ?? null,
    groups
  };
  const metrics = comboMetrics(draft);

  useEffect(() => {
    if (state.status === "success") {
      const timeout = window.setTimeout(onClose, 700);
      return () => window.clearTimeout(timeout);
    }
    return undefined;
  }, [onClose, state.status]);

  function patchGroup(index: number, update: Partial<ComboGroupDraft>) {
    setGroups((current) => current.map((group, currentIndex) => currentIndex === index ? { ...group, ...update } : group));
  }

  function toggleOption(groupIndex: number, sourceId: string, kind: "pizza" | "sale_product") {
    setGroups((current) =>
      current.map((group, index) => {
        if (index !== groupIndex) return group;
        const exists = group.options.some((option) => (kind === "pizza" ? option.pizza_flavor_id : option.inventory_item_id) === sourceId);
        const options = exists
          ? group.options.filter((option) => (kind === "pizza" ? option.pizza_flavor_id : option.inventory_item_id) !== sourceId)
          : [
              ...group.options,
              {
                pizza_flavor_id: kind === "pizza" ? sourceId : null,
                inventory_item_id: kind === "sale_product" ? sourceId : null,
                supplement_cop: 0,
                is_active: true,
                sort_order: group.options.length
              }
            ];
        return { ...group, options };
      })
    );
  }

  function updateSupplement(groupIndex: number, sourceId: string, value: string) {
    const supplement = Math.max(0, Math.round(Number(value || 0)));
    setGroups((current) =>
      current.map((group, index) => {
        if (index !== groupIndex) return group;
        return {
          ...group,
          options: group.options.map((option) =>
            (option.pizza_flavor_id ?? option.inventory_item_id) === sourceId ? { ...option, supplement_cop: supplement } : option
          )
        };
      })
    );
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-label="Configurar combo" aria-modal="true" className="modal-panel xwide-modal" role="dialog">
        <header className="modal-header">
          <div><strong>{combo ? "Editar combo" : "Agregar combo"}</strong><span>Paquete comercial sin stock propio.</span></div>
          <button className="icon-button" onClick={onClose} title="Cerrar" type="button"><X size={18} /></button>
        </header>
        <form action={action} className="compact-card">
          <input name="id" type="hidden" value={combo?.id ?? ""} />
          <input name="groups_payload" type="hidden" value={JSON.stringify(groups)} />
          <div className="combo-editor-grid">
            <div className="field"><label>Nombre</label><input name="name" onChange={(event) => setName(uppercaseMasterName(event.target.value))} required value={name} /></div>
            <div className="field"><label>Precio combo</label><input inputMode="numeric" name="sale_price_cop" onChange={(event) => setSalePrice(event.target.value.replace(/\D/g, ""))} required value={salePrice} /></div>
            <div className="field"><label>Orden</label><input inputMode="numeric" name="sort_order" onChange={(event) => setSortOrder(event.target.value.replace(/\D/g, ""))} value={sortOrder} /></div>
            <label className="check-option"><input checked={isActive} name="is_active" onChange={(event) => setIsActive(event.target.checked)} type="checkbox" /> <span>Activo</span></label>
            <div className="field full"><label>Descripcion comercial</label><textarea name="description" onChange={(event) => setDescription(uppercaseMasterName(event.target.value))} value={description} /></div>
            <div className="field full">
              <label>Foto</label>
              <input
                accept="image/jpeg,image/png,image/webp"
                name="image"
                onChange={async (event) => {
                  const input = event.currentTarget;
                  const result = await optimizeImageInput(input);
                  if (result.file) setPreview(result.previewUrl);
                  else if (result.error) alert(result.error);
                }}
                ref={fileRef}
                type="file"
              />
              <ComboThumb alt={name || "Combo"} src={preview || null} />
            </div>
          </div>

          <div className="section-title-row">
            <h3>Grupos del combo</h3>
            <span className="row-actions">
              <button className="ghost-button" onClick={() => setGroups((current) => [...current, emptyPizzaGroup(current.length)])} type="button">+ Pizza</button>
              <button className="ghost-button" onClick={() => setGroups((current) => [...current, emptyProductGroup(current.length)])} type="button">+ Producto</button>
            </span>
          </div>
          <div className="combo-groups-editor">
            {groups.map((group, groupIndex) => {
              const selectedIds = new Set(group.options.map((option) => option.pizza_flavor_id ?? option.inventory_item_id).filter(Boolean) as string[]);
              const options = group.group_kind === "pizza" ? pizzaFlavors : saleProducts;
              return (
                <article className="compact-card" key={`${group.id ?? "group"}-${groupIndex}`}>
                  <div className="combo-group-header">
                    <input onChange={(event) => patchGroup(groupIndex, { name: uppercaseMasterName(event.target.value) })} value={group.name} />
                    <select
                      onChange={(event) => patchGroup(groupIndex, { group_kind: event.target.value as ComboGroupDraft["group_kind"], options: [], pizza_size_id: event.target.value === "pizza" ? group.pizza_size_id : null, allow_all_flavors: false })}
                      value={group.group_kind}
                    >
                      <option value="pizza">Pizza</option>
                      <option value="sale_product">Producto para venta</option>
                    </select>
                    <input inputMode="numeric" onChange={(event) => patchGroup(groupIndex, { quantity_to_choose: Math.max(1, Number(event.target.value || 1)) })} title="Cantidad a elegir" value={group.quantity_to_choose} />
                    <button className="danger-button" onClick={() => setGroups((current) => current.filter((_, index) => index !== groupIndex))} title="Eliminar grupo" type="button"><Trash2 size={16} /></button>
                  </div>
                  {group.group_kind === "pizza" ? (
                    <div className="field">
                      <label>Tamano obligatorio</label>
                      <select onChange={(event) => patchGroup(groupIndex, { pizza_size_id: event.target.value })} value={group.pizza_size_id ?? ""}>
                        <option value="">Seleccionar</option>
                        {sizes.map((size) => <option key={size.id} value={size.id}>{size.name}</option>)}
                      </select>
                    </div>
                  ) : null}
                  <div className="combo-options-grid">
                    {options.map((option) => {
                      const optionId = option.id;
                      const selected = selectedIds.has(optionId);
                      const supplement = group.options.find((item) => (item.pizza_flavor_id ?? item.inventory_item_id) === optionId)?.supplement_cop ?? 0;
                      return (
                        <label className={`check-option combo-option-card ${selected ? "selected" : ""}`} key={optionId}>
                          <input checked={selected} onChange={() => toggleOption(groupIndex, optionId, group.group_kind)} type="checkbox" />
                          <ComboThumb alt={option.name} src={option.image_src} />
                          <span><strong>{option.name}</strong><small>{"presentation" in option ? option.presentation : ""}</small></span>
                          {selected ? <input inputMode="numeric" onChange={(event) => updateSupplement(groupIndex, optionId, event.target.value)} placeholder="Suplemento" value={supplement ? String(supplement) : ""} /> : null}
                        </label>
                      );
                    })}
                  </div>
                </article>
              );
            })}
          </div>

          <div className="compact-card">
            <h3>Rentabilidad estimada</h3>
            <div className="summary-grid">
              <span>Precio normal <strong>{draft.normal_price_cop > 0 ? formatCop(draft.normal_price_cop) : "Sin calculo"}</strong></span>
              <span>Precio combo <strong>{formatCop(draft.sale_price_cop)}</strong></span>
              <span>Ahorro <strong>{formatCop(metrics.savings)}</strong></span>
              <span>Costo <strong>{draft.estimated_cost_cop ? formatCop(draft.estimated_cost_cop) : "Sin costo"}</strong></span>
              <span>Utilidad <strong>{metrics.profit === null ? "Sin utilidad" : formatCop(metrics.profit)}</strong></span>
              <span>Margen <strong>{formatPercent(metrics.margin)}</strong></span>
            </div>
          </div>

          {state.status !== "idle" ? <p className={`form-status ${state.status}`}>{state.message}</p> : null}
          <div className="form-actions">
            <button className="ghost-button" onClick={onClose} type="button">Cancelar</button>
            <SubmitComboButton />
          </div>
        </form>
      </section>
    </div>
  );
}

function estimateNormalPrice(groups: ComboGroupDraft[], flavors: ComboPizzaFlavorOption[], products: ComboSaleProductOption[]) {
  let total = 0;
  for (const group of groups) {
    const optionPrices = group.options.map((option) => {
      if (group.group_kind === "pizza") {
        const flavor = flavors.find((item) => item.id === option.pizza_flavor_id);
        return flavor?.prices.find((price) => price.size_id === group.pizza_size_id)?.sale_price_cop ?? 0;
      }
      return products.find((item) => item.id === option.inventory_item_id)?.sale_price_cop ?? 0;
    }).filter((price) => price > 0);
    if (optionPrices.length > 0) total += Math.min(...optionPrices) * group.quantity_to_choose;
  }
  return total;
}

function SubmitComboButton() {
  const { pending } = useFormStatus();
  return <button className="primary-button" disabled={pending} type="submit">{pending ? "Guardando..." : "Guardar combo"}</button>;
}

function DeleteComboButton({ combo }: { combo: ComboPriceRecord }) {
  const [state, action] = useActionState(deleteComboConfig, initialState);
  return (
    <form action={action}>
      <input name="id" type="hidden" value={combo.id} />
      <button className="icon-button danger-button" title="Eliminar o inactivar combo" type="submit"><Trash2 size={16} /></button>
      {state.status === "error" ? <span className="sr-only">{state.message}</span> : null}
    </form>
  );
}

function ComboThumb({ alt, src }: { alt: string; src: string | null }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- Supabase signed URLs are dynamic and cannot be declared as static Next/Image hosts here.
    <img alt={alt} className="product-thumb" height={52} src={src} width={52} />
  ) : <span className="image-placeholder small">CMB</span>;
}
