-- Keeps the temporary regularization flag available through all nested POS writers.
-- It is reset on both success and failure so pooled connections cannot reuse it.

create or replace function public.create_pos_order_with_pending_stock(
  p_kind text, p_customer_name text, p_customer_phone text, p_discount_type text,
  p_discount_value numeric, p_discount_cop numeric, p_delivery_cop numeric,
  p_payment_method text, p_source_channel text, p_collection_party text, p_notes text,
  p_items jsonb, p_cash_received_cop numeric default null, p_cash_change_cop numeric default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  created_order jsonb;
begin
  if not app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]) then
    raise exception 'Solo Gerente o Administrador del sistema puede registrar faltantes pendientes.';
  end if;
  if p_collection_party <> 'business' or p_source_channel <> 'direct' then
    raise exception 'La regularización temporal de faltantes no está disponible para plataformas.';
  end if;

  -- SET LOCAL was restored before nested inventory allocations on this RPC path.
  perform set_config('app.allow_pending_inventory_regularization', 'true', false);
  begin
    created_order := public.create_pos_order_with_platform_payment(
      p_kind, p_customer_name, p_customer_phone, p_discount_type, p_discount_value,
      p_discount_cop, p_delivery_cop, p_payment_method, p_source_channel,
      p_collection_party, p_notes, p_items, p_cash_received_cop, p_cash_change_cop
    );
  exception when others then
    perform set_config('app.allow_pending_inventory_regularization', 'false', false);
    raise;
  end;
  perform set_config('app.allow_pending_inventory_regularization', 'false', false);
  return created_order;
end;
$$;

revoke all on function public.create_pos_order_with_pending_stock(text,text,text,text,numeric,numeric,numeric,text,text,text,text,jsonb,numeric,numeric) from public;
grant execute on function public.create_pos_order_with_pending_stock(text,text,text,text,numeric,numeric,numeric,text,text,text,text,jsonb,numeric,numeric) to authenticated;

notify pgrst, 'reload schema';
