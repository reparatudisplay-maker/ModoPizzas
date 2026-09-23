-- The POS core keeps one authoritative writer for orders, payments, cash and
-- FEFO/FIFO consumption. Combo components arrive at their configured net
-- price, but the core intentionally rebuilds their normal commercial price.
-- Include the server-normalized combo saving in that core discount so every
-- payment method validates the real final total.
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
  combo_discount_cop numeric := 0;
  discountable_subtotal numeric;
  expected_discount numeric;
  pizza_item jsonb;
  resolved record;
begin
  if not public.current_user_can_access_module('pedidos') then raise exception 'No tienes acceso operativo a pedidos.'; end if;
  p_discount_type := coalesce(nullif(trim(p_discount_type), ''), 'none');
  p_discount_value := coalesce(p_discount_value, 0);
  p_discount_cop := coalesce(p_discount_cop, 0);
  if p_discount_type not in ('none', 'percentage', 'amount') then raise exception 'El tipo de descuento no es valido.'; end if;
  if p_discount_type = 'none' and (p_discount_value <> 0 or p_discount_cop <> 0) then raise exception 'El descuento no es valido.'; end if;
  if p_discount_type = 'percentage' and (p_discount_value <= 0 or p_discount_value >= 100) then raise exception 'El descuento porcentual debe ser mayor que cero y menor al 100%%.'; end if;
  if p_discount_type = 'amount' and p_discount_value <= 0 then raise exception 'El descuento debe ser mayor que cero.'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido necesita al menos un producto.';
  end if;

  -- These fields are set only after expandComboItemsForPos validates the
  -- active combo configuration and its selected components on the server.
  select coalesce(sum(
    case
      when coalesce((item.value->>'combo_is_primary')::boolean, false)
        then greatest(0, round(coalesce((item.value->>'combo_savings_cop')::numeric, 0), 0))
          * greatest(1, coalesce((item.value->>'quantity')::numeric, 1))
      else 0
    end
  ), 0)
  into combo_discount_cop
  from jsonb_array_elements(p_items) as item(value);

  created_order := public.create_pos_order_with_payment(
    p_kind,
    p_customer_name,
    p_customer_phone,
    p_discount_cop + combo_discount_cop,
    p_delivery_cop,
    p_payment_method,
    p_notes,
    p_items,
    p_cash_received_cop,
    p_cash_change_cop
  );
  created_order_id := (created_order->>'id')::uuid;

  for pizza_item in select value from jsonb_array_elements(p_items) where value->>'kind' = 'pizza' loop
    if nullif(pizza_item->>'line_key', '') is null then continue; end if;
    select * into resolved from public.pos_resolve_pizza_base((select size_id from public.pizza_price_configs where id = (pizza_item->>'id')::uuid), pizza_item);
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

  select subtotal_cop into order_subtotal from public.pos_orders where id = created_order_id for update;
  discountable_subtotal := greatest(0, order_subtotal - combo_discount_cop);
  expected_discount := case
    when p_discount_type = 'percentage' then round(discountable_subtotal * p_discount_value / 100, 0)
    when p_discount_type = 'amount' then round(p_discount_value, 0)
    else 0
  end;
  if expected_discount < 0 or expected_discount >= discountable_subtotal or round(p_discount_cop, 0) <> expected_discount then
    raise exception 'El descuento no es valido para el subtotal del pedido.';
  end if;

  -- Keep the manual discount distinct from the combo saving. The sale total
  -- remains the final amount already calculated by the core payment writer.
  update public.pos_orders
  set discount_type = p_discount_type,
      discount_value = case when p_discount_type = 'none' then 0 else p_discount_value end,
      discount_cop = expected_discount,
      discount_applied_by = case when p_discount_type = 'none' then null else auth.uid() end,
      updated_at = now()
  where id = created_order_id;

  return created_order;
end;
$$;

revoke all on function public.create_pos_order_with_discount_payment(text, text, text, text, numeric, numeric, numeric, text, text, jsonb, numeric, numeric) from public;
grant execute on function public.create_pos_order_with_discount_payment(text, text, text, text, numeric, numeric, numeric, text, text, jsonb, numeric, numeric) to authenticated;

notify pgrst, 'reload schema';
