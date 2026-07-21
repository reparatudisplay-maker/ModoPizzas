"use client";

import Image from "next/image";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Check, Plus, X } from "lucide-react";
import {
  deleteInventoryItem,
  saveInventoryItem,
  saveProductCategoryInline,
  type CategoryActionState,
  type FormActionState
} from "@/app/admin/actions";
import { normalizeMasterText, uppercaseMasterName } from "@/lib/master-normalization";

type StockUnit = "g" | "kg" | "ml" | "l" | "unit";
export type ItemKind = "ingredient" | "sale_product" | "supply";
type PurchaseMode = "total_weight" | "packages";

export type InventoryProduct = {
  id: string;
  name: string;
  image_url: string | null;
  image_src?: string | null;
  unit: StockUnit;
  item_kind: ItemKind | null;
  purchase_mode: PurchaseMode | null;
  brand_id: string | null;
  category_id: string | null;
  is_active: boolean;
};

type ProductCategory = {
  id: string;
  name: string;
  is_active: boolean;
};

type Brand = {
  id: string;
  name: string;
  is_active: boolean;
};

const productUnitOptions = [
  { value: "kg", label: "Peso (g / kg)" },
  { value: "l", label: "Volumen (ml / l)" },
  { value: "unit", label: "Unidad" }
] as const;

const unitHelpText = "Peso: harina, queso, carnes. Volumen: aceite, salsa, bebidas. Unidad: cajas, botellas, guantes.";

const initialFormActionState: FormActionState = {
  status: "idle",
  message: ""
};

const initialCategoryActionState: CategoryActionState = {
  status: "idle",
  message: ""
};

function uppercaseValue(value: string) {
  return value.toUpperCase();
}

