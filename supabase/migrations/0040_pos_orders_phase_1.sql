create table if not exists public.pos_order_counters (
  id boolean primary key default true check (id = true),
  last_number bigint not null default 0
);

insert into public.pos_order_counters (id, last_number)
values (true, 0)
on conflict (id) do nothing;

create table if not exists public.pos_orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint not null unique,
  code text not null unique,
  kind text not null check (kind in ('local', 'pickup', 'delivery')),
  status text not null default 'confirmed' check (status in ('new', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled')),
  customer_name text,
  customer_phone text,
  subtotal_cop numeric(14, 2) not null default 0 check (subtotal_cop >= 0),
  discount_cop numeric(14, 2) not null default 0 check (discount_cop >= 0),
  delivery_cop numeric(14, 2) not null default 0 check (delivery_cop >= 0),
  total_cop numeric(14, 2) not null default 0 check (total_cop >= 0),
  payment_method text not null default 'pending' check (payment_method in ('cash', 'card', 'transfer', 'mixed', 'pending')),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  cancelled_by uuid references auth.users(id) on delete set null,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz
);

create table if not exists public.pos_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.pos_orders(id) on delete cascade,
  item_kind text not null check (item_kind in ('pizza', 'sale_product')),
  pizza_price_config_id uuid references public.pizza_price_configs(id) on delete restrict,
  inventory_item_id uuid references public.inventory_items(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  product_name_snapshot text not null,
  sku_snapshot text,
  unit_price_cop numeric(14, 2) not null check (unit_price_cop >= 0),
  line_subtotal_cop numeric(14, 2) not null check (line_subtotal_cop >= 0),
  line_cost_cop numeric(14, 2) not null default 0 check (line_cost_cop >= 0),
  notes text,
  created_at timestamptz not null default now(),
  constraint pos_order_items_source_check check (
    (item_kind = 'pizza' and pizza_price_config_id is not null and inventory_item_id is null)
    or
    (item_kind = 'sale_product' and inventory_item_id is not null and pizza_price_config_id is null)
  )
);

create table if not exists public.pos_order_item_additions (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.pos_order_items(id) on delete cascade,
  addition_id uuid not null references public.pizza_additions(id) on delete restrict,
  quantity integer not null default 1 check (quantity > 0),
  name_snapshot text not null,
  sku_snapshot text,
  unit_price_cop numeric(14, 2) not null check (unit_price_cop >= 0),
  line_subtotal_cop numeric(14, 2) not null check (line_subtotal_cop >= 0),
  line_cost_cop numeric(14, 2) not null default 0 check (line_cost_cop >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.pos_order_consumptions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.pos_orders(id) on delete cascade,
  order_item_id uuid not null references public.pos_order_items(id) on delete cascade,
  order_item_addition_id uuid references public.pos_order_item_additions(id) on delete cascade,
  source_kind text not null check (source_kind in ('inventory_item', 'preparation')),
  inventory_item_id uuid references public.inventory_items(id) on delete restrict,
  source_preparation_id uuid references public.preparations(id) on delete restrict,
  quantity_base numeric(14, 3) not null check (quantity_base > 0),
  base_unit public.stock_unit not null,
  cost_cop numeric(14, 2) not null default 0 check (cost_cop >= 0),
  created_at timestamptz not null default now(),
  constraint pos_order_consumptions_source_check check (
    (source_kind = 'inventory_item' and inventory_item_id is not null and source_preparation_id is null)
    or
    (source_kind = 'preparation' and source_preparation_id is not null and inventory_item_id is null)
  )
);

create table if not exists public.pos_order_consumption_allocations (
  id uuid primary key default gen_random_uuid(),
  consumption_id uuid not null references public.pos_order_consumptions(id) on delete cascade,
  purchase_item_id uuid references public.purchase_items(id) on delete restrict,
  production_batch_id uuid references public.production_batches(id) on delete restrict,
  quantity_base numeric(14, 3) not null check (quantity_base > 0),
  base_unit public.stock_unit not null,
  cost_cop numeric(14, 2) not null default 0 check (cost_cop >= 0),
  created_at timestamptz not null default now(),
  constraint pos_order_consumption_allocations_source_check check (
    (purchase_item_id is not null and production_batch_id is null)
    or
    (purchase_item_id is null and production_batch_id is not null)
  )
);

create table if not exists public.pos_order_status_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.pos_orders(id) on delete cascade,
  from_status text,
  to_status text not null check (to_status in ('new', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled')),
  actor_id uuid references auth.users(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists pos_orders_status_created_idx on public.pos_orders (status, created_at desc);
create index if not exists pos_order_items_order_id_idx on public.pos_order_items (order_id);
create index if not exists pos_order_items_pizza_price_config_id_idx on public.pos_order_items (pizza_price_config_id);
create index if not exists pos_order_items_inventory_item_id_idx on public.pos_order_items (inventory_item_id);
create index if not exists pos_order_additions_order_item_id_idx on public.pos_order_item_additions (order_item_id);
create index if not exists pos_order_consumptions_order_id_idx on public.pos_order_consumptions (order_id);
create index if not exists pos_order_allocations_purchase_item_id_idx on public.pos_order_consumption_allocations (purchase_item_id);
create index if not exists pos_order_allocations_batch_id_idx on public.pos_order_consumption_allocations (production_batch_id);

alter table public.pos_order_counters enable row level security;
alter table public.pos_orders enable row level security;
alter table public.pos_order_items enable row level security;
alter table public.pos_order_item_additions enable row level security;
alter table public.pos_order_consumptions enable row level security;
alter table public.pos_order_consumption_allocations enable row level security;
alter table public.pos_order_status_events enable row level security;

create or replace function public.pos_active_order_allocated_purchase_quantity(p_purchase_item_id uuid)
returns numeric
language sql
stable
as $$
  select coalesce(sum(public.production_convert_quantity(poca.quantity_base, poca.base_unit, pi.unit, null)), 0)
  from public.pos_order_consumption_allocations poca
  join public.pos_order_consumptions poc on poc.id = poca.consumption_id
  join public.pos_orders po on po.id = poc.order_id
  join public.purchase_items pi on pi.id = poca.purchase_item_id
  where poca.purchase_item_id = p_purchase_item_id
    and po.status <> 'cancelled';
$$;

create or replace function public.pos_active_order_allocated_batch_quantity(p_batch_id uuid)
returns numeric
language sql
stable
as $$
  select coalesce(sum(public.production_convert_quantity(poca.quantity_base, poca.base_unit, pb.base_unit, null)), 0)
  from public.pos_order_consumption_allocations poca
  join public.pos_order_consumptions poc on poc.id = poca.consumption_id
  join public.pos_orders po on po.id = poc.order_id
  join public.production_batches pb on pb.id = poca.production_batch_id
  where poca.production_batch_id = p_batch_id
    and po.status <> 'cancelled';
$$;

create or replace function public.pos_allocate_consumption(
  p_order_id uuid,
  p_order_item_id uuid,
  p_order_item_addition_id uuid,
  p_source_kind text,
  p_source_id uuid,
  p_quantity_base numeric,
  p_base_unit public.stock_unit
)
returns numeric
language plpgsql
security invoker
set search_path = public
as $$
declare
  new_consumption_id uuid;
  remaining_base numeric := p_quantity_base;
  allocation_quantity numeric;
  allocation_cost numeric;
  total_cost numeric := 0;
  lot record;
begin
  if p_quantity_base <= 0 then
    raise exception 'La cantidad a consumir debe ser mayor a cero.';
  end if;

  insert into public.pos_order_consumptions (
    order_id, order_item_id, order_item_addition_id, source_kind, inventory_item_id, source_preparation_id,
    quantity_base, base_unit, cost_cop
  )
  values (
    p_order_id,
    p_order_item_id,
    p_order_item_addition_id,
    p_source_kind,
    case when p_source_kind = 'inventory_item' then p_source_id else null end,
    case when p_source_kind = 'preparation' then p_source_id else null end,
    p_quantity_base,
    p_base_unit,
    0
  )
  returning id into new_consumption_id;

  if p_source_kind = 'inventory_item' then
    for lot in
      select
        pi.id,
        pi.quantity,
        pi.unit,
        pi.line_total_cop,
        pi.expiration_date,
        p.purchased_at,
        public.production_convert_quantity(pi.quantity, pi.unit, p_base_unit, null)
          - coalesce((
            select sum(public.production_convert_quantity(pca.quantity_base, pca.base_unit, p_base_unit, null))
            from public.production_consumption_allocations pca
            where pca.purchase_item_id = pi.id
          ), 0)
          - coalesce((
            select sum(public.production_convert_quantity(poca.quantity_base, poca.base_unit, p_base_unit, null))
            from public.pos_order_consumption_allocations poca
            join public.pos_order_consumptions poc on poc.id = poca.consumption_id
            join public.pos_orders po on po.id = poc.order_id
            where poca.purchase_item_id = pi.id
              and po.status <> 'cancelled'
          ), 0) as available_base
      from public.purchase_items pi
      join public.purchases p on p.id = pi.purchase_id
      where pi.inventory_item_id = p_source_id
      order by pi.expiration_date asc nulls last, p.purchased_at asc, pi.id asc
      for update of pi
    loop
      exit when remaining_base <= 0;
      if lot.available_base <= 0 then
        continue;
      end if;
      allocation_quantity := least(remaining_base, lot.available_base);
      allocation_cost := round(allocation_quantity * (lot.line_total_cop / nullif(public.production_convert_quantity(lot.quantity, lot.unit, p_base_unit, null), 0)), 2);

      insert into public.pos_order_consumption_allocations (
        consumption_id, purchase_item_id, quantity_base, base_unit, cost_cop
      )
      values (new_consumption_id, lot.id, allocation_quantity, p_base_unit, allocation_cost);

      remaining_base := remaining_base - allocation_quantity;
      total_cost := total_cost + allocation_cost;
    end loop;
  elsif p_source_kind = 'preparation' then
    for lot in
      select
        pb.id,
        pb.initial_quantity_base,
        pb.base_unit,
        pb.unit_cost_cop,
        pb.expiration_date,
        pb.elaborated_at,
        pb.production_number,
        public.production_convert_quantity(pb.initial_quantity_base, pb.base_unit, p_base_unit, null)
          - coalesce((
            select sum(public.production_convert_quantity(pca.quantity_base, pca.base_unit, p_base_unit, null))
            from public.production_consumption_allocations pca
            where pca.production_batch_id = pb.id
          ), 0)
          - coalesce((
            select sum(public.production_convert_quantity(poca.quantity_base, poca.base_unit, p_base_unit, null))
            from public.pos_order_consumption_allocations poca
            join public.pos_order_consumptions poc on poc.id = poca.consumption_id
            join public.pos_orders po on po.id = poc.order_id
            where poca.production_batch_id = pb.id
              and po.status <> 'cancelled'
          ), 0) as available_base
      from public.production_batches pb
      where pb.preparation_id = p_source_id
      order by pb.expiration_date asc, pb.elaborated_at asc, pb.production_number asc
      for update of pb
    loop
      exit when remaining_base <= 0;
      if lot.available_base <= 0 then
        continue;
      end if;
      allocation_quantity := least(remaining_base, lot.available_base);
      allocation_cost := round(allocation_quantity * lot.unit_cost_cop, 2);

      insert into public.pos_order_consumption_allocations (
        consumption_id, production_batch_id, quantity_base, base_unit, cost_cop
      )
      values (new_consumption_id, lot.id, allocation_quantity, p_base_unit, allocation_cost);

      remaining_base := remaining_base - allocation_quantity;
      total_cost := total_cost + allocation_cost;
    end loop;
  else
    raise exception 'Tipo de consumo no valido.';
  end if;

  if remaining_base > 0.0001 then
    raise exception 'Stock insuficiente. Faltan % %.', round(remaining_base, 3), upper(p_base_unit::text);
  end if;

  update public.pos_order_consumptions
  set cost_cop = round(total_cost, 2)
  where id = new_consumption_id;

  return round(total_cost, 2);
end;
$$;

create or replace function public.create_pos_order(
  p_kind text,
  p_customer_name text,
  p_customer_phone text,
  p_discount_cop numeric,
  p_delivery_cop numeric,
  p_payment_method text,
  p_notes text,
  p_items jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  counter_row record;
  next_number bigint;
  new_order_id uuid := gen_random_uuid();
  new_code text;
  item jsonb;
  addition jsonb;
  item_kind_value text;
  item_id uuid;
  item_quantity integer;
  addition_quantity integer;
  line_price numeric;
  item_subtotal numeric;
  item_cost numeric;
  subtotal_value numeric := 0;
  total_value numeric := 0;
  inserted_item_id uuid;
  inserted_addition_id uuid;
  pizza_row record;
  pizza_component record;
  addition_row record;
  addition_size_row record;
  sale_product_row record;
  consumption_quantity numeric;
  source_id_value uuid;
  source_unit_value public.stock_unit;
begin
  if not app_private.has_any_role(array['vendedor'::public.app_role, 'mesero'::public.app_role, 'gerente'::public.app_role, 'admin_sistema'::public.app_role]) then
    raise exception 'No tienes permisos para crear pedidos.';
  end if;

  if p_kind not in ('local', 'pickup', 'delivery') then
    raise exception 'Tipo de pedido no valido.';
  end if;
  if p_payment_method not in ('cash', 'card', 'transfer', 'mixed', 'pending') then
    raise exception 'Forma de pago no valida.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido necesita al menos un producto.';
  end if;

  select * into counter_row
  from public.pos_order_counters
  where id = true
  for update;

  next_number := counter_row.last_number + 1;
  new_code := 'PD' || next_number::text;

  update public.pos_order_counters
  set last_number = next_number
  where id = true;

  insert into public.pos_orders (
    id, order_number, code, kind, status, customer_name, customer_phone, discount_cop,
    delivery_cop, payment_method, notes, created_by
  )
  values (
    new_order_id, next_number, new_code, p_kind, 'confirmed', nullif(btrim(p_customer_name), ''),
    nullif(btrim(p_customer_phone), ''), coalesce(p_discount_cop, 0), coalesce(p_delivery_cop, 0),
    p_payment_method, nullif(btrim(p_notes), ''), auth.uid()
  );

  for item in select * from jsonb_array_elements(p_items)
  loop
    item_kind_value := item->>'kind';
    item_id := (item->>'id')::uuid;
    item_quantity := greatest(1, coalesce((item->>'quantity')::integer, 1));
    item_cost := 0;

    if item_kind_value = 'pizza' then
      select
        ppc.id,
        ppc.sku,
        ppc.sale_price_cop,
        ppc.size_id,
        pf.id as flavor_id,
        pf.name as flavor_name,
        pf.menu_category_id,
        ps.name as size_name
      into pizza_row
      from public.pizza_price_configs ppc
      join public.pizza_flavors pf on pf.id = ppc.flavor_id
      join public.pizza_sizes ps on ps.id = ppc.size_id
      where ppc.id = item_id
        and ppc.is_active = true
        and pf.is_active = true
        and ps.is_active = true;

      if not found then
        raise exception 'Pizza no disponible.';
      end if;

      line_price := pizza_row.sale_price_cop;
      item_subtotal := round(line_price * item_quantity, 2);
      subtotal_value := subtotal_value + item_subtotal;

      insert into public.pos_order_items (
        order_id, item_kind, pizza_price_config_id, quantity, product_name_snapshot,
        sku_snapshot, unit_price_cop, line_subtotal_cop, line_cost_cop
      )
      values (
        new_order_id, 'pizza', item_id, item_quantity, pizza_row.flavor_name || ' ' || pizza_row.size_name,
        pizza_row.sku, line_price, item_subtotal, 0
      )
      returning id into inserted_item_id;

      for pizza_component in
        select source_kind, inventory_item_id, source_preparation_id, quantity_base, unit
        from public.pizza_price_components
        where price_config_id = item_id
      loop
        consumption_quantity := pizza_component.quantity_base * item_quantity;
        source_id_value := coalesce(pizza_component.inventory_item_id, pizza_component.source_preparation_id);
        item_cost := item_cost + public.pos_allocate_consumption(
          new_order_id,
          inserted_item_id,
          null,
          pizza_component.source_kind,
          source_id_value,
          consumption_quantity,
          pizza_component.unit
        );
      end loop;

      for addition in select * from jsonb_array_elements(coalesce(item->'additions', '[]'::jsonb))
      loop
        source_id_value := (addition->>'id')::uuid;
        addition_quantity := greatest(1, coalesce((addition->>'quantity')::integer, 1));

        select id, sku, name, source_kind, inventory_item_id, source_preparation_id, is_active, is_available
        into addition_row
        from public.pizza_additions
        where id = source_id_value
          and is_active = true
          and is_available = true;

        if not found then
          raise exception 'Adicion no disponible.';
        end if;

        if exists (select 1 from public.pizza_addition_flavors where addition_id = addition_row.id)
          and not exists (
            select 1 from public.pizza_addition_flavors
            where addition_id = addition_row.id and flavor_id = pizza_row.flavor_id
          ) then
          raise exception 'La adicion no es compatible con este sabor.';
        end if;

        if exists (select 1 from public.pizza_addition_categories where addition_id = addition_row.id)
          and not exists (
            select 1 from public.pizza_addition_categories
            where addition_id = addition_row.id and menu_category_id = pizza_row.menu_category_id
          ) then
          raise exception 'La adicion no es compatible con esta categoria.';
        end if;

        select pizza_size_id, quantity_base, unit, price_cop
        into addition_size_row
        from public.pizza_addition_sizes
        where addition_id = addition_row.id
          and pizza_size_id = pizza_row.size_id;

        if not found then
          raise exception 'La adicion no esta configurada para este tamano.';
        end if;

        addition_quantity := addition_quantity * item_quantity;
        item_subtotal := round(addition_size_row.price_cop * addition_quantity, 2);
        subtotal_value := subtotal_value + item_subtotal;

        insert into public.pos_order_item_additions (
          order_item_id, addition_id, quantity, name_snapshot, sku_snapshot, unit_price_cop, line_subtotal_cop, line_cost_cop
        )
        values (
          inserted_item_id, addition_row.id, addition_quantity, addition_row.name, addition_row.sku,
          addition_size_row.price_cop, item_subtotal, 0
        )
        returning id into inserted_addition_id;

        source_id_value := coalesce(addition_row.inventory_item_id, addition_row.source_preparation_id);
        item_cost := item_cost + public.pos_allocate_consumption(
          new_order_id,
          inserted_item_id,
          inserted_addition_id,
          addition_row.source_kind,
          source_id_value,
          addition_size_row.quantity_base * addition_quantity,
          addition_size_row.unit
        );

        update public.pos_order_item_additions
        set line_cost_cop = (
          select coalesce(sum(cost_cop), 0)
          from public.pos_order_consumptions
          where order_item_addition_id = inserted_addition_id
        )
        where id = inserted_addition_id;
      end loop;

      update public.pos_order_items
      set line_cost_cop = round(item_cost, 2)
      where id = inserted_item_id;

    elsif item_kind_value = 'sale_product' then
      select id, sku, name
      into sale_product_row
      from public.inventory_items
      where id = item_id
        and item_kind = 'sale_product'
        and is_active = true;

      if not found then
        raise exception 'Producto para venta no disponible.';
      end if;

      line_price := greatest(0, coalesce((item->>'unit_price_cop')::numeric, 0));
      item_subtotal := round(line_price * item_quantity, 2);
      subtotal_value := subtotal_value + item_subtotal;

      insert into public.pos_order_items (
        order_id, item_kind, inventory_item_id, quantity, product_name_snapshot,
        sku_snapshot, unit_price_cop, line_subtotal_cop, line_cost_cop
      )
      values (
        new_order_id, 'sale_product', item_id, item_quantity, sale_product_row.name,
        sale_product_row.sku, line_price, item_subtotal, 0
      )
      returning id into inserted_item_id;

      source_unit_value := 'unit'::public.stock_unit;
      item_cost := public.pos_allocate_consumption(
        new_order_id,
        inserted_item_id,
        null,
        'inventory_item',
        item_id,
        item_quantity,
        source_unit_value
      );

      update public.pos_order_items
      set line_cost_cop = round(item_cost, 2)
      where id = inserted_item_id;
    else
      raise exception 'Tipo de item no valido.';
    end if;
  end loop;

  total_value := greatest(0, round(subtotal_value - coalesce(p_discount_cop, 0) + coalesce(p_delivery_cop, 0), 2));

  update public.pos_orders
  set subtotal_cop = round(subtotal_value, 2),
      total_cop = total_value,
      updated_at = now()
  where id = new_order_id;

  insert into public.pos_order_status_events (order_id, from_status, to_status, actor_id, notes)
  values (new_order_id, null, 'confirmed', auth.uid(), 'Pedido confirmado desde caja');

  return jsonb_build_object('id', new_order_id, 'code', new_code, 'total_cop', total_value);
end;
$$;

create or replace function public.cancel_pos_order(p_order_id uuid, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  order_row record;
begin
  if not app_private.has_any_role(array['vendedor'::public.app_role, 'mesero'::public.app_role, 'gerente'::public.app_role, 'admin_sistema'::public.app_role]) then
    raise exception 'No tienes permisos para cancelar pedidos.';
  end if;

  select * into order_row
  from public.pos_orders
  where id = p_order_id
  for update;

  if not found then raise exception 'Pedido no encontrado.'; end if;
  if order_row.status = 'cancelled' then
    return jsonb_build_object('id', order_row.id, 'code', order_row.code, 'status', order_row.status);
  end if;
  if order_row.status = 'delivered' then
    raise exception 'No se puede cancelar un pedido entregado.';
  end if;

  update public.pos_orders
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = auth.uid(),
      cancel_reason = nullif(btrim(p_reason), ''),
      updated_at = now()
  where id = p_order_id;

  insert into public.pos_order_status_events (order_id, from_status, to_status, actor_id, notes)
  values (p_order_id, order_row.status, 'cancelled', auth.uid(), nullif(btrim(p_reason), ''));

  return jsonb_build_object('id', order_row.id, 'code', order_row.code, 'status', 'cancelled');
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'pos_order_counters',
    'pos_orders',
    'pos_order_items',
    'pos_order_item_additions',
    'pos_order_consumptions',
    'pos_order_consumption_allocations',
    'pos_order_status_events'
  ]
  loop
    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public' and tablename = table_name and policyname = 'Staff can manage pos orders'
    ) then
      execute format(
        'create policy "Staff can manage pos orders" on public.%I for all to authenticated using (app_private.has_any_role(array[''vendedor''::public.app_role, ''mesero''::public.app_role, ''gerente''::public.app_role, ''admin_sistema''::public.app_role])) with check (app_private.has_any_role(array[''vendedor''::public.app_role, ''mesero''::public.app_role, ''gerente''::public.app_role, ''admin_sistema''::public.app_role]))',
        table_name
      );
    end if;
  end loop;
end $$;

grant execute on function public.pos_allocate_consumption(uuid, uuid, uuid, text, uuid, numeric, public.stock_unit) to authenticated;
grant execute on function public.create_pos_order(text, text, text, numeric, numeric, text, text, jsonb) to authenticated;
grant execute on function public.cancel_pos_order(uuid, text) to authenticated;

notify pgrst, 'reload schema';
