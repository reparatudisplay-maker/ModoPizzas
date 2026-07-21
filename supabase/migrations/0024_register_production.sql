create table if not exists public.production_counters (
  id boolean primary key default true check (id = true),
  last_number bigint not null default 0
);

insert into public.production_counters (id, last_number)
values (true, 0)
on conflict (id) do nothing;

create table if not exists public.productions (
  id uuid primary key default gen_random_uuid(),
  production_number bigint not null unique,
  code text not null unique,
  preparation_id uuid not null references public.preparations(id) on delete restrict,
  storage_method text not null check (storage_method in ('ambient', 'refrigerated', 'frozen')),
  elaborated_at date not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  expected_quantity_base numeric(14, 3) not null check (expected_quantity_base > 0),
  actual_quantity_base numeric(14, 3) not null check (actual_quantity_base > 0),
  base_unit public.stock_unit not null,
  expiration_date date not null,
  total_cost_cop numeric(14, 2) not null check (total_cost_cop >= 0),
  unit_cost_cop numeric(14, 6) not null check (unit_cost_cop >= 0)
);

create table if not exists public.production_batches (
  id uuid primary key default gen_random_uuid(),
  batch_kind text not null default 'production' check (batch_kind in ('production', 'reconciliation')),
  production_id uuid unique references public.productions(id) on delete cascade,
  preparation_id uuid not null references public.preparations(id) on delete restrict,
  initial_quantity_base numeric(14, 3) not null check (initial_quantity_base > 0),
  base_unit public.stock_unit not null,
  unit_cost_cop numeric(14, 6) not null check (unit_cost_cop >= 0),
  expiration_date date not null,
  elaborated_at date not null,
  production_number bigint,
  created_at timestamptz not null default now(),
  constraint production_batches_kind_check check (
    (batch_kind = 'production' and production_id is not null and production_number is not null)
    or (batch_kind = 'reconciliation' and production_id is null)
  )
);

create table if not exists public.production_consumptions (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.productions(id) on delete cascade,
  source_kind text not null check (source_kind in ('inventory_item', 'preparation')),
  inventory_item_id uuid references public.inventory_items(id) on delete restrict,
  source_preparation_id uuid references public.preparations(id) on delete restrict,
  quantity_base numeric(14, 3) not null check (quantity_base > 0),
  base_unit public.stock_unit not null,
  cost_cop numeric(14, 2) not null check (cost_cop >= 0),
  created_at timestamptz not null default now(),
  constraint production_consumptions_source_check check (
    (source_kind = 'inventory_item' and inventory_item_id is not null and source_preparation_id is null)
    or (source_kind = 'preparation' and source_preparation_id is not null and inventory_item_id is null)
  )
);

create table if not exists public.production_consumption_allocations (
  id uuid primary key default gen_random_uuid(),
  consumption_id uuid not null references public.production_consumptions(id) on delete cascade,
  purchase_item_id uuid references public.purchase_items(id) on delete restrict,
  production_batch_id uuid references public.production_batches(id) on delete restrict,
  quantity_base numeric(14, 3) not null check (quantity_base > 0),
  base_unit public.stock_unit not null,
  cost_cop numeric(14, 2) not null check (cost_cop >= 0),
  created_at timestamptz not null default now(),
  constraint production_consumption_allocations_source_check check (
    (purchase_item_id is not null and production_batch_id is null)
    or (purchase_item_id is null and production_batch_id is not null)
  )
);

create index if not exists productions_preparation_id_idx on public.productions (preparation_id);
create index if not exists productions_elaborated_at_idx on public.productions (elaborated_at desc);
create index if not exists production_batches_preparation_id_idx on public.production_batches (preparation_id);
create index if not exists production_batches_fefo_idx on public.production_batches (preparation_id, expiration_date, elaborated_at, production_number);
create index if not exists production_consumptions_production_id_idx on public.production_consumptions (production_id);
create index if not exists production_consumptions_inventory_item_id_idx on public.production_consumptions (inventory_item_id);
create index if not exists production_consumptions_source_preparation_id_idx on public.production_consumptions (source_preparation_id);
create index if not exists production_allocations_purchase_item_id_idx on public.production_consumption_allocations (purchase_item_id);
create index if not exists production_allocations_batch_id_idx on public.production_consumption_allocations (production_batch_id);

alter table public.production_counters enable row level security;
alter table public.productions enable row level security;
alter table public.production_batches enable row level security;
alter table public.production_consumptions enable row level security;
alter table public.production_consumption_allocations enable row level security;

