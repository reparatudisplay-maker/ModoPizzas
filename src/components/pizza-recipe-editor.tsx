"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { savePizzaRecipeAndPrice } from "@/app/admin/actions";
import { formatCop, formatNumber } from "@/lib/format";

type StockUnit = "g" | "kg" | "ml" | "l" | "unit";

type PizzaSize = {
  id: string;
  name: string;
};

type PizzaFlavor = {
  id: string;
  name: string;
};

type InventoryItem = {
  id: string;
  name: string;
  unit: StockUnit;
  current_quantity: number;
  average_cost_cop: number;
};

type RecipeRow = {
  id: string;
  inventory_item_id: string;
  quantity: number;
  unit: StockUnit;
};

type EditableRow = {
  inventory_item_id: string;
  quantity: string;
  unit: StockUnit;
};

const stockUnits: StockUnit[] = ["g", "kg", "ml", "l", "unit"];

function unitLabel(unit: StockUnit) {
  if (unit === "unit") return "unidad";
  return unit;
}

function compatibleUnits(unit: StockUnit) {
  if (unit === "g" || unit === "kg") return ["g", "kg"] as StockUnit[];
  if (unit === "ml" || unit === "l") return ["ml", "l"] as StockUnit[];
  return ["unit"] as StockUnit[];
}

function convertQuantity(quantity: number, fromUnit: StockUnit, toUnit: StockUnit) {
  if (fromUnit === toUnit) return quantity;
  if (fromUnit === "g" && toUnit === "kg") return quantity / 1000;
  if (fromUnit === "kg" && toUnit === "g") return quantity * 1000;
  if (fromUnit === "ml" && toUnit === "l") return quantity / 1000;
  if (fromUnit === "l" && toUnit === "ml") return quantity * 1000;
  return null;
}

