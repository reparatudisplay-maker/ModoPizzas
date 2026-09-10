-- The size base is consumed independently by the sales transaction. Keep it out
-- of editable pizza components so a sale can never allocate it twice.
delete from public.pizza_price_components component
where exists (
    select 1 from public.pizza_size_base_sources base_source
    where (base_source.source_kind = 'inventory_item'
      and component.source_kind = 'inventory_item'
      and component.inventory_item_id = base_source.inventory_item_id)
      or (base_source.source_kind = 'preparation'
        and component.source_kind = 'preparation'
        and component.source_preparation_id = base_source.source_preparation_id)
  )
  or (
    component.source_kind = 'preparation'
    and exists (
      select 1
      from public.preparations preparation
      where preparation.id = component.source_preparation_id
        and regexp_replace(extensions.unaccent(upper(preparation.name)), '[^A-Z0-9]', '', 'g') like '%MASA%'
    )
  );

delete from public.pizza_flavor_ingredients ingredient
where (
    ingredient.source_kind = 'preparation'
    and exists (
      select 1
      from public.preparations preparation
      where preparation.id = ingredient.source_preparation_id
        and regexp_replace(extensions.unaccent(upper(preparation.name)), '[^A-Z0-9]', '', 'g') like '%MASA%'
    )
  )
  or exists (
    select 1
    from public.pizza_size_base_sources base_source
    where (base_source.source_kind = 'inventory_item'
      and ingredient.source_kind = 'inventory_item'
      and base_source.inventory_item_id = ingredient.inventory_item_id)
      or (base_source.source_kind = 'preparation'
        and ingredient.source_kind = 'preparation'
        and base_source.source_preparation_id = ingredient.source_preparation_id)
  );

create or replace function public.is_reserved_pizza_base_source(
  p_source_kind text,
  p_inventory_item_id uuid,
  p_source_preparation_id uuid
)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from public.pizza_size_base_sources base_source
    where (base_source.source_kind = 'inventory_item'
      and p_source_kind = 'inventory_item'
      and base_source.inventory_item_id = p_inventory_item_id)
      or (base_source.source_kind = 'preparation'
        and p_source_kind = 'preparation'
        and base_source.source_preparation_id = p_source_preparation_id)
  )
  or exists (
    select 1 from public.preparations preparation
    where p_source_kind = 'preparation'
      and preparation.id = p_source_preparation_id
      and regexp_replace(extensions.unaccent(upper(preparation.name)), '[^A-Z0-9]', '', 'g') like '%MASA%'
  );
$$;

/* The source is globally reserved: a base configured for one size cannot be
   reintroduced as a flavor component for another size. */

create or replace function public.prevent_pizza_size_base_component_duplicate()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.is_reserved_pizza_base_source(new.source_kind, new.inventory_item_id, new.source_preparation_id) then
    raise exception 'La base comun del tamano se consume automaticamente.';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_pizza_size_base_component_duplicate on public.pizza_price_components;
create trigger prevent_pizza_size_base_component_duplicate
before insert or update of price_config_id, source_kind, inventory_item_id, source_preparation_id
on public.pizza_price_components
for each row execute function public.prevent_pizza_size_base_component_duplicate();

create or replace function public.prevent_reserved_pizza_base_flavor_ingredient()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.is_reserved_pizza_base_source(new.source_kind, new.inventory_item_id, new.source_preparation_id) then
    raise exception 'La masa o base comun se configura unicamente por tamano.';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_reserved_pizza_base_flavor_ingredient on public.pizza_flavor_ingredients;
create trigger prevent_reserved_pizza_base_flavor_ingredient
before insert or update of source_kind, inventory_item_id, source_preparation_id
on public.pizza_flavor_ingredients
for each row execute function public.prevent_reserved_pizza_base_flavor_ingredient();

create or replace function public.remove_manual_component_matching_size_base()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  delete from public.pizza_price_components component
  using public.pizza_price_configs config
  where component.price_config_id = config.id
    and (
      (new.source_kind = 'inventory_item'
        and component.source_kind = 'inventory_item'
        and component.inventory_item_id = new.inventory_item_id)
      or
      (new.source_kind = 'preparation'
        and component.source_kind = 'preparation'
        and component.source_preparation_id = new.source_preparation_id)
    );
  return new;
end;
$$;

drop trigger if exists remove_manual_component_matching_size_base on public.pizza_size_base_sources;
create trigger remove_manual_component_matching_size_base
after insert or update of source_kind, inventory_item_id, source_preparation_id
on public.pizza_size_base_sources
for each row execute function public.remove_manual_component_matching_size_base();

notify pgrst, 'reload schema';
