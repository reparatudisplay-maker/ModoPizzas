alter table public.inventory_items
  add column if not exists purchase_mode text not null default 'total_weight',
  add column if not exists brand_id uuid references public.brands(id),
  add column if not exists image_url text;

alter table public.inventory_items
  drop constraint if exists inventory_items_purchase_mode_check;

alter table public.inventory_items
  add constraint inventory_items_purchase_mode_check
  check (purchase_mode in ('total_weight', 'packages'));

create index if not exists inventory_items_brand_id_idx
  on public.inventory_items (brand_id);
