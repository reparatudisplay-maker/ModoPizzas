create policy "Managers can manage inventory items"
  on public.inventory_items for all
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

create policy "Managers can manage suppliers"
  on public.suppliers for all
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

create policy "Managers can manage purchases"
  on public.purchases for all
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

create policy "Managers can manage purchase items"
  on public.purchase_items for all
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

create policy "Managers can manage expenses"
  on public.expenses for all
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

create policy "Managers can manage inventory movements"
  on public.inventory_movements for all
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
