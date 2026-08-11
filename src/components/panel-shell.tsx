"use client";

import Link from "next/link";
import { ChefHat, ChevronDown, ClipboardList, Factory, Home, Menu, Package, Pizza, Plus, ReceiptText, Settings, ShoppingCart, Tags, Thermometer, Truck, UserCog } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { PointerEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { signOut } from "@/app/auth/actions";
import { ThemeToggle } from "@/components/theme-toggle";

type PanelShellProps = {
  children: ReactNode;
  title: string;
  subtitle?: string;
  userEmail: string;
  roleNames: string[];
  active:
    | "proveedores"
    | "inventario"
    | "productos"
    | "compras"
    | "marcas"
    | "categorias"
    | "perfiles-conservacion"
    | "configuracion"
    | "configuracion-cocina"
    | "menu-pizzas"
    | "menu-precios-adiciones"
    | "menu-precios-pizzas"
    | "menu-precios-productos"
    | "pedidos-nuevo"
    | "pedidos-listado"
    | "cocina"
    | "produccion"
    | "produccion-preparaciones"
    | "produccion-registrar";
  actions?: ReactNode;
  hideHeader?: boolean;
};

const managerRoles = new Set(["gerente", "admin_sistema"]);
const orderRoles = new Set(["vendedor", "mesero", "gerente", "admin_sistema"]);
const kitchenRoles = new Set(["cocina", "gerente", "admin_sistema"]);
type ActiveKey = PanelShellProps["active"];
type NavLink = { key: ActiveKey; href: string; label: string; icon: LucideIcon; show: boolean };
type RootItem =
  | { kind: "link"; key: ActiveKey; link: NavLink }
  | { kind: "group"; key: string; label: string; title: string; icon: LucideIcon; show: boolean; active: boolean; links: NavLink[]; nested?: RootItem[] };

const holdDelayMs = 420;

function orderedItems<T extends { key: string }>(items: T[], order: string[] | undefined) {
  if (!order?.length) return items;
  const rank = new Map(order.map((key, index) => [key, index]));
  return [...items].sort((a, b) => (rank.get(a.key) ?? 999) - (rank.get(b.key) ?? 999));
}

function readNavOrder(storageKey: string) {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string[]>) : {};
  } catch {
    window.localStorage.removeItem(storageKey);
    return {};
  }
}

