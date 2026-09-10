create table if not exists public.app_modules (
  key text primary key,
  parent_key text references public.app_modules(key) on delete cascade,
  name text not null,
  route text not null,
  icon text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  permission_module_keys text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_modules_key_format check (key ~ '^[a-z0-9_.\\-]+$')
);

create index if not exists app_modules_parent_sort_idx
  on public.app_modules(parent_key, sort_order);

create table if not exists public.app_user_module_access (
  user_id uuid not null references public.profiles(id) on delete cascade,
  module_key text not null references public.app_modules(key) on delete cascade,
  can_access boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  primary key (user_id, module_key)
);

create index if not exists app_user_module_access_module_idx
  on public.app_user_module_access(module_key);

insert into public.app_modules (key, parent_key, name, route, icon, sort_order, is_active, permission_module_keys)
values
  ('maestros', null, 'Maestros', '/panel/productos', 'Tags', 10, true, array['productos', 'categorias', 'marcas', 'proveedores', 'perfiles_conservacion']),
  ('pedidos', null, 'Pedidos', '/panel/pedidos/nuevo', 'ShoppingCart', 20, true, array['pedidos']),
  ('caja', null, 'Caja', '/panel/caja', 'Wallet', 30, true, array['caja']),
  ('gastos', null, 'Gastos', '/panel/gastos', 'HandCoins', 40, true, array['gastos']),
  ('cocina', null, 'Cocina', '/panel/cocina', 'ChefHat', 50, true, array['cocina']),
  ('compras', null, 'Compras', '/panel/compras', 'ReceiptText', 60, true, array['compras']),
  ('inventario', null, 'Inventario', '/panel/inventario', 'Package', 70, true, array['inventario']),
  ('menu', null, 'Menu', '/panel/menu/pizzas', 'Pizza', 80, true, array['menu']),
  ('marketing', null, 'Marketing', '/panel/marketing/pantallas', 'MonitorPlay', 90, true, array['marketing_pantallas', 'marketing_promociones']),
  ('produccion', null, 'Produccion', '/panel/produccion/registrar', 'Factory', 100, true, array['produccion']),
  ('configuracion', null, 'Configuracion', '/panel/configuracion', 'Settings', 110, true, array['configuracion', 'usuarios_permisos'])
on conflict (key) do update
  set parent_key = excluded.parent_key,
      name = excluded.name,
      route = excluded.route,
      icon = excluded.icon,
      sort_order = excluded.sort_order,
      is_active = excluded.is_active,
      permission_module_keys = excluded.permission_module_keys,
      updated_at = now();

insert into public.app_modules (key, parent_key, name, route, icon, sort_order, is_active, permission_module_keys)
values
  ('maestros.productos', 'maestros', 'Productos', '/panel/productos', 'Package', 11, true, array['productos']),
  ('maestros.categorias', 'maestros', 'Categorias', '/panel/categorias', 'Tags', 12, true, array['categorias']),
  ('maestros.marcas', 'maestros', 'Marcas', '/panel/marcas', 'Tags', 13, true, array['marcas']),
  ('maestros.proveedores', 'maestros', 'Proveedores', '/panel/proveedores', 'Truck', 14, true, array['proveedores']),
  ('maestros.perfiles_conservacion', 'maestros', 'Perfiles de conservacion', '/panel/perfiles-conservacion', 'Thermometer', 15, true, array['perfiles_conservacion']),
  ('pedidos.crear', 'pedidos', 'Crear pedido', '/panel/pedidos/nuevo', 'ShoppingCart', 21, true, array['pedidos']),
  ('pedidos.listado', 'pedidos', 'Listado de pedidos', '/panel/pedidos', 'ClipboardList', 22, true, array['pedidos']),
  ('caja.estado', 'caja', 'Estado / Apertura', '/panel/caja', 'Wallet', 31, true, array['caja']),
  ('caja.movimientos', 'caja', 'Movimientos', '/panel/caja/movimientos', 'ReceiptText', 32, true, array['caja']),
  ('caja.cierre', 'caja', 'Cierre de caja', '/panel/caja/cierre', 'Banknote', 33, true, array['caja']),
  ('gastos.gastos', 'gastos', 'Gastos', '/panel/gastos', 'HandCoins', 41, true, array['gastos']),
  ('gastos.categorias', 'gastos', 'Categorias de gasto', '/panel/gastos/categorias', 'Tags', 42, true, array['gastos']),
  ('cocina.pedidos', 'cocina', 'Pedidos en cocina', '/panel/cocina', 'ChefHat', 51, true, array['cocina']),
  ('menu.pizzas', 'menu', 'Recetas', '/panel/menu/pizzas', 'Pizza', 81, true, array['menu']),
  ('menu.precios_pizzas', 'menu', 'Precios de pizzas', '/panel/menu/precios/pizzas', 'ReceiptText', 82, true, array['menu']),
  ('menu.precios_productos', 'menu', 'Precios de productos', '/panel/menu/precios/productos', 'Package', 83, true, array['menu']),
  ('menu.precios_adiciones', 'menu', 'Adiciones', '/panel/menu/precios/adiciones', 'Plus', 84, true, array['menu']),
  ('marketing.pantallas', 'marketing', 'Pantallas', '/panel/marketing/pantallas', 'MonitorPlay', 91, true, array['marketing_pantallas']),
  ('marketing.promociones', 'marketing', 'Promociones', '/panel/marketing/promociones', 'Megaphone', 92, true, array['marketing_promociones']),
  ('produccion.registrar', 'produccion', 'Producciones', '/panel/produccion/registrar', 'Plus', 101, true, array['produccion']),
  ('produccion.recetas', 'produccion', 'Recetas', '/panel/produccion', 'ReceiptText', 102, true, array['produccion']),
  ('configuracion.usuarios', 'configuracion', 'Usuarios y permisos', '/panel/configuracion', 'UserCog', 111, true, array['usuarios_permisos']),
  ('configuracion.cocina', 'configuracion', 'Cocina', '/panel/configuracion/cocina', 'ChefHat', 112, true, array['configuracion'])
