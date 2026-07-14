"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { registerPurchase, type FormActionState } from "@/app/admin/actions";

type InventoryItem = {
  id: string;
  name: string;
  unit: "g" | "kg" | "ml" | "l" | "unit";
  item_kind?: "ingredient" | "sale_product" | "supply";
  presentation_quantity: number | null;
  presentation_unit: "g" | "kg" | "ml" | "l" | "unit" | null;
  is_active: boolean;
};

type LookupOption = {
  id: string;
  name: string;
  is_active: boolean;
};

type UnitOption = {
  value: InventoryItem["unit"];
  label: string;
};

type PurchaseKind = "ingredient" | "sale_product" | "supply";

const presentationUnitOptions: UnitOption[] = [
  { value: "ml", label: "Mililitros" },
  { value: "l", label: "Litros" },
  { value: "g", label: "Gramos" },
  { value: "kg", label: "Kilogramos" },
  { value: "unit", label: "Unidad" }
];

const initialFormActionState: FormActionState = {
  status: "idle",
  message: ""
};

export type EditablePurchase = {
  id: string;
  inventory_item_id: string;
  supplier_id: string | null;
  brand_id: string | null;
  purchased_quantity: number;
  presentation_quantity: number | null;
  presentation_unit: InventoryItem["unit"] | null;
  total_cop: number;
  notes: string | null;
  purchase_date: string;
  expiration_date?: string | null;
};

function normalizeStockUnit(value: string): InventoryItem["unit"] {
  return value === "g" || value === "kg" || value === "ml" || value === "l" || value === "unit" ? value : "unit";
}

function compatibleUnits(unit: InventoryItem["unit"]): UnitOption[] {
  if (unit === "g" || unit === "kg") {
    return [
      { value: "g", label: "Gramos" },
      { value: "kg", label: "Kilogramos" }
    ];
  }
  if (unit === "ml" || unit === "l") {
    return [
      { value: "ml", label: "Mililitros" },
      { value: "l", label: "Litros" }
    ];
  }
  return [{ value: "unit", label: "Unidad" }];
}

function formatInteger(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function formatQuantity(value: string) {
  const clean = value.replace(/[^\d.,]/g, "").replace(/\./g, ",");
  const [integer = "", ...decimals] = clean.split(",");
  const decimal = decimals.join("").slice(0, 3);
  const formattedInteger = formatInteger(integer);
  return decimal ? `${formattedInteger},${decimal}` : formattedInteger;
}

function uppercaseValue(value: string) {
  return value.toUpperCase();
}

function normalizeReferenceSku(value: string) {
  return value
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, "");
}

function referenceSkuSuggestion(itemName: string, quantity: string, unit: string) {
  const prefix = normalizeReferenceSku(itemName).padEnd(3, "X").slice(0, 3);
  const normalizedQuantity = quantity.replace(/\./g, "").replace(",", "").replace(/\D/g, "");
  const unitCode = unit === "unit" ? "UND" : unit.toUpperCase();
  return normalizedQuantity ? `${prefix}${normalizedQuantity}${unitCode}` : "";
}

