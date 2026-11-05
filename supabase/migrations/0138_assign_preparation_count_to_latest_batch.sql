-- A physical count without a lot detail belongs to the latest preparation
-- batch that existed when the count was taken, not the furthest expiration.

do $migration$
declare
  definition text;
  previous_block text := $previous$
      baseline_origin_index := null;
      for origin_index in reverse origin_count..1 loop
        if origin_dates[origin_index] <= latest_count_at then
          baseline_origin_index := origin_index;
          exit;
        end if;
      end loop;
$previous$;
  next_block text := $next$
      baseline_origin_index := null;
      for origin_index in 1..origin_count loop
        if origin_dates[origin_index] <= latest_count_at
          and (
            baseline_origin_index is null
            or origin_dates[origin_index] > origin_dates[baseline_origin_index]
            or (
              origin_dates[origin_index] = origin_dates[baseline_origin_index]
              and origin_sequences[origin_index] > origin_sequences[baseline_origin_index]
            )
          ) then
          baseline_origin_index := origin_index;
        end if;
      end loop;
$next$;
begin
  select pg_get_functiondef('app_private.inventory_source_lots(text,uuid,public.stock_unit)'::regprocedure)
    into definition;

  if position(previous_block in definition) = 0 then
    raise exception 'La seleccion de lote para conteos de preparacion no coincide con la version esperada.';
  end if;

  execute replace(definition, previous_block, next_block);
end;
$migration$;

notify pgrst, 'reload schema';
