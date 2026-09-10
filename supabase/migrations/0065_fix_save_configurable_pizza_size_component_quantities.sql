-- The configured matrix is replaced atomically. Keep a predicate because the
-- database guards against unqualified deletes, including inside RPCs.
create or replace function public.save_pizza_size_component_quantities(p_rows jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if not app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]) then
    raise exception 'No tienes permiso para configurar gramajes por tamano.';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Los gramajes enviados no son validos.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as row(pizza_size_id uuid, source_kind text, source_id uuid, unit public.stock_unit, quantity_base numeric)
    left join public.pizza_sizes size on size.id = row.pizza_size_id and size.is_active
    left join public.inventory_items item on row.source_kind = 'inventory_item' and item.id = row.source_id
    left join public.preparations preparation on row.source_kind = 'preparation' and preparation.id = row.source_id
    where row.pizza_size_id is null
      or row.source_id is null
      or row.source_kind not in ('inventory_item', 'preparation')
      or row.quantity_base is null
      or row.quantity_base < 0
      or size.id is null
      or (row.source_kind = 'inventory_item' and (item.id is null or not item.is_active or item.item_kind <> 'ingredient' or item.presentation_quantity is not null))
      or (row.source_kind = 'preparation' and (preparation.id is null or not preparation.is_active))
      or public.is_reserved_pizza_base_source(row.source_kind, case when row.source_kind = 'inventory_item' then row.source_id else null end, case when row.source_kind = 'preparation' then row.source_id else null end)
  ) then
    raise exception 'Cada gramaje debe usar un ingrediente o preparacion activo que no sea una base comun.';
  end if;

  delete from public.pizza_size_component_quantities
  where pizza_size_id is not null;

  insert into public.pizza_size_component_quantities (
    pizza_size_id, source_kind, inventory_item_id, source_preparation_id, quantity_base, unit, created_by, updated_by
  )
  select
    row.pizza_size_id,
    row.source_kind,
    case when row.source_kind = 'inventory_item' then row.source_id else null end,
    case when row.source_kind = 'preparation' then row.source_id else null end,
    row.quantity_base,
    row.unit,
    current_user_id,
    current_user_id
  from jsonb_to_recordset(p_rows) as row(pizza_size_id uuid, source_kind text, source_id uuid, unit public.stock_unit, quantity_base numeric);

  perform public.sync_pizza_price_components_for_config(config.id)
  from public.pizza_price_configs config;
end;
$$;
