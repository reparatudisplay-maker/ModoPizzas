-- Corrige la bebida incluida hacia la referencia vendible que tiene trazabilidad de compra.
-- No modifica pedidos, consumos ni snapshots historicos.
do $$
declare
  v_coca_id uuid;
begin
  select refs.id into v_coca_id
  from public.inventory_items refs
  where refs.item_kind = 'sale_product'
    and refs.is_active
    and refs.sale_is_enabled
    and refs.presentation_quantity is not null
    and refs.presentation_unit is not null
    and upper(refs.name) like '%COCA%COLA%'
    and (
      (refs.presentation_quantity = 1.5 and refs.presentation_unit = 'l'::public.stock_unit)
      or (refs.presentation_quantity = 1500 and refs.presentation_unit = 'ml'::public.stock_unit)
      or upper(coalesce(refs.sku, '')) like '%1500%'
    )
    and exists (
      select 1 from public.purchase_items purchase_line where purchase_line.inventory_item_id = refs.id
    )
  order by refs.created_at
  limit 1;

  if v_coca_id is null then
    raise exception 'No se encontro una referencia vendible de Coca-Cola 1.5 L con trazabilidad de compra.';
  end if;

  update public.combo_group_options o
  set is_active = false
  from public.combo_groups g
  join public.combo_configs c on c.id = g.combo_id
  where o.group_id = g.id
    and g.group_kind = 'sale_product'
    and c.sku in ('CMBGRAN', 'CMBFAM', 'CMB2MED');

  update public.combo_group_options o
  set is_active = true
  from public.combo_groups g
  join public.combo_configs c on c.id = g.combo_id
  where o.group_id = g.id
    and g.group_kind = 'sale_product'
    and c.sku in ('CMBGRAN', 'CMBFAM', 'CMB2MED')
    and o.inventory_item_id = v_coca_id;

  insert into public.combo_group_options (group_id, inventory_item_id, is_active, sort_order)
  select g.id, v_coca_id, true, 0
  from public.combo_groups g
  join public.combo_configs c on c.id = g.combo_id
  where g.group_kind = 'sale_product'
    and c.sku in ('CMBGRAN', 'CMBFAM', 'CMB2MED')
    and not exists (
      select 1 from public.combo_group_options o
      where o.group_id = g.id and o.inventory_item_id = v_coca_id
    );
end;
$$;

notify pgrst, 'reload schema';
