create table if not exists public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cash_registers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  cash_register_id uuid not null references public.cash_registers(id) on delete restrict,
  opened_by uuid references auth.users(id) on delete set null,
  opened_at timestamptz not null default now(),
  opening_cash_cop numeric(14,2) not null check (opening_cash_cop >= 0),
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_by uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  expected_cash_cop numeric(14,2),
  counted_cash_cop numeric(14,2),
  difference_cash_cop numeric(14,2),
  closing_notes text,
  closing_snapshot jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cash_sessions_closing_check check (
    (status = 'open' and closed_at is null and expected_cash_cop is null and counted_cash_cop is null and difference_cash_cop is null)
    or
    (status = 'closed' and closed_at is not null and expected_cash_cop is not null and counted_cash_cop is not null and difference_cash_cop is not null)
  )
);

create unique index if not exists cash_sessions_one_open_per_register_idx
  on public.cash_sessions (cash_register_id)
  where status = 'open';

create table if not exists public.custody_funds (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.expense_categories(id) on delete restrict,
  description text not null,
  amount_cop numeric(14,2) not null check (amount_cop > 0),
  spent_at timestamptz not null default now(),
  payment_source text not null check (payment_source in ('cash_session', 'bank_transfer', 'custody_fund', 'other')),
  supplier_id uuid references public.suppliers(id) on delete set null,
  beneficiary_name text,
  document_number text,
  notes text,
  receipt_url text,
  created_by uuid references auth.users(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'voided')),
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete set null,
  void_reason text,
  cash_session_id uuid references public.cash_sessions(id) on delete restrict,
  cash_movement_id uuid,
  custody_fund_id uuid references public.custody_funds(id) on delete restrict,
  custody_fund_movement_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pos_order_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.pos_orders(id) on delete cascade,
  method text not null check (method in ('cash', 'transfer', 'mixed', 'pending')),
  amount_cop numeric(14,2) not null check (amount_cop >= 0),
  cash_received_cop numeric(14,2),
  cash_change_cop numeric(14,2),
  cash_session_id uuid references public.cash_sessions(id) on delete restrict,
  cash_movement_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint pos_order_payments_cash_check check (
    (method = 'cash' and cash_received_cop is not null and cash_change_cop is not null and cash_session_id is not null)
    or
    (method <> 'cash' and cash_received_cop is null and cash_change_cop is null)
  )
);

