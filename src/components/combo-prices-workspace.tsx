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
  prices: Array<{ price_config_id: string; size_id: string; sale_price_cop: number; estimated_cost_cop: number | null }>;
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
  unit_cost_cop: number | null;
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
    is_active: boolean;
    sort_order: number;
  }>;
};

export type ComboVariantDraft = {
  id?: string | null;
  name: string;
  sale_price_cop: number;
  sort_order: number;
  is_active: boolean;
  groups: ComboGroupDraft[];
  normal_price_min_cop?: number | null;
  normal_price_max_cop?: number | null;
  estimated_cost_min_cop?: number | null;
  estimated_cost_max_cop?: number | null;
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
  estimated_cost_min_cop: number | null;
  estimated_cost_max_cop: number | null;
  variants: ComboVariantDraft[];
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

function emptyVariant(sortOrder: number): ComboVariantDraft {
  return {
    name: `GRUPO ${sortOrder + 1}`,
    sale_price_cop: 0,
    sort_order: sortOrder,
    is_active: true,
    groups: [emptyPizzaGroup(0), emptyProductGroup(1)]
  };
}

function comboMetrics(combo: Pick<ComboPriceRecord, "normal_price_cop" | "sale_price_cop" | "estimated_cost_min_cop" | "estimated_cost_max_cop">) {
  const normal = Number(combo.normal_price_cop ?? 0);
  const price = Number(combo.sale_price_cop ?? 0);
  const maxCost = combo.estimated_cost_max_cop && combo.estimated_cost_max_cop > 0 ? combo.estimated_cost_max_cop : null;
  return {
    savings: Math.max(0, normal - price),
    profit: maxCost === null || price <= 0 ? null : price - maxCost,
    margin: maxCost === null || price <= 0 ? null : ((price - maxCost) / price) * 100
  };
}

function formatCostRange(min: number | null, max: number | null) {
  if (min === null || max === null || max <= 0) return "Sin costo disponible";
  return min === max ? formatCop(max) : `${formatCop(min)} - ${formatCop(max)}`;
}

function formatMoneyRange(min: number | null | undefined, max: number | null | undefined) {
  if (min === null || min === undefined || max === null || max === undefined || min <= 0 || max <= 0) return "Sin calculo";
  return min === max ? formatCop(min) : `${formatCop(min)} - ${formatCop(max)}`;
}

function formatSavings(normalMin: number | null, normalMax: number | null, price: number) {
  if (normalMin === null || normalMax === null) return "Sin calculo";
  const min = Math.max(0, normalMin - price);
  const max = Math.max(0, normalMax - price);
  if (max <= 0) return "Sin ahorro";
  if (min <= 0) return `Hasta ${formatCop(max)}`;
  return formatMoneyRange(min, max);
}

function variantContent(variant: ComboVariantDraft, flavors: ComboPizzaFlavorOption[], products: ComboSaleProductOption[]) {
  const pizzaNames = new Set<string>();
  const productNames = new Set<string>();
  for (const group of variant.groups) {
    for (const option of group.options.filter((item) => item.is_active)) {
      if (group.group_kind === "pizza") {
        const name = flavors.find((flavor) => flavor.id === option.pizza_flavor_id)?.name;
        if (name) pizzaNames.add(name);
      } else {
        const name = products.find((product) => product.id === option.inventory_item_id)?.name;
        if (name) productNames.add(name);
      }
    }
  }
  return `${variant.name}: ${[...pizzaNames].join(" / ")}${productNames.size ? ` + ${[...productNames].join(" / ")}` : ""}`;
}

function variantMetrics(variant: ComboVariantDraft) {
  const normalMin = variant.normal_price_min_cop ?? null;
  const normalMax = variant.normal_price_max_cop ?? null;
  const costMin = variant.estimated_cost_min_cop ?? null;
  const costMax = variant.estimated_cost_max_cop ?? null;
  const price = Number(variant.sale_price_cop ?? 0);
  return {
    normal: formatMoneyRange(normalMin, normalMax),
    savings: formatSavings(normalMin, normalMax, price),
    cost: formatCostRange(costMin, costMax),
    profit: costMax === null || price <= 0 ? "Sin utilidad" : formatMoneyRange(price - costMax, price - costMin!),
    margin: costMax === null || price <= 0 ? "Sin margen" : formatPercent(((price - costMax) / price) * 100)
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
                return (
                  <tr key={combo.id}>
                    <td><ComboThumb alt={combo.name} src={combo.image_src} /></td>
                    <td>{combo.sku}</td>
                    <td><strong>{combo.name}</strong><br /><small>{combo.description ?? "Sin descripcion"}</small></td>
                    <td>{combo.variants.map((variant) => <div key={variant.id ?? variant.sort_order}>{variantContent(variant, pizzaFlavors, saleProducts)}</div>) || "Sin grupos"}</td>
                    <td>{combo.variants.map((variant) => <div key={variant.id ?? variant.sort_order}>{variantMetrics(variant).normal}</div>)}</td>
                    <td>{combo.variants.map((variant) => <div key={variant.id ?? variant.sort_order}>{formatCop(variant.sale_price_cop)}</div>)}</td>
                    <td>{combo.variants.map((variant) => <div key={variant.id ?? variant.sort_order}>{variantMetrics(variant).savings}</div>)}</td>
                    <td>{combo.variants.map((variant) => <div key={variant.id ?? variant.sort_order}>{variantMetrics(variant).cost}</div>)}</td>
                    <td>{combo.variants.map((variant) => <div key={variant.id ?? variant.sort_order}>{variantMetrics(variant).profit}</div>)}</td>
                    <td>{combo.variants.map((variant) => <div key={variant.id ?? variant.sort_order}>{variantMetrics(variant).margin}</div>)}</td>
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
  const [sortOrder, setSortOrder] = useState(String(combo?.sort_order ?? 0));
  const [isActive, setIsActive] = useState(combo?.is_active ?? true);
  const [variants, setVariants] = useState<ComboVariantDraft[]>(combo?.variants.length ? combo.variants : [emptyVariant(0), emptyVariant(1), emptyVariant(2)]);
  const [preview, setPreview] = useState(combo?.image_src ?? "");
  const fileRef = useRef<HTMLInputElement>(null);
  const costRange = estimateCostRange(variants, pizzaFlavors, saleProducts);
  const draft: ComboPriceRecord = {
    id: combo?.id ?? "",
    sku: combo?.sku ?? "AUTO",
    name,
    description,
    image_src: preview,
    image_url: combo?.image_url ?? null,
    sale_price_cop: variants.length ? Math.min(...variants.map((variant) => variant.sale_price_cop)) : 0,
    is_active: isActive,
    sort_order: Number(sortOrder || 0),
    normal_price_cop: combo?.normal_price_cop ?? estimateNormalPrice(variants, pizzaFlavors, saleProducts),
    estimated_cost_cop: combo?.estimated_cost_cop ?? null,
    estimated_cost_min_cop: combo?.estimated_cost_min_cop ?? costRange.min,
    estimated_cost_max_cop: combo?.estimated_cost_max_cop ?? costRange.max,
    variants
  };
  const metrics = comboMetrics(draft);

  useEffect(() => {
    if (state.status === "success") {
      const timeout = window.setTimeout(onClose, 700);
      return () => window.clearTimeout(timeout);
    }
    return undefined;
  }, [onClose, state.status]);

  function patchVariant(index: number, update: Partial<ComboVariantDraft>) {
    setVariants((current) => current.map((variant, currentIndex) => currentIndex === index ? { ...variant, ...update } : variant));
  }

  function patchGroup(variantIndex: number, groupIndex: number, update: Partial<ComboGroupDraft>) {
    setVariants((current) => current.map((variant, index) => index === variantIndex ? { ...variant, groups: variant.groups.map((group, position) => position === groupIndex ? { ...group, ...update } : group) } : variant));
  }

  function toggleOption(variantIndex: number, groupIndex: number, sourceId: string, kind: "pizza" | "sale_product") {
    setVariants((current) =>
      current.map((variant, variantPosition) => {
        if (variantPosition !== variantIndex) return variant;
        return {
          ...variant,
          groups: variant.groups.map((group, index) => {
            if (index !== groupIndex) return group;
        const exists = group.options.some((option) => (kind === "pizza" ? option.pizza_flavor_id : option.inventory_item_id) === sourceId);
        const options = exists
          ? group.options.filter((option) => (kind === "pizza" ? option.pizza_flavor_id : option.inventory_item_id) !== sourceId)
          : [
              ...group.options,
              {
                pizza_flavor_id: kind === "pizza" ? sourceId : null,
                inventory_item_id: kind === "sale_product" ? sourceId : null,
                is_active: true,
                sort_order: group.options.length
              }
            ];
            return { ...group, options };
          })
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
          <input name="variants_payload" type="hidden" value={JSON.stringify(variants)} />
          <div className="combo-editor-grid">
            <div className="field"><label>Nombre</label><input name="name" onChange={(event) => setName(uppercaseMasterName(event.target.value))} required value={name} /></div>
            <div className="field"><label>Orden de listado</label><input inputMode="numeric" name="sort_order" onChange={(event) => setSortOrder(event.target.value.replace(/\D/g, ""))} value={sortOrder} /></div>
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

          <div className="section-title-row combo-groups-title-row">
            <div>
              <h3>Grupos de precio</h3>
              <p>Cada grupo define un precio fijo y los ítems que incluye el combo.</p>
            </div>
            <button className="ghost-button" onClick={() => setVariants((current) => [...current, emptyVariant(current.length)])} type="button">+ Agregar grupo de precio</button>
          </div>
          <div className="combo-groups-editor">
            {variants.map((variant, variantIndex) => {
              return (
                <article className="combo-variant-editor" key={`${variant.id ?? "variant"}-${variantIndex}`}>
                  <header className="combo-variant-header">
                    <div className="combo-variant-heading">
                      <span>Grupo de precio {variantIndex + 1}</span>
                      <input aria-label="Nombre del grupo de sabores" onChange={(event) => patchVariant(variantIndex, { name: uppercaseMasterName(event.target.value) })} value={variant.name} />
                    </div>
                    <label className="combo-fixed-price">Precio fijo <input inputMode="numeric" onChange={(event) => patchVariant(variantIndex, { sale_price_cop: Math.max(0, Math.round(Number(event.target.value.replace(/\D/g, "") || 0))) })} value={variant.sale_price_cop || ""} /></label>
                    <button className="icon-button danger-button" onClick={() => setVariants((current) => current.filter((_, index) => index !== variantIndex))} title="Eliminar grupo de precio" type="button"><Trash2 size={16} /></button>
                  </header>
                  <div className="combo-variant-context">
                    <strong>Ítems incluidos en este grupo</strong>
                    <span>Configura cada pizza y producto dentro de este precio fijo.</span>
                  </div>
                  <div className="combo-component-stack">
                  {variant.groups.map((group, groupIndex) => {
                    const selectedIds = new Set(group.options.map((option) => option.pizza_flavor_id ?? option.inventory_item_id).filter(Boolean) as string[]);
                    const options = group.group_kind === "pizza" ? pizzaFlavors : saleProducts;
                    const componentLabel = group.group_kind === "pizza" ? `Pizza ${groupIndex + 1}` : group.name || "Bebida incluida";
                    return <section className="combo-component-group" key={`${group.id ?? "group"}-${groupIndex}`}>
                      <header className="combo-component-header">
                        <div>
                          <span>Ítem {groupIndex + 1}</span>
                          <strong>{componentLabel}</strong>
                        </div>
                        <div className="combo-component-controls">
                          <label className="combo-component-name">Nombre<input aria-label="Nombre del componente" onChange={(event) => patchGroup(variantIndex, groupIndex, { name: uppercaseMasterName(event.target.value) })} value={group.name} /></label>
                          <label>Tipo<select onChange={(event) => patchGroup(variantIndex, groupIndex, { group_kind: event.target.value as ComboGroupDraft["group_kind"], options: [], pizza_size_id: event.target.value === "pizza" ? group.pizza_size_id : null, allow_all_flavors: false })} value={group.group_kind}>
                            <option value="pizza">Pizza</option>
                            <option value="sale_product">Producto para venta</option>
                          </select></label>
                          <label>Cantidad<input inputMode="numeric" onChange={(event) => patchGroup(variantIndex, groupIndex, { quantity_to_choose: Math.max(1, Number(event.target.value || 1)) })} value={group.quantity_to_choose} /></label>
                          <button className="icon-button danger-button" onClick={() => patchVariant(variantIndex, { groups: variant.groups.filter((_, index) => index !== groupIndex) })} title={`Eliminar ${componentLabel}`} type="button"><Trash2 size={16} /></button>
                        </div>
                      </header>
                      <div className="combo-component-body">
                        {group.group_kind === "pizza" ? <div className="field combo-size-field"><label>Tamaño obligatorio</label><select onChange={(event) => patchGroup(variantIndex, groupIndex, { pizza_size_id: event.target.value })} value={group.pizza_size_id ?? ""}><option value="">Seleccionar</option>{sizes.map((size) => <option key={size.id} value={size.id}>{size.name}</option>)}</select></div> : null}
                        <div className="combo-options-heading"><strong>Opciones disponibles</strong><span>{selectedIds.size} seleccionada{selectedIds.size === 1 ? "" : "s"}</span></div>
                        <div className="combo-options-grid">{options.map((option) => {
                        const selected = selectedIds.has(option.id);
                        return <label className={`check-option combo-option-card ${selected ? "selected" : ""}`} key={option.id}>
                          <input checked={selected} onChange={() => toggleOption(variantIndex, groupIndex, option.id, group.group_kind)} type="checkbox" />
                          <ComboThumb alt={option.name} src={option.image_src} />
                          <span><strong>{option.name}</strong><small>{"presentation" in option ? option.presentation : ""}</small></span>
                        </label>;
                        })}</div>
                      </div>
                    </section>;
                  })}
                  </div>
                  <div className="combo-group-add-actions"><span>Agregar ítem a este grupo</span><div><button className="ghost-button" onClick={() => patchVariant(variantIndex, { groups: [...variant.groups, emptyPizzaGroup(variant.groups.length)] })} type="button">+ Pizza</button><button className="ghost-button" onClick={() => patchVariant(variantIndex, { groups: [...variant.groups, emptyProductGroup(variant.groups.length)] })} type="button">+ Producto</button></div></div>
                </article>
              );
            })}
          </div>

          <div className="compact-card combo-profitability-summary">
            <h3>Rentabilidad estimada</h3>
            <div className="summary-grid">
              <span>Precio normal <strong>{draft.normal_price_cop > 0 ? formatCop(draft.normal_price_cop) : "Sin calculo"}</strong></span>
              <span>Precio combo <strong>{formatCop(draft.sale_price_cop)}</strong></span>
              <span>Ahorro <strong>{formatCop(metrics.savings)}</strong></span>
              <span>Costo estimado <strong>{formatCostRange(draft.estimated_cost_min_cop, draft.estimated_cost_max_cop)}</strong></span>
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

function estimateNormalPrice(variants: ComboVariantDraft[], flavors: ComboPizzaFlavorOption[], products: ComboSaleProductOption[]) {
  return Math.min(...variants.map((variant) => variant.groups.reduce((total, group) => {
    const optionPrices = group.options.map((option) => group.group_kind === "pizza"
      ? flavors.find((item) => item.id === option.pizza_flavor_id)?.prices.find((price) => price.size_id === group.pizza_size_id)?.sale_price_cop ?? 0
      : products.find((item) => item.id === option.inventory_item_id)?.sale_price_cop ?? 0
    ).filter((price) => price > 0);
    return total + (optionPrices.length > 0 ? Math.min(...optionPrices) * group.quantity_to_choose : 0);
  }, 0)));
}

function estimateCostRange(variants: ComboVariantDraft[], flavors: ComboPizzaFlavorOption[], products: ComboSaleProductOption[]) {
  const ranges = variants.map((variant) => {
    let min = 0;
    let max = 0;
    let known = true;
    for (const group of variant.groups) {
      const costs = group.options.map((option) => group.group_kind === "pizza"
        ? flavors.find((item) => item.id === option.pizza_flavor_id)?.prices.find((price) => price.size_id === group.pizza_size_id)?.estimated_cost_cop ?? null
        : products.find((item) => item.id === option.inventory_item_id)?.unit_cost_cop ?? null
      ).filter((value): value is number => value !== null && value > 0);
      if (costs.length === 0) { known = false; continue; }
      min += Math.min(...costs) * group.quantity_to_choose;
      max += Math.max(...costs) * group.quantity_to_choose;
    }
    return known ? { min, max } : null;
  }).filter((value): value is { min: number; max: number } => value !== null);
  if (ranges.length === 0) return { min: null, max: null };
  return { min: Math.min(...ranges.map((value) => value.min)), max: Math.max(...ranges.map((value) => value.max)) };
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
