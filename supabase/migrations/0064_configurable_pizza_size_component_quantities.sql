-- A configured matrix row may start at zero. It is a recipe setting, not stock.
alter table public.pizza_size_component_quantities
  drop constraint if exists pizza_size_component_quantities_quantity_base_check;

alter table public.pizza_size_component_quantities
  add constraint pizza_size_component_quantities_quantity_base_check
  check (quantity_base >= 0);

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
   and quantity.quantity_base > 0
   and quantity.source_kind = ingredient.source_kind
   and (
      (ingredient.source_kind = 'inventory_item' and quantity.inventory_item_id = ingredient.inventory_item_id)
      or (ingredient.source_kind = 'preparation' and quantity.source_preparation_id = ingredient.source_preparation_id)
   )
  where ingredient.flavor_id = config_row.flavor_id
    and not public.is_reserved_pizza_base_source(ingredient.source_kind, ingredient.inventory_item_id, ingredient.source_preparation_id);
end;
$$;

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
      or row.quantity_base < 0
      or size.id is null
      or (row.source_kind = 'inventory_item' and (item.id is null or not item.is_active or item.item_kind <> 'ingredient' or item.presentation_quantity is not null))
      or (row.source_kind = 'preparation' and (preparation.id is null or not preparation.is_active))
      or public.is_reserved_pizza_base_source(row.source_kind, case when row.source_kind = 'inventory_item' then row.source_id else null end, case when row.source_kind = 'preparation' then row.source_id else null end)
  ) then
    raise exception 'Cada gramaje debe usar un ingrediente o preparacion activo que no sea una base comun.';
  end if;

  -- Keep an explicit predicate: the production database enforces guarded deletes.
  delete from public.pizza_size_component_quantities
  where pizza_size_id is not null;

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

-- Keep only the requested initial configuration. This never touches products,
-- purchases, inventory, production, orders, or historical consumptions.
with allowed_sources as (
  select 'inventory_item'::text as source_kind, item.id as source_id
  from public.inventory_items item
  where item.item_kind = 'ingredient'
    and item.presentation_quantity is null
    and regexp_replace(extensions.unaccent(upper(item.name)), '[^A-Z0-9]', '', 'g') in (
      'MOZZARELLA', 'JAMON', 'MAIZ', 'CHAMPINON', 'CHAMPINONES', 'PEPPERONI',
      'PIMENTON', 'CEBOLLA', 'TOMATE', 'POLLO', 'PINA', 'SALCHICHA', 'TOCINETA'
    )
  union all
  select 'preparation'::text, preparation.id
  from public.preparations preparation
  where regexp_replace(extensions.unaccent(upper(preparation.name)), '[^A-Z0-9]', '', 'g') = 'SALSANAPOLITANA'
)
delete from public.pizza_size_component_quantities quantity
where not exists (
  select 1 from allowed_sources source
  where source.source_kind = quantity.source_kind
    and source.source_id = case when quantity.source_kind = 'inventory_item' then quantity.inventory_item_id else quantity.source_preparation_id end
);

do $$
declare
  config_row record;
begin
  for config_row in select id from public.pizza_price_configs loop
    perform public.sync_pizza_price_components_for_config(config_row.id);
  end loop;
end;
$$;

create or replace function public.remove_pizza_size_component_quantity_source(p_source_kind text, p_source_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]) then
    raise exception 'No tienes permiso para quitar ingredientes de gramajes.';
  end if;

  delete from public.pizza_size_component_quantities
  where source_kind = p_source_kind
    and (
      (p_source_kind = 'inventory_item' and inventory_item_id = p_source_id)
      or (p_source_kind = 'preparation' and source_preparation_id = p_source_id)
    );
end;
$$;

grant execute on function public.remove_pizza_size_component_quantity_source(text, uuid) to authenticated;
notify pgrst, 'reload schema';
