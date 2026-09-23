-- Correct 0089 against deployments without a payment-correction table.
-- The audit remains complete for payments and cash movements that actually exist.

create or replace function public.delete_pos_order_for_testing(
  p_order_id uuid,
  p_reintegrated_allocation_ids uuid[] default '{}'::uuid[],
  p_reason_code text default null,
  p_reason_detail text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  order_row public.pos_orders%rowtype;
  audit_id uuid;
  allocation_row record;
  source_stock_after_delete numeric;
  physical_quantity numeric;
  physical_count_id uuid;
  total_allocations integer := 0;
  reintegrated_allocations integer := 0;
  retained_allocations integer := 0;
  normalized_reason_code text := nullif(lower(btrim(coalesce(p_reason_code, ''))), '');
  normalized_reason_detail text := nullif(btrim(coalesce(p_reason_detail, '')), '');
  invalid_id uuid;
  retained_ids uuid[];
  order_snapshot jsonb;
  payment_snapshot jsonb;
  cash_movement_snapshot jsonb;
  operational_date_snapshot jsonb;
begin
  if auth.uid() is null or not app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]) then
    raise exception 'Solo Gerente o Administrador del sistema puede eliminar pedidos de prueba.';
  end if;

  if not coalesce((select test_order_deletion_enabled from public.site_settings where id = true), false) then
    raise exception 'La eliminación de pedidos para pruebas está deshabilitada.';
  end if;

  select * into order_row
  from public.pos_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Pedido no encontrado o ya eliminado.';
  end if;

  if order_row.status = 'cancelled' then
    raise exception 'No se puede eliminar un pedido cancelado: sus consumos ya fueron revertidos por la cancelación.';
  end if;

  if exists (select 1 from public.pos_order_test_deletion_audits where deleted_order_id = p_order_id) then
    raise exception 'Este pedido ya fue eliminado en modo pruebas.';
  end if;

  if exists (
    select 1
    from public.cash_movements movement
    join public.cash_sessions session on session.id = movement.cash_session_id
    where movement.order_id = p_order_id
      and session.status <> 'open'
  ) then
    raise exception 'No se puede eliminar un pedido con movimientos asociados a una caja cerrada.';
  end if;

  if exists (
    select 1
    from public.pos_order_payments payment
    join public.cash_sessions session on session.id = payment.cash_session_id
    where payment.order_id = p_order_id
      and session.status <> 'open'
  ) then
    raise exception 'No se puede eliminar un pedido con pagos asociados a una caja cerrada.';
  end if;

  select count(*) into total_allocations
  from public.pos_order_consumption_allocations allocation
  join public.pos_order_consumptions consumption on consumption.id = allocation.consumption_id
  where consumption.order_id = p_order_id;

  select allocation_id into invalid_id
  from unnest(coalesce(p_reintegrated_allocation_ids, '{}'::uuid[])) allocation_id
  where not exists (
    select 1
    from public.pos_order_consumption_allocations allocation
    join public.pos_order_consumptions consumption on consumption.id = allocation.consumption_id
    where allocation.id = allocation_id
      and consumption.order_id = p_order_id
  )
  limit 1;

  if invalid_id is not null then
    raise exception 'El consumo seleccionado no pertenece al pedido.';
  end if;

  select array_agg(distinct allocation_id) into retained_ids
  from unnest(coalesce(p_reintegrated_allocation_ids, '{}'::uuid[])) allocation_id;
  reintegrated_allocations := coalesce(cardinality(retained_ids), 0);
  retained_allocations := total_allocations - reintegrated_allocations;

  if retained_allocations > 0 then
    if normalized_reason_code not in ('loss_total', 'prepared_product', 'damaged_product', 'system_test', 'other') then
      raise exception 'Selecciona el motivo de los consumos que permanecerán como salida.';
    end if;
    if normalized_reason_code = 'other' and normalized_reason_detail is null then
      raise exception 'Describe el otro motivo de la salida de inventario.';
    end if;
  else
    normalized_reason_code := null;
    normalized_reason_detail := null;
  end if;

  select to_jsonb(order_row) into order_snapshot;
  select coalesce(jsonb_agg(to_jsonb(payment) order by payment.created_at), '[]'::jsonb)
  into payment_snapshot
  from public.pos_order_payments payment
  where payment.order_id = p_order_id;
  select coalesce(jsonb_agg(to_jsonb(movement) order by movement.created_at), '[]'::jsonb)
  into cash_movement_snapshot
  from public.cash_movements movement
  where movement.order_id = p_order_id;
  select coalesce(jsonb_agg(to_jsonb(event) order by event.created_at), '[]'::jsonb)
  into operational_date_snapshot
  from public.pos_order_operational_date_events event
  where event.order_id = p_order_id;

  insert into public.pos_order_test_deletion_audits (
    deleted_order_id, order_code, order_total_cop, order_snapshot, payment_snapshot, cash_movement_snapshot,
    operational_date_snapshot, reason_code, reason_detail, reintegrated_allocation_count,
    retained_allocation_count, deleted_by
  )
  values (
    order_row.id, order_row.code, order_row.total_cop, order_snapshot, payment_snapshot, cash_movement_snapshot,
    operational_date_snapshot, normalized_reason_code, normalized_reason_detail, reintegrated_allocations,
    retained_allocations, auth.uid()
  )
  returning id into audit_id;

  for allocation_row in
    select
      allocation.id as allocation_id,
      allocation.purchase_item_id,
      allocation.production_batch_id,
      allocation.quantity_base,
      allocation.base_unit,
      allocation.cost_cop as allocation_cost_cop,
      consumption.id as consumption_id,
      consumption.order_item_id,
      consumption.order_item_addition_id,
      consumption.source_kind,
      consumption.inventory_item_id,
      consumption.source_preparation_id,
      consumption.quantity_base as consumption_quantity_base,
      consumption.base_unit as consumption_base_unit,
      consumption.cost_cop as consumption_cost_cop,
      item.product_name_snapshot,
      addition.name_snapshot as addition_name_snapshot
    from public.pos_order_consumption_allocations allocation
    join public.pos_order_consumptions consumption on consumption.id = allocation.consumption_id
    left join public.pos_order_items item on item.id = consumption.order_item_id
    left join public.pos_order_item_additions addition on addition.id = consumption.order_item_addition_id
    where consumption.order_id = p_order_id
    order by allocation.created_at, allocation.id
  loop
    if allocation_row.allocation_id = any(coalesce(retained_ids, '{}'::uuid[])) then
      insert into public.pos_order_test_deletion_consumptions (
        audit_id, original_allocation_id, consumption_snapshot, was_reintegrated
      ) values (
        audit_id,
        allocation_row.allocation_id,
        jsonb_build_object(
          'allocation_id', allocation_row.allocation_id,
          'consumption_id', allocation_row.consumption_id,
          'order_item_id', allocation_row.order_item_id,
          'order_item_addition_id', allocation_row.order_item_addition_id,
          'product_name_snapshot', coalesce(allocation_row.addition_name_snapshot, allocation_row.product_name_snapshot),
          'source_kind', allocation_row.source_kind,
          'inventory_item_id', allocation_row.inventory_item_id,
          'source_preparation_id', allocation_row.source_preparation_id,
          'purchase_item_id', allocation_row.purchase_item_id,
          'production_batch_id', allocation_row.production_batch_id,
          'quantity_base', allocation_row.quantity_base,
          'base_unit', allocation_row.base_unit,
          'cost_cop', allocation_row.allocation_cost_cop
        ),
        true
      );
    else
      -- The allocation is still present at this point. Calculate the theoretical
      -- stock after the order deletion, then record the exact unreturned amount as waste.
      if allocation_row.source_kind = 'inventory_item' then
        select
          coalesce(sum(public.production_convert_quantity(purchase.quantity, purchase.unit, allocation_row.base_unit, null)), 0)
          - coalesce((
            select sum(public.production_convert_quantity(production_allocation.quantity_base, production_allocation.base_unit, allocation_row.base_unit, null))
            from public.production_consumption_allocations production_allocation
            where production_allocation.purchase_item_id in (
              select purchase_item.id from public.purchase_items purchase_item where purchase_item.inventory_item_id = allocation_row.inventory_item_id
            )
          ), 0)
          - coalesce((
            select sum(public.production_convert_quantity(pos_allocation.quantity_base, pos_allocation.base_unit, allocation_row.base_unit, null))
            from public.pos_order_consumption_allocations pos_allocation
            join public.pos_order_consumptions pos_consumption on pos_consumption.id = pos_allocation.consumption_id
            join public.pos_orders pos_order on pos_order.id = pos_consumption.order_id
            where pos_consumption.inventory_item_id = allocation_row.inventory_item_id
              and pos_order.status <> 'cancelled'
          ), 0)
          + coalesce((
            select sum(public.production_convert_quantity(count_row.difference_quantity_base, count_row.base_unit, allocation_row.base_unit, null))
            from public.physical_inventory_counts count_row
            where count_row.inventory_item_id = allocation_row.inventory_item_id
              and count_row.voided_at is null
          ), 0)
          + coalesce((
            select sum(public.production_convert_quantity(order_allocation.quantity_base, order_allocation.base_unit, allocation_row.base_unit, null))
            from public.pos_order_consumption_allocations order_allocation
            join public.pos_order_consumptions order_consumption on order_consumption.id = order_allocation.consumption_id
            where order_consumption.order_id = p_order_id
              and order_consumption.inventory_item_id = allocation_row.inventory_item_id
          ), 0)
        into source_stock_after_delete
        from public.purchase_items purchase
        where purchase.inventory_item_id = allocation_row.inventory_item_id;
      else
        select
          coalesce(sum(public.production_convert_quantity(batch.initial_quantity_base, batch.base_unit, allocation_row.base_unit, null)), 0)
          - coalesce((
            select sum(public.production_convert_quantity(production_allocation.quantity_base, production_allocation.base_unit, allocation_row.base_unit, null))
            from public.production_consumption_allocations production_allocation
            where production_allocation.production_batch_id in (
              select production_batch.id from public.production_batches production_batch where production_batch.preparation_id = allocation_row.source_preparation_id
            )
          ), 0)
          - coalesce((
            select sum(public.production_convert_quantity(pos_allocation.quantity_base, pos_allocation.base_unit, allocation_row.base_unit, null))
            from public.pos_order_consumption_allocations pos_allocation
            join public.pos_order_consumptions pos_consumption on pos_consumption.id = pos_allocation.consumption_id
            join public.pos_orders pos_order on pos_order.id = pos_consumption.order_id
            where pos_consumption.source_preparation_id = allocation_row.source_preparation_id
              and pos_order.status <> 'cancelled'
          ), 0)
          + coalesce((
            select sum(public.production_convert_quantity(count_row.difference_quantity_base, count_row.base_unit, allocation_row.base_unit, null))
            from public.physical_inventory_counts count_row
            where count_row.source_preparation_id = allocation_row.source_preparation_id
              and count_row.voided_at is null
          ), 0)
          + coalesce((
            select sum(public.production_convert_quantity(order_allocation.quantity_base, order_allocation.base_unit, allocation_row.base_unit, null))
            from public.pos_order_consumption_allocations order_allocation
            join public.pos_order_consumptions order_consumption on order_consumption.id = order_allocation.consumption_id
            where order_consumption.order_id = p_order_id
              and order_consumption.source_preparation_id = allocation_row.source_preparation_id
          ), 0)
        into source_stock_after_delete
        from public.production_batches batch
        where batch.preparation_id = allocation_row.source_preparation_id;
      end if;

      if source_stock_after_delete < allocation_row.quantity_base - 0.0001 then
        raise exception 'No se puede conservar este consumo como salida sin dejar stock físico negativo.';
      end if;
      physical_quantity := greatest(0, source_stock_after_delete - allocation_row.quantity_base);

      insert into public.physical_inventory_counts (
        source_kind, inventory_item_id, source_preparation_id, theoretical_quantity_base, physical_quantity_base,
        difference_quantity_base, base_unit, average_cost_cop, adjustment_kind, reason, created_by
      ) values (
        allocation_row.source_kind,
        case when allocation_row.source_kind = 'inventory_item' then allocation_row.inventory_item_id else null end,
        case when allocation_row.source_kind = 'preparation' then allocation_row.source_preparation_id else null end,
        source_stock_after_delete,
        physical_quantity,
        -allocation_row.quantity_base,
        allocation_row.base_unit,
        coalesce(allocation_row.allocation_cost_cop / nullif(allocation_row.quantity_base, 0), 0),
        'waste',
        concat('ELIMINACIÓN DE PEDIDO DE PRUEBA ', order_row.code, ' · ', upper(replace(normalized_reason_code, '_', ' '))),
        auth.uid()
      ) returning id into physical_count_id;

      insert into public.pos_order_test_deletion_consumptions (
        audit_id, original_allocation_id, consumption_snapshot, was_reintegrated, physical_inventory_count_id
      ) values (
        audit_id,
        allocation_row.allocation_id,
        jsonb_build_object(
          'allocation_id', allocation_row.allocation_id,
          'consumption_id', allocation_row.consumption_id,
          'order_item_id', allocation_row.order_item_id,
          'order_item_addition_id', allocation_row.order_item_addition_id,
          'product_name_snapshot', coalesce(allocation_row.addition_name_snapshot, allocation_row.product_name_snapshot),
          'source_kind', allocation_row.source_kind,
          'inventory_item_id', allocation_row.inventory_item_id,
          'source_preparation_id', allocation_row.source_preparation_id,
          'purchase_item_id', allocation_row.purchase_item_id,
          'production_batch_id', allocation_row.production_batch_id,
          'quantity_base', allocation_row.quantity_base,
          'base_unit', allocation_row.base_unit,
          'cost_cop', allocation_row.allocation_cost_cop,
          'reason_code', normalized_reason_code,
          'reason_detail', normalized_reason_detail
        ),
        false,
        physical_count_id
      );
    end if;
  end loop;

  -- A hard delete must not change a closed cash session. Open-session movements
  -- are removed together with the test order so the open cash balance stays correct.
  update public.pos_order_payments
  set cash_movement_id = null
  where order_id = p_order_id;

  update public.cash_movements
  set payment_id = null
  where order_id = p_order_id;

  delete from public.cash_movements where order_id = p_order_id;
  delete from public.pos_order_operational_date_events where order_id = p_order_id;
  delete from public.pos_order_payments where order_id = p_order_id;
  delete from public.pos_orders where id = p_order_id;

  return jsonb_build_object(
    'deleted_order_id', p_order_id,
    'order_code', order_row.code,
    'audit_id', audit_id,
    'reintegrated_allocation_count', reintegrated_allocations,
    'retained_allocation_count', retained_allocations
  );
end;
$$;

revoke all on function public.delete_pos_order_for_testing(uuid, uuid[], text, text) from public;
grant execute on function public.delete_pos_order_for_testing(uuid, uuid[], text, text) to authenticated;

notify pgrst, 'reload schema';
