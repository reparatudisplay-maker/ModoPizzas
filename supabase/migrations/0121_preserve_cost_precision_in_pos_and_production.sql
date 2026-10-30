-- Keep derived cost snapshots precise through POS and production creation.

do $precision$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.create_pos_order(text,text,text,numeric,numeric,text,text,jsonb)'::regprocedure)
    into v_definition;
  if position('set line_cost_cop = round(item_cost, 2)' in v_definition) = 0 then
    raise exception 'La funcion POS no coincide con la version auditada para ampliar precision.';
  end if;
  v_definition := replace(v_definition, 'set line_cost_cop = round(item_cost, 2)', 'set line_cost_cop = item_cost');
  execute v_definition;

  select pg_get_functiondef('public.create_production(uuid,text,date,date,numeric,public.stock_unit,numeric,public.stock_unit,jsonb)'::regprocedure)
    into v_definition;
  if position('allocation_cost := round(allocation_quantity * (lot.line_total_cop / nullif(lot.quantity, 0)), 2);' in v_definition) = 0
    or position('allocation_cost := round(allocation_quantity * lot.unit_cost_cop, 2);' in v_definition) = 0 then
    raise exception 'La funcion de produccion no coincide con la version auditada para ampliar precision.';
  end if;
  v_definition := replace(v_definition, 'allocation_cost := round(allocation_quantity * (lot.line_total_cop / nullif(lot.quantity, 0)), 2);', 'allocation_cost := allocation_quantity * (lot.line_total_cop / nullif(lot.quantity, 0));');
  v_definition := replace(v_definition, 'allocation_cost := round(allocation_quantity * lot.unit_cost_cop, 2);', 'allocation_cost := allocation_quantity * lot.unit_cost_cop;');
  v_definition := replace(v_definition, 'set total_cost_cop = round(total_cost, 2),', 'set total_cost_cop = total_cost,');
  v_definition := replace(v_definition, '''total_cost_cop'', round(total_cost, 2),', '''total_cost_cop'', total_cost,');
  execute v_definition;
end;
$precision$;

notify pgrst, 'reload schema';
