create table if not exists public.menu_sku_reservations (
  id uuid primary key default gen_random_uuid(),
  section text not null check (section in ('menu_categories', 'pizza_sizes', 'pizza_flavors')),
  sku text not null unique,
  created_at timestamptz not null default now()
);

create extension if not exists unaccent with schema extensions;

alter table public.menu_categories add column if not exists sku text;
alter table public.pizza_sizes add column if not exists sku text;
alter table public.pizza_flavors add column if not exists sku text;
alter table public.pizza_flavors add column if not exists sort_order integer not null default 1 check (sort_order >= 0);

create or replace function app_private.menu_sku_stem(input_name text)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(
      left(
        regexp_replace(extensions.unaccent(upper(coalesce(input_name, ''))), '[^A-Z0-9]', '', 'g'),
        3
      ),
      ''
    ),
    'XXX'
  );
$$;

create or replace function public.reserve_menu_sku(p_section text, p_name text)
returns text
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  section_prefix text;
  candidate_base text;
  candidate text;
  suffix_number integer := 0;
begin
  section_prefix := case p_section
    when 'menu_categories' then 'CT'
    when 'pizza_flavors' then 'SB'
    when 'pizza_sizes' then 'TM'
    else null
  end;

  if section_prefix is null then
    raise exception 'Seccion de menu no valida.';
  end if;

  candidate_base := section_prefix || app_private.menu_sku_stem(p_name);

  loop
    candidate := candidate_base || case when suffix_number = 0 then '' else lpad(suffix_number::text, 2, '0') end;
    begin
      insert into public.menu_sku_reservations (section, sku) values (p_section, candidate);
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
  insert into public.menu_sku_reservations (section, sku)
  select 'menu_categories', sku from public.menu_categories where sku is not null
  on conflict (sku) do nothing;

  insert into public.menu_sku_reservations (section, sku)
  select 'pizza_sizes', sku from public.pizza_sizes where sku is not null
  on conflict (sku) do nothing;

  insert into public.menu_sku_reservations (section, sku)
  select 'pizza_flavors', sku from public.pizza_flavors where sku is not null
  on conflict (sku) do nothing;

  for item in select id, name from public.menu_categories where sku is null order by sort_order, created_at, id loop
    update public.menu_categories set sku = public.reserve_menu_sku('menu_categories', item.name) where id = item.id;
  end loop;

  for item in select id, name from public.pizza_sizes where sku is null order by sort_order, created_at, id loop
    update public.pizza_sizes set sku = public.reserve_menu_sku('pizza_sizes', item.name) where id = item.id;
  end loop;

  for item in select id, name from public.pizza_flavors where sku is null order by sort_order, created_at, id loop
    update public.pizza_flavors set sku = public.reserve_menu_sku('pizza_flavors', item.name) where id = item.id;
  end loop;
end $$;

with ordered as (
  select id, row_number() over (order by sort_order, created_at, id) as position
  from public.menu_categories
)
update public.menu_categories target
set sort_order = ordered.position
from ordered
where target.id = ordered.id;

with ordered as (
  select id, row_number() over (order by sort_order, created_at, id) as position
  from public.pizza_sizes
)
update public.pizza_sizes target
set sort_order = ordered.position
from ordered
where target.id = ordered.id;

with ordered as (
  select id, row_number() over (order by sort_order, created_at, id) as position
  from public.pizza_flavors
)
update public.pizza_flavors target
set sort_order = ordered.position
from ordered
where target.id = ordered.id;

alter table public.menu_categories alter column sku set not null;
alter table public.pizza_sizes alter column sku set not null;
alter table public.pizza_flavors alter column sku set not null;

alter table public.menu_categories alter column sort_order set default 1;
alter table public.pizza_sizes alter column sort_order set default 1;
alter table public.pizza_flavors alter column sort_order set default 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'menu_categories_sku_unique') then
    alter table public.menu_categories add constraint menu_categories_sku_unique unique (sku);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'pizza_sizes_sku_unique') then
    alter table public.pizza_sizes add constraint pizza_sizes_sku_unique unique (sku);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'pizza_flavors_sku_unique') then
    alter table public.pizza_flavors add constraint pizza_flavors_sku_unique unique (sku);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'menu_categories_sort_order_unique') then
    alter table public.menu_categories add constraint menu_categories_sort_order_unique unique (sort_order) deferrable initially immediate;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'pizza_sizes_sort_order_unique') then
    alter table public.pizza_sizes add constraint pizza_sizes_sort_order_unique unique (sort_order) deferrable initially immediate;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'pizza_flavors_sort_order_unique') then
    alter table public.pizza_flavors add constraint pizza_flavors_sort_order_unique unique (sort_order) deferrable initially immediate;
  end if;
end $$;

create or replace function app_private.prevent_menu_sku_change()
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

drop trigger if exists prevent_menu_categories_sku_change on public.menu_categories;
create trigger prevent_menu_categories_sku_change
  before update of sku on public.menu_categories
  for each row execute function app_private.prevent_menu_sku_change();

drop trigger if exists prevent_pizza_sizes_sku_change on public.pizza_sizes;
create trigger prevent_pizza_sizes_sku_change
  before update of sku on public.pizza_sizes
  for each row execute function app_private.prevent_menu_sku_change();

drop trigger if exists prevent_pizza_flavors_sku_change on public.pizza_flavors;
create trigger prevent_pizza_flavors_sku_change
  before update of sku on public.pizza_flavors
  for each row execute function app_private.prevent_menu_sku_change();

create or replace function public.move_menu_item(p_section text, p_id uuid, p_direction text)
returns void
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  target_table text;
  direction_delta integer;
begin
  if not app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]) then
    raise exception 'No tienes permiso para ordenar el menu.';
  end if;

  target_table := case p_section
    when 'menu_categories' then 'menu_categories'
    when 'pizza_sizes' then 'pizza_sizes'
    when 'pizza_flavors' then 'pizza_flavors'
    else null
  end;
  direction_delta := case p_direction when 'up' then -1 when 'down' then 1 else 0 end;
  if target_table is null or direction_delta = 0 then
    raise exception 'Ordenamiento no valido.';
  end if;

  execute format('lock table public.%I in exclusive mode', target_table);
  execute format($sql$
    with ordered as (
      select id,
        row_number() over (order by sort_order, created_at, id)::integer as position,
        count(*) over ()::integer as total_rows
      from public.%I
    ),
    target as (
      select position, total_rows from ordered where id = $1
    ),
    moved as (
      select ordered.id,
        case
          when ordered.id = $1 then least((select total_rows from target), greatest(1, ordered.position + $2))
          when $2 = -1 and ordered.position = (select position from target) - 1 then ordered.position + 1
          when $2 = 1 and ordered.position = (select position from target) + 1 then ordered.position - 1
          else ordered.position
        end as position
      from ordered
    )
    update public.%I item
    set sort_order = moved.position, updated_at = now()
    from moved
    where item.id = moved.id
  $sql$, target_table, target_table) using p_id, direction_delta;
end;
$$;

grant execute on function public.reserve_menu_sku(text, text) to authenticated;
grant execute on function public.move_menu_item(text, uuid, text) to authenticated;

notify pgrst, 'reload schema';
