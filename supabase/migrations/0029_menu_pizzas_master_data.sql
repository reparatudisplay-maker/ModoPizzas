create table if not exists public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text null,
  sort_order integer not null default 0 check (sort_order >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pizza_sizes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  diameter_cm numeric(6,2) not null check (diameter_cm > 0),
  slices_count integer not null check (slices_count > 0),
  sort_order integer not null default 0 check (sort_order >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pizza_flavors (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  commercial_description text not null default '',
  image_url text null,
  allows_half_and_half boolean not null default true,
  menu_category_id uuid null references public.menu_categories(id) on delete set null,
  allergens text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists menu_categories_sort_order_idx on public.menu_categories (sort_order, name);
create index if not exists pizza_sizes_sort_order_idx on public.pizza_sizes (sort_order, name);
create index if not exists pizza_flavors_menu_category_id_idx on public.pizza_flavors (menu_category_id);
create index if not exists pizza_flavors_active_name_idx on public.pizza_flavors (is_active, name);

alter table public.menu_categories enable row level security;
alter table public.pizza_sizes enable row level security;
alter table public.pizza_flavors enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'menu_categories' and policyname = 'Managers can manage menu categories'
  ) then
    create policy "Managers can manage menu categories"
      on public.menu_categories for all
      to authenticated
      using (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]))
      with check (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pizza_sizes' and policyname = 'Managers can manage pizza sizes'
  ) then
    create policy "Managers can manage pizza sizes"
      on public.pizza_sizes for all
      to authenticated
      using (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]))
      with check (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pizza_flavors' and policyname = 'Managers can manage pizza flavors'
  ) then
    create policy "Managers can manage pizza flavors"
      on public.pizza_flavors for all
      to authenticated
      using (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]))
      with check (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]));
  end if;
end $$;

notify pgrst, 'reload schema';
