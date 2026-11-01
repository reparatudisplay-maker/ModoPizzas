-- A mixed order with a direct sale first records its regular lines. Keep the
-- final total and cash figures in the same row update so the cash check is
-- valid throughout the transaction.
do $$
declare
  definition text;
  old_update text := 'update public.pos_orders set subtotal_cop = round(order_row.subtotal_cop + direct_total, 2), total_cop = final_total, updated_at = now() where id = v_order_id;';
  new_update text := $replacement$
update public.pos_orders
set subtotal_cop = round(order_row.subtotal_cop + direct_total, 2),
    total_cop = final_total,
    cash_received_cop = case when p_payment_method = 'cash' then p_cash_received_cop else cash_received_cop end,
    cash_change_cop = case when p_payment_method = 'cash' then round(p_cash_received_cop - final_total, 2) else cash_change_cop end,
    updated_at = now()
where id = v_order_id;$replacement$;
begin
  select pg_get_functiondef(
    'public.create_pos_order_with_direct_sales(text,text,text,text,numeric,numeric,numeric,text,text,text,text,jsonb,numeric,numeric,jsonb)'::regprocedure
  ) into definition;

  if position(old_update in definition) = 0 then
    raise exception 'La función de venta libre no coincide con la versión esperada.';
  end if;

  execute replace(definition, old_update, new_update);
end;
$$;

notify pgrst, 'reload schema';
