begin;

-- These headers were created solely to reconstruct sales that happened before
-- the POS was used. Keep every purchase line and allocation identifier, but
-- place them under one administrative opening-balance document.
create temporary table historical_regularization_stock_before on commit drop as
select
  item.id as inventory_item_id,
  coalesce(sum(lot.available_base), 0) as available_base
from public.inventory_items item
left join lateral app_private.inventory_source_lots('inventory_item', item.id, item.unit) lot on true
group by item.id;

do $$
declare
  canonical_purchase_id constant uuid := '5d65e09e-7406-4c5d-a6fa-f5cc9219c56f';
  normalized_purchase_ids constant uuid[] := array[
    '5d65e09e-7406-4c5d-a6fa-f5cc9219c56f'::uuid,
    '08c7f139-7cd9-412f-ab45-e3c2de11b97e'::uuid,
    'ebabef29-dace-4735-a2ab-7efd33840acd'::uuid,
    'b91a8e21-7a71-4bab-a764-cc5e020b1756'::uuid,
    'e2c38b59-2e46-4351-8765-99232e0b1fec'::uuid,
    '1b342129-75f0-499c-b123-c0670fed5697'::uuid,
    '5eb496a7-cfe4-4315-85c7-19563e44376a'::uuid,
    '62723a3f-8cda-4063-9b51-192e56f4150c'::uuid
  ];
  source_header_count integer;
  source_line_count integer;
  v_total_merchandise_cop numeric(14, 2);
  v_total_transport_cop numeric(14, 2);
  v_total_cop numeric(14, 2);
begin
  select count(*)
  into source_header_count
  from public.purchases
  where id = any(normalized_purchase_ids);

  if source_header_count <> 8 then
    raise exception 'La normalización histórica requiere exactamente 8 compras origen; se encontraron %.', source_header_count;
  end if;

  select
    count(*),
    coalesce(sum(coalesce(merchandise_total_cop, line_total_cop)), 0),
    coalesce(sum(coalesce(transport_allocated_cop, 0)), 0),
    coalesce(sum(coalesce(landed_total_cop, line_total_cop)), 0)
  into source_line_count, v_total_merchandise_cop, v_total_transport_cop, v_total_cop
  from public.purchase_items
  where purchase_id = any(normalized_purchase_ids);

  if source_line_count <> 110 then
    raise exception 'La normalización histórica requiere exactamente 110 líneas origen; se encontraron %.', source_line_count;
  end if;

  -- Preserve line IDs so frozen POS/production allocations retain their exact
  -- source rows and costs. Only their administrative purchase header changes.
  update public.purchase_items
  set purchase_id = canonical_purchase_id
  where purchase_id = any(normalized_purchase_ids)
    and purchase_id <> canonical_purchase_id;

  update public.purchases
  set merchandise_subtotal_cop = v_total_merchandise_cop,
      transport_cost_cop = v_total_transport_cop,
      total_cop = v_total_cop,
      notes = 'NORMALIZACION HISTORICA DE APERTURA | Consolidación administrativa de 8 registros de regularización/corrección (24/09–09/10/2026). Conserva las 110 líneas originales, sus identificadores, consumos y costos de referencia. No representa una compra real ni altera existencias.'
  where id = canonical_purchase_id;

  delete from public.purchases
  where id = any(normalized_purchase_ids)
    and id <> canonical_purchase_id;

  if (select count(*) from public.purchase_items where purchase_id = canonical_purchase_id) <> 110 then
    raise exception 'La compra histórica consolidada no conserva las 110 líneas esperadas.';
  end if;

  if (select count(*) from public.purchases where id = any(normalized_purchase_ids)) <> 1 then
    raise exception 'La normalización histórica no dejó un único encabezado de compra.';
  end if;
end;
$$;

create temporary table historical_regularization_stock_after on commit drop as
select
  item.id as inventory_item_id,
  coalesce(sum(lot.available_base), 0) as available_base
from public.inventory_items item
left join lateral app_private.inventory_source_lots('inventory_item', item.id, item.unit) lot on true
group by item.id;

do $$
begin
  if exists (
    select 1
    from historical_regularization_stock_before before_stock
    full join historical_regularization_stock_after after_stock
      on after_stock.inventory_item_id = before_stock.inventory_item_id
    where abs(coalesce(before_stock.available_base, 0) - coalesce(after_stock.available_base, 0)) > 0.000001
  ) then
    raise exception 'La normalización histórica alteraría el stock calculado; se revierte la transacción.';
  end if;
end;
$$;

commit;
