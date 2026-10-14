-- The POS catalog must use the same lot ledger as Inventario.  The previous
-- implementation only subtracted production/POS allocations from purchases,
-- so finalized physical counts were ignored while deciding availability.
create or replace function public.get_pos_sale_product_catalog()
returns table(
  id uuid,
  sku text,
  name text,
  image_url text,
  presentation_quantity numeric,
  presentation_unit public.stock_unit,
  sale_price_cop numeric,
  sale_is_enabled boolean,
  unit public.stock_unit,
  stock_base numeric,
  unit_cost_cop numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.current_user_can_access_module('pedidos') then
    raise exception 'No tienes acceso al catalogo de pedidos.';
  end if;

  return query
  with sellable_references as (
    select
      refs.id,
      refs.sku,
      refs.name,
      coalesce(master.image_url, refs.image_url) as image_url,
      refs.presentation_quantity,
      refs.presentation_unit,
      refs.sale_price_cop,
      refs.sale_is_enabled,
      refs.unit
    from public.inventory_items refs
    join public.inventory_items master
      on master.item_kind = 'sale_product'
      and master.presentation_quantity is null
      and master.is_active
      and regexp_replace(upper(master.name), '[^A-Z0-9]+', '', 'g') = regexp_replace(upper(refs.name), '[^A-Z0-9]+', '', 'g')
    where refs.item_kind = 'sale_product'
      and refs.presentation_quantity is not null
      and refs.presentation_unit is not null
      and refs.is_active
      and refs.sale_is_enabled
      and refs.sale_price_cop > 0
      and exists (
        select 1
        from public.purchase_items purchase_line
        where purchase_line.inventory_item_id = refs.id
      )
  ), availability as (
    select
      reference.id as inventory_item_id,
      coalesce(sum(lot.available_base), 0) as stock_base,
      case
        when coalesce(sum(lot.available_base), 0) > 0 then
          sum(
            lot.available_base
            * coalesce(purchase_line.landed_total_cop, purchase_line.line_total_cop, 0)
            / nullif(
              public.production_convert_quantity(
                purchase_line.quantity,
                purchase_line.unit,
                reference.unit,
                null
              ),
              0
            )
          ) / sum(lot.available_base)
        else null
      end as unit_cost_cop
    from sellable_references reference
    left join lateral app_private.inventory_source_lots(
      'inventory_item',
      reference.id,
      reference.unit
    ) lot on true
    left join public.purchase_items purchase_line on purchase_line.id = lot.origin_id
    group by reference.id
  )
  select
    reference.id,
    reference.sku,
    reference.name,
    reference.image_url,
    reference.presentation_quantity,
    reference.presentation_unit,
    reference.sale_price_cop,
    reference.sale_is_enabled,
    reference.unit,
    availability.stock_base,
    availability.unit_cost_cop
  from sellable_references reference
  join availability on availability.inventory_item_id = reference.id
  order by reference.name, reference.presentation_quantity;
end;
$$;

revoke all on function public.get_pos_sale_product_catalog() from public;
grant execute on function public.get_pos_sale_product_catalog() to authenticated;

notify pgrst, 'reload schema';
