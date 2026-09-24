-- Normalize signed physical adjustments before unit conversion.
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
    adjustment := case
      when coalesce(count_row.difference_quantity_base, 0) = 0 then 0
      when count_row.difference_quantity_base > 0 then public.production_convert_quantity(
        count_row.difference_quantity_base,
        count_row.base_unit,
        p_base_unit,
        null
      )
      else -public.production_convert_quantity(
        abs(count_row.difference_quantity_base),
        count_row.base_unit,
        p_base_unit,
        null
      )
    end;

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
grant execute on function app_private.inventory_source_lots(text, uuid, public.stock_unit) to anon, authenticated;;

notify pgrst, 'reload schema';

