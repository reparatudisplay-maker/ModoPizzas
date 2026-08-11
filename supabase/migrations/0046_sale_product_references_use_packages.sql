update public.inventory_items
set purchase_mode = 'packages'
where item_kind in ('sale_product', 'supply')
  and presentation_quantity is not null
  and purchase_mode is distinct from 'packages';

notify pgrst, 'reload schema';