create or replace function public.production_unit_kind(unit_value public.stock_unit)
returns text
language sql
immutable
as $$
  select case
    when unit_value in ('g', 'kg') then 'weight'
    when unit_value in ('ml', 'l') then 'volume'
    else 'unit'
  end;
$$;

create or replace function public.production_convert_quantity(
  quantity_value numeric,
  from_unit public.stock_unit,
  to_unit public.stock_unit,
  density_g_ml numeric default null
)
returns numeric
language plpgsql
immutable
as $$
declare
  from_kind text := public.production_unit_kind(from_unit);
  to_kind text := public.production_unit_kind(to_unit);
  grams_value numeric;
  milliliters_value numeric;
begin
  if quantity_value <= 0 then
    raise exception 'La cantidad debe ser mayor a cero.';
  end if;

  if from_unit = to_unit then
    return quantity_value;
  end if;

  if from_kind = to_kind then
    if from_unit = 'kg' and to_unit = 'g' then return quantity_value * 1000; end if;
    if from_unit = 'g' and to_unit = 'kg' then return quantity_value / 1000; end if;
    if from_unit = 'l' and to_unit = 'ml' then return quantity_value * 1000; end if;
    if from_unit = 'ml' and to_unit = 'l' then return quantity_value / 1000; end if;
    raise exception 'Conversion de unidad no compatible.';
  end if;

  if from_kind = 'unit' or to_kind = 'unit' then
    raise exception 'La unidad no permite conversion peso-volumen.';
  end if;

  if density_g_ml is null or density_g_ml <= 0 then
    raise exception 'La conversion peso-volumen requiere densidad.';
  end if;

  if from_kind = 'weight' then
    grams_value := case when from_unit = 'kg' then quantity_value * 1000 else quantity_value end;
    milliliters_value := grams_value / density_g_ml;
    return case when to_unit = 'l' then milliliters_value / 1000 else milliliters_value end;
  end if;

  milliliters_value := case when from_unit = 'l' then quantity_value * 1000 else quantity_value end;
  grams_value := milliliters_value * density_g_ml;
  return case when to_unit = 'kg' then grams_value / 1000 else grams_value end;
end;
$$;

