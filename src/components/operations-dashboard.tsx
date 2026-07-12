import { Bike, ChartNoAxesCombined, ChefHat, ClipboardList, Package, Printer, ShieldCheck, UserCog } from "lucide-react";
import { formatCop, formatNumber } from "@/lib/format";

const modules = [
  {
    title: "Vendedor / Caja",
    icon: ClipboardList,
    text: "Crea pedidos, confirma WhatsApp, cancela segun estado, imprime recibo POS 58mm y etiqueta 80x130mm."
  },
  {
    title: "Cocina",
    icon: ChefHat,
    text: "Ve pedidos confirmados y marca en cocina, en preparacion y preparado con aviso para vendedor o mesero."
  },
  {
    title: "Domicilios",
    icon: Bike,
    text: "Lista pedidos asignados con nombre, telefono, direccion y resumen. Marca en camino y entregado."
  },
  {
    title: "Inventario",
    icon: Package,
    text: "Ingredientes, productos, compras con decimales, unidades en g, kg, ml y L, y descuentos por receta."
  },
  {
    title: "Reportes",
    icon: ChartNoAxesCombined,
    text: "Ventas diarias, cierre de caja, gastos, compras, margen estimado y rentabilidad basica."
  },
  {
    title: "Administracion",
    icon: UserCog,
    text: "Roles, permisos, numero de WhatsApp, promociones, colores, pagina publica y ajustes tecnicos."
  }
];

const statuses = [
  "confirmado",
  "en_cocina",
  "en_preparacion",
  "preparado",
  "en_camino",
  "entregado",
  "cerrado"
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
          <a href="#">Acerca de</a>
          <a href="#">Politica de Tratamiento de Datos</a>
          <a href="#">Terminos y Condiciones</a>
          <a href="#">Reversion de Pagos</a>
          <a href="#">Politica de Alergenos</a>
          <a href="#">Sugerencias y Reclamos</a>
          <a href="#">Aviso de privacidad</a>
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
