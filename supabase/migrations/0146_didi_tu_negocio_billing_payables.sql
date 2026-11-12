begin;

alter table public.platform_payment_settings
  alter column didi_tu_negocio_commission_tax_percent set default 0;

update public.platform_payment_settings
set didi_tu_negocio_commission_tax_percent = 0
where platform = 'didi'
  and didi_tu_negocio_commission_percent = 9.5
  and didi_tu_negocio_commission_tax_percent = 19
  and didi_tu_negocio_fixed_fee_cop = 0;

create table if not exists public.platform_service_payables (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.pos_orders(id) on delete restrict,
  platform text not null references public.platform_payment_settings(platform) on delete restrict,
  platform_service text not null check (platform_service = 'didi_tu_negocio'),
  order_total_cop numeric(14,2) not null check (order_total_cop >= 0),
  estimated_charge_cop numeric(14,2) not null check (estimated_charge_cop >= 0),
  due_at date not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'void')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  paid_at timestamptz,
  paid_by uuid references auth.users(id) on delete set null,
  notes text
);

create index if not exists platform_service_payables_pending_idx
  on public.platform_service_payables(platform, status, due_at);

alter table public.platform_service_payables enable row level security;

create policy "Cash staff read platform service payables"
  on public.platform_service_payables for select to authenticated
  using (public.current_user_can_access_module('caja'));

create or replace function public.create_pos_order_with_platform_payment_service(
  p_kind text, p_customer_name text, p_customer_phone text, p_discount_type text, p_discount_value numeric, p_discount_cop numeric, p_delivery_cop numeric,
  p_payment_method text, p_source_channel text, p_collection_party text, p_notes text, p_items jsonb,
  p_cash_received_cop numeric, p_cash_change_cop numeric, p_platform_service text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  created_order jsonb;
  created_order_id uuid;
  order_total numeric;
  setting_row public.platform_payment_settings%rowtype;
  estimated_charge numeric;
begin
  if p_platform_service not in ('rappi_standard', 'didi_standard', 'didi_tu_negocio') then raise exception 'Servicio de plataforma no válido.'; end if;
  if (p_source_channel = 'rappi' and p_platform_service <> 'rappi_standard') or (p_source_channel = 'didi' and p_platform_service not in ('didi_standard', 'didi_tu_negocio')) then raise exception 'El servicio no corresponde a la plataforma.'; end if;

  created_order := public.create_pos_order_with_platform_payment(p_kind, p_customer_name, p_customer_phone, p_discount_type, p_discount_value, p_discount_cop, p_delivery_cop, p_payment_method, p_source_channel, p_collection_party, p_notes, p_items, p_cash_received_cop, p_cash_change_cop);
  created_order_id := (created_order->>'id')::uuid;
  update public.pos_orders set platform_service = p_platform_service where id = created_order_id;
  update public.platform_receivables set platform_service = p_platform_service where order_id = created_order_id;

  if p_source_channel = 'didi' and p_collection_party = 'business' and p_platform_service = 'didi_tu_negocio' then
    select total_cop into order_total from public.pos_orders where id = created_order_id;
    select * into setting_row from public.platform_payment_settings where platform = 'didi' for share;
    estimated_charge := round((order_total * setting_row.didi_tu_negocio_commission_percent / 100 + setting_row.didi_tu_negocio_fixed_fee_cop) * (1 + setting_row.didi_tu_negocio_commission_tax_percent / 100), 2);
    insert into public.platform_service_payables(order_id, platform, platform_service, order_total_cop, estimated_charge_cop, due_at, created_by)
    values (created_order_id, 'didi', 'didi_tu_negocio', order_total, greatest(0, estimated_charge), current_date + setting_row.didi_tu_negocio_settlement_due_days, auth.uid())
    on conflict (order_id) do nothing;
  end if;

  return created_order;
end;
$$;

grant execute on function public.create_pos_order_with_platform_payment_service(text, text, text, text, numeric, numeric, numeric, text, text, text, text, jsonb, numeric, numeric, text) to authenticated;

notify pgrst, 'reload schema';
commit;
