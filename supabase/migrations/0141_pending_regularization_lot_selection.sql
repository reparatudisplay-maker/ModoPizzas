-- Expone los faltantes POS con sus lotes físicamente disponibles y audita el
-- lote de referencia elegido para la regularización técnica.

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
  select
    debt.id,
    order_row.code,
    debt.source_id,
    debt.source_kind,
    coalesce(item.name, preparation.name, 'Origen no disponible'),
    debt.quantity_base,
    debt.base_unit,
    debt.estimated_unit_cost_cop,
    lots.origin_id,
    lots.available_base,
    purchase.purchased_at,
    lots.expiration_date,
    coalesce(purchase_item.line_total_cop / nullif(public.production_convert_quantity(purchase_item.quantity, purchase_item.unit, debt.base_unit, null), 0), 0)
  from public.pos_inventory_regularization_debts debt
  join public.pos_orders order_row on order_row.id = debt.order_id
  left join public.inventory_items item on item.id = debt.source_id and debt.source_kind = 'inventory_item'
  left join public.preparations preparation on preparation.id = debt.source_id and debt.source_kind = 'preparation'
  left join lateral app_private.inventory_source_lots(debt.source_kind, debt.source_id, debt.base_unit) lots
    on lots.available_base > 0
  left join public.purchase_items purchase_item on purchase_item.id = lots.origin_id and debt.source_kind = 'inventory_item'
  left join public.purchases purchase on purchase.id = purchase_item.purchase_id
  where debt.status = 'pending'
  order by coalesce(item.name, preparation.name, 'Origen no disponible'), debt.created_at, debt.id, lots.expiration_date nulls last, lots.occurred_at;
$$;

revoke all on function public.preview_pending_pos_inventory_regularization() from public;
grant execute on function public.preview_pending_pos_inventory_regularization() to authenticated;

create or replace function public.regularize_pending_pos_inventory_debts_with_lot_references(
  p_lot_references jsonb,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private, auth, pg_temp
as $$
declare
  v_reference jsonb;
  v_debt_id uuid;
  v_lot_id uuid;
  v_debt record;
  v_available numeric;
  v_result jsonb;
begin
  if auth.uid() is null or not app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]) then
    raise exception 'No tienes permisos para regularizar faltantes de inventario.' using errcode = '42501';
  end if;

  if jsonb_typeof(p_lot_references) <> 'array' then
    raise exception 'La selección de lotes no es válida.';
  end if;

  perform 1 from public.pos_inventory_regularization_debts where status = 'pending' for update;
  if not found then
    raise exception 'No hay faltantes pendientes de regularización.';
  end if;

  for v_debt in select * from public.pos_inventory_regularization_debts where status = 'pending' order by id loop
    select reference into v_reference
    from jsonb_array_elements(p_lot_references) reference
    where reference ->> 'debt_id' = v_debt.id::text
    limit 1;

    if v_debt.source_kind <> 'inventory_item' then
      continue;
    end if;
    if v_reference is null or nullif(v_reference ->> 'lot_id', '') is null then
      raise exception 'Selecciona un lote de referencia para cada faltante de inventario.';
    end if;

    v_debt_id := v_debt.id;
    v_lot_id := (v_reference ->> 'lot_id')::uuid;
    select lots.available_base into v_available
    from app_private.inventory_source_lots('inventory_item', v_debt.source_id, v_debt.base_unit) lots
    where lots.origin_id = v_lot_id;
    if coalesce(v_available, 0) <= 0 then
      raise exception 'El lote seleccionado ya no tiene existencias disponibles.';
    end if;

    insert into public.audit_logs (actor_id, action, entity_table, entity_id, before_data, after_data)
    values (
      auth.uid(), 'select_pending_regularization_lot_reference', 'pos_inventory_regularization_debts', v_debt_id,
      jsonb_build_object('status', 'pending'),
      jsonb_build_object('reference_purchase_item_id', v_lot_id, 'available_base', v_available, 'base_unit', v_debt.base_unit)
    );
  end loop;

  select public.regularize_pending_pos_inventory_debts(p_notes) into v_result;
  return v_result;
end;
$$;

revoke all on function public.regularize_pending_pos_inventory_debts_with_lot_references(jsonb, text) from public;
grant execute on function public.regularize_pending_pos_inventory_debts_with_lot_references(jsonb, text) to authenticated;

notify pgrst, 'reload schema';
