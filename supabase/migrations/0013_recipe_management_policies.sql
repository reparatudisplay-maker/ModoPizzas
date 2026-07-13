create policy "Managers can read all recipes"
  on public.recipes for select
  to authenticated
  using (
    app_private.has_any_role(array[
      'gerente'::public.app_role,
      'admin_sistema'::public.app_role
    ])
  );

create policy "Managers can write recipes"
  on public.recipes for all
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
