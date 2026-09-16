-- A pizza keeps its commercial size and recipe. This records and consumes the
-- exceptional base that was actually used by the kitchen.

alter table public.pizza_size_base_sources
  add column if not exists alternative_preparation_id uuid references public.preparations(id) on delete restrict,
  add column if not exists alternative_preparation_quantity_base numeric(14, 3),
  add column if not exists alternative_preparation_unit public.stock_unit;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pizza_size_base_sources_alternative_preparation_check') then
    alter table public.pizza_size_base_sources
      add constraint pizza_size_base_sources_alternative_preparation_check
      check (
        (alternative_preparation_id is null and alternative_preparation_quantity_base is null and alternative_preparation_unit is null)
        or
        (alternative_preparation_id is not null and alternative_preparation_quantity_base > 0 and alternative_preparation_unit is not null)
      );
  end if;
end;
$$;

alter table public.pos_order_items
  add column if not exists cart_line_key text,
  add column if not exists base_default_source_kind text,
  add column if not exists base_default_inventory_item_id uuid references public.inventory_items(id) on delete restrict,
  add column if not exists base_default_preparation_id uuid references public.preparations(id) on delete restrict,
  add column if not exists base_used_source_kind text,
  add column if not exists base_used_inventory_item_id uuid references public.inventory_items(id) on delete restrict,
  add column if not exists base_used_preparation_id uuid references public.preparations(id) on delete restrict,
  add column if not exists base_used_quantity_base numeric(14, 3),
  add column if not exists base_used_unit public.stock_unit,
  add column if not exists base_replaced_by uuid references auth.users(id) on delete set null,
  add column if not exists base_replaced_at timestamptz;

