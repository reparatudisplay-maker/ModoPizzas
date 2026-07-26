alter table public.menu_sku_reservations drop constraint if exists menu_sku_reservations_section_check;
alter table public.menu_sku_reservations
  add constraint menu_sku_reservations_section_check
  check (section in ('menu_categories', 'pizza_sizes', 'pizza_flavors', 'pizza_additions'));

alter table public.pizza_additions add column if not exists sku text;
alter table public.pizza_additions add column if not exists sort_order integer not null default 1 check (sort_order >= 0);
alter table public.pizza_additions add column if not exists source_kind text not null default 'inventory_item';
alter table public.pizza_additions add column if not exists source_preparation_id uuid null references public.preparations(id) on delete restrict;

alter table public.pizza_additions alter column inventory_item_id drop not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pizza_additions_exact_source') then
    alter table public.pizza_additions
      add constraint pizza_additions_exact_source check (
        (source_kind = 'inventory_item' and inventory_item_id is not null and source_preparation_id is null)
        or
        (source_kind = 'preparation' and source_preparation_id is not null and inventory_item_id is null)
      );
  end if;
end $$;

alter table public.pizza_addition_sizes drop column if exists cost_cop;

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
    when 'pizza_additions' then 'AD'
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
  select 'pizza_additions', sku from public.pizza_additions where sku is not null
  on conflict (sku) do nothing;

  for item in select id, name from public.pizza_additions where sku is null order by created_at, id loop
    update public.pizza_additions set sku = public.reserve_menu_sku('pizza_additions', item.name) where id = item.id;
  end loop;
end $$;

with ordered as (
  select id, row_number() over (order by sort_order, created_at, id) as position
  from public.pizza_additions
)
update public.pizza_additions target
set sort_order = ordered.position
from ordered
where target.id = ordered.id;

alter table public.pizza_additions alter column sku set not null;
alter table public.pizza_additions alter column sort_order set default 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pizza_additions_sku_unique') then
    alter table public.pizza_additions add constraint pizza_additions_sku_unique unique (sku);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'pizza_additions_sort_order_unique') then
    alter table public.pizza_additions add constraint pizza_additions_sort_order_unique unique (sort_order) deferrable initially immediate;
  end if;
end $$;

drop trigger if exists prevent_pizza_additions_sku_change on public.pizza_additions;
create trigger prevent_pizza_additions_sku_change
  before update of sku on public.pizza_additions
  for each row execute function app_private.prevent_menu_sku_change();

grant execute on function public.reserve_menu_sku(text, text) to authenticated;

create or replace function public.normalize_menu_order(p_section text)
returns void
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  target_table text;
begin
  if not app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]) then
    raise exception 'No tienes permiso para ordenar el menu.';
  end if;

  target_table := case p_section
    when 'menu_categories' then 'menu_categories'
    when 'pizza_sizes' then 'pizza_sizes'
    when 'pizza_flavors' then 'pizza_flavors'
    when 'pizza_additions' then 'pizza_additions'
    else null
  end;

  if target_table is null then
    raise exception 'Seccion de menu no valida.';
  end if;

  execute format('lock table public.%I in exclusive mode', target_table);
  execute format('update public.%I set sort_order = -sort_order where sort_order > 0', target_table);
  execute format($sql$
    with ordered as (
      select id, row_number() over (order by abs(sort_order), created_at, id)::integer as position
      from public.%I
    )
    update public.%I item
    set sort_order = ordered.position, updated_at = now()
    from ordered
    where item.id = ordered.id
  $sql$, target_table, target_table);
end;
$$;

grant execute on function public.normalize_menu_order(text) to authenticated;

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
    when 'pizza_additions' then 'pizza_additions'
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

grant execute on function public.move_menu_item(text, uuid, text) to authenticated;

notify pgrst, 'reload schema';
