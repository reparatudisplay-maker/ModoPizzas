"use client";

export function PrintButton() {
  return (
    <button className="primary-button" onClick={() => window.print()} type="button">
      Imprimir
    </button>
  );
}
