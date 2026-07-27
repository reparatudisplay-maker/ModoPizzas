alter table public.pizza_additions
  drop constraint if exists pizza_additions_name_key;

create or replace function app_private.normalized_menu_name(input_name text)
returns text
language sql
immutable
as $$
  select regexp_replace(
    regexp_replace(extensions.unaccent(upper(btrim(coalesce(input_name, '')))), '[^A-Z0-9 ]', '', 'g'),
    '\s+',
    ' ',
    'g'
  );
$$;

create unique index if not exists pizza_additions_inventory_item_name_unique
  on public.pizza_additions (
    inventory_item_id,
    app_private.normalized_menu_name(name)
  )
  where source_kind = 'inventory_item' and inventory_item_id is not null;

notify pgrst, 'reload schema';
