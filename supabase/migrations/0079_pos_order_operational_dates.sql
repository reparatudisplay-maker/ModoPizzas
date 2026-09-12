-- created_at remains immutable technical audit time. ordered_at is the operational sale time.

alter table public.pos_orders add column if not exists ordered_at timestamptz;

update public.pos_orders
set ordered_at = created_at
where ordered_at is null;

alter table public.pos_orders
  alter column ordered_at set default now(),
  alter column ordered_at set not null;

create index if not exists pos_orders_ordered_at_idx on public.pos_orders (ordered_at desc);

create table if not exists public.pos_order_operational_date_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.pos_orders(id) on delete restrict,
  previous_ordered_at timestamptz not null,
  ordered_at timestamptz not null,
  changed_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists pos_order_operational_date_events_order_idx
  on public.pos_order_operational_date_events (order_id, created_at desc);

alter table public.pos_order_operational_date_events enable row level security;

create or replace function public.update_pos_order_operational_date(
  p_order_id uuid,
  p_ordered_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  previous_value timestamptz;
begin
  if auth.uid() is null or not app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]) then
    raise exception 'Solo Gerente o Administrador del sistema puede editar la fecha operativa.';
  end if;
  if p_order_id is null or p_ordered_at is null then
    raise exception 'La fecha operativa es obligatoria.';
  end if;
  if p_ordered_at > now() + interval '5 minutes' then
    raise exception 'La fecha operativa no puede estar en el futuro.';
  end if;

  select ordered_at into previous_value
  from public.pos_orders
  where id = p_order_id
  for update;
  if not found then
    raise exception 'Pedido no encontrado.';
  end if;
  if previous_value is not distinct from p_ordered_at then
    return;
  end if;

  update public.pos_orders
  set ordered_at = p_ordered_at,
      updated_at = now()
  where id = p_order_id;

  insert into public.pos_order_operational_date_events (order_id, previous_ordered_at, ordered_at, changed_by)
  values (p_order_id, previous_value, p_ordered_at, auth.uid());
end;
$$;

revoke all on function public.update_pos_order_operational_date(uuid, timestamptz) from public;
grant execute on function public.update_pos_order_operational_date(uuid, timestamptz) to authenticated;

notify pgrst, 'reload schema';

-- Reporting buckets and summary KPIs use operational sale time while retaining created_at.
do $$
declare
  function_definition text;
begin
  select pg_get_functiondef('public.get_sales_profitability_report_legacy(timestamptz,timestamptz,text)'::regprocedure)
    into function_definition;
  function_definition := replace(function_definition, 'o.created_at', 'o.ordered_at');
  execute function_definition;

  select pg_get_functiondef('public.get_sales_profitability_report(timestamptz,timestamptz,text)'::regprocedure)
    into function_definition;
  function_definition := replace(function_definition, 'o.created_at', 'o.ordered_at');
  execute function_definition;
end;
$$;

notify pgrst, 'reload schema';