create policy "Staff can create operational orders"
  on public.orders for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and auth_user_id is null
    and app_private.has_any_role(array[
      'vendedor'::public.app_role,
      'mesero'::public.app_role,
      'gerente'::public.app_role,
      'admin_sistema'::public.app_role
    ])
    and status in ('confirmed', 'in_kitchen')
    and payment_method in ('pending', 'cash', 'transfer', 'card', 'cash_on_delivery')
  );

create policy "Staff can create operational order items"
  on public.order_items for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.orders
      where orders.id = order_items.order_id
        and orders.created_by = (select auth.uid())
        and orders.created_at > now() - interval '30 minutes'
    )
  );

create policy "Staff can create operational order extras"
  on public.order_item_extras for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.order_items
      join public.orders on orders.id = order_items.order_id
      where order_items.id = order_item_extras.order_item_id
        and orders.created_by = (select auth.uid())
        and orders.created_at > now() - interval '30 minutes'
    )
  );
