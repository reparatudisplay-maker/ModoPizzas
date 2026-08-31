"use client";

import Image from "next/image";
import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { ImagePlus, Pencil, Plus, Settings, Trash2, X } from "lucide-react";
import { deleteMarketingPromotion, saveMarketingPromotion, type FormActionState } from "@/app/admin/actions";
import { optimizeImageInput } from "@/lib/client-images";
import { normalizeMasterText, uppercaseMasterName } from "@/lib/master-normalization";

export type MarketingPromotionRecord = {
  id: string;
  name: string;
  image_url: string | null;
  image_src?: string | null;
  main_text: string;
  secondary_text: string | null;
  normal_price_cop: number | null;
  promo_price_cop: number | null;
  starts_at: string | null;
  ends_at: string | null;
  status: "draft" | "active" | "paused" | "expired";
  is_active: boolean;
  updated_at: string;
  pizza_price_ids: string[];
  sale_product_ids: string[];
  project_ids: string[];
};

export type MarketingSelectable = {
  id: string;
  label: string;
  image_src?: string | null;
  price_cop?: number | null;
};

type Column = "image" | "main" | "price" | "dates" | "screens" | "status" | "actions";
type ModalState = { item: MarketingPromotionRecord | null } | null;
const initialState: FormActionState = { status: "idle", message: "" };
const allColumns: Column[] = ["image", "main", "price", "dates", "screens", "status", "actions"];
const defaultColumns: Column[] = ["image", "main", "price", "dates", "screens", "status", "actions"];

function formatCop(value: number | null | undefined) {
  if (value === null || value === undefined) return "Sin precio";
  return `$ ${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(value)}`;
}

function readColumns() {
  if (typeof window === "undefined") return defaultColumns;
  try {
    const parsed = JSON.parse(window.localStorage.getItem("modopizzas.marketing.promotions.columns") ?? "null");
    return Array.isArray(parsed) ? parsed.filter((item): item is Column => allColumns.includes(item)) : defaultColumns;
  } catch {
    return defaultColumns;
  }
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="primary-button" disabled={pending} type="submit">
      {pending ? "Guardando..." : label}
    </button>
  );
}

