do $$
declare
  function_sql text;
begin
  select pg_get_functiondef(
    'public.create_production(uuid, text, date, date, numeric, public.stock_unit, numeric, public.stock_unit, jsonb)'::regprocedure
  )
  into function_sql;

  function_sql := replace(
    function_sql,
    'from app_private.inventory_source_lots(''inventory_item'', source_id_value, source_base_unit);',
    'from app_private.inventory_source_lots(''inventory_item'', source_id_value, source_base_unit) lots;'
  );
  function_sql := replace(
    function_sql,
    'from app_private.inventory_source_lots(''preparation'', source_id_value, source_base_unit);',
    'from app_private.inventory_source_lots(''preparation'', source_id_value, source_base_unit) lots;'
  );

  if position('from app_private.inventory_source_lots(''inventory_item'', source_id_value, source_base_unit) lots;' in function_sql) = 0 then
    raise exception 'No se encontro el alias de lotes de ingredientes en create_production.';
  end if;
  if position('from app_private.inventory_source_lots(''preparation'', source_id_value, source_base_unit) lots;' in function_sql) = 0 then
    raise exception 'No se encontro el alias de lotes de preparaciones en create_production.';
  end if;

  execute function_sql;
end;
$$;

notify pgrst, 'reload schema';
