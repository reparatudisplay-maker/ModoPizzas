"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { saveInventoryItem, type FormActionState } from "@/app/admin/actions";

type StockUnit = "g" | "kg" | "ml" | "l" | "unit";
export type ItemKind = "ingredient" | "sale_product" | "supply";

export type InventoryProduct = {
  id: string;
  name: string;
  unit: StockUnit;
  item_kind: ItemKind | null;
  category_id: string | null;
  is_active: boolean;
};

type ProductCategory = {
  id: string;
  name: string;
  is_active: boolean;
};

const productUnitOptions = [
  { value: "kg", label: "Peso (g / kg)" },
  { value: "l", label: "Volumen (ml / l)" },
  { value: "unit", label: "Unidad" }
] as const;

const initialFormActionState: FormActionState = {
  status: "idle",
  message: ""
};

function productUnitValue(unit?: StockUnit) {
  if (unit === "g" || unit === "kg") return "kg";
  if (unit === "ml" || unit === "l") return "l";
  return "unit";
}

export function ProductForm({
  categories,
  item,
  onSaved,
  onCancel
}: {
  categories: ProductCategory[];
  item?: InventoryProduct | null;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const [state, formAction] = useActionState(saveInventoryItem, initialFormActionState);
  const [itemKind, setItemKind] = useState<ItemKind | "">(item?.item_kind ?? "");

  useEffect(() => {
    if (state.status !== "success") return;
    const timeout = window.setTimeout(() => {
      onSaved?.();
    }, 1400);
    return () => window.clearTimeout(timeout);
  }, [onSaved, state.status]);

  return (
    <form action={formAction} className="compact-card">
      {item ? <input name="id" type="hidden" value={item.id} /> : null}
      <div>
        <h3>{item ? `Editar ${item.name}` : "Agregar producto"}</h3>
        {item ? <span className="badge">{item.is_active ? "Activo" : "Inactivo"}</span> : <span className="badge">Maestro</span>}
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Producto</label>
          <input defaultValue={item?.name} name="name" required />
        </div>
        <div className="field">
          <label>Tipo de producto</label>
          <select
            name="item_kind"
            onChange={(event) => {
              const nextKind = event.target.value as ItemKind | "";
              setItemKind(nextKind);
            }}
            required
            value={itemKind}
          >
            <option value="" disabled>
              Selecciona un tipo
            </option>
            <option value="ingredient">Ingrediente</option>
            <option value="sale_product">Producto para venta</option>
            <option value="supply">Insumo</option>
          </select>
        </div>
        {itemKind === "sale_product" ? (
          <input name="unit" type="hidden" value="unit" />
        ) : (
          <div className="field">
            <label>Unidad o tipo de medida</label>
            <select defaultValue={productUnitValue(item?.unit)} name="unit" required>
              {productUnitOptions.map((unit) => (
                <option key={unit.value} value={unit.value}>
                  {unit.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field full">
          <label>Categoria</label>
          <div className="linked-field">
            <select defaultValue={item?.category_id ?? ""} name="category_id">
              <option value="">Sin categoria</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <Link className="ghost-button" href="/panel/categorias" title="Agregar categoria">
              <Plus size={18} />
            </Link>
          </div>
        </div>
      </div>
      <label className="check-option">
        <input defaultChecked={item?.is_active ?? true} name="is_active" type="checkbox" />
        <span>Activo</span>
      </label>
      {state.status !== "idle" ? <p className={`form-status ${state.status}`}>{state.message}</p> : null}
      <div className="form-actions">
        <button className="ghost-button" onClick={onCancel} type="button">
          Cancelar
        </button>
        <ProductSubmitButton isEditing={Boolean(item)} />
      </div>
    </form>
  );
}

function ProductSubmitButton({ isEditing }: { isEditing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className="primary-button" disabled={pending} type="submit">
      {pending ? "Guardando..." : isEditing ? "Actualizar producto" : "Guardar producto"}
    </button>
  );
}

export function ProductModal({
  categories,
  editProduct
}: {
  categories: ProductCategory[];
  editProduct?: InventoryProduct | null;
}) {
  const [isOpen, setIsOpen] = useState(Boolean(editProduct));
  const router = useRouter();

  function closeModal() {
    setIsOpen(false);
    router.replace("/panel/productos");
    router.refresh();
  }

  return (
    <>
      <button className="primary-button add-purchase-button" onClick={() => setIsOpen(true)} type="button">
        <Plus size={18} /> Agregar producto
      </button>
      {isOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section aria-label={editProduct ? "Editar producto" : "Agregar producto"} aria-modal="true" className="modal-panel purchase-modal" role="dialog">
            <header className="modal-header">
              <div>
                <strong>{editProduct ? "Editar producto" : "Agregar producto"}</strong>
                <span>Dato maestro para compras, inventario y recetas.</span>
              </div>
              <button className="icon-button" onClick={closeModal} title="Cerrar" type="button">
                <X size={18} />
              </button>
            </header>
            <ProductForm categories={categories} item={editProduct} onCancel={closeModal} onSaved={closeModal} />
          </section>
        </div>
      ) : null}
    </>
  );
}
