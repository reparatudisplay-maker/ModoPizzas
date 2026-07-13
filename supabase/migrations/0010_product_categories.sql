create table if not exists public.product_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_categories_name_unique unique (name)
);

alter table public.product_categories enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'product_categories'
      and policyname = 'Managers can manage product categories'
  ) then
    create policy "Managers can manage product categories"
      on public.product_categories for all
      to authenticated
      using (
        app_private.has_any_role(array[
          'gerente'::public.app_role,
          'admin_sistema'::public.app_role
        ])
      )
      with check (
        app_private.has_any_role(array[
          'gerente'::public.app_role,
          'admin_sistema'::public.app_role
        ])
      );
  end if;
end $$;

alter table public.inventory_items
  add column if not exists category_id uuid references public.product_categories(id);

create index if not exists inventory_items_category_id_idx on public.inventory_items (category_id);
create index if not exists product_categories_is_active_name_idx on public.product_categories (is_active, name);

insert into public.product_categories (name, description)
values
  ('Harinas', 'Harinas y bases para masas'),
  ('Quesos y lacteos', 'Quesos, lacteos y derivados'),
  ('Carnes frias', 'Peperoni, jamon, salami y embutidos'),
  ('Salsas', 'Salsas, bases y aderezos'),
  ('Vegetales', 'Vegetales y toppings frescos'),
  ('Bebidas', 'Bebidas y acompanantes liquidos'),
  ('Empaques', 'Cajas, bolsas, servilletas y empaques'),
  ('Aseo', 'Productos de limpieza y desinfeccion'),
  ('Otros', 'Productos sin categoria especifica')
on conflict (name) do update
set
  description = excluded.description,
  is_active = true,
  updated_at = now();
