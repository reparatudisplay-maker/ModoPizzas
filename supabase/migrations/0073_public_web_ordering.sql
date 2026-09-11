-- Public catalog. It exposes only customer-facing sellable data; no quantities,
-- inventory cost, internal recipe quantities, or administrative metadata.

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
      coalesce(category.name, 'Pizzas') as category_name,
      price.size_id,
      size.name as size_name,
      size.diameter_cm,
      size.slices_count,
      size.sort_order,
      price.sale_price_cop,
      coalesce(public.get_pos_order_stock_shortages_internal(jsonb_build_array(jsonb_build_object('kind', 'pizza', 'id', price.id, 'quantity', 1))), '[]'::jsonb) = '[]'::jsonb as available,
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
  ), products as (
    select
      item.id, item.name, item.image_url, item.presentation_quantity, item.presentation_unit, item.sale_price_cop,
      coalesce(public.get_pos_order_stock_shortages_internal(jsonb_build_array(jsonb_build_object('kind', 'sale_product', 'id', item.id, 'quantity', 1, 'unit_price_cop', item.sale_price_cop))), '[]'::jsonb) = '[]'::jsonb as available
    from public.inventory_items item
    where item.item_kind = 'sale_product'
      and item.is_active
      and item.sale_is_enabled
      and item.sale_price_cop > 0
      and item.presentation_quantity is not null
      and exists (select 1 from public.purchase_items purchase_line where purchase_line.inventory_item_id = item.id)
  )
  select jsonb_build_object(
    'pizzas', coalesce((select jsonb_agg(to_jsonb(pizzas) order by category_name, flavor_name, sort_order) from pizzas), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(to_jsonb(products) order by name, presentation_quantity) from products), '[]'::jsonb),
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
      select jsonb_agg(jsonb_build_object('id', promotion.id, 'name', promotion.name, 'image_url', promotion.image_url, 'main_text', promotion.main_text, 'secondary_text', promotion.secondary_text, 'normal_price_cop', promotion.normal_price_cop, 'promo_price_cop', promotion.promo_price_cop) order by promotion.created_at desc)
      from public.marketing_promotions promotion
      where promotion.is_active
        and promotion.status = 'active'
        and (promotion.starts_at is null or promotion.starts_at <= current_date)
        and (promotion.ends_at is null or promotion.ends_at >= current_date)
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.get_public_menu_catalog() from public;
grant execute on function public.get_public_menu_catalog() to anon, authenticated;

notify pgrst, 'reload schema';
