"use client";

export type ThermalPrinterSettings = {
  ip_address: string;
  port: number;
  model: string;
  paper_width_mm: number;
  printable_width_mm: number;
  preferred_print_method: "auto" | "browser" | "ipad_shortcut";
};

export function isIpadOS() {
  if (typeof navigator === "undefined") return false;
  return /iPad/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function shouldUseIpadShortcut(settings: ThermalPrinterSettings) {
  return settings.preferred_print_method === "ipad_shortcut"
    || (settings.preferred_print_method === "auto" && isIpadOS());
}

function toPrinterAscii(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ñ/gi, (character) => character === "Ñ" ? "N" : "n")
    .replace(/[^\x20-\x7E\n]/g, "");
}

function wrapThermalLine(line: string, width = 32) {
  const words = line.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const rows: string[] = [];
  let row = "";
  for (const word of words) {
    const candidate = row ? `${row} ${word}` : word;
    if (row && candidate.length > width) {
      rows.push(row);
      row = word;
    } else {
      row = candidate;
    }
  }
  if (row) rows.push(row);
  return rows;
}

export function createIpadThermalPayload(documents: HTMLElement[]) {
  const body = documents
    .flatMap((document) => toPrinterAscii(document.innerText).split(/\r?\n/).flatMap((line) => wrapThermalLine(line)))
    .join("\n");
  const raw = `\u001b@\u001ba\u0000${body}\n\n\n`;
  return window.btoa(raw);
}

export function createIpadShortcutUrl(shortcutInput: string) {
  const query = new URLSearchParams({
    name: "Imprimir Modo Pizzas",
    input: "text",
    text: shortcutInput
  });
  return `shortcuts://run-shortcut?${query.toString()}`;
}

export function runIpadShortcut(shortcutInput: string) {
  window.location.assign(createIpadShortcutUrl(shortcutInput));
}
