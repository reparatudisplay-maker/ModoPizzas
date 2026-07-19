alter table public.inventory_items
  add column if not exists image_url text;

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', false)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Managers can read product images'
  ) then
    create policy "Managers can read product images"
      on storage.objects for select
      to authenticated
      using (
        bucket_id = 'product-images'
        and app_private.has_any_role(array[
          'gerente'::public.app_role,
          'admin_sistema'::public.app_role
        ])
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Managers can upload product images'
  ) then
    create policy "Managers can upload product images"
      on storage.objects for insert
      to authenticated
      with check (
        bucket_id = 'product-images'
        and app_private.has_any_role(array[
          'gerente'::public.app_role,
          'admin_sistema'::public.app_role
        ])
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Managers can update product images'
  ) then
    create policy "Managers can update product images"
      on storage.objects for update
      to authenticated
      using (
        bucket_id = 'product-images'
        and app_private.has_any_role(array[
          'gerente'::public.app_role,
          'admin_sistema'::public.app_role
        ])
      )
      with check (
        bucket_id = 'product-images'
        and app_private.has_any_role(array[
          'gerente'::public.app_role,
          'admin_sistema'::public.app_role
        ])
      );
  end if;
end $$;