export function MarketingPromotionsWorkspace({
  promotions,
  pizzaPrices,
  saleProducts,
  projects
}: {
  promotions: MarketingPromotionRecord[];
  pizzaPrices: MarketingSelectable[];
  saleProducts: MarketingSelectable[];
  projects: MarketingSelectable[];
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [columns, setColumns] = useState<Column[]>(readColumns);
  const [showSettings, setShowSettings] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const normalizedQuery = normalizeMasterText(query);

  const filtered = useMemo(
    () =>
      promotions.filter((promotion) => {
        const matchesQuery =
          !normalizedQuery ||
          normalizeMasterText(`${promotion.name} ${promotion.main_text} ${promotion.secondary_text ?? ""}`).includes(normalizedQuery);
        const matchesStatus = status ? promotion.status === status : true;
        return matchesQuery && matchesStatus;
      }),
    [normalizedQuery, promotions, status]
  );

  function toggleColumn(column: Column) {
    setColumns((current) => {
      const next = current.includes(column) ? current.filter((item) => item !== column) : [...current, column];
      const safe = next.length ? next : defaultColumns;
      window.localStorage.setItem("modopizzas.marketing.promotions.columns", JSON.stringify(safe));
      return safe;
    });
  }

  return (
    <section className="marketing-workspace">
      <div className="marketing-toolbar">
        <input onChange={(event) => setQuery(uppercaseMasterName(event.target.value))} placeholder="Buscar promocion" value={query} />
        <select onChange={(event) => setStatus(event.target.value)} value={status}>
          <option value="">Todos los estados</option>
          <option value="draft">Borrador</option>
          <option value="active">Activa</option>
          <option value="paused">Pausada</option>
          <option value="expired">Expirada</option>
        </select>
        <button className="ghost-button icon-text-button" onClick={() => setShowSettings(true)} type="button">
          <Settings size={18} /> Columnas
        </button>
        <button className="primary-button" onClick={() => setModal({ item: null })} type="button">
          <Plus size={18} /> Nueva promocion
        </button>
      </div>

      <div className="marketing-promo-grid">
        {filtered.map((promotion) => (
          <article className="marketing-promo-card" key={promotion.id}>
            {columns.includes("image") ? (
              promotion.image_src ? <Image alt={promotion.name} height={116} src={promotion.image_src} unoptimized width={180} /> : <span>Sin imagen</span>
            ) : null}
            <div className="marketing-promo-body">
              <strong>{promotion.name}</strong>
              {columns.includes("main") ? <p>{promotion.main_text}</p> : null}
              {columns.includes("price") ? (
                <div className="marketing-price-row">
                  <span>{formatCop(promotion.normal_price_cop)}</span>
                  <b>{formatCop(promotion.promo_price_cop)}</b>
                </div>
              ) : null}
              {columns.includes("dates") ? <small>{promotion.starts_at ?? "Sin inicio"} - {promotion.ends_at ?? "Sin fin"}</small> : null}
              {columns.includes("screens") ? <small>{promotion.project_ids.length || "Sin"} pantallas</small> : null}
              {columns.includes("status") ? <span className={`status-pill ${promotion.is_active ? "success" : "muted"}`}>{promotion.status}</span> : null}
            </div>
            {columns.includes("actions") ? (
              <div className="compact-actions-row">
                <button className="icon-button" onClick={() => setModal({ item: promotion })} title="Editar" type="button">
                  <Pencil size={16} />
                </button>
                <DeletePromotionButton id={promotion.id} />
              </div>
            ) : null}
          </article>
        ))}
        {filtered.length === 0 ? <p className="empty-state">No hay promociones con estos filtros.</p> : null}
      </div>

      {modal ? (
        <PromotionModal
          item={modal.item}
          onClose={() => setModal(null)}
          pizzaPrices={pizzaPrices}
          projects={projects}
          saleProducts={saleProducts}
        />
      ) : null}
      {showSettings ? (
        <div className="modal-backdrop">
          <section className="modal-panel inventory-settings-modal">
            <header className="modal-header">
              <strong>Columnas de promociones</strong>
              <button className="icon-button" onClick={() => setShowSettings(false)} type="button">
                <X size={18} />
              </button>
            </header>
            <div className="column-settings-grid">
              {allColumns.map((column) => (
                <label className="check-option" key={column}>
                  <input checked={columns.includes(column)} onChange={() => toggleColumn(column)} type="checkbox" />
                  <span>{column}</span>
                </label>
              ))}
            </div>
            <div className="form-actions modal-form-actions">
              <button
                className="ghost-button"
                onClick={() => {
                  setColumns(defaultColumns);
                  window.localStorage.setItem("modopizzas.marketing.promotions.columns", JSON.stringify(defaultColumns));
                }}
                type="button"
              >
                Restablecer columnas
              </button>
              <button className="primary-button" onClick={() => setShowSettings(false)} type="button">
                Cerrar
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function PromotionModal({
  item,
  onClose,
  pizzaPrices,
  saleProducts,
  projects
}: {
  item: MarketingPromotionRecord | null;
  onClose: () => void;
  pizzaPrices: MarketingSelectable[];
  saleProducts: MarketingSelectable[];
  projects: MarketingSelectable[];
}) {
  const [state, action] = useActionState(saveMarketingPromotion, initialState);
  const [imagePreview, setImagePreview] = useState(item?.image_src ?? "");
  const [imageError, setImageError] = useState("");
  const [removeImage, setRemoveImage] = useState(false);
  const [pizzaIds, setPizzaIds] = useState(item?.pizza_price_ids ?? []);
  const [productIds, setProductIds] = useState(item?.sale_product_ids ?? []);
  const [projectIds, setProjectIds] = useState(item?.project_ids ?? []);

  return (
    <div className="modal-backdrop">
      <section className="modal-panel marketing-modal">
        <header className="modal-header">
          <strong>{item ? "Editar promocion" : "Nueva promocion"}</strong>
          <button className="icon-button" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </header>
        <form action={action} className="marketing-promotion-form">
          {item ? <input name="id" type="hidden" value={item.id} /> : null}
          <input name="previous_image_url" type="hidden" value={item?.image_url ?? ""} />
          <input name="remove_image" type="hidden" value={removeImage ? "on" : ""} />
          <input name="pizza_price_ids" type="hidden" value={JSON.stringify(pizzaIds)} />
          <input name="sale_product_ids" type="hidden" value={JSON.stringify(productIds)} />
          <input name="project_ids" type="hidden" value={JSON.stringify(projectIds)} />
          <div className="form-grid">
            <div className="field">
              <label>Nombre</label>
              <input defaultValue={item?.name ?? ""} name="name" onInput={(event) => (event.currentTarget.value = uppercaseMasterName(event.currentTarget.value))} required />
            </div>
            <div className="field">
              <label>Estado</label>
              <select defaultValue={item?.status ?? "draft"} name="status">
                <option value="draft">Borrador</option>
                <option value="active">Activa</option>
                <option value="paused">Pausada</option>
                <option value="expired">Expirada</option>
              </select>
            </div>
            <div className="field full">
              <label>Texto principal</label>
              <input defaultValue={item?.main_text ?? ""} name="main_text" onInput={(event) => (event.currentTarget.value = uppercaseMasterName(event.currentTarget.value))} required />
            </div>
            <div className="field full">
              <label>Texto secundario</label>
              <input defaultValue={item?.secondary_text ?? ""} name="secondary_text" onInput={(event) => (event.currentTarget.value = uppercaseMasterName(event.currentTarget.value))} />
            </div>
            <div className="field">
              <label>Precio normal</label>
              <input defaultValue={item?.normal_price_cop ?? ""} inputMode="numeric" name="normal_price_cop" />
            </div>
            <div className="field">
              <label>Precio promocional</label>
              <input defaultValue={item?.promo_price_cop ?? ""} inputMode="numeric" name="promo_price_cop" />
            </div>
            <div className="field">
              <label>Fecha inicio</label>
              <input defaultValue={item?.starts_at ?? ""} name="starts_at" type="date" />
            </div>
            <div className="field">
              <label>Fecha fin</label>
              <input defaultValue={item?.ends_at ?? ""} name="ends_at" type="date" />
            </div>
          </div>
          <div className="marketing-form-split">
            <div className="marketing-image-picker">
              <label>Imagen</label>
              <div className="marketing-image-preview">{imagePreview && !removeImage ? <Image alt="Promocion" fill src={imagePreview} unoptimized /> : <span>Sin imagen</span>}</div>
              <label className="ghost-button">
                <ImagePlus size={16} /> Subir imagen
                <input
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  name="image"
                  onChange={async (event) => {
                    const result = await optimizeImageInput(event.currentTarget);
                    if (result.error) {
                      setImageError(result.error);
                      return;
                    }
                    setImagePreview(result.previewUrl ?? "");
                    setRemoveImage(false);
                    setImageError("");
                  }}
                  type="file"
                />
              </label>
              {imagePreview && !removeImage ? (
                <button className="ghost-button" onClick={() => setRemoveImage(true)} type="button">
                  Eliminar imagen
                </button>
              ) : null}
              {imageError ? <p className="form-status error">{imageError}</p> : null}
            </div>
            <RelationPicker label="Pizzas relacionadas" options={pizzaPrices} selected={pizzaIds} setSelected={setPizzaIds} />
            <RelationPicker label="Productos relacionados" options={saleProducts} selected={productIds} setSelected={setProductIds} />
            <RelationPicker label="Pantallas" options={projects} selected={projectIds} setSelected={setProjectIds} />
          </div>
          <label className="check-option">
            <input defaultChecked={item?.is_active ?? true} name="is_active" type="checkbox" />
            <span>Activo</span>
          </label>
          {state.status !== "idle" ? <p className={`form-status ${state.status}`}>{state.message}</p> : null}
          <div className="form-actions modal-form-actions">
            <button className="ghost-button" onClick={onClose} type="button">
              Cancelar
            </button>
            <SubmitButton label={item ? "Actualizar promocion" : "Guardar promocion"} />
          </div>
        </form>
      </section>
    </div>
  );
}

function RelationPicker({
  label,
  options,
  selected,
  setSelected
}: {
  label: string;
  options: MarketingSelectable[];
  selected: string[];
  setSelected: (value: string[]) => void;
}) {
  return (
    <div className="marketing-relation-picker">
      <strong>{label}</strong>
      <div className="compact-check-grid">
        {options.map((option) => (
          <label className="check-option compact-check-option" key={option.id}>
            <input checked={selected.includes(option.id)} onChange={() => setSelected(toggleLocal(selected, option.id))} type="checkbox" />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function toggleLocal(values: string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function DeletePromotionButton({ id }: { id: string }) {
  const [state, action] = useActionState(deleteMarketingPromotion, initialState);
  return (
    <form action={action}>
      <input name="id" type="hidden" value={id} />
      <button
        className="icon-button danger"
        onClick={(event) => {
          if (!window.confirm("Eliminar esta promocion?")) event.preventDefault();
        }}
        title="Eliminar"
        type="submit"
      >
        <Trash2 size={16} />
      </button>
      {state.status === "error" ? <span className="form-status error">{state.message}</span> : null}
    </form>
  );
}
