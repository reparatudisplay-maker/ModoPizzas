import { formatColombianNumber } from "@/lib/format";

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

/**
 * In Colombian inputs, `17,360` can mean either 17.36 or 17,360. We never
 * infer the latter: purchases must be confirmed when this ambiguous form is
 * deliberately used as a decimal value.
 */
export function isAmbiguousColombianThousandsInput(value: string | null | undefined): boolean {
  const rawValue = String(value ?? "").trim();
  return /^\d{1,3}(?:,\d{3})+$/.test(rawValue);
}

export function parseColombianInteger(value: string | null | undefined): number | null {
  const parsed = parseColombianDecimal(value);
  return parsed === null ? null : Math.round(parsed);
}

export function formatColombianDecimal(value: number, maximumFractionDigits = 3) {
  return formatColombianNumber(value, maximumFractionDigits, 0);
}

export function normalizeColombianDecimalInput(value: string, maximumFractionDigits = 3) {
  const parsed = parseColombianDecimal(value);
  return parsed === null ? "" : formatColombianDecimal(parsed, maximumFractionDigits);
}
