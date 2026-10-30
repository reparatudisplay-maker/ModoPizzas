export function formatColombianNumber(value: number, decimals = 2, minimumFractionDigits = decimals) {
  return new Intl.NumberFormat("es-CO", {
    maximumFractionDigits: decimals,
    minimumFractionDigits
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatCop(value: number, options: { decimals?: boolean } = {}) {
  const decimals = options.decimals === false ? 0 : 2;
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatNumber(value: number, decimals = 2) {
  return formatColombianNumber(value, decimals);
}
