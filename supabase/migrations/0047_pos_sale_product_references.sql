create or replace view public.pos_sale_product_references
with (security_invoker = true) as
select
  refs.id,
  refs.sku,
  refs.name,
  coalesce(master.image_url, refs.image_url) as image_url,
  refs.presentation_quantity,
  refs.presentation_unit,
  refs.unit,
  refs.is_active,
  master.id as master_inventory_item_id,
  exists (
    select 1
    from public.purchase_items purchase_line
    join public.purchases purchase_header on purchase_header.id = purchase_line.purchase_id
    where purchase_line.inventory_item_id = refs.id
  ) as has_purchase_history
from public.inventory_items refs
join public.inventory_items master
  on master.item_kind = 'sale_product'
 and master.presentation_quantity is null
 and master.is_active = true
 and upper(master.name) = upper(refs.name)
where refs.item_kind = 'sale_product'
  and refs.presentation_quantity is not null
  and refs.presentation_unit is not null
  and refs.is_active = true
  and exists (
    select 1
    from public.purchase_items purchase_line
    join public.purchases purchase_header on purchase_header.id = purchase_line.purchase_id
    where purchase_line.inventory_item_id = refs.id
  );

grant select on public.pos_sale_product_references to authenticated;

notify pgrst, 'reload schema';
