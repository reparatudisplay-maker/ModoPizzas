create extension if not exists pgcrypto;

create type public.app_role as enum (
  'cliente',
  'vendedor',
  'mesero',
  'cocina',
  'mensajero',
  'gerente',
  'admin_sistema'
);

create type public.order_kind as enum ('delivery', 'pickup', 'local');

create type public.order_status as enum (
  'draft',
  'sent_to_whatsapp',
  'confirmed',
  'in_kitchen',
  'in_preparation',
  'prepared',
  'on_the_way',
  'delivered',
  'cancelled',
  'rejected',
  'closed'
);

create type public.stock_unit as enum ('g', 'kg', 'ml', 'l', 'unit');
create type public.print_job_kind as enum ('receipt_58mm', 'label_80x130mm');
create type public.payment_method as enum ('cash', 'transfer', 'card', 'cash_on_delivery', 'pending');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.site_settings (
  id boolean primary key default true,
  business_name text not null default 'ModoPizzas',
  whatsapp_number text not null default '573001234567',
  whatsapp_enabled boolean not null default true,
  whatsapp_button_text text not null default 'Finalizar por WhatsApp',
  primary_color text not null default '#c43d2f',
  secondary_color text not null default '#216869',
  updated_at timestamptz not null default now(),
  constraint site_settings_singleton check (id)
);

create table public.legal_pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  body text not null default '',
  is_published boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.pizza_sizes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  display_order integer not null default 0,
  is_active boolean not null default true,
  supports_half_and_half boolean not null default true
);

create table public.pizza_flavors (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text not null default '',
  allergens text[] not null default '{}',
  is_featured boolean not null default false,
  is_public boolean not null default true,
  is_active boolean not null default true
);

create table public.pizza_flavor_prices (
  flavor_id uuid not null references public.pizza_flavors(id) on delete cascade,
  size_id uuid not null references public.pizza_sizes(id) on delete cascade,
  price_cop integer not null check (price_cop >= 0),
  primary key (flavor_id, size_id)
);

create table public.pizza_extras (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  price_cop integer not null default 0 check (price_cop >= 0),
  extra_kind text not null default 'addition',
  is_active boolean not null default true
);

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  sku text unique,
  name text not null,
  unit public.stock_unit not null,
  current_quantity numeric(14, 3) not null default 0,
  average_cost_cop numeric(14, 2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  flavor_id uuid references public.pizza_flavors(id) on delete cascade,
  size_id uuid references public.pizza_sizes(id) on delete cascade,
  extra_id uuid references public.pizza_extras(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id),
  quantity numeric(14, 3) not null check (quantity > 0),
  unit public.stock_unit not null,
  check (
    (flavor_id is not null and size_id is not null and extra_id is null)
    or (flavor_id is null and size_id is null and extra_id is not null)
  )
);

create table public.combos (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text not null default '',
  price_cop integer not null check (price_cop >= 0),
  is_public boolean not null default true,
  is_active boolean not null default true
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku text unique,
  name text not null,
  description text not null default '',
  category text not null default 'general',
  unit_price_cop integer not null check (unit_price_cop >= 0),
  inventory_item_id uuid references public.inventory_items(id),
  is_public boolean not null default true,
  is_active boolean not null default true
);

create table public.combo_items (
  id uuid primary key default gen_random_uuid(),
  combo_id uuid not null references public.combos(id) on delete cascade,
  item_label text not null,
  quantity numeric(14, 3) not null default 1
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated by default as identity unique,
  auth_user_id uuid references auth.users(id) on delete set null,
  kind public.order_kind not null,
  status public.order_status not null default 'draft',
  customer_name text,
  customer_phone text,
  delivery_address text,
  delivery_neighborhood text,
  delivery_notes text,
  subtotal_cop integer not null default 0,
  discount_cop integer not null default 0,
  delivery_fee_cop integer not null default 0,
  total_cop integer not null default 0,
  payment_method public.payment_method not null default 'pending',
  payment_reference text,
  external_invoice_provider text,
  external_invoice_id text,
  created_by uuid references auth.users(id) on delete set null,
  assigned_courier_id uuid references auth.users(id) on delete set null,
  duplicate_guard_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  check (total_cop >= 0),
  check (
    kind <> 'delivery'
    or (customer_name is not null and customer_phone is not null and delivery_address is not null)
  )
);

create unique index orders_duplicate_guard_recent_idx
  on public.orders (duplicate_guard_hash)
  where duplicate_guard_hash is not null
    and status in ('draft', 'sent_to_whatsapp', 'confirmed');

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  item_kind text not null check (item_kind in ('pizza', 'combo', 'product')),
  size_id uuid references public.pizza_sizes(id),
  flavor_a_id uuid references public.pizza_flavors(id),
  flavor_b_id uuid references public.pizza_flavors(id),
  crust_extra_id uuid references public.pizza_extras(id),
  combo_id uuid references public.combos(id),
  product_id uuid references public.products(id),
  quantity integer not null default 1 check (quantity > 0),
  unit_price_cop integer not null check (unit_price_cop >= 0),
  line_total_cop integer not null check (line_total_cop >= 0),
  notes text,
  created_at timestamptz not null default now()
);

