-- Correct one confirmed historical purchase that was recorded as 15,000 KG
-- instead of 15 KG. The guards intentionally stop if the known data shape
-- changes, so no unrelated purchase, production, or POS allocation is touched.
do $migration$
declare
  target_purchase_item_id constant uuid := '46a5f0fe-c2b2-46fe-9e9d-849cc36e771d'::uuid;
  target_inventory_item_id constant uuid := '1f8998ac-ca4a-4bd9-904c-fa14423d69d5'::uuid;
  expected_total_cop constant numeric := 294000;
  corrected_quantity_g constant numeric := 15000;
  target record;
  allocation_count integer;
  allocation_quantity numeric;
  production_allocation_count integer;
  affected_codes text[];
  invalid_allocation_count integer;
  current_inventory_quantity numeric;
  current_inventory_average numeric;
begin
  select
    purchase_item.id,
    purchase_item.inventory_item_id,
    purchase_item.quantity,
    purchase_item.unit,
    purchase_item.purchased_quantity,
    purchase_item.presentation_quantity,
    purchase_item.presentation_unit,
    purchase_item.unit_cost_cop,
    purchase_item.line_total_cop
  into target
  from public.purchase_items purchase_item
  where purchase_item.id = target_purchase_item_id
  for update;

  if not found
    or target.inventory_item_id <> target_inventory_item_id
    or target.line_total_cop <> expected_total_cop then
    raise exception 'La compra objetivo de mozzarella no coincide con la auditoría esperada.';
  end if;

  select count(*), coalesce(sum(allocation.quantity_base), 0)
  into allocation_count, allocation_quantity
  from public.pos_order_consumption_allocations allocation
  where allocation.purchase_item_id = target_purchase_item_id;

  if allocation_count <> 6 or allocation_quantity <> 1070 then
    raise exception 'Las asignaciones POS de la compra objetivo cambiaron; se aborta la corrección.';
  end if;

  select count(*)
  into production_allocation_count
  from public.production_consumption_allocations allocation
  where allocation.purchase_item_id = target_purchase_item_id;

  if production_allocation_count <> 0 then
    raise exception 'La compra objetivo ya tiene consumos de producción; se aborta la corrección.';
  end if;

  select array_agg(distinct order_header.code order by order_header.code)
  into affected_codes
  from public.pos_order_consumption_allocations allocation
  join public.pos_order_consumptions consumption on consumption.id = allocation.consumption_id
  join public.pos_orders order_header on order_header.id = consumption.order_id
  where allocation.purchase_item_id = target_purchase_item_id;

  if affected_codes is distinct from array['PD61', 'PD62', 'PD64', 'PD65']::text[] then
    raise exception 'Los pedidos afectados por la compra objetivo cambiaron; se aborta la corrección.';
  end if;

  -- Allocations may be in the original state or in the corrected state when
  -- this migration is re-run. Any third value is unsafe to overwrite.
  select count(*)
  into invalid_allocation_count
  from public.pos_order_consumption_allocations allocation
  where allocation.purchase_item_id = target_purchase_item_id
    and allocation.cost_cop not in (
      round(
        public.production_convert_quantity(allocation.quantity_base, allocation.base_unit, 'g'::public.stock_unit, null)
          * expected_total_cop / 15000000,
        2
      ),
      round(
        public.production_convert_quantity(allocation.quantity_base, allocation.base_unit, 'g'::public.stock_unit, null)
          * expected_total_cop / corrected_quantity_g,
        2
      )
    );

  if invalid_allocation_count <> 0 then
    raise exception 'Hay costos históricos de mozzarella fuera de los estados auditados; se aborta la corrección.';
  end if;

  if target.quantity = 15000000
    and target.unit = 'g'::public.stock_unit
    and target.purchased_quantity = 15000
    and target.presentation_quantity = 15000
    and target.presentation_unit = 'kg'::public.stock_unit
    and target.unit_cost_cop = 0.02 then
    update public.purchase_items
    set quantity = corrected_quantity_g,
        unit = 'g'::public.stock_unit,
        purchased_quantity = 15,
        presentation_quantity = 15,
        presentation_unit = 'kg'::public.stock_unit,
        unit_cost_cop = round(expected_total_cop / corrected_quantity_g, 2),
        line_total_cop = expected_total_cop
    where id = target_purchase_item_id;
  elsif not (
    target.quantity = corrected_quantity_g
    and target.unit = 'g'::public.stock_unit
    and target.purchased_quantity = 15
    and target.presentation_quantity = 15
    and target.presentation_unit = 'kg'::public.stock_unit
    and target.unit_cost_cop = round(expected_total_cop / corrected_quantity_g, 2)
  ) then
    raise exception 'La compra objetivo no está en un estado reconocible; se aborta la corrección.';
  end if;

  with corrected_allocations as (
    select
      allocation.id,
      round(
        public.production_convert_quantity(allocation.quantity_base, allocation.base_unit, 'g'::public.stock_unit, null)
          * expected_total_cop / corrected_quantity_g,
        2
      ) as corrected_cost_cop
    from public.pos_order_consumption_allocations allocation
    where allocation.purchase_item_id = target_purchase_item_id
  )
  update public.pos_order_consumption_allocations allocation
  set cost_cop = corrected_allocations.corrected_cost_cop
  from corrected_allocations
  where allocation.id = corrected_allocations.id;

  with affected_consumptions as (
    select distinct consumption.id
    from public.pos_order_consumptions consumption
    join public.pos_order_consumption_allocations allocation on allocation.consumption_id = consumption.id
    where allocation.purchase_item_id = target_purchase_item_id
  ),
  totals as (
    select consumption.id, round(coalesce(sum(allocation.cost_cop), 0), 2) as cost_cop
    from public.pos_order_consumptions consumption
    join affected_consumptions affected on affected.id = consumption.id
    left join public.pos_order_consumption_allocations allocation on allocation.consumption_id = consumption.id
    group by consumption.id
  )
  update public.pos_order_consumptions consumption
  set cost_cop = totals.cost_cop
  from totals
  where consumption.id = totals.id;

  with affected_items as (
    select distinct consumption.order_item_id as id
    from public.pos_order_consumptions consumption
    join public.pos_order_consumption_allocations allocation on allocation.consumption_id = consumption.id
    where allocation.purchase_item_id = target_purchase_item_id
  ),
  totals as (
    select item.id, round(coalesce(sum(consumption.cost_cop), 0), 2) as line_cost_cop
    from public.pos_order_items item
    join affected_items affected on affected.id = item.id
    left join public.pos_order_consumptions consumption on consumption.order_item_id = item.id
    group by item.id
  )
  update public.pos_order_items item
  set line_cost_cop = totals.line_cost_cop
  from totals
  where item.id = totals.id;

  -- Match the application's current purchase-summary algorithm instead of
  -- inventing a stock balance: purchase quantity and weighted unit cost are
  -- recalculated from all mozzarella purchase lines.
  select
    coalesce(sum(purchase_item.quantity), 0),
    case
      when coalesce(sum(purchase_item.quantity), 0) > 0
        then round(coalesce(sum(purchase_item.line_total_cop), 0) / sum(purchase_item.quantity), 2)
      else 0
    end
  into current_inventory_quantity, current_inventory_average
  from public.purchase_items purchase_item
  where purchase_item.inventory_item_id = target_inventory_item_id;

  update public.inventory_items inventory
  set current_quantity = current_inventory_quantity,
      average_cost_cop = current_inventory_average
  where inventory.id = target_inventory_item_id;
end;
$migration$;

notify pgrst, 'reload schema';
