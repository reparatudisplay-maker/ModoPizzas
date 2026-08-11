alter table public.pos_orders
  add column if not exists cash_received_cop numeric(14, 2),
  add column if not exists cash_change_cop numeric(14, 2),
  add column if not exists paid_at timestamptz,
  add column if not exists paid_by uuid references auth.users(id) on delete set null;

alter table public.pos_orders
  drop constraint if exists pos_orders_cash_payment_amounts_check;

alter table public.pos_orders
  add constraint pos_orders_cash_payment_amounts_check check (
    (
      payment_method = 'cash'
      and (
        (cash_received_cop is null and cash_change_cop is null)
        or
        (
          cash_received_cop is not null
          and cash_change_cop is not null
          and cash_received_cop >= total_cop
          and cash_change_cop = cash_received_cop - total_cop
        )
      )
    )
    or
    (
      payment_method <> 'cash'
      and cash_received_cop is null
      and cash_change_cop is null
    )
  );

create index if not exists pos_orders_paid_at_idx on public.pos_orders (paid_at desc);
create index if not exists pos_orders_paid_by_idx on public.pos_orders (paid_by);

create or replace function public.record_pos_cash_payment(
  p_order_id uuid,
  p_cash_received_cop numeric,
  p_cash_change_cop numeric
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  order_row record;
begin
  if not app_private.has_any_role(array['vendedor'::public.app_role, 'mesero'::public.app_role, 'gerente'::public.app_role, 'admin_sistema'::public.app_role]) then
    raise exception 'No tienes permisos para registrar cobros.';
  end if;

  select id, code, total_cop, payment_method, status
    into order_row
  from public.pos_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Pedido no encontrado.';
  end if;

  if order_row.payment_method <> 'cash' then
    raise exception 'Este pedido no fue marcado como efectivo.';
  end if;

  if order_row.status = 'cancelled' then
    raise exception 'No se puede cobrar un pedido cancelado.';
  end if;

  if p_cash_received_cop is null or p_cash_received_cop < order_row.total_cop then
    raise exception 'El monto recibido no cubre el total del pedido.';
  end if;

  if p_cash_change_cop is null or p_cash_change_cop <> p_cash_received_cop - order_row.total_cop then
    raise exception 'El cambio no coincide con el monto recibido.';
  end if;

  update public.pos_orders
  set cash_received_cop = p_cash_received_cop,
      cash_change_cop = p_cash_change_cop,
      paid_at = now(),
      paid_by = auth.uid(),
      updated_at = now()
  where id = p_order_id;

  return jsonb_build_object(
    'id', order_row.id,
    'code', order_row.code,
    'total_cop', order_row.total_cop,
    'cash_received_cop', p_cash_received_cop,
    'cash_change_cop', p_cash_change_cop
  );
end;
$$;

grant execute on function public.record_pos_cash_payment(uuid, numeric, numeric) to authenticated;

notify pgrst, 'reload schema';