create table public.order_item_extras (
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  extra_id uuid not null references public.pizza_extras(id),
  price_cop integer not null default 0,
  primary key (order_item_id, extra_id)
);

create table public.order_status_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  from_status public.order_status,
  to_status public.order_status not null,
  actor_id uuid references auth.users(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

create table public.cash_register_sessions (
  id uuid primary key default gen_random_uuid(),
  opened_by uuid not null references auth.users(id),
  closed_by uuid references auth.users(id),
  opening_cash_cop integer not null default 0,
  closing_cash_cop integer,
  expected_cash_cop integer,
  notes text,
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  cash_session_id uuid references public.cash_register_sessions(id),
  method public.payment_method not null,
  amount_cop integer not null check (amount_cop >= 0),
  reference text,
  received_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  notes text,
  is_active boolean not null default true
);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references public.suppliers(id),
  purchased_by uuid references auth.users(id) on delete set null,
  total_cop numeric(14, 2) not null default 0,
  notes text,
  purchased_at timestamptz not null default now()
);

create table public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id),
  quantity numeric(14, 3) not null check (quantity > 0),
  unit public.stock_unit not null,
  unit_cost_cop numeric(14, 2) not null check (unit_cost_cop >= 0),
  line_total_cop numeric(14, 2) not null check (line_total_cop >= 0)
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  description text not null,
  amount_cop numeric(14, 2) not null check (amount_cop >= 0),
  paid_by uuid references auth.users(id) on delete set null,
  paid_at timestamptz not null default now()
);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items(id),
  movement_kind text not null check (movement_kind in ('purchase', 'sale', 'adjustment', 'waste')),
  quantity_delta numeric(14, 3) not null,
  unit public.stock_unit not null,
  source_table text,
  source_id uuid,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.print_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  kind public.print_job_kind not null,
  requested_by uuid references auth.users(id) on delete set null,
  payload jsonb not null,
  printed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_table text not null,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.site_settings enable row level security;
alter table public.legal_pages enable row level security;
alter table public.pizza_sizes enable row level security;
alter table public.pizza_flavors enable row level security;
alter table public.pizza_flavor_prices enable row level security;
alter table public.pizza_extras enable row level security;
alter table public.inventory_items enable row level security;
alter table public.recipes enable row level security;
alter table public.combos enable row level security;
alter table public.products enable row level security;
alter table public.combo_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_item_extras enable row level security;
alter table public.order_status_events enable row level security;
alter table public.cash_register_sessions enable row level security;
alter table public.payments enable row level security;
alter table public.suppliers enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;
alter table public.expenses enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.print_jobs enable row level security;
alter table public.audit_logs enable row level security;

create policy "Public can read active site settings"
  on public.site_settings for select
  to anon, authenticated
  using (true);

create policy "Public can read published legal pages"
  on public.legal_pages for select
  to anon, authenticated
  using (is_published);

create policy "Public can read active sizes"
  on public.pizza_sizes for select
  to anon, authenticated
  using (is_active);

create policy "Public can read public flavors"
  on public.pizza_flavors for select
  to anon, authenticated
  using (is_public and is_active);

create policy "Public can read flavor prices"
  on public.pizza_flavor_prices for select
  to anon, authenticated
  using (true);

create policy "Public can read active extras"
  on public.pizza_extras for select
  to anon, authenticated
  using (is_active);

create policy "Public can read active combos"
  on public.combos for select
  to anon, authenticated
  using (is_public and is_active);

create policy "Public can read active products"
  on public.products for select
  to anon, authenticated
  using (is_public and is_active);

create policy "Public can read combo items"
  on public.combo_items for select
  to anon, authenticated
  using (true);

create policy "Users can read own profile"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "Users can update own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "Users can read own roles"
  on public.user_roles for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Customers can read own orders"
  on public.orders for select
  to authenticated
  using ((select auth.uid()) = auth_user_id);

create policy "Customers can create own draft orders"
  on public.orders for insert
  to authenticated
  with check ((select auth.uid()) = auth_user_id and status in ('draft', 'sent_to_whatsapp'));

create policy "Customers can cancel own early orders"
  on public.orders for update
  to authenticated
  using ((select auth.uid()) = auth_user_id and status in ('draft', 'sent_to_whatsapp', 'confirmed'))
  with check ((select auth.uid()) = auth_user_id and status = 'cancelled');

