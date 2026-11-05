-- The allocation and debt records both have a base_unit column. Keep the
-- post-transaction stock verification explicitly anchored to the debt source.

do $fix_regularization_source_ambiguity$
declare
  definition text;
  old_fragment text := E'    select source_id, base_unit\n    from public.pos_inventory_regularization_allocations allocation';
  new_fragment text := E'    select debt.source_id, debt.base_unit\n    from public.pos_inventory_regularization_allocations allocation';
begin
  select pg_get_functiondef('public.regularize_pending_pos_inventory_debts(text)'::regprocedure)
  into definition;

  if position(old_fragment in definition) = 0 then
    raise exception 'La función de regularización pendiente no coincide con la versión esperada.';
  end if;

  execute replace(definition, old_fragment, new_fragment);
end;
$fix_regularization_source_ambiguity$;

notify pgrst, 'reload schema';
