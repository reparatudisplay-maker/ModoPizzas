-- Global recipe quantities are defined once per component and pizza size.
-- pizza_price_components remains a generated compatibility projection consumed
-- by the POS transaction; it is never edited as a recipe source.

create table if not exists public.pizza_size_component_quantities (
  id uuid primary key default gen_random_uuid(),
  pizza_size_id uuid not null references public.pizza_sizes(id) on delete restrict,
  source_kind text not null check (source_kind in ('inventory_item', 'preparation')),
  inventory_item_id uuid references public.inventory_items(id) on delete restrict,
  source_preparation_id uuid references public.preparations(id) on delete restrict,
  quantity_base numeric(14, 3) not null check (quantity_base > 0),
  unit public.stock_unit not null check (unit in ('g', 'ml', 'unit')),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pizza_size_component_quantities_exact_source check (
    (source_kind = 'inventory_item' and inventory_item_id is not null and source_preparation_id is null)
    or
    (source_kind = 'preparation' and source_preparation_id is not null and inventory_item_id is null)
  )
);

create unique index if not exists pizza_size_component_quantities_inventory_unique
  on public.pizza_size_component_quantities (pizza_size_id, inventory_item_id)
  where source_kind = 'inventory_item';

create unique index if not exists pizza_size_component_quantities_preparation_unique
  on public.pizza_size_component_quantities (pizza_size_id, source_preparation_id)
  where source_kind = 'preparation';

create index if not exists pizza_size_component_quantities_size_idx
  on public.pizza_size_component_quantities (pizza_size_id);

alter table public.pizza_size_component_quantities enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'pizza_size_component_quantities'
      and policyname = 'Staff can read pizza size component quantities'
  ) then
    create policy "Staff can read pizza size component quantities"
      on public.pizza_size_component_quantities for select to authenticated
      using (app_private.has_any_role(array['vendedor'::public.app_role, 'mesero'::public.app_role, 'gerente'::public.app_role, 'admin_sistema'::public.app_role]));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'pizza_size_component_quantities'
      and policyname = 'Managers can manage pizza size component quantities'
  ) then
    create policy "Managers can manage pizza size component quantities"
      on public.pizza_size_component_quantities for all to authenticated
      using (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]))
      with check (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]));
  end if;
end $$;

