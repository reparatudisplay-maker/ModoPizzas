-- Preserve six decimal places for cost calculations. Monetary totals remain
-- represented exactly as entered; only derived unit and consumption costs gain precision.

do $precision$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.save_purchase_with_items(uuid,uuid,text,timestamptz,numeric,jsonb)'::regprocedure)
    into v_definition;

  if position('round(v_line_total / nullif((v_line->>''quantity'')::numeric, 0), 2)' in v_definition) = 0
    or position('then round(sum(purchase_item.line_total_cop) / sum(purchase_item.quantity), 2)' in v_definition) = 0 then
    raise exception 'La funcion de compras no coincide con la version auditada para ampliar precision.';
  end if;

  v_definition := replace(
    v_definition,
    'round(v_line_total / nullif((v_line->>''quantity'')::numeric, 0), 2)',
    'v_line_total / nullif((v_line->>''quantity'')::numeric, 0)'
  );
  v_definition := replace(
    v_definition,
    'then round(sum(purchase_item.line_total_cop) / sum(purchase_item.quantity), 2)',
    'then sum(purchase_item.line_total_cop) / sum(purchase_item.quantity)'
  );
  execute v_definition;

  select pg_get_functiondef('public.pos_allocate_consumption(uuid,uuid,uuid,text,uuid,numeric,public.stock_unit)'::regprocedure)
    into v_definition;

  if position('allocation_cost := round(allocation_quantity * (lot.line_total_cop' in v_definition) = 0
    or position('allocation_cost := round(allocation_quantity * lot.unit_cost_cop, 2)' in v_definition) = 0 then
    raise exception 'La funcion de consumo no coincide con la version auditada para ampliar precision.';
  end if;

  v_definition := replace(v_definition, 'allocation_cost := round(allocation_quantity * (lot.line_total_cop / nullif(public.production_convert_quantity(lot.quantity, lot.unit, p_base_unit, null), 0)), 2);', 'allocation_cost := allocation_quantity * (lot.line_total_cop / nullif(public.production_convert_quantity(lot.quantity, lot.unit, p_base_unit, null), 0));');
  v_definition := replace(v_definition, 'allocation_cost := round(allocation_quantity * lot.unit_cost_cop, 2);', 'allocation_cost := allocation_quantity * lot.unit_cost_cop;');
  v_definition := replace(v_definition, 'set cost_cop = round(total_cost, 2)', 'set cost_cop = total_cost');
  v_definition := replace(v_definition, 'return round(total_cost, 2);', 'return total_cost;');
  execute v_definition;
end;
$precision$;

notify pgrst, 'reload schema';
