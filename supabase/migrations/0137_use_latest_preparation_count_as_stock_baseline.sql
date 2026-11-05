-- A physical count is an absolute observation. For preparations, replaying the
-- prior differences can erase the most recent confirmed stock when a batch was
-- previously entered with an incorrect quantity. Reset pre-count lots to the
-- latest count and only deduct allocations made afterwards.

do $migration$
declare
  definition text;
  final_loop text := E'  for origin_index in 1..origin_count loop\n    origin_id := origin_ids[origin_index];';
  replacement text := $replacement$
  if p_source_kind = 'preparation' then
    select count_row.created_at,
      public.production_convert_quantity(count_row.physical_quantity_base, count_row.base_unit, p_base_unit, null)
    into latest_count_at, latest_count_quantity
    from public.physical_inventory_counts count_row
    where count_row.source_preparation_id = p_source_id
      and count_row.voided_at is null
    order by count_row.created_at desc, count_row.id desc
    limit 1;

    if latest_count_at is not null then
      baseline_origin_index := null;
      for origin_index in reverse origin_count..1 loop
        if origin_dates[origin_index] <= latest_count_at then
          baseline_origin_index := origin_index;
          exit;
        end if;
      end loop;

      if baseline_origin_index is not null then
        select coalesce(sum(allocation_quantity), 0)
          into post_count_consumed
        from (
          select public.production_convert_quantity(allocation.quantity_base, allocation.base_unit, p_base_unit, null) as allocation_quantity
          from public.production_consumption_allocations allocation
          join public.production_batches batch on batch.id = allocation.production_batch_id
          where batch.preparation_id = p_source_id
            and batch.elaborated_at::timestamptz <= latest_count_at
            and allocation.created_at > latest_count_at

          union all

          select public.production_convert_quantity(allocation.quantity_base, allocation.base_unit, p_base_unit, null)
          from public.pos_order_consumption_allocations allocation
          join public.pos_order_consumptions consumption on consumption.id = allocation.consumption_id
          join public.pos_orders order_header on order_header.id = consumption.order_id
          join public.production_batches batch on batch.id = allocation.production_batch_id
          where batch.preparation_id = p_source_id
            and batch.elaborated_at::timestamptz <= latest_count_at
            and allocation.created_at > latest_count_at
            and order_header.status <> 'cancelled'
        ) post_count_allocations;

        for origin_index in 1..origin_count loop
          if origin_dates[origin_index] <= latest_count_at then
            origin_stocks[origin_index] := 0;
          end if;
        end loop;

        origin_stocks[baseline_origin_index] := greatest(0, latest_count_quantity - post_count_consumed);
      end if;
    end if;
  end if;

  for origin_index in 1..origin_count loop
    origin_id := origin_ids[origin_index];$replacement$;
begin
  select pg_get_functiondef('app_private.inventory_source_lots(text,uuid,public.stock_unit)'::regprocedure)
    into definition;

  if position(final_loop in definition) = 0 then
    raise exception 'La funcion de disponibilidad no coincide con la version auditada.';
  end if;

  definition := replace(
    definition,
    '  origin_count integer;',
    E'  origin_count integer;\n  latest_count_at timestamptz;\n  latest_count_quantity numeric;\n  baseline_origin_index integer;\n  post_count_consumed numeric;'
  );
  execute replace(definition, final_loop, replacement);
end;
$migration$;

notify pgrst, 'reload schema';
