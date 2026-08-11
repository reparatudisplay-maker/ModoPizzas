alter table public.kitchen_order_items
  add column if not exists received_at timestamptz not null default now();

update public.kitchen_order_items
set received_at = created_at
where received_at is null;

create table if not exists public.kitchen_settings (
  id boolean primary key default true check (id = true),
  oven_count integer not null default 1 check (oven_count > 0),
  oven_width_cm numeric(8,2) not null default 130 check (oven_width_cm > 0),
  oven_depth_cm numeric(8,2) not null default 50 check (oven_depth_cm > 0),
  sound_enabled_default boolean not null default true,
  warning_threshold_minutes integer not null default 12 check (warning_threshold_minutes >= 0),
  delay_threshold_minutes integer not null default 20 check (delay_threshold_minutes >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint kitchen_thresholds_check check (delay_threshold_minutes >= warning_threshold_minutes)
);

create table if not exists public.kitchen_size_settings (
  pizza_size_id uuid primary key references public.pizza_sizes(id) on delete cascade,
  simultaneous_capacity integer not null default 1 check (simultaneous_capacity > 0),
  assembly_minutes integer not null default 2 check (assembly_minutes >= 0),
  baking_minutes integer not null default 8 check (baking_minutes > 0),
  finishing_minutes integer not null default 1 check (finishing_minutes >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.kitchen_settings (id)
values (true)
on conflict (id) do nothing;

insert into public.kitchen_size_settings (
  pizza_size_id,
  simultaneous_capacity,
  assembly_minutes,
  baking_minutes,
  finishing_minutes
)
select
  ps.id,
  greatest(
    1,
    coalesce(floor(130 / nullif(ps.diameter_cm, 0)), 1)::integer
    * coalesce(floor(50 / nullif(ps.diameter_cm, 0)), 1)::integer
  ),
  2,
  8,
  1
from public.pizza_sizes ps
on conflict (pizza_size_id) do nothing;

create index if not exists kitchen_size_settings_updated_idx
  on public.kitchen_size_settings (updated_at desc);

alter table public.kitchen_settings enable row level security;
alter table public.kitchen_size_settings enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'kitchen_settings' and policyname = 'Kitchen staff can read kitchen settings'
  ) then
    create policy "Kitchen staff can read kitchen settings"
      on public.kitchen_settings for select
      to authenticated
      using (app_private.has_any_role(array['cocina'::public.app_role, 'gerente'::public.app_role, 'admin_sistema'::public.app_role]));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'kitchen_settings' and policyname = 'Managers can manage kitchen settings'
  ) then
    create policy "Managers can manage kitchen settings"
      on public.kitchen_settings for all
      to authenticated
      using (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]))
      with check (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'kitchen_size_settings' and policyname = 'Kitchen staff can read kitchen size settings'
  ) then
    create policy "Kitchen staff can read kitchen size settings"
      on public.kitchen_size_settings for select
      to authenticated
      using (app_private.has_any_role(array['cocina'::public.app_role, 'gerente'::public.app_role, 'admin_sistema'::public.app_role]));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'kitchen_size_settings' and policyname = 'Managers can manage kitchen size settings'
  ) then
    create policy "Managers can manage kitchen size settings"
      on public.kitchen_size_settings for all
      to authenticated
      using (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]))
      with check (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pizza_price_configs' and policyname = 'Kitchen staff can read pizza price configs'
  ) then
    create policy "Kitchen staff can read pizza price configs"
      on public.pizza_price_configs for select
      to authenticated
      using (app_private.has_any_role(array['cocina'::public.app_role, 'gerente'::public.app_role, 'admin_sistema'::public.app_role]));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pizza_sizes' and policyname = 'Kitchen staff can read pizza sizes'
  ) then
    create policy "Kitchen staff can read pizza sizes"
      on public.pizza_sizes for select
      to authenticated
      using (app_private.has_any_role(array['cocina'::public.app_role, 'gerente'::public.app_role, 'admin_sistema'::public.app_role]));
  end if;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.kitchen_order_items;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.pos_orders;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.pos_order_items;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.pos_order_item_additions;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

notify pgrst, 'reload schema';
