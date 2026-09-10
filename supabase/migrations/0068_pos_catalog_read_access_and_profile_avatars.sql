alter table public.profiles
  add column if not exists avatar_url text;

insert into storage.buckets (id, name, public)
values ('profile-images', 'profile-images', false)
on conflict (id) do nothing;

drop policy if exists "Staff can read profiles" on public.profiles;

create policy "Admins can read profiles"
  on public.profiles for select
  to authenticated
  using (app_private.is_admin_sistema());

create policy "Admins can update profiles"
  on public.profiles for update
  to authenticated
  using (app_private.is_admin_sistema())
  with check (app_private.is_admin_sistema());

create policy "Admins can manage profile images"
  on storage.objects for all
  to authenticated
  using (
    bucket_id = 'profile-images'
    and app_private.is_admin_sistema()
  )
  with check (
    bucket_id = 'profile-images'
    and app_private.is_admin_sistema()
  );

create policy "Users can read own profile image"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'profile-images'
    and (storage.foldername(name))[1] = 'profiles'
    and (storage.foldername(name))[2] = (select auth.uid()::text)
  );

create policy "POS staff can read product images"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'product-images'
    and public.current_user_can_access_module('pedidos')
  );

create policy "POS staff can read active pizza flavors"
  on public.pizza_flavors for select
  to authenticated
  using (is_active and public.current_user_can_access_module('pedidos'));

create policy "POS staff can read active pizza sizes"
  on public.pizza_sizes for select
  to authenticated
  using (is_active and public.current_user_can_access_module('pedidos'));

create policy "POS staff can read active menu categories"
  on public.menu_categories for select
  to authenticated
  using (is_active and public.current_user_can_access_module('pedidos'));

create policy "POS staff can read active pizza prices"
  on public.pizza_price_configs for select
  to authenticated
  using (is_active and public.current_user_can_access_module('pedidos'));

create policy "POS staff can read pizza price components"
  on public.pizza_price_components for select
  to authenticated
  using (public.current_user_can_access_module('pedidos'));

create policy "POS staff can read flavor ingredients"
  on public.pizza_flavor_ingredients for select
  to authenticated
  using (public.current_user_can_access_module('pedidos'));

create policy "POS staff can read active pizza additions"
  on public.pizza_additions for select
  to authenticated
  using (is_active and is_available and public.current_user_can_access_module('pedidos'));

create policy "POS staff can read pizza addition sizes"
  on public.pizza_addition_sizes for select
  to authenticated
  using (public.current_user_can_access_module('pedidos'));

create policy "POS staff can read pizza addition flavors"
  on public.pizza_addition_flavors for select
  to authenticated
  using (public.current_user_can_access_module('pedidos'));

create policy "POS staff can read pizza addition categories"
  on public.pizza_addition_categories for select
  to authenticated
  using (public.current_user_can_access_module('pedidos'));

create policy "POS staff can read operational sources"
  on public.inventory_items for select
  to authenticated
  using (
    is_active
    and public.current_user_can_access_module('pedidos')
  );

create policy "POS staff can read active preparations"
  on public.preparations for select
  to authenticated
  using (is_active and public.current_user_can_access_module('pedidos'));

create or replace function public.get_pos_sale_product_catalog()
returns table (
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
    select
      refs.id,
      refs.sku,
      refs.name,
      coalesce(master.image_url, refs.image_url) as image_url,
      refs.presentation_quantity,
      refs.presentation_unit,
      refs.sale_price_cop,
      refs.sale_is_enabled,
      refs.unit
    from public.inventory_items refs
    join public.inventory_items master
      on master.item_kind = 'sale_product'
      and master.presentation_quantity is null
      and master.is_active
      and upper(master.name) = upper(refs.name)
    where refs.item_kind = 'sale_product'
      and refs.presentation_quantity is not null
      and refs.presentation_unit is not null
      and refs.is_active
      and refs.sale_is_enabled
      and refs.sale_price_cop > 0
      and exists (
        select 1
        from public.purchase_items purchase_line
        where purchase_line.inventory_item_id = refs.id
      )
  ),
  purchase_balances as (
    select
      purchase_line.id,
      purchase_line.inventory_item_id,
      greatest(
        0,
        purchase_line.quantity
        - coalesce((
          select sum(allocation.quantity_base)
          from public.production_consumption_allocations allocation
          where allocation.purchase_item_id = purchase_line.id
        ), 0)
        - coalesce((
          select sum(allocation.quantity_base)
          from public.pos_order_consumption_allocations allocation
          join public.pos_order_consumptions consumption on consumption.id = allocation.consumption_id
          join public.pos_orders sale_order on sale_order.id = consumption.pos_order_id
          where allocation.purchase_item_id = purchase_line.id
            and sale_order.status <> 'cancelled'
        ), 0)
      ) as available_quantity,
      purchase_line.quantity as initial_quantity,
      purchase_line.line_total_cop
    from public.purchase_items purchase_line
    join sellable_references reference on reference.id = purchase_line.inventory_item_id
  ),
  availability as (
    select
      inventory_item_id,
      sum(available_quantity) as stock_base,
      case
        when sum(available_quantity) > 0
          then sum((line_total_cop / nullif(initial_quantity, 0)) * available_quantity) / sum(available_quantity)
        else null
      end as unit_cost_cop
    from purchase_balances
    group by inventory_item_id
  )
  select
    reference.id,
    reference.sku,
    reference.name,
    reference.image_url,
    reference.presentation_quantity,
    reference.presentation_unit,
    reference.sale_price_cop,
    reference.sale_is_enabled,
    reference.unit,
    coalesce(availability.stock_base, 0),
    availability.unit_cost_cop
  from sellable_references reference
  left join availability on availability.inventory_item_id = reference.id
  order by reference.name, reference.presentation_quantity;
end;
$$;

revoke all on function public.get_pos_sale_product_catalog() from public;
grant execute on function public.get_pos_sale_product_catalog() to authenticated;
