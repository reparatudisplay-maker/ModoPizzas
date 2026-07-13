"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { registerPurchase } from "@/app/admin/actions";

type InventoryItem = {
  id: string;
  name: string;
  unit: "g" | "kg" | "ml" | "l" | "unit";
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
};

function unitLabel(unit: string) {
  if (unit === "unit") return "unidad";
  return unit;
}

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
          setQuery(event.target.value);
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
  editPurchase
}: {
  items: InventoryItem[];
  suppliers: LookupOption[];
  brands: LookupOption[];
  editPurchase?: EditablePurchase | null;
}) {
  const [quantity, setQuantity] = useState(editPurchase ? formatQuantity(String(editPurchase.purchased_quantity).replace(".", ",")) : "");
  const [totalPaid, setTotalPaid] = useState(editPurchase ? formatInteger(String(editPurchase.total_cop)) : "");
  const firstItem = items[0];
  const [selectedItemId, setSelectedItemId] = useState(editPurchase?.inventory_item_id ?? firstItem?.id ?? "");
  const selectedItem = items.find((item) => item.id === selectedItemId) ?? firstItem;
  const [presentationQuantity, setPresentationQuantity] = useState(
    editPurchase?.presentation_quantity
      ? formatQuantity(String(editPurchase.presentation_quantity).replace(".", ","))
      : selectedItem?.presentation_quantity
        ? formatQuantity(String(selectedItem.presentation_quantity).replace(".", ","))
        : ""
  );
  const unitOptions = compatibleUnits(selectedItem?.unit ?? "unit");
  const [presentationUnit, setPresentationUnit] = useState<InventoryItem["unit"]>(
    editPurchase?.presentation_unit ?? selectedItem?.presentation_unit ?? unitOptions[0]?.value ?? "unit"
  );

  return (
    <form action={registerPurchase} className="compact-card">
      <div>
        <h3>{editPurchase ? "Editar compra" : "Registrar compra"}</h3>
        <span className="badge">Stock</span>
      </div>
      {editPurchase ? <input name="purchase_id" type="hidden" value={editPurchase.id} /> : null}
      <div className="form-grid">
        <div className="field">
          <label>Insumo</label>
          <select
            name="inventory_item_id"
            onChange={(event) => {
              const nextItem = items.find((item) => item.id === event.target.value);
              setSelectedItemId(event.target.value);
              setPresentationQuantity(nextItem?.presentation_quantity ? formatQuantity(String(nextItem.presentation_quantity).replace(".", ",")) : "");
              setPresentationUnit(nextItem?.presentation_unit ?? compatibleUnits(nextItem?.unit ?? "unit")[0]?.value ?? "unit");
            }}
            required
            value={selectedItemId}
          >
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({unitLabel(item.unit)})
              </option>
            ))}
          </select>
        </div>
        <AutocompleteOrSelect emptyLabel="Sin proveedor" initialId={editPurchase?.supplier_id} label="Proveedor" name="supplier_id" options={suppliers} />
        <AutocompleteOrSelect emptyLabel="Sin marca" initialId={editPurchase?.brand_id} label="Marca" name="brand_id" options={brands} />
        <div className="field">
          <label>Cantidad</label>
          <input name="purchase_unit" type="hidden" value="unit" />
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
        <div className="field">
          <label>Presentacion</label>
          <div className="split-input">
            <input
              inputMode="decimal"
              name="presentation_quantity"
              onBlur={() => setPresentationQuantity((current) => formatQuantity(current))}
              onChange={(event) => setPresentationQuantity(event.target.value.replace(/[^\d.,]/g, ""))}
              placeholder="Ej. 1,5"
              type="text"
              value={presentationQuantity}
            />
            <select name="presentation_unit" onChange={(event) => setPresentationUnit(normalizeStockUnit(event.target.value))} value={presentationUnit}>
              {unitOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
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
          <label>Fecha</label>
          <input defaultValue={editPurchase?.purchase_date ?? todayDateValue()} name="purchase_date" required type="date" />
        </div>
        <div className="field full">
          <label>Notas</label>
          <input defaultValue={editPurchase?.notes ?? ""} name="notes" placeholder="Factura, observaciones, lote" />
        </div>
      </div>
      <div className="form-actions">
        {editPurchase ? (
          <Link className="ghost-button" href="/panel/compras">
            Cancelar
          </Link>
        ) : null}
        <button className="primary-button" disabled={items.length === 0} type="submit">
          {editPurchase ? "Actualizar compra" : "Registrar compra"}
        </button>
      </div>
    </form>
  );
}
