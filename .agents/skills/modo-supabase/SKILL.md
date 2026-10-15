---
name: modo-supabase
description: Cambios de migraciones, SQL, RLS y acceso Supabase.
---

# Supabase

- Si cambias esquema, consultar **si existen** `.agents/architecture/database.md` y `.agents/standards/sql.md`.
- Migraciones versionadas y compatibles con datos históricos.
- RLS/validación en servidor y BD; jamás `service_role` en cliente.
- SQL/transacciones para atomicidad; probar permisos permitidos/denegados.
- No aplicar cambios remotos sin autorización.
