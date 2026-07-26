create table if not exists public.pizza_additions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  max_allowed integer not null default 1 check (max_allowed > 0),
  is_active boolean not null default true,
  is_available boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pizza_addition_sizes (
  id uuid primary key default gen_random_uuid(),
  addition_id uuid not null references public.pizza_additions(id) on delete restrict,
  pizza_size_id uuid not null references public.pizza_sizes(id) on delete restrict,
  quantity_base numeric(14,3) not null check (quantity_base > 0),
  unit public.stock_unit not null,
  display_quantity numeric(14,3) not null check (display_quantity > 0),
  display_unit public.stock_unit not null,
  cost_cop numeric(14,2) not null default 0 check (cost_cop >= 0),
  price_cop numeric(14,2) not null default 0 check (price_cop >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (addition_id, pizza_size_id),
  constraint pizza_addition_sizes_base_unit_check check (unit in ('g', 'ml', 'unit'))
);

create table if not exists public.pizza_addition_flavors (
  addition_id uuid not null references public.pizza_additions(id) on delete restrict,
  flavor_id uuid not null references public.pizza_flavors(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (addition_id, flavor_id)
);

create table if not exists public.pizza_addition_categories (
  addition_id uuid not null references public.pizza_additions(id) on delete restrict,
  menu_category_id uuid not null references public.menu_categories(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (addition_id, menu_category_id)
);

create index if not exists pizza_additions_inventory_item_id_idx on public.pizza_additions(inventory_item_id);
create index if not exists pizza_addition_sizes_addition_id_idx on public.pizza_addition_sizes(addition_id);
create index if not exists pizza_addition_sizes_pizza_size_id_idx on public.pizza_addition_sizes(pizza_size_id);
create index if not exists pizza_addition_flavors_flavor_id_idx on public.pizza_addition_flavors(flavor_id);
create index if not exists pizza_addition_categories_category_id_idx on public.pizza_addition_categories(menu_category_id);

alter table public.pizza_additions enable row level security;
alter table public.pizza_addition_sizes enable row level security;
alter table public.pizza_addition_flavors enable row level security;
alter table public.pizza_addition_categories enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['pizza_additions', 'pizza_addition_sizes', 'pizza_addition_flavors', 'pizza_addition_categories']
  loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = table_name and policyname = 'Managers can manage menu pizza additions'
    ) then
      execute format($policy$
        create policy "Managers can manage menu pizza additions"
          on public.%I for all
          to authenticated
          using (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]))
          with check (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]))
      $policy$, table_name);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
