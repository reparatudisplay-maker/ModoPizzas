create table if not exists public.combo_configs (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  description text,
  image_url text,
  sale_price_cop numeric(14,2) not null default 0 check (sale_price_cop >= 0),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.combo_groups (
  id uuid primary key default gen_random_uuid(),
  combo_id uuid not null references public.combo_configs(id) on delete cascade,
  name text not null,
  group_kind text not null check (group_kind in ('pizza', 'sale_product')),
  quantity_to_choose integer not null default 1 check (quantity_to_choose > 0),
  is_required boolean not null default true,
  pizza_size_id uuid references public.pizza_sizes(id) on delete restrict,
  allow_all_flavors boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint combo_groups_kind_config_check check (
    (group_kind = 'pizza' and pizza_size_id is not null)
    or (group_kind = 'sale_product' and pizza_size_id is null)
  )
);

create table if not exists public.combo_group_options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.combo_groups(id) on delete cascade,
  pizza_flavor_id uuid references public.pizza_flavors(id) on delete restrict,
  inventory_item_id uuid references public.inventory_items(id) on delete restrict,
  supplement_cop numeric(14,2) not null default 0 check (supplement_cop >= 0),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint combo_group_options_exact_source_check check (
    (pizza_flavor_id is not null and inventory_item_id is null)
    or (pizza_flavor_id is null and inventory_item_id is not null)
  )
);

create table if not exists public.pos_order_combo_snapshots (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.pos_orders(id) on delete cascade,
  combo_config_id uuid references public.combo_configs(id) on delete set null,
  cart_line_key text,
  sku text,
  name text not null,
  quantity integer not null check (quantity > 0),
  unit_price_cop numeric(14,2) not null default 0,
  supplement_cop numeric(14,2) not null default 0,
  normal_price_cop numeric(14,2) not null default 0,
  savings_cop numeric(14,2) not null default 0,
  choices jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists combo_configs_active_sort_idx on public.combo_configs(is_active, sort_order, name);
create index if not exists combo_groups_combo_sort_idx on public.combo_groups(combo_id, sort_order);
create index if not exists combo_group_options_group_sort_idx on public.combo_group_options(group_id, sort_order);
create index if not exists combo_group_options_pizza_flavor_idx on public.combo_group_options(pizza_flavor_id);
create index if not exists combo_group_options_inventory_item_idx on public.combo_group_options(inventory_item_id);
create index if not exists pos_order_combo_snapshots_order_idx on public.pos_order_combo_snapshots(order_id);

alter table public.combo_configs enable row level security;
alter table public.combo_groups enable row level security;
alter table public.combo_group_options enable row level security;
alter table public.pos_order_combo_snapshots enable row level security;

drop policy if exists "Staff can read combo configs" on public.combo_configs;
create policy "Staff can read combo configs"
  on public.combo_configs for select
  using (
    public.current_user_can_access_module('menu')
    or public.current_user_can_access_module('pedidos')
  );

drop policy if exists "Menu managers can write combo configs" on public.combo_configs;
create policy "Menu managers can write combo configs"
  on public.combo_configs for all
  using (public.current_user_can_access_module('menu'))
  with check (public.current_user_can_access_module('menu'));

drop policy if exists "Staff can read combo groups" on public.combo_groups;
create policy "Staff can read combo groups"
  on public.combo_groups for select
  using (
    public.current_user_can_access_module('menu')
    or public.current_user_can_access_module('pedidos')
  );

drop policy if exists "Menu managers can write combo groups" on public.combo_groups;
create policy "Menu managers can write combo groups"
  on public.combo_groups for all
  using (public.current_user_can_access_module('menu'))
  with check (public.current_user_can_access_module('menu'));

drop policy if exists "Staff can read combo options" on public.combo_group_options;
create policy "Staff can read combo options"
  on public.combo_group_options for select
  using (
    public.current_user_can_access_module('menu')
    or public.current_user_can_access_module('pedidos')
  );

drop policy if exists "Menu managers can write combo options" on public.combo_group_options;
create policy "Menu managers can write combo options"
  on public.combo_group_options for all
  using (public.current_user_can_access_module('menu'))
  with check (public.current_user_can_access_module('menu'));

drop policy if exists "Staff can read combo sale snapshots" on public.pos_order_combo_snapshots;
create policy "Staff can read combo sale snapshots"
  on public.pos_order_combo_snapshots for select
  using (
    public.current_user_can_access_module('pedidos')
    or public.current_user_can_access_module('caja')
    or public.current_user_can_access_module('reportes')
  );

drop policy if exists "POS can insert combo sale snapshots" on public.pos_order_combo_snapshots;
create policy "POS can insert combo sale snapshots"
  on public.pos_order_combo_snapshots for insert
  with check (public.current_user_can_access_module('pedidos'));

create or replace function public.set_combo_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_combo_configs_updated_at on public.combo_configs;
create trigger set_combo_configs_updated_at
before update on public.combo_configs
for each row execute function public.set_combo_updated_at();

drop trigger if exists set_combo_groups_updated_at on public.combo_groups;
create trigger set_combo_groups_updated_at
before update on public.combo_groups
for each row execute function public.set_combo_updated_at();

drop trigger if exists set_combo_group_options_updated_at on public.combo_group_options;
create trigger set_combo_group_options_updated_at
before update on public.combo_group_options
for each row execute function public.set_combo_updated_at();

create or replace function public.reserve_combo_sku(p_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized text;
  prefix text;
  candidate text;
  suffix integer := 0;
begin
  if not (public.current_user_can_access_module('menu')) then
    raise exception 'No tienes permiso para crear combos.';
  end if;

  normalized := upper(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9]+', '', 'g'));
  prefix := 'CMB' || left(coalesce(nullif(normalized, ''), 'COMBO'), 3);
  candidate := prefix;

  while exists (select 1 from public.combo_configs where sku = candidate) loop
    suffix := suffix + 1;
    candidate := prefix || lpad(suffix::text, 2, '0');
  end loop;

  return candidate;
end;
$$;

grant execute on function public.reserve_combo_sku(text) to authenticated;

