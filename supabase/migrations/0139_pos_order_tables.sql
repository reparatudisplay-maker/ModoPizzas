create table if not exists public.order_tables (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name)
);

insert into public.order_tables (name, sort_order)
values
  ('Mesa 1', 1),
  ('Mesa 2', 2),
  ('Mesa 3', 3),
  ('Mesa 4', 4)
on conflict (name) do nothing;

alter table public.order_tables enable row level security;

drop policy if exists "Staff can read order tables" on public.order_tables;
create policy "Staff can read order tables" on public.order_tables
  for select using (public.current_user_can_access_module('pedidos'));

drop policy if exists "Managers can manage order tables" on public.order_tables;
create policy "Managers can manage order tables" on public.order_tables
  for all using (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]))
  with check (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]));

grant select on public.order_tables to authenticated;

alter table public.pos_orders
  add column if not exists table_id uuid references public.order_tables(id) on delete set null,
  add column if not exists table_name_snapshot text;

create index if not exists pos_orders_table_id_idx on public.pos_orders (table_id);

create or replace function public.assign_pos_order_table(
  p_order_id uuid,
  p_table_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  order_row public.pos_orders%rowtype;
  table_row public.order_tables%rowtype;
begin
  if auth.uid() is null or not public.current_user_has_permission('pedidos.create') then
    raise exception 'No tienes permisos para asignar mesa.';
  end if;

  select * into order_row from public.pos_orders where id = p_order_id for update;
  if not found then
    raise exception 'Pedido no encontrado.';
  end if;

  if order_row.kind <> 'local' and p_table_id is not null then
    raise exception 'Solo los pedidos de consumo local pueden tener mesa.';
  end if;

  if p_table_id is null then
    update public.pos_orders set table_id = null, table_name_snapshot = null, updated_at = now() where id = p_order_id;
    return jsonb_build_object('id', p_order_id, 'table_name', null);
  end if;

  select * into table_row from public.order_tables where id = p_table_id and is_active for share;
  if not found then
    raise exception 'Mesa no disponible.';
  end if;

  update public.pos_orders
  set table_id = table_row.id, table_name_snapshot = table_row.name, updated_at = now()
  where id = p_order_id;

  return jsonb_build_object('id', p_order_id, 'table_name', table_row.name);
end;
$$;

grant execute on function public.assign_pos_order_table(uuid, uuid) to authenticated;
