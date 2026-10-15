---
name: modo-productos
description: Cambios del catálogo maestro de ingredientes, venta e insumos.
---

# Productos

- Tipos: ingrediente, producto para venta e insumo; respetar contratos con Compras, Inventario y Preparaciones.
- Listado principal; filtros compactos; alta/edición en modal; ver/editar/eliminar; ocultar código interno.
- Antes de eliminar, verificar dependencias y bloquear uso activo.
- Marca opcional en ingredientes; otros tipos según lógica vigente; imagen opcional en Supabase Storage.
- Permitir crear categoría en modal secundario sin perder datos; autoseleccionar creada.
- SKU comercial en Compras, no en producto maestro.
- Para cambios visuales usar `modo-ui` sin duplicar validadores.
