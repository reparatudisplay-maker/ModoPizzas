begin;

alter table public.platform_payment_settings
  add column if not exists commission_tax_percent numeric(7,4) not null default 0
    check (commission_tax_percent between 0 and 100);

create table if not exists public.platform_order_line_estimates (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.pos_orders(id) on delete restrict,
  order_item_id uuid references public.pos_order_items(id) on delete restrict,
  cart_line_key text not null,
  name_snapshot text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  original_unit_cop numeric(14,2) not null check (original_unit_cop >= 0),
  final_unit_cop numeric(14,2) not null check (final_unit_cop >= 0),
  original_cop numeric(14,2) not null check (original_cop >= 0),
  final_cop numeric(14,2) not null check (final_cop >= 0),
  merchant_discount_cop numeric(14,2) not null check (merchant_discount_cop >= 0),
  merchant_discount_percent numeric(7,4) not null check (merchant_discount_percent between 0 and 100),
  platform_subsidy_cop numeric(14,2) not null default 0 check (platform_subsidy_cop >= 0),
  commission_base_cop numeric(14,2) not null check (commission_base_cop >= 0),
  commission_tax_cop numeric(14,2) not null default 0 check (commission_tax_cop >= 0),
  commission_cop numeric(14,2) not null check (commission_cop >= 0),
  net_expected_cop numeric(14,2) not null check (net_expected_cop >= 0),
  created_at timestamptz not null default now(),
  unique (order_id, cart_line_key)
);

create index if not exists platform_order_line_estimates_order_idx
  on public.platform_order_line_estimates(order_id);

alter table public.platform_order_line_estimates enable row level security;

create policy "Order and cash staff read platform line estimates"
  on public.platform_order_line_estimates
  for select to authenticated
  using (public.current_user_can_access_module('pedidos') or public.current_user_can_access_module('caja'));

