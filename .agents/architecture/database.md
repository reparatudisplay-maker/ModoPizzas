# Arquitectura de base de datos

## Principios

- PostgreSQL en Supabase.
- Cambios mediante migraciones reproducibles.
- No editar producción como sustituto de una migración.
- No inventar nombres de tablas o columnas.
- Mantener claves foráneas y restricciones.

## Dinero

- No usar float.
- Usar `numeric` o unidad mínima según el modelo existente.
- Definir redondeo.
- Preservar históricos.

## Inventario

- Usar movimientos trazables.
- No alterar stock sin registrar causa.
- Mantener usuario, fecha, cantidad, unidad, referencia y motivo.

## RLS

Definir claramente acceso:

- público;
- autenticado;
- empleado;
- gerente;
- administrador.

Probar tanto acceso permitido como denegado.

## Índices

Agregar solo cuando respondan a consultas reales y frecuentes.
