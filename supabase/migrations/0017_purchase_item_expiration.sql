alter table public.purchase_items
add column if not exists expiration_date date;

create index if not exists purchase_items_expiration_date_idx
on public.purchase_items (expiration_date);
