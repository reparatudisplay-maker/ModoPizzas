---
name: modo-ui
description: Cambios de pantallas, formularios, modales, filtros y responsive.
---

# Ui

- Para cambios visuales amplios, consultar **si existen** `.agents/architecture/ui.md` y `.agents/standards/ui.md`.
- Reutilizar UI; revisar móvil/escritorio, claro/oscuro y estados de carga, vacío, error y deshabilitado según alcance.

## Maestros

- Listado como foco, sin membrete/correo/tarjetas/introducción innecesarias. Botón superior «Agregar»; filtros compactos; alta/edición en modal.
- Nombres de maestros en MAYÚSCULAS; normalizar espacios y comparar sin tildes, mayúsculas ni espacios extra. Excluir correo, URL, teléfono, contraseña y texto libre.
- Antiduplicados: sugerir `NOMBRE — REGISTRADO ✕` (rojo) o `NOMBRE — REGISTRABLE ✔` (verde); bloquear duplicados, excluir registro propio al editar; validador compartido.
- Autocompletado: ↑/↓, Enter, Escape y clic; tras elegir bloquear escritura; «X» para limpiar.
- Modal secundario para crear maestros vinculados: conservar formulario, actualizar selector y seleccionar creado.
- Eliminar con confirmación y validación de dependencias; informar uso, sin cascadas que evadan controles.
- Filtros combinables: búsqueda, «Últimos 15», «Últimos 30», «Todos» y específicos; preservar semántica actual.
