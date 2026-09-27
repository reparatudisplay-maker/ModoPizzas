begin;

alter table public.purchases
  add column if not exists merchandise_subtotal_cop numeric(14, 2),
  add column if not exists transport_cost_cop numeric(14, 2) not null default 0;

alter table public.purchase_items
  add column if not exists brand_id uuid references public.brands(id),
  add column if not exists merchandise_total_cop numeric(14, 2),
  add column if not exists transport_allocated_cop numeric(14, 2) not null default 0,
  add column if not exists landed_total_cop numeric(14, 2);

create index if not exists purchase_items_brand_id_idx on public.purchase_items (brand_id);

create or replace function public.save_purchase_with_items(
  p_purchase_id uuid,
  p_supplier_id uuid,
  p_notes text,
  p_purchased_at timestamptz,
  p_transport_cost_cop numeric,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_purchase_id uuid;
  v_line jsonb;
  v_line_count integer;
  v_subtotal numeric(14, 2) := 0;
  v_transport numeric(14, 2) := 0;
  v_allocated numeric(14, 2) := 0;
  v_line_transport numeric(14, 2);
  v_line_total numeric(14, 2);
  v_index integer := 0;
  v_affected_items uuid[] := '{}';
  v_item_id uuid;
begin
  if auth.uid() is null or not app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]) then
    raise exception 'No tienes permisos para gestionar compras.' using errcode = '42501';
  end if;

  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Agrega al menos un producto a la compra.';
  end if;

  if coalesce(p_transport_cost_cop, 0) < 0 or coalesce(p_transport_cost_cop, 0) <> trunc(coalesce(p_transport_cost_cop, 0)) then
    raise exception 'El domicilio debe ser un valor entero mayor o igual a cero.';
  end if;
  v_transport := coalesce(p_transport_cost_cop, 0);
  v_line_count := jsonb_array_length(p_lines);

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    if nullif(v_line->>'inventory_item_id', '') is null
      or coalesce((v_line->>'quantity')::numeric, 0) <= 0
      or coalesce((v_line->>'purchased_quantity')::numeric, 0) <= 0
      or coalesce((v_line->>'merchandise_total_cop')::numeric, 0) <= 0
      or coalesce((v_line->>'merchandise_total_cop')::numeric, 0) <> trunc((v_line->>'merchandise_total_cop')::numeric) then
      raise exception 'Cada línea requiere producto, cantidad y valor de mercancía válidos.';
    end if;

    if not exists (
      select 1 from public.inventory_items item
      where item.id = (v_line->>'inventory_item_id')::uuid and item.is_active
    ) then
      raise exception 'Uno de los productos ya no está activo.';
    end if;
    v_subtotal := v_subtotal + (v_line->>'merchandise_total_cop')::numeric;
  end loop;

  if p_purchase_id is not null then
    perform 1 from public.purchases where id = p_purchase_id for update;
    if not found then raise exception 'La compra que deseas editar no existe.'; end if;

    if exists (
      select 1
      from public.purchase_items item
      left join public.pos_order_consumption_allocations pos_allocation on pos_allocation.purchase_item_id = item.id
      left join public.production_consumption_allocations production_allocation on production_allocation.purchase_item_id = item.id
      where item.purchase_id = p_purchase_id
        and (pos_allocation.id is not null or production_allocation.id is not null)
    ) then
      raise exception 'No se puede editar una compra con consumo operativo registrado.';
    end if;

    select coalesce(array_agg(distinct inventory_item_id), '{}') into v_affected_items
    from public.purchase_items where purchase_id = p_purchase_id;

    update public.purchases
    set supplier_id = p_supplier_id,
        notes = nullif(trim(p_notes), ''),
        purchased_at = coalesce(p_purchased_at, now()),
        merchandise_subtotal_cop = v_subtotal,
        transport_cost_cop = v_transport,
        total_cop = v_subtotal + v_transport
    where id = p_purchase_id;
    delete from public.purchase_items where purchase_id = p_purchase_id;
    v_purchase_id := p_purchase_id;
  else
    insert into public.purchases (
      supplier_id, purchased_by, total_cop, merchandise_subtotal_cop, transport_cost_cop, notes, purchased_at
    ) values (
      p_supplier_id, auth.uid(), v_subtotal + v_transport, v_subtotal, v_transport, nullif(trim(p_notes), ''), coalesce(p_purchased_at, now())
    ) returning id into v_purchase_id;
  end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_index := v_index + 1;
    v_item_id := (v_line->>'inventory_item_id')::uuid;
    if v_index = v_line_count then
      v_line_transport := v_transport - v_allocated;
    else
      v_line_transport := floor(v_transport * ((v_line->>'merchandise_total_cop')::numeric / v_subtotal));
      v_allocated := v_allocated + v_line_transport;
    end if;
    v_line_total := (v_line->>'merchandise_total_cop')::numeric + v_line_transport;

    insert into public.purchase_items (
      purchase_id, inventory_item_id, brand_id, purchased_quantity, quantity, unit,
      presentation_quantity, presentation_unit, unit_cost_cop, line_total_cop,
      merchandise_total_cop, transport_allocated_cop, landed_total_cop, expiration_date
    ) values (
      v_purchase_id, v_item_id, nullif(v_line->>'brand_id', '')::uuid,
      (v_line->>'purchased_quantity')::numeric, (v_line->>'quantity')::numeric, (v_line->>'unit')::public.stock_unit,
      nullif(v_line->>'presentation_quantity', '')::numeric, nullif(v_line->>'presentation_unit', '')::public.stock_unit,
      round(v_line_total / nullif((v_line->>'quantity')::numeric, 0), 2), v_line_total,
      (v_line->>'merchandise_total_cop')::numeric, v_line_transport, v_line_total,
      nullif(v_line->>'expiration_date', '')::date
    );
    v_affected_items := array_append(v_affected_items, v_item_id);
  end loop;

  update public.inventory_items item
  set current_quantity = coalesce(totals.quantity, 0),
      average_cost_cop = coalesce(totals.average_cost, 0)
  from (
    select affected.inventory_item_id,
      sum(purchase_item.quantity) as quantity,
      case when coalesce(sum(purchase_item.quantity), 0) > 0
        then round(sum(purchase_item.line_total_cop) / sum(purchase_item.quantity), 2)
        else 0 end as average_cost
    from (select distinct unnest(v_affected_items) as inventory_item_id) affected
    left join public.purchase_items purchase_item on purchase_item.inventory_item_id = affected.inventory_item_id
    group by affected.inventory_item_id
  ) totals
  where item.id = totals.inventory_item_id;

  return v_purchase_id;
