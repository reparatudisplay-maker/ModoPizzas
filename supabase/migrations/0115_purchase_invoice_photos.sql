begin;

alter table public.purchases
  add column if not exists invoice_photo_path text;

insert into storage.buckets (id, name, public)
values ('purchase-invoices', 'purchase-invoices', false)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Managers can read purchase invoice photos'
  ) then
    create policy "Managers can read purchase invoice photos"
      on storage.objects for select
      to authenticated
      using (
        bucket_id = 'purchase-invoices'
        and app_private.has_any_role(array[
          'gerente'::public.app_role,
          'admin_sistema'::public.app_role
        ])
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Managers can upload purchase invoice photos'
  ) then
    create policy "Managers can upload purchase invoice photos"
      on storage.objects for insert
      to authenticated
      with check (
        bucket_id = 'purchase-invoices'
        and app_private.has_any_role(array[
          'gerente'::public.app_role,
          'admin_sistema'::public.app_role
        ])
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Managers can update purchase invoice photos'
  ) then
    create policy "Managers can update purchase invoice photos"
      on storage.objects for update
      to authenticated
      using (
        bucket_id = 'purchase-invoices'
        and app_private.has_any_role(array[
          'gerente'::public.app_role,
          'admin_sistema'::public.app_role
        ])
      )
      with check (
        bucket_id = 'purchase-invoices'
        and app_private.has_any_role(array[
          'gerente'::public.app_role,
          'admin_sistema'::public.app_role
        ])
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Managers can delete purchase invoice photos'
  ) then
    create policy "Managers can delete purchase invoice photos"
      on storage.objects for delete
      to authenticated
      using (
        bucket_id = 'purchase-invoices'
        and app_private.has_any_role(array[
          'gerente'::public.app_role,
          'admin_sistema'::public.app_role
        ])
      );
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
