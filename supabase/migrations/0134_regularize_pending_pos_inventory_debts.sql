-- Convierte los faltantes POS autorizados en una única factura técnica y los
-- asigna a los consumos originales sin cambiar las existencias físicas.

create table if not exists public.pos_inventory_regularization_runs (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null unique references public.purchases(id) on delete restrict,
  debt_count integer not null check (debt_count > 0),
  item_count integer not null check (item_count > 0),
  stock_before jsonb not null,
  stock_after jsonb not null,
  notes text not null,
  executed_by uuid references auth.users(id) on delete set null,
  executed_at timestamptz not null default now()
);

create table if not exists public.pos_inventory_regularization_allocations (
  id uuid primary key default gen_random_uuid(),
  debt_id uuid not null unique references public.pos_inventory_regularization_debts(id) on delete restrict,
  purchase_item_id uuid not null references public.purchase_items(id) on delete restrict,
  quantity_base numeric(14, 6) not null check (quantity_base > 0),
  base_unit public.stock_unit not null,
  unit_cost_cop numeric(18, 8) not null check (unit_cost_cop >= 0),
  cost_cop numeric(18, 6) not null check (cost_cop >= 0),
  created_at timestamptz not null default now()
);

create index if not exists pos_inventory_regularization_allocations_purchase_item_idx
  on public.pos_inventory_regularization_allocations (purchase_item_id);

alter table public.pos_inventory_regularization_runs enable row level security;
alter table public.pos_inventory_regularization_allocations enable row level security;

drop policy if exists "Purchase staff read POS regularization runs" on public.pos_inventory_regularization_runs;
create policy "Purchase staff read POS regularization runs"
  on public.pos_inventory_regularization_runs for select to authenticated
  using (public.current_user_can_access_module('compras') or public.current_user_can_access_module('inventario'));

drop policy if exists "Purchase staff read POS regularization allocations" on public.pos_inventory_regularization_allocations;
create policy "Purchase staff read POS regularization allocations"
  on public.pos_inventory_regularization_allocations for select to authenticated
  using (public.current_user_can_access_module('compras') or public.current_user_can_access_module('inventario'));

create or replace function public.prevent_pos_inventory_regularization_audit_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'La auditoría de regularización POS es inmutable.';
end;
$$;

drop trigger if exists prevent_pos_inventory_regularization_runs_mutation on public.pos_inventory_regularization_runs;
create trigger prevent_pos_inventory_regularization_runs_mutation
before update or delete on public.pos_inventory_regularization_runs
for each row execute function public.prevent_pos_inventory_regularization_audit_mutation();

drop trigger if exists prevent_pos_inventory_regularization_allocations_mutation on public.pos_inventory_regularization_allocations;
create trigger prevent_pos_inventory_regularization_allocations_mutation
before update or delete on public.pos_inventory_regularization_allocations
for each row execute function public.prevent_pos_inventory_regularization_audit_mutation();

