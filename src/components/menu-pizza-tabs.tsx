import Link from "next/link";
import { Package, Pizza, Plus, Tags } from "lucide-react";

type PizzaSection = "recipes" | "packaging";
type PizzaPriceSection = "prices" | "combos" | "additions";

const pizzaTabs = [
  { id: "recipes" as const, label: "Recetas", href: "/panel/menu/pizzas", icon: Pizza },
  { id: "packaging" as const, label: "Empaques", href: "/panel/menu/empaques", icon: Package }
];

const pizzaPriceTabs = [
  { id: "prices" as const, label: "Precios de pizzas", href: "/panel/menu/precios/pizzas", icon: Pizza },
  { id: "combos" as const, label: "Combos", href: "/panel/menu/precios/combos", icon: Tags },
  { id: "additions" as const, label: "Adiciones", href: "/panel/menu/precios/adiciones", icon: Plus }
];

export function PizzaManagementTabs({ active }: { active: PizzaSection }) {
  return <section className="pizza-management-shell">
    <header className="pizza-management-heading"><span className="pizza-management-heading-icon"><Pizza size={23} /></span><div><span>Menú / Pizzas</span><h1>Pizzas</h1><p>Recetas, tamaños, gramajes y empaques para pizzas.</p></div><b>Fase 1</b></header>
    <nav aria-label="Gestión de pizzas" className="pizza-management-tabs" role="tablist">
      {pizzaTabs.map(({ id, label, href, icon: Icon }) => <Link aria-current={active === id ? "page" : undefined} className={active === id ? "active" : ""} href={href} key={id} role="tab"><Icon size={16} />{label}</Link>)}
    </nav>
  </section>;
}

export function PizzaPriceTabs({ active }: { active: PizzaPriceSection }) {
  return <section className="pizza-management-shell pizza-price-shell">
    <header className="pizza-management-heading"><span className="pizza-management-heading-icon"><Tags size={23} /></span><div><span>Menú / Precios</span><h1>Precios de pizzas</h1><p>Precios, combos y adiciones de pizzas.</p></div><b>Fase 1</b></header>
    <nav aria-label="Precios de pizzas" className="pizza-management-tabs" role="tablist">
      {pizzaPriceTabs.map(({ id, label, href, icon: Icon }) => <Link aria-current={active === id ? "page" : undefined} className={active === id ? "active" : ""} href={href} key={id} role="tab"><Icon size={16} />{label}</Link>)}
    </nav>
  </section>;
}
