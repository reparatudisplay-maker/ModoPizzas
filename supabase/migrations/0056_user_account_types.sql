alter table public.profiles
  add column if not exists account_type text not null default 'client';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_account_type_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_account_type_check
      check (account_type in ('staff', 'client'));
  end if;
end;
$$;

update public.profiles
set email = auth_users.email
from auth.users auth_users
where profiles.id = auth_users.id
  and (profiles.email is null or profiles.email = '');

update public.profiles
set account_type = case
  when exists (
    select 1
    from public.user_roles
    where user_roles.user_id = profiles.id
      and user_roles.role <> 'cliente'::public.app_role
  ) then 'staff'
  else 'client'
end;

delete from public.user_roles
where role = 'cliente'::public.app_role;

delete from public.app_role_permissions
where role = 'cliente'::public.app_role;

delete from public.app_roles
where role = 'cliente'::public.app_role;

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
    raise exception 'Selecciona al menos un rol interno.';
  end if;
  if 'cliente'::public.app_role = any(p_roles) then
    raise exception 'Cliente no es un rol administrativo.';
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
      and coalesce(profiles.is_active, true)
      and profiles.account_type = 'staff';

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

  update public.profiles
  set account_type = 'staff',
      updated_at = now()
  where id = p_user_id;

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
  end if;

  select to_jsonb(profiles.*)
  into next_value
  from public.profiles
  where id = p_user_id;

  insert into public.user_admin_audit_log (actor_id, target_user_id, action, previous_value, new_value)
  values (actor, p_user_id, 'update_user_profile', previous_value, next_value);
end;
$$;

create or replace function app_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, phone, account_type)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    new.raw_user_meta_data ->> 'phone',
    'client'
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(public.profiles.full_name, excluded.full_name),
        phone = coalesce(public.profiles.phone, excluded.phone),
        updated_at = now();

  if not exists (select 1 from public.user_roles) then
    update public.profiles
    set account_type = 'staff'
    where id = new.id;

    insert into public.user_roles (user_id, role)
    values
      (new.id, 'admin_sistema'),
      (new.id, 'gerente')
    on conflict (user_id, role) do nothing;
  end if;

  return new;
end;
$$;

revoke all on function public.admin_update_user_profile(uuid, text, text, boolean, text) from public;
grant execute on function public.admin_update_user_profile(uuid, text, text, boolean, text) to authenticated;
