import Link from "next/link";
import { ChevronDown, Factory, Home, Menu, Package, Plus, ReceiptText, Settings, Tags, Truck, UserCog } from "lucide-react";
import type { ReactNode } from "react";
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
    | "configuracion"
    | "produccion"
    | "produccion-preparaciones"
    | "produccion-registrar";
  actions?: React.ReactNode;
  hideHeader?: boolean;
};

const managerRoles = new Set(["gerente", "admin_sistema"]);

export function PanelShell({ children, title, subtitle = "", userEmail, roleNames, active, actions, hideHeader = false }: PanelShellProps) {
  const isManager = roleNames.some((role) => managerRoles.has(role));
  const isAdmin = roleNames.includes("admin_sistema");
  const masterLinks = [
    { key: "productos", href: "/panel/productos", label: "Productos", icon: Package, show: isManager },
    { key: "categorias", href: "/panel/categorias", label: "Categorias", icon: Tags, show: isManager },
    { key: "marcas", href: "/panel/marcas", label: "Marcas", icon: Tags, show: isManager },
    { key: "proveedores", href: "/panel/proveedores", label: "Proveedores", icon: Truck, show: isManager }
  ];
  const inventoryLinks = [
    { key: "compras", href: "/panel/compras", label: "Compras", icon: ReceiptText, show: isManager },
    { key: "inventario", href: "/panel/inventario", label: "Inventario", icon: Package, show: isManager }
  ];
  const productionLinks = [
    { key: "produccion-registrar", href: "/panel/produccion/registrar", label: "Registrar produccion", icon: Plus, show: isManager },
    { key: "produccion-preparaciones", href: "/panel/produccion", label: "Preparaciones", icon: ReceiptText, show: isManager }
  ];
  const adminLinks = [
    { key: "configuracion", href: "/panel/configuracion", label: "Configuracion", icon: isAdmin ? UserCog : Settings, show: isManager }
  ];
  const masterActive = masterLinks.some((link) => link.key === active);
  const productionActive = active === "produccion" || productionLinks.some((link) => link.key === active);

  const renderLinks = (links: typeof masterLinks) =>
    links
      .filter((link) => link.show)
      .map((link) => {
        const Icon = link.icon;
        return (
          <Link className={active === link.key ? "active" : ""} href={link.href} key={link.key} title={link.label}>
            <Icon size={18} />
            <span>{link.label}</span>
          </Link>
        );
      });

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
            {isManager ? (
              <details className="worker-submenu" open={masterActive}>
                <summary className={masterActive ? "active" : ""} title="Datos maestros">
                  <Tags size={18} />
                  <span>Maestros</span>
                  <ChevronDown className="submenu-chevron" size={16} />
                </summary>
                <div>{renderLinks(masterLinks)}</div>
              </details>
            ) : null}
            {renderLinks(inventoryLinks)}
            {isManager ? (
              <details className="worker-submenu" open={productionActive}>
                <summary className={productionActive ? "active" : ""} title="Produccion">
                  <Factory size={18} />
                  <span>Produccion</span>
                  <ChevronDown className="submenu-chevron" size={16} />
                </summary>
                <div>{renderLinks(productionLinks)}</div>
              </details>
            ) : null}
            {renderLinks(adminLinks)}
          </nav>
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
