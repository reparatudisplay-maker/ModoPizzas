begin;

alter table public.pos_orders
  add column if not exists source_channel text not null default 'direct'
    check (source_channel in ('direct', 'rappi', 'didi')),
  add column if not exists collection_party text not null default 'business'
    check (collection_party in ('business', 'platform'));

alter table public.pos_orders drop constraint if exists pos_orders_payment_method_check;
alter table public.pos_orders add constraint pos_orders_payment_method_check
  check (payment_method in ('cash', 'card', 'transfer', 'mixed', 'pending', 'rappi', 'didi'));

alter table public.pos_order_payments drop constraint if exists pos_order_payments_method_check;
alter table public.pos_order_payments add constraint pos_order_payments_method_check
  check (method in ('cash', 'transfer', 'mixed', 'pending', 'rappi', 'didi'));

create table if not exists public.platform_payment_settings (
  platform text primary key check (platform in ('rappi', 'didi')),
  commission_percent numeric(7,4) not null default 0 check (commission_percent between 0 and 100),
  fixed_fee_cop numeric(14,2) not null default 0 check (fixed_fee_cop >= 0),
  settlement_due_days smallint not null default 7 check (settlement_due_days between 0 and 60),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.platform_payment_settings (platform) values ('rappi'), ('didi') on conflict (platform) do nothing;

create table if not exists public.platform_receivables (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.pos_orders(id) on delete restrict,
  platform text not null references public.platform_payment_settings(platform) on delete restrict,
  gross_cop numeric(14,2) not null check (gross_cop >= 0),
  estimated_commission_cop numeric(14,2) not null check (estimated_commission_cop >= 0),
  net_expected_cop numeric(14,2) not null check (net_expected_cop >= 0),
  due_at date not null,
  status text not null default 'pending' check (status in ('pending', 'liquidated', 'reconciled')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  reconciled_at timestamptz,
  reconciled_by uuid references auth.users(id) on delete set null
);

create table if not exists public.platform_settlements (
  id uuid primary key default gen_random_uuid(),
  platform text not null references public.platform_payment_settings(platform) on delete restrict,
  received_at timestamptz not null default now(),
  received_cop numeric(14,2) not null check (received_cop > 0),
  destination_account text not null,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create table if not exists public.platform_settlement_allocations (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.platform_settlements(id) on delete restrict,
  receivable_id uuid not null references public.platform_receivables(id) on delete restrict,
  gross_cop numeric(14,2) not null check (gross_cop >= 0),
  commission_cop numeric(14,2) not null check (commission_cop >= 0),
  net_cop numeric(14,2) not null check (net_cop >= 0),
  difference_cop numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (settlement_id, receivable_id)
);

create index if not exists platform_receivables_pending_idx on public.platform_receivables(platform, status, due_at);
create index if not exists platform_settlement_allocations_receivable_idx on public.platform_settlement_allocations(receivable_id);

alter table public.platform_payment_settings enable row level security;
alter table public.platform_receivables enable row level security;
alter table public.platform_settlements enable row level security;
alter table public.platform_settlement_allocations enable row level security;

create policy "Cash staff can read platform settings" on public.platform_payment_settings for select to authenticated using (public.current_user_can_access_module('caja') or public.current_user_can_access_module('pedidos'));
create policy "Cash staff manage platform settings" on public.platform_payment_settings for all to authenticated using (public.current_user_can_access_module('caja')) with check (public.current_user_can_access_module('caja'));
create policy "Cash staff read platform receivables" on public.platform_receivables for select to authenticated using (public.current_user_can_access_module('caja'));
create policy "Cash staff read platform settlements" on public.platform_settlements for select to authenticated using (public.current_user_can_access_module('caja'));
create policy "Cash staff read platform settlement allocations" on public.platform_settlement_allocations for select to authenticated using (public.current_user_can_access_module('caja'));

create or replace function public.create_pos_order_with_platform_payment(
  p_kind text, p_customer_name text, p_customer_phone text, p_discount_type text, p_discount_value numeric, p_discount_cop numeric, p_delivery_cop numeric,
  p_payment_method text, p_source_channel text, p_collection_party text, p_notes text, p_items jsonb, p_cash_received_cop numeric default null, p_cash_change_cop numeric default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  created_order jsonb;
  created_order_id uuid;
  order_total numeric;
  setting_row public.platform_payment_settings%rowtype;
  estimated_commission numeric;
begin
  if p_payment_method not in ('cash', 'transfer', 'mixed', 'pending', 'rappi', 'didi') then raise exception 'Selecciona la forma de pago.'; end if;
  if p_source_channel not in ('direct', 'rappi', 'didi') or p_collection_party not in ('business', 'platform') then raise exception 'El canal del pedido no es válido.'; end if;
  if p_collection_party = 'platform' and (p_source_channel not in ('rappi', 'didi') or p_payment_method <> p_source_channel) then raise exception 'La plataforma que recauda debe coincidir con el pago.'; end if;

  created_order := public.create_pos_order_with_discount_payment(p_kind, p_customer_name, p_customer_phone, p_discount_type, p_discount_value, p_discount_cop, p_delivery_cop,
    case when p_collection_party = 'platform' then 'pending' else p_payment_method end, p_notes, p_items, p_cash_received_cop, p_cash_change_cop);
  created_order_id := (created_order->>'id')::uuid;

  update public.pos_orders set source_channel = p_source_channel, collection_party = p_collection_party,
    payment_method = case when p_collection_party = 'platform' then p_source_channel else payment_method end where id = created_order_id;

  if p_collection_party = 'platform' then
    update public.pos_order_payments set method = p_source_channel where order_id = created_order_id and method = 'pending';
    select * into setting_row from public.platform_payment_settings where platform = p_source_channel for share;
    select total_cop into order_total from public.pos_orders where id = created_order_id;
    estimated_commission := round(order_total * setting_row.commission_percent / 100 + setting_row.fixed_fee_cop, 2);
    insert into public.platform_receivables(order_id, platform, gross_cop, estimated_commission_cop, net_expected_cop, due_at, created_by)
    values(created_order_id, p_source_channel, order_total, estimated_commission, greatest(0, order_total - estimated_commission), current_date + setting_row.settlement_due_days, auth.uid());
    created_order := jsonb_set(created_order, '{payment_method}', to_jsonb(p_source_channel), true);
  end if;
  return created_order;
end $$;

create or replace function public.register_platform_settlement(p_platform text, p_received_at timestamptz, p_received_cop numeric, p_destination_account text, p_notes text, p_allocations jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare settlement_id uuid; allocation jsonb; row public.platform_receivables%rowtype; net_total numeric := 0;
begin
  if not public.current_user_can_access_module('caja') then raise exception 'No tienes acceso a caja.'; end if;
  if p_platform not in ('rappi', 'didi') or p_received_cop <= 0 or nullif(btrim(p_destination_account), '') is null then raise exception 'La liquidación no es válida.'; end if;
  if jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) = 0 then raise exception 'Selecciona al menos un pedido.'; end if;
  insert into public.platform_settlements(platform, received_at, received_cop, destination_account, notes, created_by) values(p_platform, coalesce(p_received_at, now()), p_received_cop, btrim(p_destination_account), nullif(btrim(p_notes), ''), auth.uid()) returning id into settlement_id;
  for allocation in select value from jsonb_array_elements(p_allocations) loop
    select * into row from public.platform_receivables where id = (allocation->>'receivable_id')::uuid and platform = p_platform and status <> 'reconciled' for update;
    if not found then raise exception 'Una cuenta por cobrar ya no está disponible.'; end if;
    if coalesce((allocation->>'net_cop')::numeric, 0) <= 0 or coalesce((allocation->>'gross_cop')::numeric, 0) < 0 or coalesce((allocation->>'commission_cop')::numeric, 0) < 0 then raise exception 'Los importes de la liquidación no son válidos.'; end if;
    insert into public.platform_settlement_allocations(settlement_id, receivable_id, gross_cop, commission_cop, net_cop, difference_cop)
    values(settlement_id, row.id, (allocation->>'gross_cop')::numeric, (allocation->>'commission_cop')::numeric, (allocation->>'net_cop')::numeric, (allocation->>'net_cop')::numeric - (allocation->>'gross_cop')::numeric + (allocation->>'commission_cop')::numeric);
    net_total := net_total + (allocation->>'net_cop')::numeric;
    update public.platform_receivables set status = case when coalesce((select sum(net_cop) from public.platform_settlement_allocations where receivable_id = row.id), 0) >= net_expected_cop then 'liquidated' else 'pending' end where id = row.id;
  end loop;
  if round(net_total, 2) <> round(p_received_cop, 2) then raise exception 'La suma de los pedidos debe coincidir con el valor recibido.'; end if;
  return settlement_id;
end $$;

create or replace function public.reconcile_platform_receivable(p_receivable_id uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.current_user_can_access_module('caja') then raise exception 'No tienes acceso a caja.'; end if;
  update public.platform_receivables set status = 'reconciled', reconciled_at = now(), reconciled_by = auth.uid() where id = p_receivable_id and status = 'liquidated';
  if not found then raise exception 'Solo se pueden conciliar liquidaciones completas.'; end if;
end $$;

grant execute on function public.create_pos_order_with_platform_payment(text, text, text, text, numeric, numeric, numeric, text, text, text, text, jsonb, numeric, numeric) to authenticated;
grant execute on function public.register_platform_settlement(text, timestamptz, numeric, text, text, jsonb) to authenticated;
grant execute on function public.reconcile_platform_receivable(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