function todayDateValue() {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function AutocompleteOrSelect({
  label,
  name,
  emptyLabel,
  options,
  initialId
}: {
  label: string;
  name: string;
  emptyLabel: string;
  options: LookupOption[];
  initialId?: string | null;
}) {
  const initialOption = options.find((option) => option.id === initialId);
  const [selectedId, setSelectedId] = useState(initialOption?.id ?? "");
  const [query, setQuery] = useState(initialOption?.name ?? "");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return options.slice(0, 20);
    return options.filter((option) => option.name.toLowerCase().includes(normalizedQuery)).slice(0, 20);
  }, [options, query]);
  const selectOption = (option: LookupOption | null) => {
    setQuery(option?.name ?? "");
    setSelectedId(option?.id ?? "");
    setIsOpen(false);
    setActiveIndex(0);
  };

  if (options.length <= 10) {
    return (
      <div className="field">
        <label>{label}</label>
        <select defaultValue={initialId ?? ""} name={name}>
          <option value="">{emptyLabel}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className="field autocomplete-field">
      <label>{label}</label>
      <input
        autoComplete="off"
        name={`${name}_label`}
        onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
        onChange={(event) => {
          setQuery(uppercaseValue(event.target.value));
          setSelectedId("");
          setIsOpen(true);
          setActiveIndex(0);
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={(event) => {
          if (!isOpen && (event.key === "ArrowDown" || event.key === "Enter")) {
            setIsOpen(true);
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((current) => Math.min(current + 1, filteredOptions.length - 1));
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((current) => Math.max(current - 1, 0));
          }
          if (event.key === "Enter" && filteredOptions[activeIndex]) {
            event.preventDefault();
            selectOption(filteredOptions[activeIndex]);
          }
          if (event.key === "Escape") {
            setIsOpen(false);
          }
        }}
        placeholder={emptyLabel}
        value={query}
      />
      <input name={name} type="hidden" value={selectedId} />
      {isOpen ? (
        <div className="autocomplete-menu">
          <button
            className="autocomplete-option"
            onMouseDown={(event) => {
              event.preventDefault();
              selectOption(null);
            }}
            type="button"
          >
            {emptyLabel}
          </button>
          {filteredOptions.map((option, index) => (
            <button
              className={`autocomplete-option${index === activeIndex ? " active" : ""}`}
              key={option.id}
              onMouseDown={(event) => {
                event.preventDefault();
                selectOption(option);
              }}
              type="button"
            >
              {option.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function PurchaseForm({
  items,
  suppliers,
  brands,
  editPurchase,
  onSaved
}: {
  items: InventoryItem[];
  suppliers: LookupOption[];
  brands: LookupOption[];
  editPurchase?: EditablePurchase | null;
  onSaved?: () => void;
}) {
  const [state, formAction] = useActionState(registerPurchase, initialFormActionState);
  const [quantity, setQuantity] = useState(editPurchase ? formatQuantity(String(editPurchase.purchased_quantity).replace(".", ",")) : "");
  const [totalPaid, setTotalPaid] = useState(editPurchase ? formatInteger(String(editPurchase.total_cop)) : "");
  const [notes, setNotes] = useState(editPurchase?.notes ?? "");
  const editItem = items.find((item) => item.id === editPurchase?.inventory_item_id);
  const [purchaseKind, setPurchaseKind] = useState<PurchaseKind>(editItem?.item_kind ?? "ingredient");
  const visibleItems = items.filter((item) => (item.item_kind ?? "ingredient") === purchaseKind);
  const selectableItems = visibleItems;
  const firstItem = selectableItems[0];
  const [selectedItemId, setSelectedItemId] = useState(editPurchase?.inventory_item_id ?? firstItem?.id ?? "");
  const selectedItem = selectableItems.find((item) => item.id === selectedItemId) ?? firstItem;
  const [presentationQuantity, setPresentationQuantity] = useState(
    editPurchase?.presentation_quantity
      ? formatQuantity(String(editPurchase.presentation_quantity).replace(".", ","))
      : selectedItem?.presentation_quantity
        ? formatQuantity(String(selectedItem.presentation_quantity).replace(".", ","))
        : ""
  );
  const unitOptions = purchaseKind === "ingredient" ? compatibleUnits(selectedItem?.unit ?? "unit") : presentationUnitOptions;
  const [presentationUnit, setPresentationUnit] = useState<InventoryItem["unit"]>(
    editPurchase?.presentation_unit ?? selectedItem?.presentation_unit ?? compatibleUnits(selectedItem?.unit ?? "unit")[0]?.value ?? "unit"
  );
  const [referenceSku, setReferenceSku] = useState("");
  const [referenceSkuEdited, setReferenceSkuEdited] = useState(false);

  const referenceSkuPlaceholder =
    purchaseKind === "ingredient" ? "" : referenceSkuSuggestion(selectedItem?.name ?? "", presentationQuantity, presentationUnit);

  function resetSection(nextKind: PurchaseKind) {
    setPurchaseKind(nextKind);
    const nextItem = items.find((item) => (item.item_kind ?? "ingredient") === nextKind);
    setSelectedItemId(nextItem?.id ?? "");
    setQuantity("");
    setPresentationQuantity("");
    setPresentationUnit(nextKind === "ingredient" ? compatibleUnits(nextItem?.unit ?? "unit")[0]?.value ?? "unit" : "ml");
    setReferenceSku("");
    setReferenceSkuEdited(false);
  }

  useEffect(() => {
    if (state.status !== "success") return;
    const timeout = window.setTimeout(() => {
      onSaved?.();
    }, 1400);
    return () => window.clearTimeout(timeout);
  }, [onSaved, state.status]);

  return (
    <form action={formAction} className="compact-card">
      <div>
        <h3>{editPurchase ? "Editar compra" : "Registrar compra"}</h3>
        <span className="badge">Stock</span>
      </div>
      {editPurchase ? <input name="purchase_id" type="hidden" value={editPurchase.id} /> : null}
      <input name="purchase_kind" type="hidden" value={purchaseKind} />
      <div className="segmented-control" aria-label="Tipo de compra">
        <button
          aria-pressed={purchaseKind === "ingredient"}
          className={purchaseKind === "ingredient" ? "active" : ""}
          onClick={() => resetSection("ingredient")}
          type="button"
        >
          Ingredientes
        </button>
        <button
          aria-pressed={purchaseKind === "sale_product"}
          className={purchaseKind === "sale_product" ? "active" : ""}
          onClick={() => resetSection("sale_product")}
          type="button"
        >
          Productos para venta
        </button>
        <button
          aria-pressed={purchaseKind === "supply"}
          className={purchaseKind === "supply" ? "active" : ""}
          onClick={() => resetSection("supply")}
          type="button"
        >
          Insumos
        </button>
      </div>
      <div className="form-grid">
        <div className="field">
          <label>{purchaseKind === "ingredient" ? "Ingrediente" : purchaseKind === "sale_product" ? "Producto maestro" : "Insumo maestro"}</label>
          <select
            name="inventory_item_id"
            onChange={(event) => {
              const nextItem = selectableItems.find((item) => item.id === event.target.value);
              setSelectedItemId(event.target.value);
              setPresentationUnit(
                purchaseKind === "ingredient" ? compatibleUnits(nextItem?.unit ?? "unit")[0]?.value ?? "unit" : nextItem?.presentation_unit ?? "ml"
              );
              if (!referenceSkuEdited) setReferenceSku("");
            }}
            required
            value={selectedItemId}
          >
            {selectableItems.length === 0 ? <option value="">No hay productos de este tipo</option> : null}
            {selectableItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>{purchaseKind === "sale_product" ? "Cantidad de unidades" : "Cantidad"}</label>
          <input name="purchase_unit" type="hidden" value={purchaseKind === "ingredient" ? presentationUnit : "unit"} />
          <input
            inputMode="decimal"
            name="quantity"
            onBlur={() => setQuantity((current) => formatQuantity(current))}
            onChange={(event) => setQuantity(event.target.value.replace(/[^\d.,]/g, ""))}
            placeholder="0"
            required
            type="text"
            value={quantity}
          />
        </div>
        {purchaseKind === "ingredient" ? (
          <div className="field">
            <label>Unidad</label>
            <select name="presentation_unit" onChange={(event) => setPresentationUnit(normalizeStockUnit(event.target.value))} value={presentationUnit}>
              {unitOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="field">
          <label>Presentacion</label>
          <div className="split-input">
            <input
              inputMode="decimal"
              name="presentation_quantity"
              onBlur={() => setPresentationQuantity((current) => formatQuantity(current))}
              onChange={(event) => {
                const nextValue = event.target.value.replace(/[^\d.,]/g, "");
                setPresentationQuantity(nextValue);
                if (!referenceSkuEdited) setReferenceSku(referenceSkuSuggestion(selectedItem?.name ?? "", nextValue, presentationUnit));
              }}
              placeholder="Ej. 1,5"
              required
              type="text"
              value={presentationQuantity}
            />
            <select
              name="presentation_unit"
              onChange={(event) => {
                const nextUnit = normalizeStockUnit(event.target.value);
                setPresentationUnit(nextUnit);
                if (!referenceSkuEdited) setReferenceSku(referenceSkuSuggestion(selectedItem?.name ?? "", presentationQuantity, nextUnit));
              }}
              value={presentationUnit}
            >
              {unitOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        )}
        {purchaseKind !== "ingredient" ? (
          <div className="field">
            <label>SKU referencia</label>
            <input
              name="reference_sku"
              onChange={(event) => {
                setReferenceSkuEdited(true);
                setReferenceSku(normalizeReferenceSku(event.target.value));
              }}
              placeholder={referenceSkuPlaceholder || "SKU sugerido"}
              value={referenceSku}
            />
          </div>
        ) : null}
        <div className="field">
          <label>Total pagado COP</label>
          <input
            inputMode="numeric"
            name="total_paid_cop"
            onChange={(event) => setTotalPaid(formatInteger(event.target.value))}
            placeholder="$ 0"
            required
            type="text"
            value={totalPaid}
          />
        </div>
        <div className="field">
          <label>Fecha compra</label>
          <input defaultValue={editPurchase?.purchase_date ?? todayDateValue()} name="purchase_date" required type="date" />
        </div>
        <div className="field">
          <label>Fecha vencimiento</label>
          <input defaultValue={editPurchase?.expiration_date ?? ""} name="expiration_date" type="date" />
        </div>
        <div className="field full">
          <label>Notas</label>
          <input name="notes" onChange={(event) => setNotes(uppercaseValue(event.target.value))} placeholder="Factura, observaciones, lote" value={notes} />
        </div>
        <AutocompleteOrSelect emptyLabel="Sin marca" initialId={editPurchase?.brand_id} label="Marca" name="brand_id" options={brands} />
        <AutocompleteOrSelect emptyLabel="Sin proveedor" initialId={editPurchase?.supplier_id} label="Proveedor" name="supplier_id" options={suppliers} />
      </div>
      {state.status !== "idle" ? <p className={`form-status ${state.status}`}>{state.message}</p> : null}
      <div className="form-actions">
        {editPurchase ? (
          <Link className="ghost-button" href="/panel/compras">
            Cancelar
          </Link>
        ) : null}
        <PurchaseSubmitButton disabled={selectableItems.length === 0} isEditing={Boolean(editPurchase)} />
      </div>
    </form>
  );
}

function PurchaseSubmitButton({ disabled, isEditing }: { disabled: boolean; isEditing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className="primary-button" disabled={disabled || pending} type="submit">
      {pending ? "Guardando..." : isEditing ? "Actualizar compra" : "Registrar compra"}
    </button>
  );
}

export function PurchaseModal({
  items,
  suppliers,
  brands,
  editPurchase
}: {
  items: InventoryItem[];
  suppliers: LookupOption[];
  brands: LookupOption[];
  editPurchase?: EditablePurchase | null;
}) {
  const [isOpen, setIsOpen] = useState(Boolean(editPurchase));
  const router = useRouter();

  function handleSaved() {
    setIsOpen(false);
    router.replace("/panel/compras");
    router.refresh();
  }

  return (
    <>
      <button className="primary-button add-purchase-button" onClick={() => setIsOpen(true)} type="button">
        <Plus size={18} /> Agregar compra
      </button>
      {isOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section aria-label={editPurchase ? "Editar compra" : "Agregar compra"} aria-modal="true" className="modal-panel purchase-modal" role="dialog">
            <header className="modal-header">
              <div>
                <strong>{editPurchase ? "Editar compra" : "Agregar compra"}</strong>
                <span>Registra la compra y su linea de inventario.</span>
              </div>
              <button className="icon-button" onClick={() => setIsOpen(false)} title="Cerrar" type="button">
                <X size={18} />
              </button>
            </header>
            <PurchaseForm brands={brands} editPurchase={editPurchase} items={items} onSaved={handleSaved} suppliers={suppliers} />
          </section>
        </div>
      ) : null}
    </>
  );
}
