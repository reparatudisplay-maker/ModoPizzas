-- production_convert_quantity accepts positive quantities only. Preserve the
-- sign of physical-count deltas before passing their magnitude to conversion.

do $$
declare
  function_definition text;
  previous_expression text := 'public.production_convert_quantity(count_row.difference_quantity_base, count_row.base_unit, p_base_unit, null)';
  replacement_expression text := $expression$
case when count_row.difference_quantity_base < 0
            then -public.production_convert_quantity(-count_row.difference_quantity_base, count_row.base_unit, p_base_unit, null)
            else public.production_convert_quantity(count_row.difference_quantity_base, count_row.base_unit, p_base_unit, null)
          end$expression$;
begin
  select pg_get_functiondef(
    'app_private.inventory_source_lots(text,uuid,public.stock_unit)'::regprocedure
  ) into function_definition;

  if position(previous_expression in function_definition) = 0 then
    raise exception 'La función de lotes no coincide con la versión esperada.';
  end if;

  execute replace(function_definition, previous_expression, replacement_expression);
end;
$$;

notify pgrst, 'reload schema';
