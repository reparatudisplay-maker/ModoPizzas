-- Physical counts are point-in-time adjustments. Apply stock entries, allocations,
-- and counts in chronological order so a later sale cannot be revived by a count.

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
  event_row record;
  origin_ids uuid[] := array[]::uuid[];
  origin_stocks numeric[] := array[]::numeric[];
  origin_dates timestamptz[] := array[]::timestamptz[];
  origin_expirations date[] := array[]::date[];
  origin_sequences bigint[] := array[]::bigint[];
  origin_index integer;
  eligible_index integer;
  target_index integer;
  pending numeric;
  moved numeric;
  origin_count integer;
begin
  if p_source_kind = 'inventory_item' then
    for lot in
      select pi.id, p.purchased_at as occurred_at, pi.expiration_date, 0::bigint as sequence
      from public.purchase_items pi
      join public.purchases p on p.id = pi.purchase_id
      where pi.inventory_item_id = p_source_id
      order by pi.expiration_date asc nulls last, p.purchased_at asc, pi.id asc
    loop
      origin_ids := array_append(origin_ids, lot.id);
      origin_stocks := array_append(origin_stocks, 0);
      origin_dates := array_append(origin_dates, lot.occurred_at);
      origin_expirations := array_append(origin_expirations, lot.expiration_date);
      origin_sequences := array_append(origin_sequences, lot.sequence);
    end loop;
  elsif p_source_kind = 'preparation' then
    for lot in
      select pb.id, pb.elaborated_at::timestamptz as occurred_at, pb.expiration_date,
        coalesce(pb.production_number, 0)::bigint as sequence
      from public.production_batches pb
      where pb.preparation_id = p_source_id
      order by pb.expiration_date asc, pb.elaborated_at asc, pb.production_number asc
    loop
      origin_ids := array_append(origin_ids, lot.id);
      origin_stocks := array_append(origin_stocks, 0);
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

  if p_source_kind = 'inventory_item' then
    for event_row in
      select * from (
        select p.purchased_at as event_at, 0 as event_order, 'entry'::text as event_kind, pi.id as event_origin_id,
          public.production_convert_quantity(pi.quantity, pi.unit, p_base_unit, null) as quantity_base
        from public.purchase_items pi
        join public.purchases p on p.id = pi.purchase_id
        where pi.inventory_item_id = p_source_id

        union all

        select pca.created_at, 1, 'allocation', pca.purchase_item_id,
          public.production_convert_quantity(pca.quantity_base, pca.base_unit, p_base_unit, null)
        from public.production_consumption_allocations pca
        join public.purchase_items pi on pi.id = pca.purchase_item_id
        where pi.inventory_item_id = p_source_id

        union all

        select poca.created_at, 1, 'allocation', poca.purchase_item_id,
          public.production_convert_quantity(poca.quantity_base, poca.base_unit, p_base_unit, null)
        from public.pos_order_consumption_allocations poca
        join public.pos_order_consumptions poc on poc.id = poca.consumption_id
        join public.pos_orders po on po.id = poc.order_id
        join public.purchase_items pi on pi.id = poca.purchase_item_id
        where pi.inventory_item_id = p_source_id
          and po.status <> 'cancelled'

        union all

        select count_row.created_at, 2, 'count', null::uuid,
          case when count_row.difference_quantity_base < 0
            then -public.production_convert_quantity(-count_row.difference_quantity_base, count_row.base_unit, p_base_unit, null)
            else public.production_convert_quantity(count_row.difference_quantity_base, count_row.base_unit, p_base_unit, null)
          end
        from public.physical_inventory_counts count_row
        where count_row.voided_at is null and count_row.inventory_item_id = p_source_id
      ) events
      order by event_at, event_order, event_origin_id nulls last
    loop
      if event_row.event_kind = 'entry' then
        for origin_index in 1..origin_count loop
          if origin_ids[origin_index] = event_row.event_origin_id then
            origin_stocks[origin_index] := origin_stocks[origin_index] + event_row.quantity_base;
            exit;
          end if;
        end loop;
      elsif event_row.event_kind = 'allocation' then
        pending := event_row.quantity_base;
        target_index := null;
        for origin_index in 1..origin_count loop
          if origin_ids[origin_index] = event_row.event_origin_id then
            target_index := origin_index;
            exit;
          end if;
        end loop;
        if target_index is not null and origin_dates[target_index] <= event_row.event_at then
          moved := least(greatest(0, origin_stocks[target_index]), pending);
          origin_stocks[target_index] := origin_stocks[target_index] - moved;
          pending := pending - moved;
        end if;
        for eligible_index in 1..origin_count loop
          exit when pending <= 0;
          if eligible_index = target_index or origin_dates[eligible_index] > event_row.event_at then
            continue;
          end if;
          moved := least(greatest(0, origin_stocks[eligible_index]), pending);
          origin_stocks[eligible_index] := origin_stocks[eligible_index] - moved;
          pending := pending - moved;
        end loop;
      else
        pending := abs(event_row.quantity_base);
        if event_row.quantity_base < 0 then
          for eligible_index in 1..origin_count loop
            exit when pending <= 0;
            if origin_dates[eligible_index] > event_row.event_at then
              continue;
            end if;
            moved := least(greatest(0, origin_stocks[eligible_index]), pending);
            origin_stocks[eligible_index] := origin_stocks[eligible_index] - moved;
            pending := pending - moved;
          end loop;
        elsif event_row.quantity_base > 0 then
          for eligible_index in 1..origin_count loop
            if origin_dates[eligible_index] <= event_row.event_at then
              origin_stocks[eligible_index] := origin_stocks[eligible_index] + event_row.quantity_base;
              exit;
            end if;
          end loop;
        end if;
      end if;
    end loop;
  else
    for event_row in
      select * from (
        select pb.elaborated_at::timestamptz as event_at, 0 as event_order, 'entry'::text as event_kind, pb.id as event_origin_id,
          public.production_convert_quantity(pb.initial_quantity_base, pb.base_unit, p_base_unit, null) as quantity_base
        from public.production_batches pb
        where pb.preparation_id = p_source_id

        union all

        select pca.created_at, 1, 'allocation', pca.production_batch_id,
          public.production_convert_quantity(pca.quantity_base, pca.base_unit, p_base_unit, null)
        from public.production_consumption_allocations pca
        join public.production_batches pb on pb.id = pca.production_batch_id
        where pb.preparation_id = p_source_id

        union all

        select poca.created_at, 1, 'allocation', poca.production_batch_id,
          public.production_convert_quantity(poca.quantity_base, poca.base_unit, p_base_unit, null)
        from public.pos_order_consumption_allocations poca
        join public.pos_order_consumptions poc on poc.id = poca.consumption_id
        join public.pos_orders po on po.id = poc.order_id
        join public.production_batches pb on pb.id = poca.production_batch_id
        where pb.preparation_id = p_source_id
          and po.status <> 'cancelled'

        union all

        select count_row.created_at, 2, 'count', null::uuid,
          case when count_row.difference_quantity_base < 0
            then -public.production_convert_quantity(-count_row.difference_quantity_base, count_row.base_unit, p_base_unit, null)
            else public.production_convert_quantity(count_row.difference_quantity_base, count_row.base_unit, p_base_unit, null)
          end
        from public.physical_inventory_counts count_row
        where count_row.voided_at is null and count_row.source_preparation_id = p_source_id
      ) events
      order by event_at, event_order, event_origin_id nulls last
    loop
      if event_row.event_kind = 'entry' then
        for origin_index in 1..origin_count loop
          if origin_ids[origin_index] = event_row.event_origin_id then
            origin_stocks[origin_index] := origin_stocks[origin_index] + event_row.quantity_base;
            exit;
          end if;
        end loop;
      elsif event_row.event_kind = 'allocation' then
        pending := event_row.quantity_base;
        target_index := null;
        for origin_index in 1..origin_count loop
          if origin_ids[origin_index] = event_row.event_origin_id then
            target_index := origin_index;
            exit;
          end if;
        end loop;
        if target_index is not null and origin_dates[target_index] <= event_row.event_at then
          moved := least(greatest(0, origin_stocks[target_index]), pending);
          origin_stocks[target_index] := origin_stocks[target_index] - moved;
          pending := pending - moved;
        end if;
        for eligible_index in 1..origin_count loop
          exit when pending <= 0;
          if eligible_index = target_index or origin_dates[eligible_index] > event_row.event_at then
            continue;
          end if;
          moved := least(greatest(0, origin_stocks[eligible_index]), pending);
          origin_stocks[eligible_index] := origin_stocks[eligible_index] - moved;
          pending := pending - moved;
        end loop;
      else
        pending := abs(event_row.quantity_base);
        if event_row.quantity_base < 0 then
          for eligible_index in 1..origin_count loop
            exit when pending <= 0;
            if origin_dates[eligible_index] > event_row.event_at then
              continue;
            end if;
            moved := least(greatest(0, origin_stocks[eligible_index]), pending);
            origin_stocks[eligible_index] := origin_stocks[eligible_index] - moved;
            pending := pending - moved;
          end loop;
        elsif event_row.quantity_base > 0 then
          for eligible_index in 1..origin_count loop
            if origin_dates[eligible_index] <= event_row.event_at then
              origin_stocks[eligible_index] := origin_stocks[eligible_index] + event_row.quantity_base;
              exit;
            end if;
          end loop;
        end if;
      end if;
    end loop;
  end if;

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

notify pgrst, 'reload schema';
