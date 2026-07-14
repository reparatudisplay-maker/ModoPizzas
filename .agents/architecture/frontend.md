# Arquitectura frontend

## Principios

- Next.js App Router.
- Server Components por defecto cuando sea adecuado.
- Client Components solo para interacción, estado del navegador o APIs cliente.
- Separar presentación, datos y mutaciones.
- No filtrar secretos al cliente.
- Validar nuevamente en servidor.

## Organización

Antes de crear archivos, revisa la estructura real.

Preferir agrupación por módulo cuando el repositorio ya la use.

Evitar:

- componentes gigantes;
- lógica de negocio dentro de JSX;
- duplicación de formatos;
- formularios sin validación de servidor;
- consultas repetidas.

## Estado de interfaz

Toda vista relevante debe considerar:

- normal;
- carga;
- vacío;
- error;
- deshabilitado;
- éxito;
- datos largos;
- móvil.

## Rendimiento

- No cargar listados grandes completos.
- Usar filtros, paginación o búsqueda.
- Evitar cascadas de solicitudes.
- Evitar renders innecesarios.
- Priorizar rutas operativas:
  - pedidos;
  - cocina;
  - caja.
