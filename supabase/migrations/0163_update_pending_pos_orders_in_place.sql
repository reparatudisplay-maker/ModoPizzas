-- Pending direct orders are editable before payment. Keep their identity and
-- replace their operational detail atomically, instead of leaving a cancelled
-- predecessor alongside a new order with the same public code.

begin;

create or replace function public.replace_pending_pos_order_with_packaging(
  p_original_order_id uuid,
  p_kind text, p_customer_name text, p_customer_phone text, p_discount_type text, p_discount_value numeric, p_discount_cop numeric, p_delivery_cop numeric,
  p_payment_method text, p_source_channel text, p_collection_party text, p_notes text, p_items jsonb,
  p_cash_received_cop numeric default null, p_cash_change_cop numeric default null, p_platform_service text default 'none',
  p_pickup_mode text default 'pickup', p_line_pricing jsonb default '[]'::jsonb, p_direct_sales jsonb default '[]'::jsonb,
  p_allow_pending_stock boolean default false, p_packaging_quantities jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public, app_private, pg_temp as $$
declare
  original_order public.pos_orders%rowtype;
  draft_order public.pos_orders%rowtype;
  created_order jsonb;
  draft_order_id uuid;
  original_direct record;
  draft_direct_purchase_id uuid;
  draft_direct_item_id uuid;
begin
  if not public.current_user_can_access_module('pedidos') then
    raise exception 'No tienes acceso operativo a pedidos.';
  end if;

  select * into original_order
  from public.pos_orders
  where id = p_original_order_id
  for update;

  if not found then
    raise exception 'No se encontró el pedido pendiente.';
  end if;
  if original_order.status not in ('new', 'confirmed')
    or original_order.payment_method <> 'pending'
    or original_order.source_channel <> 'direct'
    or original_order.collection_party <> 'business' then
    raise exception 'Solo se pueden editar pedidos directos pendientes de cobro que aún no fueron cancelados.';
  end if;
  if exists (select 1 from public.kitchen_order_items where order_id = original_order.id and status <> 'pending') then
    raise exception 'No se puede editar un pedido cuya preparación ya fue iniciada.';
  end if;
  if exists (select 1 from public.pos_order_combo_snapshots where order_id = original_order.id) then
    raise exception 'No se puede editar un combo pendiente desde este flujo.';
  end if;
  if exists (
    select 1 from public.direct_sale_purchases
    where order_id = original_order.id and cash_movement_id is not null
  ) then
    raise exception 'No se puede editar una venta libre pendiente pagada desde caja; conserva un movimiento de caja independiente.';
  end if;
  if p_payment_method <> 'pending' or p_source_channel <> 'direct' or p_collection_party <> 'business' then
    raise exception 'La edición conserva el pedido como cobro pendiente directo.';
  end if;

  -- This temporary state is visible only inside this transaction. It releases
  -- the original allocations before validating the revised order with FIFO.
  update public.pos_orders
  set status = 'cancelled', updated_at = now()
  where id = original_order.id;

  created_order := public.create_pos_order_with_packaging(
    p_kind, p_pickup_mode,
    p_customer_name, p_customer_phone, p_discount_type, p_discount_value, p_discount_cop, p_delivery_cop,
    p_payment_method, p_source_channel, p_collection_party, p_notes, p_items,
    p_cash_received_cop, p_cash_change_cop, p_platform_service,
    p_line_pricing, p_direct_sales, p_allow_pending_stock, p_packaging_quantities
  );
  draft_order_id := (created_order ->> 'id')::uuid;

  -- Preserve external direct-sale traceability by reconnecting the existing
  -- purchase row to the equivalent new item before old items are removed.
  for original_direct in
    select purchase.id, item.cart_line_key
    from public.direct_sale_purchases purchase
    join public.pos_order_items item on item.id = purchase.order_item_id
    where purchase.order_id = original_order.id
  loop
    if original_direct.cart_line_key is null then
      raise exception 'La venta libre histórica no tiene referencia de línea para conservar su trazabilidad.';
    end if;

    select purchase.id, item.id
      into draft_direct_purchase_id, draft_direct_item_id
    from public.direct_sale_purchases purchase
    join public.pos_order_items item on item.id = purchase.order_item_id
    where purchase.order_id = draft_order_id
      and item.cart_line_key = original_direct.cart_line_key
    for update;

    if draft_direct_purchase_id is null or draft_direct_item_id is null then
      raise exception 'No se pudo reconstruir la venta libre % en el pedido actualizado.', original_direct.id;
    end if;

    delete from public.direct_sale_purchases where id = draft_direct_purchase_id;
    update public.direct_sale_purchases
    set order_id = draft_order_id,
        order_item_id = draft_direct_item_id
    where id = original_direct.id;
  end loop;

  delete from public.pos_order_payments where order_id = original_order.id;
  delete from public.pos_order_items where order_id = original_order.id;

  update public.pos_order_items set order_id = original_order.id where order_id = draft_order_id;
  update public.pos_order_payments set order_id = original_order.id where order_id = draft_order_id;
  update public.pos_order_consumptions set order_id = original_order.id where order_id = draft_order_id;
  update public.pos_order_packaging_consumptions set order_id = original_order.id where order_id = draft_order_id;
  update public.kitchen_order_items set order_id = original_order.id where order_id = draft_order_id;
  update public.kitchen_order_item_events set order_id = original_order.id where order_id = draft_order_id;
  update public.pos_order_combo_snapshots set order_id = original_order.id where order_id = draft_order_id;
  update public.direct_sale_purchases set order_id = original_order.id where order_id = draft_order_id;

  select * into draft_order from public.pos_orders where id = draft_order_id for update;
  update public.pos_orders
  set kind = draft_order.kind,
      status = draft_order.status,
      customer_name = draft_order.customer_name,
      customer_phone = draft_order.customer_phone,
      subtotal_cop = draft_order.subtotal_cop,
      discount_cop = draft_order.discount_cop,
      delivery_cop = draft_order.delivery_cop,
      total_cop = draft_order.total_cop,
      payment_method = draft_order.payment_method,
      notes = draft_order.notes,
      cancelled_by = null,
      cancel_reason = null,
      cancelled_at = null,
      cash_received_cop = draft_order.cash_received_cop,
      cash_change_cop = draft_order.cash_change_cop,
      paid_at = draft_order.paid_at,
      paid_by = draft_order.paid_by,
      discount_type = draft_order.discount_type,
      discount_value = draft_order.discount_value,
      discount_applied_by = draft_order.discount_applied_by,
      combo_price_adjustment_cop = draft_order.combo_price_adjustment_cop,
      source_channel = draft_order.source_channel,
      collection_party = draft_order.collection_party,
      table_id = draft_order.table_id,
      table_name_snapshot = draft_order.table_name_snapshot,
      platform_service = draft_order.platform_service,
      updated_at = now()
  where id = original_order.id;

  delete from public.pos_order_status_events where order_id = draft_order_id;
  delete from public.pos_orders where id = draft_order_id;

  insert into public.pos_order_status_events(order_id, from_status, to_status, actor_id, notes)
  values (original_order.id, original_order.status, 'confirmed', auth.uid(), 'PEDIDO PENDIENTE ACTUALIZADO EN SITIO');

  return (
    select to_jsonb(updated_order) || jsonb_build_object('code', updated_order.code, 'updated_order_id', updated_order.id)
    from public.pos_orders updated_order
    where updated_order.id = original_order.id
  );
end;
$$;

revoke all on function public.replace_pending_pos_order_with_packaging(uuid, text, text, text, text, numeric, numeric, numeric, text, text, text, text, jsonb, numeric, numeric, text, text, jsonb, jsonb, boolean, jsonb) from public;
grant execute on function public.replace_pending_pos_order_with_packaging(uuid, text, text, text, text, numeric, numeric, numeric, text, text, text, text, jsonb, numeric, numeric, text, text, jsonb, jsonb, boolean, jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
