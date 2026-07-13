import Link from "next/link";
import {
  Bike,
  ChefHat,
  ClipboardList,
  Home,
  Menu,
  Package,
  Pizza,
  Plus,
  Settings,
  Store,
  Truck,
  UserCog
} from "lucide-react";
import type { ReactNode } from "react";
import { signOut } from "@/app/auth/actions";
import { ThemeToggle } from "@/components/theme-toggle";

type PanelShellProps = {
  children: ReactNode;
  title: string;
  subtitle: string;
  userEmail: string;
  roleNames: string[];
  active: "pedidos" | "cocina" | "domicilios" | "proveedores" | "inventario" | "menu" | "configuracion";
  actions?: React.ReactNode;
};

const managerRoles = new Set(["gerente", "admin_sistema"]);
const orderCreatorRoles = new Set(["vendedor", "mesero", "gerente", "admin_sistema"]);

export function PanelShell({ children, title, subtitle, userEmail, roleNames, active, actions }: PanelShellProps) {
  const isManager = roleNames.some((role) => managerRoles.has(role));
  const canCreateOrders = roleNames.some((role) => orderCreatorRoles.has(role));
  const isAdmin = roleNames.includes("admin_sistema");
  const links = [
    { key: "pedidos", href: "/panel", label: "Pedidos", icon: ClipboardList, show: true },
    { key: "cocina", href: "/panel/cocina", label: "Cocina", icon: ChefHat, show: true },
    { key: "domicilios", href: "/panel/domicilios", label: "Domicilios", icon: Bike, show: true },
    { key: "proveedores", href: "/panel/proveedores", label: "Proveedores", icon: Truck, show: isManager },
    { key: "inventario", href: "/panel/inventario", label: "Inventario", icon: Package, show: isManager },
    { key: "menu", href: "/panel/menu", label: "Menu", icon: Pizza, show: isManager },
    { key: "configuracion", href: "/panel/configuracion", label: "Configuracion", icon: isAdmin ? UserCog : Settings, show: isManager }
  ];

  return (
    <main className="worker-shell">
      <aside className="worker-sidebar" aria-label="Menu de modulos">
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
            <Link href="/" title="Web publica">
              <Store size={18} />
              <span>Web publica</span>
            </Link>
            {canCreateOrders ? (
              <Link href="/panel/nuevo-pedido" title="Nuevo pedido">
                <Plus size={18} />
                <span>Nuevo pedido</span>
              </Link>
            ) : null}
            {links
              .filter((link) => link.show)
              .map((link) => {
                const Icon = link.icon;
                return (
                  <Link className={active === link.key ? "active" : ""} href={link.href} key={link.key} title={link.label}>
                    <Icon size={18} />
                    <span>{link.label}</span>
                  </Link>
                );
              })}
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
        <header className="worker-header">
          <div>
            <span className="eyebrow">{userEmail}</span>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          {actions ? <div className="worker-actions">{actions}</div> : null}
        </header>
        {children}
      </section>
      <ThemeToggle />
    </main>
  );
}