function parseDecimal(value: string) {
  const parsed = Number(value.replace(/\./g, "").replace(/,/g, "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatInteger(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function createBlankRow(): EditableRow {
  return { inventory_item_id: "", quantity: "", unit: "g" };
}

function initialRows(recipes: RecipeRow[]) {
  if (recipes.length > 0) {
    return recipes.map((recipe) => ({
      inventory_item_id: recipe.inventory_item_id,
      quantity: String(recipe.quantity).replace(".", ","),
      unit: recipe.unit
    }));
  }

  return Array.from({ length: 4 }, createBlankRow);
}

export function PizzaRecipeEditor({
  flavors,
  sizes,
  items,
  selectedFlavorId,
  selectedSizeId,
  recipes,
  price,
  wastePercent
}: {
  flavors: PizzaFlavor[];
  sizes: PizzaSize[];
  items: InventoryItem[];
  selectedFlavorId: string;
  selectedSizeId: string;
  recipes: RecipeRow[];
  price: number;
  wastePercent: number;
}) {
  const router = useRouter();
  const [flavorId, setFlavorId] = useState(selectedFlavorId);
  const [sizeId, setSizeId] = useState(selectedSizeId);
  const [rows, setRows] = useState<EditableRow[]>(() => initialRows(recipes));
  const [salePrice, setSalePrice] = useState(String(price));
  const [wasteValue, setWasteValue] = useState(String(wastePercent).replace(".", ","));
  const selectedFlavor = flavors.find((flavor) => flavor.id === flavorId);
  const selectedSize = sizes.find((size) => size.id === sizeId);

  function loadRecipe(nextFlavorId: string, nextSizeId: string) {
    router.push(`/panel/pizzas?section=recetas&flavor=${nextFlavorId}&size=${nextSizeId}`);
  }

  function updateRow(index: number, patch: Partial<EditableRow>) {
    setRows((current) =>
      current.map((row, rowIndex) => {
        if (rowIndex !== index) return row;
        const nextRow = { ...row, ...patch };
        const selectedItem = items.find((item) => item.id === nextRow.inventory_item_id);
        if (selectedItem && !compatibleUnits(selectedItem.unit).includes(nextRow.unit)) {
          nextRow.unit = selectedItem.unit;
        }
        return nextRow;
      })
    );
  }

  const calculation = useMemo(() => {
    const cost = rows.reduce((sum, row) => {
      const item = items.find((candidate) => candidate.id === row.inventory_item_id);
      if (!item) return sum;
      const converted = convertQuantity(parseDecimal(row.quantity), row.unit, item.unit);
      if (converted === null) return sum;
      return sum + converted * Number(item.average_cost_cop ?? 0);
    }, 0);
    const roundedCost = Math.round(cost);
    const waste = parseDecimal(wasteValue);
    const wasteCost = Math.round(roundedCost * (1 + waste / 100));
    const priceCop = Math.round(parseDecimal(salePrice));
    const margin = priceCop - wasteCost;
    const marginPercent = priceCop > 0 ? Math.round((margin / priceCop) * 1000) / 10 : 0;
    const hasLowStock = rows.some((row) => {
      const item = items.find((candidate) => candidate.id === row.inventory_item_id);
      if (!item || row.quantity.trim().length === 0) return false;
      const converted = convertQuantity(parseDecimal(row.quantity), row.unit, item.unit);
      return converted === null || Number(item.current_quantity ?? 0) < converted;
    });

    return {
      cost: roundedCost,
      waste,
      wasteCost,
      priceCop,
      margin,
      marginPercent,
      availability: rows.some((row) => row.inventory_item_id) ? (hasLowStock ? "Stock bajo" : "Disponible") : "Sin receta"
    };
  }, [items, rows, salePrice, wasteValue]);

  return (
    <section className="admin-grid recipe-layout">
      <form action={savePizzaRecipeAndPrice} className="compact-card" id="pizza-recipe-form">
        <input name="row_count" type="hidden" value={rows.length} />
        <div>
          <h3>Receta y precio</h3>
          <span className="badge">
            {selectedFlavor?.name ?? "Sabor"} / {selectedSize?.name ?? "Tamano"}
          </span>
        </div>
        <div className="form-grid">
          <div className="field">
            <label>Sabor</label>
            <select
              name="flavor_id"
              onChange={(event) => {
                setFlavorId(event.target.value);
                loadRecipe(event.target.value, sizeId);
              }}
              required
              value={flavorId}
            >
              {flavors.map((flavor) => (
                <option key={flavor.id} value={flavor.id}>
                  {flavor.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Tamano</label>
            <select
              name="size_id"
              onChange={(event) => {
                setSizeId(event.target.value);
                loadRecipe(flavorId, event.target.value);
              }}
              required
              value={sizeId}
            >
              {sizes.map((size) => (
                <option key={size.id} value={size.id}>
                  {size.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="recipe-editor compact-recipe-editor">
          {rows.map((row, index) => {
            const selectedItem = items.find((item) => item.id === row.inventory_item_id);
            const units = selectedItem ? compatibleUnits(selectedItem.unit) : stockUnits;
            return (
              <div className="recipe-row" key={`${index}-${row.inventory_item_id || "blank"}`}>
                <select
                  name={`ingredient_${index}`}
                  onChange={(event) => updateRow(index, { inventory_item_id: event.target.value })}
                  value={row.inventory_item_id}
                >
                  <option value="">Producto</option>
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({unitLabel(item.unit)})
                    </option>
                  ))}
                </select>
                <input
                  inputMode="decimal"
                  name={`quantity_${index}`}
                  onChange={(event) => updateRow(index, { quantity: event.target.value.replace(/[^\d.,]/g, "") })}
                  placeholder="Cant."
                  value={row.quantity}
                />
                <select name={`unit_${index}`} onChange={(event) => updateRow(index, { unit: event.target.value as StockUnit })} value={row.unit}>
                  {units.map((unit) => (
                    <option key={unit} value={unit}>
                      {unitLabel(unit)}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>

        <button className="ghost-button recipe-add-button" onClick={() => setRows((current) => [...current, createBlankRow()])} type="button">
          <Plus size={16} /> Agregar ingrediente
        </button>

        <div className="field">
          <label>Precio venta COP</label>
          <input
            inputMode="numeric"
            name="price_cop"
            onChange={(event) => setSalePrice(formatInteger(event.target.value))}
            value={salePrice}
          />
        </div>

        <div className="field">
          <label>Merma (%)</label>
          <input
            inputMode="decimal"
            name="waste_percent"
            onChange={(event) => setWasteValue(event.target.value.replace(/[^\d.,]/g, ""))}
            value={wasteValue}
          />
        </div>

        <button className="primary-button" disabled={!flavorId || !sizeId} type="button">
          Calcular
        </button>
      </form>

      <article className="form-panel recipe-calculation">
        <h2>Calculo</h2>
        <div className="data-list">
          <div className="data-row static-row">
            <strong>Costo receta</strong>
            <span>{formatCop(calculation.cost)}</span>
          </div>
          <div className="data-row static-row">
            <strong>Costo con merma {formatNumber(calculation.waste, 1)}%</strong>
            <span>{formatCop(calculation.wasteCost)}</span>
          </div>
          <div className="data-row static-row">
            <strong>Precio venta</strong>
            <span>{formatCop(calculation.priceCop)}</span>
          </div>
          <div className="data-row static-row">
            <strong>Margen estimado</strong>
            <span>
              {formatCop(calculation.margin)} / {formatNumber(calculation.marginPercent, 1)}%
            </span>
          </div>
          <div className="data-row static-row">
            <strong>Inventario</strong>
            <span>{calculation.availability}</span>
          </div>
        </div>
        <button className="primary-button" disabled={!flavorId || !sizeId} form="pizza-recipe-form" type="submit">
          Guardar receta y precio
        </button>
      </article>
    </section>
  );
}
