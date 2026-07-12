create or replace function app_private.public_whatsapp_order_exists(order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.orders
    where id = order_id
      and auth_user_id is null
      and status = 'sent_to_whatsapp'
      and created_at > now() - interval '10 minutes'
  );
$$;

grant usage on schema app_private to anon;
grant execute on function app_private.public_whatsapp_order_exists(uuid) to anon;

drop policy if exists "Public can create items for whatsapp orders" on public.order_items;
create policy "Public can create items for whatsapp orders"
  on public.order_items for insert
  to anon
  with check (app_private.public_whatsapp_order_exists(order_id));

drop policy if exists "Public can create extras for whatsapp order items" on public.order_item_extras;
create policy "Public can create extras for whatsapp order items"
  on public.order_item_extras for insert
  to anon
  with check (
    exists (
      select 1
      from public.order_items
      where order_items.id = order_item_extras.order_item_id
        and app_private.public_whatsapp_order_exists(order_items.order_id)
    )
  );
