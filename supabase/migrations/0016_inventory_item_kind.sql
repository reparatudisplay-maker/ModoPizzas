do $$
begin
  create type public.inventory_item_kind as enum ('ingredient', 'sale_product');
exception
  when duplicate_object then null;
end $$;

alter table public.inventory_items
add column if not exists item_kind public.inventory_item_kind not null default 'ingredient';

create index if not exists inventory_items_item_kind_idx
on public.inventory_items (item_kind);
