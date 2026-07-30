create table if not exists public.conservation_profile_sku_reservations (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  created_at timestamptz not null default now()
);

alter table public.conservation_profile_sku_reservations enable row level security;

alter table public.conservation_profiles add column if not exists sku text;
alter table public.conservation_profiles add column if not exists sort_order integer not null default 1 check (sort_order >= 0);
alter table public.conservation_profiles add column if not exists temperature_min numeric(6, 2);
alter table public.conservation_profiles add column if not exists temperature_max numeric(6, 2);

create extension if not exists unaccent with schema extensions;

create or replace function public.reserve_conservation_profile_sku(p_name text)
returns text
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  candidate_base text;
  candidate text;
  suffix_number integer := 0;
begin
  candidate_base := 'PC' || app_private.menu_sku_stem(p_name);

  loop
    candidate := candidate_base || case when suffix_number = 0 then '' else lpad(suffix_number::text, 2, '0') end;
    begin
      insert into public.conservation_profile_sku_reservations (sku) values (candidate);
      return candidate;
    exception when unique_violation then
      suffix_number := suffix_number + 1;
    end;
  end loop;
end;
$$;

do $$
declare
  item record;
begin
  insert into public.conservation_profile_sku_reservations (sku)
  select sku from public.conservation_profiles where sku is not null
  on conflict (sku) do nothing;

  for item in select id, name from public.conservation_profiles where sku is null order by created_at, id loop
    update public.conservation_profiles
    set sku = public.reserve_conservation_profile_sku(item.name)
    where id = item.id;
  end loop;
end $$;

with ordered as (
  select id, row_number() over (order by sort_order, created_at, id) as position
  from public.conservation_profiles
)
update public.conservation_profiles target
set sort_order = ordered.position
from ordered
where target.id = ordered.id;

alter table public.conservation_profiles alter column sku set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'conservation_profiles_sku_unique') then
    alter table public.conservation_profiles add constraint conservation_profiles_sku_unique unique (sku);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'conservation_profiles_sort_order_unique') then
    alter table public.conservation_profiles add constraint conservation_profiles_sort_order_unique unique (sort_order) deferrable initially immediate;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'conservation_profiles_temperature_range_check') then
    alter table public.conservation_profiles add constraint conservation_profiles_temperature_range_check
      check (temperature_min is null or temperature_max is null or temperature_min <= temperature_max);
  end if;
end $$;

create or replace function app_private.prevent_conservation_profile_sku_change()
returns trigger
language plpgsql
as $$
begin
  if old.sku is distinct from new.sku then
    raise exception 'El SKU no se puede modificar.';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_conservation_profile_sku_change on public.conservation_profiles;
create trigger prevent_conservation_profile_sku_change
  before update of sku on public.conservation_profiles
  for each row execute function app_private.prevent_conservation_profile_sku_change();

create or replace function public.move_conservation_profile(p_id uuid, p_direction text)
returns void
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  direction_delta integer;
begin
  if not app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]) then
    raise exception 'No tienes permiso para ordenar perfiles de conservacion.';
  end if;

  direction_delta := case p_direction when 'up' then -1 when 'down' then 1 else 0 end;
  if direction_delta = 0 then
    raise exception 'Direccion no valida.';
  end if;

  lock table public.conservation_profiles in exclusive mode;

  with ordered as (
    select id,
      row_number() over (order by sort_order, created_at, id)::integer as position,
      count(*) over ()::integer as total_rows
    from public.conservation_profiles
  ),
  target as (
    select position, total_rows from ordered where id = p_id
  ),
  moved as (
    select ordered.id,
      case
        when ordered.id = p_id then least((select total_rows from target), greatest(1, ordered.position + direction_delta))
        when direction_delta = -1 and ordered.position = (select position from target) - 1 then ordered.position + 1
        when direction_delta = 1 and ordered.position = (select position from target) + 1 then ordered.position - 1
        else ordered.position
      end as position
    from ordered
  )
  update public.conservation_profiles profile
  set sort_order = moved.position, updated_at = now()
  from moved
  where profile.id = moved.id;
end;
$$;

create or replace function public.delete_conservation_profile(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  preparation_count integer;
  production_count integer;
begin
  if not app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]) then
    raise exception 'No tienes permiso para eliminar perfiles de conservacion.';
  end if;

  select count(*) into preparation_count
  from public.preparations
  where conservation_profile_id = p_id;

  select count(*) into production_count
  from public.productions production
  join public.preparations preparation on preparation.id = production.preparation_id
  where preparation.conservation_profile_id = p_id;

  if preparation_count > 0 or production_count > 0 then
    raise exception 'No se puede eliminar este perfil porque esta siendo utilizado en %.',
      concat_ws(' y ',
        case when preparation_count > 0 then 'Preparaciones' end,
        case when production_count > 0 then 'Producciones' end
      );
  end if;

  delete from public.conservation_profiles where id = p_id;

  with ordered as (
    select id, row_number() over (order by sort_order, created_at, id) as position
    from public.conservation_profiles
  )
  update public.conservation_profiles profile
  set sort_order = ordered.position, updated_at = now()
  from ordered
  where profile.id = ordered.id;
end;
$$;

grant execute on function public.reserve_conservation_profile_sku(text) to authenticated;
grant execute on function public.move_conservation_profile(uuid, text) to authenticated;
grant execute on function public.delete_conservation_profile(uuid) to authenticated;

notify pgrst, 'reload schema';
