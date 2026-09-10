export type SystemModuleKey =
  | "maestros"
  | "pedidos"
  | "caja"
  | "gastos"
  | "cocina"
  | "compras"
  | "inventario"
  | "menu"
  | "marketing"
  | "produccion"
  | "configuracion";

export type PanelActiveKey =
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
  | "marketing-pantallas"
  | "marketing-promociones"
  | "pedidos-nuevo"
  | "pedidos-listado"
  | "gastos"
  | "gastos-categorias"
  | "caja-estado"
  | "caja-movimientos"
  | "caja-cierre"
  | "cocina"
  | "produccion"
  | "produccion-preparaciones"
  | "produccion-registrar";

export type SystemModuleDefinition = {
  key: SystemModuleKey;
  name: string;
  route: string;
  icon: string;
  order: number;
  active: boolean;
};

export const systemModules: SystemModuleDefinition[] = [
  { key: "maestros", name: "Maestros", route: "/panel/productos", icon: "Tags", order: 10, active: true },
  { key: "pedidos", name: "Pedidos", route: "/panel/pedidos/nuevo", icon: "ShoppingCart", order: 20, active: true },
  { key: "caja", name: "Caja", route: "/panel/caja", icon: "Wallet", order: 30, active: true },
  { key: "gastos", name: "Gastos", route: "/panel/gastos", icon: "HandCoins", order: 40, active: true },
  { key: "cocina", name: "Cocina", route: "/panel/cocina", icon: "ChefHat", order: 50, active: true },
  { key: "compras", name: "Compras", route: "/panel/compras", icon: "ReceiptText", order: 60, active: true },
  { key: "inventario", name: "Inventario", route: "/panel/inventario", icon: "Package", order: 70, active: true },
  { key: "menu", name: "Menu", route: "/panel/menu/pizzas", icon: "Pizza", order: 80, active: true },
  { key: "marketing", name: "Marketing", route: "/panel/marketing/pantallas", icon: "MonitorPlay", order: 90, active: true },
  { key: "produccion", name: "Produccion", route: "/panel/produccion/registrar", icon: "Factory", order: 100, active: true },
  { key: "configuracion", name: "Configuracion", route: "/panel/configuracion", icon: "Settings", order: 110, active: true }
];

export const activeModuleMap: Record<PanelActiveKey, SystemModuleKey> = {
  proveedores: "maestros",
  inventario: "inventario",
  productos: "maestros",
  compras: "compras",
  marcas: "maestros",
  categorias: "maestros",
  "perfiles-conservacion": "maestros",
  configuracion: "configuracion",
  "configuracion-cocina": "configuracion",
  "menu-pizzas": "menu",
  "menu-precios-adiciones": "menu",
  "menu-precios-pizzas": "menu",
  "menu-precios-productos": "menu",
  "marketing-pantallas": "marketing",
  "marketing-promociones": "marketing",
  "pedidos-nuevo": "pedidos",
  "pedidos-listado": "pedidos",
  gastos: "gastos",
  "gastos-categorias": "gastos",
  "caja-estado": "caja",
  "caja-movimientos": "caja",
  "caja-cierre": "caja",
  cocina: "cocina",
  produccion: "produccion",
  "produccion-preparaciones": "produccion",
  "produccion-registrar": "produccion"
};

export function allSystemModuleKeys() {
  return systemModules.filter((module) => module.active).map((module) => module.key);
}

export function fallbackModuleAccessForRoles(roleNames: string[]) {
  if (roleNames.includes("admin_sistema")) return allSystemModuleKeys();
  const keys = new Set<SystemModuleKey>();
  if (roleNames.includes("gerente")) allSystemModuleKeys().forEach((key) => keys.add(key));
  if (roleNames.includes("vendedor")) {
    keys.add("pedidos");
    keys.add("caja");
  }
  if (roleNames.includes("mesero")) keys.add("pedidos");
  if (roleNames.includes("cocina")) keys.add("cocina");
  return [...keys];
}
