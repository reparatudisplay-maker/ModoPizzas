create or replace function public.inventory_item_relation_summary(p_item_id uuid)
returns text[]
language plpgsql
security invoker
set search_path = public
as $$
declare
  used_in text[] := array[]::text[];
  relation_count bigint;
  item_row record;
begin
  select id, name, item_kind, presentation_quantity
    into item_row
  from public.inventory_items
  where id = p_item_id;

  if not found then
    raise exception 'Producto no encontrado.';
  end if;

  select count(*) into relation_count from public.purchase_items where inventory_item_id = p_item_id;
  if relation_count > 0 then used_in := array_append(used_in, 'Compras'); end if;

  if to_regclass('public.inventory_movements') is not null then
    execute 'select count(*) from public.inventory_movements where inventory_item_id = $1'
      into relation_count
      using p_item_id;
    if relation_count > 0 then used_in := array_append(used_in, 'Inventario'); end if;
  end if;

  select count(*) into relation_count from public.physical_inventory_counts where inventory_item_id = p_item_id and voided_at is null;
  if relation_count > 0 then used_in := array_append(used_in, 'Ajustes'); end if;

  select count(*) into relation_count from public.preparation_recipe_items where inventory_item_id = p_item_id;
  if relation_count > 0 then used_in := array_append(used_in, 'Produccion'); end if;

  select count(*) into relation_count from public.production_consumptions where inventory_item_id = p_item_id;
  if relation_count > 0 then used_in := array_append(used_in, 'Produccion'); end if;

  select count(*) into relation_count from public.pizza_flavor_ingredients where inventory_item_id = p_item_id;
  if relation_count > 0 then used_in := array_append(used_in, 'Recetas'); end if;

  select count(*) into relation_count from public.pizza_price_components where inventory_item_id = p_item_id;
  if relation_count > 0 then used_in := array_append(used_in, 'Recetas'); end if;

  select count(*) into relation_count from public.pizza_additions where inventory_item_id = p_item_id;
  if relation_count > 0 then used_in := array_append(used_in, 'Adiciones'); end if;

  select count(*) into relation_count from public.pos_order_items where inventory_item_id = p_item_id;
  if relation_count > 0 then used_in := array_append(used_in, 'Pedidos'); end if;

  select count(*) into relation_count from public.pos_order_consumptions where inventory_item_id = p_item_id;
  if relation_count > 0 then used_in := array_append(used_in, 'Pedidos'); end if;

  if item_row.presentation_quantity is null then
    select count(*) into relation_count
    from public.inventory_items refs
    where refs.id <> p_item_id
      and refs.item_kind = item_row.item_kind
      and refs.presentation_quantity is not null
      and upper(refs.name) = upper(item_row.name);
    if relation_count > 0 then used_in := array_append(used_in, 'Referencias comerciales'); end if;
  end if;

  return array(select distinct value from unnest(used_in) as value order by value);
end;
$$;

notify pgrst, 'reload schema';