create or replace function public.create_production(
  p_preparation_id uuid,
  p_storage_method text,
  p_elaborated_at date,
  p_expiration_date date,
  p_expected_quantity numeric,
  p_expected_unit public.stock_unit,
  p_actual_quantity numeric,
  p_actual_unit public.stock_unit,
  p_items jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  preparation_row record;
  counter_row record;
  next_number bigint;
  new_production_id uuid;
  new_code text;
  expected_base numeric;
  actual_base numeric;
  total_cost numeric := 0;
  unit_cost numeric := 0;
  item jsonb;
  source_kind_value text;
  source_id_value uuid;
  source_base_unit public.stock_unit;
  source_unit_kind text;
  source_density numeric;
  requested_quantity numeric;
  requested_unit public.stock_unit;
  requested_base numeric;
  available_base numeric;
  remaining_base numeric;
  allocation_quantity numeric;
  allocation_cost numeric;
  consumption_id uuid;
  lot record;
begin
  if not app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]) then
    raise exception 'No tienes permisos para registrar produccion.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La produccion necesita al menos un ingrediente.';
  end if;

  select *
  into preparation_row
  from public.preparations
  where id = p_preparation_id
  for update;

  if not found then raise exception 'Preparacion no encontrada.'; end if;
  if not preparation_row.is_active then raise exception 'La preparacion debe estar activa.'; end if;
  if p_storage_method not in ('ambient', 'refrigerated', 'frozen') then raise exception 'Metodo de conservacion no valido.'; end if;

  if preparation_row.conservation_profile_id is not null and not exists (
    select 1
    from public.conservation_profile_rules
    where profile_id = preparation_row.conservation_profile_id
      and storage_method = p_storage_method
  ) then
    raise exception 'El metodo de conservacion no esta disponible para el perfil seleccionado.';
  end if;

  expected_base := public.production_convert_quantity(p_expected_quantity, p_expected_unit, preparation_row.base_unit, preparation_row.density);
  actual_base := public.production_convert_quantity(p_actual_quantity, p_actual_unit, preparation_row.base_unit, preparation_row.density);

  if expected_base <= 0 or actual_base <= 0 then raise exception 'Las cantidades deben ser mayores a cero.'; end if;
  if p_expiration_date < p_elaborated_at then raise exception 'El vencimiento no puede ser anterior a la elaboracion.'; end if;

  select *
  into counter_row
  from public.production_counters
  where id = true
  for update;

  next_number := counter_row.last_number + 1;
  new_code := 'P' || next_number::text;

  update public.production_counters
  set last_number = next_number
  where id = true;

  new_production_id := gen_random_uuid();

  insert into public.productions (
    id, production_number, code, preparation_id, storage_method, elaborated_at, created_by,
    expected_quantity_base, actual_quantity_base, base_unit, expiration_date, total_cost_cop, unit_cost_cop
  )
  values (
    new_production_id, next_number, new_code, p_preparation_id, p_storage_method, p_elaborated_at, auth.uid(),
    expected_base, actual_base, preparation_row.base_unit, p_expiration_date, 0, 0
  );

  for item in select * from jsonb_array_elements(p_items)
  loop
    source_kind_value := item->>'source_kind';
    source_id_value := (item->>'source_id')::uuid;
    requested_quantity := (item->>'quantity')::numeric;
    requested_unit := (item->>'unit')::public.stock_unit;

    if requested_quantity <= 0 then raise exception 'Cada ingrediente necesita cantidad mayor a cero.'; end if;

    if source_kind_value = 'inventory_item' then
      select unit, public.production_unit_kind(unit) as unit_kind
      into source_base_unit, source_unit_kind
      from public.inventory_items
      where id = source_id_value
        and is_active = true
        and item_kind = 'ingredient'
        and presentation_quantity is null;

      if source_base_unit is null then raise exception 'Ingrediente no valido.'; end if;
      requested_base := public.production_convert_quantity(requested_quantity, requested_unit, source_base_unit, null);

      select coalesce(sum(pi.quantity), 0) - coalesce((
        select sum(pca.quantity_base)
        from public.production_consumption_allocations pca
        where pca.purchase_item_id in (
          select pi2.id from public.purchase_items pi2 where pi2.inventory_item_id = source_id_value
        )
      ), 0)
      into available_base
      from public.purchase_items pi
      where pi.inventory_item_id = source_id_value;

      if available_base < requested_base then
        raise exception 'Stock insuficiente para ingrediente %. Faltan %.', source_id_value, requested_base - available_base;
      end if;

      insert into public.production_consumptions (
        production_id, source_kind, inventory_item_id, quantity_base, base_unit, cost_cop
      )
      values (new_production_id, 'inventory_item', source_id_value, requested_base, source_base_unit, 0)
      returning id into consumption_id;

      remaining_base := requested_base;
      for lot in
        select
          pi.id,
          pi.quantity,
          pi.unit,
          pi.line_total_cop,
          pi.expiration_date,
          p.purchased_at,
          pi.quantity - coalesce((
            select sum(pca.quantity_base)
            from public.production_consumption_allocations pca
            where pca.purchase_item_id = pi.id
          ), 0) as available_quantity
        from public.purchase_items pi
        join public.purchases p on p.id = pi.purchase_id
        where pi.inventory_item_id = source_id_value
          and pi.quantity - coalesce((
            select sum(pca.quantity_base)
            from public.production_consumption_allocations pca
            where pca.purchase_item_id = pi.id
          ), 0) > 0
        order by pi.expiration_date asc nulls last, p.purchased_at asc, pi.id asc
        for update of pi
      loop
        exit when remaining_base <= 0;
        allocation_quantity := least(remaining_base, lot.available_quantity);
        allocation_cost := round(allocation_quantity * (lot.line_total_cop / nullif(lot.quantity, 0)), 2);

        insert into public.production_consumption_allocations (
          consumption_id, purchase_item_id, quantity_base, base_unit, cost_cop
        )
        values (consumption_id, lot.id, allocation_quantity, source_base_unit, allocation_cost);

        remaining_base := remaining_base - allocation_quantity;
        total_cost := total_cost + allocation_cost;
      end loop;

      if remaining_base > 0.0001 then raise exception 'Stock insuficiente durante la asignacion FEFO.'; end if;

      update public.production_consumptions
      set cost_cop = (
        select coalesce(sum(pca.cost_cop), 0)
        from public.production_consumption_allocations pca
        where pca.consumption_id = public.production_consumptions.id
      )
      where id = consumption_id;

    elsif source_kind_value = 'preparation' then
      select base_unit, unit_kind, density
      into source_base_unit, source_unit_kind, source_density
      from public.preparations
      where id = source_id_value
        and is_active = true;

      if source_base_unit is null then raise exception 'Preparacion ingrediente no valida.'; end if;
      requested_base := public.production_convert_quantity(requested_quantity, requested_unit, source_base_unit, source_density);

      select coalesce(sum(pb.initial_quantity_base), 0) - coalesce((
        select sum(pca.quantity_base)
        from public.production_consumption_allocations pca
        where pca.production_batch_id in (
          select pb2.id from public.production_batches pb2 where pb2.preparation_id = source_id_value
        )
      ), 0)
      into available_base
      from public.production_batches pb
      where pb.preparation_id = source_id_value;

      if available_base < requested_base then
        raise exception 'Stock insuficiente para preparacion %. Faltan %.', source_id_value, requested_base - available_base;
      end if;

      insert into public.production_consumptions (
        production_id, source_kind, source_preparation_id, quantity_base, base_unit, cost_cop
      )
      values (new_production_id, 'preparation', source_id_value, requested_base, source_base_unit, 0)
      returning id into consumption_id;

      remaining_base := requested_base;
      for lot in
        select
          pb.id,
          pb.initial_quantity_base,
          pb.unit_cost_cop,
          pb.expiration_date,
          pb.elaborated_at,
          pb.production_number,
          pb.initial_quantity_base - coalesce((
            select sum(pca.quantity_base)
            from public.production_consumption_allocations pca
            where pca.production_batch_id = pb.id
          ), 0) as available_quantity
        from public.production_batches pb
        where pb.preparation_id = source_id_value
          and pb.initial_quantity_base - coalesce((
            select sum(pca.quantity_base)
            from public.production_consumption_allocations pca
            where pca.production_batch_id = pb.id
          ), 0) > 0
        order by pb.expiration_date asc, pb.elaborated_at asc, pb.production_number asc
        for update of pb
      loop
        exit when remaining_base <= 0;
        allocation_quantity := least(remaining_base, lot.available_quantity);
        allocation_cost := round(allocation_quantity * lot.unit_cost_cop, 2);

        insert into public.production_consumption_allocations (
          consumption_id, production_batch_id, quantity_base, base_unit, cost_cop
        )
        values (consumption_id, lot.id, allocation_quantity, source_base_unit, allocation_cost);

        remaining_base := remaining_base - allocation_quantity;
        total_cost := total_cost + allocation_cost;
      end loop;

      if remaining_base > 0.0001 then raise exception 'Stock insuficiente durante la asignacion FEFO.'; end if;

      update public.production_consumptions
      set cost_cop = (
        select coalesce(sum(pca.cost_cop), 0)
        from public.production_consumption_allocations pca
        where pca.consumption_id = public.production_consumptions.id
      )
      where id = consumption_id;
    else
      raise exception 'Tipo de ingrediente no valido.';
    end if;
  end loop;

  unit_cost := case when actual_base > 0 then total_cost / actual_base else 0 end;

  update public.productions
  set total_cost_cop = round(total_cost, 2),
      unit_cost_cop = round(unit_cost, 6)
  where id = new_production_id;

  insert into public.production_batches (
    batch_kind, production_id, preparation_id, initial_quantity_base, base_unit,
    unit_cost_cop, expiration_date, elaborated_at, production_number
  )
  values (
    'production', new_production_id, p_preparation_id, actual_base, preparation_row.base_unit,
    round(unit_cost, 6), p_expiration_date, p_elaborated_at, next_number
  );

  return jsonb_build_object(
    'id', new_production_id,
    'code', new_code,
    'total_cost_cop', round(total_cost, 2),
    'unit_cost_cop', round(unit_cost, 6),
    'expiration_date', p_expiration_date,
    'actual_quantity_base', actual_base,
    'base_unit', preparation_row.base_unit
  );
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'production_counters' and policyname = 'Managers can manage production counters'
  ) then
    create policy "Managers can manage production counters"
      on public.production_counters for all
      to authenticated
      using (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]))
      with check (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'productions' and policyname = 'Managers can manage productions'
  ) then
    create policy "Managers can manage productions"
      on public.productions for all
      to authenticated
      using (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]))
      with check (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'production_batches' and policyname = 'Managers can manage production batches'
  ) then
    create policy "Managers can manage production batches"
      on public.production_batches for all
      to authenticated
      using (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]))
      with check (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'production_consumptions' and policyname = 'Managers can manage production consumptions'
  ) then
    create policy "Managers can manage production consumptions"
      on public.production_consumptions for all
      to authenticated
      using (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]))
      with check (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'production_consumption_allocations' and policyname = 'Managers can manage production allocations'
  ) then
    create policy "Managers can manage production allocations"
      on public.production_consumption_allocations for all
      to authenticated
      using (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]))
      with check (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]));
  end if;
end $$;

grant execute on function public.create_production(uuid, text, date, date, numeric, public.stock_unit, numeric, public.stock_unit, jsonb) to authenticated;

notify pgrst, 'reload schema';
