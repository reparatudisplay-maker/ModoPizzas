alter table public.purchase_items
  add column if not exists purchased_quantity numeric(14, 3);

update public.purchase_items
set purchased_quantity = quantity
where purchased_quantity is null;
