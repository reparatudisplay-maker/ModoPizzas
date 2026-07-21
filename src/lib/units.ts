export type StockUnit = "g" | "kg" | "ml" | "l" | "unit";

export function unitLabel(unit: StockUnit) {
  if (unit === "g") return "G";
  if (unit === "kg") return "KG";
  if (unit === "ml") return "ML";
  if (unit === "l") return "L";
  return "UND";
}

export function canonicalStockUnit(unit: StockUnit): StockUnit {
  if (unit === "kg" || unit === "g") return "g";
  if (unit === "l" || unit === "ml") return "ml";
  return "unit";
}

export function convertStockQuantity(quantity: number, fromUnit: StockUnit, toUnit: StockUnit) {
  if (fromUnit === toUnit) return quantity;
  if (fromUnit === "kg" && toUnit === "g") return quantity * 1000;
  if (fromUnit === "g" && toUnit === "kg") return quantity / 1000;
  if (fromUnit === "l" && toUnit === "ml") return quantity * 1000;
  if (fromUnit === "ml" && toUnit === "l") return quantity / 1000;
  throw new Error("Unidad incompatible.");
}

export function formatStockQuantity(value: number, unit: StockUnit) {
  const baseUnit = canonicalStockUnit(unit);
  const baseValue = unit === "kg" || unit === "l" ? value * 1000 : value;
  const formatter = new Intl.NumberFormat("es-CO", {
    maximumFractionDigits: 2
  });

  if (baseUnit === "g") {
    if (Math.abs(baseValue) < 1000) return `${formatter.format(Math.round(baseValue))} G`;
    return `${formatter.format(baseValue / 1000)} KG`;
  }

  if (baseUnit === "ml") {
    if (Math.abs(baseValue) < 1000) return `${formatter.format(Math.round(baseValue))} ML`;
    return `${formatter.format(baseValue / 1000)} L`;
  }

  return `${formatter.format(Math.round(baseValue))} ${unitLabel("unit")}`;
}

export function toPreferredDisplayQuantity(value: number, unit: StockUnit): { value: number; unit: StockUnit } {
  const baseUnit = canonicalStockUnit(unit);
  const baseValue = unit === "kg" || unit === "l" ? value * 1000 : value;

  if (baseUnit === "g" && Math.abs(baseValue) >= 1000) return { value: baseValue / 1000, unit: "kg" };
  if (baseUnit === "ml" && Math.abs(baseValue) >= 1000) return { value: baseValue / 1000, unit: "l" };
  return { value: baseValue, unit: baseUnit };
}