end;
$$;

create or replace function public.delete_purchase_safely(p_purchase_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_item_ids uuid[];
begin
  if auth.uid() is null or not app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]) then
    raise exception 'No tienes permisos para eliminar compras.' using errcode = '42501';
  end if;
  perform 1 from public.purchases where id = p_purchase_id for update;
  if not found then raise exception 'La compra no existe.'; end if;
  if exists (
    select 1 from public.purchase_items item
    left join public.pos_order_consumption_allocations pos_allocation on pos_allocation.purchase_item_id = item.id
    left join public.production_consumption_allocations production_allocation on production_allocation.purchase_item_id = item.id
    where item.purchase_id = p_purchase_id
      and (pos_allocation.id is not null or production_allocation.id is not null)
  ) then
    raise exception 'No se puede eliminar una compra con consumo operativo registrado.';
  end if;
  select coalesce(array_agg(distinct inventory_item_id), '{}') into v_item_ids from public.purchase_items where purchase_id = p_purchase_id;
  delete from public.purchases where id = p_purchase_id;
  update public.inventory_items item
  set current_quantity = coalesce(totals.quantity, 0),
      average_cost_cop = coalesce(totals.average_cost, 0)
  from (
    select affected.inventory_item_id,
      sum(purchase_item.quantity) as quantity,
      case when coalesce(sum(purchase_item.quantity), 0) > 0
        then round(sum(purchase_item.line_total_cop) / sum(purchase_item.quantity), 2)
        else 0 end as average_cost
    from (select distinct unnest(v_item_ids) as inventory_item_id) affected
    left join public.purchase_items purchase_item on purchase_item.inventory_item_id = affected.inventory_item_id
    group by affected.inventory_item_id
  ) totals
  where item.id = totals.inventory_item_id;
end;
$$;

grant execute on function public.save_purchase_with_items(uuid, uuid, text, timestamptz, numeric, jsonb) to authenticated;
grant execute on function public.delete_purchase_safely(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
