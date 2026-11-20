create table public.pos_user_product_view_settings (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_user_product_view_settings_object_check check (jsonb_typeof(settings) = 'object')
);

alter table public.pos_user_product_view_settings enable row level security;

create policy "Users can read own POS product view settings"
  on public.pos_user_product_view_settings for select
  to authenticated
  using ((select auth.uid()) = profile_id);

create policy "Users can create own POS product view settings"
  on public.pos_user_product_view_settings for insert
  to authenticated
  with check ((select auth.uid()) = profile_id);

create policy "Users can update own POS product view settings"
  on public.pos_user_product_view_settings for update
  to authenticated
  using ((select auth.uid()) = profile_id)
  with check ((select auth.uid()) = profile_id);

create function public.set_pos_user_product_view_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger set_pos_user_product_view_settings_updated_at
before update on public.pos_user_product_view_settings
for each row execute function public.set_pos_user_product_view_settings_updated_at();
