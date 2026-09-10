-- Return the current, aggregated shortages before an order is created. The
-- final allocation remains in create_pos_order, in the same transaction.
create or replace function public.get_pos_order_stock_shortages(p_items jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  shortages jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'El pedido no tiene productos validos.';
  end if;

  with cart_items as (
    select
      item.value as item,
      item.ordinality::integer as line_position,
      item.value->>'kind' as line_kind,
      nullif(item.value->>'id', '')::uuid as item_id,
      nullif(item.value->>'secondary_id', '')::uuid as secondary_item_id,
      greatest(1, coalesce(nullif(item.value->>'quantity', '')::integer, 1)) as quantity
    from jsonb_array_elements(p_items) with ordinality as item(value, ordinality)
  ),
  pizza_rows as (
    select
      cart.*,
      primary_price.id as primary_price_id,
      primary_price.size_id,
      primary_flavor.name as primary_flavor_name,
      pizza_size.name as size_name,
      secondary_price.id as secondary_price_id,
      secondary_flavor.name as secondary_flavor_name
    from cart_items cart
    join public.pizza_price_configs primary_price on primary_price.id = cart.item_id
    join public.pizza_flavors primary_flavor on primary_flavor.id = primary_price.flavor_id
    join public.pizza_sizes pizza_size on pizza_size.id = primary_price.size_id
    left join public.pizza_price_configs secondary_price on secondary_price.id = cart.secondary_item_id
    left join public.pizza_flavors secondary_flavor on secondary_flavor.id = secondary_price.flavor_id
    where cart.line_kind = 'pizza'
  ),
  raw_requirements as (
    select
      pizza.line_position,
      'pizza'::text as line_kind,
      case when pizza.secondary_price_id is null then pizza.primary_flavor_name || ' ' || pizza.size_name
        else pizza.primary_flavor_name || ' / ' || pizza.secondary_flavor_name || ' ' || pizza.size_name end as line_label,
      pizza.quantity as line_quantity,
      base.source_kind,
      coalesce(base.inventory_item_id, base.source_preparation_id) as source_id,
      base.quantity_base * pizza.quantity as quantity_base,
      base.unit
    from pizza_rows pizza
    join public.pizza_size_base_sources base on base.pizza_size_id = pizza.size_id and base.is_active

    union all

    select
      pizza.line_position,
      'pizza'::text,
      case when pizza.secondary_price_id is null then pizza.primary_flavor_name || ' ' || pizza.size_name
        else pizza.primary_flavor_name || ' / ' || pizza.secondary_flavor_name || ' ' || pizza.size_name end,
      pizza.quantity,
      component.source_kind,
      coalesce(component.inventory_item_id, component.source_preparation_id),
      component.quantity_base * pizza.quantity * case when pizza.secondary_price_id is null then 1 else 0.5 end,
      component.unit
    from pizza_rows pizza
    join public.pizza_price_components component on component.price_config_id = pizza.primary_price_id
    where not exists (
      select 1
      from jsonb_array_elements(coalesce(pizza.item->'removed_components', '[]'::jsonb)) as removed(value)
      where removed.value->>'source_kind' = component.source_kind
        and removed.value->>'source_id' = coalesce(component.inventory_item_id, component.source_preparation_id)::text
    )

    union all

    select
      pizza.line_position,
      'pizza'::text,
      pizza.primary_flavor_name || ' / ' || pizza.secondary_flavor_name || ' ' || pizza.size_name,
      pizza.quantity,
      component.source_kind,
      coalesce(component.inventory_item_id, component.source_preparation_id),
      component.quantity_base * pizza.quantity * 0.5,
      component.unit
    from pizza_rows pizza
    join public.pizza_price_components component on component.price_config_id = pizza.secondary_price_id
    where pizza.secondary_price_id is not null
      and not exists (
        select 1
        from jsonb_array_elements(coalesce(pizza.item->'removed_components', '[]'::jsonb)) as removed(value)
        where removed.value->>'source_kind' = component.source_kind
          and removed.value->>'source_id' = coalesce(component.inventory_item_id, component.source_preparation_id)::text
      )

    union all

    select
      pizza.line_position,
      'pizza'::text,
      case when pizza.secondary_price_id is null then pizza.primary_flavor_name || ' ' || pizza.size_name
        else pizza.primary_flavor_name || ' / ' || pizza.secondary_flavor_name || ' ' || pizza.size_name end,
      pizza.quantity,
      addition.source_kind,
      coalesce(addition.inventory_item_id, addition.source_preparation_id),
      addition_size.quantity_base * pizza.quantity * greatest(1, coalesce(nullif(selected_addition.value->>'quantity', '')::integer, 1)),
      addition_size.unit
    from pizza_rows pizza
    cross join lateral jsonb_array_elements(coalesce(pizza.item->'additions', '[]'::jsonb)) as selected_addition(value)
    join public.pizza_additions addition on addition.id = (selected_addition.value->>'id')::uuid
    join public.pizza_addition_sizes addition_size on addition_size.addition_id = addition.id and addition_size.pizza_size_id = pizza.size_id

    union all

    select
      cart.line_position,
      'sale_product'::text,
      null::text,
      cart.quantity,
      'inventory_item'::text,
      cart.item_id,
      cart.quantity::numeric,
      'unit'::public.stock_unit
    from cart_items cart
    where cart.line_kind = 'sale_product'
  ),
  source_metadata as (
    select
      requirement.*,
      inventory.name as source_name,
      case when inventory.item_kind = 'sale_product' then 'sale_product' else 'inventory_item' end as source_category,
      case when inventory.unit in ('g', 'kg') then 'g'::public.stock_unit
        when inventory.unit in ('ml', 'l') then 'ml'::public.stock_unit else 'unit'::public.stock_unit end as canonical_unit
    from raw_requirements requirement
    join public.inventory_items inventory on requirement.source_kind = 'inventory_item' and inventory.id = requirement.source_id

    union all

    select
      requirement.*,
      preparation.name as source_name,
      'preparation'::text as source_category,
      case when preparation.base_unit in ('g', 'kg') then 'g'::public.stock_unit
        when preparation.base_unit in ('ml', 'l') then 'ml'::public.stock_unit else 'unit'::public.stock_unit end as canonical_unit
    from raw_requirements requirement
    join public.preparations preparation on requirement.source_kind = 'preparation' and preparation.id = requirement.source_id
  ),
  normalized_requirements as (
    select
      metadata.*,
      public.production_convert_quantity(metadata.quantity_base, metadata.unit, metadata.canonical_unit, null) as requested_quantity
    from source_metadata metadata
    where metadata.quantity_base > 0
  ),
  source_keys as (
    select distinct source_kind, source_id, source_name, source_category, canonical_unit
    from normalized_requirements
  ),
  source_availability as (
    select
      source.*,
      case when source.source_kind = 'inventory_item' then coalesce((
        select sum(greatest(0,
          public.production_convert_quantity(purchase_item.quantity, purchase_item.unit, source.canonical_unit, null)
          - coalesce((
            select sum(public.production_convert_quantity(allocation.quantity_base, allocation.base_unit, source.canonical_unit, null))
            from public.production_consumption_allocations allocation
            where allocation.purchase_item_id = purchase_item.id
          ), 0)
          - coalesce((
            select sum(public.production_convert_quantity(allocation.quantity_base, allocation.base_unit, source.canonical_unit, null))
            from public.pos_order_consumption_allocations allocation
            join public.pos_order_consumptions consumption on consumption.id = allocation.consumption_id
            join public.pos_orders order_header on order_header.id = consumption.order_id
            where allocation.purchase_item_id = purchase_item.id
              and order_header.status <> 'cancelled'
          ), 0)
        ))
        from public.purchase_items purchase_item
        where purchase_item.inventory_item_id = source.source_id
      ), 0) else coalesce((
        select sum(greatest(0,
          public.production_convert_quantity(batch.initial_quantity_base, batch.base_unit, source.canonical_unit, null)
          - coalesce((
            select sum(public.production_convert_quantity(allocation.quantity_base, allocation.base_unit, source.canonical_unit, null))
            from public.production_consumption_allocations allocation
            where allocation.production_batch_id = batch.id
          ), 0)
          - coalesce((
            select sum(public.production_convert_quantity(allocation.quantity_base, allocation.base_unit, source.canonical_unit, null))
            from public.pos_order_consumption_allocations allocation
            join public.pos_order_consumptions consumption on consumption.id = allocation.consumption_id
            join public.pos_orders order_header on order_header.id = consumption.order_id
            where allocation.production_batch_id = batch.id
              and order_header.status <> 'cancelled'
          ), 0)
        ))
        from public.production_batches batch
        where batch.preparation_id = source.source_id
      ), 0) end as available_quantity
    from source_keys source
  ),
  usage_rows as (
    select
      requirement.source_kind,
      requirement.source_id,
      requirement.source_name,
      requirement.source_category,
      requirement.canonical_unit,
      requirement.line_position,
      requirement.line_kind,
      coalesce(requirement.line_label, requirement.source_name) as line_label,
      requirement.line_quantity,
      sum(requirement.requested_quantity) as requested_quantity
    from normalized_requirements requirement
    group by requirement.source_kind, requirement.source_id, requirement.source_name, requirement.source_category,
      requirement.canonical_unit, requirement.line_position, requirement.line_kind, requirement.line_label, requirement.line_quantity
  ),
  totals as (
    select
      usage.source_kind,
      usage.source_id,
      usage.source_name,
      usage.source_category,
      usage.canonical_unit,
      availability.available_quantity,
      sum(usage.requested_quantity) as requested_quantity,
      jsonb_agg(jsonb_build_object(
        'line_position', usage.line_position,
        'line_kind', usage.line_kind,
        'line_label', usage.line_label,
        'line_quantity', usage.line_quantity,
        'requested_quantity', usage.requested_quantity
      ) order by usage.line_position) as usages
    from usage_rows usage
    join source_availability availability
      on availability.source_kind = usage.source_kind
      and availability.source_id = usage.source_id
      and availability.canonical_unit = usage.canonical_unit
    group by usage.source_kind, usage.source_id, usage.source_name, usage.source_category, usage.canonical_unit, availability.available_quantity
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'source_kind', source_kind,
    'source_id', source_id,
    'source_name', source_name,
    'source_category', source_category,
    'unit', canonical_unit,
    'requested_quantity', requested_quantity,
    'available_quantity', available_quantity,
    'missing_quantity', greatest(0, requested_quantity - available_quantity),
    'usages', usages
  ) order by source_category, source_name), '[]'::jsonb)
  into shortages
  from totals
  where requested_quantity > available_quantity + 0.0001;

  return shortages;
