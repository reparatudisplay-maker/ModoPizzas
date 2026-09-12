-- Commercial discounts are frozen with the order. Inventory consumption remains unchanged.

alter table public.pos_orders
  add column if not exists discount_type text not null default 'none',
  add column if not exists discount_value numeric(14, 2) not null default 0,
  add column if not exists discount_applied_by uuid references auth.users(id) on delete set null;

update public.pos_orders
set discount_type = case when coalesce(discount_cop, 0) > 0 then 'amount' else 'none' end,
    discount_value = case when coalesce(discount_cop, 0) > 0 then discount_cop else 0 end
where discount_type = 'none' and coalesce(discount_cop, 0) > 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pos_orders_discount_type_check'
  ) then
    alter table public.pos_orders
      add constraint pos_orders_discount_type_check
      check (discount_type in ('none', 'percentage', 'amount'));
  end if;
end;
$$;

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
  order_id uuid;
  order_subtotal numeric;
  expected_discount numeric;
begin
  if not public.current_user_can_access_module('pedidos') then
    raise exception 'No tienes acceso operativo a pedidos.';
  end if;

  p_discount_type := coalesce(nullif(trim(p_discount_type), ''), 'none');
  p_discount_value := coalesce(p_discount_value, 0);
  p_discount_cop := coalesce(p_discount_cop, 0);

  if p_discount_type not in ('none', 'percentage', 'amount') then
    raise exception 'El tipo de descuento no es válido.';
  end if;
  if p_discount_type = 'none' and (p_discount_value <> 0 or p_discount_cop <> 0) then
    raise exception 'El descuento no es válido.';
  end if;
  if p_discount_type = 'percentage' and (p_discount_value <= 0 or p_discount_value >= 100) then
    raise exception 'El descuento porcentual debe ser mayor que cero y menor al 100%%.';
  end if;
  if p_discount_type = 'amount' and p_discount_value <= 0 then
    raise exception 'El descuento debe ser mayor que cero.';
  end if;

  -- The established payment RPC remains the only writer for orders, payments,
  -- cash movements and FEFO/FIFO allocations. Any validation failure rolls back
  -- its work in this same transaction.
  created_order := public.create_pos_order_with_payment(
    p_kind, p_customer_name, p_customer_phone, p_discount_cop, p_delivery_cop,
    p_payment_method, p_notes, p_items, p_cash_received_cop, p_cash_change_cop
  );
  order_id := (created_order->>'id')::uuid;

  select subtotal_cop into order_subtotal from public.pos_orders where id = order_id for update;
  expected_discount := case
    when p_discount_type = 'percentage' then round(order_subtotal * p_discount_value / 100, 0)
    when p_discount_type = 'amount' then round(p_discount_value, 0)
    else 0
  end;

  if expected_discount < 0 or expected_discount >= order_subtotal or round(p_discount_cop, 0) <> expected_discount then
    raise exception 'El descuento no es válido para el subtotal del pedido.';
  end if;

  update public.pos_orders
  set discount_type = p_discount_type,
      discount_value = case when p_discount_type = 'none' then 0 else p_discount_value end,
      discount_cop = expected_discount,
      discount_applied_by = case when p_discount_type = 'none' then null else auth.uid() end,
      updated_at = now()
  where id = order_id;

  return created_order;
end;
$$;

revoke all on function public.create_pos_order_with_discount_payment(text, text, text, text, numeric, numeric, numeric, text, text, jsonb, numeric, numeric) from public;
grant execute on function public.create_pos_order_with_discount_payment(text, text, text, text, numeric, numeric, numeric, text, text, jsonb, numeric, numeric) to authenticated;

alter function public.get_sales_profitability_report(timestamptz, timestamptz, text)
  rename to get_sales_profitability_report_legacy;

create or replace function public.get_sales_profitability_report(
  p_from timestamptz,
  p_to timestamptz,
  p_bucket text default 'day'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
  gross_sales numeric;
  discounts numeric;
  net_sales numeric;
  cost_sales numeric;
  expenses numeric;
  order_count numeric;
  summary jsonb;
begin
  if not public.current_user_can_access_module('reportes') then
    raise exception 'No tienes acceso a reportes.';
  end if;
  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'El rango de fechas no es valido.';
  end if;

  result := public.get_sales_profitability_report_legacy(p_from, p_to, p_bucket);

  select
    coalesce(sum(o.subtotal_cop + o.delivery_cop), 0),
    coalesce(sum(o.discount_cop), 0),
    coalesce(sum(o.total_cop), 0),
    count(*)::numeric,
    coalesce(sum((select sum(i.line_cost_cop) from public.pos_order_items i where i.order_id = o.id)), 0)
  into gross_sales, discounts, net_sales, order_count, cost_sales
  from public.pos_orders o
  where o.created_at >= p_from and o.created_at < p_to and o.status <> 'cancelled';

  select coalesce(sum(e.amount_cop), 0) into expenses
  from public.expenses e
  where e.status = 'active' and e.spent_at >= p_from and e.spent_at < p_to;

  summary := jsonb_build_object(
    'gross_sales_cop', gross_sales,
    'discounts_cop', discounts,
    'sales_cop', net_sales,
    'cost_cop', cost_sales,
    'gross_profit_cop', net_sales - cost_sales,
    'expenses_cop', expenses,
    'operating_result_cop', net_sales - cost_sales - expenses,
    'gross_margin_pct', case when net_sales > 0 then round((net_sales - cost_sales) * 100 / net_sales, 2) else null end,
    'operating_margin_pct', case when net_sales > 0 then round((net_sales - cost_sales - expenses) * 100 / net_sales, 2) else null end,
    'orders', order_count,
    'average_ticket_cop', case when order_count > 0 then round(net_sales / order_count, 2) else 0 end,
    'cancelled_orders', coalesce((result->'summary'->>'cancelled_orders')::numeric, 0),
    'cancelled_amount_cop', coalesce((result->'summary'->>'cancelled_amount_cop')::numeric, 0)
  );

  return jsonb_set(result, '{summary}', summary, true);
end;
$$;

revoke all on function public.get_sales_profitability_report(timestamptz, timestamptz, text) from public;
grant execute on function public.get_sales_profitability_report(timestamptz, timestamptz, text) to authenticated;

notify pgrst, 'reload schema';
