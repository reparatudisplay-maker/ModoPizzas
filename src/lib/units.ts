import { formatColombianNumber } from "@/lib/format";

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
  const formatQuantity = (quantity: number) => formatColombianNumber(quantity, baseUnit === "unit" ? 0 : 2);

  if (baseUnit === "g") {
    if (Math.abs(baseValue) < 1000) return `${formatQuantity(baseValue)} G`;
    return `${formatQuantity(baseValue / 1000)} KG`;
  }

  if (baseUnit === "ml") {
    if (Math.abs(baseValue) < 1000) return `${formatQuantity(baseValue)} ML`;
    return `${formatQuantity(baseValue / 1000)} L`;
  }

  return `${formatQuantity(baseValue)} ${unitLabel("unit")}`;
}

export function formatStockQuantityInUnit(value: number, unit: StockUnit) {
  return `${formatColombianNumber(value, canonicalStockUnit(unit) === "unit" ? 0 : 2)} ${unitLabel(unit)}`;
}

export function formatPresentationQuantity(value: number, unit: StockUnit) {
  const preferred = toPreferredDisplayQuantity(value, unit);
  const quantity = new Intl.NumberFormat("es-CO", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0
  }).format(Number.isFinite(preferred.value) ? preferred.value : 0);
  return `${quantity} ${unitLabel(preferred.unit)}`;
}

export function toPreferredDisplayQuantity(value: number, unit: StockUnit): { value: number; unit: StockUnit } {
  const baseUnit = canonicalStockUnit(unit);
  const baseValue = unit === "kg" || unit === "l" ? value * 1000 : value;

  if (baseUnit === "g" && Math.abs(baseValue) >= 1000) return { value: baseValue / 1000, unit: "kg" };
  if (baseUnit === "ml" && Math.abs(baseValue) >= 1000) return { value: baseValue / 1000, unit: "l" };
  return { value: baseValue, unit: baseUnit };
}
