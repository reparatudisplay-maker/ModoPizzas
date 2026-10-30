-- Merchandise values accept cents; transport remains integer COP by business rule.
do $precision$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.save_purchase_with_items(uuid,uuid,text,timestamptz,numeric,jsonb)'::regprocedure)
    into v_definition;

  if position('or coalesce((v_line->>''merchandise_total_cop'')::numeric, 0) <> trunc((v_line->>''merchandise_total_cop'')::numeric)' in v_definition) = 0 then
    raise exception 'La validacion de valor de mercancia no coincide con la version auditada.';
  end if;

  v_definition := replace(
    v_definition,
    'or coalesce((v_line->>''merchandise_total_cop'')::numeric, 0) <> trunc((v_line->>''merchandise_total_cop'')::numeric)',
    ''
  );
  execute v_definition;
end;
$precision$;

notify pgrst, 'reload schema';