create policy "Customers can read own order items"
  on public.order_items for select
  to authenticated
  using (
    exists (
      select 1
      from public.orders
      where orders.id = order_items.order_id
        and orders.auth_user_id = (select auth.uid())
    )
  );

create policy "Customers can create items for own draft orders"
  on public.order_items for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.orders
      where orders.id = order_items.order_id
        and orders.auth_user_id = (select auth.uid())
        and orders.status in ('draft', 'sent_to_whatsapp')
    )
  );

create policy "Customers can read own order item extras"
  on public.order_item_extras for select
  to authenticated
  using (
    exists (
      select 1
      from public.order_items
      join public.orders on orders.id = order_items.order_id
      where order_items.id = order_item_extras.order_item_id
        and orders.auth_user_id = (select auth.uid())
    )
  );

insert into public.site_settings (id)
values (true)
on conflict (id) do nothing;

insert into public.pizza_sizes (code, name, description, display_order)
values
  ('porcion', 'Porcion', 'Una porcion rapida para antojos.', 1),
  ('personal', 'Personal', 'Ideal para una persona.', 2),
  ('mediana', 'Mediana', 'Perfecta para compartir.', 3),
  ('grande', 'Grande', 'La opcion familiar inicial.', 4);

insert into public.pizza_flavors (code, name, description, allergens, is_featured)
values
  ('hawaiana', 'Hawaiana', 'Jamon, pina y queso mozzarella.', array['lacteos', 'gluten'], true),
  ('carnes', 'Carnes', 'Pepperoni, jamon, salami y carne molida.', array['lacteos', 'gluten'], true),
  ('pollo-champinon', 'Pollo Champinon', 'Pollo desmechado, champinones y salsa de la casa.', array['lacteos', 'gluten'], false),
  ('vegetariana', 'Vegetariana', 'Pimenton, cebolla, tomate, champinones y aceitunas.', array['lacteos', 'gluten'], false);

insert into public.pizza_flavor_prices (flavor_id, size_id, price_cop)
select flavor.id, size.id, price.price_cop
from (
  values
    ('hawaiana', 'porcion', 6500),
    ('hawaiana', 'personal', 18000),
    ('hawaiana', 'mediana', 29000),
    ('hawaiana', 'grande', 39000),
    ('carnes', 'porcion', 7500),
    ('carnes', 'personal', 21000),
    ('carnes', 'mediana', 34000),
    ('carnes', 'grande', 46000),
    ('pollo-champinon', 'porcion', 7200),
    ('pollo-champinon', 'personal', 20500),
    ('pollo-champinon', 'mediana', 33000),
    ('pollo-champinon', 'grande', 44000),
    ('vegetariana', 'porcion', 6200),
    ('vegetariana', 'personal', 17500),
    ('vegetariana', 'mediana', 28000),
    ('vegetariana', 'grande', 38000)
) as price(flavor_code, size_code, price_cop)
join public.pizza_flavors flavor on flavor.code = price.flavor_code
join public.pizza_sizes size on size.code = price.size_code;

insert into public.pizza_extras (code, name, price_cop, extra_kind)
values
  ('normal', 'Borde normal', 0, 'crust'),
  ('queso', 'Borde de queso', 6000, 'crust'),
  ('bocadillo', 'Borde bocadillo', 5000, 'crust'),
  ('extra-queso', 'Extra queso', 4500, 'addition'),
  ('maiz', 'Maiz', 2500, 'addition'),
  ('tocineta', 'Tocineta', 5500, 'addition'),
  ('jalapenos', 'Jalapenos', 2500, 'addition');

insert into public.combos (code, name, description, price_cop)
values
  ('combo-familiar', 'Combo Familiar', 'Pizza grande, gaseosa 1.5 L y pan de ajo.', 59900),
  ('combo-doble', 'Doble Personal', 'Dos pizzas personales con borde normal.', 34900);

insert into public.combo_items (combo_id, item_label, quantity)
select combo.id, item.item_label, item.quantity
from (
  values
    ('combo-familiar', 'Pizza grande a eleccion', 1),
    ('combo-familiar', 'Gaseosa 1.5 L', 1),
    ('combo-familiar', 'Pan de ajo', 1),
    ('combo-doble', 'Pizza personal', 2),
    ('combo-doble', 'Borde normal', 2)
) as item(combo_code, item_label, quantity)
join public.combos combo on combo.code = item.combo_code;

insert into public.legal_pages (slug, title, is_published)
values
  ('acerca-de', 'Acerca de', true),
  ('tratamiento-de-datos', 'Politica de Tratamiento de Datos', true),
  ('terminos-condiciones', 'Terminos y Condiciones', true),
  ('reversion-pagos', 'Reversion de Pagos', true),
  ('alergenos', 'Politica de Alergenos', true),
  ('sugerencias-reclamos', 'Sugerencias y Reclamos', true),
  ('aviso-privacidad', 'Aviso de privacidad', true);
