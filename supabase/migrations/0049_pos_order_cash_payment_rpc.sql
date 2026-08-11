create or replace function public.create_pos_order_with_payment(
  p_kind text,
  p_customer_name text,
  p_customer_phone text,
  p_discount_cop numeric,
  p_delivery_cop numeric,
  p_payment_method text,
  p_notes text,
  p_items jsonb,
  p_cash_received_cop numeric default null,
  p_cash_change_cop numeric default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  created_order jsonb;
  payment_record jsonb;
begin
  if p_payment_method = 'cash' then
    if p_cash_received_cop is null or p_cash_received_cop <= 0 then
      raise exception 'Confirma el cobro en efectivo.';
    end if;
    if p_cash_change_cop is null or p_cash_change_cop < 0 then
      raise exception 'El cambio no puede ser negativo.';
    end if;
  end if;

  created_order := public.create_pos_order(
    p_kind,
    p_customer_name,
    p_customer_phone,
    p_discount_cop,
    p_delivery_cop,
    p_payment_method,
    p_notes,
    p_items
  );

  if p_payment_method = 'cash' then
    payment_record := public.record_pos_cash_payment(
      (created_order->>'id')::uuid,
      p_cash_received_cop,
      p_cash_change_cop
    );

    return created_order || jsonb_build_object(
      'cash_received_cop', payment_record->'cash_received_cop',
      'cash_change_cop', payment_record->'cash_change_cop'
    );
  end if;

  return created_order;
end;
$$;

grant execute on function public.create_pos_order_with_payment(text, text, text, numeric, numeric, text, text, jsonb, numeric, numeric) to authenticated;

notify pgrst, 'reload schema';
