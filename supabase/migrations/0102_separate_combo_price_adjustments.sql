-- A combo can be either cheaper or more expensive than the current sum of its
-- components. Keep that signed commercial adjustment separate from the manual
-- discount, whose existing constraint deliberately requires a nonnegative value.
alter table public.pos_orders
  add column if not exists combo_price_adjustment_cop numeric(14, 2) not null default 0;

alter table public.pos_order_combo_snapshots
  add column if not exists price_adjustment_cop numeric(14, 2);

create or replace function public.create_pos_order_with_discount_payment(
  p_kind text,
  p_customer_name text,
  p_customer_phone text,
  p_discount_type text,
  p_discount_value numeric,
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
security definer
set search_path = public, pg_temp
as $$
declare
  created_order jsonb;
  created_order_id uuid;
  order_subtotal numeric;
  order_total numeric;
  combo_adjustment_value numeric := 0;
  discountable_subtotal numeric;
  expected_discount numeric;
  pizza_item jsonb;
  resolved record;
  item jsonb;
  normalized_items jsonb := '[]'::jsonb;
  configured_price numeric;
  session_id uuid;
  payment_id uuid;
  movement_id uuid;
  sale_product record;
  lot record;
  remaining_quantity numeric;
  available_quantity numeric;
  shortages jsonb;
begin
  if not public.current_user_can_access_module('pedidos') then
    raise exception 'No tienes acceso operativo a pedidos.';
  end if;

  p_discount_type := coalesce(nullif(trim(p_discount_type), ''), 'none');
  p_discount_value := coalesce(p_discount_value, 0);
  p_discount_cop := coalesce(p_discount_cop, 0);
  p_delivery_cop := coalesce(p_delivery_cop, 0);

  if p_discount_type not in ('none', 'percentage', 'amount') then
    raise exception 'El tipo de descuento no es valido.';
  end if;
  if p_discount_cop < 0 or p_delivery_cop < 0 then
    raise exception 'Los montos del pedido no son validos.';
  end if;
  if p_discount_type = 'none' and (p_discount_value <> 0 or p_discount_cop <> 0) then
    raise exception 'El descuento no es valido.';
  end if;
  if p_discount_type = 'percentage' and (p_discount_value <= 0 or p_discount_value >= 100) then
    raise exception 'El descuento porcentual debe ser mayor que cero y menor al 100%%.';
  end if;
  if p_discount_type = 'amount' and p_discount_value <= 0 then
    raise exception 'El descuento debe ser mayor que cero.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido necesita al menos un producto.';
  end if;

  -- expandComboItemsForPos recalculates these fields against the active combo
  -- configuration on the server before this RPC is called.
  select coalesce(sum(
    case when coalesce((entry.value->>'combo_is_primary')::boolean, false)
      then round(coalesce((entry.value->>'combo_price_adjustment_cop')::numeric, 0), 0)
        * greatest(1, coalesce((entry.value->>'quantity')::numeric, 1))
      else 0
    end
  ), 0)
  into combo_adjustment_value
  from jsonb_array_elements(p_items) as entry(value);

  shortages := public.get_pos_order_stock_shortages(p_items);
  if jsonb_array_length(shortages) > 0 then
    raise exception using message = 'POS_STOCK_SHORTAGE', detail = shortages::text;
  end if;

  -- Use the same FEFO locks and configured sale-product prices as the regular
  -- POS payment writer before any inventory allocation is created.
  for sale_product in
    select (entry.value->>'id')::uuid as inventory_item_id,
      sum(coalesce(nullif(entry.value->>'quantity', '')::numeric, 0)) as requested_quantity
    from jsonb_array_elements(p_items) as entry(value)
    where entry.value->>'kind' = 'sale_product'
    group by (entry.value->>'id')::uuid
  loop
    if sale_product.requested_quantity is null or sale_product.requested_quantity <= 0
      or sale_product.requested_quantity <> trunc(sale_product.requested_quantity) then
      raise exception 'La cantidad de productos para venta debe ser un numero entero mayor que cero.';
    end if;

    select id, name into lot
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
    for lot in
      select pi.id, greatest(0,
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
          where poca.purchase_item_id = pi.id and po.status <> 'cancelled'
        ), 0)
      ) as available_quantity
      from public.purchase_items pi
      join public.purchases p on p.id = pi.purchase_id
      where pi.inventory_item_id = sale_product.inventory_item_id
      order by pi.expiration_date asc nulls last, p.purchased_at asc, pi.id asc
      for update of pi
    loop
      available_quantity := lot.available_quantity;
      remaining_quantity := greatest(0, remaining_quantity - available_quantity);
    end loop;

    if remaining_quantity > 0 then
      shortages := public.get_pos_order_stock_shortages(p_items);
      raise exception using message = 'POS_STOCK_SHORTAGE', detail = shortages::text;
    end if;
  end loop;

  for item in select value from jsonb_array_elements(p_items) with ordinality as entries(value, position) order by position loop
    if item->>'kind' = 'sale_product' then
      select sale_price_cop into configured_price
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
    if p_cash_received_cop is null then raise exception 'Confirma el monto recibido en efectivo.'; end if;
    if p_cash_change_cop is null then raise exception 'Confirma el cambio entregado.'; end if;
    select id into session_id
    from public.cash_sessions
    where status = 'open'
    order by opened_at desc
    limit 1
    for update;
    if session_id is null then raise exception 'Abre caja antes de confirmar pagos en efectivo.'; end if;
  end if;

  -- The core continues to create items, FEFO allocations and KDS rows. It only
  -- receives the nonnegative manual discount; the signed combo adjustment is
  -- applied to the order before the payment is recorded.
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
  created_order_id := (created_order->>'id')::uuid;

  for pizza_item in select value from jsonb_array_elements(normalized_items) where value->>'kind' = 'pizza' loop
    if nullif(pizza_item->>'line_key', '') is null then continue; end if;
    select * into resolved
    from public.pos_resolve_pizza_base((select size_id from public.pizza_price_configs where id = (pizza_item->>'id')::uuid), pizza_item);
    update public.pos_order_items poi
    set base_default_source_kind = resolved.default_source_kind,
        base_default_inventory_item_id = case when resolved.default_source_kind = 'inventory_item' then resolved.default_inventory_item_id else null end,
        base_default_preparation_id = case when resolved.default_source_kind = 'preparation' then resolved.default_preparation_id else null end,
        base_used_source_kind = resolved.source_kind,
        base_used_inventory_item_id = case when resolved.source_kind = 'inventory_item' then resolved.inventory_item_id else null end,
        base_used_preparation_id = case when resolved.source_kind = 'preparation' then resolved.source_preparation_id else null end,
        base_used_quantity_base = resolved.quantity_base * greatest(1, coalesce((pizza_item->>'quantity')::integer, 1)),
        base_used_unit = resolved.unit,
        base_replaced_by = case when resolved.source_kind <> resolved.default_source_kind or coalesce(resolved.inventory_item_id, resolved.source_preparation_id) <> coalesce(resolved.default_inventory_item_id, resolved.default_preparation_id) then auth.uid() else null end,
        base_replaced_at = case when resolved.source_kind <> resolved.default_source_kind or coalesce(resolved.inventory_item_id, resolved.source_preparation_id) <> coalesce(resolved.default_inventory_item_id, resolved.default_preparation_id) then now() else null end
    where poi.order_id = created_order_id and poi.cart_line_key = pizza_item->>'line_key';
  end loop;

  select subtotal_cop into order_subtotal
  from public.pos_orders
  where id = created_order_id
  for update;

  discountable_subtotal := greatest(0, order_subtotal + combo_adjustment_value);
  expected_discount := case
    when p_discount_type = 'percentage' then round(discountable_subtotal * p_discount_value / 100, 0)
    when p_discount_type = 'amount' then round(p_discount_value, 0)
    else 0
  end;
  if expected_discount < 0
    or (discountable_subtotal > 0 and expected_discount >= discountable_subtotal)
    or round(p_discount_cop, 0) <> expected_discount then
    raise exception 'El descuento no es valido para el subtotal del pedido.';
  end if;

  order_total := greatest(0, round(discountable_subtotal - expected_discount + p_delivery_cop, 2));
  update public.pos_orders
  set combo_price_adjustment_cop = combo_adjustment_value,
      discount_type = p_discount_type,
      discount_value = case when p_discount_type = 'none' then 0 else p_discount_value end,
      discount_cop = expected_discount,
      discount_applied_by = case when p_discount_type = 'none' then null else auth.uid() end,
      total_cop = order_total,
      updated_at = now()
  where id = created_order_id;

  created_order := jsonb_set(created_order, '{total_cop}', to_jsonb(order_total), true);

  if p_payment_method = 'cash' then
    perform public.record_pos_cash_payment(created_order_id, p_cash_received_cop, p_cash_change_cop);
    insert into public.pos_order_payments (order_id, method, amount_cop, cash_received_cop, cash_change_cop, cash_session_id, created_by)
    values (created_order_id, 'cash', order_total, p_cash_received_cop, p_cash_change_cop, session_id, auth.uid())
    returning id into payment_id;
    insert into public.cash_movements (cash_session_id, movement_kind, direction, source_kind, amount_cop, created_by, reason, order_id, payment_id)
    values (session_id, 'sale_cash', 'in', 'pos_order', order_total, auth.uid(), 'VENTA EN EFECTIVO ' || (created_order->>'code'), created_order_id, payment_id)
    returning id into movement_id;
    update public.pos_order_payments set cash_movement_id = movement_id where id = payment_id;
    created_order := jsonb_set(created_order, '{cash_received_cop}', to_jsonb(p_cash_received_cop), true);
    created_order := jsonb_set(created_order, '{cash_change_cop}', to_jsonb(p_cash_change_cop), true);
  elsif p_payment_method in ('transfer', 'mixed', 'pending') then
    insert into public.pos_order_payments (order_id, method, amount_cop, created_by)
    values (created_order_id, p_payment_method, order_total, auth.uid());
  end if;

  return created_order;
end;
$$;

revoke all on function public.create_pos_order_with_discount_payment(text, text, text, text, numeric, numeric, numeric, text, text, jsonb, numeric, numeric) from public;
grant execute on function public.create_pos_order_with_discount_payment(text, text, text, text, numeric, numeric, numeric, text, text, jsonb, numeric, numeric) to authenticated;

notify pgrst, 'reload schema';
