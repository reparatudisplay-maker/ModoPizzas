begin;

create table if not exists public.pos_order_replacements (
  id uuid primary key default gen_random_uuid(),
  original_order_id uuid not null unique references public.pos_orders(id) on delete restrict,
  replacement_order_id uuid not null unique references public.pos_orders(id) on delete restrict,
  reason text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.pos_order_replacements enable row level security;

drop policy if exists "Read POS order replacements" on public.pos_order_replacements;
create policy "Read POS order replacements"
  on public.pos_order_replacements for select to authenticated
  using (public.current_user_can_access_module('pedidos'));

create or replace function public.replace_pending_pos_order_with_packaging(
  p_original_order_id uuid,
  p_kind text, p_customer_name text, p_customer_phone text, p_discount_type text, p_discount_value numeric, p_discount_cop numeric, p_delivery_cop numeric,
  p_payment_method text, p_source_channel text, p_collection_party text, p_notes text, p_items jsonb,
  p_cash_received_cop numeric default null, p_cash_change_cop numeric default null, p_platform_service text default 'none',
  p_pickup_mode text default 'pickup', p_line_pricing jsonb default '[]'::jsonb, p_direct_sales jsonb default '[]'::jsonb,
  p_allow_pending_stock boolean default false, p_packaging_quantities jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public, app_private, pg_temp as $$
declare
  original_order public.pos_orders%rowtype;
  replacement jsonb;
  replacement_id uuid;
  archived_code text;
  original_direct record;
  replacement_direct_purchase_id uuid;
  replacement_direct_item_id uuid;
begin
  if not public.current_user_can_access_module('pedidos') then
    raise exception 'No tienes acceso operativo a pedidos.';
  end if;

  select * into original_order
  from public.pos_orders
  where id = p_original_order_id
  for update;

  if not found then
    raise exception 'No se encontró el pedido pendiente.';
  end if;
  if original_order.status not in ('new', 'confirmed')
    or original_order.payment_method <> 'pending'
    or original_order.source_channel <> 'direct'
    or original_order.collection_party <> 'business' then
    raise exception 'Solo se pueden editar pedidos directos pendientes de cobro que aún no fueron cancelados.';
  end if;
  if exists (select 1 from public.pos_order_replacements where original_order_id = original_order.id) then
    raise exception 'Este pedido pendiente ya fue reemplazado.';
  end if;
  if exists (select 1 from public.kitchen_order_items where order_id = original_order.id and status <> 'pending') then
    raise exception 'No se puede editar un pedido cuya preparación ya fue iniciada.';
  end if;
  if exists (select 1 from public.pos_order_combo_snapshots where order_id = original_order.id) then
    raise exception 'No se puede editar un combo pendiente desde este flujo.';
  end if;
  if exists (
    select 1
    from public.direct_sale_purchases
    where order_id = original_order.id
      and cash_movement_id is not null
  ) then
    raise exception 'No se puede editar una venta libre pendiente pagada desde caja; conserva un movimiento de caja independiente.';
  end if;
  if p_payment_method <> 'pending' or p_source_channel <> 'direct' or p_collection_party <> 'business' then
    raise exception 'La edición conserva el pedido como cobro pendiente directo.';
  end if;

  archived_code := original_order.code || '-ED-' || substring(replace(original_order.id::text, '-', '') from 1 for 8);

  update public.pos_orders
  set code = archived_code,
      status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = auth.uid(),
      cancel_reason = 'REEMPLAZADO POR EDICIÓN DE COBRO PENDIENTE',
      updated_at = now()
  where id = original_order.id;

  insert into public.pos_order_status_events(order_id, from_status, to_status, actor_id, notes)
  values (original_order.id, original_order.status, 'cancelled', auth.uid(), 'Reemplazado por edición de cobro pendiente');

  replacement := public.create_pos_order_with_packaging(
    p_kind, p_pickup_mode,
    p_customer_name, p_customer_phone, p_discount_type, p_discount_value, p_discount_cop, p_delivery_cop,
    p_payment_method, p_source_channel, p_collection_party, p_notes, p_items,
    p_cash_received_cop, p_cash_change_cop, p_platform_service,
    p_line_pricing, p_direct_sales, p_allow_pending_stock, p_packaging_quantities
  );
  replacement_id := (replacement ->> 'id')::uuid;

  -- Las compras directas externas no consumen inventario ni caja. Se conservan
  -- como el mismo registro histórico y se reasignan a su nueva línea.
  for original_direct in
    select purchase.id, item.cart_line_key
    from public.direct_sale_purchases purchase
    join public.pos_order_items item on item.id = purchase.order_item_id
    where purchase.order_id = original_order.id
  loop
    if original_direct.cart_line_key is null then
      raise exception 'La venta libre histórica no tiene referencia de línea para conservar su trazabilidad.';
    end if;

    select purchase.id, item.id
      into replacement_direct_purchase_id, replacement_direct_item_id
    from public.direct_sale_purchases purchase
    join public.pos_order_items item on item.id = purchase.order_item_id
    where purchase.order_id = replacement_id
      and item.cart_line_key = original_direct.cart_line_key
    for update;

    if replacement_direct_purchase_id is null or replacement_direct_item_id is null then
      raise exception 'No se pudo reconstruir la venta libre % en el pedido actualizado.', original_direct.id;
    end if;

    delete from public.direct_sale_purchases where id = replacement_direct_purchase_id;
    update public.direct_sale_purchases
    set order_id = replacement_id,
        order_item_id = replacement_direct_item_id
    where id = original_direct.id;
  end loop;

  update public.pos_orders
  set code = original_order.code,
      ordered_at = original_order.ordered_at,
      updated_at = now()
  where id = replacement_id;

  insert into public.pos_order_replacements(original_order_id, replacement_order_id, reason, created_by)
  values (original_order.id, replacement_id, 'EDICIÓN DESDE COBROS PENDIENTES', auth.uid());

  insert into public.pos_order_status_events(order_id, from_status, to_status, actor_id, notes)
  values (replacement_id, 'confirmed', 'confirmed', auth.uid(), 'Reemplaza el pedido pendiente ' || original_order.code);

  return replacement || jsonb_build_object('code', original_order.code, 'replaces_order_id', original_order.id);
end;
$$;

revoke all on function public.replace_pending_pos_order_with_packaging(uuid, text, text, text, text, numeric, numeric, numeric, text, text, text, text, jsonb, numeric, numeric, text, text, jsonb, jsonb, boolean, jsonb) from public;
grant execute on function public.replace_pending_pos_order_with_packaging(uuid, text, text, text, text, numeric, numeric, numeric, text, text, text, text, jsonb, numeric, numeric, text, text, jsonb, jsonb, boolean, jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
