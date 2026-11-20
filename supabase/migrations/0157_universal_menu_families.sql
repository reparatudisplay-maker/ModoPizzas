begin;

-- Base configurable para cualquier familia de platos. No migra ni altera los
-- registros históricos de pizza; la adopción se hace por familia y por etapas.
create table if not exists public.menu_families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_families_name_unique unique (name),
  constraint menu_families_slug_unique unique (slug),
  constraint menu_families_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create table if not exists public.menu_family_presentations (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.menu_families(id) on delete cascade,
  name text not null,
  description text,
  sort_order integer not null default 0 check (sort_order >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_family_presentations_name_unique unique (family_id, name)
);

create table if not exists public.menu_family_items (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.menu_families(id) on delete restrict,
  sku text not null unique,
  name text not null,
  commercial_description text,
  image_url text,
  is_active boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_family_items_name_unique unique (family_id, name)
);

create table if not exists public.menu_family_recipe_components (
  id uuid primary key default gen_random_uuid(),
  family_item_id uuid not null references public.menu_family_items(id) on delete cascade,
  presentation_id uuid references public.menu_family_presentations(id) on delete cascade,
  source_kind text not null check (source_kind in ('inventory_item', 'preparation')),
  inventory_item_id uuid references public.inventory_items(id) on delete restrict,
  source_preparation_id uuid references public.preparations(id) on delete restrict,
  quantity_base numeric(14,3) not null check (quantity_base > 0),
  base_unit public.stock_unit not null,
  option_group text,
  is_required boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_family_recipe_components_source_check check (
    (source_kind = 'inventory_item' and inventory_item_id is not null and source_preparation_id is null)
    or (source_kind = 'preparation' and source_preparation_id is not null and inventory_item_id is null)
  )
);

create unique index if not exists menu_family_recipe_components_source_unique
  on public.menu_family_recipe_components (
    family_item_id,
    coalesce(presentation_id, '00000000-0000-0000-0000-000000000000'::uuid),
    source_kind,
    coalesce(inventory_item_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(source_preparation_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(option_group, '')
  );

create table if not exists public.menu_family_recipe_substitutions (
  id uuid primary key default gen_random_uuid(),
  component_id uuid not null references public.menu_family_recipe_components(id) on delete cascade,
  source_kind text not null check (source_kind in ('inventory_item', 'preparation')),
  inventory_item_id uuid references public.inventory_items(id) on delete restrict,
  source_preparation_id uuid references public.preparations(id) on delete restrict,
  quantity_base numeric(14,3) not null check (quantity_base > 0),
  base_unit public.stock_unit not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_family_recipe_substitutions_source_check check (
    (source_kind = 'inventory_item' and inventory_item_id is not null and source_preparation_id is null)
    or (source_kind = 'preparation' and source_preparation_id is not null and inventory_item_id is null)
  )
);

create unique index if not exists menu_family_recipe_substitutions_source_unique
  on public.menu_family_recipe_substitutions (
    component_id,
    source_kind,
    coalesce(inventory_item_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(source_preparation_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create table if not exists public.menu_family_prices (
  id uuid primary key default gen_random_uuid(),
  family_item_id uuid not null references public.menu_family_items(id) on delete restrict,
  presentation_id uuid references public.menu_family_presentations(id) on delete restrict,
  sale_price_cop numeric(14,2) not null check (sale_price_cop >= 0),
  is_active boolean not null default true,
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_family_prices_dates_check check (valid_until is null or valid_until > valid_from)
);

create unique index if not exists menu_family_prices_current_unique
  on public.menu_family_prices (family_item_id, coalesce(presentation_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where is_active and valid_until is null;

create table if not exists public.menu_family_additions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.menu_families(id) on delete cascade,
  sku text not null unique,
  name text not null,
  source_kind text not null check (source_kind in ('inventory_item', 'preparation')),
  inventory_item_id uuid references public.inventory_items(id) on delete restrict,
  source_preparation_id uuid references public.preparations(id) on delete restrict,
  quantity_base numeric(14,3) not null check (quantity_base > 0),
  base_unit public.stock_unit not null,
  sale_price_cop numeric(14,2) not null check (sale_price_cop >= 0),
  max_allowed integer not null default 1 check (max_allowed > 0),
  is_active boolean not null default true,
  is_available boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_family_additions_source_check check (
    (source_kind = 'inventory_item' and inventory_item_id is not null and source_preparation_id is null)
    or (source_kind = 'preparation' and source_preparation_id is not null and inventory_item_id is null)
  ),
  constraint menu_family_additions_name_unique unique (family_id, name)
);

create table if not exists public.menu_family_addition_items (
  id uuid primary key default gen_random_uuid(),
  addition_id uuid not null references public.menu_family_additions(id) on delete cascade,
  family_item_id uuid not null references public.menu_family_items(id) on delete cascade,
  presentation_id uuid references public.menu_family_presentations(id) on delete cascade,
  created_at timestamptz not null default now()
);

create unique index if not exists menu_family_addition_items_unique
  on public.menu_family_addition_items (
    addition_id,
    family_item_id,
    coalesce(presentation_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create table if not exists public.menu_family_combos (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.menu_families(id) on delete restrict,
  sku text not null unique,
  name text not null,
  description text,
  image_url text,
  is_active boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_family_combos_name_unique unique (family_id, name)
);

create table if not exists public.menu_family_combo_variants (
  id uuid primary key default gen_random_uuid(),
  combo_id uuid not null references public.menu_family_combos(id) on delete cascade,
  name text not null,
  sale_price_cop numeric(14,2) not null check (sale_price_cop >= 0),
  is_active boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_family_combo_variants_name_unique unique (combo_id, name)
);

create table if not exists public.menu_family_combo_components (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.menu_family_combo_variants(id) on delete cascade,
  name text not null,
  source_kind text not null check (source_kind in ('family_item', 'inventory_item')),
  family_item_id uuid references public.menu_family_items(id) on delete restrict,
  inventory_item_id uuid references public.inventory_items(id) on delete restrict,
  presentation_id uuid references public.menu_family_presentations(id) on delete restrict,
  quantity integer not null default 1 check (quantity > 0),
  is_required boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_family_combo_components_source_check check (
    (source_kind = 'family_item' and family_item_id is not null and inventory_item_id is null)
    or (source_kind = 'inventory_item' and inventory_item_id is not null and family_item_id is null)
  )
);

create table if not exists public.menu_family_combo_component_options (
  id uuid primary key default gen_random_uuid(),
  component_id uuid not null references public.menu_family_combo_components(id) on delete cascade,
  source_kind text not null check (source_kind in ('family_item', 'inventory_item')),
  family_item_id uuid references public.menu_family_items(id) on delete restrict,
  inventory_item_id uuid references public.inventory_items(id) on delete restrict,
  presentation_id uuid references public.menu_family_presentations(id) on delete restrict,
  quantity integer not null default 1 check (quantity > 0),
  is_active boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_family_combo_component_options_source_check check (
    (source_kind = 'family_item' and family_item_id is not null and inventory_item_id is null)
    or (source_kind = 'inventory_item' and inventory_item_id is not null and family_item_id is null)
  )
);

create table if not exists public.menu_family_packaging_rules (
  id uuid primary key default gen_random_uuid(),
  family_item_id uuid not null references public.menu_family_items(id) on delete cascade,
  presentation_id uuid references public.menu_family_presentations(id) on delete cascade,
  service_kind text not null check (service_kind in ('local', 'pickup', 'takeaway', 'delivery')),
  packaging_inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  quantity_base numeric(14,3) not null check (quantity_base > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists menu_family_packaging_rules_unique
  on public.menu_family_packaging_rules (
    family_item_id,
    coalesce(presentation_id, '00000000-0000-0000-0000-000000000000'::uuid),
    service_kind,
    packaging_inventory_item_id
  );

create index if not exists menu_family_items_family_active_idx on public.menu_family_items(family_id, is_active, sort_order);
create index if not exists menu_family_prices_item_active_idx on public.menu_family_prices(family_item_id, is_active, valid_from desc);
create index if not exists menu_family_recipe_components_item_idx on public.menu_family_recipe_components(family_item_id, presentation_id, sort_order);
create index if not exists menu_family_combos_family_active_idx on public.menu_family_combos(family_id, is_active, sort_order);

-- Fuente única para POS, Cocina y catálogo público cuando una familia se active.
-- No modifica los adaptadores de pizza existentes ni publica artículos por sí sola.
create or replace view public.menu_family_active_catalog
with (security_invoker = true)
as
select
  family.id as family_id,
  family.name as family_name,
  family.slug as family_slug,
  item.id as family_item_id,
  item.sku,
  item.name,
  item.commercial_description,
  item.image_url,
  presentation.id as presentation_id,
  presentation.name as presentation_name,
  price.id as price_id,
  price.sale_price_cop
from public.menu_families family
join public.menu_family_items item on item.family_id = family.id and item.is_active
join public.menu_family_prices price on price.family_item_id = item.id and price.is_active and price.valid_until is null
left join public.menu_family_presentations presentation on presentation.id = price.presentation_id and presentation.is_active
where family.is_active;

create or replace function public.set_menu_family_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  target text;
begin
  foreach target in array array[
    'menu_families', 'menu_family_presentations', 'menu_family_items',
    'menu_family_recipe_components', 'menu_family_recipe_substitutions',
    'menu_family_prices', 'menu_family_additions', 'menu_family_combos',
    'menu_family_combo_variants', 'menu_family_combo_components',
    'menu_family_combo_component_options', 'menu_family_packaging_rules'
  ] loop
    execute format('drop trigger if exists %I on public.%I', 'set_' || target || '_updated_at', target);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_menu_family_updated_at()', 'set_' || target || '_updated_at', target);
  end loop;
end;
$$;

-- Evita referencias entre familias: una presentación, precio, empaque u opción
-- siempre queda ligada al mismo catálogo que su plato o combo.
create or replace function public.assert_menu_family_relation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  expected_family_id uuid;
  actual_family_id uuid;
begin
  if tg_table_name in ('menu_family_recipe_components', 'menu_family_prices', 'menu_family_packaging_rules') then
    select family_id into expected_family_id from public.menu_family_items where id = new.family_item_id;
  elsif tg_table_name = 'menu_family_addition_items' then
    select family_id into expected_family_id from public.menu_family_additions where id = new.addition_id;
    select family_id into actual_family_id from public.menu_family_items where id = new.family_item_id;
    if expected_family_id is distinct from actual_family_id then
      raise exception 'La adición y el plato deben pertenecer a la misma familia.';
    end if;
  elsif tg_table_name = 'menu_family_combo_components' then
    select combo.family_id into expected_family_id
    from public.menu_family_combo_variants variant
    join public.menu_family_combos combo on combo.id = variant.combo_id
    where variant.id = new.variant_id;
    if new.family_item_id is not null then
      select family_id into actual_family_id from public.menu_family_items where id = new.family_item_id;
      if expected_family_id is distinct from actual_family_id then
        raise exception 'El componente del combo debe pertenecer a la misma familia.';
      end if;
    end if;
  elsif tg_table_name = 'menu_family_combo_component_options' then
    select combo.family_id into expected_family_id
    from public.menu_family_combo_components component
    join public.menu_family_combo_variants variant on variant.id = component.variant_id
    join public.menu_family_combos combo on combo.id = variant.combo_id
    where component.id = new.component_id;
    if new.family_item_id is not null then
      select family_id into actual_family_id from public.menu_family_items where id = new.family_item_id;
      if expected_family_id is distinct from actual_family_id then
        raise exception 'La alternativa del combo debe pertenecer a la misma familia.';
      end if;
    end if;
  end if;

  if new.presentation_id is not null then
    select family_id into actual_family_id from public.menu_family_presentations where id = new.presentation_id;
    if expected_family_id is distinct from actual_family_id then
      raise exception 'La presentación debe pertenecer a la misma familia.';
    end if;
  end if;
  return new;
end;
$$;

do $$
declare
  target text;
begin
  foreach target in array array[
    'menu_family_recipe_components', 'menu_family_prices', 'menu_family_addition_items',
    'menu_family_combo_components', 'menu_family_combo_component_options', 'menu_family_packaging_rules'
  ] loop
    execute format('drop trigger if exists %I on public.%I', 'assert_' || target || '_family', target);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.assert_menu_family_relation()', 'assert_' || target || '_family', target);
  end loop;
end;
$$;

create or replace function public.create_menu_family(
  p_name text,
  p_slug text,
  p_description text default null
)
returns public.menu_families
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  created_family public.menu_families;
begin
  if not public.current_user_can_access_module('menu') then
    raise exception 'No tienes permiso para administrar familias de menú.';
  end if;
  if btrim(coalesce(p_name, '')) = '' or btrim(coalesce(p_slug, '')) = '' then
    raise exception 'Nombre y código de familia son obligatorios.';
  end if;

  insert into public.menu_families (name, slug, description, sort_order, created_by)
  values (
    upper(btrim(p_name)),
    lower(btrim(p_slug)),
    nullif(btrim(p_description), ''),
    coalesce((select max(sort_order) + 1 from public.menu_families), 1),
    auth.uid()
  )
  returning * into created_family;

  return created_family;
end;
$$;

revoke all on function public.create_menu_family(text, text, text) from public;
grant execute on function public.create_menu_family(text, text, text) to authenticated;

alter table public.menu_families enable row level security;
alter table public.menu_family_presentations enable row level security;
alter table public.menu_family_items enable row level security;
alter table public.menu_family_recipe_components enable row level security;
alter table public.menu_family_recipe_substitutions enable row level security;
alter table public.menu_family_prices enable row level security;
alter table public.menu_family_additions enable row level security;
alter table public.menu_family_addition_items enable row level security;
alter table public.menu_family_combos enable row level security;
alter table public.menu_family_combo_variants enable row level security;
alter table public.menu_family_combo_components enable row level security;
alter table public.menu_family_combo_component_options enable row level security;
alter table public.menu_family_packaging_rules enable row level security;

do $$
declare
  target text;
begin
  foreach target in array array[
    'menu_families', 'menu_family_presentations', 'menu_family_items',
    'menu_family_recipe_components', 'menu_family_recipe_substitutions',
    'menu_family_prices', 'menu_family_additions', 'menu_family_addition_items',
    'menu_family_combos', 'menu_family_combo_variants',
    'menu_family_combo_components', 'menu_family_combo_component_options',
    'menu_family_packaging_rules'
  ] loop
    execute format('drop policy if exists "Read universal menu families" on public.%I', target);
    execute format('create policy "Read universal menu families" on public.%I for select to authenticated using (public.current_user_can_access_module(''menu'') or public.current_user_can_access_module(''pedidos'') or public.current_user_can_access_module(''cocina''))', target);
    execute format('drop policy if exists "Manage universal menu families" on public.%I', target);
    execute format('create policy "Manage universal menu families" on public.%I for all to authenticated using (public.current_user_can_access_module(''menu'')) with check (public.current_user_can_access_module(''menu''))', target);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
commit;
