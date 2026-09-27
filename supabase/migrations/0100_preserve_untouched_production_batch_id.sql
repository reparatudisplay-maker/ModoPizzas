begin;

do $migration$
declare
  function_sql text;
  original_statement text := 'set production_id = existing_production.id, production_number = existing_production.production_number';
  replacement_statement text := 'set id = existing_batch.id, production_id = existing_production.id, production_number = existing_production.production_number';
begin
  select pg_get_functiondef(
    'public.update_production(uuid, uuid, text, date, date, numeric, public.stock_unit, numeric, public.stock_unit, jsonb)'::regprocedure
  ) into function_sql;

  if position(original_statement in function_sql) = 0 then
    raise exception 'No se encontró la actualización de lote esperada en public.update_production.';
  end if;

  function_sql := replace(function_sql, original_statement, replacement_statement);
  execute function_sql;
end;
$migration$;

notify pgrst, 'reload schema';

commit;
