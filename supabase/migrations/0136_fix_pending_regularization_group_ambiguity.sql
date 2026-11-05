do $fix_regularization_group_ambiguity$
declare
  definition text;
  old_fragment text := E'    where debt.id = any(v_debt_ids)\n    group by source_id, base_unit\n  loop';
  new_fragment text := E'    where debt.id = any(v_debt_ids)\n    group by debt.source_id, debt.base_unit\n  loop';
begin
  select pg_get_functiondef('public.regularize_pending_pos_inventory_debts(text)'::regprocedure)
  into definition;
  if position(old_fragment in definition) = 0 then
    raise exception 'La función de regularización pendiente no coincide con la versión esperada.';
  end if;
  execute replace(definition, old_fragment, new_fragment);
end;
$fix_regularization_group_ambiguity$;

notify pgrst, 'reload schema';
