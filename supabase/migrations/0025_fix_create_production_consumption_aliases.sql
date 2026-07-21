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
    'select coalesce(sum(cost_cop), 0)
        from public.production_consumption_allocations
        where consumption_id = production_consumptions.id',
    'select coalesce(sum(pca.cost_cop), 0)
        from public.production_consumption_allocations pca
        where pca.consumption_id = public.production_consumptions.id'
  );

  execute function_sql;
end $$;

notify pgrst, 'reload schema';
