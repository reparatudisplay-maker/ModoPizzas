export function formatCop(value: number, options: { decimals?: boolean } = {}) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: options.decimals ? 2 : 0,
    minimumFractionDigits: options.decimals ? 2 : 0
  }).format(value);
}

export function formatNumber(value: number, decimals = 0) {
  return new Intl.NumberFormat("es-CO", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals
  }).format(value);
}
