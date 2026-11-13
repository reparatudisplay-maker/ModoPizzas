-- Permite regularizar faltantes POS por producto, o por una selección de
-- productos, sin mezclar faltantes de producción ni crear compras técnicas.
-- La asignación descuenta solo lotes reales y en orden FIFO.

create or replace function public.regularize_pending_pos_inventory_debts_fifo_selected(
  p_source_ids uuid[],
  p_allow_shortage boolean default false,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private, auth, pg_temp
as $$
declare
  v_run_id uuid;
  v_group record;
  v_debt record;
  v_lot record;
  v_available numeric;
  v_remaining numeric;
  v_allocated numeric;
  v_unit_cost numeric(18, 8);
  v_cost numeric(18, 6);
  v_total numeric(18, 6) := 0;
  v_regularized_count integer := 0;
  v_partial_count integer := 0;
  v_item_count integer := 0;
  v_debt_ids uuid[] := '{}';
  v_stock_before jsonb := '{}'::jsonb;
  v_stock_after jsonb := '{}'::jsonb;
  v_notes text := coalesce(nullif(btrim(p_notes), ''), 'REGULARIZACION TECNICA FIFO SELECTIVA DE FALTANTES POS. ASIGNACION A LOTES EXISTENTES SIN CREAR COMPRAS NUEVAS.');
begin
  if auth.uid() is null or not app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]) then
    raise exception 'No tienes permisos para regularizar faltantes de inventario.' using errcode = '42501';
  end if;

  if coalesce(cardinality(p_source_ids), 0) = 0 then
    raise exception 'Selecciona al menos un producto para regularizar.';
  end if;

  perform 1
  from public.pos_inventory_regularization_debts d
  where d.status = 'pending'
    and d.source_kind = 'inventory_item'
    and d.source_id = any(p_source_ids)
  for update;

  if not found then
    raise exception 'No hay faltantes de inventario pendientes para los productos seleccionados.';
  end if;

  -- Bajo bloqueo comprobamos la cobertura antes de insertar asignaciones.
  for v_group in
    select d.source_id, d.base_unit, max(i.name) as item_name, sum(d.quantity_base) as quantity_base
    from public.pos_inventory_regularization_debts d
    join public.inventory_items i on i.id = d.source_id
    where d.status = 'pending'
      and d.source_kind = 'inventory_item'
      and d.source_id = any(p_source_ids)
    group by d.source_id, d.base_unit
    order by min(d.created_at), d.source_id
  loop
    perform 1
    from public.purchase_items pi
    where pi.inventory_item_id = v_group.source_id
    for update;

    select coalesce(sum(lot.available_base), 0)
    into v_available
    from app_private.inventory_source_lots('inventory_item', v_group.source_id, v_group.base_unit) lot;

    v_stock_before := v_stock_before || jsonb_build_object(v_group.source_id::text, v_available);
    if v_available + 0.000001 < v_group.quantity_base and not p_allow_shortage then
      raise exception 'Para % se requieren % %, pero solo hay % %. Confirma que deseas regularizar lo disponible y conservar la deuda pendiente.',
        v_group.item_name, round(v_group.quantity_base, 3), upper(v_group.base_unit::text), round(v_available, 3), upper(v_group.base_unit::text);
    end if;
  end loop;

  for v_group in
    select d.source_id, d.base_unit
    from public.pos_inventory_regularization_debts d
    where d.status = 'pending'
      and d.source_kind = 'inventory_item'
      and d.source_id = any(p_source_ids)
    group by d.source_id, d.base_unit
    order by min(d.created_at), d.source_id
  loop
    for v_debt in
      select *
      from public.pos_inventory_regularization_debts d
      where d.status = 'pending'
        and d.source_kind = 'inventory_item'
        and d.source_id = v_group.source_id
        and d.base_unit = v_group.base_unit
      order by d.created_at, d.id
    loop
      v_remaining := v_debt.quantity_base;

      for v_lot in
        select lot.origin_id as purchase_item_id, lot.available_base, lot.occurred_at, lot.expiration_date,
          pi.line_total_cop / nullif(public.production_convert_quantity(pi.quantity, pi.unit, v_debt.base_unit, null), 0) as unit_cost_cop
        from app_private.inventory_source_lots('inventory_item', v_debt.source_id, v_debt.base_unit) lot
        join public.purchase_items pi on pi.id = lot.origin_id
        where lot.available_base > 0
        order by lot.occurred_at asc, lot.expiration_date asc nulls last, lot.origin_id
      loop
        exit when v_remaining <= 0.000001;
        v_allocated := least(v_remaining, v_lot.available_base);
        v_unit_cost := coalesce(v_lot.unit_cost_cop, 0);
        v_cost := round(v_allocated * v_unit_cost, 6);

        insert into public.pos_order_consumption_allocations (
          consumption_id, purchase_item_id, quantity_base, base_unit, cost_cop
        ) values (
          v_debt.consumption_id, v_lot.purchase_item_id, v_allocated, v_debt.base_unit, v_cost
        );

        insert into public.pos_inventory_regularization_allocations (
          debt_id, purchase_item_id, quantity_base, base_unit, unit_cost_cop, cost_cop
        ) values (
          v_debt.id, v_lot.purchase_item_id, v_allocated, v_debt.base_unit, v_unit_cost, v_cost
        );

        v_remaining := v_remaining - v_allocated;
        v_total := v_total + v_cost;
      end loop;

      v_debt_ids := array_append(v_debt_ids, v_debt.id);
      if v_remaining <= 0.000001 then
        update public.pos_inventory_regularization_debts
        set status = 'regularized', regularized_at = now(), regularized_by = auth.uid(), regularization_notes = v_notes
        where id = v_debt.id;
        v_regularized_count := v_regularized_count + 1;
      else
        update public.pos_inventory_regularization_debts
        set quantity_base = round(v_remaining, 6),
            regularization_notes = concat_ws(' ', regularization_notes, format('SALDO PENDIENTE FIFO: %s %s.', round(v_remaining, 3), upper(v_debt.base_unit::text)))
        where id = v_debt.id;
        v_partial_count := v_partial_count + 1;
      end if;

      insert into public.audit_logs (actor_id, action, entity_table, entity_id, before_data, after_data)
      values (
        auth.uid(), 'regularize_pending_pos_inventory_fifo_selected', 'pos_inventory_regularization_debts', v_debt.id,
        jsonb_build_object('quantity_base', v_debt.quantity_base, 'status', 'pending'),
        jsonb_build_object('quantity_regularized_base', v_debt.quantity_base - greatest(v_remaining, 0), 'quantity_pending_base', greatest(v_remaining, 0), 'status', case when v_remaining <= 0.000001 then 'regularized' else 'pending' end)
      );
    end loop;
    v_item_count := v_item_count + 1;
  end loop;

  update public.pos_order_consumptions consumption
  set cost_cop = costs.cost_cop
  from (
    select c.id, round(coalesce(sum(a.cost_cop), 0), 6) as cost_cop
    from public.pos_order_consumptions c
    left join public.pos_order_consumption_allocations a on a.consumption_id = c.id
    where c.id in (select consumption_id from public.pos_inventory_regularization_debts where id = any(v_debt_ids))
    group by c.id
  ) costs
  where consumption.id = costs.id;

  update public.pos_order_item_additions addition
  set line_cost_cop = costs.cost_cop
  from (
    select c.order_item_addition_id, round(sum(c.cost_cop), 2) as cost_cop
    from public.pos_order_consumptions c
    where c.order_item_addition_id is not null
      and c.order_item_id in (select order_item_id from public.pos_order_consumptions where id in (select consumption_id from public.pos_inventory_regularization_debts where id = any(v_debt_ids)))
    group by c.order_item_addition_id
  ) costs
  where addition.id = costs.order_item_addition_id;

  update public.pos_order_items item
  set line_cost_cop = costs.cost_cop
  from (
    select c.order_item_id, round(sum(c.cost_cop), 2) as cost_cop
    from public.pos_order_consumptions c
    where c.order_item_id in (select order_item_id from public.pos_order_consumptions where id in (select consumption_id from public.pos_inventory_regularization_debts where id = any(v_debt_ids)))
    group by c.order_item_id
  ) costs
  where item.id = costs.order_item_id;

  for v_group in
    select d.source_id, d.base_unit
    from public.pos_inventory_regularization_debts d
    where d.id = any(v_debt_ids)
    group by d.source_id, d.base_unit
  loop
    select coalesce(sum(lot.available_base), 0)
    into v_available
    from app_private.inventory_source_lots('inventory_item', v_group.source_id, v_group.base_unit) lot;
    v_stock_after := v_stock_after || jsonb_build_object(v_group.source_id::text, v_available);
  end loop;

  insert into public.pos_inventory_regularization_runs (
    purchase_id, debt_count, item_count, stock_before, stock_after, notes, executed_by
  ) values (
    null, cardinality(v_debt_ids), v_item_count, v_stock_before, v_stock_after, v_notes, auth.uid()
  ) returning id into v_run_id;

  insert into public.audit_logs (actor_id, action, entity_table, entity_id, before_data, after_data)
  values (
    auth.uid(), 'regularize_pending_pos_inventory_fifo_selected', 'pos_inventory_regularization_runs', v_run_id,
    jsonb_build_object('stock', v_stock_before, 'pending_debts', cardinality(v_debt_ids), 'source_ids', p_source_ids),
    jsonb_build_object('stock', v_stock_after, 'regularized_debts', v_regularized_count, 'partial_debts', v_partial_count, 'total_cop', v_total)
  );

  return jsonb_build_object(
    'run_id', v_run_id,
    'regularized_count', v_regularized_count,
    'partial_count', v_partial_count,
    'item_count', v_item_count,
    'total_cop', v_total,
    'stock_before', v_stock_before,
    'stock_after', v_stock_after
  );
end;
$$;

revoke all on function public.regularize_pending_pos_inventory_debts_fifo_selected(uuid[], boolean, text) from public;
grant execute on function public.regularize_pending_pos_inventory_debts_fifo_selected(uuid[], boolean, text) to authenticated;

notify pgrst, 'reload schema';
