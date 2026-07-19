---
name: modo-productos
description: Gestiona el módulo Productos como dato maestro para compras, inventario y recetas.
---

# Modo Productos

Productos es un dato maestro. Antes de modificarlo, lee `modo-ui` y revisa formulario, acciones, tipos y consultas relacionadas.

## Tipos

- Ingrediente.
- Producto para venta.
- Insumo.

## Diseño

- Usar listado como contenido principal.
- No mostrar membrete superior, correo del usuario, tarjetas de resumen ni textos introductorios innecesarios.
- Usar filtros compactos y diseño responsive.
- Crear y editar mediante modal.
- Mantener acciones de editar, ver y eliminar.
- No mostrar el código interno en el listado.

## Reglas Funcionales

- La eliminación debe ser segura: confirmar, verificar relaciones con otros módulos y bloquear si está en uso.
- La marca es opcional para ingredientes y se mantiene según la lógica actual para productos de venta e insumos.
- La categoría puede crearse desde un modal secundario sin cerrar el formulario Producto.
- La imagen es opcional y usa Supabase Storage.
- El SKU no pertenece al producto maestro; se genera en Compras para referencias comerciales.

## Validación

- Reutilizar los patrones de `modo-ui` para campos de nombre, autocompletado, duplicados y modales secundarios.
- No crear validadores paralelos para Productos si ya existe una utilidad compartida.
