import Link from "next/link";
import { Bike, ChartNoAxesCombined, ChefHat, ClipboardList, Package, Printer, ShieldCheck, UserCog } from "lucide-react";
import { formatCop, formatNumber } from "@/lib/format";

const modules = [
  {
    title: "Vendedor / Caja",
    icon: ClipboardList,
    href: "/panel",
    text: "Crea pedidos, confirma WhatsApp, cancela segun estado, imprime recibo POS 58mm y etiqueta 80x130mm."
  },
  {
    title: "Cocina",
    icon: ChefHat,
    href: "/panel",
    text: "Ve pedidos confirmados y marca en cocina, en preparacion y preparado con aviso para vendedor o mesero."
  },
  {
    title: "Domicilios",
    icon: Bike,
    href: "/panel",
    text: "Lista pedidos asignados con nombre, telefono, direccion y resumen. Marca en camino y entregado."
  },
  {
    title: "Inventario",
    icon: Package,
    href: "/panel/inventario",
    text: "Ingredientes, productos, compras con decimales, unidades en g, kg, ml y L, y descuentos por receta."
  },
  {
    title: "Reportes",
    icon: ChartNoAxesCombined,
    href: "/panel/inventario",
    text: "Ventas diarias, cierre de caja, gastos, compras, margen estimado y rentabilidad basica."
  },
  {
    title: "Administracion",
    icon: UserCog,
    href: "/panel",
    text: "Roles, permisos, numero de WhatsApp, promociones, colores, pagina publica y ajustes tecnicos."
  }
];

const statuses = [
  "recibido",
  "confirmado",
  "en_cocina",
  "en_preparacion",
  "preparado",
  "en_camino",
  "entregado",
  "cancelado"
];

export function OperationsDashboard() {
  return (
    <section className="ops-band" id="operacion">
      <h2 className="section-title">Panel operativo inicial</h2>
      <p className="section-copy">
        Esta primera base deja el mapa funcional listo para conectar Supabase: roles, pedidos, cocina, domicilios,
        inventario, cierres e impresion manual.
      </p>

      <div className="metrics-grid">
        <div className="metric-card">
          <span>Ventas de hoy</span>
          <strong>{formatCop(428000)}</strong>
        </div>
        <div className="metric-card">
          <span>Pedidos activos</span>
          <strong>{formatNumber(12)}</strong>
        </div>
        <div className="metric-card">
          <span>Costo harina disponible</span>
          <strong>{formatCop(94250.75, { decimals: true })}</strong>
        </div>
      </div>

      <div className="ops-layout">
        <aside className="form-panel">
          <h3>Estados permitidos</h3>
          <div className="status-list">
            {statuses.map((status) => (
              <div className="status-row" key={status}>
                <span>{status}</span>
                <strong>activo</strong>
              </div>
            ))}
          </div>
          <p className="alert">
            La factura electronica DIAN queda fuera del MVP, pero el modelo incluye campos para integrarla luego.
          </p>
        </aside>

        <div className="module-grid">
          {modules.map((module) => {
            const Icon = module.icon;
            return (
              <article className="module-card" key={module.title}>
                <header>
                  <h3>{module.title}</h3>
                  <span className="badge">
                    <Icon size={15} /> modulo
                  </span>
                </header>
                <p>{module.text}</p>
                <a className="module-link" href={module.href}>
                  Abrir modulo
                </a>
              </article>
            );
          })}
        </div>
      </div>

      <section className="form-panel" id="legal">
        <h2 className="section-title">
          <ShieldCheck size={24} /> Paginas legales y seguridad
        </h2>
        <div className="legal-list">
          <Link href="/legal/acerca-de">Acerca de</Link>
          <Link href="/legal/tratamiento-de-datos">Politica de Tratamiento de Datos</Link>
          <Link href="/legal/terminos-condiciones">Terminos y Condiciones</Link>
          <Link href="/legal/reversion-pagos">Reversion de Pagos</Link>
          <Link href="/legal/alergenos">Politica de Alergenos</Link>
          <Link href="/legal/sugerencias-reclamos">Sugerencias y Reclamos</Link>
          <Link href="/legal/aviso-privacidad">Aviso de privacidad</Link>
          <a href="https://www.sic.gov.co/" rel="noreferrer" target="_blank">
            Super. Ind y Comercio SIC
          </a>
        </div>
        <p className="muted">
          Supabase debe quedar con RLS en todas las tablas publicas y validacion de permisos tambien en servidor.
        </p>
        <p className="muted">
          <Printer size={16} /> Impresion avanzada y caja registradora pueden pasar a Android o puente local cuando el
          negocio lo necesite.
        </p>
      </section>
    </section>
  );
}
