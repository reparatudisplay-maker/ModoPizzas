"use client";

const PAGE_WIDTH_PT = 58 / 25.4 * 72;
const CONTENT_WIDTH_PT = 48 / 25.4 * 72;
const HORIZONTAL_MARGIN_PT = 0;
const VERTICAL_MARGIN_PT = 1;
const CP1252: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x2c6: 0x88, 0x2030: 0x89, 0x160: 0x8a,
  0x2039: 0x8b, 0x152: 0x8c, 0x17d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x2dc: 0x98, 0x2122: 0x99, 0x161: 0x9a, 0x203a: 0x9b, 0x153: 0x9c,
  0x17e: 0x9e, 0x178: 0x9f
};

type PdfLine = {
  align?: "center" | "left";
  bold?: boolean;
  size: number;
  text: string;
};

function toPdfBytes(value: string) {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) bytes[index] = value.charCodeAt(index) & 0xff;
  return bytes;
}

function escapePdfText(value: string) {
  let escaped = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 63;
    const byte = code <= 0xff ? code : (CP1252[code] ?? 63);
    const printable = String.fromCharCode(byte);
    escaped += printable === "\\" || printable === "(" || printable === ")" ? `\\${printable}` : printable;
  }
  return escaped;
}

function estimateTextWidth(value: string, size: number, bold: boolean) {
  return value.length * size * (bold ? 0.56 : 0.52);
}

function wrapLine(value: string, size: number, bold: boolean) {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && estimateTextWidth(candidate, size, bold) > CONTENT_WIDTH_PT) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function getPdfLines(source: HTMLElement) {
  const rawLines = source.innerText.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  return rawLines.flatMap((text, index): PdfLine[] => {
    const isTitle = index < 2;
    const isTotal = /^TOTAL(?:\s|$)/.test(text);
    const isSection = /^[A-ZÁÉÍÓÚÑ0-9 ×/·.,+$-]{3,}$/.test(text) && text.length < 42;
    const bold = isTitle || isTotal || isSection;
    const size = isTitle ? (index === 0 ? 11 : 12) : isTotal ? 11 : isSection ? 8.5 : 8;
    return wrapLine(text, size, bold).map((line) => ({ align: "left", bold, size, text: line }));
  });
}

function createThermalPdf(lines: PdfLine[]) {
  const laidOut = lines.map((line) => ({ ...line, leading: line.size + 3 }));
  const pageHeight = Math.max(70, VERTICAL_MARGIN_PT * 2 + laidOut.reduce((total, line) => total + line.leading, 0));
  let y = pageHeight - VERTICAL_MARGIN_PT;
  const commands = ["0 g"];

  for (const line of laidOut) {
    y -= line.leading;
    const width = estimateTextWidth(line.text, line.size, Boolean(line.bold));
    const x = line.align === "center" ? Math.max(HORIZONTAL_MARGIN_PT, (PAGE_WIDTH_PT - width) / 2) : HORIZONTAL_MARGIN_PT;
    commands.push(`BT /F${line.bold ? "2" : "1"} ${line.size.toFixed(2)} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${escapePdfText(line.text)}) Tj ET`);
  }

  const stream = commands.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH_PT.toFixed(2)} ${pageHeight.toFixed(2)}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"
  ];

  let pdf = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Blob([toPdfBytes(pdf)], { type: "application/pdf" });
}

export function downloadThermalPdf(source: HTMLElement, filename: string) {
  const lines = getPdfLines(source);
  if (lines.length === 0) return false;
  const url = URL.createObjectURL(createThermalPdf(lines));
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return true;
}