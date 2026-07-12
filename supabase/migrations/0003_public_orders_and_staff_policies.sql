create schema if not exists app_private;

create or replace function app_private.has_role(required_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = (select auth.uid())
      and role = required_role
  );
$$;

create or replace function app_private.has_any_role(required_roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = (select auth.uid())
      and role = any(required_roles)
  );
$$;

revoke all on schema app_private from public;
revoke all on function app_private.has_role(public.app_role) from public;
revoke all on function app_private.has_any_role(public.app_role[]) from public;
grant usage on schema app_private to authenticated;
grant execute on function app_private.has_role(public.app_role) to authenticated;
grant execute on function app_private.has_any_role(public.app_role[]) to authenticated;

create or replace function app_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    new.raw_user_meta_data ->> 'phone'
  )
  on conflict (id) do update
    set full_name = excluded.full_name,
        phone = excluded.phone,
        updated_at = now();

  if not exists (select 1 from public.user_roles) then
    insert into public.user_roles (user_id, role)
    values
      (new.id, 'admin_sistema'),
      (new.id, 'gerente')
    on conflict (user_id, role) do nothing;
  else
    insert into public.user_roles (user_id, role)
    values (new.id, 'cliente')
    on conflict (user_id, role) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app_private.handle_new_user();

create policy "Users can insert own profile"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

create policy "Public can create whatsapp orders"
  on public.orders for insert
  to anon
  with check (
    auth_user_id is null
    and created_by is null
    and assigned_courier_id is null
    and status = 'sent_to_whatsapp'
    and payment_method in ('pending', 'cash', 'transfer', 'cash_on_delivery')
  );

create policy "Public can create items for whatsapp orders"
  on public.order_items for insert
  to anon
  with check (
    exists (
      select 1
      from public.orders
      where orders.id = order_items.order_id
        and orders.auth_user_id is null
        and orders.status = 'sent_to_whatsapp'
        and orders.created_at > now() - interval '10 minutes'
    )
  );

create policy "Public can create extras for whatsapp order items"
  on public.order_item_extras for insert
  to anon
  with check (
    exists (
      select 1
      from public.order_items
      join public.orders on orders.id = order_items.order_id
      where order_items.id = order_item_extras.order_item_id
        and orders.auth_user_id is null
        and orders.status = 'sent_to_whatsapp'
        and orders.created_at > now() - interval '10 minutes'
    )
  );

create policy "Staff can read roles"
  on public.user_roles for select
  to authenticated
  using (
    app_private.has_any_role(array[
      'gerente'::public.app_role,
      'admin_sistema'::public.app_role
    ])
  );

create policy "Staff can read profiles"
  on public.profiles for select
  to authenticated
  using (
    app_private.has_any_role(array[
      'vendedor'::public.app_role,
      'mesero'::public.app_role,
      'cocina'::public.app_role,
      'mensajero'::public.app_role,
      'gerente'::public.app_role,
      'admin_sistema'::public.app_role
    ])
  );

create policy "Staff can read orders"
  on public.orders for select
  to authenticated
  using (
    app_private.has_any_role(array[
      'vendedor'::public.app_role,
      'mesero'::public.app_role,
      'cocina'::public.app_role,
      'mensajero'::public.app_role,
      'gerente'::public.app_role,
      'admin_sistema'::public.app_role
    ])
  );

create policy "Staff can update operational orders"
  on public.orders for update
  to authenticated
  using (
    app_private.has_any_role(array[
      'vendedor'::public.app_role,
      'mesero'::public.app_role,
      'cocina'::public.app_role,
      'mensajero'::public.app_role,
      'gerente'::public.app_role,
      'admin_sistema'::public.app_role
    ])
  )
  with check (
    app_private.has_any_role(array[
      'vendedor'::public.app_role,
      'mesero'::public.app_role,
      'cocina'::public.app_role,
      'mensajero'::public.app_role,
      'gerente'::public.app_role,
      'admin_sistema'::public.app_role
    ])
  );

create policy "Staff can read order items"
  on public.order_items for select
  to authenticated
  using (
    app_private.has_any_role(array[
      'vendedor'::public.app_role,
      'mesero'::public.app_role,
      'cocina'::public.app_role,
      'mensajero'::public.app_role,
      'gerente'::public.app_role,
      'admin_sistema'::public.app_role
    ])
  );

create policy "Staff can read order item extras"
  on public.order_item_extras for select
  to authenticated
  using (
    app_private.has_any_role(array[
      'vendedor'::public.app_role,
      'mesero'::public.app_role,
      'cocina'::public.app_role,
      'mensajero'::public.app_role,
      'gerente'::public.app_role,
      'admin_sistema'::public.app_role
    ])
  );

create policy "Staff can create order status events"
  on public.order_status_events for insert
  to authenticated
  with check (
    app_private.has_any_role(array[
      'vendedor'::public.app_role,
      'mesero'::public.app_role,
      'cocina'::public.app_role,
      'mensajero'::public.app_role,
      'gerente'::public.app_role,
      'admin_sistema'::public.app_role
    ])
  );

create policy "Staff can read order status events"
  on public.order_status_events for select
  to authenticated
  using (
    app_private.has_any_role(array[
      'vendedor'::public.app_role,
      'mesero'::public.app_role,
      'cocina'::public.app_role,
      'mensajero'::public.app_role,
      'gerente'::public.app_role,
      'admin_sistema'::public.app_role
    ])
  );