create or replace function public.sync_pizza_price_components_for_config(p_price_config_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  config_row public.pizza_price_configs%rowtype;
begin
  select * into config_row from public.pizza_price_configs where id = p_price_config_id;
  if not found then
    raise exception 'Configuracion de precio no encontrada.';
  end if;

  delete from public.pizza_price_components where price_config_id = config_row.id;

  insert into public.pizza_price_components (
    price_config_id, source_kind, inventory_item_id, source_preparation_id,
    quantity_base, unit, display_quantity, display_unit
  )
  select
    config_row.id,
    ingredient.source_kind,
    ingredient.inventory_item_id,
    ingredient.source_preparation_id,
    quantity.quantity_base,
    quantity.unit,
    quantity.quantity_base,
    quantity.unit
  from public.pizza_flavor_ingredients ingredient
  join public.pizza_size_component_quantities quantity
    on quantity.pizza_size_id = config_row.size_id
   and quantity.source_kind = ingredient.source_kind
   and (
      (ingredient.source_kind = 'inventory_item' and quantity.inventory_item_id = ingredient.inventory_item_id)
      or (ingredient.source_kind = 'preparation' and quantity.source_preparation_id = ingredient.source_preparation_id)
   )
  where ingredient.flavor_id = config_row.flavor_id
    and not public.is_reserved_pizza_base_source(ingredient.source_kind, ingredient.inventory_item_id, ingredient.source_preparation_id);
end;
$$;

create or replace function public.sync_pizza_price_components_for_size(p_pizza_size_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  config_row record;
begin
  for config_row in select id from public.pizza_price_configs where size_id = p_pizza_size_id loop
    perform public.sync_pizza_price_components_for_config(config_row.id);
  end loop;
end;
$$;

create or replace function public.sync_pizza_price_components_after_quantity_change()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform public.sync_pizza_price_components_for_size(coalesce(new.pizza_size_id, old.pizza_size_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists sync_pizza_price_components_after_quantity_change on public.pizza_size_component_quantities;
create trigger sync_pizza_price_components_after_quantity_change
after insert or update or delete on public.pizza_size_component_quantities
for each row execute function public.sync_pizza_price_components_after_quantity_change();

create or replace function public.sync_pizza_price_components_after_flavor_change()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  config_row record;
begin
  for config_row in
    select id from public.pizza_price_configs
    where flavor_id = coalesce(new.flavor_id, old.flavor_id)
  loop
    perform public.sync_pizza_price_components_for_config(config_row.id);
  end loop;
  return coalesce(new, old);
end;
$$;

drop trigger if exists sync_pizza_price_components_after_flavor_change on public.pizza_flavor_ingredients;
create trigger sync_pizza_price_components_after_flavor_change
after insert or update or delete on public.pizza_flavor_ingredients
for each row execute function public.sync_pizza_price_components_after_flavor_change();

create or replace function public.save_pizza_size_component_quantities(p_rows jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if not app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]) then
    raise exception 'No tienes permiso para configurar gramajes por tamano.';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Los gramajes enviados no son validos.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as row(pizza_size_id uuid, source_kind text, source_id uuid, unit public.stock_unit, quantity_base numeric)
    left join public.pizza_sizes size on size.id = row.pizza_size_id and size.is_active
    left join public.inventory_items item on row.source_kind = 'inventory_item' and item.id = row.source_id
    left join public.preparations preparation on row.source_kind = 'preparation' and preparation.id = row.source_id
    where row.pizza_size_id is null
      or row.source_id is null
      or row.source_kind not in ('inventory_item', 'preparation')
      or row.quantity_base is null
      or row.quantity_base <= 0
      or size.id is null
      or (row.source_kind = 'inventory_item' and (item.id is null or not item.is_active or item.item_kind <> 'ingredient' or item.presentation_quantity is not null or item.unit not in ('g', 'kg', 'ml', 'l', 'unit')))
      or (row.source_kind = 'preparation' and (preparation.id is null or not preparation.is_active))
      or public.is_reserved_pizza_base_source(row.source_kind, case when row.source_kind = 'inventory_item' then row.source_id else null end, case when row.source_kind = 'preparation' then row.source_id else null end)
  ) then
    raise exception 'Cada gramaje debe usar un ingrediente o preparacion activo que no sea una base comun.';
  end if;

  delete from public.pizza_size_component_quantities;

  insert into public.pizza_size_component_quantities (
    pizza_size_id, source_kind, inventory_item_id, source_preparation_id, quantity_base, unit, created_by, updated_by
  )
  select
    row.pizza_size_id,
    row.source_kind,
    case when row.source_kind = 'inventory_item' then row.source_id else null end,
    case when row.source_kind = 'preparation' then row.source_id else null end,
    row.quantity_base,
    row.unit,
    current_user_id,
    current_user_id
  from jsonb_to_recordset(p_rows) as row(pizza_size_id uuid, source_kind text, source_id uuid, unit public.stock_unit, quantity_base numeric);

  perform public.sync_pizza_price_components_for_config(config.id)
  from public.pizza_price_configs config;
end;
$$;

with configured_sizes as (
  select
    id,
    case
      when regexp_replace(extensions.unaccent(upper(name)), '[^A-Z0-9]', '', 'g') in ('PORCION', 'PORCIONES') then 'portion'
      when round(diameter_cm) = 25 then '25'
      when round(diameter_cm) = 35 then '35'
      when round(diameter_cm) = 40 then '40'
    end as size_key
  from public.pizza_sizes
),
seed(source_name, portion, size_25, size_35, size_40) as (
  values
    ('SALSA NAPOLITANA', 28::numeric, 50::numeric, 150::numeric, 195::numeric),
    ('MOZZARELLA', 67, 120, 240, 350),
    ('JAMON', 14, 25, 45, 70),
    ('MAIZ', 14, 25, 40, 60),
    ('CHAMPINON', 22, 40, 80, 120),
    ('PEPPERONI', 34, 60, 120, 180),
    ('PIMENTON', 17, 30, 90, 120),
    ('CEBOLLA', 17, 30, 90, 120),
    ('TOMATE', 17, 30, 90, 120),
    ('POLLO', 30, 50, 150, 200),
    ('PINA', 15, 30, 45, 65),
    ('SALCHICHA', 40, 60, 110, 170),
    ('TOCINETA', 40, 60, 110, 170)
),
sources as (
  select 'inventory_item'::text as source_kind, item.id as source_id,
    regexp_replace(extensions.unaccent(upper(item.name)), '[^A-Z0-9]', '', 'g') as source_key,
    case when item.unit in ('g', 'kg') then 'g'::public.stock_unit when item.unit in ('ml', 'l') then 'ml'::public.stock_unit else 'unit'::public.stock_unit end as unit
  from public.inventory_items item
  where item.item_kind = 'ingredient' and item.presentation_quantity is null and item.is_active
  union all
  select 'preparation'::text, preparation.id,
    regexp_replace(extensions.unaccent(upper(preparation.name)), '[^A-Z0-9]', '', 'g'),
    case when preparation.base_unit in ('g', 'kg') then 'g'::public.stock_unit when preparation.base_unit in ('ml', 'l') then 'ml'::public.stock_unit else 'unit'::public.stock_unit end
  from public.preparations preparation
  where preparation.is_active
),
selected_sources as (
  select distinct on (seed.source_name) seed.source_name, source_kind, source_id, unit
  from seed
  join sources on sources.source_key = regexp_replace(extensions.unaccent(upper(seed.source_name)), '[^A-Z0-9]', '', 'g')
    or (seed.source_name = 'CHAMPINON' and sources.source_key = 'CHAMPINONES')
  order by seed.source_name, case when source_kind = 'inventory_item' then 1 else 2 end
),
rows as (
  select size.id as pizza_size_id, source.source_kind, source.source_id, source.unit,
    case size.size_key when 'portion' then seed.portion when '25' then seed.size_25 when '35' then seed.size_35 when '40' then seed.size_40 end as quantity_base
  from configured_sizes size
  join seed on size.size_key is not null
  join selected_sources source on source.source_name = seed.source_name
)
insert into public.pizza_size_component_quantities (
  pizza_size_id, source_kind, inventory_item_id, source_preparation_id, quantity_base, unit
)
select pizza_size_id, source_kind,
  case when source_kind = 'inventory_item' then source_id else null end,
  case when source_kind = 'preparation' then source_id else null end,
  quantity_base, unit
from rows
on conflict do nothing;

do $$
declare
  config_row record;
begin
  for config_row in select id from public.pizza_price_configs loop
    perform public.sync_pizza_price_components_for_config(config_row.id);
  end loop;
end;
$$;

grant execute on function public.sync_pizza_price_components_for_config(uuid) to authenticated;
grant execute on function public.save_pizza_size_component_quantities(jsonb) to authenticated;

notify pgrst, 'reload schema';
