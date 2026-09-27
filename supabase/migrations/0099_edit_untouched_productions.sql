begin;

create or replace function public.update_production(
  p_production_id uuid,
  p_preparation_id uuid,
  p_storage_method text,
  p_elaborated_at date,
  p_expiration_date date,
  p_expected_quantity numeric,
  p_expected_unit public.stock_unit,
  p_actual_quantity numeric,
  p_actual_unit public.stock_unit,
  p_items jsonb
)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  existing_production public.productions%rowtype;
  existing_batch public.production_batches%rowtype;
  temporary_production public.productions%rowtype;
  temporary_result jsonb;
  original_counter bigint;
  adjustment_exists boolean;
begin
  if not app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]) then
    raise exception 'No tienes permisos para editar producción.';
  end if;

  select * into existing_production
  from public.productions
  where id = p_production_id
  for update;
  if not found then
    raise exception 'Producción no encontrada.';
  end if;
  if existing_production.preparation_id <> p_preparation_id then
    raise exception 'No se puede cambiar la preparación de una producción confirmada.';
  end if;

  select * into existing_batch
  from public.production_batches
  where production_id = p_production_id
  for update;
  if not found then
    raise exception 'La producción no tiene un lote editable.';
  end if;

  if exists (
    select 1 from public.production_consumption_allocations allocation
    where allocation.production_batch_id = existing_batch.id
  ) or exists (
    select 1
    from public.pos_order_consumption_allocations allocation
    join public.pos_order_consumptions consumption on consumption.id = allocation.consumption_id
    join public.pos_orders order_header on order_header.id = consumption.order_id
    where allocation.production_batch_id = existing_batch.id
      and order_header.status <> 'cancelled'
  ) then
    raise exception 'Esta producción ya tiene consumos asociados y no puede editarse directamente para preservar la trazabilidad.';
  end if;

  select exists(
    select 1
    from public.physical_inventory_counts count_row
    where count_row.source_kind = 'preparation'
      and count_row.source_preparation_id = existing_production.preparation_id
      and count_row.voided_at is null
      and count_row.created_at >= existing_production.created_at
  ) into adjustment_exists;
  if adjustment_exists then
    raise exception 'Esta producción tiene ajustes o conteos posteriores y no puede editarse directamente para preservar la trazabilidad.';
  end if;

  select last_number into original_counter
  from public.production_counters
  where id = true
  for update;

  delete from public.production_consumptions where production_id = p_production_id;
  delete from public.production_batches where id = existing_batch.id;

  temporary_result := public.create_production(
    p_preparation_id,
    p_storage_method,
    p_elaborated_at,
    p_expiration_date,
    p_expected_quantity,
    p_expected_unit,
    p_actual_quantity,
    p_actual_unit,
    p_items
  );

  select * into temporary_production
  from public.productions
  where id = (temporary_result ->> 'id')::uuid
  for update;

  update public.production_consumptions
  set production_id = existing_production.id
  where production_id = temporary_production.id;

  update public.production_batches
  set production_id = existing_production.id,
      production_number = existing_production.production_number
  where production_id = temporary_production.id;

  update public.productions
  set storage_method = temporary_production.storage_method,
      elaborated_at = temporary_production.elaborated_at,
      expected_quantity_base = temporary_production.expected_quantity_base,
      actual_quantity_base = temporary_production.actual_quantity_base,
      base_unit = temporary_production.base_unit,
      expiration_date = temporary_production.expiration_date,
      total_cost_cop = temporary_production.total_cost_cop,
      unit_cost_cop = temporary_production.unit_cost_cop
  where id = existing_production.id;

  delete from public.productions where id = temporary_production.id;

  update public.production_counters
  set last_number = original_counter
  where id = true;

  return jsonb_build_object(
    'id', existing_production.id,
    'code', existing_production.code,
    'total_cost_cop', temporary_production.total_cost_cop,
    'unit_cost_cop', temporary_production.unit_cost_cop,
    'expiration_date', temporary_production.expiration_date,
    'actual_quantity_base', temporary_production.actual_quantity_base,
    'base_unit', temporary_production.base_unit
  );
end;
$function$;

grant execute on function public.update_production(uuid, uuid, text, date, date, numeric, public.stock_unit, numeric, public.stock_unit, jsonb) to authenticated;

notify pgrst, 'reload schema';

commit;
