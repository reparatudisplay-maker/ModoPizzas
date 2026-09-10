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
  item jsonb;
  normalized_items jsonb := '[]'::jsonb;
  configured_price numeric;
  order_id uuid;
  order_total numeric;
  payment_id uuid;
  session_id uuid;
  movement_id uuid;
  sale_product record;
  lot record;
  remaining_quantity numeric;
  available_quantity numeric;
  total_available_quantity numeric;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'El pedido no tiene productos validos.';
  end if;

  -- Lock sale-product lots before creating any order rows. This keeps the
  -- availability check and the later FEFO allocation in one transaction.
  for sale_product in
    select
      (item_value->>'id')::uuid as inventory_item_id,
      sum(coalesce(nullif(item_value->>'quantity', '')::numeric, 0)) as requested_quantity
    from jsonb_array_elements(p_items) as entries(item_value)
    where item_value->>'kind' = 'sale_product'
    group by (item_value->>'id')::uuid
  loop
    if sale_product.requested_quantity is null or sale_product.requested_quantity <= 0 or sale_product.requested_quantity <> trunc(sale_product.requested_quantity) then
      raise exception 'La cantidad de productos para venta debe ser un numero entero mayor que cero.';
    end if;

    select id, name
    into lot
    from public.inventory_items
    where id = sale_product.inventory_item_id
      and item_kind = 'sale_product'
      and presentation_quantity is not null
      and is_active = true
      and sale_is_enabled = true;

    if not found then
      raise exception 'Producto para venta no disponible.';
    end if;

    remaining_quantity := sale_product.requested_quantity;
    total_available_quantity := 0;
    for lot in
      select
        pi.id,
        greatest(
          0,
          public.production_convert_quantity(pi.quantity, pi.unit, 'unit'::public.stock_unit, null)
            - coalesce((
              select sum(public.production_convert_quantity(pca.quantity_base, pca.base_unit, 'unit'::public.stock_unit, null))
              from public.production_consumption_allocations pca
              where pca.purchase_item_id = pi.id
            ), 0)
            - coalesce((
              select sum(public.production_convert_quantity(poca.quantity_base, poca.base_unit, 'unit'::public.stock_unit, null))
              from public.pos_order_consumption_allocations poca
              join public.pos_order_consumptions poc on poc.id = poca.consumption_id
              join public.pos_orders po on po.id = poc.order_id
              where poca.purchase_item_id = pi.id
                and po.status <> 'cancelled'
            ), 0)
        ) as available_quantity
      from public.purchase_items pi
      join public.purchases p on p.id = pi.purchase_id
      where pi.inventory_item_id = sale_product.inventory_item_id
      order by pi.expiration_date asc nulls last, p.purchased_at asc, pi.id asc
      for update of pi
    loop
      available_quantity := lot.available_quantity;
      total_available_quantity := total_available_quantity + available_quantity;
      remaining_quantity := greatest(0, remaining_quantity - available_quantity);
    end loop;

    if remaining_quantity > 0 then
      raise exception 'Stock insuficiente para %. Disponible: % UND; solicitado: % UND.',
        (select name from public.inventory_items where id = sale_product.inventory_item_id),
        trim(to_char(total_available_quantity, 'FM999999999999990D99')),
        trim(to_char(sale_product.requested_quantity, 'FM999999999999990D99'));
    end if;
  end loop;

  for item in select value from jsonb_array_elements(p_items) with ordinality as items(value, position) order by position
  loop
    if item->>'kind' = 'sale_product' then
      select sale_price_cop
      into configured_price
      from public.inventory_items
      where id = (item->>'id')::uuid
        and item_kind = 'sale_product'
        and presentation_quantity is not null
        and is_active = true
        and sale_is_enabled = true;

      if not found then
        raise exception 'Producto para venta no disponible.';
      end if;

      if configured_price <= 0 then
        raise exception 'El producto % no tiene precio de venta configurado.', coalesce(item->>'id', '');
      end if;

      normalized_items := normalized_items || jsonb_build_array(jsonb_set(item, '{unit_price_cop}', to_jsonb(configured_price), true));
    else
      normalized_items := normalized_items || jsonb_build_array(item);
    end if;
  end loop;

  if p_payment_method = 'cash' then
    if p_cash_received_cop is null then
      raise exception 'Confirma el monto recibido en efectivo.';
    end if;
    if p_cash_change_cop is null then
      raise exception 'Confirma el cambio entregado.';
    end if;
    select id into session_id
    from public.cash_sessions
    where status = 'open'
    order by opened_at desc
    limit 1
    for update;
    if session_id is null then
      raise exception 'Abre caja antes de confirmar pagos en efectivo.';
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
    normalized_items
  );

  order_id := (created_order->>'id')::uuid;
  order_total := (created_order->>'total_cop')::numeric;

  if p_payment_method = 'cash' then
    perform public.record_pos_cash_payment(order_id, p_cash_received_cop, p_cash_change_cop);

    insert into public.pos_order_payments (
      order_id, method, amount_cop, cash_received_cop, cash_change_cop, cash_session_id, created_by
    )
    values (order_id, 'cash', order_total, p_cash_received_cop, p_cash_change_cop, session_id, auth.uid())
    returning id into payment_id;

    insert into public.cash_movements (
      cash_session_id, movement_kind, direction, source_kind, amount_cop, created_by, reason, order_id, payment_id
    )
    values (session_id, 'sale_cash', 'in', 'pos_order', order_total, auth.uid(), 'VENTA EN EFECTIVO ' || (created_order->>'code'), order_id, payment_id)
    returning id into movement_id;

    update public.pos_order_payments
    set cash_movement_id = movement_id
    where id = payment_id;

    created_order := jsonb_set(created_order, '{cash_received_cop}', to_jsonb(p_cash_received_cop), true);
    created_order := jsonb_set(created_order, '{cash_change_cop}', to_jsonb(p_cash_change_cop), true);
  elsif p_payment_method in ('transfer', 'mixed', 'pending') then
    insert into public.pos_order_payments (order_id, method, amount_cop, created_by)
    values (order_id, p_payment_method, order_total, auth.uid());
  end if;

  return created_order;
end;
$$;

grant execute on function public.create_pos_order_with_payment(text, text, text, numeric, numeric, text, text, jsonb, numeric, numeric) to authenticated;

notify pgrst, 'reload schema';
