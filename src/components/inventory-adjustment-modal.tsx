"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { SlidersHorizontal, X } from "lucide-react";
import { registerInventoryAdjustment, type FormActionState } from "@/app/admin/actions";

type StockUnit = "g" | "kg" | "ml" | "l" | "unit";

type InventoryItem = {
  id: string;
  name: string;
  unit: StockUnit;
  is_active: boolean;
};

type UnitOption = {
  value: StockUnit;
  label: string;
};

const initialFormActionState: FormActionState = {
  status: "idle",
  message: ""
};

function unitLabel(unit: StockUnit) {
  if (unit === "unit") return "Unidad";
  if (unit === "g") return "Gramos";
  if (unit === "kg") return "Kilogramos";
  if (unit === "ml") return "Mililitros";
  return "Litros";
}

function compatibleUnits(unit: StockUnit): UnitOption[] {
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

function formatQuantityInput(value: string) {
  const clean = value.replace(/[^\d.,]/g, "").replace(/\./g, ",");
  const [integer = "", ...decimals] = clean.split(",");
  const formattedInteger = integer.replace(/\D/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const decimal = decimals.join("").replace(/\D/g, "").slice(0, 3);
  return decimal ? `${formattedInteger},${decimal}` : formattedInteger;
}

export function InventoryAdjustmentModal({ items }: { items: InventoryItem[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const router = useRouter();

  function handleSaved() {
    setIsOpen(false);
    router.refresh();
  }

  return (
    <>
      <button className="primary-button add-purchase-button" onClick={() => setIsOpen(true)} type="button">
        <SlidersHorizontal size={18} /> Ajuste de inventario
      </button>
      {isOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section aria-label="Ajuste de inventario" aria-modal="true" className="modal-panel purchase-modal" role="dialog">
            <header className="modal-header">
              <div>
                <strong>Ajuste de inventario</strong>
                <span>Registra una correccion trazable sin editar el stock manualmente.</span>
              </div>
              <button className="icon-button" onClick={() => setIsOpen(false)} title="Cerrar" type="button">
                <X size={18} />
              </button>
            </header>
            <InventoryAdjustmentForm items={items} onSaved={handleSaved} />
          </section>
        </div>
      ) : null}
    </>
  );
}

function InventoryAdjustmentForm({ items, onSaved }: { items: InventoryItem[]; onSaved: () => void }) {
  const [state, formAction] = useActionState(registerInventoryAdjustment, initialFormActionState);
  const activeItems = useMemo(() => items.filter((item) => item.is_active), [items]);
  const firstItem = activeItems[0];
  const [selectedItemId, setSelectedItemId] = useState(firstItem?.id ?? "");
  const selectedItem = activeItems.find((item) => item.id === selectedItemId) ?? firstItem;
  const unitOptions = compatibleUnits(selectedItem?.unit ?? "unit");
  const [selectedUnit, setSelectedUnit] = useState<StockUnit>(unitOptions[0]?.value ?? "unit");
  const [quantity, setQuantity] = useState("");

  useEffect(() => {
    if (state.status !== "success") return;
    const timeout = window.setTimeout(() => {
      onSaved();
    }, 1400);
    return () => window.clearTimeout(timeout);
  }, [onSaved, state.status]);

  return (
    <form action={formAction} className="compact-card">
      <div className="form-grid">
        <div className="field full">
          <label>Producto</label>
          <select
            name="inventory_item_id"
            onChange={(event) => {
              const nextItem = activeItems.find((item) => item.id === event.target.value);
              setSelectedItemId(event.target.value);
              setSelectedUnit(compatibleUnits(nextItem?.unit ?? "unit")[0]?.value ?? "unit");
            }}
            required
            value={selectedItemId}
          >
            {activeItems.length === 0 ? <option value="">No hay productos activos</option> : null}
            {activeItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({unitLabel(item.unit)})
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Tipo de ajuste</label>
          <select name="adjustment_kind" required>
            <option value="adjustment_in">Aumentar stock</option>
            <option value="adjustment_out">Reducir stock</option>
          </select>
        </div>
        <div className="field">
          <label>Cantidad</label>
          <input
            inputMode="decimal"
            name="quantity"
            onBlur={() => setQuantity((current) => formatQuantityInput(current))}
            onChange={(event) => setQuantity(event.target.value.replace(/[^\d.,]/g, ""))}
            placeholder="0"
            required
            type="text"
            value={quantity}
          />
        </div>
        <div className="field">
          <label>Unidad</label>
          <select name="unit" onChange={(event) => setSelectedUnit(event.target.value as StockUnit)} required value={selectedUnit}>
            {unitOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Motivo</label>
          <input name="reason" placeholder="Ej. Conteo fisico, error de registro" required />
        </div>
        <div className="field full">
          <label>Observacion</label>
          <textarea name="observation" placeholder="Detalle opcional del ajuste" rows={3} />
        </div>
      </div>
      {state.status !== "idle" ? <p className={`form-status ${state.status}`}>{state.message}</p> : null}
      <div className="form-actions">
        <button className="ghost-button" type="button" onClick={onSaved}>
          Cancelar
        </button>
        <AdjustmentSubmitButton disabled={activeItems.length === 0} />
      </div>
    </form>
  );
}

function AdjustmentSubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className="primary-button" disabled={disabled || pending} type="submit">
      {pending ? "Guardando..." : "Guardar ajuste"}
    </button>
  );
}
