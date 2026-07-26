create table if not exists public.pizza_flavor_ingredients (
  id uuid primary key default gen_random_uuid(),
  flavor_id uuid not null references public.pizza_flavors(id) on delete restrict,
  source_kind text not null check (source_kind in ('inventory_item', 'preparation')),
  inventory_item_id uuid null references public.inventory_items(id) on delete restrict,
  source_preparation_id uuid null references public.preparations(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint pizza_flavor_ingredients_exact_source check (
    (source_kind = 'inventory_item' and inventory_item_id is not null and source_preparation_id is null)
    or
    (source_kind = 'preparation' and source_preparation_id is not null and inventory_item_id is null)
  )
);

create unique index if not exists pizza_flavor_ingredients_inventory_unique
  on public.pizza_flavor_ingredients (flavor_id, inventory_item_id)
  where source_kind = 'inventory_item';

create unique index if not exists pizza_flavor_ingredients_preparation_unique
  on public.pizza_flavor_ingredients (flavor_id, source_preparation_id)
  where source_kind = 'preparation';

alter table public.pizza_flavor_ingredients enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pizza_flavor_ingredients' and policyname = 'Managers can manage pizza flavor ingredients'
  ) then
    create policy "Managers can manage pizza flavor ingredients"
      on public.pizza_flavor_ingredients for all
      to authenticated
      using (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]))
      with check (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]));
  end if;
end $$;

create or replace function public.normalize_menu_order(p_section text)
returns void
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  target_table text;
begin
  if not app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]) then
    raise exception 'No tienes permiso para ordenar el menu.';
  end if;

  target_table := case p_section
    when 'menu_categories' then 'menu_categories'
    when 'pizza_sizes' then 'pizza_sizes'
    when 'pizza_flavors' then 'pizza_flavors'
    else null
  end;

  if target_table is null then
    raise exception 'Seccion de menu no valida.';
  end if;

  execute format('lock table public.%I in exclusive mode', target_table);
  execute format('update public.%I set sort_order = -sort_order where sort_order > 0', target_table);
  execute format($sql$
    with ordered as (
      select id, row_number() over (order by abs(sort_order), created_at, id)::integer as position
      from public.%I
    )
    update public.%I item
    set sort_order = ordered.position, updated_at = now()
    from ordered
    where item.id = ordered.id
  $sql$, target_table, target_table);
end;
$$;

grant execute on function public.normalize_menu_order(text) to authenticated;

notify pgrst, 'reload schema';
