begin;

create function public.create_pos_order_with_platform_payment_with_commission(
  p_kind text, p_customer_name text, p_customer_phone text, p_discount_type text, p_discount_value numeric, p_discount_cop numeric, p_delivery_cop numeric,
  p_payment_method text, p_source_channel text, p_collection_party text, p_notes text, p_items jsonb,
  p_cash_received_cop numeric default null, p_cash_change_cop numeric default null, p_estimated_commission_cop numeric default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  created_order jsonb;
  created_order_id uuid;
  order_total numeric;
begin
  if p_estimated_commission_cop is not null and p_estimated_commission_cop < 0 then
    raise exception 'La comisión estimada no puede ser negativa.';
  end if;
  if p_estimated_commission_cop is not null and p_collection_party <> 'platform' then
    raise exception 'La comisión estimada solo aplica a ventas recaudadas por plataforma.';
  end if;

  created_order := public.create_pos_order_with_platform_payment(
    p_kind, p_customer_name, p_customer_phone, p_discount_type, p_discount_value, p_discount_cop, p_delivery_cop,
    p_payment_method, p_source_channel, p_collection_party, p_notes, p_items, p_cash_received_cop, p_cash_change_cop
  );

  if p_estimated_commission_cop is not null then
    created_order_id := (created_order->>'id')::uuid;
    select total_cop into order_total from public.pos_orders where id = created_order_id;
    if p_estimated_commission_cop > order_total then
      raise exception 'La comisión estimada no puede superar la venta bruta.';
    end if;

    update public.platform_receivables
    set estimated_commission_cop = round(p_estimated_commission_cop, 2),
        net_expected_cop = greatest(0, round(order_total - p_estimated_commission_cop, 2))
    where order_id = created_order_id;

    if not found then
      raise exception 'No se encontró la cuenta por cobrar de la plataforma.';
    end if;
  end if;

  return created_order;
end $$;

revoke execute on function public.create_pos_order_with_platform_payment_with_commission(text, text, text, text, numeric, numeric, numeric, text, text, text, text, jsonb, numeric, numeric, numeric) from public;
grant execute on function public.create_pos_order_with_platform_payment_with_commission(text, text, text, text, numeric, numeric, numeric, text, text, text, text, jsonb, numeric, numeric, numeric) to authenticated;

notify pgrst, 'reload schema';
commit;
