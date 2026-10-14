-- Customer accounts and public order requests are deliberately separate from
-- operational POS orders. A request never reserves stock or records payment.

alter table public.site_settings
  add column if not exists public_direct_ordering_enabled boolean not null default false;

create table if not exists public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  label text not null default 'Dirección',
  address_line text not null,
  complement text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists customer_addresses_one_default_idx
  on public.customer_addresses (customer_id)
  where is_default;
create index if not exists customer_addresses_customer_idx
  on public.customer_addresses (customer_id, created_at desc);

create table if not exists public.public_order_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete restrict,
  client_request_id uuid not null,
  channel text not null check (channel in ('whatsapp', 'direct')),
  status text not null check (status in ('whatsapp_opened', 'pending', 'accepted', 'rejected', 'cancelled')),
  kind text not null check (kind in ('pickup', 'delivery')),
  customer_name text not null,
  customer_phone text not null,
  delivery_address text,
  delivery_complement text,
  notes text,
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0),
  subtotal_cop numeric(14,2) not null check (subtotal_cop >= 0),
  total_cop numeric(14,2) not null check (total_cop >= 0),
  accepted_order_id uuid unique references public.pos_orders(id) on delete set null,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, client_request_id)
);

create index if not exists public_order_requests_staff_queue_idx
  on public.public_order_requests (status, created_at asc);
create index if not exists public_order_requests_customer_idx
  on public.public_order_requests (customer_id, created_at desc);

alter table public.customer_addresses enable row level security;
alter table public.public_order_requests enable row level security;

drop policy if exists "Customers manage own delivery addresses" on public.customer_addresses;
create policy "Customers manage own delivery addresses"
  on public.customer_addresses for all to authenticated
  using (customer_id = (select auth.uid()))
  with check (customer_id = (select auth.uid()));

drop policy if exists "Customers read own public order requests" on public.public_order_requests;
create policy "Customers read own public order requests"
  on public.public_order_requests for select to authenticated
  using (customer_id = (select auth.uid()));

drop policy if exists "Staff manage public order requests" on public.public_order_requests;
create policy "Staff manage public order requests"
  on public.public_order_requests for all to authenticated
  using (public.current_user_can_access_module('pedidos'))
  with check (public.current_user_can_access_module('pedidos'));

create or replace function app_private.public_customer_account()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and account_type = 'client'
      and coalesce(is_active, true)
  );
$$;

-- Public registration must never bootstrap an internal account. Staff accounts
-- are provisioned by an existing administrator only.
create or replace function app_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, phone, account_type)
  values (
    new.id,
    new.email,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), new.email),
    nullif(btrim(new.raw_user_meta_data ->> 'phone'), ''),
    'client'
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(public.profiles.full_name, excluded.full_name),
        phone = coalesce(public.profiles.phone, excluded.phone),
        updated_at = now();
  return new;
end;
$$;

create or replace function app_private.prevent_self_privilege_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() = old.id then
    if new.account_type is distinct from old.account_type
      or new.is_active is distinct from old.is_active then
      raise exception 'No puedes modificar el tipo ni el estado de tu cuenta.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_prevent_self_privilege_escalation on public.profiles;
create trigger profiles_prevent_self_privilege_escalation
before update on public.profiles
for each row execute function app_private.prevent_self_privilege_escalation();

