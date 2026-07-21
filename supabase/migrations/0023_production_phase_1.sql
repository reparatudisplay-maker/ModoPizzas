create table if not exists public.conservation_profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conservation_profile_rules (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.conservation_profiles(id) on delete cascade,
  storage_method text not null check (storage_method in ('ambient', 'refrigerated', 'frozen')),
  duration_value integer not null check (duration_value > 0),
  duration_unit text not null check (duration_unit in ('hours', 'days', 'weeks', 'months')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conservation_profile_rules_profile_method_unique unique (profile_id, storage_method)
);

create table if not exists public.preparations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  image_url text,
  unit_kind text not null check (unit_kind in ('weight', 'volume', 'unit')),
  base_unit public.stock_unit not null,
  alternative_unit public.stock_unit,
  density numeric(14, 6) check (density is null or density > 0),
  conservation_profile_id uuid references public.conservation_profiles(id) on delete set null,
  base_yield_quantity numeric(14, 3) not null check (base_yield_quantity > 0),
  base_yield_unit public.stock_unit not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint preparations_base_unit_kind_check check (
    (unit_kind = 'weight' and base_unit in ('g', 'kg') and base_yield_unit in ('g', 'kg'))
    or (unit_kind = 'volume' and base_unit in ('ml', 'l') and base_yield_unit in ('ml', 'l'))
    or (unit_kind = 'unit' and base_unit = 'unit' and base_yield_unit = 'unit')
  ),
  constraint preparations_alternative_unit_kind_check check (
    alternative_unit is null
    or (unit_kind = 'weight' and alternative_unit in ('g', 'kg', 'ml', 'l'))
    or (unit_kind = 'volume' and alternative_unit in ('g', 'kg', 'ml', 'l'))
    or (unit_kind = 'unit' and alternative_unit = 'unit')
  ),
  constraint preparations_density_for_cross_unit_check check (
    density is not null
    or alternative_unit is null
    or (unit_kind = 'weight' and alternative_unit in ('g', 'kg'))
    or (unit_kind = 'volume' and alternative_unit in ('ml', 'l'))
    or unit_kind = 'unit'
  )
);

create table if not exists public.preparation_recipe_items (
  id uuid primary key default gen_random_uuid(),
  preparation_id uuid not null references public.preparations(id) on delete cascade,
  source_kind text not null check (source_kind in ('inventory_item', 'preparation')),
  inventory_item_id uuid references public.inventory_items(id) on delete restrict,
  source_preparation_id uuid references public.preparations(id) on delete restrict,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit public.stock_unit not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint preparation_recipe_items_source_check check (
    (source_kind = 'inventory_item' and inventory_item_id is not null and source_preparation_id is null)
    or (source_kind = 'preparation' and source_preparation_id is not null and inventory_item_id is null)
  ),
  constraint preparation_recipe_items_no_self_check check (
    source_preparation_id is null or source_preparation_id <> preparation_id
  )
);

create or replace function public.preparation_recipe_would_cycle(target_preparation_id uuid, source_id uuid)
returns boolean
language sql
stable
as $$
  with recursive graph(parent_id, child_id) as (
    select preparation_id, source_preparation_id
    from public.preparation_recipe_items
    where source_kind = 'preparation'
      and source_preparation_id is not null

    union all

    select graph.parent_id, pri.source_preparation_id
    from graph
    join public.preparation_recipe_items pri
      on pri.preparation_id = graph.child_id
    where pri.source_kind = 'preparation'
      and pri.source_preparation_id is not null
  )
  select exists (
    select 1
    from graph
    where parent_id = source_id
      and child_id = target_preparation_id
  );
$$;

create or replace function public.prevent_preparation_recipe_cycle()
returns trigger
language plpgsql
as $$
begin
  if new.source_kind = 'preparation' then
    if new.source_preparation_id = new.preparation_id then
      raise exception 'Una preparacion no puede usarse como ingrediente de si misma.';
    end if;

    if public.preparation_recipe_would_cycle(new.preparation_id, new.source_preparation_id) then
      raise exception 'La receta genera un ciclo entre preparaciones.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_preparation_recipe_cycle_trigger on public.preparation_recipe_items;
create trigger prevent_preparation_recipe_cycle_trigger
before insert or update on public.preparation_recipe_items
for each row execute function public.prevent_preparation_recipe_cycle();

alter table public.conservation_profiles enable row level security;
alter table public.conservation_profile_rules enable row level security;
alter table public.preparations enable row level security;
alter table public.preparation_recipe_items enable row level security;

create index if not exists conservation_profiles_is_active_name_idx
  on public.conservation_profiles (is_active, name);

create index if not exists conservation_profile_rules_profile_id_idx
  on public.conservation_profile_rules (profile_id);

create index if not exists preparations_is_active_name_idx
  on public.preparations (is_active, name);

create index if not exists preparations_conservation_profile_id_idx
  on public.preparations (conservation_profile_id);

create index if not exists preparation_recipe_items_preparation_id_idx
  on public.preparation_recipe_items (preparation_id);

create index if not exists preparation_recipe_items_inventory_item_id_idx
  on public.preparation_recipe_items (inventory_item_id);

create index if not exists preparation_recipe_items_source_preparation_id_idx
  on public.preparation_recipe_items (source_preparation_id);

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'conservation_profiles'
      and policyname = 'Managers can manage conservation profiles'
  ) then
    create policy "Managers can manage conservation profiles"
      on public.conservation_profiles for all
      to authenticated
      using (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]))
      with check (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'conservation_profile_rules'
      and policyname = 'Managers can manage conservation profile rules'
  ) then
    create policy "Managers can manage conservation profile rules"
      on public.conservation_profile_rules for all
      to authenticated
      using (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]))
      with check (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'preparations'
      and policyname = 'Managers can manage preparations'
  ) then
    create policy "Managers can manage preparations"
      on public.preparations for all
      to authenticated
      using (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]))
      with check (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'preparation_recipe_items'
      and policyname = 'Managers can manage preparation recipe items'
  ) then
    create policy "Managers can manage preparation recipe items"
      on public.preparation_recipe_items for all
      to authenticated
      using (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]))
      with check (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]));
  end if;
end $$;

notify pgrst, 'reload schema';
