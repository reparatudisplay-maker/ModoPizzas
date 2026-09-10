create table if not exists public.pizza_size_base_sources (
  id uuid primary key default gen_random_uuid(),
  pizza_size_id uuid not null references public.pizza_sizes(id) on delete restrict,
  source_kind text not null check (source_kind in ('inventory_item', 'preparation')),
  inventory_item_id uuid references public.inventory_items(id) on delete restrict,
  source_preparation_id uuid references public.preparations(id) on delete restrict,
  quantity_base numeric(14, 3) not null check (quantity_base > 0),
  unit public.stock_unit not null,
  display_quantity numeric(14, 3) not null check (display_quantity > 0),
  display_unit public.stock_unit not null,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pizza_size_base_sources_unique_size unique (pizza_size_id),
  constraint pizza_size_base_sources_exact_source check (
    (source_kind = 'inventory_item' and inventory_item_id is not null and source_preparation_id is null)
    or
    (source_kind = 'preparation' and source_preparation_id is not null and inventory_item_id is null)
  )
);

create index if not exists pizza_size_base_sources_inventory_idx
  on public.pizza_size_base_sources(inventory_item_id)
  where source_kind = 'inventory_item';

create index if not exists pizza_size_base_sources_preparation_idx
  on public.pizza_size_base_sources(source_preparation_id)
  where source_kind = 'preparation';

alter table public.pizza_size_base_sources enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pizza_size_base_sources' and policyname = 'Staff can read pizza size base sources'
  ) then
    create policy "Staff can read pizza size base sources"
      on public.pizza_size_base_sources
      for select
      to authenticated
      using (app_private.has_any_role(array['vendedor'::public.app_role, 'mesero'::public.app_role, 'gerente'::public.app_role, 'admin_sistema'::public.app_role]));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pizza_size_base_sources' and policyname = 'Managers can manage pizza size base sources'
  ) then
    create policy "Managers can manage pizza size base sources"
      on public.pizza_size_base_sources
      for all
      to authenticated
      using (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]))
      with check (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]));
  end if;
end $$;

update public.inventory_items
set item_kind = 'ingredient'
where item_kind = 'supply'
  and unit = 'unit'
  and presentation_quantity is null
  and regexp_replace(extensions.unaccent(upper(coalesce(name, ''))), '[^A-Z0-9]', '', 'g') = 'BASEMASA40CM';

insert into public.pizza_size_base_sources (
  pizza_size_id, source_kind, inventory_item_id, source_preparation_id,
  quantity_base, unit, display_quantity, display_unit, created_by, updated_by
)
select distinct on (ps.id)
  ps.id,
  'inventory_item',
  ii.id,
  null::uuid,
  1,
  'unit'::public.stock_unit,
  1,
  'unit'::public.stock_unit,
  null::uuid,
  null::uuid
from public.pizza_sizes ps
join public.inventory_items ii
  on ii.item_kind = 'ingredient'
  and ii.unit = 'unit'
  and ii.presentation_quantity is null
  and ii.is_active = true
cross join lateral (
  select
    regexp_replace(extensions.unaccent(upper(coalesce(ps.name, ''))), '[^A-Z0-9]', '', 'g') as size_name_key,
    regexp_replace(extensions.unaccent(upper(coalesce(ii.name, ''))), '[^A-Z0-9]', '', 'g') as item_name_key,
    round(ps.diameter_cm)::int::text || 'CM' as diameter_key
) keys
where keys.item_name_key like '%BASE%'
  and keys.item_name_key like '%MASA%'
  and (keys.item_name_key like '%' || keys.diameter_key || '%' or keys.item_name_key like '%' || keys.size_name_key || '%')
order by ps.id, ii.name
on conflict (pizza_size_id) do update
set source_kind = excluded.source_kind,
    inventory_item_id = excluded.inventory_item_id,
    source_preparation_id = excluded.source_preparation_id,
    quantity_base = excluded.quantity_base,
    unit = excluded.unit,
    display_quantity = excluded.display_quantity,
    display_unit = excluded.display_unit,
    is_active = true,
    updated_at = now();

