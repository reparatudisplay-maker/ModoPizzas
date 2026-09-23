-- Sincroniza el catalogo comercial vigente de combos sin tocar ventas ni snapshots.
-- La configuracion de prueba CMBGRA se conserva para auditoria, pero deja de estar disponible.
do $$
declare
  v_combo_id uuid;
  v_variant_id uuid;
  v_group_id uuid;
  v_coca_id uuid;
  v_flavor_id uuid;
  v_flavor_name text;
  v_variant_order integer;
  v_flavor_names text[];
begin
  update public.combo_configs
  set is_active = false
  where sku = 'CMBGRA'
    and is_active;

  update public.combo_configs
  set is_active = true,
      sort_order = case sku
        when 'CMBGRAN' then 1
        when 'CMBFAM' then 2
        when 'CMB2MED' then 3
        else sort_order
      end
  where sku in ('CMBGRAN', 'CMBFAM', 'CMB2MED');

  select id into v_coca_id
  from public.inventory_items
  where item_kind = 'sale_product'
    and is_active
    and upper(name) like '%COCA%COLA%'
    and (
      (presentation_quantity = 1.5 and presentation_unit = 'l'::public.stock_unit)
      or (presentation_quantity = 1500 and presentation_unit = 'ml'::public.stock_unit)
      or upper(coalesce(sku, '')) like '%1500%'
    )
    and exists (
      select 1
      from public.purchase_items purchase_line
      where purchase_line.inventory_item_id = public.inventory_items.id
    )
  order by sale_is_enabled desc, created_at
  limit 1;

  if v_coca_id is null then
    raise exception 'No se encontro Coca-Cola 1.5 L activa para sincronizar los combos.';
  end if;

  for v_combo_id in
    select id from public.combo_configs where sku in ('CMBGRAN', 'CMBFAM', 'CMB2MED')
  loop
    update public.combo_variants
    set name = case sort_order
        when 1 then 'TRADICIONAL'
        when 2 then 'ESPECIAL'
        when 3 then 'PREMIUM'
        else name
      end,
      is_active = true
    where combo_config_id = v_combo_id
      and sort_order in (1, 2, 3);

    update public.combo_group_options o
    set is_active = false
    from public.combo_groups g
    where o.group_id = g.id
      and g.combo_id = v_combo_id;

    for v_variant_order, v_flavor_names in
      select * from (values
        (1, array['JAMÓN', 'HAWAIANA']::text[]),
        (2, array['TOCINETA', 'POLLO CON CHAMPIÑONES', 'VEGETARIANA']::text[]),
        (3, array['PEPPERONI', 'CARNES', 'SUPREMA']::text[])
      ) as groups(position, names)
    loop
      select id into v_variant_id
      from public.combo_variants
      where combo_config_id = v_combo_id
        and sort_order = v_variant_order;

      if v_variant_id is null then
        raise exception 'Falta variante % para combo %.', v_variant_order, v_combo_id;
      end if;

      for v_group_id in
        select id
        from public.combo_groups
        where variant_id = v_variant_id
          and group_kind = 'pizza'
      loop
        foreach v_flavor_name in array v_flavor_names loop
          select id into v_flavor_id
          from public.pizza_flavors
          where translate(upper(name), 'ÁÉÍÓÚÜ', 'AEIOUU') = translate(upper(v_flavor_name), 'ÁÉÍÓÚÜ', 'AEIOUU')
            and is_active
          limit 1;

          if v_flavor_id is null then
            raise exception 'No se encontro el sabor activo %.', v_flavor_name;
          end if;

          update public.combo_group_options
          set is_active = true
          where group_id = v_group_id
            and pizza_flavor_id = v_flavor_id;

          if not found then
            insert into public.combo_group_options (group_id, pizza_flavor_id, is_active, sort_order)
            values (v_group_id, v_flavor_id, true, 0);
          end if;
        end loop;
      end loop;

      for v_group_id in
        select id
        from public.combo_groups
        where variant_id = v_variant_id
          and group_kind = 'sale_product'
      loop
        update public.combo_group_options
        set is_active = true
        where group_id = v_group_id
          and inventory_item_id = v_coca_id;

        if not found then
          insert into public.combo_group_options (group_id, inventory_item_id, is_active, sort_order)
          values (v_group_id, v_coca_id, true, 0);
        end if;
      end loop;
    end loop;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
