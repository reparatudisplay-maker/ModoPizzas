-- One-time repair for the FIFO cost omission identified on 2026-11-15.
-- It aborts unless the reviewed scope is unchanged, records complete cost
-- snapshots in audit_logs, and never writes inventory, payment, or order data.

do $$
declare
  v_repair_run_id uuid := gen_random_uuid();
  v_actor_id uuid;
  v_consumption_count integer := 0;
  v_order_item_count integer := 0;
  v_cost_delta numeric(18, 6) := 0;
begin
  select profile.id
  into v_actor_id
  from public.profiles profile
  where profile.full_name = 'Admin'
    and exists (
      select 1
      from public.user_roles role_row
      where role_row.user_id = profile.id
        and role_row.role = 'admin_sistema'
    )
  order by profile.id
  limit 1;

  if v_actor_id is null then
    raise exception 'No se encontro el administrador autorizado para auditar la reparacion FIFO.';
  end if;

  create temporary table pg_temp.pending_fifo_cost_repair (
    consumption_id uuid primary key,
    order_item_id uuid not null,
    order_item_addition_id uuid,
    cost_before numeric(18, 6) not null,
    cost_after numeric(18, 6) not null
  ) on commit drop;

  insert into pg_temp.pending_fifo_cost_repair (
    consumption_id, order_item_id, order_item_addition_id, cost_before, cost_after
  )
  select
    consumption.id,
    consumption.order_item_id,
    consumption.order_item_addition_id,
    consumption.cost_cop,
    round(coalesce(sum(allocation.cost_cop), 0) + debt.quantity_base * debt.estimated_unit_cost_cop, 6)
  from public.pos_inventory_regularization_debts debt
  join public.pos_order_consumptions consumption on consumption.id = debt.consumption_id
  left join public.pos_order_consumption_allocations allocation on allocation.consumption_id = consumption.id
  where debt.status = 'pending'
  group by debt.id, debt.quantity_base, debt.estimated_unit_cost_cop, consumption.id
  having abs(consumption.cost_cop - round(coalesce(sum(allocation.cost_cop), 0) + debt.quantity_base * debt.estimated_unit_cost_cop, 6)) > 0.000001;

  select count(*), coalesce(sum(cost_after - cost_before), 0)
  into v_consumption_count, v_cost_delta
  from pg_temp.pending_fifo_cost_repair;

  if v_consumption_count <> 14 or abs(v_cost_delta - 20449.06) > 0.01 then
    raise exception 'La reparacion FIFO se detuvo: se esperaban 14 consumos y $20.449,06; se encontraron % y %.', v_consumption_count, v_cost_delta;
  end if;

  insert into public.audit_logs (actor_id, action, entity_table, entity_id, before_data, after_data)
  values (
    v_actor_id,
    'repair_pending_fifo_regularization_cost',
    'pos_inventory_regularization_cost_repair',
    v_repair_run_id,
    jsonb_build_object('consumption_count', v_consumption_count, 'cost_delta_cop', v_cost_delta),
    jsonb_build_object('consumption_count', v_consumption_count, 'cost_delta_cop', v_cost_delta, 'repair_run_id', v_repair_run_id)
  );

  insert into public.audit_logs (actor_id, action, entity_table, entity_id, before_data, after_data)
  select
    v_actor_id,
    'repair_pending_fifo_regularization_cost',
    'pos_order_consumptions',
    repair.consumption_id,
    jsonb_build_object('repair_run_id', v_repair_run_id, 'cost_cop', repair.cost_before),
    jsonb_build_object('repair_run_id', v_repair_run_id, 'cost_cop', repair.cost_after, 'delta_cop', repair.cost_after - repair.cost_before)
  from pg_temp.pending_fifo_cost_repair repair;

  update public.pos_order_consumptions consumption
  set cost_cop = repair.cost_after
  from pg_temp.pending_fifo_cost_repair repair
  where consumption.id = repair.consumption_id;

  with addition_costs as (
    select addition.id, addition.line_cost_cop as cost_before, round(sum(consumption.cost_cop), 2) as cost_after
    from public.pos_order_item_additions addition
    join public.pos_order_consumptions consumption on consumption.order_item_addition_id = addition.id
    where addition.id in (
      select order_item_addition_id
      from pg_temp.pending_fifo_cost_repair
      where order_item_addition_id is not null
    )
    group by addition.id
  )
  insert into public.audit_logs (actor_id, action, entity_table, entity_id, before_data, after_data)
  select v_actor_id, 'repair_pending_fifo_regularization_cost', 'pos_order_item_additions', id,
    jsonb_build_object('repair_run_id', v_repair_run_id, 'line_cost_cop', cost_before),
    jsonb_build_object('repair_run_id', v_repair_run_id, 'line_cost_cop', cost_after, 'delta_cop', cost_after - cost_before)
  from addition_costs;

  update public.pos_order_item_additions addition
  set line_cost_cop = costs.cost_after
  from (
    select addition_row.id, round(sum(consumption.cost_cop), 2) as cost_after
    from public.pos_order_item_additions addition_row
    join public.pos_order_consumptions consumption on consumption.order_item_addition_id = addition_row.id
    where addition_row.id in (
      select order_item_addition_id
      from pg_temp.pending_fifo_cost_repair
      where order_item_addition_id is not null
    )
    group by addition_row.id
  ) costs
  where addition.id = costs.id;

  with item_costs as (
    select item.id, item.line_cost_cop as cost_before, round(sum(consumption.cost_cop), 2) as cost_after
    from public.pos_order_items item
    join public.pos_order_consumptions consumption on consumption.order_item_id = item.id
    where item.id in (select order_item_id from pg_temp.pending_fifo_cost_repair)
    group by item.id
  )
  insert into public.audit_logs (actor_id, action, entity_table, entity_id, before_data, after_data)
  select v_actor_id, 'repair_pending_fifo_regularization_cost', 'pos_order_items', id,
    jsonb_build_object('repair_run_id', v_repair_run_id, 'line_cost_cop', cost_before),
    jsonb_build_object('repair_run_id', v_repair_run_id, 'line_cost_cop', cost_after, 'delta_cop', cost_after - cost_before)
  from item_costs;

  update public.pos_order_items item
  set line_cost_cop = costs.cost_after
  from (
    select item_row.id, round(sum(consumption.cost_cop), 2) as cost_after
    from public.pos_order_items item_row
    join public.pos_order_consumptions consumption on consumption.order_item_id = item_row.id
    where item_row.id in (select order_item_id from pg_temp.pending_fifo_cost_repair)
    group by item_row.id
  ) costs
  where item.id = costs.id;

  select count(distinct order_item_id)
  into v_order_item_count
  from pg_temp.pending_fifo_cost_repair;

  insert into public.audit_logs (actor_id, action, entity_table, entity_id, before_data, after_data)
  values (
    v_actor_id,
    'repair_pending_fifo_regularization_cost_completed',
    'pos_inventory_regularization_cost_repair',
    v_repair_run_id,
    null,
    jsonb_build_object('consumption_count', v_consumption_count, 'order_item_count', v_order_item_count, 'cost_delta_cop', round(v_cost_delta, 2), 'repair_run_id', v_repair_run_id)
  );
end;
$$;
