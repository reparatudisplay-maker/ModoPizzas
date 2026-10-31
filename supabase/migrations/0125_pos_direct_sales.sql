-- Venta libre: registra una adquisición trazable sin crear lotes, consumos ni movimientos de inventario.

alter table public.pos_order_items drop constraint if exists pos_order_items_item_kind_check;
alter table public.pos_order_items add constraint pos_order_items_item_kind_check
  check (item_kind in ('pizza', 'sale_product', 'free_sale'));

alter table public.pos_order_items drop constraint if exists pos_order_items_source_check;
alter table public.pos_order_items add constraint pos_order_items_source_check check (
  (item_kind = 'pizza' and pizza_price_config_id is not null and inventory_item_id is null)
  or (item_kind = 'sale_product' and inventory_item_id is not null and pizza_price_config_id is null)
  or (item_kind = 'free_sale' and inventory_item_id is null and pizza_price_config_id is null)
);

create table if not exists public.direct_sale_purchases (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.pos_orders(id) on delete restrict,
  order_item_id uuid not null unique references public.pos_order_items(id) on delete restrict,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  product_name_snapshot text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  acquisition_unit_cost_cop numeric(14,4) not null check (acquisition_unit_cost_cop >= 0),
  acquisition_total_cop numeric(14,2) not null check (acquisition_total_cop >= 0),
  funds_origin text not null check (funds_origin in ('cash_session', 'external')),
  observation text,
  cash_session_id uuid references public.cash_sessions(id) on delete restrict,
  cash_movement_id uuid references public.cash_movements(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint direct_sale_purchases_cash_origin_check check (
    (funds_origin = 'cash_session' and cash_session_id is not null and cash_movement_id is not null)
    or (funds_origin = 'external' and cash_session_id is null and cash_movement_id is null)
  )
);

create index if not exists direct_sale_purchases_order_idx on public.direct_sale_purchases(order_id);
alter table public.direct_sale_purchases enable row level security;
create policy "Order staff read direct sale purchases" on public.direct_sale_purchases
  for select to authenticated using (public.current_user_can_access_module('pedidos') or public.current_user_can_access_module('caja'));

create or replace function public.create_pos_order_with_direct_sales(
  p_kind text, p_customer_name text, p_customer_phone text, p_discount_type text, p_discount_value numeric, p_discount_cop numeric, p_delivery_cop numeric,
  p_payment_method text, p_source_channel text, p_collection_party text, p_notes text, p_items jsonb,
  p_cash_received_cop numeric default null, p_cash_change_cop numeric default null, p_direct_sales jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public, app_private, pg_temp as $$
declare
  created_order jsonb;
  v_order_id uuid;
  order_row public.pos_orders%rowtype;
  direct_sale jsonb;
  direct_total numeric := 0;
  regular_total numeric := 0;
  final_total numeric := 0;
  direct_quantity numeric;
  direct_sale_price numeric;
  direct_cost numeric;
  direct_name text;
  direct_origin text;
  direct_item_id uuid;
  direct_order_item_id uuid;
  direct_purchase_id uuid;
  cash_session_id uuid;
  cash_movement_id uuid;
  counter_value bigint;
  order_code text;
  normal_items jsonb := coalesce(p_items, '[]'::jsonb);
  has_normal_items boolean := false;
begin
  if not public.current_user_can_access_module('pedidos') then raise exception 'No tienes acceso operativo a pedidos.'; end if;
  if p_collection_party <> 'business' or p_source_channel <> 'direct' or p_payment_method in ('rappi', 'didi') then
    raise exception 'La venta libre no puede liquidarse por plataforma.';
  end if;
  if jsonb_typeof(p_direct_sales) <> 'array' or jsonb_array_length(p_direct_sales) = 0 then
    raise exception 'Agrega una venta libre válida.';
  end if;
  if p_kind not in ('local', 'pickup', 'delivery') then raise exception 'Tipo de pedido no válido.'; end if;

  for direct_sale in select value from jsonb_array_elements(p_direct_sales) loop
    direct_name := nullif(btrim(coalesce(direct_sale->>'name', '')), '');
    direct_quantity := coalesce(nullif(direct_sale->>'quantity', '')::numeric, 0);
    direct_sale_price := coalesce(nullif(direct_sale->>'unit_price_cop', '')::numeric, -1);
    direct_cost := coalesce(nullif(direct_sale #>> '{direct_sale,acquisition_unit_cost_cop}', '')::numeric, -1);
    direct_origin := coalesce(direct_sale #>> '{direct_sale,funds_origin}', '');
    if direct_name is null or direct_quantity <= 0 or direct_sale_price < 0 or direct_cost < 0 or direct_origin not in ('cash_session', 'external') then
      raise exception 'Una venta libre no tiene datos válidos.';
    end if;
    direct_total := direct_total + round(direct_quantity * direct_sale_price, 2);
  end loop;

  if p_payment_method = 'cash' then
    if p_cash_received_cop is null or p_cash_received_cop < direct_total then raise exception 'Confirma el cobro en efectivo.'; end if;
    select id into cash_session_id from public.cash_sessions where status = 'open' order by opened_at desc limit 1 for update;
    if cash_session_id is null and exists (select 1 from jsonb_array_elements(p_direct_sales) value where value #>> '{direct_sale,funds_origin}' = 'cash_session') then
      raise exception 'Abre o selecciona una caja vigente, o usa dinero externo para la compra directa.';
    end if;
  elsif exists (select 1 from jsonb_array_elements(p_direct_sales) value where value #>> '{direct_sale,funds_origin}' = 'cash_session') then
    select id into cash_session_id from public.cash_sessions where status = 'open' order by opened_at desc limit 1 for update;
    if cash_session_id is null then raise exception 'Abre o selecciona una caja vigente, o usa dinero externo para la compra directa.'; end if;
  end if;

  if jsonb_array_length(normal_items) > 0 then
    has_normal_items := true;
    select coalesce(sum((value->>'quantity')::numeric * coalesce((value->>'unit_price_cop')::numeric, 0)), 0) into regular_total from jsonb_array_elements(normal_items) value;
    created_order := public.create_pos_order_with_platform_payment(
      p_kind, p_customer_name, p_customer_phone, p_discount_type, p_discount_value, p_discount_cop, p_delivery_cop,
      p_payment_method, 'direct', 'business', p_notes, normal_items,
      p_cash_received_cop, case when p_cash_received_cop is null then null else greatest(0, p_cash_received_cop - regular_total) end
    );
    v_order_id := (created_order->>'id')::uuid;
  else
    if p_payment_method = 'cash' and cash_session_id is null then raise exception 'Abre caja antes de confirmar pagos en efectivo.'; end if;
    select last_number + 1 into counter_value from public.pos_order_counters where id = true for update;
    update public.pos_order_counters set last_number = counter_value where id = true;
    order_code := 'PD' || counter_value::text;
    insert into public.pos_orders(order_number, code, kind, status, customer_name, customer_phone, subtotal_cop, discount_cop, delivery_cop, total_cop, payment_method, source_channel, collection_party, notes, created_by)
    values(counter_value, order_code, p_kind, 'confirmed', nullif(btrim(p_customer_name), ''), nullif(btrim(p_customer_phone), ''), 0, coalesce(p_discount_cop, 0), coalesce(p_delivery_cop, 0), greatest(0, -coalesce(p_discount_cop, 0) + coalesce(p_delivery_cop, 0)), p_payment_method, 'direct', 'business', nullif(btrim(p_notes), ''), auth.uid()) returning id into v_order_id;
    insert into public.pos_order_status_events(order_id, from_status, to_status, actor_id, notes) values(v_order_id, null, 'confirmed', auth.uid(), 'Pedido confirmado desde caja');
    created_order := jsonb_build_object('id', v_order_id, 'code', order_code, 'total_cop', greatest(0, direct_total - coalesce(p_discount_cop, 0) + coalesce(p_delivery_cop, 0)));
  end if;

  select * into order_row from public.pos_orders where id = v_order_id for update;
  final_total := round(order_row.total_cop + direct_total, 2);

  if not has_normal_items then
    if p_payment_method = 'cash' then
      if p_cash_received_cop < final_total then raise exception 'El efectivo recibido no cubre el total del pedido.'; end if;
      insert into public.pos_order_payments(order_id, method, amount_cop, cash_received_cop, cash_change_cop, cash_session_id, created_by)
      values(v_order_id, 'cash', final_total, p_cash_received_cop, round(p_cash_received_cop - final_total, 2), cash_session_id, auth.uid());
      insert into public.cash_movements(cash_session_id, movement_kind, direction, source_kind, amount_cop, created_by, reason, order_id)
      values(cash_session_id, 'sale_cash', 'in', 'pos_order', final_total, auth.uid(), 'VENTA EN EFECTIVO ' || order_row.code, v_order_id);
    elsif p_payment_method in ('transfer', 'mixed', 'pending') then
      insert into public.pos_order_payments(order_id, method, amount_cop, created_by) values(v_order_id, p_payment_method, final_total, auth.uid());
    end if;
  end if;

  for direct_sale in select value from jsonb_array_elements(p_direct_sales) loop
    direct_name := btrim(direct_sale->>'name');
    direct_quantity := (direct_sale->>'quantity')::numeric;
    direct_sale_price := (direct_sale->>'unit_price_cop')::numeric;
    direct_cost := (direct_sale #>> '{direct_sale,acquisition_unit_cost_cop}')::numeric;
    direct_origin := direct_sale #>> '{direct_sale,funds_origin}';
    direct_item_id := nullif(direct_sale #>> '{direct_sale,inventory_item_id}', '')::uuid;
    insert into public.pos_order_items(order_id, item_kind, quantity, product_name_snapshot, sku_snapshot, unit_price_cop, line_subtotal_cop, line_cost_cop, notes, cart_line_key)
    values(v_order_id, 'free_sale', direct_quantity, direct_name, null, direct_sale_price, round(direct_quantity * direct_sale_price, 2), round(direct_quantity * direct_cost, 2), nullif(btrim(coalesce(direct_sale #>> '{direct_sale,observation}', '')), ''), nullif(direct_sale->>'line_key', ''))
    returning id into direct_order_item_id;
    if direct_origin = 'cash_session' then
      insert into public.cash_movements(cash_session_id, movement_kind, direction, source_kind, amount_cop, created_by, reason, order_id)
      values(cash_session_id, 'manual_out', 'out', 'manual', round(direct_quantity * direct_cost, 2), auth.uid(), 'COMPRA DIRECTA ' || order_row.code || ' · ' || direct_name, v_order_id)
      returning id into cash_movement_id;
    else
      cash_movement_id := null;
    end if;
    insert into public.direct_sale_purchases(order_id, order_item_id, inventory_item_id, product_name_snapshot, quantity, acquisition_unit_cost_cop, acquisition_total_cop, funds_origin, observation, cash_session_id, cash_movement_id, created_by)
    values(v_order_id, direct_order_item_id, direct_item_id, direct_name, direct_quantity, direct_cost, round(direct_quantity * direct_cost, 2), direct_origin, nullif(btrim(coalesce(direct_sale #>> '{direct_sale,observation}', '')), ''), case when direct_origin = 'cash_session' then cash_session_id else null end, cash_movement_id, auth.uid());
  end loop;

  update public.pos_orders set subtotal_cop = round(order_row.subtotal_cop + direct_total, 2), total_cop = final_total, updated_at = now() where id = v_order_id;
  if p_payment_method = 'cash' then
    if p_cash_received_cop < final_total then raise exception 'El efectivo recibido no cubre el total del pedido.'; end if;
    update public.pos_order_payments set amount_cop = final_total, cash_change_cop = round(p_cash_received_cop - final_total, 2) where order_id = v_order_id and method = 'cash';
    update public.cash_movements set amount_cop = final_total where order_id = v_order_id and movement_kind = 'sale_cash';
  else
    update public.pos_order_payments set amount_cop = final_total where order_id = v_order_id;
  end if;
  return jsonb_build_object('id', v_order_id, 'code', order_row.code, 'total_cop', final_total, 'cash_received_cop', p_cash_received_cop, 'cash_change_cop', case when p_cash_received_cop is null then null else round(p_cash_received_cop - final_total, 2) end);
end;
$$;

revoke all on function public.create_pos_order_with_direct_sales(text, text, text, text, numeric, numeric, numeric, text, text, text, text, jsonb, numeric, numeric, jsonb) from public;
grant execute on function public.create_pos_order_with_direct_sales(text, text, text, text, numeric, numeric, numeric, text, text, text, text, jsonb, numeric, numeric, jsonb) to authenticated;

notify pgrst, 'reload schema';
