-- A FIFO regularization replaces only the portion of a pending consumption that
-- receives a real lot. The uncovered balance remains valued at its original
-- estimated cost until a later regularization can assign it to a lot.

create or replace function public.sync_pos_regularization_consumption_cost()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_debt record;
  v_allocated_cost numeric(18, 6);
begin
  select
    debt.status,
    debt.quantity_base,
    debt.estimated_unit_cost_cop
  into v_debt
  from public.pos_inventory_regularization_debts debt
  where debt.consumption_id = new.id;

  if not found then
    return new;
  end if;

  select coalesce(sum(allocation.cost_cop), 0)
  into v_allocated_cost
  from public.pos_order_consumption_allocations allocation
  where allocation.consumption_id = new.id;

  new.cost_cop := round(
    v_allocated_cost + case
      when v_debt.status = 'pending' then v_debt.quantity_base * v_debt.estimated_unit_cost_cop
      else 0
    end,
    6
  );

  return new;
end;
$$;

drop trigger if exists sync_pos_regularization_consumption_cost on public.pos_order_consumptions;
create trigger sync_pos_regularization_consumption_cost
before update of cost_cop on public.pos_order_consumptions
for each row
execute function public.sync_pos_regularization_consumption_cost();

-- This is intentionally opt-in. Applying this migration only protects future
-- regularizations; a manager must explicitly invoke the repair after reviewing
-- its audit-backed preview.
create or replace function public.repair_pending_fifo_regularization_costs()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_repair_run_id uuid := gen_random_uuid();
  v_consumption_count integer := 0;
  v_order_item_count integer := 0;
  v_cost_delta numeric(18, 6) := 0;
begin
  if auth.uid() is null or not app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]) then
    raise exception 'No tienes permisos para reparar costos de regularizacion FIFO.' using errcode = '42501';
  end if;

  create temporary table if not exists pg_temp.pending_fifo_cost_repair (
    consumption_id uuid primary key,
    order_item_id uuid not null,
    order_item_addition_id uuid,
    cost_before numeric(18, 6) not null,
    cost_after numeric(18, 6) not null
  ) on commit drop;
  truncate pg_temp.pending_fifo_cost_repair;

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

  if v_consumption_count = 0 then
    return jsonb_build_object('repair_run_id', v_repair_run_id, 'consumption_count', 0, 'order_item_count', 0, 'cost_delta_cop', 0);
  end if;

  insert into public.audit_logs (actor_id, action, entity_table, entity_id, before_data, after_data)
  select
    auth.uid(),
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
  select auth.uid(), 'repair_pending_fifo_regularization_cost', 'pos_order_item_additions', id,
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
  select auth.uid(), 'repair_pending_fifo_regularization_cost', 'pos_order_items', id,
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

  return jsonb_build_object(
    'repair_run_id', v_repair_run_id,
    'consumption_count', v_consumption_count,
    'order_item_count', v_order_item_count,
    'cost_delta_cop', round(v_cost_delta, 2)
  );
end;
$$;

revoke all on function public.repair_pending_fifo_regularization_costs() from public;
grant execute on function public.repair_pending_fifo_regularization_costs() to authenticated;
