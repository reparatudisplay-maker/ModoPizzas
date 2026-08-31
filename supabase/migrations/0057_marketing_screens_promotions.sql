create table if not exists public.marketing_screen_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  resolution_preset text not null default '1920x1080' check (resolution_preset in ('1920x1080', '1280x720', 'custom')),
  width_px integer not null default 1920 check (width_px > 0),
  height_px integer not null default 1080 check (height_px > 0),
  orientation text not null default 'landscape' check (orientation in ('landscape', 'portrait')),
  duration_total_seconds numeric(10,2) not null default 0 check (duration_total_seconds >= 0),
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  export_settings jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name)
);

create table if not exists public.marketing_screen_scenes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.marketing_screen_projects(id) on delete cascade,
  name text not null,
  sort_order integer not null default 1 check (sort_order > 0),
  duration_seconds numeric(10,2) not null default 8 check (duration_seconds > 0),
  background jsonb not null default '{"type":"color","value":"#17120f"}'::jsonb,
  transition text not null default 'fade' check (transition in ('cut', 'fade', 'slide')),
  elements jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, sort_order) deferrable initially immediate
);

create table if not exists public.marketing_promotions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  image_url text,
  main_text text not null,
  secondary_text text,
  normal_price_cop numeric(14,2) check (normal_price_cop is null or normal_price_cop >= 0),
  promo_price_cop numeric(14,2) check (promo_price_cop is null or promo_price_cop >= 0),
  starts_at date,
  ends_at date,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'expired')),
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketing_promotions_dates_check check (ends_at is null or starts_at is null or ends_at >= starts_at),
  unique (name)
);

create table if not exists public.marketing_promotion_pizza_prices (
  promotion_id uuid not null references public.marketing_promotions(id) on delete cascade,
  pizza_price_config_id uuid not null references public.pizza_price_configs(id) on delete restrict,
  primary key (promotion_id, pizza_price_config_id)
);