function normalizeProductName(value: string) {
  return value
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function productUnitValue(unit?: StockUnit) {
  if (unit === "g" || unit === "kg") return "kg";
  if (unit === "ml" || unit === "l") return "l";
  return "unit";
}

export function ProductForm({
  categories,
  brands,
  products,
  item,
  onSaved,
  onCancel
}: {
  categories: ProductCategory[];
  brands: Brand[];
  products: InventoryProduct[];
  item?: InventoryProduct | null;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const [state, formAction] = useActionState(saveInventoryItem, initialFormActionState);
  const [itemKind, setItemKind] = useState<ItemKind | "">(item?.item_kind ?? "");
  const [unit, setUnit] = useState(productUnitValue(item?.unit));
  const [purchaseMode, setPurchaseMode] = useState<PurchaseMode>(item?.purchase_mode ?? "total_weight");
  const [productName, setProductName] = useState(item?.name ?? "");
  const [imagePreview, setImagePreview] = useState(item?.image_src ?? item?.image_url ?? "");
  const [removeImage, setRemoveImage] = useState(false);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [categoryOptions, setCategoryOptions] = useState(categories);
  const [categoryId, setCategoryId] = useState(item?.category_id ?? "");
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [isNameOpen, setIsNameOpen] = useState(false);
  const [activeNameIndex, setActiveNameIndex] = useState(0);
  const normalizedName = normalizeProductName(productName);
  const matchingProducts = products
    .filter((product) => product.id !== item?.id && normalizeProductName(product.name).includes(normalizedName))
    .slice(0, 8);
  const duplicateProduct = products.find((product) => product.id !== item?.id && normalizeProductName(product.name) === normalizedName);
  const canRegisterName = normalizedName.length > 0 && !duplicateProduct;
  const brandHint = itemKind === "sale_product" ? "Recomendada para diferenciar referencias comerciales." : "Opcional.";
  const categoryHint = itemKind === "sale_product" ? "Recomendada para organizar productos de venta." : "Opcional.";
  const imageHint = itemKind === "sale_product" ? "Recomendada. JPG, PNG, WEBP o GIF hasta 4 MB." : "Opcional. JPG, PNG, WEBP o GIF hasta 4 MB.";

  function handleItemKindChange(nextKind: ItemKind) {
    setItemKind(nextKind);
  }

  useEffect(() => {
    if (state.status !== "success") return;
    const timeout = window.setTimeout(() => {
      onSaved?.();
    }, 1400);
    return () => window.clearTimeout(timeout);
  }, [onSaved, state.status]);

  useEffect(() => {
    return () => {
      if (imagePreview.startsWith("blob:")) {
        URL.revokeObjectURL(imagePreview);
      }
    };
  }, [imagePreview]);

  return (
    <>
    <form action={formAction} className="compact-card">
      {item ? <input name="id" type="hidden" value={item.id} /> : null}
      <div>
        <h3>{item ? `Editar ${item.name}` : "Agregar producto"}</h3>
        {item ? <span className="badge">{item.is_active ? "Activo" : "Inactivo"}</span> : <span className="badge">Maestro</span>}
      </div>
      <div className="form-grid">
        <div className="field autocomplete-field">
          <label>Producto</label>
          <input
            autoComplete="off"
            name="name"
            onBlur={() => window.setTimeout(() => setIsNameOpen(false), 120)}
            onChange={(event) => {
              setProductName(uppercaseValue(event.target.value));
              setIsNameOpen(true);
              setActiveNameIndex(0);
            }}
            onFocus={() => setIsNameOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setIsNameOpen(true);
                setActiveNameIndex((current) => Math.min(current + 1, Math.max(matchingProducts.length - 1, 0)));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveNameIndex((current) => Math.max(current - 1, 0));
              }
              if (event.key === "Enter" && matchingProducts[activeNameIndex]) {
                event.preventDefault();
                setProductName(matchingProducts[activeNameIndex].name);
                setIsNameOpen(false);
              }
              if (event.key === "Escape") {
                setIsNameOpen(false);
              }
            }}
            required
            value={productName}
          />
          {isNameOpen ? (
            <div className="autocomplete-menu">
              {matchingProducts.map((product, index) => (
                <button
                  className={`autocomplete-option duplicate-option${index === activeNameIndex ? " active" : ""}`}
                  key={product.id}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    setProductName(product.name);
                    setIsNameOpen(false);
                  }}
                  type="button"
                >
                  <span>{product.name}</span>
                  <span className="availability-badge danger">— Registrado <X size={14} /></span>
                </button>
              ))}
              {productName.trim() ? (
                <div className={`autocomplete-option availability-row ${canRegisterName ? "ok" : "danger"}`}>
                  <span>{productName}</span>
                  <span className={`availability-badge ${canRegisterName ? "ok" : "danger"}`}>
                    — {canRegisterName ? "Registrable" : "Registrado"} {canRegisterName ? <Check size={14} /> : <X size={14} />}
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}
          {duplicateProduct ? <p className="field-hint danger">Ese producto ya esta registrado.</p> : null}
        </div>
        <div className="field full">
          <label>Tipo de producto</label>
          <input name="item_kind" required type="hidden" value={itemKind} />
          <div className="segmented-control triple-segmented">
            {[
              ["ingredient", "Ingrediente"],
              ["sale_product", "Producto para venta"],
              ["supply", "Insumo"]
            ].map(([value, label]) => (
              <button
                aria-pressed={itemKind === value}
                className={itemKind === value ? "active" : ""}
                key={value}
                onClick={() => handleItemKindChange(value as ItemKind)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="field full">
          <label>Unidad o tipo de medida</label>
          <input name="unit" type="hidden" value={unit} />
          <div className="segmented-control triple-segmented">
            {productUnitOptions.map((option) => (
              <button
                aria-pressed={unit === option.value}
                className={unit === option.value ? "active" : ""}
                key={option.value}
                onClick={() => setUnit(option.value)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="field-hint">{unitHelpText}</p>
        </div>
        <div className="field full">
          <label>Forma de compra</label>
          <input name="purchase_mode" type="hidden" value={purchaseMode} />
          <div className="segmented-control compact-segmented">
            <button
              aria-pressed={purchaseMode === "total_weight"}
              className={purchaseMode === "total_weight" ? "active" : ""}
              onClick={() => setPurchaseMode("total_weight")}
              type="button"
            >
              Peso total
            </button>
            <button
              aria-pressed={purchaseMode === "packages"}
              className={purchaseMode === "packages" ? "active" : ""}
              onClick={() => setPurchaseMode("packages")}
              type="button"
            >
              Cantidad / Paquetes
            </button>
          </div>
        </div>
        <div className="field">
          <label>Marca</label>
          <select defaultValue={item?.brand_id ?? ""} name="brand_id">
            <option value="">Sin marca</option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>
          <p className="field-hint">{brandHint}</p>
        </div>
        <div className="field">
          <label>Foto</label>
          <input name="existing_image_url" type="hidden" value={item?.image_url ?? ""} />
          <input name="remove_image" type="hidden" value={removeImage ? "1" : "0"} />
          <input
            accept="image/gif,image/jpeg,image/png,image/webp"
            key={fileInputKey}
            name="product_image"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              if (imagePreview.startsWith("blob:")) {
                URL.revokeObjectURL(imagePreview);
              }
              setImagePreview(URL.createObjectURL(file));
              setRemoveImage(false);
            }}
            type="file"
          />
          <p className="field-hint">{imageHint}</p>
          {imagePreview ? (
            <div className="product-photo-box">
              <Image alt="Foto del producto" className="product-photo-preview" height={135} src={imagePreview} unoptimized width={180} />
              <button
                className="ghost-button"
                onClick={() => {
                  if (imagePreview.startsWith("blob:")) {
                    URL.revokeObjectURL(imagePreview);
                  }
                  setImagePreview("");
                  setRemoveImage(true);
                  setFileInputKey((current) => current + 1);
                }}
                type="button"
              >
                Quitar imagen
              </button>
            </div>
          ) : null}
        </div>
        <div className="field full">
          <label>Categoria</label>
          <div className="linked-field">
            <select name="category_id" onChange={(event) => setCategoryId(event.target.value)} value={categoryId}>
              <option value="">Sin categoria</option>
              {categoryOptions.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <button className="ghost-button" onClick={() => setIsCategoryModalOpen(true)} title="Agregar categoria" type="button">
              <Plus size={18} />
            </button>
          </div>
          <p className="field-hint">{categoryHint}</p>
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
        <ProductSubmitButton disabled={Boolean(duplicateProduct) || !itemKind} isEditing={Boolean(item)} />
      </div>
    </form>
    {isCategoryModalOpen ? (
      <CategoryInlineModal
        categories={categoryOptions}
        onCancel={() => setIsCategoryModalOpen(false)}
        onSaved={(category) => {
          setCategoryOptions((current) => {
            if (current.some((item) => item.id === category.id)) return current;
            return [...current, category].sort((a, b) => a.name.localeCompare(b.name));
          });
          setCategoryId(category.id);
          setIsCategoryModalOpen(false);
        }}
      />
    ) : null}
    </>
  );
}

function CategoryInlineModal({
  categories,
  onCancel,
  onSaved
}: {
  categories: ProductCategory[];
  onCancel: () => void;
  onSaved: (category: ProductCategory) => void;
}) {
  const [state, formAction] = useActionState(saveProductCategoryInline, initialCategoryActionState);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isCategoryOpen, setIsCategoryOpen] = useState(false);
  const [activeCategoryIndex, setActiveCategoryIndex] = useState(0);
  const normalizedCategoryName = normalizeMasterText(name);
  const matchingCategories = normalizedCategoryName
    ? categories.filter((category) => normalizeMasterText(category.name).includes(normalizedCategoryName)).slice(0, 8)
    : [];
  const duplicateCategory = categories.find((category) => normalizeMasterText(category.name) === normalizedCategoryName);
  const canRegisterCategory = normalizedCategoryName.length > 0 && !duplicateCategory;

  useEffect(() => {
    if (state.status === "success" && state.category) {
      const timeout = window.setTimeout(() => onSaved(state.category!), 700);
      return () => window.clearTimeout(timeout);
    }
  }, [onSaved, state]);

  return (
    <div className="modal-backdrop nested-modal-backdrop" role="presentation">
      <section aria-label="Agregar categoria" aria-modal="true" className="modal-panel category-modal" role="dialog">
        <header className="modal-header">
          <div>
            <strong>Nueva categoria</strong>
            <span>Se agregara al selector sin cerrar el producto.</span>
          </div>
          <button className="icon-button" onClick={onCancel} title="Cerrar" type="button">
            <X size={18} />
          </button>
        </header>
        <form action={formAction} className="compact-card">
          <div className="form-grid">
            <div className="field autocomplete-field">
              <label>Nombre</label>
              <input
                autoComplete="off"
                name="name"
                onBlur={() => {
                  setName((current) => uppercaseMasterName(current).trim());
                  window.setTimeout(() => setIsCategoryOpen(false), 120);
                }}
                onChange={(event) => {
                  setName(uppercaseMasterName(event.target.value).trimStart());
                  setIsCategoryOpen(true);
                  setActiveCategoryIndex(0);
                }}
                onFocus={() => setIsCategoryOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setIsCategoryOpen(true);
                    setActiveCategoryIndex((current) => Math.min(current + 1, Math.max(matchingCategories.length - 1, 0)));
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActiveCategoryIndex((current) => Math.max(current - 1, 0));
                  }
                  if (event.key === "Enter" && matchingCategories[activeCategoryIndex]) {
                    event.preventDefault();
                    setName(matchingCategories[activeCategoryIndex].name);
                    setIsCategoryOpen(false);
                  }
                  if (event.key === "Escape") {
                    setIsCategoryOpen(false);
                  }
                }}
                required
                value={name}
              />
              {isCategoryOpen ? (
                <div className="autocomplete-menu">
                  {matchingCategories.map((category, index) => (
                    <button
                      className={`autocomplete-option duplicate-option${index === activeCategoryIndex ? " active" : ""}`}
                      key={category.id}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        setName(category.name);
                        setIsCategoryOpen(false);
                      }}
                      type="button"
                    >
                      <span>{category.name}</span>
                      <span className="availability-badge danger">— REGISTRADO <X size={14} /></span>
                    </button>
                  ))}
                  {name.trim() ? (
                    <div className={`autocomplete-option availability-row ${canRegisterCategory ? "ok" : "danger"}`}>
                      <span>{name}</span>
                      <span className={`availability-badge ${canRegisterCategory ? "ok" : "danger"}`}>
                        — {canRegisterCategory ? "REGISTRABLE" : "REGISTRADO"} {canRegisterCategory ? <Check size={14} /> : <X size={14} />}
                      </span>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {duplicateCategory ? <p className="field-hint danger">Esta categoría ya está registrada.</p> : null}
            </div>
            <div className="field full">
              <label>Descripcion</label>
              <textarea
                name="description"
                onChange={(event) => setDescription(uppercaseValue(event.target.value))}
                placeholder="Uso, tipo de productos o notas internas"
                value={description}
              />
            </div>
          </div>
          <label className="check-option">
            <input defaultChecked name="is_active" type="checkbox" />
            <span>Activa</span>
          </label>
          {state.status !== "idle" ? <p className={`form-status ${state.status}`}>{state.message}</p> : null}
          <div className="form-actions">
            <button className="ghost-button" onClick={onCancel} type="button">
              Cancelar
            </button>
            <CategorySubmitButton disabled={Boolean(duplicateCategory) || !normalizedCategoryName} />
          </div>
        </form>
      </section>
    </div>
  );
}

function CategorySubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className="primary-button" disabled={disabled || pending} type="submit">
      {pending ? "Guardando..." : "Guardar categoria"}
    </button>
  );
}

function ProductSubmitButton({ disabled, isEditing }: { disabled: boolean; isEditing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className="primary-button" disabled={disabled || pending} type="submit">
      {pending ? "Guardando..." : isEditing ? "Actualizar producto" : "Guardar producto"}
    </button>
  );
}

export function ProductDeleteButton({ id, name }: { id: string; name: string }) {
  const [state, formAction] = useActionState(deleteInventoryItem, initialFormActionState);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
    }
  }, [router, state.status]);

  return (
    <form action={formAction} className="inline-form product-delete-form">
      <input name="id" type="hidden" value={id} />
      <button
        className="icon-button danger-button"
        onClick={(event) => {
          if (!window.confirm(`Eliminar ${name}? Esta accion no se puede deshacer.`)) {
            event.preventDefault();
          }
        }}
        title="Eliminar producto"
        type="submit"
      >
        <X size={16} />
      </button>
      {state.status !== "idle" ? <span className={`row-action-message ${state.status}`}>{state.message}</span> : null}
    </form>
  );
}

export function ProductModal({
  brands,
  categories,
  products,
  editProduct,
  returnHref = "/panel/productos"
}: {
  brands: Brand[];
  categories: ProductCategory[];
  products: InventoryProduct[];
  editProduct?: InventoryProduct | null;
  returnHref?: string;
}) {
  const [isOpen, setIsOpen] = useState(Boolean(editProduct));
  const router = useRouter();

  function closeModal() {
    setIsOpen(false);
    router.replace(returnHref);
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
            <ProductForm brands={brands} categories={categories} item={editProduct} onCancel={closeModal} onSaved={closeModal} products={products} />
          </section>
        </div>
      ) : null}
    </>
  );
}
