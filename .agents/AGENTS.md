# ModoPizzas — reglas permanentes para Codex

Estas instrucciones aplican únicamente al repositorio ModoPizzas.

## Contexto del producto

ModoPizzas es un sistema web para operación de pizzería con:

- sitio público;
- clientes y usuarios;
- catálogo;
- pizzas, tamaños, sabores e ingredientes;
- recetas y costos;
- pedidos;
- cocina;
- domicilios;
- caja;
- compras;
- inventario;
- gastos;
- reportes;
- configuración;
- roles y permisos.

Tecnología esperada:

- Next.js con App Router;
- TypeScript;
- Supabase;
- PostgreSQL;
- GitHub;
- Vercel.

Antes de asumir versiones, librerías, rutas, tablas o comandos, inspecciona el repositorio.

## Reglas de trabajo

Antes de modificar código:

1. Lee los archivos directamente relacionados.
2. Revisa `package.json`.
3. Revisa tipos, migraciones, componentes y utilidades reutilizables.
4. Distingue:
   - existente;
   - parcial;
   - planificado;
   - no verificado.
5. No inventes nombres de tablas, columnas, rutas, componentes ni scripts.
6. Para tareas grandes, presenta primero un plan breve de 3 a 7 pasos.

## Límites

Sin autorización explícita:

- no hagas commit;
- no hagas push;
- no abras PR;
- no despliegues;
- no apliques migraciones remotas;
- no borres tablas, columnas o datos;
- no cambies arquitectura funcional solo por preferencia.

## Calidad

- Responde en español.
- Mantén cambios pequeños y enfocados.
- No reformatees archivos ajenos.
- Reutiliza patrones existentes.
- No añadas dependencias sin justificar.
- Mantén TypeScript estricto.
- Evita `any`.
- No expongas secretos.
- Respeta RLS.
- Considera concurrencia, idempotencia y reintentos.
- No afirmes que algo está terminado sin verificarlo.

## Localización

- Moneda: COP.
- Formato visual:
  - punto para miles;
  - coma para decimales.
- Peso:
  - gramos;
  - kilogramos.
- Volumen:
  - mililitros;
  - litros.
- Idioma principal: español.
- Compatible con escritorio y móvil.
- Modo claro y oscuro cuando exista.

## Diseño

La interfaz debe ser:

- rápida;
- sencilla;
- agradable;
- legible;
- táctil;
- consistente;
- adecuada para momentos de alta demanda.

Prioriza:

1. acción principal visible;
2. pocos clics;
3. controles grandes;
4. estados claros;
5. reducción de errores;
6. escritorio y móvil;
7. carga, vacío, error y deshabilitado.

## Verificación

Ejecuta solo comandos que existan y sean pertinentes, como:

- lint;
- typecheck;
- tests;
- build.

Al terminar informa:

1. resultado;
2. archivos modificados;
3. migraciones;
4. verificaciones;
5. riesgos o pendientes reales.
- No anuncies el plan de ejecución.
- No describas los pasos que vas a realizar.
- Empieza directamente por la implementación o la inspección necesaria.
- Al finalizar, responde únicamente con:
  - archivos modificados;
  - verificaciones ejecutadas;
  - errores encontrados (si existen);
  - siguiente paso recomendado (si aplica).
