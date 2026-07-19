---
name: modo-ui
description: Trabaja diseño, navegación, formularios, tablas, responsive, accesibilidad y modo oscuro de ModoPizzas.
---


# Modo UI

Consulta:

- `.agents/architecture/ui.md`
- `.agents/standards/ui.md`

Prioriza rapidez, legibilidad, pocos clics y consistencia.

Verifica:

- escritorio;
- móvil;
- claro;
- oscuro;
- carga;
- vacío;
- error;
- deshabilitado.

## Módulos Maestros

### Diseño

- No usar membrete superior.
- No mostrar correo del usuario.
- No usar tarjetas de resumen salvo que tengan utilidad operativa real.
- No mostrar descripciones introductorias innecesarias.
- Usar botón superior “Agregar”.
- Crear y editar mediante modal.
- Mantener filtros compactos y alineados.
- Mantener compatibilidad con escritorio y móvil.
- Reutilizar componentes existentes.

### Campos de Nombre

- Convertir a mayúsculas mientras se escribe.
- Normalizar espacios.
- Comparar ignorando mayúsculas, tildes y espacios adicionales.
- Excluir correos, URL, teléfonos, contraseñas, notas y campos donde las mayúsculas alteren el dato.

### Validador Antiduplicado

- Autocompletar mientras se escribe.
- Mostrar registros existentes como `NOMBRE — REGISTRADO ✕` con indicador rojo.
- Mostrar nombres nuevos como `NOMBRE — REGISTRABLE ✔` con indicador verde.
- Bloquear guardado ante duplicado.
- Deshabilitar botón guardar.
- Mostrar mensaje claro.
- Al editar, excluir el propio registro.
- Reutilizar una función compartida de normalización.
- No implementar validadores diferentes en cada módulo.

### Autocompletados

- Navegar con flechas arriba y abajo.
- Enter selecciona.
- Escape cierra.
- Mouse selecciona.
- Después de seleccionar, bloquear escritura.
- Mostrar X para limpiar y volver a escribir.
- Usar este patrón como predeterminado en todo el sistema.

### Modales Secundarios

- Si desde un formulario se crea una categoría, marca, proveedor u otro maestro:
  - abrir modal encima del formulario actual;
  - no redirigir;
  - conservar los datos ya escritos;
  - actualizar el selector;
  - seleccionar automáticamente el registro creado;
  - aplicar los mismos validadores del módulo maestro.

### Eliminación

- Pedir confirmación previa.
- Verificar relaciones antes de eliminar.
- No usar cascada para evitar validaciones.
- Informar en qué módulos está siendo usado.
- No perder datos relacionados.

### Filtros

- Búsqueda.
- Últimos 15.
- Últimos 30.
- Todos.
- Filtros adicionales según el módulo.
- Los filtros deben poder combinarse.