end;
$$;

grant execute on function public.get_pos_order_stock_shortages(jsonb) to authenticated;

create or replace function public.create_pos_order_with_payment(
  p_kind text,
  p_customer_name text,
  p_customer_phone text,
  p_discount_cop numeric,
  p_delivery_cop numeric,
  p_payment_method text,
  p_notes text,
  p_items jsonb,
  p_cash_received_cop numeric default null,
  p_cash_change_cop numeric default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  created_order jsonb;
  item jsonb;
  normalized_items jsonb := '[]'::jsonb;
  configured_price numeric;
  order_id uuid;
  order_total numeric;
  payment_id uuid;
  session_id uuid;
  movement_id uuid;
  sale_product record;
  lot record;
  remaining_quantity numeric;
  available_quantity numeric;
  total_available_quantity numeric;
  shortages jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'El pedido no tiene productos validos.';
  end if;

  shortages := public.get_pos_order_stock_shortages(p_items);
  if jsonb_array_length(shortages) > 0 then
    raise exception using message = 'POS_STOCK_SHORTAGE', detail = shortages::text;
  end if;

  -- Lock sale-product lots before creating order rows. The POS allocator locks
  -- pizza ingredient and preparation lots during its FEFO allocation.
  for sale_product in
    select (item_value->>'id')::uuid as inventory_item_id,
      sum(coalesce(nullif(item_value->>'quantity', '')::numeric, 0)) as requested_quantity
    from jsonb_array_elements(p_items) as entries(item_value)
    where item_value->>'kind' = 'sale_product'
    group by (item_value->>'id')::uuid
  loop
    if sale_product.requested_quantity is null or sale_product.requested_quantity <= 0 or sale_product.requested_quantity <> trunc(sale_product.requested_quantity) then
      raise exception 'La cantidad de productos para venta debe ser un numero entero mayor que cero.';
    end if;

    select id, name into lot
    from public.inventory_items
    where id = sale_product.inventory_item_id and item_kind = 'sale_product'
      and presentation_quantity is not null and is_active = true and sale_is_enabled = true;
    if not found then raise exception 'Producto para venta no disponible.'; end if;

    remaining_quantity := sale_product.requested_quantity;
    total_available_quantity := 0;
    for lot in
      select pi.id, greatest(0,
        public.production_convert_quantity(pi.quantity, pi.unit, 'unit'::public.stock_unit, null)
        - coalesce((select sum(public.production_convert_quantity(pca.quantity_base, pca.base_unit, 'unit'::public.stock_unit, null)) from public.production_consumption_allocations pca where pca.purchase_item_id = pi.id), 0)
        - coalesce((select sum(public.production_convert_quantity(poca.quantity_base, poca.base_unit, 'unit'::public.stock_unit, null)) from public.pos_order_consumption_allocations poca join public.pos_order_consumptions poc on poc.id = poca.consumption_id join public.pos_orders po on po.id = poc.order_id where poca.purchase_item_id = pi.id and po.status <> 'cancelled'), 0)
      ) as available_quantity
      from public.purchase_items pi join public.purchases p on p.id = pi.purchase_id
      where pi.inventory_item_id = sale_product.inventory_item_id
      order by pi.expiration_date asc nulls last, p.purchased_at asc, pi.id asc
      for update of pi
    loop
      available_quantity := lot.available_quantity;
      total_available_quantity := total_available_quantity + available_quantity;
      remaining_quantity := greatest(0, remaining_quantity - available_quantity);
    end loop;

    if remaining_quantity > 0 then
      shortages := public.get_pos_order_stock_shortages(p_items);
      raise exception using message = 'POS_STOCK_SHORTAGE', detail = shortages::text;
    end if;
  end loop;

  for item in select value from jsonb_array_elements(p_items) with ordinality as items(value, position) order by position loop
    if item->>'kind' = 'sale_product' then
      select sale_price_cop into configured_price
      from public.inventory_items
      where id = (item->>'id')::uuid and item_kind = 'sale_product'
        and presentation_quantity is not null and is_active = true and sale_is_enabled = true;
      if not found then raise exception 'Producto para venta no disponible.'; end if;
      if configured_price <= 0 then raise exception 'El producto % no tiene precio de venta configurado.', coalesce(item->>'id', ''); end if;
      normalized_items := normalized_items || jsonb_build_array(jsonb_set(item, '{unit_price_cop}', to_jsonb(configured_price), true));
    else
      normalized_items := normalized_items || jsonb_build_array(item);
    end if;
  end loop;

  if p_payment_method = 'cash' then
    if p_cash_received_cop is null then raise exception 'Confirma el monto recibido en efectivo.'; end if;
    if p_cash_change_cop is null then raise exception 'Confirma el cambio entregado.'; end if;
    select id into session_id from public.cash_sessions where status = 'open' order by opened_at desc limit 1 for update;
    if session_id is null then raise exception 'Abre caja antes de confirmar pagos en efectivo.'; end if;
  end if;

  created_order := public.create_pos_order(p_kind, p_customer_name, p_customer_phone, p_discount_cop, p_delivery_cop, p_payment_method, p_notes, normalized_items);
  order_id := (created_order->>'id')::uuid;
  order_total := (created_order->>'total_cop')::numeric;

  if p_payment_method = 'cash' then
    perform public.record_pos_cash_payment(order_id, p_cash_received_cop, p_cash_change_cop);
    insert into public.pos_order_payments (order_id, method, amount_cop, cash_received_cop, cash_change_cop, cash_session_id, created_by)
    values (order_id, 'cash', order_total, p_cash_received_cop, p_cash_change_cop, session_id, auth.uid()) returning id into payment_id;
    insert into public.cash_movements (cash_session_id, movement_kind, direction, source_kind, amount_cop, created_by, reason, order_id, payment_id)
    values (session_id, 'sale_cash', 'in', 'pos_order', order_total, auth.uid(), 'VENTA EN EFECTIVO ' || (created_order->>'code'), order_id, payment_id) returning id into movement_id;
    update public.pos_order_payments set cash_movement_id = movement_id where id = payment_id;
    created_order := jsonb_set(created_order, '{cash_received_cop}', to_jsonb(p_cash_received_cop), true);
    created_order := jsonb_set(created_order, '{cash_change_cop}', to_jsonb(p_cash_change_cop), true);
  elsif p_payment_method in ('transfer', 'mixed', 'pending') then
    insert into public.pos_order_payments (order_id, method, amount_cop, created_by)
    values (order_id, p_payment_method, order_total, auth.uid());
  end if;

  return created_order;
end;
$$;

grant execute on function public.create_pos_order_with_payment(text, text, text, numeric, numeric, text, text, jsonb, numeric, numeric) to authenticated;
notify pgrst, 'reload schema';
