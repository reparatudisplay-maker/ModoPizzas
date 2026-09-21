create table if not exists public.pos_order_payment_corrections (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.pos_orders(id) on delete restrict,
  previous_payment_method text not null,
  new_payment_method text not null check (new_payment_method in ('cash', 'transfer', 'mixed', 'pending')),
  previous_payments jsonb not null default '[]'::jsonb,
  new_payments jsonb not null default '[]'::jsonb,
  reason text,
  changed_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists pos_order_payment_corrections_order_idx
  on public.pos_order_payment_corrections (order_id, created_at desc);

alter table public.pos_order_payment_corrections enable row level security;

drop policy if exists "Staff can read pos order payment corrections" on public.pos_order_payment_corrections;
create policy "Staff can read pos order payment corrections" on public.pos_order_payment_corrections
  for select using (
    public.current_user_can_access_module('pedidos')
    or app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role])
  );

grant select on public.pos_order_payment_corrections to authenticated;

create or replace function public.correct_pos_order_payment_method(
  p_order_id uuid,
  p_payment_method text,
  p_payments jsonb default '[]'::jsonb,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  order_row public.pos_orders%rowtype;
  previous_payments jsonb := '[]'::jsonb;
  normalized_payments jsonb := '[]'::jsonb;
  payment_entry jsonb;
  payment_method_value text := lower(nullif(btrim(coalesce(p_payment_method, '')), ''));
  amount_value numeric(14,2);
  cash_received_value numeric(14,2);
  cash_change_value numeric(14,2);
  cash_amount numeric(14,2) := 0;
  transfer_amount numeric(14,2) := 0;
  payment_total numeric(14,2) := 0;
  open_session_id uuid;
  payment_id uuid;
  movement_id uuid;
  old_cash_payment record;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesion.';
  end if;

  if not app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]) then
    raise exception 'No tienes permisos para corregir pagos.';
  end if;

  if payment_method_value is null or payment_method_value not in ('cash', 'transfer', 'mixed', 'pending') then
    raise exception 'Selecciona un metodo de pago valido.';
  end if;

  select * into order_row
  from public.pos_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Pedido no encontrado.';
  end if;

  if order_row.status = 'cancelled' then
    raise exception 'No se puede modificar el metodo de pago de un pedido cancelado.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at), '[]'::jsonb)
  into previous_payments
  from public.pos_order_payments p
  where p.order_id = p_order_id;

  if payment_method_value in ('cash', 'mixed') then
    select id into open_session_id
    from public.cash_sessions
    where status = 'open'
    order by opened_at desc
    limit 1
    for update;

    if open_session_id is null then
      raise exception 'Abre caja antes de registrar pagos en efectivo.';
    end if;
  end if;

  if payment_method_value = 'cash' then
    cash_received_value := coalesce(nullif(p_payments #>> '{0,cash_received_cop}', '')::numeric, order_row.total_cop);
    if cash_received_value < order_row.total_cop then
      raise exception 'El efectivo recibido no cubre el total del pedido.';
    end if;
    cash_change_value := round(cash_received_value - order_row.total_cop, 2);
    normalized_payments := jsonb_build_array(jsonb_build_object(
      'method', 'cash',
      'amount_cop', round(order_row.total_cop, 2),
      'cash_received_cop', cash_received_value,
      'cash_change_cop', cash_change_value
    ));
  elsif payment_method_value in ('transfer', 'pending') then
    normalized_payments := jsonb_build_array(jsonb_build_object(
      'method', payment_method_value,
      'amount_cop', round(order_row.total_cop, 2)
    ));
  else
    if jsonb_typeof(p_payments) <> 'array' then
      raise exception 'El desglose mixto no es valido.';
    end if;

    for payment_entry in select value from jsonb_array_elements(p_payments)
    loop
      amount_value := coalesce(nullif(payment_entry ->> 'amount_cop', '')::numeric, 0);
      if amount_value < 0 then
        raise exception 'Los valores del pago mixto no pueden ser negativos.';
      end if;
      if payment_entry ->> 'method' = 'cash' then
        cash_amount := cash_amount + amount_value;
      elsif payment_entry ->> 'method' = 'transfer' then
        transfer_amount := transfer_amount + amount_value;
      else
        raise exception 'El pago mixto solo permite efectivo y transferencia.';
      end if;
    end loop;

    payment_total := round(cash_amount + transfer_amount, 2);
    if cash_amount <= 0 or transfer_amount <= 0 then
      raise exception 'El pago mixto debe incluir efectivo y transferencia.';
    end if;
    if payment_total <> round(order_row.total_cop, 2) then
      raise exception 'El desglose mixto debe sumar exactamente el total del pedido.';
    end if;

    cash_received_value := coalesce(
      (select nullif(value ->> 'cash_received_cop', '')::numeric from jsonb_array_elements(p_payments) where value ->> 'method' = 'cash' limit 1),
      cash_amount
    );
    if cash_received_value < cash_amount then
      raise exception 'El efectivo recibido no cubre la parte en efectivo.';
    end if;
    cash_change_value := round(cash_received_value - cash_amount, 2);

    normalized_payments := jsonb_build_array(
      jsonb_build_object('method', 'cash', 'amount_cop', round(cash_amount, 2), 'cash_received_cop', cash_received_value, 'cash_change_cop', cash_change_value),
      jsonb_build_object('method', 'transfer', 'amount_cop', round(transfer_amount, 2))
    );
  end if;

  for old_cash_payment in
    select p.id, p.amount_cop, p.cash_session_id, cs.status as session_status
    from public.pos_order_payments p
    join public.cash_sessions cs on cs.id = p.cash_session_id
    where p.order_id = p_order_id
      and p.method = 'cash'
    for update of p, cs
  loop
    if old_cash_payment.session_status <> 'open' then
      raise exception 'No se puede corregir un pago en efectivo asociado a una caja cerrada.';
    end if;

    insert into public.cash_movements (
      cash_session_id, movement_kind, direction, source_kind, amount_cop, created_by, reason, order_id, payment_id
    )
    values (
      old_cash_payment.cash_session_id, 'refund_cash', 'out', 'refund', old_cash_payment.amount_cop, auth.uid(),
      coalesce(nullif(btrim(p_reason), ''), 'CORRECCION DE METODO DE PAGO') || ' ' || order_row.code,
      p_order_id, old_cash_payment.id
    );
  end loop;

  update public.cash_movements
  set payment_id = null
  where payment_id in (select id from public.pos_order_payments where order_id = p_order_id);

  delete from public.pos_order_payments
  where order_id = p_order_id;

  for payment_entry in select value from jsonb_array_elements(normalized_payments)
  loop
    if payment_entry ->> 'method' = 'cash' then
      insert into public.pos_order_payments (
        order_id, method, amount_cop, cash_received_cop, cash_change_cop, cash_session_id, created_by
      )
      values (
        p_order_id,
        'cash',
        (payment_entry ->> 'amount_cop')::numeric,
        (payment_entry ->> 'cash_received_cop')::numeric,
        (payment_entry ->> 'cash_change_cop')::numeric,
        open_session_id,
        auth.uid()
      )
      returning id into payment_id;

      insert into public.cash_movements (
        cash_session_id, movement_kind, direction, source_kind, amount_cop, created_by, reason, order_id, payment_id
      )
      values (
        open_session_id, 'sale_cash', 'in', 'pos_order', (payment_entry ->> 'amount_cop')::numeric, auth.uid(),
        coalesce(nullif(btrim(p_reason), ''), 'CORRECCION DE METODO DE PAGO') || ' ' || order_row.code,
        p_order_id, payment_id
      )
      returning id into movement_id;

      update public.pos_order_payments
      set cash_movement_id = movement_id
      where id = payment_id;
    else
      insert into public.pos_order_payments (order_id, method, amount_cop, created_by)
      values (p_order_id, payment_entry ->> 'method', (payment_entry ->> 'amount_cop')::numeric, auth.uid());
    end if;
  end loop;

  update public.pos_orders
  set payment_method = payment_method_value,
      updated_at = now()
  where id = p_order_id;

  insert into public.pos_order_payment_corrections (
    order_id, previous_payment_method, new_payment_method, previous_payments, new_payments, reason, changed_by
  )
  values (
    p_order_id, order_row.payment_method, payment_method_value, previous_payments, normalized_payments,
    nullif(btrim(p_reason), ''), auth.uid()
  );

  return jsonb_build_object(
    'id', p_order_id,
    'payment_method', payment_method_value,
    'payments', normalized_payments
  );
end;
$$;

grant execute on function public.correct_pos_order_payment_method(uuid, text, jsonb, text) to authenticated;