create unique index if not exists pos_order_items_cart_line_key_idx
  on public.pos_order_items(order_id, cart_line_key)
  where cart_line_key is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pos_order_items_base_default_source_check') then
    alter table public.pos_order_items add constraint pos_order_items_base_default_source_check check (
      (base_default_source_kind is null and base_default_inventory_item_id is null and base_default_preparation_id is null)
      or (base_default_source_kind = 'inventory_item' and base_default_inventory_item_id is not null and base_default_preparation_id is null)
      or (base_default_source_kind = 'preparation' and base_default_preparation_id is not null and base_default_inventory_item_id is null)
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pos_order_items_base_used_source_check') then
    alter table public.pos_order_items add constraint pos_order_items_base_used_source_check check (
      (base_used_source_kind is null and base_used_inventory_item_id is null and base_used_preparation_id is null and base_used_quantity_base is null and base_used_unit is null)
      or (base_used_source_kind = 'inventory_item' and base_used_inventory_item_id is not null and base_used_preparation_id is null and base_used_quantity_base > 0 and base_used_unit is not null)
      or (base_used_source_kind = 'preparation' and base_used_preparation_id is not null and base_used_inventory_item_id is null and base_used_quantity_base > 0 and base_used_unit is not null)
    );
  end if;
end;
$$;

create or replace function public.pos_resolve_pizza_base(
  p_pizza_size_id uuid,
  p_item jsonb
)
returns table (
  source_kind text,
  inventory_item_id uuid,
  source_preparation_id uuid,
  quantity_base numeric,
  unit public.stock_unit,
  default_source_kind text,
  default_inventory_item_id uuid,
  default_preparation_id uuid
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  configured_base record;
  selected_base record;
  override_kind text;
  override_id uuid;
begin
  select pbs.*, sold_size.diameter_cm as sold_diameter_cm
  into configured_base
  from public.pizza_size_base_sources pbs
  join public.pizza_sizes sold_size on sold_size.id = pbs.pizza_size_id
  where pbs.pizza_size_id = p_pizza_size_id and pbs.is_active;

  if not found then
    raise exception 'Configura la base para este tamano antes de vender pizzas.';
  end if;

  override_kind := nullif(p_item #>> '{base_override,source_kind}', '');
  override_id := nullif(p_item #>> '{base_override,source_id}', '')::uuid;

  if override_kind is null and override_id is null then
    return query select configured_base.source_kind, configured_base.inventory_item_id, configured_base.source_preparation_id,
      configured_base.quantity_base, configured_base.unit,
      configured_base.source_kind, configured_base.inventory_item_id, configured_base.source_preparation_id;
    return;
  end if;

  if override_kind not in ('inventory_item', 'preparation') or override_id is null then
    raise exception 'La base seleccionada no es valida.';
  end if;

  if (override_kind = configured_base.source_kind
      and override_id = coalesce(configured_base.inventory_item_id, configured_base.source_preparation_id)) then
    return query select configured_base.source_kind, configured_base.inventory_item_id, configured_base.source_preparation_id,
      configured_base.quantity_base, configured_base.unit,
      configured_base.source_kind, configured_base.inventory_item_id, configured_base.source_preparation_id;
    return;
  end if;

  if override_kind = 'inventory_item' then
    select alternative.source_kind, alternative.inventory_item_id, alternative.source_preparation_id,
      1::numeric as quantity_base, 'unit'::public.stock_unit as unit
    into selected_base
    from public.pizza_size_base_sources alternative
    join public.pizza_sizes alternative_size on alternative_size.id = alternative.pizza_size_id
    join public.inventory_items inventory on inventory.id = alternative.inventory_item_id
    where alternative.source_kind = 'inventory_item'
      and alternative.inventory_item_id = override_id
      and alternative.is_active
      and alternative_size.is_active
      and coalesce(alternative_size.diameter_cm, 0) >= coalesce(configured_base.sold_diameter_cm, 0)
      and inventory.is_active
      and inventory.item_kind = 'ingredient'
      and inventory.presentation_quantity is null
      and inventory.unit = 'unit'
    order by alternative_size.diameter_cm asc nulls last
    limit 1;
  else
    select 'preparation'::text as source_kind, null::uuid as inventory_item_id,
      preparation.id as source_preparation_id, configured_base.alternative_preparation_quantity_base as quantity_base,
      configured_base.alternative_preparation_unit as unit
    into selected_base
    from public.preparations preparation
    where preparation.id = override_id
      and preparation.is_active
      and configured_base.alternative_preparation_id = preparation.id
      and configured_base.alternative_preparation_quantity_base > 0
      and configured_base.alternative_preparation_unit is not null;
  end if;

  if not found then
    raise exception 'La base alternativa no es compatible con el tamano vendido.';
  end if;

  return query select selected_base.source_kind, selected_base.inventory_item_id, selected_base.source_preparation_id,
    selected_base.quantity_base, selected_base.unit,
    configured_base.source_kind, configured_base.inventory_item_id, configured_base.source_preparation_id;
end;
$$;

create or replace function public.get_pos_pizza_base_options()
returns table (
  pizza_size_id uuid,
  source_kind text,
  source_id uuid,
  source_name text,
  quantity_base numeric,
  unit public.stock_unit,
  is_default boolean,
  available_quantity numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with authorized as (
    select public.current_user_can_access_module('pedidos') as allowed
  ), configured as (
    select base.pizza_size_id, base.source_kind, base.inventory_item_id, base.source_preparation_id,
      base.quantity_base, base.unit, true as is_default
    from public.pizza_size_base_sources base
    where base.is_active
    union all
    select sold_size.id, 'inventory_item'::text, alternative.inventory_item_id, null::uuid,
      1::numeric, 'unit'::public.stock_unit, false
    from public.pizza_sizes sold_size
    join public.pizza_size_base_sources alternative on alternative.source_kind = 'inventory_item' and alternative.is_active
    join public.pizza_sizes alternative_size on alternative_size.id = alternative.pizza_size_id and alternative_size.is_active
    join public.inventory_items inventory on inventory.id = alternative.inventory_item_id
    where sold_size.is_active
      and coalesce(alternative_size.diameter_cm, 0) >= coalesce(sold_size.diameter_cm, 0)
      and inventory.is_active and inventory.item_kind = 'ingredient'
      and inventory.presentation_quantity is null and inventory.unit = 'unit'
    union all
    select base.pizza_size_id, 'preparation'::text, null::uuid, base.alternative_preparation_id,
      base.alternative_preparation_quantity_base, base.alternative_preparation_unit, false
    from public.pizza_size_base_sources base
    join public.preparations preparation on preparation.id = base.alternative_preparation_id and preparation.is_active
    where base.is_active and base.alternative_preparation_id is not null
      and base.alternative_preparation_quantity_base > 0 and base.alternative_preparation_unit is not null
  ), deduplicated as (
    select distinct on (pizza_size_id, source_kind, coalesce(inventory_item_id, source_preparation_id)) *
    from configured
    order by pizza_size_id, source_kind, coalesce(inventory_item_id, source_preparation_id), is_default desc
  ), sources as (
    select c.*, inventory.name as source_name,
      case when inventory.unit in ('g', 'kg') then 'g'::public.stock_unit when inventory.unit in ('ml', 'l') then 'ml'::public.stock_unit else 'unit'::public.stock_unit end as canonical_unit
    from deduplicated c join public.inventory_items inventory on c.source_kind = 'inventory_item' and inventory.id = c.inventory_item_id
    union all
    select c.*, preparation.name,
      case when preparation.base_unit in ('g', 'kg') then 'g'::public.stock_unit when preparation.base_unit in ('ml', 'l') then 'ml'::public.stock_unit else 'unit'::public.stock_unit end
    from deduplicated c join public.preparations preparation on c.source_kind = 'preparation' and preparation.id = c.source_preparation_id
  )
  select source.pizza_size_id, source.source_kind, coalesce(source.inventory_item_id, source.source_preparation_id), source.source_name,
    source.quantity_base, source.unit, source.is_default,
    case when source.source_kind = 'inventory_item' then coalesce((
      select sum(greatest(0, public.production_convert_quantity(purchase_item.quantity, purchase_item.unit, source.canonical_unit, null)
        - coalesce((select sum(public.production_convert_quantity(allocation.quantity_base, allocation.base_unit, source.canonical_unit, null)) from public.production_consumption_allocations allocation where allocation.purchase_item_id = purchase_item.id), 0)
        - coalesce((select sum(public.production_convert_quantity(allocation.quantity_base, allocation.base_unit, source.canonical_unit, null)) from public.pos_order_consumption_allocations allocation join public.pos_order_consumptions consumption on consumption.id = allocation.consumption_id join public.pos_orders order_header on order_header.id = consumption.order_id where allocation.purchase_item_id = purchase_item.id and order_header.status <> 'cancelled'), 0)))
      from public.purchase_items purchase_item where purchase_item.inventory_item_id = source.inventory_item_id), 0)
    else coalesce((
      select sum(greatest(0, public.production_convert_quantity(batch.initial_quantity_base, batch.base_unit, source.canonical_unit, null)
        - coalesce((select sum(public.production_convert_quantity(allocation.quantity_base, allocation.base_unit, source.canonical_unit, null)) from public.production_consumption_allocations allocation where allocation.production_batch_id = batch.id), 0)
        - coalesce((select sum(public.production_convert_quantity(allocation.quantity_base, allocation.base_unit, source.canonical_unit, null)) from public.pos_order_consumption_allocations allocation join public.pos_order_consumptions consumption on consumption.id = allocation.consumption_id join public.pos_orders order_header on order_header.id = consumption.order_id where allocation.production_batch_id = batch.id and order_header.status <> 'cancelled'), 0)))
      from public.production_batches batch where batch.preparation_id = source.source_preparation_id), 0) end
  from sources source
  cross join authorized
  where authorized.allowed;
$$;

revoke all on function public.get_pos_pizza_base_options() from public;
grant execute on function public.get_pos_pizza_base_options() to authenticated;
revoke all on function public.pos_resolve_pizza_base(uuid, jsonb) from public;

-- Preserve the established order writer and replace only its base lookup with
-- the guarded resolver. pg_get_functiondef normalizes whitespace, so match the
-- old lookup structurally instead of relying on one textual rendering.
do $$
declare
  definition text;
  new_lookup text := $lookup$
      select resolved.source_kind, resolved.inventory_item_id, resolved.source_preparation_id, resolved.quantity_base, resolved.unit
      into pizza_base_row
      from public.pos_resolve_pizza_base(pizza_row.size_id, item) resolved;$lookup$;
  old_columns text := $columns$
        order_id, item_kind, pizza_price_config_id, quantity, product_name_snapshot,
        sku_snapshot, unit_price_cop, line_subtotal_cop, line_cost_cop, notes$columns$;
  new_columns text := $columns$
        order_id, item_kind, pizza_price_config_id, quantity, product_name_snapshot,
        sku_snapshot, unit_price_cop, line_subtotal_cop, line_cost_cop, cart_line_key, notes$columns$;
  old_values text := $values$
        new_order_id, 'pizza', item_id, item_quantity, item_name_snapshot,
        item_sku_snapshot, line_price, item_subtotal, 0, item_notes$values$;
  new_values text := $values$
        new_order_id, 'pizza', item_id, item_quantity, item_name_snapshot,
        item_sku_snapshot, line_price, item_subtotal, 0, nullif(item->>'line_key', ''), item_notes$values$;
begin
  select pg_get_functiondef('public.create_pos_order(text,text,text,numeric,numeric,text,text,jsonb)'::regprocedure) into definition;
  if definition !~ 'select\\s+pbs\\.source_kind,.*?from public\\.pizza_size_base_sources pbs.*?limit 1;' or position(old_columns in definition) = 0 or position(old_values in definition) = 0 then
    raise exception 'La funcion create_pos_order no coincide con la version esperada para sustitucion de bases.';
  end if;
  definition := regexp_replace(definition, 'select\\s+pbs\\.source_kind,.*?from public\\.pizza_size_base_sources pbs.*?limit 1;', new_lookup, 'n');
  definition := replace(definition, old_columns, new_columns);
  definition := replace(definition, old_values, new_values);
  execute definition;
end;
$$;

-- Stock validation must resolve the same exceptional base as the order writer;
-- otherwise a valid replacement would be rejected before FEFO allocation starts.
do $$
declare
  definition text;
  old_base_join text := E'    from pizza_rows pizza\n    join public.pizza_size_base_sources base on base.pizza_size_id = pizza.size_id and base.is_active';
  new_base_join text := E'    from pizza_rows pizza\n    cross join lateral public.pos_resolve_pizza_base(pizza.size_id, pizza.item) base';
begin
  select pg_get_functiondef('public.get_pos_order_stock_shortages_internal(jsonb)'::regprocedure) into definition;
  if position(old_base_join in definition) = 0 then
    raise exception 'La funcion de faltantes POS no coincide con la version esperada para sustitucion de bases.';
  end if;
  execute replace(definition, old_base_join, new_base_join);
end;
$$;

create or replace function public.create_pos_order_with_discount_payment(
  p_kind text, p_customer_name text, p_customer_phone text, p_discount_type text,
  p_discount_value numeric, p_discount_cop numeric, p_delivery_cop numeric,
  p_payment_method text, p_notes text, p_items jsonb,
  p_cash_received_cop numeric default null, p_cash_change_cop numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  created_order jsonb;
  created_order_id uuid;
  order_subtotal numeric;
  expected_discount numeric;
  pizza_item jsonb;
  resolved record;
begin
  if not public.current_user_can_access_module('pedidos') then raise exception 'No tienes acceso operativo a pedidos.'; end if;
  p_discount_type := coalesce(nullif(trim(p_discount_type), ''), 'none');
  p_discount_value := coalesce(p_discount_value, 0);
  p_discount_cop := coalesce(p_discount_cop, 0);
  if p_discount_type not in ('none', 'percentage', 'amount') then raise exception 'El tipo de descuento no es valido.'; end if;
  if p_discount_type = 'none' and (p_discount_value <> 0 or p_discount_cop <> 0) then raise exception 'El descuento no es valido.'; end if;
  if p_discount_type = 'percentage' and (p_discount_value <= 0 or p_discount_value >= 100) then raise exception 'El descuento porcentual debe ser mayor que cero y menor al 100%%.'; end if;
  if p_discount_type = 'amount' and p_discount_value <= 0 then raise exception 'El descuento debe ser mayor que cero.'; end if;

  created_order := public.create_pos_order_with_payment(
    p_kind, p_customer_name, p_customer_phone, p_discount_cop, p_delivery_cop,
    p_payment_method, p_notes, p_items, p_cash_received_cop, p_cash_change_cop
  );
  created_order_id := (created_order->>'id')::uuid;

  for pizza_item in select value from jsonb_array_elements(p_items) where value->>'kind' = 'pizza' loop
    if nullif(pizza_item->>'line_key', '') is null then continue; end if;
    select * into resolved from public.pos_resolve_pizza_base((select size_id from public.pizza_price_configs where id = (pizza_item->>'id')::uuid), pizza_item);
    update public.pos_order_items poi
    set base_default_source_kind = resolved.default_source_kind,
        base_default_inventory_item_id = case when resolved.default_source_kind = 'inventory_item' then resolved.default_inventory_item_id else null end,
        base_default_preparation_id = case when resolved.default_source_kind = 'preparation' then resolved.default_preparation_id else null end,
        base_used_source_kind = resolved.source_kind,
        base_used_inventory_item_id = case when resolved.source_kind = 'inventory_item' then resolved.inventory_item_id else null end,
        base_used_preparation_id = case when resolved.source_kind = 'preparation' then resolved.source_preparation_id else null end,
        base_used_quantity_base = resolved.quantity_base * greatest(1, coalesce((pizza_item->>'quantity')::integer, 1)),
        base_used_unit = resolved.unit,
        base_replaced_by = case when resolved.source_kind <> resolved.default_source_kind or coalesce(resolved.inventory_item_id, resolved.source_preparation_id) <> coalesce(resolved.default_inventory_item_id, resolved.default_preparation_id) then auth.uid() else null end,
        base_replaced_at = case when resolved.source_kind <> resolved.default_source_kind or coalesce(resolved.inventory_item_id, resolved.source_preparation_id) <> coalesce(resolved.default_inventory_item_id, resolved.default_preparation_id) then now() else null end
    where poi.order_id = created_order_id and poi.cart_line_key = pizza_item->>'line_key';
  end loop;

  select subtotal_cop into order_subtotal from public.pos_orders where id = created_order_id for update;
  expected_discount := case when p_discount_type = 'percentage' then round(order_subtotal * p_discount_value / 100, 0) when p_discount_type = 'amount' then round(p_discount_value, 0) else 0 end;
  if expected_discount < 0 or expected_discount >= order_subtotal or round(p_discount_cop, 0) <> expected_discount then raise exception 'El descuento no es valido para el subtotal del pedido.'; end if;
  update public.pos_orders set discount_type = p_discount_type, discount_value = case when p_discount_type = 'none' then 0 else p_discount_value end, discount_cop = expected_discount, discount_applied_by = case when p_discount_type = 'none' then null else auth.uid() end, updated_at = now() where id = created_order_id;
  return created_order;
end;
$$;

revoke all on function public.create_pos_order_with_discount_payment(text, text, text, text, numeric, numeric, numeric, text, text, jsonb, numeric, numeric) from public;
grant execute on function public.create_pos_order_with_discount_payment(text, text, text, text, numeric, numeric, numeric, text, text, jsonb, numeric, numeric) to authenticated;

notify pgrst, 'reload schema';
