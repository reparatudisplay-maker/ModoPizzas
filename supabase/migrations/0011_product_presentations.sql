alter table public.inventory_items
  add column if not exists presentation_quantity numeric(14, 3),
  add column if not exists presentation_unit public.stock_unit;

alter table public.purchase_items
  add column if not exists presentation_quantity numeric(14, 3),
  add column if not exists presentation_unit public.stock_unit;
