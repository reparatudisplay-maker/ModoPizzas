create policy "Managers can update site settings"
  on public.site_settings for update
  to authenticated
  using (
    app_private.has_any_role(array[
      'gerente'::public.app_role,
      'admin_sistema'::public.app_role
    ])
  )
  with check (
    app_private.has_any_role(array[
      'gerente'::public.app_role,
      'admin_sistema'::public.app_role
    ])
  );

create policy "Admins can assign roles"
  on public.user_roles for insert
  to authenticated
  with check (app_private.has_role('admin_sistema'::public.app_role));

create policy "Admins can remove roles"
  on public.user_roles for delete
  to authenticated
  using (app_private.has_role('admin_sistema'::public.app_role));