delete from public.pizza_price_components pc
using public.pizza_price_configs ppc, public.preparations pr, public.pizza_size_base_sources pbs
where pc.price_config_id = ppc.id
  and pbs.pizza_size_id = ppc.size_id
  and pc.source_kind = 'preparation'
  and pc.source_preparation_id = pr.id
  and regexp_replace(extensions.unaccent(upper(coalesce(pr.name, ''))), '[^A-Z0-9]', '', 'g') like 'MASA%';

delete from public.pizza_price_components pc
using public.pizza_price_configs ppc, public.inventory_items ii, public.pizza_size_base_sources pbs
where pc.price_config_id = ppc.id
  and pbs.pizza_size_id = ppc.size_id
  and pc.source_kind = 'inventory_item'
  and pc.inventory_item_id = ii.id
  and regexp_replace(extensions.unaccent(upper(coalesce(ii.name, ''))), '[^A-Z0-9]', '', 'g') like 'BASE%MASA%';

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

  select count(*) into relation_count from public.pizza_size_base_sources where inventory_item_id = p_item_id;
  if relation_count > 0 then used_in := array_append(used_in, 'Bases por tamano'); end if;

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

create or replace function public.create_pos_order(
  p_kind text,
  p_customer_name text,
  p_customer_phone text,
  p_discount_cop numeric,
  p_delivery_cop numeric,
  p_payment_method text,
  p_notes text,
  p_items jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  counter_row record;
  next_number bigint;
  new_order_id uuid := gen_random_uuid();
  new_code text;
  item jsonb;
  addition jsonb;
  item_kind_value text;
  item_id uuid;
  secondary_item_id uuid;
  item_quantity integer;
  addition_quantity integer;
  addition_scope text;
  addition_scope_label text;
  line_price numeric;
  item_subtotal numeric;
  item_cost numeric;
  subtotal_value numeric := 0;
  total_value numeric := 0;
  inserted_item_id uuid;
  inserted_addition_id uuid;
  pizza_row record;
  second_pizza_row record;
  pizza_base_row record;
  pizza_component record;
  addition_row record;
  addition_size_row record;
  sale_product_row record;
  consumption_quantity numeric;
  component_multiplier numeric;
  source_id_value uuid;
  source_unit_value public.stock_unit;
  item_name_snapshot text;
  item_sku_snapshot text;
  item_notes text;
begin
  if not app_private.has_any_role(array['vendedor'::public.app_role, 'mesero'::public.app_role, 'gerente'::public.app_role, 'admin_sistema'::public.app_role]) then
    raise exception 'No tienes permisos para crear pedidos.';
  end if;

  if p_kind not in ('local', 'pickup', 'delivery') then
    raise exception 'Tipo de pedido no valido.';
  end if;
  if p_payment_method not in ('cash', 'card', 'transfer', 'mixed', 'pending') then
    raise exception 'Forma de pago no valida.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido necesita al menos un producto.';
  end if;

  select * into counter_row
  from public.pos_order_counters
  where id = true
  for update;

  next_number := counter_row.last_number + 1;
  new_code := 'PD' || next_number::text;

  update public.pos_order_counters
  set last_number = next_number
  where id = true;

  insert into public.pos_orders (
    id, order_number, code, kind, status, customer_name, customer_phone, discount_cop,
    delivery_cop, payment_method, notes, created_by
  )
  values (
    new_order_id, next_number, new_code, p_kind, 'confirmed', nullif(btrim(p_customer_name), ''),
    nullif(btrim(p_customer_phone), ''), coalesce(p_discount_cop, 0), coalesce(p_delivery_cop, 0),
    p_payment_method, nullif(btrim(p_notes), ''), auth.uid()
  );

  for item in select * from jsonb_array_elements(p_items)
  loop
    item_kind_value := item->>'kind';
    item_id := (item->>'id')::uuid;
    secondary_item_id := null;
    if nullif(item->>'secondary_id', '') is not null then
      secondary_item_id := (item->>'secondary_id')::uuid;
    end if;
    item_notes := nullif(btrim(coalesce(item->>'notes', '')), '');
    item_quantity := greatest(1, coalesce((item->>'quantity')::integer, 1));
    item_cost := 0;

    if item_kind_value = 'pizza' then
      select
        ppc.id,
        ppc.sku,
        ppc.sale_price_cop,
        ppc.size_id,
        pf.id as flavor_id,
        pf.name as flavor_name,
        pf.menu_category_id,
        pf.allows_half_and_half,
        ps.name as size_name
      into pizza_row
      from public.pizza_price_configs ppc
      join public.pizza_flavors pf on pf.id = ppc.flavor_id
      join public.pizza_sizes ps on ps.id = ppc.size_id
      where ppc.id = item_id
        and ppc.is_active = true
        and pf.is_active = true
        and ps.is_active = true;

      if not found then
        raise exception 'Pizza no disponible.';
      end if;

      second_pizza_row := null;
      if secondary_item_id is not null then
        if secondary_item_id = item_id then
          raise exception 'Selecciona dos sabores diferentes para mitad y mitad.';
        end if;
        if not pizza_row.allows_half_and_half then
          raise exception 'Esta pizza no permite mitad y mitad.';
        end if;

        select
          ppc.id,
          ppc.sku,
          ppc.sale_price_cop,
          ppc.size_id,
          pf.id as flavor_id,
          pf.name as flavor_name,
          pf.menu_category_id,
          pf.allows_half_and_half,
          ps.name as size_name
        into second_pizza_row
        from public.pizza_price_configs ppc
        join public.pizza_flavors pf on pf.id = ppc.flavor_id
        join public.pizza_sizes ps on ps.id = ppc.size_id
        where ppc.id = secondary_item_id
          and ppc.size_id = pizza_row.size_id
          and ppc.is_active = true
          and pf.is_active = true
          and ps.is_active = true
          and pf.allows_half_and_half = true;

        if not found then
          raise exception 'El segundo sabor no esta disponible para mitad y mitad.';
        end if;
      end if;

      if secondary_item_id is not null then
        line_price := greatest(pizza_row.sale_price_cop, second_pizza_row.sale_price_cop);
        item_name_snapshot := pizza_row.flavor_name || ' / ' || second_pizza_row.flavor_name || ' ' || pizza_row.size_name;
        item_sku_snapshot := case when second_pizza_row.sale_price_cop > pizza_row.sale_price_cop then second_pizza_row.sku else pizza_row.sku end;
        component_multiplier := 0.5;
      else
        line_price := pizza_row.sale_price_cop;
        item_name_snapshot := pizza_row.flavor_name || ' ' || pizza_row.size_name;
        item_sku_snapshot := pizza_row.sku;
        component_multiplier := 1;
      end if;

      item_subtotal := round(line_price * item_quantity, 2);
      subtotal_value := subtotal_value + item_subtotal;

      insert into public.pos_order_items (
        order_id, item_kind, pizza_price_config_id, quantity, product_name_snapshot,
        sku_snapshot, unit_price_cop, line_subtotal_cop, line_cost_cop, notes
      )
      values (
        new_order_id, 'pizza', item_id, item_quantity, item_name_snapshot,
        item_sku_snapshot, line_price, item_subtotal, 0, item_notes
      )
      returning id into inserted_item_id;

      select
        pbs.source_kind,
        pbs.inventory_item_id,
        pbs.source_preparation_id,
        pbs.quantity_base,
        pbs.unit
      into pizza_base_row
      from public.pizza_size_base_sources pbs
      left join public.inventory_items ii
        on ii.id = pbs.inventory_item_id
        and pbs.source_kind = 'inventory_item'
      left join public.preparations pr
        on pr.id = pbs.source_preparation_id
        and pbs.source_kind = 'preparation'
      where pbs.pizza_size_id = pizza_row.size_id
        and pbs.is_active = true
        and (
          (pbs.source_kind = 'inventory_item' and ii.is_active = true and ii.item_kind = 'ingredient')
          or
          (pbs.source_kind = 'preparation' and pr.is_active = true)
        )
      limit 1;

      if not found then
        raise exception 'Configura la base para el tamano % antes de vender pizzas.', pizza_row.size_name;
      end if;

      source_id_value := coalesce(pizza_base_row.inventory_item_id, pizza_base_row.source_preparation_id);
      item_cost := item_cost + public.pos_allocate_consumption(
        new_order_id,
        inserted_item_id,
        null,
        pizza_base_row.source_kind,
        source_id_value,
        pizza_base_row.quantity_base * item_quantity,
        pizza_base_row.unit
      );

      for pizza_component in
        select source_kind, inventory_item_id, source_preparation_id, quantity_base, unit
        from public.pizza_price_components
        where price_config_id = item_id
        union all
        select source_kind, inventory_item_id, source_preparation_id, quantity_base, unit
        from public.pizza_price_components
        where secondary_item_id is not null and price_config_id = secondary_item_id
      loop
        consumption_quantity := pizza_component.quantity_base * item_quantity * component_multiplier;
        source_id_value := coalesce(pizza_component.inventory_item_id, pizza_component.source_preparation_id);
        item_cost := item_cost + public.pos_allocate_consumption(
          new_order_id,
          inserted_item_id,
          null,
          pizza_component.source_kind,
          source_id_value,
          consumption_quantity,
          pizza_component.unit
        );
      end loop;

      for addition in select * from jsonb_array_elements(coalesce(item->'additions', '[]'::jsonb))
      loop
        source_id_value := (addition->>'id')::uuid;
        addition_quantity := greatest(1, coalesce((addition->>'quantity')::integer, 1));
        addition_scope := coalesce(nullif(addition->>'scope', ''), 'whole');
        if addition_scope not in ('whole', 'left', 'right') then
          raise exception 'Alcance de adicion no valido.';
        end if;
        if secondary_item_id is null then
          addition_scope := 'whole';
        end if;
        addition_scope_label := nullif(btrim(coalesce(addition->>'scope_label', '')), '');

        select id, sku, name, source_kind, inventory_item_id, source_preparation_id, is_active, is_available
        into addition_row
        from public.pizza_additions
        where id = source_id_value
          and is_active = true
          and is_available = true;

        if not found then
          raise exception 'Adicion no disponible.';
        end if;

        if exists (select 1 from public.pizza_addition_flavors where addition_id = addition_row.id)
          and not exists (
            select 1 from public.pizza_addition_flavors
            where addition_id = addition_row.id and flavor_id = pizza_row.flavor_id
          ) then
          raise exception 'La adicion no es compatible con este sabor.';
        end if;

        if secondary_item_id is not null
          and exists (select 1 from public.pizza_addition_flavors where addition_id = addition_row.id)
          and not exists (
            select 1 from public.pizza_addition_flavors
            where addition_id = addition_row.id and flavor_id = second_pizza_row.flavor_id
          ) then
          raise exception 'La adicion no es compatible con el segundo sabor.';
        end if;

        if exists (select 1 from public.pizza_addition_categories where addition_id = addition_row.id)
          and (
            pizza_row.menu_category_id is null
            or not exists (
              select 1 from public.pizza_addition_categories
              where addition_id = addition_row.id and menu_category_id = pizza_row.menu_category_id
            )
          ) then
          raise exception 'La adicion no es compatible con esta categoria.';
        end if;

        if secondary_item_id is not null
          and exists (select 1 from public.pizza_addition_categories where addition_id = addition_row.id)
          and (
            second_pizza_row.menu_category_id is null
            or not exists (
              select 1 from public.pizza_addition_categories
              where addition_id = addition_row.id and menu_category_id = second_pizza_row.menu_category_id
            )
          ) then
          raise exception 'La adicion no es compatible con la categoria del segundo sabor.';
        end if;

        select pizza_size_id, quantity_base, unit, price_cop
        into addition_size_row
        from public.pizza_addition_sizes
        where addition_id = addition_row.id
          and pizza_size_id = pizza_row.size_id;

        if not found then
          raise exception 'La adicion no esta configurada para este tamano.';
        end if;

        addition_quantity := addition_quantity * item_quantity;
        item_subtotal := round(addition_size_row.price_cop * addition_quantity, 2);
        subtotal_value := subtotal_value + item_subtotal;

        insert into public.pos_order_item_additions (
          order_item_id, addition_id, quantity, name_snapshot, sku_snapshot, unit_price_cop, line_subtotal_cop, line_cost_cop, scope, scope_label
        )
        values (
          inserted_item_id, addition_row.id, addition_quantity, addition_row.name, addition_row.sku,
          addition_size_row.price_cop, item_subtotal, 0, addition_scope, addition_scope_label
        )
        returning id into inserted_addition_id;

        source_id_value := coalesce(addition_row.inventory_item_id, addition_row.source_preparation_id);
        item_cost := item_cost + public.pos_allocate_consumption(
          new_order_id,
          inserted_item_id,
          inserted_addition_id,
          addition_row.source_kind,
          source_id_value,
          addition_size_row.quantity_base * addition_quantity,
          addition_size_row.unit
        );

        update public.pos_order_item_additions
        set line_cost_cop = (
          select coalesce(sum(cost_cop), 0)
          from public.pos_order_consumptions
          where order_item_addition_id = inserted_addition_id
        )
        where id = inserted_addition_id;
      end loop;

      update public.pos_order_items
      set line_cost_cop = round(item_cost, 2)
      where id = inserted_item_id;

    elsif item_kind_value = 'sale_product' then
      select id, sku, name
      into sale_product_row
      from public.inventory_items
      where id = item_id
        and item_kind = 'sale_product'
        and is_active = true;

      if not found then
        raise exception 'Producto para venta no disponible.';
      end if;

      line_price := greatest(0, coalesce((item->>'unit_price_cop')::numeric, 0));
      item_subtotal := round(line_price * item_quantity, 2);
      subtotal_value := subtotal_value + item_subtotal;

      insert into public.pos_order_items (
        order_id, item_kind, inventory_item_id, quantity, product_name_snapshot,
        sku_snapshot, unit_price_cop, line_subtotal_cop, line_cost_cop, notes
      )
      values (
        new_order_id, 'sale_product', item_id, item_quantity, sale_product_row.name,
        sale_product_row.sku, line_price, item_subtotal, 0, item_notes
      )
      returning id into inserted_item_id;

      source_unit_value := 'unit'::public.stock_unit;
      item_cost := public.pos_allocate_consumption(
        new_order_id,
        inserted_item_id,
        null,
        'inventory_item',
        item_id,
        item_quantity,
        source_unit_value
      );

      update public.pos_order_items
      set line_cost_cop = round(item_cost, 2)
      where id = inserted_item_id;
    else
      raise exception 'Tipo de item no valido.';
    end if;
  end loop;

  total_value := greatest(0, round(subtotal_value - coalesce(p_discount_cop, 0) + coalesce(p_delivery_cop, 0), 2));

  update public.pos_orders
  set subtotal_cop = round(subtotal_value, 2),
      total_cop = total_value,
      updated_at = now()
  where id = new_order_id;

  insert into public.pos_order_status_events (order_id, from_status, to_status, actor_id, notes)
  values (new_order_id, null, 'confirmed', auth.uid(), 'Pedido confirmado desde caja');

  return jsonb_build_object('id', new_order_id, 'code', new_code, 'total_cop', total_value);
end;
$$;

grant execute on function public.inventory_item_relation_summary(uuid) to authenticated;
grant execute on function public.create_pos_order(text, text, text, numeric, numeric, text, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
