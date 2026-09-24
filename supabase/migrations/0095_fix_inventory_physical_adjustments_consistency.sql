-- Keep operational availability consistent with inventory physical adjustments.
-- This migration changes function logic only; it does not rewrite historical data.

create or replace function app_private.inventory_source_lots(
  p_source_kind text,
  p_source_id uuid,
  p_base_unit public.stock_unit
)
returns table (
  origin_id uuid,
  available_base numeric,
  occurred_at timestamptz,
  expiration_date date,
  sequence bigint
)
language plpgsql
security definer
set search_path = public, app_private
as $function$
declare
  lot record;
  count_row record;
  origin_ids uuid[] := array[]::uuid[];
  origin_stocks numeric[] := array[]::numeric[];
  origin_dates timestamptz[] := array[]::timestamptz[];
  origin_expirations date[] := array[]::date[];
  origin_sequences bigint[] := array[]::bigint[];
  origin_index integer;
  eligible_index integer;
  pending numeric;
  adjustment numeric;
  current_stock numeric;
  origin_count integer;
begin
  if p_source_kind = 'inventory_item' then
    for lot in
      select
        pi.id,
        greatest(0,
          public.production_convert_quantity(pi.quantity, pi.unit, p_base_unit, null)
          - coalesce((
            select sum(public.production_convert_quantity(pca.quantity_base, pca.base_unit, p_base_unit, null))
            from public.production_consumption_allocations pca
            where pca.purchase_item_id = pi.id
          ), 0)
          - coalesce((
            select sum(public.production_convert_quantity(poca.quantity_base, poca.base_unit, p_base_unit, null))
            from public.pos_order_consumption_allocations poca
            join public.pos_order_consumptions poc on poc.id = poca.consumption_id
            join public.pos_orders po on po.id = poc.order_id
            where poca.purchase_item_id = pi.id
              and po.status <> 'cancelled'
          ), 0)
        ) as available_base,
        p.purchased_at as occurred_at,
        pi.expiration_date,
        0::bigint as sequence
      from public.purchase_items pi
      join public.purchases p on p.id = pi.purchase_id
      where pi.inventory_item_id = p_source_id
      order by pi.expiration_date asc nulls last, p.purchased_at asc, pi.id asc
    loop
      origin_ids := array_append(origin_ids, lot.id);
      origin_stocks := array_append(origin_stocks, lot.available_base);
      origin_dates := array_append(origin_dates, lot.occurred_at);
      origin_expirations := array_append(origin_expirations, lot.expiration_date);
      origin_sequences := array_append(origin_sequences, lot.sequence);
    end loop;
  elsif p_source_kind = 'preparation' then
    for lot in
      select
        pb.id,
        greatest(0,
          public.production_convert_quantity(pb.initial_quantity_base, pb.base_unit, p_base_unit, null)
          - coalesce((
            select sum(public.production_convert_quantity(pca.quantity_base, pca.base_unit, p_base_unit, null))
            from public.production_consumption_allocations pca
            where pca.production_batch_id = pb.id
          ), 0)
          - coalesce((
            select sum(public.production_convert_quantity(poca.quantity_base, poca.base_unit, p_base_unit, null))
            from public.pos_order_consumption_allocations poca
            join public.pos_order_consumptions poc on poc.id = poca.consumption_id
            join public.pos_orders po on po.id = poc.order_id
            where poca.production_batch_id = pb.id
              and po.status <> 'cancelled'
          ), 0)
        ) as available_base,
        pb.elaborated_at::timestamptz as occurred_at,
        pb.expiration_date,
        coalesce(pb.production_number, 0)::bigint as sequence
      from public.production_batches pb
      where pb.preparation_id = p_source_id
      order by pb.expiration_date asc, pb.elaborated_at asc, pb.production_number asc
    loop
      origin_ids := array_append(origin_ids, lot.id);
      origin_stocks := array_append(origin_stocks, lot.available_base);
      origin_dates := array_append(origin_dates, lot.occurred_at);
      origin_expirations := array_append(origin_expirations, lot.expiration_date);
      origin_sequences := array_append(origin_sequences, lot.sequence);
    end loop;
  else
    raise exception 'Tipo de fuente no valido.';
  end if;

  origin_count := coalesce(array_length(origin_ids, 1), 0);
  if origin_count = 0 then
    return;
  end if;

  for count_row in
    select difference_quantity_base, base_unit, created_at
    from public.physical_inventory_counts
    where voided_at is null
      and (
        (p_source_kind = 'inventory_item' and inventory_item_id = p_source_id)
        or (p_source_kind = 'preparation' and source_preparation_id = p_source_id)
      )
    order by created_at asc, id asc
  loop
    adjustment := public.production_convert_quantity(
      coalesce(count_row.difference_quantity_base, 0),
      count_row.base_unit,
      p_base_unit,
      null
    );

    if adjustment < 0 then
      pending := abs(adjustment);
      for eligible_index in 1..origin_count loop
        exit when pending <= 0;
        if origin_dates[eligible_index] is not null
           and origin_dates[eligible_index] > count_row.created_at then
          continue;
        end if;
        current_stock := greatest(0, origin_stocks[eligible_index]);
        if current_stock <= 0 then
          continue;
        end if;
        current_stock := least(current_stock, pending);
        origin_stocks[eligible_index] := greatest(0, origin_stocks[eligible_index] - current_stock);
        pending := pending - current_stock;
      end loop;
    elsif adjustment > 0 then
      for eligible_index in 1..origin_count loop
        if origin_dates[eligible_index] is null
           or origin_dates[eligible_index] <= count_row.created_at then
          origin_stocks[eligible_index] := origin_stocks[eligible_index] + adjustment;
          exit;
        end if;
      end loop;
    end if;
  end loop;

  for origin_index in 1..origin_count loop
    origin_id := origin_ids[origin_index];
    available_base := round(greatest(0, origin_stocks[origin_index]), 6);
    occurred_at := origin_dates[origin_index];
    expiration_date := origin_expirations[origin_index];
    sequence := origin_sequences[origin_index];
    return next;
  end loop;
