alter table public.profiles
  add column if not exists email text,
  add column if not exists is_active boolean not null default true,
  add column if not exists last_seen_at timestamptz;

update public.profiles
set is_active = true
where is_active is null;

create table if not exists public.app_roles (
  role public.app_role primary key,
  name text not null,
  description text,
  is_active boolean not null default true,
  is_system boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_permissions (
  code text primary key,
  module_key text not null,
  module_label text not null,
  action_key text not null,
  action_label text not null,
  is_critical boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.app_role_permissions (
  role public.app_role not null references public.app_roles(role) on delete cascade,
  permission_code text not null references public.app_permissions(code) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (role, permission_code)
);

create type public.permission_override_effect as enum ('allow', 'deny');

create table if not exists public.app_user_permission_overrides (
  user_id uuid not null references public.profiles(id) on delete cascade,
  permission_code text not null references public.app_permissions(code) on delete cascade,
  effect public.permission_override_effect not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  primary key (user_id, permission_code)
);

create table if not exists public.user_admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  target_user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  previous_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

insert into public.app_roles (role, name, description, is_active, is_system)
values
  ('admin_sistema', 'Administrador del sistema', 'Acceso total permanente al sistema.', true, true),
  ('gerente', 'Gerente', 'Administra operacion, maestros, compras, inventario, menu y produccion.', true, true),
  ('vendedor', 'Caja', 'Gestiona caja, pedidos y cobros.', true, true),
  ('cocina', 'Cocina', 'Opera pedidos en cocina.', true, true),
  ('mesero', 'Mesero', 'Registra pedidos de mesa o mostrador.', true, true),
  ('mensajero', 'Mensajero', 'Consulta entregas asignadas cuando aplique.', true, true),
  ('cliente', 'Cliente', 'Rol reservado para clientes.', true, true)
on conflict (role) do update
  set name = excluded.name,
      description = excluded.description,
      is_system = true,
      updated_at = now();

insert into public.app_permissions (code, module_key, module_label, action_key, action_label, is_critical, sort_order)
values
  ('pedidos.view', 'pedidos', 'Pedidos / Caja', 'view', 'Ver', false, 10),
  ('pedidos.create', 'pedidos', 'Pedidos / Caja', 'create', 'Crear', false, 11),
  ('pedidos.edit', 'pedidos', 'Pedidos / Caja', 'edit', 'Editar', false, 12),
  ('pedidos.cancel', 'pedidos', 'Pedidos / Caja', 'cancel', 'Cancelar', false, 13),
  ('cocina.view', 'cocina', 'Cocina', 'view', 'Ver', false, 20),
  ('cocina.change_status', 'cocina', 'Cocina', 'change_status', 'Cambiar estado', false, 21),
  ('compras.view', 'compras', 'Compras', 'view', 'Ver', false, 30),
  ('compras.create', 'compras', 'Compras', 'create', 'Crear', false, 31),
  ('compras.edit', 'compras', 'Compras', 'edit', 'Editar', false, 32),
  ('compras.delete', 'compras', 'Compras', 'delete', 'Eliminar', false, 33),
  ('inventario.view', 'inventario', 'Inventario', 'view', 'Ver', false, 40),
  ('inventario.adjust', 'inventario', 'Inventario', 'adjust', 'Ajustar', false, 41),
  ('productos.view', 'productos', 'Productos', 'view', 'Ver', false, 50),
  ('productos.create', 'productos', 'Productos', 'create', 'Crear', false, 51),
  ('productos.edit', 'productos', 'Productos', 'edit', 'Editar', false, 52),
  ('productos.delete', 'productos', 'Productos', 'delete', 'Eliminar', false, 53),
  ('menu.view', 'menu', 'Menu', 'view', 'Ver', false, 60),
  ('menu.create', 'menu', 'Menu', 'create', 'Crear', false, 61),
  ('menu.edit', 'menu', 'Menu', 'edit', 'Editar', false, 62),
  ('menu.delete', 'menu', 'Menu', 'delete', 'Eliminar', false, 63),
  ('produccion.view', 'produccion', 'Produccion', 'view', 'Ver', false, 70),
  ('produccion.create', 'produccion', 'Produccion', 'create', 'Crear', false, 71),
  ('produccion.edit', 'produccion', 'Produccion', 'edit', 'Editar', false, 72),
  ('produccion.delete', 'produccion', 'Produccion', 'delete', 'Eliminar', false, 73),
  ('configuracion.view', 'configuracion', 'Configuracion', 'view', 'Ver', false, 80),
  ('configuracion.edit', 'configuracion', 'Configuracion', 'edit', 'Editar', false, 81),
  ('usuarios_permisos.view', 'usuarios_permisos', 'Usuarios y permisos', 'view', 'Ver', true, 90),
  ('usuarios_permisos.manage', 'usuarios_permisos', 'Usuarios y permisos', 'manage', 'Administrar', true, 91)
on conflict (code) do update
  set module_key = excluded.module_key,
      module_label = excluded.module_label,
      action_key = excluded.action_key,
      action_label = excluded.action_label,
      is_critical = excluded.is_critical,
      sort_order = excluded.sort_order;

insert into public.app_role_permissions (role, permission_code)
select 'admin_sistema'::public.app_role, code
from public.app_permissions
on conflict do nothing;

insert into public.app_role_permissions (role, permission_code)
select 'gerente'::public.app_role, code
from public.app_permissions
where code not like 'usuarios_permisos.%'
on conflict do nothing;

insert into public.app_role_permissions (role, permission_code)
values
  ('vendedor', 'pedidos.view'),
  ('vendedor', 'pedidos.create'),
  ('vendedor', 'pedidos.cancel'),
  ('mesero', 'pedidos.view'),
  ('mesero', 'pedidos.create'),
  ('cocina', 'cocina.view'),
  ('cocina', 'cocina.change_status')
on conflict do nothing;

create or replace function app_private.is_admin_sistema()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles
    join public.profiles on profiles.id = user_roles.user_id
    where user_roles.user_id = (select auth.uid())
      and user_roles.role = 'admin_sistema'::public.app_role
      and coalesce(profiles.is_active, true)
  );
$$;

create or replace function public.current_user_has_permission(p_permission_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with current_profile as (
    select id, coalesce(is_active, true) as is_active
    from public.profiles
    where id = (select auth.uid())
  ),
  denied as (
    select 1
    from public.app_user_permission_overrides
    where user_id = (select auth.uid())
      and permission_code = p_permission_code
      and effect = 'deny'::public.permission_override_effect
  ),
  allowed as (
    select 1
    from public.app_user_permission_overrides
    where user_id = (select auth.uid())
      and permission_code = p_permission_code
      and effect = 'allow'::public.permission_override_effect
  ),
  role_allowed as (
    select 1
    from public.user_roles
    join public.app_roles on app_roles.role = user_roles.role and app_roles.is_active
    join public.app_role_permissions on app_role_permissions.role = user_roles.role
    where user_roles.user_id = (select auth.uid())
      and app_role_permissions.permission_code = p_permission_code
  )
  select exists(select 1 from current_profile where is_active)
    and not exists(select 1 from denied)
    and (
      app_private.is_admin_sistema()
      or exists(select 1 from allowed)
      or exists(select 1 from role_allowed)
    );
$$;

create or replace function public.admin_set_user_roles(p_user_id uuid, p_roles public.app_role[])
returns void
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  actor uuid := auth.uid();
  previous_roles jsonb;
  next_roles jsonb;
  active_admins integer;
  target_is_admin boolean;
begin
  if actor is null or not app_private.is_admin_sistema() then
    raise exception 'Solo admin_sistema puede administrar roles.';
  end if;
  if p_user_id is null or not exists(select 1 from public.profiles where id = p_user_id) then
    raise exception 'Usuario no valido.';
  end if;
  if p_roles is null or coalesce(array_length(p_roles, 1), 0) = 0 then
    raise exception 'Selecciona al menos un rol.';
  end if;
  if actor = p_user_id and not ('admin_sistema'::public.app_role = any(p_roles)) then
    raise exception 'No puedes quitarte tu propio rol admin_sistema.';
  end if;

  select exists(select 1 from public.user_roles where user_id = p_user_id and role = 'admin_sistema'::public.app_role)
  into target_is_admin;

  if target_is_admin and not ('admin_sistema'::public.app_role = any(p_roles)) then
    select count(distinct user_roles.user_id)
    into active_admins
    from public.user_roles
    join public.profiles on profiles.id = user_roles.user_id
    where user_roles.role = 'admin_sistema'::public.app_role
      and coalesce(profiles.is_active, true);

    if active_admins <= 1 then
      raise exception 'No se puede eliminar el ultimo administrador activo.';
    end if;
  end if;

  select coalesce(jsonb_agg(role::text order by role::text), '[]'::jsonb)
  into previous_roles
  from public.user_roles
  where user_id = p_user_id;

  delete from public.user_roles
  where user_id = p_user_id
    and not (role = any(p_roles));

  insert into public.user_roles (user_id, role)
  select p_user_id, unnest(p_roles)
  on conflict do nothing;

  select coalesce(jsonb_agg(role::text order by role::text), '[]'::jsonb)
  into next_roles
  from public.user_roles
  where user_id = p_user_id;

  insert into public.user_admin_audit_log (actor_id, target_user_id, action, previous_value, new_value)
  values (actor, p_user_id, 'set_user_roles', previous_roles, next_roles);
end;
$$;

create or replace function public.admin_update_user_profile(
  p_user_id uuid,
  p_full_name text,
  p_phone text,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  actor uuid := auth.uid();
  previous_value jsonb;
  next_value jsonb;
  active_admins integer;
begin
  if actor is null or not app_private.is_admin_sistema() then
    raise exception 'Solo admin_sistema puede administrar usuarios.';
  end if;
  if p_user_id is null or not exists(select 1 from public.profiles where id = p_user_id) then
    raise exception 'Usuario no valido.';
  end if;
  if actor = p_user_id and not coalesce(p_is_active, true) then
    raise exception 'No puedes desactivar tu propio usuario.';
  end if;
  if not coalesce(p_is_active, true)
    and exists(select 1 from public.user_roles where user_id = p_user_id and role = 'admin_sistema'::public.app_role) then
    select count(distinct user_roles.user_id)
    into active_admins
    from public.user_roles
    join public.profiles on profiles.id = user_roles.user_id
    where user_roles.role = 'admin_sistema'::public.app_role
      and coalesce(profiles.is_active, true);

    if active_admins <= 1 then
      raise exception 'No se puede desactivar el ultimo administrador activo.';
    end if;
  end if;

  select to_jsonb(profiles.*)
  into previous_value
  from public.profiles
  where id = p_user_id;

  update public.profiles
  set full_name = nullif(btrim(p_full_name), ''),
      phone = nullif(btrim(p_phone), ''),
      is_active = coalesce(p_is_active, true),
      updated_at = now()
  where id = p_user_id;

  select to_jsonb(profiles.*)
  into next_value
  from public.profiles
  where id = p_user_id;

  insert into public.user_admin_audit_log (actor_id, target_user_id, action, previous_value, new_value)
  values (actor, p_user_id, 'update_user_profile', previous_value, next_value);
end;
$$;

create or replace function public.admin_save_role_permissions(
  p_role public.app_role,
  p_permission_codes text[]
)
returns void
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  actor uuid := auth.uid();
  previous_value jsonb;
  next_value jsonb;
begin
  if actor is null or not app_private.is_admin_sistema() then
    raise exception 'Solo admin_sistema puede administrar permisos.';
  end if;
  if p_role is null or not exists(select 1 from public.app_roles where role = p_role) then
    raise exception 'Rol no valido.';
  end if;
  if p_role = 'admin_sistema'::public.app_role then
    p_permission_codes := array(select code from public.app_permissions);
  end if;

  select coalesce(jsonb_agg(permission_code order by permission_code), '[]'::jsonb)
  into previous_value
  from public.app_role_permissions
  where role = p_role;

  delete from public.app_role_permissions
  where role = p_role;

  insert into public.app_role_permissions (role, permission_code)
  select p_role, input.permission_code
  from unnest(coalesce(p_permission_codes, '{}')) as input(permission_code)
  join public.app_permissions on app_permissions.code = input.permission_code
  on conflict do nothing;

  select coalesce(jsonb_agg(permission_code order by permission_code), '[]'::jsonb)
  into next_value
  from public.app_role_permissions
  where role = p_role;

  insert into public.user_admin_audit_log (actor_id, action, previous_value, new_value)
  values (actor, 'save_role_permissions:' || p_role::text, previous_value, next_value);
end;
$$;

create or replace function public.admin_save_user_permission_overrides(
  p_user_id uuid,
  p_allow text[],
  p_deny text[]
)
returns void
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  actor uuid := auth.uid();
  previous_value jsonb;
  next_value jsonb;
begin
  if actor is null or not app_private.is_admin_sistema() then
    raise exception 'Solo admin_sistema puede administrar permisos.';
  end if;
  if p_user_id is null or not exists(select 1 from public.profiles where id = p_user_id) then
    raise exception 'Usuario no valido.';
  end if;
  if actor = p_user_id and exists(select 1 from unnest(coalesce(p_deny, '{}')) code where code like 'usuarios_permisos.%') then
    raise exception 'No puedes bloquear tus propios permisos de administracion.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('permission_code', permission_code, 'effect', effect) order by permission_code), '[]'::jsonb)
  into previous_value
  from public.app_user_permission_overrides
  where user_id = p_user_id;

  delete from public.app_user_permission_overrides
  where user_id = p_user_id;

  insert into public.app_user_permission_overrides (user_id, permission_code, effect, updated_by)
  select p_user_id, input.permission_code, 'allow'::public.permission_override_effect, actor
  from unnest(coalesce(p_allow, '{}')) as input(permission_code)
  join public.app_permissions on app_permissions.code = input.permission_code
  on conflict do nothing;

  insert into public.app_user_permission_overrides (user_id, permission_code, effect, updated_by)
  select p_user_id, input.permission_code, 'deny'::public.permission_override_effect, actor
  from unnest(coalesce(p_deny, '{}')) as input(permission_code)
  join public.app_permissions on app_permissions.code = input.permission_code
  on conflict (user_id, permission_code) do update
    set effect = excluded.effect,
        updated_at = now(),
        updated_by = actor;

  select coalesce(jsonb_agg(jsonb_build_object('permission_code', permission_code, 'effect', effect) order by permission_code), '[]'::jsonb)
  into next_value
  from public.app_user_permission_overrides
  where user_id = p_user_id;

  insert into public.user_admin_audit_log (actor_id, target_user_id, action, previous_value, new_value)
  values (actor, p_user_id, 'save_user_permission_overrides', previous_value, next_value);
end;
$$;

create or replace function app_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, phone)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    new.raw_user_meta_data ->> 'phone'
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = excluded.full_name,
        phone = excluded.phone,
        updated_at = now();

  if not exists (select 1 from public.user_roles) then
    insert into public.user_roles (user_id, role)
    values
      (new.id, 'admin_sistema'),
      (new.id, 'gerente')
    on conflict (user_id, role) do nothing;
  else
    insert into public.user_roles (user_id, role)
    values (new.id, 'cliente')
    on conflict (user_id, role) do nothing;
  end if;

  return new;
end;
$$;

alter table public.app_roles enable row level security;
alter table public.app_permissions enable row level security;
alter table public.app_role_permissions enable row level security;
alter table public.app_user_permission_overrides enable row level security;
alter table public.user_admin_audit_log enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_roles' and policyname = 'Admins can manage app roles') then
    create policy "Admins can manage app roles" on public.app_roles
      for all to authenticated
      using (app_private.is_admin_sistema())
      with check (app_private.is_admin_sistema());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_permissions' and policyname = 'Admins can read app permissions') then
    create policy "Admins can read app permissions" on public.app_permissions
      for select to authenticated
      using (app_private.is_admin_sistema());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_role_permissions' and policyname = 'Admins can manage role permissions') then
    create policy "Admins can manage role permissions" on public.app_role_permissions
      for all to authenticated
      using (app_private.is_admin_sistema())
      with check (app_private.is_admin_sistema());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_user_permission_overrides' and policyname = 'Admins can manage user overrides') then
    create policy "Admins can manage user overrides" on public.app_user_permission_overrides
      for all to authenticated
      using (app_private.is_admin_sistema())
      with check (app_private.is_admin_sistema());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_admin_audit_log' and policyname = 'Admins can read audit log') then
    create policy "Admins can read audit log" on public.user_admin_audit_log
      for select to authenticated
      using (app_private.is_admin_sistema());
  end if;
end;
$$;

grant select, insert, update, delete on public.app_roles to authenticated;
grant select on public.app_permissions to authenticated;
grant select, insert, update, delete on public.app_role_permissions to authenticated;
grant select, insert, update, delete on public.app_user_permission_overrides to authenticated;
grant select, insert on public.user_admin_audit_log to authenticated;

revoke all on function app_private.is_admin_sistema() from public;
grant execute on function app_private.is_admin_sistema() to authenticated;

revoke all on function public.current_user_has_permission(text) from public;
revoke all on function public.admin_set_user_roles(uuid, public.app_role[]) from public;
revoke all on function public.admin_update_user_profile(uuid, text, text, boolean) from public;
revoke all on function public.admin_save_role_permissions(public.app_role, text[]) from public;
revoke all on function public.admin_save_user_permission_overrides(uuid, text[], text[]) from public;

grant execute on function public.current_user_has_permission(text) to authenticated;
grant execute on function public.admin_set_user_roles(uuid, public.app_role[]) to authenticated;
grant execute on function public.admin_update_user_profile(uuid, text, text, boolean) to authenticated;
grant execute on function public.admin_save_role_permissions(public.app_role, text[]) to authenticated;
grant execute on function public.admin_save_user_permission_overrides(uuid, text[], text[]) to authenticated;
