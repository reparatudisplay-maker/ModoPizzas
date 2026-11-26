begin;

-- Shared, read-only projection for any active menu family. It intentionally
-- does not create orders or consume stock: those writers remain protected
-- until the POS integration migration is explicitly authorized.
create or replace view public.menu_family_catalog_readiness
with (security_invoker = true)
as
with item_state as (
  select
    item.family_id,
    item.id as family_item_id,
    item.name,
    exists (
      select 1 from public.menu_family_prices price
      where price.family_item_id = item.id
        and price.is_active
        and price.valid_until is null
    ) as has_current_price,
    exists (
      select 1 from public.menu_family_recipe_components component
      where component.family_item_id = item.id
    ) as has_recipe
  from public.menu_family_items item
  where item.is_active
), combo_state as (
  select
    combo.family_id,
    combo.id as combo_id,
    combo.name,
    exists (
      select 1 from public.menu_family_combo_variants variant
      where variant.combo_id = combo.id
        and variant.is_active
        and exists (
          select 1 from public.menu_family_combo_components component
          where component.variant_id = variant.id
        )
    ) as has_sellable_variant
  from public.menu_family_combos combo
  where combo.is_active
)
select
  family.id as family_id,
  family.slug,
  family.name as family_name,
  family.is_active,
  (select count(*)::integer from item_state where item_state.family_id = family.id) as active_item_count,
  (select count(*)::integer from item_state where item_state.family_id = family.id and item_state.has_current_price and item_state.has_recipe) as ready_item_count,
  coalesce((select array_agg(item_state.name order by item_state.name) from item_state where item_state.family_id = family.id and (not item_state.has_current_price or not item_state.has_recipe)), '{}'::text[]) as incomplete_item_names,
  (select count(*)::integer from combo_state where combo_state.family_id = family.id) as active_combo_count,
  coalesce((select array_agg(combo_state.name order by combo_state.name) from combo_state where combo_state.family_id = family.id and not combo_state.has_sellable_variant), '{}'::text[]) as incomplete_combo_names,
  family.is_active
    and exists (select 1 from item_state where item_state.family_id = family.id)
    and not exists (select 1 from item_state where item_state.family_id = family.id and (not item_state.has_current_price or not item_state.has_recipe))
    and not exists (select 1 from combo_state where combo_state.family_id = family.id and not combo_state.has_sellable_variant) as is_ready
from public.menu_families family;

create or replace function public.get_active_menu_family_catalog()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(entry order by entry->>'family_name', entry->>'name'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'family_id', catalog.family_id,
      'family_name', catalog.family_name,
      'family_slug', catalog.family_slug,
      'family_item_id', catalog.family_item_id,
      'sku', catalog.sku,
      'name', catalog.name,
      'description', catalog.commercial_description,
      'image_url', catalog.image_url,
      'presentation_id', catalog.presentation_id,
      'presentation_name', catalog.presentation_name,
      'price_id', catalog.price_id,
      'sale_price_cop', catalog.sale_price_cop
    ) as entry
    from public.menu_family_active_catalog catalog
    join public.menu_family_catalog_readiness readiness on readiness.family_id = catalog.family_id
    where readiness.is_ready
  ) entries;
$$;

revoke all on function public.get_active_menu_family_catalog() from public;
grant execute on function public.get_active_menu_family_catalog() to anon, authenticated;

notify pgrst, 'reload schema';
commit;
