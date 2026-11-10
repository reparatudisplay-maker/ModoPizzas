-- El costo de referencia del faltante ya está guardado en la deuda. Evitamos
-- convertir la unidad de una compra cuando la deuda corresponde a producción.

create or replace function public.preview_pending_pos_inventory_regularization()
returns table (
  debt_id uuid,
  order_code text,
  source_id uuid,
  source_kind text,
  item_name text,
  quantity_base numeric,
  base_unit public.stock_unit,
  estimated_unit_cost_cop numeric,
  lot_id uuid,
  lot_available_base numeric,
  lot_purchased_at timestamptz,
  lot_expiration_date date,
  lot_unit_cost_cop numeric
)
language sql
security definer
set search_path = public, app_private
as $$
  select debt.id, order_row.code, debt.source_id, debt.source_kind,
    coalesce(item.name, preparation.name, 'Origen no disponible'),
    debt.quantity_base, debt.base_unit, debt.estimated_unit_cost_cop,
    lots.origin_id, lots.available_base, purchase.purchased_at, lots.expiration_date,
    case when debt.source_kind = 'inventory_item' then debt.estimated_unit_cost_cop else null end
  from public.pos_inventory_regularization_debts debt
  join public.pos_orders order_row on order_row.id = debt.order_id
  left join public.inventory_items item on item.id = debt.source_id and debt.source_kind = 'inventory_item'
  left join public.preparations preparation on preparation.id = debt.source_id and debt.source_kind = 'preparation'
  left join lateral app_private.inventory_source_lots(
    'inventory_item',
    case when debt.source_kind = 'inventory_item' then debt.source_id else null end,
    debt.base_unit
  ) lots on lots.available_base > 0
  left join public.purchase_items purchase_item on purchase_item.id = lots.origin_id
  left join public.purchases purchase on purchase.id = purchase_item.purchase_id
  where debt.status = 'pending'
  order by coalesce(item.name, preparation.name, 'Origen no disponible'), debt.created_at, debt.id, lots.expiration_date nulls last, lots.occurred_at;
$$;

notify pgrst, 'reload schema';
