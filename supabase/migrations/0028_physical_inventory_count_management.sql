alter table public.physical_inventory_counts
  add column if not exists updated_at timestamptz null,
  add column if not exists updated_by uuid null references auth.users(id) on delete set null,
  add column if not exists voided_at timestamptz null,
  add column if not exists voided_by uuid null references auth.users(id) on delete set null,
  add column if not exists void_reason text null;

create index if not exists physical_inventory_counts_active_created_at_idx
on public.physical_inventory_counts (created_at desc)
where voided_at is null;

notify pgrst, 'reload schema';
