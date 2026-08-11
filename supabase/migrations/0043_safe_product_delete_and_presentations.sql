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

create or replace function public.delete_inventory_item_safely(p_item_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  used_in text[];
begin
  if not app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]) then
    raise exception 'No tienes permisos para eliminar productos.';
  end if;

  used_in := public.inventory_item_relation_summary(p_item_id);

  if array_length(used_in, 1) is not null then
    return jsonb_build_object(
      'deleted', false,
      'used_in', used_in,
      'message', 'No se puede eliminar este producto porque esta siendo utilizado en: ' || array_to_string(used_in, ', ') || '. Puedes desactivarlo.'
    );
  end if;

  delete from public.inventory_items where id = p_item_id;
  if not found then
    raise exception 'Producto no encontrado.';
  end if;

  return jsonb_build_object('deleted', true, 'used_in', array[]::text[], 'message', 'Producto eliminado correctamente.');
end;
$$;

grant execute on function public.inventory_item_relation_summary(uuid) to authenticated;
grant execute on function public.delete_inventory_item_safely(uuid) to authenticated;

with references_to_fix as (
  select refs.id, master.unit
  from public.inventory_items refs
  join public.inventory_items master
    on master.id <> refs.id
   and master.presentation_quantity is null
   and master.item_kind = refs.item_kind
   and upper(master.name) = upper(refs.name)
  where refs.presentation_quantity is not null
    and refs.presentation_unit = 'unit'
    and master.unit in ('g', 'kg', 'ml', 'l')
    and refs.item_kind in ('sale_product', 'supply')
)
update public.inventory_items refs
set presentation_unit = references_to_fix.unit
from references_to_fix
where refs.id = references_to_fix.id;

update public.purchase_items pi
set presentation_unit = ii.presentation_unit
from public.inventory_items ii
where pi.inventory_item_id = ii.id
  and pi.presentation_quantity is not null
  and pi.presentation_unit = 'unit'
  and ii.presentation_unit in ('g', 'kg', 'ml', 'l')
  and ii.item_kind in ('sale_product', 'supply');

notify pgrst, 'reload schema';
