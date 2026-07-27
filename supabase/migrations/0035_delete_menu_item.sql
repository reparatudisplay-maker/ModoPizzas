create or replace function public.delete_menu_item(p_section text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  used_count integer;
begin
  if not app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]) then
    raise exception 'No tienes permiso para eliminar registros del menu.';
  end if;

  if p_section = 'menu_categories' then
    select count(*) into used_count from public.pizza_flavors where menu_category_id = p_id;
    if used_count > 0 then
      raise exception 'No se puede eliminar esta categoria porque esta siendo utilizada en Sabores.';
    end if;
    select count(*) into used_count from public.pizza_addition_categories where menu_category_id = p_id;
    if used_count > 0 then
      raise exception 'No se puede eliminar esta categoria porque esta siendo utilizada en Adiciones.';
    end if;
    delete from public.menu_categories where id = p_id;
    perform public.normalize_menu_order('menu_categories');
    return;
  end if;

  if p_section = 'pizza_sizes' then
    select count(*) into used_count from public.pizza_addition_sizes where pizza_size_id = p_id;
    if used_count > 0 then
      raise exception 'No se puede eliminar este tamano porque esta siendo utilizado en Adiciones.';
    end if;
    delete from public.pizza_sizes where id = p_id;
    perform public.normalize_menu_order('pizza_sizes');
    return;
  end if;

  if p_section = 'pizza_flavors' then
    select count(*) into used_count from public.pizza_addition_flavors where flavor_id = p_id;
    if used_count > 0 then
      raise exception 'No se puede eliminar este sabor porque esta siendo utilizado en Adiciones.';
    end if;
    delete from public.pizza_flavor_ingredients where flavor_id = p_id;
    delete from public.pizza_flavors where id = p_id;
    perform public.normalize_menu_order('pizza_flavors');
    return;
  end if;

  if p_section = 'pizza_additions' then
    delete from public.pizza_addition_sizes where addition_id = p_id;
    delete from public.pizza_addition_flavors where addition_id = p_id;
    delete from public.pizza_addition_categories where addition_id = p_id;
    delete from public.pizza_additions where id = p_id;
    perform public.normalize_menu_order('pizza_additions');
    return;
  end if;

  raise exception 'Seccion de menu no valida.';
end;
$$;

grant execute on function public.delete_menu_item(text, uuid) to authenticated;

notify pgrst, 'reload schema';
