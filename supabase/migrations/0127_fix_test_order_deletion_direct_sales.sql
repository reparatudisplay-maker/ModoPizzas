-- A test-only hard deletion must remove direct-purchase records before the
-- cash movements they reference. Regular order cancellations remain unchanged.

do $$
declare
  function_definition text;
  previous_section text := $section$
  -- A hard delete must not change a closed cash session. Open-session movements
  -- are removed together with the test order so the open cash balance stays correct.
  update public.pos_order_payments
  set cash_movement_id = null
  where order_id = p_order_id;
$section$;
  replacement_section text := $section$
  -- Test-only hard deletion removes its direct purchases before their linked
  -- cash movements. Regular order cancellations retain those purchases.
  delete from public.direct_sale_purchases where order_id = p_order_id;

  -- A hard delete must not change a closed cash session. Open-session movements
  -- are removed together with the test order so the open cash balance stays correct.
  update public.pos_order_payments
  set cash_movement_id = null
  where order_id = p_order_id;
$section$;
begin
  select pg_get_functiondef(
    'public.delete_pos_order_for_testing(uuid,uuid[],text,text)'::regprocedure
  ) into function_definition;

  if position(previous_section in function_definition) = 0 then
    raise exception 'La función de eliminación de pedidos de prueba no coincide con la versión esperada.';
  end if;

  execute replace(function_definition, previous_section, replacement_section);
end;
$$;

notify pgrst, 'reload schema';