create or replace function public.create_public_order_request(
  p_channel text,
  p_kind text,
  p_customer_name text,
  p_customer_phone text,
  p_delivery_address text,
  p_delivery_complement text,
  p_notes text,
  p_items jsonb,
  p_client_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item jsonb;
  addition jsonb;
  normalized_items jsonb := '[]'::jsonb;
  normalized_additions jsonb;
  pizza record;
  secondary_pizza record;
  secondary_pizza_id uuid;
  product record;
  addition_row record;
  quantity_value integer;
  line_price numeric;
  line_total numeric;
  subtotal_value numeric := 0;
  existing_request public.public_order_requests%rowtype;
  request_id uuid;
begin
  if not app_private.public_customer_account() then
    raise exception 'Debes iniciar sesión con una cuenta de cliente.';
  end if;
  if p_channel not in ('whatsapp', 'direct') then raise exception 'Canal público no válido.'; end if;
  if p_kind not in ('pickup', 'delivery') then raise exception 'Entrega no válida.'; end if;
  if p_channel = 'direct' and not coalesce((select public_direct_ordering_enabled from public.site_settings where id = true), false) then
    raise exception 'Los pedidos directos aún no están habilitados.';
  end if;
  if nullif(btrim(p_customer_name), '') is null or nullif(regexp_replace(coalesce(p_customer_phone, ''), '\D', '', 'g'), '') is null then
    raise exception 'Nombre y teléfono son obligatorios.';
  end if;
  if p_kind = 'delivery' and nullif(btrim(p_delivery_address), '') is null then
    raise exception 'La dirección es obligatoria para domicilio.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agrega al menos un producto.';
  end if;

  select * into existing_request
  from public.public_order_requests
  where customer_id = auth.uid() and client_request_id = p_client_request_id;
  if found then
    return jsonb_build_object('id', existing_request.id, 'status', existing_request.status, 'total_cop', existing_request.total_cop, 'duplicate', true);
  end if;
  if (select count(*) from public.public_order_requests where customer_id = auth.uid() and created_at > now() - interval '5 minutes') >= 4 then
    raise exception 'Espera unos minutos antes de enviar otra solicitud.';
  end if;

  for item in select value from jsonb_array_elements(p_items)
  loop
    quantity_value := greatest(1, coalesce(nullif(item->>'quantity', '')::integer, 1));
    normalized_additions := '[]'::jsonb;
    secondary_pizza_id := null;
    if item->>'kind' = 'pizza' then
      select ppc.id, ppc.sale_price_cop, ppc.size_id, pf.name as flavor_name, ps.name as size_name, pf.allows_half_and_half
      into pizza
      from public.pizza_price_configs ppc
      join public.pizza_flavors pf on pf.id = ppc.flavor_id and pf.is_active
      join public.pizza_sizes ps on ps.id = ppc.size_id and ps.is_active
      where ppc.id = nullif(item->>'id', '')::uuid and ppc.is_active;
      if not found then raise exception 'Una pizza ya no está disponible.'; end if;
      line_price := pizza.sale_price_cop;
      if nullif(item->>'secondary_id', '') is not null then
        if not pizza.allows_half_and_half then raise exception 'La pizza no permite mitad y mitad.'; end if;
        select ppc.id, ppc.sale_price_cop, ppc.size_id, pf.name as flavor_name
        into secondary_pizza
        from public.pizza_price_configs ppc
        join public.pizza_flavors pf on pf.id = ppc.flavor_id and pf.is_active
        where ppc.id = (item->>'secondary_id')::uuid and ppc.is_active and ppc.size_id = pizza.size_id;
        if not found then raise exception 'El segundo sabor no está disponible para este tamaño.'; end if;
        secondary_pizza_id := secondary_pizza.id;
        line_price := greatest(line_price, secondary_pizza.sale_price_cop);
      end if;
      for addition in select value from jsonb_array_elements(coalesce(item->'additions', '[]'::jsonb))
      loop
        select a.id, a.name, s.price_cop into addition_row
        from public.pizza_additions a
        join public.pizza_addition_sizes s on s.addition_id = a.id and s.pizza_size_id = pizza.size_id
        where a.id = nullif(addition->>'id', '')::uuid and a.is_active and a.is_available;
        if not found then raise exception 'Una adición ya no está disponible.'; end if;
        line_price := line_price + addition_row.price_cop * greatest(1, coalesce(nullif(addition->>'quantity', '')::integer, 1));
        normalized_additions := normalized_additions || jsonb_build_array(jsonb_build_object(
          'id', addition_row.id,
          'quantity', greatest(1, coalesce(nullif(addition->>'quantity', '')::integer, 1)),
          'scope', coalesce(nullif(addition->>'scope', ''), 'whole'),
          'scope_label', nullif(addition->>'scope_label', '')
        ));
      end loop;
      normalized_items := normalized_items || jsonb_build_array(jsonb_build_object(
        'kind', 'pizza', 'id', pizza.id, 'secondary_id', secondary_pizza_id,
        'quantity', quantity_value, 'unit_price_cop', line_price, 'notes', nullif(btrim(coalesce(item->>'notes', '')), ''),
        'removed_components', coalesce(item->'removed_components', '[]'::jsonb), 'additions', normalized_additions,
        'combo_instance_id', nullif(item->>'combo_instance_id', ''), 'combo_config_id', nullif(item->>'combo_config_id', ''),
        'combo_variant_id', nullif(item->>'combo_variant_id', ''), 'combo_is_primary', coalesce((item->>'combo_is_primary')::boolean, false)
      ));
    elsif item->>'kind' = 'sale_product' then
      select id, sale_price_cop into product from public.inventory_items
      where id = nullif(item->>'id', '')::uuid and item_kind = 'sale_product' and is_active and sale_is_enabled and presentation_quantity is not null;
      if not found or product.sale_price_cop <= 0 then raise exception 'Un producto ya no está disponible.'; end if;
      line_price := product.sale_price_cop;
      normalized_items := normalized_items || jsonb_build_array(jsonb_build_object(
        'kind', 'sale_product', 'id', product.id, 'quantity', quantity_value, 'unit_price_cop', line_price,
        'notes', nullif(btrim(coalesce(item->>'notes', '')), ''), 'additions', '[]'::jsonb
      ));
    else
      raise exception 'Producto público no válido.';
    end if;
    line_total := round(line_price * quantity_value, 2);
    subtotal_value := subtotal_value + line_total;
  end loop;

  if jsonb_array_length(public.get_pos_order_stock_shortages(normalized_items)) > 0 then
    raise exception 'No hay disponibilidad suficiente para este pedido.';
  end if;

  insert into public.public_order_requests (
    customer_id, client_request_id, channel, status, kind, customer_name, customer_phone, delivery_address, delivery_complement, notes, items, subtotal_cop, total_cop
  ) values (
    auth.uid(), p_client_request_id, p_channel, case when p_channel = 'direct' then 'pending' else 'whatsapp_opened' end,
    p_kind, btrim(p_customer_name), regexp_replace(p_customer_phone, '\D', '', 'g'), nullif(btrim(p_delivery_address), ''),
    nullif(btrim(p_delivery_complement), ''), nullif(btrim(p_notes), ''), normalized_items, subtotal_value, subtotal_value
  ) returning id into request_id;

  return jsonb_build_object('id', request_id, 'status', case when p_channel = 'direct' then 'pending' else 'whatsapp_opened' end, 'total_cop', subtotal_value, 'duplicate', false);
end;
$$;

create or replace function public.accept_public_order_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  request_row public.public_order_requests%rowtype;
  created_order jsonb;
begin
  if not public.current_user_can_access_module('pedidos') then raise exception 'No tienes acceso a pedidos.'; end if;
  select * into request_row from public.public_order_requests where id = p_request_id for update;
  if not found then raise exception 'Solicitud no encontrada.'; end if;
  if request_row.status not in ('pending', 'whatsapp_opened') then raise exception 'La solicitud ya fue revisada.'; end if;
  created_order := public.create_pos_order_with_platform_payment(
    request_row.kind, request_row.customer_name, request_row.customer_phone, 'none', 0, 0, 0,
    'pending', 'direct', 'business', request_row.notes, request_row.items, null, null
  );
  update public.public_order_requests
  set status = 'accepted', accepted_order_id = (created_order->>'id')::uuid, reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  where id = request_row.id;
  return created_order;
end;
$$;

create or replace function public.reject_public_order_request(p_request_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.current_user_can_access_module('pedidos') then raise exception 'No tienes acceso a pedidos.'; end if;
  update public.public_order_requests
  set status = 'rejected', rejection_reason = nullif(btrim(p_reason), ''), reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  where id = p_request_id and status in ('pending', 'whatsapp_opened');
  if not found then raise exception 'La solicitud ya fue revisada o no existe.'; end if;
end;
$$;

revoke all on function app_private.public_customer_account() from public;
revoke all on function app_private.prevent_self_privilege_escalation() from public;
revoke all on function public.create_public_order_request(text, text, text, text, text, text, text, jsonb, uuid) from public;
revoke all on function public.accept_public_order_request(uuid) from public;
revoke all on function public.reject_public_order_request(uuid, text) from public;
grant execute on function public.create_public_order_request(text, text, text, text, text, text, text, jsonb, uuid) to authenticated;
grant execute on function public.accept_public_order_request(uuid) to authenticated;
grant execute on function public.reject_public_order_request(uuid, text) to authenticated;

notify pgrst, 'reload schema';