create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  cash_session_id uuid not null references public.cash_sessions(id) on delete restrict,
  movement_kind text not null check (movement_kind in ('sale_cash', 'expense_cash', 'withdrawal', 'manual_income', 'manual_out', 'refund_cash')),
  direction text not null check (direction in ('in', 'out')),
  source_kind text not null check (source_kind in ('pos_order', 'expense', 'withdrawal', 'manual', 'refund')),
  destination text,
  amount_cop numeric(14,2) not null check (amount_cop > 0),
  occurred_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  reason text,
  order_id uuid references public.pos_orders(id) on delete restrict,
  expense_id uuid references public.expenses(id) on delete restrict,
  payment_id uuid references public.pos_order_payments(id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table public.expenses
  add constraint expenses_cash_movement_fk foreign key (cash_movement_id) references public.cash_movements(id) on delete restrict;

create table if not exists public.custody_fund_movements (
  id uuid primary key default gen_random_uuid(),
  custody_fund_id uuid not null references public.custody_funds(id) on delete restrict,
  direction text not null check (direction in ('in', 'out')),
  source_kind text not null check (source_kind in ('cash_withdrawal', 'expense', 'manual')),
  amount_cop numeric(14,2) not null check (amount_cop > 0),
  occurred_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  reason text,
  cash_movement_id uuid references public.cash_movements(id) on delete restrict,
  expense_id uuid references public.expenses(id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table public.expenses
  add constraint expenses_custody_fund_movement_fk foreign key (custody_fund_movement_id) references public.custody_fund_movements(id) on delete restrict;

create table if not exists public.cash_counts (
  id uuid primary key default gen_random_uuid(),
  cash_session_id uuid not null references public.cash_sessions(id) on delete restrict,
  theoretical_cash_cop numeric(14,2) not null,
  counted_cash_cop numeric(14,2) not null check (counted_cash_cop >= 0),
  difference_cash_cop numeric(14,2) not null,
  notes text,
  counted_by uuid references auth.users(id) on delete set null,
  counted_at timestamptz not null default now()
);

create index if not exists expense_categories_sort_idx on public.expense_categories (sort_order, name);
create index if not exists expenses_spent_at_idx on public.expenses (spent_at desc);
create index if not exists expenses_category_idx on public.expenses (category_id);
create index if not exists cash_sessions_status_opened_idx on public.cash_sessions (status, opened_at desc);
create index if not exists cash_movements_session_idx on public.cash_movements (cash_session_id, occurred_at desc);
create index if not exists cash_movements_order_idx on public.cash_movements (order_id);
create index if not exists cash_counts_session_idx on public.cash_counts (cash_session_id, counted_at desc);
create index if not exists pos_order_payments_order_idx on public.pos_order_payments (order_id);
create index if not exists custody_fund_movements_fund_idx on public.custody_fund_movements (custody_fund_id, occurred_at desc);

insert into public.cash_registers (name)
values ('CAJA PRINCIPAL')
on conflict (name) do nothing;

insert into public.custody_funds (name)
values ('FONDO DE RESGUARDO')
on conflict (name) do nothing;

insert into public.expense_categories (name, sort_order)
values
  ('ARRIENDO', 1),
  ('SERVICIOS PUBLICOS', 2),
  ('IMPUESTOS', 3),
  ('LIMPIEZA', 4),
  ('MANTENIMIENTO', 5),
  ('PUBLICIDAD', 6),
  ('TRANSPORTE', 7),
  ('NOMINA', 8),
  ('HONORARIOS', 9),
  ('COMISIONES', 10),
  ('OTROS', 11)
on conflict (name) do nothing;

insert into public.app_permissions (code, module_key, module_label, action_key, action_label, is_critical, sort_order)
values
  ('gastos.view', 'gastos', 'Gastos', 'view', 'Ver', false, 100),
  ('gastos.create', 'gastos', 'Gastos', 'create', 'Crear', false, 101),
  ('gastos.edit', 'gastos', 'Gastos', 'edit', 'Editar', false, 102),
  ('gastos.delete', 'gastos', 'Gastos', 'delete', 'Eliminar / anular', false, 103),
  ('gastos.categories', 'gastos', 'Gastos', 'categories', 'Categorias', false, 104),
  ('caja.open', 'caja', 'Caja', 'open', 'Abrir', false, 110),
  ('caja.view_movements', 'caja', 'Caja', 'view_movements', 'Ver movimientos', false, 111),
  ('caja.register_movement', 'caja', 'Caja', 'register_movement', 'Registrar movimiento', false, 112),
  ('caja.withdraw', 'caja', 'Caja', 'withdraw', 'Retirar efectivo', false, 113),
  ('caja.count', 'caja', 'Caja', 'count', 'Arqueo', false, 114),
  ('caja.close', 'caja', 'Caja', 'close', 'Cerrar', false, 115),
  ('caja.view_history', 'caja', 'Caja', 'view_history', 'Ver cierres historicos', false, 116)
on conflict (code) do update
  set module_key = excluded.module_key,
      module_label = excluded.module_label,
      action_key = excluded.action_key,
      action_label = excluded.action_label,
      is_critical = excluded.is_critical,
      sort_order = excluded.sort_order;

insert into public.app_role_permissions (role, permission_code)
select 'admin_sistema'::public.app_role, code from public.app_permissions
on conflict do nothing;

insert into public.app_role_permissions (role, permission_code)
select 'gerente'::public.app_role, code
from public.app_permissions
where code like 'gastos.%' or code like 'caja.%'
on conflict do nothing;

insert into public.app_role_permissions (role, permission_code)
values
  ('vendedor', 'caja.open'),
  ('vendedor', 'caja.view_movements'),
  ('vendedor', 'caja.register_movement'),
  ('vendedor', 'caja.withdraw'),
  ('vendedor', 'caja.count'),
  ('vendedor', 'caja.close'),
  ('mesero', 'caja.view_movements')
on conflict do nothing;

alter table public.expense_categories enable row level security;
alter table public.expenses enable row level security;
alter table public.cash_registers enable row level security;
alter table public.cash_sessions enable row level security;
alter table public.cash_movements enable row level security;
alter table public.cash_counts enable row level security;
alter table public.custody_funds enable row level security;
alter table public.custody_fund_movements enable row level security;
alter table public.pos_order_payments enable row level security;

drop policy if exists "Staff can read expense categories" on public.expense_categories;
create policy "Staff can read expense categories" on public.expense_categories
  for select to authenticated
  using (public.current_user_has_permission('gastos.view') or public.current_user_has_permission('gastos.categories'));

drop policy if exists "Staff can manage expense categories" on public.expense_categories;
create policy "Staff can manage expense categories" on public.expense_categories
  for all to authenticated
  using (public.current_user_has_permission('gastos.categories'))
  with check (public.current_user_has_permission('gastos.categories'));

drop policy if exists "Staff can read expenses" on public.expenses;
create policy "Staff can read expenses" on public.expenses
  for select to authenticated
  using (public.current_user_has_permission('gastos.view'));

drop policy if exists "Staff can create expenses" on public.expenses;
create policy "Staff can create expenses" on public.expenses
  for insert to authenticated
  with check (public.current_user_has_permission('gastos.create'));

drop policy if exists "Staff can update expenses" on public.expenses;
create policy "Staff can update expenses" on public.expenses
  for update to authenticated
  using (public.current_user_has_permission('gastos.edit') or public.current_user_has_permission('gastos.delete'))
  with check (public.current_user_has_permission('gastos.edit') or public.current_user_has_permission('gastos.delete'));

drop policy if exists "Staff can read cash registers" on public.cash_registers;
create policy "Staff can read cash registers" on public.cash_registers
  for select to authenticated
  using (public.current_user_has_permission('caja.open') or public.current_user_has_permission('caja.view_movements'));

drop policy if exists "Staff can read cash sessions" on public.cash_sessions;
create policy "Staff can read cash sessions" on public.cash_sessions
  for select to authenticated
  using (public.current_user_has_permission('caja.view_movements') or public.current_user_has_permission('caja.open') or public.current_user_has_permission('caja.close'));

drop policy if exists "Staff can manage cash sessions" on public.cash_sessions;
create policy "Staff can manage cash sessions" on public.cash_sessions
  for all to authenticated
  using (public.current_user_has_permission('caja.open') or public.current_user_has_permission('caja.close'))
  with check (public.current_user_has_permission('caja.open') or public.current_user_has_permission('caja.close'));

drop policy if exists "Staff can read cash movements" on public.cash_movements;
create policy "Staff can read cash movements" on public.cash_movements
  for select to authenticated
  using (public.current_user_has_permission('caja.view_movements'));

drop policy if exists "Staff can manage cash movements" on public.cash_movements;
create policy "Staff can manage cash movements" on public.cash_movements
  for all to authenticated
  using (public.current_user_has_permission('caja.register_movement') or public.current_user_has_permission('caja.withdraw'))
  with check (public.current_user_has_permission('caja.register_movement') or public.current_user_has_permission('caja.withdraw'));

drop policy if exists "Staff can read cash counts" on public.cash_counts;
create policy "Staff can read cash counts" on public.cash_counts
  for select to authenticated
  using (public.current_user_has_permission('caja.count') or public.current_user_has_permission('caja.view_movements'));

drop policy if exists "Staff can create cash counts" on public.cash_counts;
create policy "Staff can create cash counts" on public.cash_counts
  for insert to authenticated
  with check (public.current_user_has_permission('caja.count'));

drop policy if exists "Staff can read custody funds" on public.custody_funds;
create policy "Staff can read custody funds" on public.custody_funds
  for select to authenticated
  using (public.current_user_has_permission('caja.view_movements') or public.current_user_has_permission('gastos.view'));

drop policy if exists "Staff can read custody fund movements" on public.custody_fund_movements;
create policy "Staff can read custody fund movements" on public.custody_fund_movements
  for select to authenticated
  using (public.current_user_has_permission('caja.view_movements') or public.current_user_has_permission('gastos.view'));

drop policy if exists "Staff can create custody fund movements" on public.custody_fund_movements;
create policy "Staff can create custody fund movements" on public.custody_fund_movements
  for insert to authenticated
  with check (public.current_user_has_permission('caja.withdraw') or public.current_user_has_permission('gastos.create'));

drop policy if exists "Staff can read pos order payments" on public.pos_order_payments;
create policy "Staff can read pos order payments" on public.pos_order_payments
  for select to authenticated
  using (public.current_user_has_permission('pedidos.view') or public.current_user_has_permission('caja.view_movements'));

drop policy if exists "Staff can create pos order payments" on public.pos_order_payments;
create policy "Staff can create pos order payments" on public.pos_order_payments
  for insert to authenticated
  with check (public.current_user_has_permission('pedidos.create'));

grant select, insert, update, delete on public.expense_categories to authenticated;
grant select, insert, update on public.expenses to authenticated;
grant select on public.cash_registers to authenticated;
grant select, insert, update on public.cash_sessions to authenticated;
grant select, insert on public.cash_movements to authenticated;
grant select, insert on public.cash_counts to authenticated;
grant select on public.custody_funds to authenticated;
grant select, insert on public.custody_fund_movements to authenticated;
grant select, insert, update on public.pos_order_payments to authenticated;

create or replace function public.cash_expected_for_session(p_cash_session_id uuid)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select round(
    coalesce(cs.opening_cash_cop, 0)
    + coalesce(sum(case when cm.direction = 'in' then cm.amount_cop else -cm.amount_cop end), 0),
    2
  )
  from public.cash_sessions cs
  left join public.cash_movements cm on cm.cash_session_id = cs.id
  where cs.id = p_cash_session_id
  group by cs.id, cs.opening_cash_cop;
$$;

create or replace function public.custody_fund_balance(p_custody_fund_id uuid)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select round(coalesce(sum(case when direction = 'in' then amount_cop else -amount_cop end), 0), 2)
  from public.custody_fund_movements
  where custody_fund_id = p_custody_fund_id;
$$;

create or replace function public.open_cash_session(p_opening_cash_cop numeric, p_cash_register_id uuid default null)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  register_id uuid;
  session_id uuid;
begin
  if not public.current_user_has_permission('caja.open') then
    raise exception 'No tienes permisos para abrir caja.';
  end if;
  if coalesce(p_opening_cash_cop, -1) < 0 then
    raise exception 'La base inicial debe ser mayor o igual a cero.';
  end if;

  select id into register_id
  from public.cash_registers
  where id = coalesce(p_cash_register_id, id)
    and is_active = true
  order by created_at
  limit 1;

  if register_id is null then
    raise exception 'No hay caja activa configurada.';
  end if;

  insert into public.cash_sessions (cash_register_id, opened_by, opening_cash_cop)
  values (register_id, auth.uid(), round(p_opening_cash_cop, 2))
  returning id into session_id;

  return jsonb_build_object('id', session_id, 'opening_cash_cop', round(p_opening_cash_cop, 2));
end;
$$;

create or replace function public.register_cash_movement(
  p_cash_session_id uuid,
  p_movement_kind text,
  p_amount_cop numeric,
  p_destination text,
  p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  session_row record;
  movement_id uuid;
  direction_value text;
  source_kind_value text;
  fund_id uuid;
begin
  if not public.current_user_has_permission('caja.register_movement') and not public.current_user_has_permission('caja.withdraw') then
    raise exception 'No tienes permisos para registrar movimientos de caja.';
  end if;
  if coalesce(p_amount_cop, 0) <= 0 then
    raise exception 'El valor del movimiento debe ser mayor que cero.';
  end if;
  if p_movement_kind not in ('manual_income', 'manual_out', 'withdrawal') then
    raise exception 'Tipo de movimiento no valido.';
  end if;

  select * into session_row from public.cash_sessions where id = p_cash_session_id for update;
  if not found then raise exception 'Sesion de caja no encontrada.'; end if;
  if session_row.status <> 'open' then raise exception 'La caja ya esta cerrada.'; end if;

  direction_value := case when p_movement_kind = 'manual_income' then 'in' else 'out' end;
  source_kind_value := case when p_movement_kind = 'withdrawal' then 'withdrawal' else 'manual' end;

  insert into public.cash_movements (
    cash_session_id, movement_kind, direction, source_kind, destination, amount_cop, created_by, reason
  )
  values (
    p_cash_session_id, p_movement_kind, direction_value, source_kind_value, nullif(btrim(p_destination), ''),
    round(p_amount_cop, 2), auth.uid(), nullif(btrim(p_reason), '')
  )
  returning id into movement_id;

  if p_movement_kind = 'withdrawal' and p_destination = 'custody_fund' then
    select id into fund_id from public.custody_funds where is_active = true order by created_at limit 1;
    if fund_id is null then raise exception 'No hay fondo de resguardo activo.'; end if;
    insert into public.custody_fund_movements (
      custody_fund_id, direction, source_kind, amount_cop, created_by, reason, cash_movement_id
    )
    values (fund_id, 'in', 'cash_withdrawal', round(p_amount_cop, 2), auth.uid(), nullif(btrim(p_reason), ''), movement_id);
  end if;

  return jsonb_build_object('id', movement_id, 'expected_cash_cop', public.cash_expected_for_session(p_cash_session_id));
end;
$$;

create or replace function public.register_expense(
  p_category_id uuid,
  p_description text,
  p_amount_cop numeric,
  p_spent_at timestamptz,
  p_payment_source text,
  p_supplier_id uuid default null,
  p_beneficiary_name text default null,
  p_document_number text default null,
  p_notes text default null,
  p_receipt_url text default null,
  p_custody_fund_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  expense_id uuid;
  session_id uuid;
  movement_id uuid;
  fund_id uuid;
  fund_movement_id uuid;
  fund_balance numeric;
begin
  if not public.current_user_has_permission('gastos.create') then
    raise exception 'No tienes permisos para registrar gastos.';
  end if;
  if coalesce(p_amount_cop, 0) <= 0 then
    raise exception 'El valor del gasto debe ser mayor que cero.';
  end if;
  if nullif(btrim(coalesce(p_description, '')), '') is null then
    raise exception 'Ingresa el concepto del gasto.';
  end if;
  if p_payment_source not in ('cash_session', 'bank_transfer', 'custody_fund', 'other') then
    raise exception 'Origen de pago no valido.';
  end if;

  insert into public.expenses (
    category_id, description, amount_cop, spent_at, payment_source, supplier_id,
    beneficiary_name, document_number, notes, receipt_url, created_by
  )
  values (
    p_category_id, upper(btrim(p_description)), round(p_amount_cop, 2), coalesce(p_spent_at, now()), p_payment_source,
    p_supplier_id, nullif(upper(btrim(coalesce(p_beneficiary_name, ''))), ''), nullif(upper(btrim(coalesce(p_document_number, ''))), ''),
    nullif(upper(btrim(coalesce(p_notes, ''))), ''), nullif(btrim(coalesce(p_receipt_url, '')), ''), auth.uid()
  )
  returning id into expense_id;

  if p_payment_source = 'cash_session' then
    select id into session_id
    from public.cash_sessions
    where status = 'open'
    order by opened_at desc
    limit 1
    for update;
    if session_id is null then raise exception 'Abre caja antes de registrar un gasto desde Caja actual.'; end if;

    insert into public.cash_movements (
      cash_session_id, movement_kind, direction, source_kind, amount_cop, occurred_at, created_by, reason, expense_id
    )
    values (session_id, 'expense_cash', 'out', 'expense', round(p_amount_cop, 2), coalesce(p_spent_at, now()), auth.uid(), upper(btrim(p_description)), expense_id)
    returning id into movement_id;

    update public.expenses
    set cash_session_id = session_id,
        cash_movement_id = movement_id
    where id = expense_id;
  elsif p_payment_source = 'custody_fund' then
    fund_id := p_custody_fund_id;
    if fund_id is null then
      select id into fund_id from public.custody_funds where is_active = true order by created_at limit 1;
    end if;
    if fund_id is null then raise exception 'No hay fondo de resguardo activo.'; end if;
    fund_balance := public.custody_fund_balance(fund_id);
    if fund_balance < round(p_amount_cop, 2) then
      raise exception 'El fondo de resguardo no tiene saldo suficiente.';
    end if;
    insert into public.custody_fund_movements (
      custody_fund_id, direction, source_kind, amount_cop, occurred_at, created_by, reason, expense_id
    )
    values (fund_id, 'out', 'expense', round(p_amount_cop, 2), coalesce(p_spent_at, now()), auth.uid(), upper(btrim(p_description)), expense_id)
    returning id into fund_movement_id;

    update public.expenses
    set custody_fund_id = fund_id,
        custody_fund_movement_id = fund_movement_id
    where id = expense_id;
  end if;

  return jsonb_build_object('id', expense_id);
end;
$$;

create or replace function public.record_cash_count(p_cash_session_id uuid, p_counted_cash_cop numeric, p_notes text default null)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  expected numeric;
  count_id uuid;
  session_status text;
begin
  if not public.current_user_has_permission('caja.count') then
    raise exception 'No tienes permisos para realizar arqueos.';
  end if;
  if coalesce(p_counted_cash_cop, -1) < 0 then
    raise exception 'El efectivo contado debe ser mayor o igual a cero.';
  end if;
  select status into session_status from public.cash_sessions where id = p_cash_session_id;
  if not found then raise exception 'Sesion de caja no encontrada.'; end if;
  if session_status <> 'open' then raise exception 'La caja ya esta cerrada.'; end if;
  expected := public.cash_expected_for_session(p_cash_session_id);

  insert into public.cash_counts (
    cash_session_id, theoretical_cash_cop, counted_cash_cop, difference_cash_cop, notes, counted_by
  )
  values (p_cash_session_id, expected, round(p_counted_cash_cop, 2), round(p_counted_cash_cop - expected, 2), nullif(btrim(p_notes), ''), auth.uid())
  returning id into count_id;

  return jsonb_build_object('id', count_id, 'expected_cash_cop', expected, 'difference_cash_cop', round(p_counted_cash_cop - expected, 2));
end;
$$;

create or replace function public.close_cash_session(p_cash_session_id uuid, p_counted_cash_cop numeric, p_notes text default null)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  expected numeric;
  diff numeric;
  snapshot jsonb;
  session_row record;
begin
  if not public.current_user_has_permission('caja.close') then
    raise exception 'No tienes permisos para cerrar caja.';
  end if;
  if coalesce(p_counted_cash_cop, -1) < 0 then
    raise exception 'El efectivo contado debe ser mayor o igual a cero.';
  end if;

  select * into session_row from public.cash_sessions where id = p_cash_session_id for update;
  if not found then raise exception 'Sesion de caja no encontrada.'; end if;
  if session_row.status <> 'open' then raise exception 'La caja ya esta cerrada.'; end if;

  expected := public.cash_expected_for_session(p_cash_session_id);
  diff := round(p_counted_cash_cop - expected, 2);
  snapshot := jsonb_build_object(
    'opening_cash_cop', session_row.opening_cash_cop,
    'sales_cash_cop', coalesce((select sum(amount_cop) from public.cash_movements where cash_session_id = p_cash_session_id and movement_kind = 'sale_cash'), 0),
    'manual_income_cop', coalesce((select sum(amount_cop) from public.cash_movements where cash_session_id = p_cash_session_id and movement_kind = 'manual_income'), 0),
    'expenses_cash_cop', coalesce((select sum(amount_cop) from public.cash_movements where cash_session_id = p_cash_session_id and movement_kind = 'expense_cash'), 0),
    'withdrawals_cop', coalesce((select sum(amount_cop) from public.cash_movements where cash_session_id = p_cash_session_id and movement_kind = 'withdrawal'), 0),
    'refunds_cash_cop', coalesce((select sum(amount_cop) from public.cash_movements where cash_session_id = p_cash_session_id and movement_kind = 'refund_cash'), 0),
    'manual_out_cop', coalesce((select sum(amount_cop) from public.cash_movements where cash_session_id = p_cash_session_id and movement_kind = 'manual_out'), 0),
    'expected_cash_cop', expected,
    'counted_cash_cop', round(p_counted_cash_cop, 2),
    'difference_cash_cop', diff,
    'closed_at', now(),
    'closed_by', auth.uid()
  );

  update public.cash_sessions
  set status = 'closed',
      closed_by = auth.uid(),
      closed_at = now(),
      expected_cash_cop = expected,
      counted_cash_cop = round(p_counted_cash_cop, 2),
      difference_cash_cop = diff,
      closing_notes = nullif(btrim(p_notes), ''),
      closing_snapshot = snapshot,
      updated_at = now()
  where id = p_cash_session_id;

  return jsonb_build_object('id', p_cash_session_id, 'expected_cash_cop', expected, 'difference_cash_cop', diff);
end;
$$;

create or replace function public.delete_expense_category(p_category_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  usage_count integer;
begin
  if not public.current_user_has_permission('gastos.categories') then
    raise exception 'No tienes permisos para eliminar categorias de gasto.';
  end if;
  select count(*) into usage_count from public.expenses where category_id = p_category_id;
  if usage_count > 0 then
    raise exception 'No se puede eliminar esta categoria porque esta siendo utilizada en Gastos.';
  end if;
  delete from public.expense_categories where id = p_category_id;
  return jsonb_build_object('id', p_category_id);
end;
$$;

create or replace function public.move_expense_category(p_category_id uuid, p_direction text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_row record;
  swap_row record;
begin
  if not public.current_user_has_permission('gastos.categories') then
    raise exception 'No tienes permisos para ordenar categorias de gasto.';
  end if;
  select id, sort_order into current_row from public.expense_categories where id = p_category_id for update;
  if not found then raise exception 'Categoria no encontrada.'; end if;
  if p_direction = 'up' then
    select id, sort_order into swap_row
    from public.expense_categories
    where sort_order < current_row.sort_order
    order by sort_order desc, name desc
    limit 1
    for update;
  elsif p_direction = 'down' then
    select id, sort_order into swap_row
    from public.expense_categories
    where sort_order > current_row.sort_order
    order by sort_order asc, name asc
    limit 1
    for update;
  else
    raise exception 'Direccion no valida.';
  end if;
  if swap_row.id is null then return; end if;
  update public.expense_categories set sort_order = swap_row.sort_order, updated_at = now() where id = current_row.id;
  update public.expense_categories set sort_order = current_row.sort_order, updated_at = now() where id = swap_row.id;
end;
$$;

create or replace function public.void_expense(p_expense_id uuid, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  expense_row record;
  cash_session_status text;
  fund_balance numeric;
begin
  if not public.current_user_has_permission('gastos.delete') then
    raise exception 'No tienes permisos para anular gastos.';
  end if;
  select * into expense_row from public.expenses where id = p_expense_id for update;
  if not found then raise exception 'Gasto no encontrado.'; end if;
  if expense_row.status = 'voided' then
    return jsonb_build_object('id', p_expense_id, 'status', 'voided');
  end if;
  if expense_row.cash_session_id is not null then
    select status into cash_session_status from public.cash_sessions where id = expense_row.cash_session_id;
    if cash_session_status <> 'open' then
      raise exception 'No se puede anular un gasto asociado a una caja cerrada.';
    end if;
    insert into public.cash_movements (
      cash_session_id, movement_kind, direction, source_kind, amount_cop, created_by, reason, expense_id
    )
    values (expense_row.cash_session_id, 'manual_income', 'in', 'expense', expense_row.amount_cop, auth.uid(), coalesce(nullif(btrim(p_reason), ''), 'REVERSO DE GASTO'), p_expense_id);
  elsif expense_row.custody_fund_id is not null then
    insert into public.custody_fund_movements (
      custody_fund_id, direction, source_kind, amount_cop, created_by, reason, expense_id
    )
    values (expense_row.custody_fund_id, 'in', 'expense', expense_row.amount_cop, auth.uid(), coalesce(nullif(btrim(p_reason), ''), 'REVERSO DE GASTO'), p_expense_id);
  end if;

  update public.expenses
  set status = 'voided',
      voided_at = now(),
      voided_by = auth.uid(),
      void_reason = nullif(btrim(p_reason), ''),
      updated_at = now()
  where id = p_expense_id;

  return jsonb_build_object('id', p_expense_id, 'status', 'voided');
end;
$$;

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
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'El pedido no tiene productos validos.';
  end if;

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

create or replace function public.cancel_pos_order(p_order_id uuid, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  order_row record;
  payment_row record;
  session_status text;
begin
  if not app_private.has_any_role(array['vendedor'::public.app_role, 'mesero'::public.app_role, 'gerente'::public.app_role, 'admin_sistema'::public.app_role]) then
    raise exception 'No tienes permisos para cancelar pedidos.';
  end if;

  select * into order_row
  from public.pos_orders
  where id = p_order_id
  for update;

  if not found then raise exception 'Pedido no encontrado.'; end if;
  if order_row.status = 'cancelled' then
    return jsonb_build_object('id', order_row.id, 'code', order_row.code, 'status', order_row.status);
  end if;
  if order_row.status = 'delivered' then
    raise exception 'No se puede cancelar un pedido entregado.';
  end if;

  select *
  into payment_row
  from public.pos_order_payments
  where order_id = p_order_id
    and method = 'cash'
  order by created_at desc
  limit 1
  for update;

  if found then
    select status into session_status from public.cash_sessions where id = payment_row.cash_session_id for update;
    if session_status <> 'open' then
      raise exception 'No se puede cancelar un pedido en efectivo asociado a una caja cerrada.';
    end if;
    insert into public.cash_movements (
      cash_session_id, movement_kind, direction, source_kind, amount_cop, created_by, reason, order_id, payment_id
    )
    values (
      payment_row.cash_session_id, 'refund_cash', 'out', 'refund', payment_row.amount_cop, auth.uid(),
      coalesce(nullif(btrim(p_reason), ''), 'CANCELACION DE PEDIDO') || ' ' || order_row.code,
      p_order_id, payment_row.id
    );
  end if;

  update public.pos_orders
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = auth.uid(),
      cancel_reason = nullif(btrim(p_reason), ''),
      updated_at = now()
  where id = p_order_id;

  insert into public.pos_order_status_events (order_id, from_status, to_status, actor_id, notes)
  values (p_order_id, order_row.status, 'cancelled', auth.uid(), nullif(btrim(p_reason), ''));

  return jsonb_build_object('id', order_row.id, 'code', order_row.code, 'status', 'cancelled');
end;
$$;

grant execute on function public.cash_expected_for_session(uuid) to authenticated;
grant execute on function public.custody_fund_balance(uuid) to authenticated;
grant execute on function public.open_cash_session(numeric, uuid) to authenticated;
grant execute on function public.register_cash_movement(uuid, text, numeric, text, text) to authenticated;
grant execute on function public.register_expense(uuid, text, numeric, timestamptz, text, uuid, text, text, text, text, uuid) to authenticated;
grant execute on function public.record_cash_count(uuid, numeric, text) to authenticated;
grant execute on function public.close_cash_session(uuid, numeric, text) to authenticated;
grant execute on function public.delete_expense_category(uuid) to authenticated;
grant execute on function public.move_expense_category(uuid, text) to authenticated;
grant execute on function public.void_expense(uuid, text) to authenticated;
grant execute on function public.create_pos_order_with_payment(text, text, text, numeric, numeric, text, text, jsonb, numeric, numeric) to authenticated;
grant execute on function public.cancel_pos_order(uuid, text) to authenticated;

notify pgrst, 'reload schema';
