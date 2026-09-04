export function parseColombianDecimal(value: string | null | undefined): number | null {
  const rawValue = String(value ?? "").trim();
  if (!rawValue) return null;

  const sign = rawValue.startsWith("-") ? "-" : "";
  const clean = rawValue.replace(/[^\d.,]/g, "");
  if (!clean) return null;

  const lastComma = clean.lastIndexOf(",");
  const lastDot = clean.lastIndexOf(".");
  let normalized = clean;

  if (lastComma >= 0) {
    normalized = clean.replace(/\./g, "").replace(",", ".");
  } else if (lastDot >= 0) {
    const groups = clean.split(".");
    const dotsLookLikeThousands = groups.length > 1 && groups.slice(1).every((group) => group.length === 3);
    normalized = dotsLookLikeThousands ? groups.join("") : clean;
  }

  const parsed = Number(`${sign}${normalized}`);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseColombianInteger(value: string | null | undefined): number | null {
  const parsed = parseColombianDecimal(value);
  return parsed === null ? null : Math.round(parsed);
}

export function formatColombianDecimal(value: number, maximumFractionDigits = 3) {
  return new Intl.NumberFormat("es-CO", {
    maximumFractionDigits,
    minimumFractionDigits: 0
  }).format(value);
}

export function normalizeColombianDecimalInput(value: string, maximumFractionDigits = 3) {
  const parsed = parseColombianDecimal(value);
  return parsed === null ? "" : formatColombianDecimal(parsed, maximumFractionDigits);
}