create or replace function public.create_pos_order_with_platform_line_pricing(
  p_kind text, p_customer_name text, p_customer_phone text, p_discount_type text, p_discount_value numeric, p_discount_cop numeric, p_delivery_cop numeric,
  p_payment_method text, p_source_channel text, p_collection_party text, p_notes text, p_items jsonb,
  p_cash_received_cop numeric default null, p_cash_change_cop numeric default null, p_line_pricing jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  created_order jsonb;
  created_order_id uuid;
  order_row public.pos_orders%rowtype;
  item_row record;
  entry jsonb;
  item_count integer;
  original_cop numeric;
  original_unit_cop numeric;
  final_cop numeric;
  final_unit_cop numeric;
  subsidy_cop numeric;
  merchant_discount_cop numeric;
  merchant_discount_percent numeric;
  submitted_original_total numeric := 0;
  customer_total numeric := 0;
  merchant_discount_total numeric := 0;
  commission_total numeric := 0;
  catalog_total numeric := 0;
  commission_base_cop numeric;
  commission_tax_cop numeric;
  commission_cop numeric;
  net_expected_cop numeric;
begin
  if not public.current_user_can_access_module('pedidos') then
    raise exception 'No tienes acceso operativo a pedidos.';
  end if;
  if p_collection_party <> 'platform' or p_source_channel not in ('rappi', 'didi') or p_payment_method <> p_source_channel then
    raise exception 'La plataforma que recauda debe coincidir con el pago.';
  end if;
  if p_discount_type <> 'none' or coalesce(p_discount_value, 0) <> 0 or coalesce(p_discount_cop, 0) <> 0 then
    raise exception 'Los descuentos de plataforma deben detallarse por producto.';
  end if;
  if p_line_pricing is null or jsonb_typeof(p_line_pricing) <> 'array' or jsonb_array_length(p_line_pricing) = 0 then
    raise exception 'Revisa los precios de plataforma del pedido.';
  end if;

  created_order := public.create_pos_order_with_platform_payment(
    p_kind, p_customer_name, p_customer_phone, 'none', 0, 0, p_delivery_cop,
    p_payment_method, p_source_channel, p_collection_party, p_notes, p_items, p_cash_received_cop, p_cash_change_cop
  );
  created_order_id := (created_order->>'id')::uuid;

  select * into order_row from public.pos_orders where id = created_order_id for update;
  select count(*) into item_count from public.pos_order_items where order_id = created_order_id;
  if jsonb_array_length(p_line_pricing) <> item_count
    or (select count(distinct nullif(entry_item.value->>'cart_line_key', '')) from jsonb_array_elements(p_line_pricing) as entry_item(value)) <> item_count then
    raise exception 'Los precios de plataforma no coinciden con los productos del pedido.';
  end if;

  for item_row in select id, cart_line_key, product_name_snapshot, quantity from public.pos_order_items where order_id = created_order_id order by id loop
    select priced.value into entry
    from jsonb_array_elements(p_line_pricing) as priced(value)
    where priced.value->>'cart_line_key' = item_row.cart_line_key;
    if entry is null then
      raise exception 'Falta el precio de plataforma de un producto.';
    end if;
    original_cop := coalesce(nullif(entry->>'original_cop', '')::numeric, -1);
    final_cop := coalesce(nullif(entry->>'final_cop', '')::numeric, -1);
    subsidy_cop := coalesce(nullif(entry->>'platform_subsidy_cop', '')::numeric, 0);
    if original_cop < 0 or final_cop < 0 or final_cop > original_cop or subsidy_cop <> 0 then
      raise exception 'Uno de los precios de plataforma no es válido.';
    end if;
    submitted_original_total := submitted_original_total + round(original_cop, 2);
  end loop;

  if round(submitted_original_total, 2) <> round(greatest(0, order_row.subtotal_cop + order_row.combo_price_adjustment_cop), 2) then
    raise exception 'Los precios originales no coinciden con el pedido vigente.';
  end if;

  for item_row in select id, cart_line_key, product_name_snapshot, quantity from public.pos_order_items where order_id = created_order_id order by id loop
    select priced.value into entry
    from jsonb_array_elements(p_line_pricing) as priced(value)
    where priced.value->>'cart_line_key' = item_row.cart_line_key;
    final_cop := round((entry->>'final_cop')::numeric, 2);
    customer_total := customer_total + final_cop;
  end loop;
  customer_total := round(customer_total + order_row.delivery_cop, 2);
  catalog_total := round(greatest(0, order_row.subtotal_cop + order_row.combo_price_adjustment_cop + order_row.delivery_cop), 2);

  for item_row in select id, cart_line_key, product_name_snapshot, quantity from public.pos_order_items where order_id = created_order_id order by id loop
    select priced.value into entry
    from jsonb_array_elements(p_line_pricing) as priced(value)
    where priced.value->>'cart_line_key' = item_row.cart_line_key;
    original_cop := round((entry->>'original_cop')::numeric, 2);
    final_cop := round((entry->>'final_cop')::numeric, 2);
    original_unit_cop := round(original_cop / item_row.quantity, 2);
    final_unit_cop := round(final_cop / item_row.quantity, 2);
    subsidy_cop := round(coalesce(nullif(entry->>'platform_subsidy_cop', '')::numeric, 0), 2);
    merchant_discount_cop := original_cop - final_cop;
    merchant_discount_percent := case when original_cop > 0 then round(merchant_discount_cop * 100 / original_cop, 4) else 0 end;
    commission_base_cop := merchant_discount_cop;
    commission_tax_cop := 0;
    commission_cop := merchant_discount_cop;
    net_expected_cop := final_cop;
    merchant_discount_total := merchant_discount_total + merchant_discount_cop;
    commission_total := commission_total + commission_cop;
    insert into public.platform_order_line_estimates(
      order_id, order_item_id, cart_line_key, name_snapshot, quantity, original_unit_cop, final_unit_cop, original_cop, final_cop,
      merchant_discount_cop, merchant_discount_percent, platform_subsidy_cop,
      commission_base_cop, commission_tax_cop, commission_cop, net_expected_cop
    ) values (
      created_order_id, item_row.id, item_row.cart_line_key, coalesce(nullif(entry->>'name', ''), item_row.product_name_snapshot), item_row.quantity, original_unit_cop, final_unit_cop, original_cop, final_cop,
      merchant_discount_cop, merchant_discount_percent, subsidy_cop,
      commission_base_cop, commission_tax_cop, commission_cop, net_expected_cop
    );
  end loop;

  if order_row.delivery_cop > 0 then
    commission_base_cop := 0;
    commission_tax_cop := 0;
    commission_cop := 0;
    net_expected_cop := order_row.delivery_cop;
    insert into public.platform_order_line_estimates(
      order_id, cart_line_key, name_snapshot, quantity, original_unit_cop, final_unit_cop, original_cop, final_cop,
      merchant_discount_cop, merchant_discount_percent, platform_subsidy_cop,
      commission_base_cop, commission_tax_cop, commission_cop, net_expected_cop
    ) values (
      created_order_id, '__delivery__', 'DOMICILIO', 1, order_row.delivery_cop, order_row.delivery_cop, order_row.delivery_cop, order_row.delivery_cop,
      0, 0, 0,
      commission_base_cop, commission_tax_cop, commission_cop, net_expected_cop
    );
  end if;

  update public.pos_orders
  set subtotal_cop = round(greatest(0, order_row.subtotal_cop + order_row.combo_price_adjustment_cop), 2),
      combo_price_adjustment_cop = 0,
      discount_type = case when merchant_discount_total > 0 then 'amount' else 'none' end,
      discount_value = round(merchant_discount_total, 2),
      discount_cop = round(merchant_discount_total, 2),
      discount_applied_by = case when merchant_discount_total > 0 then auth.uid() else null end,
      total_cop = customer_total,
      updated_at = now()
  where id = created_order_id;

  update public.pos_order_payments
  set amount_cop = customer_total
  where order_id = created_order_id and method = p_source_channel;

  update public.platform_receivables
  set gross_cop = catalog_total,
      estimated_commission_cop = round(commission_total, 2),
      net_expected_cop = customer_total
  where order_id = created_order_id;
  if not found then
    raise exception 'No se encontró la liquidación pendiente de la plataforma.';
  end if;

  created_order := jsonb_set(created_order, '{total_cop}', to_jsonb(customer_total), true);
  return created_order;
end;
$$;

revoke all on function public.create_pos_order_with_platform_line_pricing(text, text, text, text, numeric, numeric, numeric, text, text, text, text, jsonb, numeric, numeric, jsonb) from public;
grant execute on function public.create_pos_order_with_platform_line_pricing(text, text, text, text, numeric, numeric, numeric, text, text, text, text, jsonb, numeric, numeric, jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
