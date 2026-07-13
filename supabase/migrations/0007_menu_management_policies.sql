create policy "Managers can read all sizes"
  on public.pizza_sizes for select
  to authenticated
  using (
    app_private.has_any_role(array[
      'gerente'::public.app_role,
      'admin_sistema'::public.app_role
    ])
  );

create policy "Managers can write sizes"
  on public.pizza_sizes for all
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

create policy "Managers can read all flavors"
  on public.pizza_flavors for select
  to authenticated
  using (
    app_private.has_any_role(array[
      'gerente'::public.app_role,
      'admin_sistema'::public.app_role
    ])
  );

create policy "Managers can write flavors"
  on public.pizza_flavors for all
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

create policy "Managers can write flavor prices"
  on public.pizza_flavor_prices for all
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

create policy "Managers can read all extras"
  on public.pizza_extras for select
  to authenticated
  using (
    app_private.has_any_role(array[
      'gerente'::public.app_role,
      'admin_sistema'::public.app_role
    ])
  );

create policy "Managers can write extras"
  on public.pizza_extras for all
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

create policy "Managers can read all combos"
  on public.combos for select
  to authenticated
  using (
    app_private.has_any_role(array[
      'gerente'::public.app_role,
      'admin_sistema'::public.app_role
    ])
  );

create policy "Managers can write combos"
  on public.combos for all
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

create policy "Managers can write combo items"
  on public.combo_items for all
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