export function PanelShell({ children, title, subtitle = "", userEmail, roleNames, active, actions, hideHeader = false }: PanelShellProps) {
  const isManager = roleNames.some((role) => managerRoles.has(role));
  const canSell = roleNames.some((role) => orderRoles.has(role));
  const canUseKitchen = roleNames.some((role) => kitchenRoles.has(role));
  const isAdmin = roleNames.includes("admin_sistema");
  const orderStorageKey = `modo-pizzas-nav-order:${userEmail || "usuario"}`;
  const [navOrder, setNavOrder] = useState<Record<string, string[]>>(() => readNavOrder(orderStorageKey));
  const [dragging, setDragging] = useState<{ group: string; key: string } | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const pendingDragRef = useRef<{ group: string; key: string } | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(orderStorageKey, JSON.stringify(navOrder));
  }, [navOrder, orderStorageKey]);

  const masterLinks: NavLink[] = [
    { key: "productos", href: "/panel/productos", label: "Productos", icon: Package, show: isManager },
    { key: "categorias", href: "/panel/categorias", label: "Categorias", icon: Tags, show: isManager },
    { key: "marcas", href: "/panel/marcas", label: "Marcas", icon: Tags, show: isManager },
    { key: "proveedores", href: "/panel/proveedores", label: "Proveedores", icon: Truck, show: isManager },
    { key: "perfiles-conservacion", href: "/panel/perfiles-conservacion", label: "Perfiles de conservacion", icon: Thermometer, show: isManager }
  ];
  const inventoryLinks: NavLink[] = [
    { key: "compras", href: "/panel/compras", label: "Compras", icon: ReceiptText, show: isManager },
    { key: "inventario", href: "/panel/inventario", label: "Inventario", icon: Package, show: isManager }
  ];
  const orderLinks: NavLink[] = [
    { key: "pedidos-nuevo", href: "/panel/pedidos/nuevo", label: "Crear pedido", icon: ShoppingCart, show: canSell },
    { key: "pedidos-listado", href: "/panel/pedidos", label: "Listado de pedidos", icon: ClipboardList, show: canSell }
  ];
  const kitchenLinks: NavLink[] = [
    { key: "cocina", href: "/panel/cocina", label: "Pedidos en cocina", icon: ChefHat, show: canUseKitchen }
  ];
  const menuMainLinks: NavLink[] = [{ key: "menu-pizzas", href: "/panel/menu/pizzas", label: "Recetas", icon: Pizza, show: isManager }];
  const menuPriceLinks: NavLink[] = [
    { key: "menu-precios-pizzas", href: "/panel/menu/precios/pizzas", label: "Pizzas", icon: ReceiptText, show: isManager },
    { key: "menu-precios-productos", href: "/panel/menu/precios/productos", label: "Productos", icon: Package, show: isManager },
    { key: "menu-precios-adiciones", href: "/panel/menu/precios/adiciones", label: "Adiciones", icon: Plus, show: isManager }
  ];
  const productionLinks: NavLink[] = [
    { key: "produccion-registrar", href: "/panel/produccion/registrar", label: "Producciones", icon: Plus, show: isManager },
    { key: "produccion-preparaciones", href: "/panel/produccion", label: "Recetas", icon: ReceiptText, show: isManager }
  ];
  const adminLinks: NavLink[] = [
    { key: "configuracion", href: "/panel/configuracion", label: "Usuarios y permisos", icon: UserCog, show: isAdmin },
    { key: "configuracion-cocina", href: "/panel/configuracion/cocina", label: "Cocina", icon: ChefHat, show: isManager }
  ];
  const masterActive = masterLinks.some((link) => link.key === active);
  const ordersActive = orderLinks.some((link) => link.key === active);
  const kitchenActive = kitchenLinks.some((link) => link.key === active);
  const menuPricesActive = menuPriceLinks.some((link) => link.key === active);
  const menuActive = menuMainLinks.some((link) => link.key === active) || menuPricesActive;
  const productionActive = active === "produccion" || productionLinks.some((link) => link.key === active);
  const settingsActive = adminLinks.some((link) => link.key === active);

  function startHold(group: string, key: string) {
    pendingDragRef.current = { group, key };
    if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current);
    holdTimerRef.current = window.setTimeout(() => {
      const pending = pendingDragRef.current;
      if (!pending) return;
      suppressClickRef.current = true;
      setDragging(pending);
    }, holdDelayMs);
  }

  function endHold() {
    pendingDragRef.current = null;
    if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
    window.setTimeout(() => {
      suppressClickRef.current = false;
      setDragging(null);
    }, 0);
  }

  function moveWithinGroup(group: string, targetKey: string, keys: string[]) {
    if (!dragging || dragging.group !== group || dragging.key === targetKey) return;
    setNavOrder((current) => {
      const existing = current[group] ?? keys;
      const sourceIndex = existing.indexOf(dragging.key);
      const targetIndex = existing.indexOf(targetKey);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const next = [...existing];
      next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, dragging.key);
      return { ...current, [group]: next };
    });
  }

  function moveFromPointer(group: string, keys: string[], event: PointerEvent<HTMLElement>) {
    if (!dragging || dragging.group !== group) return;
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const target = element?.closest<HTMLElement>(`[data-nav-group="${group}"]`);
    const targetKey = target?.dataset.navKey;
    if (targetKey) moveWithinGroup(group, targetKey, keys);
  }

  function dragHandlers(group: string, key: string, keys: string[]) {
    return {
      "data-nav-group": group,
      "data-nav-key": key,
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        event.currentTarget.setPointerCapture?.(event.pointerId);
        startHold(group, key);
      },
      onPointerEnter: () => moveWithinGroup(group, key, keys),
      onPointerMove: (event: PointerEvent<HTMLElement>) => moveFromPointer(group, keys, event),
      onPointerLeave: () => {
        if (!dragging && holdTimerRef.current) window.clearTimeout(holdTimerRef.current);
      },
      onPointerUp: endHold,
      onPointerCancel: endHold
    };
  }

  function linkClass(linkKey: string) {
    return [active === linkKey ? "active" : "", dragging?.key === linkKey ? "dragging" : ""].filter(Boolean).join(" ");
  }

  const renderLinks = (links: NavLink[], groupKey: string) => {
    const visibleLinks = orderedItems(links.filter((link) => link.show), navOrder[groupKey]);
    const keys = visibleLinks.map((link) => link.key);
    return visibleLinks.map((link) => {
      const Icon = link.icon;
      return (
        <Link
          className={linkClass(link.key)}
          href={link.href}
          key={link.key}
          onClick={(event) => {
            if (suppressClickRef.current) event.preventDefault();
          }}
          title={link.label}
          {...dragHandlers(groupKey, link.key, keys)}
        >
          <Icon size={18} />
          <span>{link.label}</span>
        </Link>
      );
    });
  };

  const menuRootItems: RootItem[] = [
    { kind: "link", key: "menu-pizzas", link: menuMainLinks[0] },
    { kind: "group", key: "menu-prices", label: "Precios", title: "Precios", icon: ReceiptText, show: isManager, active: menuPricesActive, links: menuPriceLinks }
  ];

  const rootItems: RootItem[] = [
    { kind: "group", key: "masters", label: "Maestros", title: "Datos maestros", icon: Tags, show: isManager, active: masterActive, links: masterLinks },
    { kind: "group", key: "orders", label: "Pedidos / Caja", title: "Pedidos y caja", icon: ShoppingCart, show: canSell, active: ordersActive, links: orderLinks },
    { kind: "group", key: "kitchen", label: "Cocina", title: "Cocina", icon: ChefHat, show: canUseKitchen, active: kitchenActive, links: kitchenLinks },
    ...inventoryLinks.map((link) => ({ kind: "link" as const, key: link.key, link })),
    { kind: "group", key: "menu", label: "Menu", title: "Menu", icon: Pizza, show: isManager, active: menuActive, links: [], nested: menuRootItems },
    { kind: "group", key: "production", label: "Produccion", title: "Produccion", icon: Factory, show: isManager, active: productionActive, links: productionLinks },
    { kind: "group", key: "settings", label: "Configuracion", title: "Configuracion", icon: isAdmin ? UserCog : Settings, show: isManager, active: settingsActive, links: adminLinks }
  ];

  const visibleRootItems = orderedItems(rootItems.filter((item) => (item.kind === "link" ? item.link.show : item.show)), navOrder.root);
  const rootKeys = visibleRootItems.map((item) => item.key);

  function renderRootItem(item: RootItem) {
    if (item.kind === "link") {
      const Icon = item.link.icon;
      return (
        <Link
          className={linkClass(item.key)}
          href={item.link.href}
          key={item.key}
          onClick={(event) => {
            if (suppressClickRef.current) event.preventDefault();
          }}
          title={item.link.label}
          {...dragHandlers("root", item.key, rootKeys)}
        >
          <Icon size={18} />
          <span>{item.link.label}</span>
        </Link>
      );
    }

    const Icon = item.icon;
    const childKeys = item.nested?.filter((nested) => (nested.kind === "link" ? nested.link.show : nested.show)).map((nested) => nested.key) ?? [];
    const nested = item.nested ? orderedItems(item.nested.filter((nested) => (nested.kind === "link" ? nested.link.show : nested.show)), navOrder[item.key]) : [];
    return (
      <details className={["worker-submenu", dragging?.key === item.key ? "dragging" : ""].filter(Boolean).join(" ")} key={item.key} open={item.active}>
        <summary className={item.active ? "active" : ""} title={item.title} {...dragHandlers("root", item.key, rootKeys)}>
          <Icon size={18} />
          <span>{item.label}</span>
          <ChevronDown className="submenu-chevron" size={16} />
        </summary>
        <div>
          {item.nested
            ? nested.map((nestedItem) => {
                if (nestedItem.kind === "link") {
                  const NestedIcon = nestedItem.link.icon;
                  return (
                    <Link
                      className={linkClass(nestedItem.key)}
                      href={nestedItem.link.href}
                      key={nestedItem.key}
                      onClick={(event) => {
                        if (suppressClickRef.current) event.preventDefault();
                      }}
                      title={nestedItem.link.label}
                      {...dragHandlers(item.key, nestedItem.key, childKeys)}
                    >
                      <NestedIcon size={18} />
                      <span>{nestedItem.link.label}</span>
                    </Link>
                  );
                }
                const NestedGroupIcon = nestedItem.icon;
                return (
                  <details className="worker-submenu nested-submenu" key={nestedItem.key} open={nestedItem.active}>
                    <summary className={nestedItem.active ? "active" : ""} title={nestedItem.title} {...dragHandlers(item.key, nestedItem.key, childKeys)}>
                      <NestedGroupIcon size={18} />
                      <span>{nestedItem.label}</span>
                      <ChevronDown className="submenu-chevron" size={16} />
                    </summary>
                    <div>{renderLinks(nestedItem.links, nestedItem.key)}</div>
                  </details>
                );
              })
            : renderLinks(item.links, item.key)}
        </div>
      </details>
    );
  }

  return (
    <main className="worker-shell">
      <aside aria-label="Menu de modulos" className="worker-sidebar">
        <details>
          <summary title="Abrir menu">
            <Menu size={20} />
            <span>Modulos</span>
          </summary>
          <div className="worker-brand">
            <span className="brand-mark">MP</span>
            <div>
              <strong>ModoPizzas</strong>
              <small>{roleNames.join(", ") || "sin rol"}</small>
            </div>
          </div>
          <nav className="worker-nav">
            {visibleRootItems.map(renderRootItem)}
          </nav>
          <button className="worker-reset-order" onClick={() => setNavOrder({})} type="button">
            Restablecer orden
          </button>
          <form action={signOut}>
            <button className="worker-logout" type="submit">
              <Home size={18} />
              <span>Cerrar sesion</span>
            </button>
          </form>
        </details>
      </aside>

      <section className="worker-main">
        {hideHeader ? null : (
          <header className="worker-header">
            <div>
              <span className="eyebrow">{userEmail}</span>
              <h1>{title}</h1>
              {subtitle ? <p>{subtitle}</p> : null}
            </div>
            {actions ? <div className="worker-actions">{actions}</div> : null}
          </header>
        )}
        {children}
      </section>
      <ThemeToggle />
    </main>
  );
}
