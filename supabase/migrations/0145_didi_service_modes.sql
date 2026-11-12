begin;

alter table public.platform_payment_settings
  add column if not exists didi_tu_negocio_commission_percent numeric(7,4) not null default 9.5 check (didi_tu_negocio_commission_percent between 0 and 100),
  add column if not exists didi_tu_negocio_commission_tax_percent numeric(7,4) not null default 19 check (didi_tu_negocio_commission_tax_percent between 0 and 100),
  add column if not exists didi_tu_negocio_fixed_fee_cop numeric(14,2) not null default 0 check (didi_tu_negocio_fixed_fee_cop >= 0),
  add column if not exists didi_tu_negocio_settlement_due_days integer not null default 7 check (didi_tu_negocio_settlement_due_days between 0 and 60);

alter table public.pos_orders
  add column if not exists platform_service text not null default 'none'
    check (platform_service in ('none', 'rappi_standard', 'didi_standard', 'didi_tu_negocio'));

alter table public.platform_receivables
  add column if not exists platform_service text not null default 'none'
    check (platform_service in ('none', 'rappi_standard', 'didi_standard', 'didi_tu_negocio'));

update public.pos_orders
set platform_service = case source_channel
  when 'rappi' then 'rappi_standard'
  when 'didi' then 'didi_standard'
  else 'none'
end
where platform_service = 'none';

update public.platform_receivables receivable
set platform_service = coalesce(order_row.platform_service, case receivable.platform when 'rappi' then 'rappi_standard' else 'didi_standard' end)
from public.pos_orders order_row
where order_row.id = receivable.order_id
  and receivable.platform_service = 'none';

create or replace function public.create_pos_order_with_platform_payment_service(
  p_kind text, p_customer_name text, p_customer_phone text, p_discount_type text, p_discount_value numeric, p_discount_cop numeric, p_delivery_cop numeric,
  p_payment_method text, p_source_channel text, p_collection_party text, p_notes text, p_items jsonb,
  p_cash_received_cop numeric, p_cash_change_cop numeric, p_platform_service text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare created_order jsonb; created_order_id uuid;
begin
  if p_platform_service not in ('rappi_standard', 'didi_standard', 'didi_tu_negocio') then raise exception 'Servicio de plataforma no válido.'; end if;
  if (p_source_channel = 'rappi' and p_platform_service <> 'rappi_standard') or (p_source_channel = 'didi' and p_platform_service not in ('didi_standard', 'didi_tu_negocio')) then raise exception 'El servicio no corresponde a la plataforma.'; end if;
  created_order := public.create_pos_order_with_platform_payment(p_kind, p_customer_name, p_customer_phone, p_discount_type, p_discount_value, p_discount_cop, p_delivery_cop, p_payment_method, p_source_channel, p_collection_party, p_notes, p_items, p_cash_received_cop, p_cash_change_cop);
  created_order_id := (created_order->>'id')::uuid;
  update public.pos_orders set platform_service = p_platform_service where id = created_order_id;
  update public.platform_receivables set platform_service = p_platform_service where order_id = created_order_id;
  return created_order;
end;
$$;

create or replace function public.create_pos_order_with_platform_line_pricing_service(
  p_kind text, p_customer_name text, p_customer_phone text, p_discount_type text, p_discount_value numeric, p_discount_cop numeric, p_delivery_cop numeric,
  p_payment_method text, p_source_channel text, p_collection_party text, p_notes text, p_items jsonb,
  p_cash_received_cop numeric, p_cash_change_cop numeric, p_platform_service text, p_line_pricing jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare created_order jsonb; created_order_id uuid;
begin
  if p_collection_party <> 'platform' then raise exception 'La liquidación detallada requiere recaudo de plataforma.'; end if;
  created_order := public.create_pos_order_with_platform_line_pricing(p_kind, p_customer_name, p_customer_phone, p_discount_type, p_discount_value, p_discount_cop, p_delivery_cop, p_payment_method, p_source_channel, p_collection_party, p_notes, p_items, p_cash_received_cop, p_cash_change_cop, p_line_pricing);
  created_order_id := (created_order->>'id')::uuid;
  update public.pos_orders set platform_service = p_platform_service where id = created_order_id;
  update public.platform_receivables set platform_service = p_platform_service where order_id = created_order_id;
  return created_order;
end;
$$;

create or replace function public.create_pos_order_with_platform_line_pricing_service_and_pending_stock(
  p_kind text, p_customer_name text, p_customer_phone text, p_discount_type text, p_discount_value numeric, p_discount_cop numeric, p_delivery_cop numeric,
  p_payment_method text, p_source_channel text, p_collection_party text, p_notes text, p_items jsonb,
  p_cash_received_cop numeric, p_cash_change_cop numeric, p_platform_service text, p_line_pricing jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare created_order jsonb; created_order_id uuid;
begin
  if p_collection_party <> 'platform' then raise exception 'La liquidación detallada requiere recaudo de plataforma.'; end if;
  created_order := public.create_pos_order_with_platform_line_pricing_and_pending_stock(p_kind, p_customer_name, p_customer_phone, p_discount_type, p_discount_value, p_discount_cop, p_delivery_cop, p_payment_method, p_source_channel, p_collection_party, p_notes, p_items, p_cash_received_cop, p_cash_change_cop, p_line_pricing);
  created_order_id := (created_order->>'id')::uuid;
  update public.pos_orders set platform_service = p_platform_service where id = created_order_id;
  update public.platform_receivables set platform_service = p_platform_service where order_id = created_order_id;
  return created_order;
end;
$$;

grant execute on function public.create_pos_order_with_platform_payment_service(text, text, text, text, numeric, numeric, numeric, text, text, text, text, jsonb, numeric, numeric, text) to authenticated;
grant execute on function public.create_pos_order_with_platform_line_pricing_service(text, text, text, text, numeric, numeric, numeric, text, text, text, text, jsonb, numeric, numeric, text, jsonb) to authenticated;
grant execute on function public.create_pos_order_with_platform_line_pricing_service_and_pending_stock(text, text, text, text, numeric, numeric, numeric, text, text, text, text, jsonb, numeric, numeric, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
