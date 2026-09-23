-- Read-only inventory simulation for the POS. It intentionally calls the
-- existing order writer inside a subtransaction and rolls it back, so FEFO,
-- recipe resolution, substitutions and validation stay exactly aligned.
create or replace function public.get_pos_inventory_consumption_preview(p_items jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $function$
declare
  trial_order jsonb;
  trial_order_id uuid;
  preview jsonb;
  shortages jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido necesita al menos un producto.';
  end if;

  -- This is the same shortage resolver used by the POS writer before it
  -- allocates lots. It also keeps the insufficient-stock response structured.
  shortages := public.get_pos_order_stock_shortages(p_items);
  if jsonb_array_length(coalesce(shortages, '[]'::jsonb)) > 0 then
    return jsonb_build_object(
      'status', 'insufficient',
      'shortages', shortages,
      'consolidated', '[]'::jsonb,
      'lines', '[]'::jsonb
    );
  end if;

  begin
    -- create_pos_order and pos_allocate_consumption are the only source of
    -- truth for pizza bases, recipes, half-and-half, additions and FEFO/FIFO.
    trial_order := public.create_pos_order('local', '', '', 0, 0, 'pending', 'VISTA PREVIA DE INVENTARIO', p_items);
    trial_order_id := (trial_order->>'id')::uuid;

    with allocation_rows as (
      select
        item.id as order_item_id,
        item.item_kind,
        item.product_name_snapshot,
        item.quantity as line_quantity,
        item.cart_line_key,
        item.notes,
        addition.id as order_item_addition_id,
        addition.name_snapshot as addition_name_snapshot,
        consumption.source_kind,
        coalesce(consumption.inventory_item_id, consumption.source_preparation_id) as source_id,
        coalesce(inventory.name, preparation.name, 'Fuente sin registro') as source_name,
        allocation.purchase_item_id,
        allocation.production_batch_id,
        allocation.quantity_base,
        allocation.base_unit,
        purchase.purchased_at,
        purchase_item.expiration_date as purchase_expiration_date,
        production_batch.elaborated_at,
        production_batch.expiration_date as production_expiration_date,
        production_batch.production_number,
        case
          when allocation.purchase_item_id is not null then 'Compra ' || left(purchase.id::text, 8)
          when allocation.production_batch_id is not null then 'Producción P' || production_batch.production_number::text
          else 'Origen sin registro'
        end as origin_label
      from public.pos_order_consumption_allocations allocation
      join public.pos_order_consumptions consumption on consumption.id = allocation.consumption_id
      left join public.pos_order_items item on item.id = consumption.order_item_id
      left join public.pos_order_item_additions addition on addition.id = consumption.order_item_addition_id
      left join public.inventory_items inventory on inventory.id = consumption.inventory_item_id
      left join public.preparations preparation on preparation.id = consumption.source_preparation_id
      left join public.purchase_items purchase_item on purchase_item.id = allocation.purchase_item_id
      left join public.purchases purchase on purchase.id = purchase_item.purchase_id
      left join public.production_batches production_batch on production_batch.id = allocation.production_batch_id
      where consumption.order_id = trial_order_id
    ),
    allocation_totals as (
      select
        row.*,
        sum(row.quantity_base) over (partition by row.purchase_item_id, row.production_batch_id) as preview_from_origin
      from allocation_rows row
    ),
    enriched as (
      select
        row.*,
        case
          when row.purchase_item_id is not null then greatest(0,
            public.production_convert_quantity(purchase_item.quantity, purchase_item.unit, row.base_unit, null)
            - coalesce((select sum(public.production_convert_quantity(allocation.quantity_base, allocation.base_unit, row.base_unit, null)) from public.production_consumption_allocations allocation where allocation.purchase_item_id = row.purchase_item_id), 0)
            - coalesce((select sum(public.production_convert_quantity(allocation.quantity_base, allocation.base_unit, row.base_unit, null)) from public.pos_order_consumption_allocations allocation join public.pos_order_consumptions consumption on consumption.id = allocation.consumption_id join public.pos_orders order_header on order_header.id = consumption.order_id where allocation.purchase_item_id = row.purchase_item_id and order_header.status <> 'cancelled'), 0)
          )
          when row.production_batch_id is not null then greatest(0,
            public.production_convert_quantity(production_batch.initial_quantity_base, production_batch.base_unit, row.base_unit, null)
            - coalesce((select sum(public.production_convert_quantity(allocation.quantity_base, allocation.base_unit, row.base_unit, null)) from public.production_consumption_allocations allocation where allocation.production_batch_id = row.production_batch_id), 0)
            - coalesce((select sum(public.production_convert_quantity(allocation.quantity_base, allocation.base_unit, row.base_unit, null)) from public.pos_order_consumption_allocations allocation join public.pos_order_consumptions consumption on consumption.id = allocation.consumption_id join public.pos_orders order_header on order_header.id = consumption.order_id where allocation.production_batch_id = row.production_batch_id and order_header.status <> 'cancelled'), 0)
          )
          else 0
        end as origin_stock_after
      from allocation_totals row
      left join public.purchase_items purchase_item on purchase_item.id = row.purchase_item_id
      left join public.production_batches production_batch on production_batch.id = row.production_batch_id
    ),
    line_rows as (
      select
        order_item_id,
        item_kind,
        product_name_snapshot,
        line_quantity,
        cart_line_key,
        notes,
        jsonb_agg(jsonb_build_object(
          'source_name', source_name,
          'source_kind', source_kind,
          'source_id', source_id,
          'quantity_base', quantity_base,
          'base_unit', base_unit,
          'origin_label', origin_label,
          'purchase_item_id', purchase_item_id,
          'production_batch_id', production_batch_id,
          'purchased_at', purchased_at,
          'purchase_expiration_date', purchase_expiration_date,
          'elaborated_at', elaborated_at,
          'production_expiration_date', production_expiration_date,
          'origin_stock_before', origin_stock_after + preview_from_origin,
          'origin_consumption', quantity_base,
          'origin_stock_after', origin_stock_after
        ) order by source_name, origin_label) as consumptions
      from enriched
      group by order_item_id, item_kind, product_name_snapshot, line_quantity, cart_line_key, notes
    ),
    origin_rows as (
      select
        source_kind,
        source_id,
        source_name,
        base_unit,
        origin_label,
        purchase_item_id,
        production_batch_id,
        purchased_at,
        purchase_expiration_date,
        elaborated_at,
        production_expiration_date,
        max(origin_stock_after + preview_from_origin) as stock_before,
        sum(quantity_base) as consumption_quantity,
        max(origin_stock_after) as stock_after
      from enriched
      group by source_kind, source_id, source_name, base_unit, origin_label,
        purchase_item_id, production_batch_id, purchased_at, purchase_expiration_date,
        elaborated_at, production_expiration_date
    ),
    consolidated_rows as (
      select
        source_kind,
        source_id,
        source_name,
        base_unit,
        sum(consumption_quantity) as consumption_quantity,
        sum(stock_before) as stock_before,
        sum(stock_after) as stock_after,
        jsonb_agg(jsonb_build_object(
          'origin_label', origin_label,
          'purchase_item_id', purchase_item_id,
          'production_batch_id', production_batch_id,
          'purchased_at', purchased_at,
          'purchase_expiration_date', purchase_expiration_date,
          'elaborated_at', elaborated_at,
          'production_expiration_date', production_expiration_date,
          'stock_before', stock_before,
          'consumption_quantity', consumption_quantity,
          'stock_after', stock_after
        ) order by origin_label) as origins
      from origin_rows
      group by source_kind, source_id, source_name, base_unit
    )
    select jsonb_build_object(
      'status', 'ok',
      'shortages', '[]'::jsonb,
      'consolidated', coalesce((select jsonb_agg(jsonb_build_object(
        'source_kind', source_kind,
        'source_id', source_id,
        'source_name', source_name,
        'unit', base_unit,
        'stock_before', stock_before,
        'consumption_quantity', consumption_quantity,
        'stock_after', stock_after,
        'origins', origins
      ) order by source_name) from consolidated_rows), '[]'::jsonb),
      'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'order_item_id', order_item_id,
        'item_kind', item_kind,
        'name', product_name_snapshot,
        'quantity', line_quantity,
        'cart_line_key', cart_line_key,
        'notes', notes,
        'consumptions', consumptions
      ) order by order_item_id) from line_rows), '[]'::jsonb)
    ) into preview;

    -- The exception rolls back the temporary order, its allocations, counter
    -- change, KDS records and every inventory-side write from the exact writer.
    raise exception 'POS_INVENTORY_PREVIEW_ROLLBACK';
  exception
    when raise_exception then
      if sqlerrm <> 'POS_INVENTORY_PREVIEW_ROLLBACK' then
        raise;
      end if;
  end;

  return preview;
end;
$function$;

revoke all on function public.get_pos_inventory_consumption_preview(jsonb) from public;
grant execute on function public.get_pos_inventory_consumption_preview(jsonb) to authenticated;

notify pgrst, 'reload schema';
