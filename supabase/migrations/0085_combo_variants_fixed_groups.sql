-- Evoluciona los combos a variantes comerciales con precio fijo.
-- La migracion es aditiva: no modifica ni elimina datos historicos.
create table if not exists public.combo_variants (
  id uuid primary key default gen_random_uuid(),
  combo_config_id uuid not null,
  name text not null,
  sale_price_cop numeric(14,2) not null check (sale_price_cop >= 0),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.combo_variants
  add column if not exists combo_config_id uuid;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'combo_variants'
      and column_name = 'combo_id'
  ) then
    update public.combo_variants
    set combo_config_id = combo_id
    where combo_config_id is null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'combo_variants_combo_config_id_fkey'
      and conrelid = 'public.combo_variants'::regclass
  ) then
    alter table public.combo_variants
      add constraint combo_variants_combo_config_id_fkey
      foreign key (combo_config_id)
      references public.combo_configs(id)
      on delete cascade;
  end if;
end;
$$;

alter table public.combo_groups
  add column if not exists variant_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'combo_groups_variant_id_fkey'
      and conrelid = 'public.combo_groups'::regclass
  ) then
    alter table public.combo_groups
      add constraint combo_groups_variant_id_fkey
      foreign key (variant_id)
      references public.combo_variants(id)
      on delete cascade;
  end if;
end;
$$;

create index if not exists combo_variants_config_sort_idx
  on public.combo_variants(combo_config_id, sort_order, name);
create index if not exists combo_groups_variant_sort_idx
  on public.combo_groups(variant_id, sort_order);

alter table public.combo_variants enable row level security;

drop policy if exists "Staff can read combo variants" on public.combo_variants;
create policy "Staff can read combo variants"
  on public.combo_variants for select
  using (
    public.current_user_can_access_module('menu')
    or public.current_user_can_access_module('pedidos')
  );

drop policy if exists "Menu managers can write combo variants" on public.combo_variants;
create policy "Menu managers can write combo variants"
  on public.combo_variants for all
  using (public.current_user_can_access_module('menu'))
  with check (public.current_user_can_access_module('menu'));

drop trigger if exists set_combo_variants_updated_at on public.combo_variants;
create trigger set_combo_variants_updated_at
before update on public.combo_variants
for each row execute function public.set_combo_updated_at();

insert into public.combo_variants (combo_config_id, name, sale_price_cop, sort_order)
select c.id, 'GRUPO 1', c.sale_price_cop, 0
from public.combo_configs c
where not exists (
  select 1
  from public.combo_variants v
  where v.combo_config_id = c.id
);

update public.combo_groups g
set variant_id = v.id
from public.combo_variants v
where g.combo_id = v.combo_config_id
  and g.variant_id is null;

-- supplement_cop se conserva como legacy para no perder historicos.
-- La aplicacion nueva no lo lee ni lo escribe.

notify pgrst, 'reload schema';