create or replace function public.regularize_pending_pos_inventory_debts(p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private, auth, pg_temp
as $$
declare
  v_purchase_id uuid;
  v_purchase_item_id uuid;
  v_run_id uuid;
  v_group record;
  v_debt record;
  v_latest_cost numeric(18, 8);
  v_line_total numeric(14, 2);
  v_total numeric(14, 2) := 0;
  v_debt_count integer := 0;
  v_item_count integer := 0;
  v_notes text := coalesce(nullif(btrim(p_notes), ''), 'REGULARIZACION TECNICA DE FALTANTES POS. COSTOS TOMADOS DEL ULTIMO PRECIO REGISTRADO. SIN CAMBIO DE STOCK FISICO.');
  v_stock_before jsonb := '{}'::jsonb;
  v_stock_after jsonb := '{}'::jsonb;
  v_before_quantity numeric;
  v_after_quantity numeric;
  v_consumption_cost numeric(18, 6);
  v_debt_ids uuid[] := '{}';
begin
  if auth.uid() is null or not app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]) then
    raise exception 'No tienes permisos para regularizar faltantes de inventario.' using errcode = '42501';
  end if;

  -- Locks make this idempotent under two concurrent clicks.
  perform 1
  from public.pos_inventory_regularization_debts
  where status = 'pending'
  for update;

  if not found then
    raise exception 'No hay faltantes pendientes de regularización.';
  end if;

  if exists (
    select 1 from public.pos_inventory_regularization_debts
    where status = 'pending' and source_kind <> 'inventory_item'
  ) then
    raise exception 'Hay faltantes de producción. Deben regularizarse mediante su producción, no por factura de compra.';
  end if;

  if exists (
    select 1
    from public.pos_inventory_regularization_debts d
    where d.status = 'pending'
      and abs(d.quantity_base - round(d.quantity_base, 3)) > 0.000001
  ) then
    raise exception 'Uno de los faltantes supera la precisión permitida por los lotes de compra.';
  end if;

  for v_group in
    select source_id, base_unit, sum(quantity_base) as quantity_base
    from public.pos_inventory_regularization_debts
    where status = 'pending'
    group by source_id, base_unit
    order by source_id
  loop
    select coalesce(sum(available_base), 0)
    into v_before_quantity
    from app_private.inventory_source_lots('inventory_item', v_group.source_id, v_group.base_unit);
    v_stock_before := v_stock_before || jsonb_build_object(v_group.source_id::text, v_before_quantity);
  end loop;

  insert into public.purchases (
    purchased_by, total_cop, merchandise_subtotal_cop, transport_cost_cop, notes, purchased_at
  ) values (
    auth.uid(), 0, 0, 0, v_notes, now()
  ) returning id into v_purchase_id;

  for v_group in
    select source_id, base_unit, sum(quantity_base) as quantity_base
    from public.pos_inventory_regularization_debts
    where status = 'pending'
    group by source_id, base_unit
    order by source_id
  loop
    select pi.line_total_cop / nullif(public.production_convert_quantity(pi.quantity, pi.unit, v_group.base_unit, null), 0)
    into v_latest_cost
    from public.purchase_items pi
    join public.purchases p on p.id = pi.purchase_id
    where pi.inventory_item_id = v_group.source_id
      and pi.quantity > 0
      and pi.line_total_cop >= 0
    order by p.purchased_at desc, pi.id desc
    limit 1;

    if v_latest_cost is null then
      raise exception 'No existe un último costo válido para el artículo %.', v_group.source_id;
    end if;

    v_line_total := round(v_group.quantity_base * v_latest_cost, 2);
    insert into public.purchase_items (
      purchase_id, inventory_item_id, purchased_quantity, quantity, unit,
      unit_cost_cop, line_total_cop, merchandise_total_cop, transport_allocated_cop, landed_total_cop
    ) values (
      v_purchase_id, v_group.source_id, round(v_group.quantity_base, 3), round(v_group.quantity_base, 3), v_group.base_unit,
      round(v_latest_cost, 6), v_line_total, v_line_total, 0, v_line_total
    ) returning id into v_purchase_item_id;

    for v_debt in
      select *
      from public.pos_inventory_regularization_debts
      where status = 'pending'
        and source_id = v_group.source_id
        and base_unit = v_group.base_unit
      order by created_at, id
    loop
      v_consumption_cost := round(v_debt.quantity_base * v_latest_cost, 6);
      insert into public.pos_order_consumption_allocations (
        consumption_id, purchase_item_id, quantity_base, base_unit, cost_cop
      ) values (
        v_debt.consumption_id, v_purchase_item_id, round(v_debt.quantity_base, 3), v_debt.base_unit, v_consumption_cost
      );

      insert into public.pos_inventory_regularization_allocations (
        debt_id, purchase_item_id, quantity_base, base_unit, unit_cost_cop, cost_cop
      ) values (
        v_debt.id, v_purchase_item_id, v_debt.quantity_base, v_debt.base_unit, v_latest_cost, v_consumption_cost
      );

      update public.pos_inventory_regularization_debts
      set status = 'regularized', regularized_at = now(), regularized_by = auth.uid(), regularization_notes = v_notes
      where id = v_debt.id;

      v_debt_ids := array_append(v_debt_ids, v_debt.id);
      v_debt_count := v_debt_count + 1;
    end loop;

    v_total := v_total + v_line_total;
    v_item_count := v_item_count + 1;
  end loop;

  update public.purchases
  set total_cop = v_total, merchandise_subtotal_cop = v_total
  where id = v_purchase_id;

  update public.pos_order_consumptions consumption
  set cost_cop = costs.cost_cop
  from (
    select c.id, round(coalesce(sum(a.cost_cop), 0), 6) as cost_cop
    from public.pos_order_consumptions c
    left join public.pos_order_consumption_allocations a on a.consumption_id = c.id
    where c.id in (
      select consumption_id from public.pos_inventory_regularization_debts where id = any(v_debt_ids)
    )
    group by c.id
  ) costs
  where consumption.id = costs.id;

  update public.pos_order_item_additions addition
  set line_cost_cop = costs.cost_cop
  from (
    select distinct c.order_item_addition_id, round(sum(c.cost_cop), 2) as cost_cop
    from public.pos_order_consumptions c
    where c.order_item_addition_id is not null
      and c.order_item_id in (
        select order_item_id from public.pos_order_consumptions
        where id in (select consumption_id from public.pos_inventory_regularization_debts where id = any(v_debt_ids))
      )
    group by c.order_item_addition_id
  ) costs
  where addition.id = costs.order_item_addition_id;

  update public.pos_order_items item
  set line_cost_cop = costs.cost_cop
  from (
    select c.order_item_id, round(sum(c.cost_cop), 2) as cost_cop
    from public.pos_order_consumptions c
    where c.order_item_id in (
      select c2.order_item_id
      from public.pos_order_consumptions c2
      join public.pos_inventory_regularization_debts d on d.consumption_id = c2.id
      where d.id = any(v_debt_ids)
    )
    group by c.order_item_id
  ) costs
  where item.id = costs.order_item_id;

  for v_group in
    select debt.source_id, debt.base_unit
    from public.pos_inventory_regularization_allocations allocation
    join public.pos_inventory_regularization_debts debt on debt.id = allocation.debt_id
    where debt.id = any(v_debt_ids)
    group by debt.source_id, debt.base_unit
  loop
    select coalesce(sum(available_base), 0)
    into v_after_quantity
    from app_private.inventory_source_lots('inventory_item', v_group.source_id, v_group.base_unit);
    v_stock_after := v_stock_after || jsonb_build_object(v_group.source_id::text, v_after_quantity);
    if coalesce(v_stock_before ->> v_group.source_id::text, '0')::numeric <> v_after_quantity then
      raise exception 'La regularización cambiaría el stock físico del artículo %.', v_group.source_id;
    end if;
  end loop;

  insert into public.pos_inventory_regularization_runs (
    purchase_id, debt_count, item_count, stock_before, stock_after, notes, executed_by
  ) values (
    v_purchase_id, v_debt_count, v_item_count, v_stock_before, v_stock_after, v_notes, auth.uid()
  ) returning id into v_run_id;

  insert into public.audit_logs (actor_id, action, entity_table, entity_id, before_data, after_data)
  values (
    auth.uid(), 'regularize_pending_pos_inventory', 'pos_inventory_regularization_runs', v_run_id,
    jsonb_build_object('stock', v_stock_before, 'pending_debts', v_debt_count),
    jsonb_build_object('stock', v_stock_after, 'purchase_id', v_purchase_id, 'total_cop', v_total, 'items', v_item_count)
  );

  return jsonb_build_object(
    'purchase_id', v_purchase_id,
    'run_id', v_run_id,
    'debt_count', v_debt_count,
    'item_count', v_item_count,
    'total_cop', v_total,
    'stock_before', v_stock_before,
    'stock_after', v_stock_after
  );
end;
$$;

revoke all on function public.regularize_pending_pos_inventory_debts(text) from public;
grant execute on function public.regularize_pending_pos_inventory_debts(text) to authenticated;

notify pgrst, 'reload schema';