end;
$function$;

revoke all on function app_private.inventory_source_lots(text, uuid, public.stock_unit) from public;
grant execute on function app_private.inventory_source_lots(text, uuid, public.stock_unit) to anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_pos_order_stock_shortages_internal(p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
    select source.*,
      coalesce((
        select sum(greatest(0, lots.available_base))
        from app_private.inventory_source_lots(source.source_kind, source.source_id, source.canonical_unit) lots
      ), 0) as available_quantity
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
$function$;


CREATE OR REPLACE FUNCTION public.pos_allocate_consumption(p_order_id uuid, p_order_item_id uuid, p_order_item_addition_id uuid, p_source_kind text, p_source_id uuid, p_quantity_base numeric, p_base_unit stock_unit)
 RETURNS numeric
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  new_consumption_id uuid;
  remaining_base numeric := p_quantity_base;
  allocation_quantity numeric;
  allocation_cost numeric;
  total_cost numeric := 0;
  lot record;
begin
  if p_quantity_base <= 0 then
    raise exception 'La cantidad a consumir debe ser mayor a cero.';
  end if;

  insert into public.pos_order_consumptions (
    order_id, order_item_id, order_item_addition_id, source_kind, inventory_item_id, source_preparation_id,
    quantity_base, base_unit, cost_cop
  )
  values (
    p_order_id,
    p_order_item_id,
    p_order_item_addition_id,
    p_source_kind,
    case when p_source_kind = 'inventory_item' then p_source_id else null end,
    case when p_source_kind = 'preparation' then p_source_id else null end,
    p_quantity_base,
    p_base_unit,
    0
  )
  returning id into new_consumption_id;

  if p_source_kind = 'inventory_item' then
    for lot in
      select
        pi.id,
        pi.quantity,
        pi.unit,
        pi.line_total_cop,
        pi.expiration_date,
        p.purchased_at,
        lots.available_base
      from public.purchase_items pi
      join public.purchases p on p.id = pi.purchase_id
      join lateral app_private.inventory_source_lots(p_source_kind, p_source_id, p_base_unit) lots on lots.origin_id = pi.id
      where pi.inventory_item_id = p_source_id
      order by pi.expiration_date asc nulls last, p.purchased_at asc, pi.id asc
      for update of pi
    loop
      exit when remaining_base <= 0;
      if lot.available_base <= 0 then
        continue;
      end if;
      allocation_quantity := least(remaining_base, lot.available_base);
      allocation_cost := round(allocation_quantity * (lot.line_total_cop / nullif(public.production_convert_quantity(lot.quantity, lot.unit, p_base_unit, null), 0)), 2);

      insert into public.pos_order_consumption_allocations (
        consumption_id, purchase_item_id, quantity_base, base_unit, cost_cop
      )
      values (new_consumption_id, lot.id, allocation_quantity, p_base_unit, allocation_cost);

      remaining_base := remaining_base - allocation_quantity;
      total_cost := total_cost + allocation_cost;
    end loop;
  elsif p_source_kind = 'preparation' then
    for lot in
      select
        pb.id,
        pb.initial_quantity_base,
        pb.base_unit,
        pb.unit_cost_cop,
        pb.expiration_date,
        pb.elaborated_at,
        pb.production_number,
        lots.available_base
      from public.production_batches pb
      join lateral app_private.inventory_source_lots(p_source_kind, p_source_id, p_base_unit) lots on lots.origin_id = pb.id
      where pb.preparation_id = p_source_id
      order by pb.expiration_date asc, pb.elaborated_at asc, pb.production_number asc
      for update of pb
    loop
      exit when remaining_base <= 0;
      if lot.available_base <= 0 then
        continue;
      end if;
      allocation_quantity := least(remaining_base, lot.available_base);
      allocation_cost := round(allocation_quantity * lot.unit_cost_cop, 2);

      insert into public.pos_order_consumption_allocations (
        consumption_id, production_batch_id, quantity_base, base_unit, cost_cop
      )
      values (new_consumption_id, lot.id, allocation_quantity, p_base_unit, allocation_cost);

      remaining_base := remaining_base - allocation_quantity;
      total_cost := total_cost + allocation_cost;
    end loop;
  else
    raise exception 'Tipo de consumo no valido.';
  end if;

  if remaining_base > 0.0001 then
    raise exception 'Stock insuficiente. Faltan % %.', round(remaining_base, 3), upper(p_base_unit::text);
  end if;

  update public.pos_order_consumptions
  set cost_cop = round(total_cost, 2)
  where id = new_consumption_id;

  return round(total_cost, 2);
end;
$function$;


CREATE OR REPLACE FUNCTION public.create_production(p_preparation_id uuid, p_storage_method text, p_elaborated_at date, p_expiration_date date, p_expected_quantity numeric, p_expected_unit stock_unit, p_actual_quantity numeric, p_actual_unit stock_unit, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  preparation_row record;
  counter_row record;
  next_number bigint;
  new_production_id uuid;
  new_code text;
  expected_base numeric;
  actual_base numeric;
  total_cost numeric := 0;
  unit_cost numeric := 0;
  item jsonb;
  source_kind_value text;
  source_id_value uuid;
  source_base_unit public.stock_unit;
  source_unit_kind text;
  source_density numeric;
  requested_quantity numeric;
  requested_unit public.stock_unit;
  requested_base numeric;
  available_base numeric;
  remaining_base numeric;
  allocation_quantity numeric;
  allocation_cost numeric;
  consumption_id uuid;
  lot record;
begin
  if not app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]) then
    raise exception 'No tienes permisos para registrar produccion.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La produccion necesita al menos un ingrediente.';
  end if;

  select *
  into preparation_row
  from public.preparations
  where id = p_preparation_id
  for update;

  if not found then raise exception 'Preparacion no encontrada.'; end if;
  if not preparation_row.is_active then raise exception 'La preparacion debe estar activa.'; end if;
  if p_storage_method not in ('ambient', 'refrigerated', 'frozen') then raise exception 'Metodo de conservacion no valido.'; end if;

  if preparation_row.conservation_profile_id is not null and not exists (
    select 1
    from public.conservation_profile_rules
    where profile_id = preparation_row.conservation_profile_id
      and storage_method = p_storage_method
  ) then
    raise exception 'El metodo de conservacion no esta disponible para el perfil seleccionado.';
  end if;

  expected_base := public.production_convert_quantity(p_expected_quantity, p_expected_unit, preparation_row.base_unit, preparation_row.density);
  actual_base := public.production_convert_quantity(p_actual_quantity, p_actual_unit, preparation_row.base_unit, preparation_row.density);

  if expected_base <= 0 or actual_base <= 0 then raise exception 'Las cantidades deben ser mayores a cero.'; end if;
  if p_expiration_date < p_elaborated_at then raise exception 'El vencimiento no puede ser anterior a la elaboracion.'; end if;

  select *
  into counter_row
  from public.production_counters
  where id = true
  for update;

  next_number := counter_row.last_number + 1;
  new_code := 'P' || next_number::text;

  update public.production_counters
  set last_number = next_number
  where id = true;

  new_production_id := gen_random_uuid();

  insert into public.productions (
    id, production_number, code, preparation_id, storage_method, elaborated_at, created_by,
    expected_quantity_base, actual_quantity_base, base_unit, expiration_date, total_cost_cop, unit_cost_cop
  )
  values (
    new_production_id, next_number, new_code, p_preparation_id, p_storage_method, p_elaborated_at, auth.uid(),
    expected_base, actual_base, preparation_row.base_unit, p_expiration_date, 0, 0
  );

  for item in select * from jsonb_array_elements(p_items)
  loop
    source_kind_value := item->>'source_kind';
    source_id_value := (item->>'source_id')::uuid;
    requested_quantity := (item->>'quantity')::numeric;
    requested_unit := (item->>'unit')::public.stock_unit;

    if requested_quantity <= 0 then raise exception 'Cada ingrediente necesita cantidad mayor a cero.'; end if;

    if source_kind_value = 'inventory_item' then
      select
        case
          when unit in ('g', 'kg') then 'g'::public.stock_unit
          when unit in ('ml', 'l') then 'ml'::public.stock_unit
          else 'unit'::public.stock_unit
        end,
        public.production_unit_kind(
          case
            when unit in ('g', 'kg') then 'g'::public.stock_unit
            when unit in ('ml', 'l') then 'ml'::public.stock_unit
            else 'unit'::public.stock_unit
          end
        )
      into source_base_unit, source_unit_kind
      from public.inventory_items
      where id = source_id_value
        and is_active = true
        and item_kind = 'ingredient'
        and presentation_quantity is null;

      if source_base_unit is null then raise exception 'Ingrediente no valido.'; end if;
      requested_base := public.production_convert_quantity(requested_quantity, requested_unit, source_base_unit, null);

      select coalesce(sum(lots.available_base), 0)
      into available_base
      from app_private.inventory_source_lots('inventory_item', source_id_value, source_base_unit);

      if available_base < requested_base then
        raise exception 'Stock insuficiente para ingrediente %. Faltan %.', source_id_value, requested_base - available_base;
      end if;

      insert into public.production_consumptions (
        production_id, source_kind, inventory_item_id, quantity_base, base_unit, cost_cop
      )
      values (new_production_id, 'inventory_item', source_id_value, requested_base, source_base_unit, 0)
      returning id into consumption_id;

      remaining_base := requested_base;
      for lot in
        select
          pi.id,
          pi.quantity,
          pi.unit,
          pi.line_total_cop,
          pi.expiration_date,
          p.purchased_at,
          lots.available_base as available_quantity
        from public.purchase_items pi
        join public.purchases p on p.id = pi.purchase_id
        join lateral app_private.inventory_source_lots('inventory_item', source_id_value, source_base_unit) lots on lots.origin_id = pi.id
        where pi.inventory_item_id = source_id_value
          and lots.available_base > 0
        order by pi.expiration_date asc nulls last, p.purchased_at asc, pi.id asc
        for update of pi
      loop
        exit when remaining_base <= 0;
        allocation_quantity := least(remaining_base, lot.available_quantity);
        allocation_cost := round(allocation_quantity * (lot.line_total_cop / nullif(lot.quantity, 0)), 2);

        insert into public.production_consumption_allocations (
          consumption_id, purchase_item_id, quantity_base, base_unit, cost_cop
        )
        values (consumption_id, lot.id, allocation_quantity, source_base_unit, allocation_cost);

        remaining_base := remaining_base - allocation_quantity;
        total_cost := total_cost + allocation_cost;
      end loop;

      if remaining_base > 0.0001 then raise exception 'Stock insuficiente durante la asignacion FEFO.'; end if;

      update public.production_consumptions
      set cost_cop = (
        select coalesce(sum(pca.cost_cop), 0)
        from public.production_consumption_allocations pca
        where pca.consumption_id = public.production_consumptions.id
      )
      where id = consumption_id;

    elsif source_kind_value = 'preparation' then
      select base_unit, unit_kind, density
      into source_base_unit, source_unit_kind, source_density
      from public.preparations
      where id = source_id_value
        and is_active = true;

      if source_base_unit is null then raise exception 'Preparacion ingrediente no valida.'; end if;
      requested_base := public.production_convert_quantity(requested_quantity, requested_unit, source_base_unit, source_density);

      select coalesce(sum(lots.available_base), 0)
      into available_base
      from app_private.inventory_source_lots('preparation', source_id_value, source_base_unit);

      if available_base < requested_base then
        raise exception 'Stock insuficiente para preparacion %. Faltan %.', source_id_value, requested_base - available_base;
      end if;

      insert into public.production_consumptions (
        production_id, source_kind, source_preparation_id, quantity_base, base_unit, cost_cop
      )
      values (new_production_id, 'preparation', source_id_value, requested_base, source_base_unit, 0)
      returning id into consumption_id;

      remaining_base := requested_base;
      for lot in
        select
          pb.id,
          pb.initial_quantity_base,
          pb.unit_cost_cop,
          pb.expiration_date,
          pb.elaborated_at,
          pb.production_number,
          lots.available_base as available_quantity
        from public.production_batches pb
        join lateral app_private.inventory_source_lots('preparation', source_id_value, source_base_unit) lots on lots.origin_id = pb.id
        where pb.preparation_id = source_id_value
          and lots.available_base > 0
        order by pb.expiration_date asc, pb.elaborated_at asc, pb.production_number asc
        for update of pb
      loop
        exit when remaining_base <= 0;
        allocation_quantity := least(remaining_base, lot.available_quantity);
        allocation_cost := round(allocation_quantity * lot.unit_cost_cop, 2);

        insert into public.production_consumption_allocations (
          consumption_id, production_batch_id, quantity_base, base_unit, cost_cop
        )
        values (consumption_id, lot.id, allocation_quantity, source_base_unit, allocation_cost);

        remaining_base := remaining_base - allocation_quantity;
        total_cost := total_cost + allocation_cost;
      end loop;

      if remaining_base > 0.0001 then raise exception 'Stock insuficiente durante la asignacion FEFO.'; end if;

      update public.production_consumptions
      set cost_cop = (
        select coalesce(sum(pca.cost_cop), 0)
        from public.production_consumption_allocations pca
        where pca.consumption_id = public.production_consumptions.id
      )
      where id = consumption_id;
    else
      raise exception 'Tipo de ingrediente no valido.';
    end if;
  end loop;

  unit_cost := case when actual_base > 0 then total_cost / actual_base else 0 end;

  update public.productions
  set total_cost_cop = round(total_cost, 2),
      unit_cost_cop = round(unit_cost, 6)
  where id = new_production_id;

  insert into public.production_batches (
    batch_kind, production_id, preparation_id, initial_quantity_base, base_unit,
    unit_cost_cop, expiration_date, elaborated_at, production_number
  )
  values (
    'production', new_production_id, p_preparation_id, actual_base, preparation_row.base_unit,
    round(unit_cost, 6), p_expiration_date, p_elaborated_at, next_number
  );

  return jsonb_build_object(
    'id', new_production_id,
    'code', new_code,
    'total_cost_cop', round(total_cost, 2),
    'unit_cost_cop', round(unit_cost, 6),
    'expiration_date', p_expiration_date,
    'actual_quantity_base', actual_base,
    'base_unit', preparation_row.base_unit
  );
end;
$function$;


notify pgrst, 'reload schema';
