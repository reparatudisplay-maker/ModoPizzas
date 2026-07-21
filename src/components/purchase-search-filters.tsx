"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";

type LookupOption = {
  id: string;
  name: string;
};

type PurchaseSearchFiltersProps = {
  suppliers: LookupOption[];
  brands: LookupOption[];
  currentSupplier: string;
  currentBrand: string;
  currentPeriod: string;
  query: string;
  suggestions: string[];
};

function normalizeSearch(value: string) {
  return value
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function PurchaseSearchFilters({
  suppliers,
  brands,
  currentSupplier,
  currentBrand,
  currentPeriod,
  query,
  suggestions
}: PurchaseSearchFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(query);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [, startTransition] = useTransition();
  const filteredSuggestions = useMemo(() => {
    const normalized = normalizeSearch(search);
    if (!normalized) return suggestions.slice(0, 10);
    return suggestions.filter((suggestion) => normalizeSearch(suggestion).includes(normalized)).slice(0, 10);
  }, [search, suggestions]);

  function updateParams(nextValues: Record<string, string>) {
    const nextParams = new URLSearchParams(searchParams.toString());
    Object.entries(nextValues).forEach(([key, value]) => {
      if (value) {
        nextParams.set(key, value);
      } else {
        nextParams.delete(key);
      }
    });
    const queryString = nextParams.toString();
    startTransition(() => {
      router.replace(`${pathname}${queryString ? `?${queryString}` : ""}`, { scroll: false });
    });
  }

  function applySearch(value: string) {
    setSearch(value);
    setActiveIndex(0);
    updateParams({ q: value.trim() });
  }

  function pickSuggestion(value: string) {
    applySearch(value);
    setIsOpen(false);
  }

  return (
    <form
      className="table-filters purchase-search-filters"
      onSubmit={(event) => {
        event.preventDefault();
        updateParams({ q: search.trim() });
      }}
    >
      <div className="autocomplete-field purchase-search-field">
        <div className="locked-input">
          <input
            autoComplete="off"
            name="q"
            onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
            onChange={(event) => {
              applySearch(event.target.value);
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setIsOpen(true);
                setActiveIndex((current) => Math.min(current + 1, Math.max(filteredSuggestions.length - 1, 0)));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((current) => Math.max(current - 1, 0));
              }
              if (event.key === "Enter" && isOpen && filteredSuggestions[activeIndex]) {
                event.preventDefault();
                pickSuggestion(filteredSuggestions[activeIndex]);
              }
              if (event.key === "Escape") {
                setIsOpen(false);
              }
            }}
            placeholder="Buscar compra"
            value={search}
          />
          {search ? (
            <button aria-label="Limpiar búsqueda" className="clear-selection-button" onClick={() => applySearch("")} type="button">
              <X size={15} />
            </button>
          ) : null}
        </div>
        {isOpen ? (
          <div className="autocomplete-menu">
            {filteredSuggestions.length === 0 ? <div className="autocomplete-option muted-option">Sin coincidencias</div> : null}
            {filteredSuggestions.map((suggestion, index) => (
              <button
                className={`autocomplete-option${index === activeIndex ? " active" : ""}`}
                key={`${suggestion}-${index}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  pickSuggestion(suggestion);
                }}
                type="button"
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <select defaultValue={currentSupplier} name="proveedor" onChange={(event) => updateParams({ proveedor: event.target.value })}>
        <option value="">Todos los proveedores</option>
        {suppliers.map((supplier) => (
          <option key={supplier.id} value={supplier.id}>
            {supplier.name}
          </option>
        ))}
      </select>
      <select defaultValue={currentBrand} name="marca" onChange={(event) => updateParams({ marca: event.target.value })}>
        <option value="">Todas las marcas</option>
        {brands.map((brand) => (
          <option key={brand.id} value={brand.id}>
            {brand.name}
          </option>
        ))}
      </select>
      <select defaultValue={currentPeriod} name="periodo" onChange={(event) => updateParams({ periodo: event.target.value === "todos" ? "" : event.target.value })}>
        <option value="hoy">Hoy</option>
        <option value="semana">Semana</option>
        <option value="15">Ultimos 15 dias</option>
        <option value="mes">Mes</option>
        <option value="todos">Todos</option>
      </select>
    </form>
  );
}