create table if not exists public.marketing_promotion_sale_products (
  promotion_id uuid not null references public.marketing_promotions(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  primary key (promotion_id, inventory_item_id)
);

create table if not exists public.marketing_promotion_screen_projects (
  promotion_id uuid not null references public.marketing_promotions(id) on delete cascade,
  project_id uuid not null references public.marketing_screen_projects(id) on delete cascade,
  primary key (promotion_id, project_id)
);

create index if not exists marketing_screen_scenes_project_order_idx on public.marketing_screen_scenes(project_id, sort_order);
create index if not exists marketing_promotions_status_idx on public.marketing_promotions(status, is_active);
create index if not exists marketing_promotion_pizza_prices_price_idx on public.marketing_promotion_pizza_prices(pizza_price_config_id);
create index if not exists marketing_promotion_sale_products_item_idx on public.marketing_promotion_sale_products(inventory_item_id);

insert into public.app_permissions (code, module_key, module_label, action_key, action_label, is_critical, sort_order)
values
  ('marketing_pantallas.view', 'marketing_pantallas', 'Marketing / Pantallas', 'view', 'Ver', false, 120),
  ('marketing_pantallas.create', 'marketing_pantallas', 'Marketing / Pantallas', 'create', 'Crear', false, 121),
  ('marketing_pantallas.edit', 'marketing_pantallas', 'Marketing / Pantallas', 'edit', 'Editar', false, 122),
  ('marketing_pantallas.delete', 'marketing_pantallas', 'Marketing / Pantallas', 'delete', 'Eliminar', false, 123),
  ('marketing_pantallas.export', 'marketing_pantallas', 'Marketing / Pantallas', 'export', 'Exportar', false, 124),
  ('marketing_promociones.view', 'marketing_promociones', 'Marketing / Promociones', 'view', 'Ver', false, 130),
  ('marketing_promociones.create', 'marketing_promociones', 'Marketing / Promociones', 'create', 'Crear', false, 131),
  ('marketing_promociones.edit', 'marketing_promociones', 'Marketing / Promociones', 'edit', 'Editar', false, 132),
  ('marketing_promociones.delete', 'marketing_promociones', 'Marketing / Promociones', 'delete', 'Eliminar', false, 133)
on conflict (code) do update
  set module_key = excluded.module_key,
      module_label = excluded.module_label,
      action_key = excluded.action_key,
      action_label = excluded.action_label,
      is_critical = excluded.is_critical,
      sort_order = excluded.sort_order;

insert into public.app_role_permissions (role, permission_code)
select 'admin_sistema'::public.app_role, code
from public.app_permissions
where code like 'marketing_%'
on conflict do nothing;

insert into public.app_role_permissions (role, permission_code)
select 'gerente'::public.app_role, code
from public.app_permissions
where code like 'marketing_%'
on conflict do nothing;

alter table public.marketing_screen_projects enable row level security;
alter table public.marketing_screen_scenes enable row level security;
alter table public.marketing_promotions enable row level security;
alter table public.marketing_promotion_pizza_prices enable row level security;
alter table public.marketing_promotion_sale_products enable row level security;
alter table public.marketing_promotion_screen_projects enable row level security;

create policy "Marketing screens can read projects"
  on public.marketing_screen_projects for select to authenticated
  using (public.current_user_has_permission('marketing_pantallas.view'));
create policy "Marketing screens can create projects"
  on public.marketing_screen_projects for insert to authenticated
  with check (public.current_user_has_permission('marketing_pantallas.create'));
create policy "Marketing screens can edit projects"
  on public.marketing_screen_projects for update to authenticated
  using (public.current_user_has_permission('marketing_pantallas.edit'))
  with check (public.current_user_has_permission('marketing_pantallas.edit'));
create policy "Marketing screens can delete projects"
  on public.marketing_screen_projects for delete to authenticated
  using (public.current_user_has_permission('marketing_pantallas.delete'));

create policy "Marketing screens can read scenes"
  on public.marketing_screen_scenes for select to authenticated
  using (public.current_user_has_permission('marketing_pantallas.view'));
create policy "Marketing screens can create scenes"
  on public.marketing_screen_scenes for insert to authenticated
  with check (public.current_user_has_permission('marketing_pantallas.create') or public.current_user_has_permission('marketing_pantallas.edit'));
create policy "Marketing screens can edit scenes"
  on public.marketing_screen_scenes for update to authenticated
  using (public.current_user_has_permission('marketing_pantallas.edit'))
  with check (public.current_user_has_permission('marketing_pantallas.edit'));
create policy "Marketing screens can delete scenes"
  on public.marketing_screen_scenes for delete to authenticated
  using (public.current_user_has_permission('marketing_pantallas.delete') or public.current_user_has_permission('marketing_pantallas.edit'));

create policy "Marketing promotions can read"
  on public.marketing_promotions for select to authenticated
  using (public.current_user_has_permission('marketing_promociones.view'));
create policy "Marketing promotions can create"
  on public.marketing_promotions for insert to authenticated
  with check (public.current_user_has_permission('marketing_promociones.create'));
create policy "Marketing promotions can edit"
  on public.marketing_promotions for update to authenticated
  using (public.current_user_has_permission('marketing_promociones.edit'))
  with check (public.current_user_has_permission('marketing_promociones.edit'));
create policy "Marketing promotions can delete"
  on public.marketing_promotions for delete to authenticated
  using (public.current_user_has_permission('marketing_promociones.delete'));

create policy "Marketing promotion pizza prices can read"
  on public.marketing_promotion_pizza_prices for select to authenticated
  using (public.current_user_has_permission('marketing_promociones.view'));
create policy "Marketing promotion pizza prices can create"
  on public.marketing_promotion_pizza_prices for insert to authenticated
  with check (public.current_user_has_permission('marketing_promociones.create') or public.current_user_has_permission('marketing_promociones.edit'));
create policy "Marketing promotion pizza prices can delete"
  on public.marketing_promotion_pizza_prices for delete to authenticated
  using (public.current_user_has_permission('marketing_promociones.edit') or public.current_user_has_permission('marketing_promociones.delete'));

create policy "Marketing promotion sale products can read"
  on public.marketing_promotion_sale_products for select to authenticated
  using (public.current_user_has_permission('marketing_promociones.view'));
create policy "Marketing promotion sale products can create"
  on public.marketing_promotion_sale_products for insert to authenticated
  with check (public.current_user_has_permission('marketing_promociones.create') or public.current_user_has_permission('marketing_promociones.edit'));
create policy "Marketing promotion sale products can delete"
  on public.marketing_promotion_sale_products for delete to authenticated
  using (public.current_user_has_permission('marketing_promociones.edit') or public.current_user_has_permission('marketing_promociones.delete'));

create policy "Marketing promotion screens can read"
  on public.marketing_promotion_screen_projects for select to authenticated
  using (public.current_user_has_permission('marketing_promociones.view') or public.current_user_has_permission('marketing_pantallas.view'));
create policy "Marketing promotion screens can create"
  on public.marketing_promotion_screen_projects for insert to authenticated
  with check (public.current_user_has_permission('marketing_promociones.create') or public.current_user_has_permission('marketing_promociones.edit'));
create policy "Marketing promotion screens can delete"
  on public.marketing_promotion_screen_projects for delete to authenticated
  using (public.current_user_has_permission('marketing_promociones.edit') or public.current_user_has_permission('marketing_promociones.delete'));

grant select, insert, update, delete on public.marketing_screen_projects to authenticated;
grant select, insert, update, delete on public.marketing_screen_scenes to authenticated;
grant select, insert, update, delete on public.marketing_promotions to authenticated;
grant select, insert, update, delete on public.marketing_promotion_pizza_prices to authenticated;
grant select, insert, update, delete on public.marketing_promotion_sale_products to authenticated;
grant select, insert, update, delete on public.marketing_promotion_screen_projects to authenticated;

notify pgrst, 'reload schema';
