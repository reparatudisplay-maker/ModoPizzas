alter table public.menu_sku_reservations drop constraint if exists menu_sku_reservations_section_check;
alter table public.menu_sku_reservations
  add constraint menu_sku_reservations_section_check
  check (section in ('menu_categories', 'pizza_sizes', 'pizza_flavors', 'pizza_additions', 'pizza_prices'));

create table if not exists public.pizza_price_configs (
  id uuid primary key default gen_random_uuid(),
  sku text not null,
  flavor_id uuid not null references public.pizza_flavors(id) on delete restrict,
  size_id uuid not null references public.pizza_sizes(id) on delete restrict,
  sale_price_cop numeric(14,2) not null default 0 check (sale_price_cop >= 0),
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (flavor_id, size_id)
);

create table if not exists public.pizza_price_components (
  id uuid primary key default gen_random_uuid(),
  price_config_id uuid not null references public.pizza_price_configs(id) on delete cascade,
  source_kind text not null check (source_kind in ('inventory_item', 'preparation')),
  inventory_item_id uuid null references public.inventory_items(id) on delete restrict,
  source_preparation_id uuid null references public.preparations(id) on delete restrict,
  quantity_base numeric(14,3) not null check (quantity_base > 0),
  unit public.stock_unit not null,
  display_quantity numeric(14,3) not null check (display_quantity > 0),
  display_unit public.stock_unit not null,
  created_at timestamptz not null default now(),
  constraint pizza_price_components_exact_source check (
    (source_kind = 'inventory_item' and inventory_item_id is not null and source_preparation_id is null)
    or
    (source_kind = 'preparation' and source_preparation_id is not null and inventory_item_id is null)
  )
);

create unique index if not exists pizza_price_components_inventory_unique
  on public.pizza_price_components (price_config_id, inventory_item_id)
  where source_kind = 'inventory_item';

create unique index if not exists pizza_price_components_preparation_unique
  on public.pizza_price_components (price_config_id, source_preparation_id)
  where source_kind = 'preparation';

create table if not exists public.pizza_price_history (
  id uuid primary key default gen_random_uuid(),
  price_config_id uuid not null references public.pizza_price_configs(id) on delete cascade,
  estimated_cost_cop numeric(14,2) null check (estimated_cost_cop is null or estimated_cost_cop >= 0),
  sale_price_cop numeric(14,2) not null check (sale_price_cop >= 0),
  margin_percent numeric(8,3) null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pizza_price_configs_sku_unique') then
    alter table public.pizza_price_configs add constraint pizza_price_configs_sku_unique unique (sku);
  end if;
end $$;

create index if not exists pizza_price_configs_flavor_id_idx on public.pizza_price_configs(flavor_id);
create index if not exists pizza_price_configs_size_id_idx on public.pizza_price_configs(size_id);
create index if not exists pizza_price_components_config_id_idx on public.pizza_price_components(price_config_id);
create index if not exists pizza_price_history_config_created_idx on public.pizza_price_history(price_config_id, created_at desc);

create or replace function public.reserve_pizza_price_sku(p_flavor_id uuid, p_size_id uuid)
returns text
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  flavor_name text;
  size_name text;
  candidate_base text;
  candidate text;
  suffix_number integer := 0;
begin
  select name into flavor_name from public.pizza_flavors where id = p_flavor_id;
  select name into size_name from public.pizza_sizes where id = p_size_id;
  if flavor_name is null or size_name is null then
    raise exception 'Sabor o tamano no valido.';
  end if;

  candidate_base := 'PP' || app_private.menu_sku_stem(flavor_name) || app_private.menu_sku_stem(size_name);

  loop
    candidate := candidate_base || case when suffix_number = 0 then '' else lpad(suffix_number::text, 2, '0') end;
    begin
      insert into public.menu_sku_reservations (section, sku) values ('pizza_prices', candidate);
      return candidate;
    exception when unique_violation then
      suffix_number := suffix_number + 1;
    end;
  end loop;
end;
$$;

drop trigger if exists prevent_pizza_price_configs_sku_change on public.pizza_price_configs;
create trigger prevent_pizza_price_configs_sku_change
  before update of sku on public.pizza_price_configs
  for each row execute function app_private.prevent_menu_sku_change();

alter table public.pizza_price_configs enable row level security;
alter table public.pizza_price_components enable row level security;
alter table public.pizza_price_history enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['pizza_price_configs', 'pizza_price_components', 'pizza_price_history']
  loop
    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public' and tablename = table_name and policyname = 'Managers can manage menu pizza prices'
    ) then
      execute format(
        'create policy "Managers can manage menu pizza prices" on public.%I for all to authenticated using (app_private.has_any_role(array[''gerente''::public.app_role, ''admin_sistema''::public.app_role])) with check (app_private.has_any_role(array[''gerente''::public.app_role, ''admin_sistema''::public.app_role]))',
        table_name
      );
    end if;
  end loop;
end $$;

grant execute on function public.reserve_pizza_price_sku(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
