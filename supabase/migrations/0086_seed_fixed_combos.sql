-- Seed aditivo de los tres tipos comerciales de combo.
-- No crea inventario, recetas ni referencias de productos.
do $$
declare
  combo_row record;
  v_combo_id uuid;
  v_variant_id uuid;
  v_group_id uuid;
  v_product_id uuid;
  v_size_large uuid;
  v_size_personal uuid;
  v_size_medium uuid;
  v_flavor_id uuid;
  v_flavor_name text;
  v_group_names text[];
  v_group_price numeric;
  v_pizza_sizes uuid[];
  v_variant_index integer;
  v_component_index integer;
begin
  select id into v_size_large
  from public.pizza_sizes
  where upper(name) like '%40CM%' or upper(sku) like '%40CM%'
  order by sort_order
  limit 1;

  select id into v_size_personal
  from public.pizza_sizes
  where upper(name) like '%25CM%' or upper(sku) like '%25CM%'
  order by sort_order
  limit 1;

  select id into v_size_medium
  from public.pizza_sizes
  where upper(name) like '%35CM%' or upper(sku) like '%35CM%'
  order by sort_order
  limit 1;

  select refs.id into v_product_id
  from public.inventory_items refs
  where refs.item_kind = 'sale_product'
    and (
      (refs.presentation_quantity = 1.5 and refs.presentation_unit = 'l'::public.stock_unit)
      or (refs.presentation_quantity = 1500 and refs.presentation_unit = 'ml'::public.stock_unit)
      or upper(coalesce(refs.sku, '')) like '%1500%'
    )
    and upper(refs.name) like '%COCA%COLA%'
    and refs.is_active
  order by refs.sale_is_enabled desc, refs.created_at
  limit 1;

  if v_size_large is null or v_size_personal is null or v_size_medium is null or v_product_id is null then
    raise exception 'No se pudieron resolver tamanos 40CM/25CM/35CM o Coca-Cola 1.5 L para configurar combos.';
  end if;

  for combo_row in
    select * from (values
      ('CMBGRAN', 'COMBO GRANDE', '1 pizza grande de 40CM + Coca-Cola 1.5 L', 55900::numeric, 1),
      ('CMBFAM', 'COMBO FAMILIAR', '1 pizza grande de 40CM + 1 pizza personal de 25CM + Coca-Cola 1.5 L', 77900::numeric, 2),
      ('CMB2MED', 'COMBO 2 MEDIANAS', '2 pizzas medianas de 35CM + Coca-Cola 1.5 L', 81900::numeric, 3)
    ) as combos(sku, name, description, min_price, kind_index)
  loop
    insert into public.combo_configs (sku, name, description, sale_price_cop, is_active, sort_order)
    values (combo_row.sku, combo_row.name, combo_row.description, combo_row.min_price, true, combo_row.kind_index)
    on conflict (sku) do update set
      name = excluded.name,
      description = excluded.description,
      sale_price_cop = excluded.sale_price_cop,
      is_active = true,
      sort_order = excluded.sort_order;

    select id into v_combo_id
    from public.combo_configs
    where sku = combo_row.sku;

    for v_variant_index, v_group_names, v_group_price in
      select * from (values
        (1, array['JAMÓN','HAWAIANA']::text[], case combo_row.kind_index when 1 then 55900 when 2 then 77900 else 81900 end::numeric),
        (2, array['TOCINETA','POLLO CON CHAMPIÑONES','VEGETARIANA']::text[], case combo_row.kind_index when 1 then 60900 when 2 then 84900 else 89900 end::numeric),
        (3, array['PEPPERONI','CARNES','SUPREMA']::text[], case combo_row.kind_index when 1 then 68900 when 2 then 95900 else 99900 end::numeric)
      ) as variants(position, names, price)
    loop
      select id into v_variant_id
      from public.combo_variants
      where combo_config_id = v_combo_id
        and sort_order = v_variant_index
      order by created_at, id
      limit 1;

      if v_variant_id is null then
        insert into public.combo_variants (combo_config_id, name, sale_price_cop, sort_order, is_active)
        values (v_combo_id, 'GRUPO ' || v_variant_index, v_group_price, v_variant_index, true)
        returning id into v_variant_id;
      else
        update public.combo_variants
        set name = 'GRUPO ' || v_variant_index,
            sale_price_cop = v_group_price,
            is_active = true
        where id = v_variant_id;
      end if;

      if v_variant_id is null then
        select id into v_variant_id
        from public.combo_variants
        where combo_config_id = v_combo_id
          and sort_order = v_variant_index;
      end if;

      v_pizza_sizes := case combo_row.kind_index
        when 1 then array[v_size_large]
        when 2 then array[v_size_large, v_size_personal]
        else array[v_size_medium, v_size_medium]
      end;

      for v_component_index in 1..array_length(v_pizza_sizes, 1) loop
        select id into v_group_id
        from public.combo_groups
        where variant_id = v_variant_id
          and name = 'PIZZA ' || v_component_index
        order by sort_order, created_at
        limit 1;

        if v_group_id is null then
          insert into public.combo_groups (
            combo_id, variant_id, name, group_kind, quantity_to_choose,
            is_required, pizza_size_id, sort_order
          )
          values (
            v_combo_id, v_variant_id, 'PIZZA ' || v_component_index,
            'pizza', 1, true, v_pizza_sizes[v_component_index], v_component_index
          )
          returning id into v_group_id;
        end if;

        foreach v_flavor_name in array v_group_names loop
          select id into v_flavor_id
          from public.pizza_flavors
          where upper(name) = upper(v_flavor_name)
            and is_active
          limit 1;

          if v_flavor_id is not null and not exists (
            select 1
            from public.combo_group_options o
            where o.group_id = v_group_id
              and o.pizza_flavor_id = v_flavor_id
          ) then
            insert into public.combo_group_options (group_id, pizza_flavor_id, is_active, sort_order)
            values (v_group_id, v_flavor_id, true, 0);
          end if;
        end loop;
      end loop;

      select id into v_group_id
      from public.combo_groups
      where variant_id = v_variant_id
        and name = 'BEBIDA INCLUIDA'
      order by sort_order, created_at
      limit 1;

      if v_group_id is null then
        insert into public.combo_groups (
          combo_id, variant_id, name, group_kind, quantity_to_choose,
          is_required, sort_order
        )
        values (
          v_combo_id, v_variant_id, 'BEBIDA INCLUIDA',
          'sale_product', 1, true, 99
        )
        returning id into v_group_id;
      end if;

      if not exists (
        select 1
        from public.combo_group_options o
        where o.group_id = v_group_id
          and o.inventory_item_id = v_product_id
      ) then
        insert into public.combo_group_options (group_id, inventory_item_id, is_active, sort_order)
        values (v_group_id, v_product_id, true, 0);
      end if;
    end loop;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
