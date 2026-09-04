# ModoPizzas - Estado del proyecto

## Arquitectura actual

- Aplicacion Next.js App Router con TypeScript y Supabase.
- Supabase centraliza Auth, PostgreSQL, RLS, RPC, Realtime y Storage.
- Las mutaciones criticas se ejecutan con server actions o RPC transaccionales.
- El panel administrativo usa permisos por rol y navegacion protegida.
- Las imagenes se guardan en Supabase Storage y en tablas solo se conserva la ruta o URL.

## Modulos implementados

- Autenticacion, perfiles, roles, permisos y auditoria basica.
- Maestros: Productos, Categorias, Marcas, Proveedores y Perfiles de conservacion.
- Compras con referencias comerciales, unidades normalizadas, costos y fotos.
- Inventario de productos comprados, producciones y ajustes/conteo fisico.
- Produccion: Recetas/Preparaciones, Registrar produccion, lotes y KDS.
- Menu: Recetas de pizzas, tamanos, categorias, sabores, adiciones y precios.
- Pedidos: POS tactil, pizzas, productos, cobro en efectivo y listado de pedidos.
- Caja: apertura, movimientos, retiros, arqueos, cierre congelado, fondo de resguardo y pagos auditables.
- Gastos: categorias, registro de gastos, origen de pago, anulacion y trazabilidad con caja/fondo cuando aplica.
- Cocina: tablero KDS con estados por linea, ETA, sonido y Realtime.
- Marketing: Pantallas y Promociones con editor visual, plantillas, preview y persistencia.
- UI global: modales estandar con header arrastrable en escritorio, backdrop liviano y limites dentro del viewport.

## Decisiones funcionales vigentes

- Peso se almacena en G, volumen en ML y unidades en UNIT/UND; KG y L son visuales.
- Los inputs numericos visibles usan formato colombiano: punto para miles y coma para decimales.
- Las compras conservan cantidad normalizada como fuente de stock/costo y presentacion solo como dato visual/auditoria cuando aplica.
- Compras es la fuente de stock para productos comprados.
- Producciones generan lotes propios y consumen stock por FEFO/FIFO.
- Los costos de produccion quedan congelados al registrar.
- Productos es dato maestro; SKU de referencias se gestiona fuera del producto maestro.
- Productos para venta se venden solo si tienen precio activo configurado.
- Caja usa sesiones y movimientos auditables como fuente de efectivo; ventas en efectivo afectan caja una sola vez.
- Gasto no equivale automaticamente a movimiento de caja; solo afecta caja si el origen es Caja actual.
- Retiro a Fondo de resguardo no es gasto; baja caja y sube el fondo.
- Cierres de caja se congelan con snapshot y no deben recalcularse silenciosamente.
- Cocina recibe solo lineas que requieren preparacion, no productos para venta.
- Conteo fisico genera ajustes auditables; no modifica compras ni producciones originales.
- En modulos maestros se usan modales, filtros compactos, mayusculas y validacion antiduplicado.
- Marketing exporta proyecto JSON/HTML de prueba; MP4 final queda abstraido para worker dedicado.

## Pendientes reales

- Implementar exportacion MP4 real para Marketing con worker dedicado.
- Profundizar pruebas automatizadas de permisos, POS, inventario y Realtime.
- Completar desglose real de pago mixto para que efectivo y transferencia se registren por separado.
- Agregar carga de comprobantes de gasto a Storage si se requiere archivo adjunto real.
- Agregar edicion controlada de gastos abiertos si el flujo operativo lo pide; por ahora existe anulacion con reverso.
- Completar flujos futuros: promociones aplicadas a venta, mitad y mitad avanzada, domicilios publicos y pagina publica.
- Revisar periodicamente politicas RLS y cobertura de permisos en nuevas rutas.
- Agregar pruebas automatizadas para parseo numerico colombiano en compras y conversiones G/KG, ML/L, UND.
- Probar manualmente modales arrastrables en pantallas tactiles reales y distintos navegadores.

## Siguiente tarea recomendada

- Probar en un PC limpio el flujo publicado: login, permisos, Caja, Cocina, Compras, Produccion, Inventario y Marketing.
- Despues implementar exportacion MP4 real de Marketing o cerrar pruebas automatizadas de POS e inventario antes de nuevas funciones.
