create or replace function public.normalize_menu_order(p_section text)
returns void
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  target_table text;
begin
  if not app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]) then
    raise exception 'No tienes permiso para ordenar el menu.';
  end if;

  target_table := case p_section
    when 'menu_categories' then 'menu_categories'
    when 'pizza_sizes' then 'pizza_sizes'
    when 'pizza_flavors' then 'pizza_flavors'
    when 'pizza_additions' then 'pizza_additions'
    else null
  end;

  if target_table is null then
    raise exception 'Seccion de menu no valida.';
  end if;

  execute format('lock table public.%I in exclusive mode', target_table);
  execute format('update public.%I set sort_order = sort_order + 1000000 where sort_order > 0', target_table);
  execute format($sql$
    with ordered as (
      select id, row_number() over (order by sort_order, created_at, id)::integer as position
      from public.%I
    )
    update public.%I item
    set sort_order = ordered.position, updated_at = now()
    from ordered
    where item.id = ordered.id
  $sql$, target_table, target_table);
end;
$$;

grant execute on function public.normalize_menu_order(text) to authenticated;

notify pgrst, 'reload schema';
