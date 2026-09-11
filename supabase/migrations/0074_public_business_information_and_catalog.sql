alter table public.site_settings
  add column if not exists public_address text,
  add column if not exists public_neighborhood text,
  add column if not exists public_city text,
  add column if not exists public_phone text,
  add column if not exists public_weekday_hours text,
  add column if not exists public_weekend_hours text,
  add column if not exists public_maps_url text,
  add column if not exists public_info_text text;

update public.site_settings
set whatsapp_number = '573170135775',
    public_phone = coalesce(nullif(public_phone, ''), '+57 317 0135775'),
    public_maps_url = coalesce(nullif(public_maps_url, ''), 'https://maps.app.goo.gl/hbnKQpowDC5RZbsh8')
where id = true
  and (whatsapp_number = '573001234567' or public_phone is null or public_maps_url is null);

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
    select
      price.id,
      price.flavor_id,
      flavor.name as flavor_name,
      flavor.commercial_description,
      flavor.image_url,
      flavor.allows_half_and_half,
      flavor.menu_category_id as category_id,
      coalesce(category.name, 'Pizzas') as category_name,
      price.size_id,
      size.name as size_name,
      size.diameter_cm,
      size.slices_count,
      size.sort_order,
      price.sale_price_cop,
      true as available,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'source_kind', ingredient.source_kind,
          'source_id', coalesce(ingredient.inventory_item_id, ingredient.source_preparation_id),
          'name', coalesce(item.name, preparation.name)
        ) order by coalesce(item.name, preparation.name))
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
    select product.*,
      coalesce(public.get_pos_order_stock_shortages_internal(jsonb_build_array(jsonb_build_object(
        'kind', 'sale_product', 'id', product.id, 'quantity', 1, 'unit_price_cop', product.sale_price_cop
      ))), '[]'::jsonb) = '[]'::jsonb as available
    from sellable_products product
  )
  select jsonb_build_object(
    'pizzas', coalesce((select jsonb_agg(to_jsonb(pizzas) order by category_name, flavor_name, sort_order) from pizzas), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(to_jsonb(products) order by name, presentation_quantity) from products where available), '[]'::jsonb),
    'additions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', addition.id,
        'name', addition.name,
        'image_url', coalesce(item.image_url, preparation.image_url),
        'size_id', size.pizza_size_id,
        'price_cop', size.price_cop,
        'max_allowed', addition.max_allowed,
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
        'id', promotion.id, 'name', promotion.name, 'image_url', promotion.image_url,
        'main_text', promotion.main_text, 'secondary_text', promotion.secondary_text,
        'normal_price_cop', promotion.normal_price_cop, 'promo_price_cop', promotion.promo_price_cop
      ) order by promotion.created_at desc)
      from public.marketing_promotions promotion
      where promotion.is_active
        and promotion.status = 'active'
        and (promotion.starts_at is null or promotion.starts_at <= current_date)
        and (promotion.ends_at is null or promotion.ends_at >= current_date)
    ), '[]'::jsonb),
    'business', (
      select jsonb_build_object(
        'business_name', settings.business_name,
        'phone', coalesce(nullif(settings.public_phone, ''), settings.whatsapp_number),
        'whatsapp_number', settings.whatsapp_number,
        'address', settings.public_address,
        'neighborhood', settings.public_neighborhood,
        'city', settings.public_city,
        'weekday_hours', settings.public_weekday_hours,
        'weekend_hours', settings.public_weekend_hours,
        'maps_url', settings.public_maps_url,
        'info_text', settings.public_info_text
      ) from public.site_settings settings where settings.id = true
    )
  ) into result;

  return result;
end;
$$;

notify pgrst, 'reload schema';
