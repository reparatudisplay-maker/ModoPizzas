"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

export type ConfigurationSection = "general" | "users" | "public" | "platforms" | "design" | "kitchen" | "printing";

type Tab = {
  id: ConfigurationSection;
  label: string;
  href: string;
  adminOnly?: boolean;
};

const tabs: Tab[] = [
  { id: "general", label: "General", href: "/panel/configuracion/general" },
  { id: "users", label: "Usuarios y permisos", href: "/panel/configuracion", adminOnly: true },
  { id: "public", label: "Información pública", href: "/panel/configuracion/negocio", adminOnly: true },
  { id: "platforms", label: "Plataformas", href: "/panel/configuracion/general?section=plataformas", adminOnly: true },
  { id: "design", label: "Diseño", href: "/panel/configuracion/general?section=diseno" },
  { id: "kitchen", label: "Cocina", href: "/panel/configuracion/cocina" },
  { id: "printing", label: "Impresión", href: "/panel/configuracion/impresoras" }
];

export function ConfigurationTabs({ active, children, isAdmin }: { active: ConfigurationSection; children: ReactNode; isAdmin: boolean }) {
  const rootRef = useRef<HTMLElement>(null);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    window.localStorage.setItem("modo-pizzas:configuration-section", active);
  }, [active]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const markDirty = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) {
        setIsDirty(true);
      }
    };
    const clearDirty = () => setIsDirty(false);
    const preventUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    root.addEventListener("input", markDirty, true);
    root.addEventListener("change", markDirty, true);
    root.addEventListener("submit", clearDirty, true);
    window.addEventListener("beforeunload", preventUnload);
    return () => {
      root.removeEventListener("input", markDirty, true);
      root.removeEventListener("change", markDirty, true);
      root.removeEventListener("submit", clearDirty, true);
      window.removeEventListener("beforeunload", preventUnload);
    };
  }, [isDirty]);

  const confirmNavigation = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!isDirty || window.confirm("Tienes cambios sin guardar. ¿Deseas salir de esta sección?")) return;
    event.preventDefault();
  };

  const visibleTabs = tabs.filter((tab) => !tab.adminOnly || isAdmin);
  return (
    <section className="configuration-workspace" ref={rootRef}>
      <nav aria-label="Secciones de configuración" className="configuration-tabs" role="tablist">
        {visibleTabs.map((tab) => (
          <Link
            aria-current={active === tab.id ? "page" : undefined}
            className={active === tab.id ? "active" : ""}
            href={tab.href}
            key={tab.id}
            onClick={confirmNavigation}
            role="tab"
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      {isDirty ? <p className="configuration-unsaved">Cambios sin guardar</p> : null}
      {children}
    </section>
  );
}

export function PrintingSubtabs({ active }: { active: "connection" | "templates" }) {
  return (
    <nav aria-label="Ajustes de impresión" className="configuration-subtabs">
      <Link aria-current={active === "connection" ? "page" : undefined} className={active === "connection" ? "active" : ""} href="/panel/configuracion/impresoras">Conexión</Link>
      <Link aria-current={active === "templates" ? "page" : undefined} className={active === "templates" ? "active" : ""} href="/panel/configuracion/plantillas-impresion">Plantillas</Link>
    </nav>
  );
}