on conflict (key) do update
  set parent_key = excluded.parent_key,
      name = excluded.name,
      route = excluded.route,
      icon = excluded.icon,
      sort_order = excluded.sort_order,
      is_active = excluded.is_active,
      permission_module_keys = excluded.permission_module_keys,
      updated_at = now();

insert into public.app_user_module_access (user_id, module_key, can_access)
select distinct profiles.id, access_map.module_key, true
from public.profiles
join public.user_roles on user_roles.user_id = profiles.id
cross join lateral (
  values
    ('gerente'::public.app_role, 'maestros'),
    ('gerente'::public.app_role, 'pedidos'),
    ('gerente'::public.app_role, 'caja'),
    ('gerente'::public.app_role, 'gastos'),
    ('gerente'::public.app_role, 'cocina'),
    ('gerente'::public.app_role, 'compras'),
    ('gerente'::public.app_role, 'inventario'),
    ('gerente'::public.app_role, 'menu'),
    ('gerente'::public.app_role, 'marketing'),
    ('gerente'::public.app_role, 'produccion'),
    ('gerente'::public.app_role, 'configuracion'),
    ('vendedor'::public.app_role, 'pedidos'),
    ('vendedor'::public.app_role, 'caja'),
    ('mesero'::public.app_role, 'pedidos'),
    ('cocina'::public.app_role, 'cocina')
) as access_map(role, module_key)
where profiles.account_type = 'staff'
  and user_roles.role = access_map.role
on conflict (user_id, module_key) do nothing;

delete from public.app_user_module_access
using public.profiles
where app_user_module_access.user_id = profiles.id
  and profiles.account_type = 'client';

