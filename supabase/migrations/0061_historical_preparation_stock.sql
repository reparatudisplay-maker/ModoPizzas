alter table public.production_batches
  drop constraint if exists production_batches_batch_kind_check;

alter table public.production_batches
  add constraint production_batches_batch_kind_check
  check (batch_kind in ('production', 'reconciliation', 'historical_preparation'));

alter table public.production_batches
  drop constraint if exists production_batches_kind_check;

alter table public.production_batches
  add constraint production_batches_kind_check
  check (
    (batch_kind in ('production', 'historical_preparation') and production_id is not null and production_number is not null)
    or (batch_kind = 'reconciliation' and production_id is null)
  );

create table if not exists public.preparation_historical_stock_entries (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null unique references public.productions(id) on delete restrict,
  production_batch_id uuid not null unique references public.production_batches(id) on delete restrict,
  preparation_id uuid not null references public.preparations(id) on delete restrict,
  quantity_base numeric(14,3) not null check (quantity_base > 0),
  base_unit public.stock_unit not null,
  total_cost_cop numeric(14,2) not null check (total_cost_cop >= 0),
  unit_cost_cop numeric(14,6) not null check (unit_cost_cop >= 0),
  elaborated_at date not null,
  expiration_date date not null,
  reason text not null check (length(trim(reason)) > 0),
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists preparation_historical_stock_entries_preparation_id_idx
on public.preparation_historical_stock_entries (preparation_id);

create index if not exists preparation_historical_stock_entries_created_at_idx
on public.preparation_historical_stock_entries (created_at desc);

alter table public.preparation_historical_stock_entries enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'preparation_historical_stock_entries'
      and policyname = 'Managers can manage historical preparation stock'
  ) then
    create policy "Managers can manage historical preparation stock"
      on public.preparation_historical_stock_entries for all
      to authenticated
      using (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]))
      with check (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]));
  end if;
end $$;

create or replace function public.register_historical_preparation_stock(
  p_preparation_id uuid,
  p_quantity numeric,
  p_unit public.stock_unit,
  p_total_cost_cop numeric,
  p_elaborated_at date,
  p_expiration_date date,
  p_reason text
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
  new_code text;
  new_production_id uuid;
  new_batch_id uuid;
  elaboration_date date := coalesce(p_elaborated_at, current_date);
  quantity_base numeric;
  unit_cost numeric;
begin
  if not app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]) then
    raise exception 'No tienes permisos para registrar stock historico de preparaciones.';
  end if;

  if p_preparation_id is null then raise exception 'Selecciona una preparacion.'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'La cantidad debe ser mayor a cero.'; end if;
  if p_total_cost_cop is null or p_total_cost_cop < 0 then raise exception 'El costo total no puede ser negativo.'; end if;
  if p_expiration_date is null then raise exception 'Ingresa el vencimiento.'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'Ingresa el motivo u observacion.'; end if;

  select *
  into preparation_row
  from public.preparations
  where id = p_preparation_id
  for update;

  if not found then raise exception 'Preparacion no encontrada.'; end if;
  if not preparation_row.is_active then raise exception 'La preparacion debe estar activa.'; end if;
  if p_expiration_date < elaboration_date then raise exception 'El vencimiento no puede ser anterior a la elaboracion.'; end if;

  quantity_base := public.production_convert_quantity(p_quantity, p_unit, preparation_row.base_unit, preparation_row.density);
  unit_cost := case when quantity_base > 0 then p_total_cost_cop / quantity_base else 0 end;

  insert into public.production_counters (id, last_number)
  values (true, 0)
  on conflict (id) do nothing;

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
  new_batch_id := gen_random_uuid();

  insert into public.productions (
    id, production_number, code, preparation_id, storage_method, elaborated_at, created_by,
    expected_quantity_base, actual_quantity_base, base_unit, expiration_date, total_cost_cop, unit_cost_cop
  )
  values (
    new_production_id, next_number, new_code, p_preparation_id, 'ambient', elaboration_date, auth.uid(),
    quantity_base, quantity_base, preparation_row.base_unit, p_expiration_date, round(p_total_cost_cop, 2), round(unit_cost, 6)
  );

  insert into public.production_batches (
    id, batch_kind, production_id, preparation_id, initial_quantity_base, base_unit,
    unit_cost_cop, expiration_date, elaborated_at, production_number
  )
  values (
    new_batch_id, 'historical_preparation', new_production_id, p_preparation_id, quantity_base, preparation_row.base_unit,
    round(unit_cost, 6), p_expiration_date, elaboration_date, next_number
  );

  insert into public.preparation_historical_stock_entries (
    production_id, production_batch_id, preparation_id, quantity_base, base_unit,
    total_cost_cop, unit_cost_cop, elaborated_at, expiration_date, reason, created_by
  )
  values (
    new_production_id, new_batch_id, p_preparation_id, quantity_base, preparation_row.base_unit,
    round(p_total_cost_cop, 2), round(unit_cost, 6), elaboration_date, p_expiration_date, upper(trim(p_reason)), auth.uid()
  );

  return jsonb_build_object(
    'production_id', new_production_id,
    'production_batch_id', new_batch_id,
    'code', new_code,
    'quantity_base', quantity_base,
    'base_unit', preparation_row.base_unit,
    'total_cost_cop', round(p_total_cost_cop, 2),
    'unit_cost_cop', round(unit_cost, 6),
    'expiration_date', p_expiration_date
  );
end;
$$;

grant execute on function public.register_historical_preparation_stock(uuid, numeric, public.stock_unit, numeric, date, date, text) to authenticated;

notify pgrst, 'reload schema';
