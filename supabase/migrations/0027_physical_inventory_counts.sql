create table if not exists public.physical_inventory_counts (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null check (source_kind in ('inventory_item', 'preparation')),
  inventory_item_id uuid null references public.inventory_items(id) on delete restrict,
  source_preparation_id uuid null references public.preparations(id) on delete restrict,
  theoretical_quantity_base numeric(14,3) not null check (theoretical_quantity_base >= 0),
  physical_quantity_base numeric(14,3) not null check (physical_quantity_base >= 0),
  difference_quantity_base numeric(14,3) not null check (difference_quantity_base <> 0),
  base_unit public.stock_unit not null,
  average_cost_cop numeric(14,6) not null default 0 check (average_cost_cop >= 0),
  adjustment_kind text not null check (adjustment_kind in ('waste', 'adjustment_in')),
  reason text not null check (length(trim(reason)) > 0),
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint physical_inventory_counts_source_check check (
    (source_kind = 'inventory_item' and inventory_item_id is not null and source_preparation_id is null)
    or
    (source_kind = 'preparation' and source_preparation_id is not null and inventory_item_id is null)
  ),
  constraint physical_inventory_counts_difference_check check (
    (adjustment_kind = 'adjustment_in' and difference_quantity_base > 0)
    or
    (adjustment_kind = 'waste' and difference_quantity_base < 0)
  )
);

create index if not exists physical_inventory_counts_inventory_item_id_idx
on public.physical_inventory_counts (inventory_item_id);

create index if not exists physical_inventory_counts_preparation_id_idx
on public.physical_inventory_counts (source_preparation_id);

create index if not exists physical_inventory_counts_created_at_idx
on public.physical_inventory_counts (created_at desc);

alter table public.physical_inventory_counts enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'physical_inventory_counts'
      and policyname = 'Managers can manage physical inventory counts'
  ) then
    create policy "Managers can manage physical inventory counts"
      on public.physical_inventory_counts for all
      to authenticated
      using (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]))
      with check (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]));
  end if;
end $$;

notify pgrst, 'reload schema';