create or replace function public.current_user_can_access_module(p_module_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with current_profile as (
    select id, coalesce(is_active, true) as is_active, account_type
    from public.profiles
    where id = (select auth.uid())
  )
  select exists(select 1 from current_profile where is_active and account_type = 'staff')
    and exists(select 1 from public.app_modules where key = p_module_key and is_active)
    and (
      app_private.is_admin_sistema()
      or exists (
        select 1
        from public.app_user_module_access
        where user_id = (select auth.uid())
          and module_key = p_module_key
          and can_access
      )
    );
$$;

create or replace function public.current_user_module_keys()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select app_modules.key
  from public.app_modules
  where app_modules.parent_key is null
    and app_modules.is_active
    and public.current_user_can_access_module(app_modules.key)
  order by app_modules.sort_order, app_modules.name;
$$;

create or replace function public.admin_set_user_module_access(
  p_user_id uuid,
  p_module_keys text[]
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
  target_is_admin boolean;
  target_account_type text;
begin
  if actor is null or not app_private.is_admin_sistema() then
    raise exception 'Solo admin_sistema puede administrar accesos a modulos.';
  end if;
  if p_user_id is null or not exists(select 1 from public.profiles where id = p_user_id) then
    raise exception 'Usuario no valido.';
  end if;

  select account_type
  into target_account_type
  from public.profiles
  where id = p_user_id;

  select exists(select 1 from public.user_roles where user_id = p_user_id and role = 'admin_sistema'::public.app_role)
  into target_is_admin;

  if target_is_admin then
    return;
  end if;

  select coalesce(jsonb_agg(module_key order by module_key), '[]'::jsonb)
  into previous_value
  from public.app_user_module_access
  where user_id = p_user_id
    and can_access;

  delete from public.app_user_module_access
  where user_id = p_user_id
    and module_key in (select key from public.app_modules where parent_key is null);

  if target_account_type = 'staff' then
    insert into public.app_user_module_access (user_id, module_key, can_access, updated_by)
    select p_user_id, app_modules.key, true, actor
    from public.app_modules
    where app_modules.parent_key is null
      and app_modules.is_active
      and app_modules.key = any(coalesce(p_module_keys, '{}'))
    on conflict (user_id, module_key) do update
      set can_access = excluded.can_access,
          updated_at = now(),
          updated_by = actor;
  end if;

  select coalesce(jsonb_agg(module_key order by module_key), '[]'::jsonb)
  into next_value
  from public.app_user_module_access
  where user_id = p_user_id
    and can_access;

  insert into public.user_admin_audit_log (actor_id, target_user_id, action, previous_value, new_value)
  values (actor, p_user_id, 'set_user_module_access', previous_value, next_value);
end;
$$;

create or replace function public.current_user_has_permission(p_permission_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with current_profile as (
    select id, coalesce(is_active, true) as is_active, account_type
    from public.profiles
    where id = (select auth.uid())
  ),
  permission_row as (
    select module_key
    from public.app_permissions
    where code = p_permission_code
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
  ),
  module_allowed as (
    select 1
    from permission_row
    join public.app_modules on permission_row.module_key = any(app_modules.permission_module_keys)
    where public.current_user_can_access_module(app_modules.key)
  )
  select exists(select 1 from current_profile where is_active and account_type = 'staff')
    and not exists(select 1 from denied)
    and (
      app_private.is_admin_sistema()
      or (
        exists(select 1 from module_allowed)
        and (exists(select 1 from allowed) or exists(select 1 from role_allowed))
      )
    );
$$;

create or replace function public.admin_update_user_profile(
  p_user_id uuid,
  p_full_name text,
  p_phone text,
  p_is_active boolean,
  p_account_type text default null
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
  next_account_type text;
begin
  if actor is null or not app_private.is_admin_sistema() then
    raise exception 'Solo admin_sistema puede administrar usuarios.';
  end if;
  if p_user_id is null or not exists(select 1 from public.profiles where id = p_user_id) then
    raise exception 'Usuario no valido.';
  end if;

  select coalesce(p_account_type, account_type)
  into next_account_type
  from public.profiles
  where id = p_user_id;

  if next_account_type not in ('staff', 'client') then
    raise exception 'Tipo de usuario no valido.';
  end if;
  if actor = p_user_id and (not coalesce(p_is_active, true) or next_account_type <> 'staff') then
    raise exception 'No puedes desactivar tu propio usuario ni convertirte en cliente.';
  end if;
  if (
      not coalesce(p_is_active, true)
      or next_account_type <> 'staff'
    )
    and exists(select 1 from public.user_roles where user_id = p_user_id and role = 'admin_sistema'::public.app_role) then
    select count(distinct user_roles.user_id)
    into active_admins
    from public.user_roles
    join public.profiles on profiles.id = user_roles.user_id
    where user_roles.role = 'admin_sistema'::public.app_role
      and coalesce(profiles.is_active, true)
      and profiles.account_type = 'staff';

    if active_admins <= 1 then
      raise exception 'No se puede desactivar o convertir el ultimo administrador activo.';
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
      account_type = next_account_type,
      updated_at = now()
  where id = p_user_id;

  if next_account_type = 'client' then
    delete from public.user_roles where user_id = p_user_id;
    delete from public.app_user_permission_overrides where user_id = p_user_id;
    delete from public.app_user_module_access where user_id = p_user_id;
  end if;

  select to_jsonb(profiles.*)
  into next_value
  from public.profiles
  where id = p_user_id;

  insert into public.user_admin_audit_log (actor_id, target_user_id, action, previous_value, new_value)
  values (actor, p_user_id, 'update_user_profile', previous_value, next_value);
end;
$$;

alter table public.app_modules enable row level security;
alter table public.app_user_module_access enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_modules' and policyname = 'Admins can manage app modules') then
    create policy "Admins can manage app modules" on public.app_modules
      for all to authenticated
      using (app_private.is_admin_sistema())
      with check (app_private.is_admin_sistema());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_user_module_access' and policyname = 'Admins can manage user module access') then
    create policy "Admins can manage user module access" on public.app_user_module_access
      for all to authenticated
      using (app_private.is_admin_sistema())
      with check (app_private.is_admin_sistema());
  end if;
end;
$$;

grant select, insert, update, delete on public.app_modules to authenticated;
grant select, insert, update, delete on public.app_user_module_access to authenticated;

revoke all on function public.current_user_can_access_module(text) from public;
revoke all on function public.current_user_module_keys() from public;
revoke all on function public.admin_set_user_module_access(uuid, text[]) from public;
revoke all on function public.current_user_has_permission(text) from public;
revoke all on function public.admin_update_user_profile(uuid, text, text, boolean, text) from public;

grant execute on function public.current_user_can_access_module(text) to authenticated;
grant execute on function public.current_user_module_keys() to authenticated;
grant execute on function public.admin_set_user_module_access(uuid, text[]) to authenticated;
grant execute on function public.current_user_has_permission(text) to authenticated;
grant execute on function public.admin_update_user_profile(uuid, text, text, boolean, text) to authenticated;
