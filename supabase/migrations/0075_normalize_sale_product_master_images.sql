create or replace function public.get_pos_sale_product_catalog()
returns table(
  id uuid,
  sku text,
  name text,
  image_url text,
  presentation_quantity numeric,
  presentation_unit public.stock_unit,
  sale_price_cop numeric,
  sale_is_enabled boolean,
  unit public.stock_unit,
  stock_base numeric,
  unit_cost_cop numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.current_user_can_access_module('pedidos') then
    raise exception 'No tienes acceso al catalogo de pedidos.';
  end if;

  return query
  with sellable_references as (
    select refs.id, refs.sku, refs.name, coalesce(master.image_url, refs.image_url) as image_url,
      refs.presentation_quantity, refs.presentation_unit, refs.sale_price_cop, refs.sale_is_enabled, refs.unit
    from public.inventory_items refs
    join public.inventory_items master
      on master.item_kind = 'sale_product'
      and master.presentation_quantity is null
      and master.is_active
      and regexp_replace(upper(master.name), '[^A-Z0-9]+', '', 'g') = regexp_replace(upper(refs.name), '[^A-Z0-9]+', '', 'g')
    where refs.item_kind = 'sale_product'
      and refs.presentation_quantity is not null
      and refs.presentation_unit is not null
      and refs.is_active
      and refs.sale_is_enabled
      and refs.sale_price_cop > 0
      and exists (select 1 from public.purchase_items purchase_line where purchase_line.inventory_item_id = refs.id)
  ), purchase_balances as (
    select purchase_line.id, purchase_line.inventory_item_id,
      greatest(0, purchase_line.quantity
        - coalesce((select sum(allocation.quantity_base) from public.production_consumption_allocations allocation where allocation.purchase_item_id = purchase_line.id), 0)
        - coalesce((select sum(allocation.quantity_base)
            from public.pos_order_consumption_allocations allocation
            join public.pos_order_consumptions consumption on consumption.id = allocation.consumption_id
            join public.pos_orders sale_order on sale_order.id = consumption.order_id
            where allocation.purchase_item_id = purchase_line.id and sale_order.status <> 'cancelled'), 0)
      ) as available_quantity,
      purchase_line.quantity as initial_quantity, purchase_line.line_total_cop
    from public.purchase_items purchase_line
    join sellable_references reference on reference.id = purchase_line.inventory_item_id
  ), availability as (
    select inventory_item_id, sum(available_quantity) as stock_base,
      case when sum(available_quantity) > 0
        then sum((line_total_cop / nullif(initial_quantity, 0)) * available_quantity) / sum(available_quantity)
        else null end as unit_cost_cop
    from purchase_balances
    group by inventory_item_id
  )
  select reference.id, reference.sku, reference.name, reference.image_url, reference.presentation_quantity,
    reference.presentation_unit, reference.sale_price_cop, reference.sale_is_enabled, reference.unit,
    coalesce(availability.stock_base, 0), availability.unit_cost_cop
  from sellable_references reference
  left join availability on availability.inventory_item_id = reference.id
  order by reference.name, reference.presentation_quantity;
end;
$$;

create or replace function public.get_public_menu_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  with pizzas as (
    select price.id, price.flavor_id, flavor.name as flavor_name, flavor.commercial_description, flavor.image_url,
      flavor.allows_half_and_half, flavor.menu_category_id as category_id, coalesce(category.name, 'Pizzas') as category_name,
      price.size_id, size.name as size_name, size.diameter_cm, size.slices_count, size.sort_order, price.sale_price_cop,
      true as available,
      coalesce((
        select jsonb_agg(jsonb_build_object('source_kind', ingredient.source_kind, 'source_id', coalesce(ingredient.inventory_item_id, ingredient.source_preparation_id), 'name', coalesce(item.name, preparation.name)) order by coalesce(item.name, preparation.name))
        from public.pizza_flavor_ingredients ingredient
        left join public.inventory_items item on item.id = ingredient.inventory_item_id
        left join public.preparations preparation on preparation.id = ingredient.source_preparation_id
        where ingredient.flavor_id = flavor.id
      ), '[]'::jsonb) as ingredients
    from public.pizza_price_configs price
    join public.pizza_flavors flavor on flavor.id = price.flavor_id and flavor.is_active
    join public.pizza_sizes size on size.id = price.size_id and size.is_active
    left join public.menu_categories category on category.id = flavor.menu_category_id
    where price.is_active and price.sale_price_cop > 0
  ), sellable_products as (
    select refs.id, refs.name, coalesce(master.image_url, refs.image_url) as image_url,
      refs.presentation_quantity, refs.presentation_unit, refs.sale_price_cop
    from public.inventory_items refs
    join public.inventory_items master
      on master.item_kind = 'sale_product'
      and master.presentation_quantity is null
      and master.is_active
      and regexp_replace(upper(master.name), '[^A-Z0-9]+', '', 'g') = regexp_replace(upper(refs.name), '[^A-Z0-9]+', '', 'g')
    where refs.item_kind = 'sale_product'
      and refs.presentation_quantity is not null
      and refs.presentation_unit is not null
      and refs.is_active
      and refs.sale_is_enabled
      and refs.sale_price_cop > 0
      and exists (select 1 from public.purchase_items purchase_line where purchase_line.inventory_item_id = refs.id)
  ), products as (
    select product.*, coalesce(public.get_pos_order_stock_shortages_internal(jsonb_build_array(jsonb_build_object(
      'kind', 'sale_product', 'id', product.id, 'quantity', 1, 'unit_price_cop', product.sale_price_cop
    ))), '[]'::jsonb) = '[]'::jsonb as available
    from sellable_products product
  )
  select jsonb_build_object(
    'pizzas', coalesce((select jsonb_agg(to_jsonb(pizzas) order by category_name, flavor_name, sort_order) from pizzas), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(to_jsonb(products) order by name, presentation_quantity) from products where available), '[]'::jsonb),
    'additions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', addition.id, 'name', addition.name, 'image_url', coalesce(item.image_url, preparation.image_url),
        'size_id', size.pizza_size_id, 'price_cop', size.price_cop, 'max_allowed', addition.max_allowed,
        'flavor_ids', coalesce((select jsonb_agg(flavor_id) from public.pizza_addition_flavors where addition_id = addition.id), '[]'::jsonb),
        'category_ids', coalesce((select jsonb_agg(menu_category_id) from public.pizza_addition_categories where addition_id = addition.id), '[]'::jsonb)
      ) order by addition.name, size.price_cop)
      from public.pizza_additions addition
      join public.pizza_addition_sizes size on size.addition_id = addition.id
      left join public.inventory_items item on item.id = addition.inventory_item_id
      left join public.preparations preparation on preparation.id = addition.source_preparation_id
      where addition.is_active and addition.is_available
    ), '[]'::jsonb),
    'promotions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', promotion.id, 'name', promotion.name, 'image_url', promotion.image_url, 'main_text', promotion.main_text,
        'secondary_text', promotion.secondary_text, 'normal_price_cop', promotion.normal_price_cop, 'promo_price_cop', promotion.promo_price_cop
      ) order by promotion.created_at desc)
      from public.marketing_promotions promotion
      where promotion.is_active and promotion.status = 'active'
        and (promotion.starts_at is null or promotion.starts_at <= current_date)
        and (promotion.ends_at is null or promotion.ends_at >= current_date)
    ), '[]'::jsonb),
    'business', (
      select jsonb_build_object(
        'business_name', settings.business_name, 'phone', coalesce(nullif(settings.public_phone, ''), settings.whatsapp_number),
        'whatsapp_number', settings.whatsapp_number, 'address', settings.public_address, 'neighborhood', settings.public_neighborhood,
        'city', settings.public_city, 'weekday_hours', settings.public_weekday_hours, 'weekend_hours', settings.public_weekend_hours,
        'maps_url', settings.public_maps_url, 'info_text', settings.public_info_text
      ) from public.site_settings settings where settings.id = true
    )
  ) into result;
  return result;
end;
$$;

notify pgrst, 'reload schema';
