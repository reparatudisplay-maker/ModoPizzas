-- Correct the audited TOMATE lot, P6 and their cost snapshots atomically.
-- Physical stock remains unchanged through a traceable technical reconciliation.

create table if not exists public.inventory_cost_correction_audits (
  id uuid primary key default gen_random_uuid(),
  correction_key text not null unique,
  reason text not null,
  purchase_item_id uuid not null references public.purchase_items(id) on delete restrict,
  purchase_id uuid not null references public.purchases(id) on delete restrict,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  production_id uuid not null references public.productions(id) on delete restrict,
  production_batch_id uuid not null references public.production_batches(id) on delete restrict,
  stock_before_g numeric(14,3) not null,
  stock_after_lot_correction_g numeric(14,3) not null,
  stock_after_g numeric(14,3) not null,
  compensating_adjustment_g numeric(14,3) not null,
  physical_count_id uuid not null references public.physical_inventory_counts(id) on delete restrict,
  original_values jsonb not null,
  corrected_values jsonb not null,
  original_order_costs jsonb not null,
  corrected_order_costs jsonb not null,
  executed_at timestamptz not null default now(),
  executed_by uuid null references auth.users(id) on delete set null
);

alter table public.inventory_cost_correction_audits enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'inventory_cost_correction_audits'
      and policyname = 'Managers can read inventory cost correction audits'
  ) then
    create policy "Managers can read inventory cost correction audits"
      on public.inventory_cost_correction_audits for select
      to authenticated
      using (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]));
  end if;
end $$;

create or replace function public.prevent_inventory_cost_correction_audit_mutation()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  raise exception 'Los registros de auditoria de correcciones de costo son inmutables.';
end;
$function$;

drop trigger if exists inventory_cost_correction_audits_immutable on public.inventory_cost_correction_audits;
create trigger inventory_cost_correction_audits_immutable
before update or delete on public.inventory_cost_correction_audits
for each row execute function public.prevent_inventory_cost_correction_audit_mutation();

do $correction$
declare
  v_correction_key constant text := 'tomate-2026-09-23-17360g-p6';
  v_reason constant text := 'Correccion auditada: 17,360 fue interpretado como 17,36 g. Cantidad real 17.360 g por $92.035; se conservan conteos y cantidades consumidas.';
  v_purchase_item_id uuid;
  v_purchase_id uuid;
  v_inventory_item_id uuid;
  v_production_id uuid;
  v_production_batch_id uuid;
  v_tomato_consumption_id uuid;
  v_original_quantity numeric;
  v_total_cop numeric;
  v_original_unit_cost numeric;
  v_corrected_quantity constant numeric := 17360;
  v_corrected_unit_cost numeric;
  v_stock_before numeric;
  v_stock_after_lot_correction numeric;
  v_stock_after numeric;
  v_compensating_adjustment numeric;
  v_count_id uuid;
  v_p6_total numeric;
  v_p6_unit_cost numeric;
  v_downstream_allocations integer;
  v_downstream_orders integer;
  v_direct_allocations integer;
  v_direct_codes text[];
  v_all_order_codes text[];
  v_order_totals_before jsonb;
  v_order_totals_after jsonb;
  v_original_values jsonb;
  v_corrected_values jsonb;
  v_original_order_costs jsonb;
  v_corrected_order_costs jsonb;
begin
  perform pg_advisory_xact_lock(hashtext(v_correction_key));
  lock table public.purchase_items in share row exclusive mode;
  lock table public.production_consumption_allocations in share row exclusive mode;
  lock table public.production_consumptions in share row exclusive mode;
  lock table public.productions in share row exclusive mode;
  lock table public.production_batches in share row exclusive mode;
  lock table public.pos_order_consumption_allocations in share row exclusive mode;
  lock table public.pos_order_consumptions in share row exclusive mode;
  lock table public.pos_order_items in share row exclusive mode;
  lock table public.physical_inventory_counts in share row exclusive mode;

  if exists (select 1 from public.inventory_cost_correction_audits where correction_key = v_correction_key) then
    raise exception 'La correccion % ya fue ejecutada.', v_correction_key;
  end if;

  select pi.id, pi.purchase_id, pi.inventory_item_id, pi.quantity,
         coalesce(pi.landed_total_cop, pi.line_total_cop), pi.unit_cost_cop
    into v_purchase_item_id, v_purchase_id, v_inventory_item_id, v_original_quantity,
         v_total_cop, v_original_unit_cost
  from public.purchase_items pi
  join public.purchases p on p.id = pi.purchase_id
  join public.inventory_items i on i.id = pi.inventory_item_id
  where upper(i.name) = 'TOMATE'
    and p.purchased_at::date = date '2026-09-23'
    and pi.unit = 'g'::public.stock_unit
    and coalesce(pi.landed_total_cop, pi.line_total_cop) = 92035
  for update;

  if v_purchase_item_id is null or v_original_quantity <> 17.360
    or v_total_cop <> 92035 or round(v_original_unit_cost, 2) <> 5301.56 then
    raise exception 'El lote TOMATE auditado no coincide con los valores esperados.';
  end if;

  select pc.production_id, pc.id, pb.id
    into v_production_id, v_tomato_consumption_id, v_production_batch_id
  from public.production_consumption_allocations a
  join public.production_consumptions pc on pc.id = a.consumption_id
  join public.productions pr on pr.id = pc.production_id
  join public.production_batches pb on pb.production_id = pr.id
  where a.purchase_item_id = v_purchase_item_id
    and pr.code = 'P6'
  for update;

  if v_production_id is null then
    raise exception 'No se encontro la produccion P6 asociada al lote TOMATE.';
  end if;

  select count(*), array_agg(o.code order by o.code)
    into v_direct_allocations, v_direct_codes
  from public.pos_order_consumption_allocations a
  join public.pos_order_consumptions c on c.id = a.consumption_id
  join public.pos_orders o on o.id = c.order_id
  where a.purchase_item_id = v_purchase_item_id;

  if v_direct_allocations <> 3 or v_direct_codes <> array['PD265', 'PD273', 'PD298'] then
    raise exception 'Las asignaciones directas no coinciden con PD265, PD273 y PD298.';
  end if;

  select count(*), count(distinct o.id)
    into v_downstream_allocations, v_downstream_orders
  from public.pos_order_consumption_allocations a
  join public.pos_order_consumptions c on c.id = a.consumption_id
  join public.pos_orders o on o.id = c.order_id
  where a.production_batch_id = v_production_batch_id and o.status <> 'cancelled';

  if v_downstream_allocations <> 35 or v_downstream_orders <> 26 then
    raise exception 'P6 no conserva las 35 asignaciones en 26 pedidos auditadas.';
  end if;

  select round(coalesce(sum(available_base), 0), 3)
    into v_stock_before
  from app_private.inventory_source_lots('inventory_item', v_inventory_item_id, 'g'::public.stock_unit);

  select array_agg(distinct code order by code) into v_all_order_codes
  from (
    select unnest(v_direct_codes) as code
    union
    select o.code
    from public.pos_order_consumption_allocations a
    join public.pos_order_consumptions c on c.id = a.consumption_id
    join public.pos_orders o on o.id = c.order_id
    where a.production_batch_id = v_production_batch_id and o.status <> 'cancelled'
  ) orders;

  select coalesce(jsonb_agg(jsonb_build_object('order_code', code, 'total_cop', total_cop, 'payment_method', payment_method) order by code), '[]'::jsonb)
    into v_order_totals_before
  from public.pos_orders where code = any(v_all_order_codes);

  select jsonb_build_object(
    'lot', jsonb_build_object('quantity_g', v_original_quantity, 'total_cop', v_total_cop, 'unit_cost_cop', v_original_unit_cost),
    'p6', jsonb_build_object('total_cost_cop', pr.total_cost_cop, 'unit_cost_cop', pr.unit_cost_cop, 'tomato_consumption_cost_cop', pc.cost_cop),
    'downstream', jsonb_build_object('allocation_count', v_downstream_allocations, 'order_count', v_downstream_orders)
  ) into v_original_values
  from public.productions pr join public.production_consumptions pc on pc.id = v_tomato_consumption_id
  where pr.id = v_production_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'order_code', o.code, 'allocation_id', a.id, 'consumption_id', c.id,
    'order_item_id', c.order_item_id, 'quantity_base', a.quantity_base,
    'allocation_cost_cop', a.cost_cop, 'consumption_cost_cop', c.cost_cop,
    'line_cost_cop', oi.line_cost_cop
  ) order by o.code, a.id), '[]'::jsonb)
  into v_original_order_costs
  from public.pos_order_consumption_allocations a
  join public.pos_order_consumptions c on c.id = a.consumption_id
  join public.pos_orders o on o.id = c.order_id
  join public.pos_order_items oi on oi.id = c.order_item_id
  where a.purchase_item_id = v_purchase_item_id or a.production_batch_id = v_production_batch_id;

  v_corrected_unit_cost := round(v_total_cop / v_corrected_quantity, 6);
  update public.purchase_items
  set quantity = v_corrected_quantity,
      purchased_quantity = v_corrected_quantity,
      presentation_quantity = v_corrected_quantity,
      unit_cost_cop = round(v_corrected_unit_cost, 2)
  where id = v_purchase_item_id;

  update public.pos_order_consumption_allocations a
  set cost_cop = round(a.quantity_base * v_total_cop / v_corrected_quantity, 2)
  where a.purchase_item_id = v_purchase_item_id;

  update public.production_consumption_allocations a
  set cost_cop = round(a.quantity_base * v_total_cop / v_corrected_quantity, 2)
  where a.purchase_item_id = v_purchase_item_id;

  update public.production_consumptions c
  set cost_cop = costs.total_cost_cop
  from (
    select pc.id, round(sum(a.cost_cop), 2) as total_cost_cop
    from public.production_consumptions pc
    join public.production_consumption_allocations a on a.consumption_id = pc.id
    where pc.id = v_tomato_consumption_id
    group by pc.id
  ) costs where c.id = costs.id;

  update public.productions pr
  set total_cost_cop = costs.total_cost_cop,
      unit_cost_cop = round(costs.total_cost_cop / nullif(pr.actual_quantity_base, 0), 6)
  from (
    select pc.production_id, round(sum(pc.cost_cop), 2) as total_cost_cop
    from public.production_consumptions pc
    where pc.production_id = v_production_id
    group by pc.production_id
  ) costs where pr.id = costs.production_id;

  select total_cost_cop, unit_cost_cop into v_p6_total, v_p6_unit_cost
  from public.productions where id = v_production_id;

  if abs(v_p6_total - 16060.20) > 0.01 then
    raise exception 'El costo recalculado de P6 (%) no coincide con la auditoria.', v_p6_total;
  end if;

  update public.production_batches
  set unit_cost_cop = v_p6_unit_cost
  where id = v_production_batch_id;

  update public.pos_order_consumption_allocations a
  set cost_cop = round(a.quantity_base * v_p6_unit_cost, 2)
  where a.production_batch_id = v_production_batch_id;

  update public.pos_order_consumptions c
  set cost_cop = costs.total_cost_cop
  from (
    select c2.id, round(sum(a.cost_cop), 2) as total_cost_cop
    from public.pos_order_consumptions c2
    join public.pos_order_consumption_allocations a on a.consumption_id = c2.id
    where c2.id in (
      select c3.id from public.pos_order_consumptions c3
      join public.pos_order_consumption_allocations a3 on a3.consumption_id = c3.id
      where a3.purchase_item_id = v_purchase_item_id or a3.production_batch_id = v_production_batch_id
    ) group by c2.id
  ) costs where c.id = costs.id;

  update public.pos_order_items oi
  set line_cost_cop = costs.total_cost_cop
  from (
    select c.order_item_id, round(sum(c.cost_cop), 2) as total_cost_cop
    from public.pos_order_consumptions c
    where c.order_item_id in (
      select c3.order_item_id from public.pos_order_consumptions c3
      join public.pos_order_consumption_allocations a3 on a3.consumption_id = c3.id
      where a3.purchase_item_id = v_purchase_item_id or a3.production_batch_id = v_production_batch_id
    ) group by c.order_item_id
  ) costs where oi.id = costs.order_item_id;

  select round(coalesce(sum(available_base), 0), 3)
    into v_stock_after_lot_correction
  from app_private.inventory_source_lots('inventory_item', v_inventory_item_id, 'g'::public.stock_unit);

  v_compensating_adjustment := v_stock_before - v_stock_after_lot_correction;
  if v_compensating_adjustment <> -17102.640 then
    raise exception 'El ajuste compensatorio esperado es -17102,640 g, se calculo % g.', v_compensating_adjustment;
  end if;

  insert into public.physical_inventory_counts (
    source_kind, inventory_item_id, theoretical_quantity_base, physical_quantity_base,
    difference_quantity_base, base_unit, average_cost_cop, adjustment_kind, reason
  ) values (
    'inventory_item', v_inventory_item_id, v_stock_after_lot_correction, v_stock_before,
    v_compensating_adjustment, 'g'::public.stock_unit, v_corrected_unit_cost, 'waste',
    'AJUSTE TECNICO SIN EFECTO EN STOCK FISICO | ' || v_reason
  ) returning id into v_count_id;

  select round(coalesce(sum(available_base), 0), 3)
    into v_stock_after
  from app_private.inventory_source_lots('inventory_item', v_inventory_item_id, 'g'::public.stock_unit);

  if v_stock_after <> v_stock_before then
    raise exception 'El stock consolidado cambio de % g a % g.', v_stock_before, v_stock_after;
  end if;

  if (select round(sum(oi.line_cost_cop), 2) from public.pos_order_items oi join public.pos_orders o on o.id = oi.order_id where o.code = 'PD265') <> 19747.73
    or (select round(sum(oi.line_cost_cop), 2) from public.pos_order_items oi join public.pos_orders o on o.id = oi.order_id where o.code = 'PD273') <> 8719.03
    or (select round(sum(oi.line_cost_cop), 2) from public.pos_order_items oi join public.pos_orders o on o.id = oi.order_id where o.code = 'PD298') <> 12092.62 then
    raise exception 'Los costos finales de PD265, PD273 o PD298 no coinciden con la auditoria.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('order_code', code, 'total_cop', total_cop, 'payment_method', payment_method) order by code), '[]'::jsonb)
    into v_order_totals_after
  from public.pos_orders where code = any(v_all_order_codes);

  if v_order_totals_after <> v_order_totals_before then
    raise exception 'La correccion no puede modificar ventas ni pagos.';
  end if;

  select jsonb_build_object(
    'lot', jsonb_build_object('quantity_g', v_corrected_quantity, 'total_cop', v_total_cop, 'unit_cost_cop', v_corrected_unit_cost),
    'p6', jsonb_build_object('total_cost_cop', v_p6_total, 'unit_cost_cop', v_p6_unit_cost),
    'stock', jsonb_build_object('before_g', v_stock_before, 'after_lot_g', v_stock_after_lot_correction, 'after_g', v_stock_after, 'compensating_adjustment_g', v_compensating_adjustment)
  ) into v_corrected_values;

  select coalesce(jsonb_agg(jsonb_build_object(
    'order_code', o.code, 'allocation_id', a.id, 'consumption_id', c.id,
    'order_item_id', c.order_item_id, 'quantity_base', a.quantity_base,
    'allocation_cost_cop', a.cost_cop, 'consumption_cost_cop', c.cost_cop,
    'line_cost_cop', oi.line_cost_cop
  ) order by o.code, a.id), '[]'::jsonb)
  into v_corrected_order_costs
  from public.pos_order_consumption_allocations a
  join public.pos_order_consumptions c on c.id = a.consumption_id
  join public.pos_orders o on o.id = c.order_id
  join public.pos_order_items oi on oi.id = c.order_item_id
  where a.purchase_item_id = v_purchase_item_id or a.production_batch_id = v_production_batch_id;

  insert into public.inventory_cost_correction_audits (
    correction_key, reason, purchase_item_id, purchase_id, inventory_item_id, production_id, production_batch_id,
    stock_before_g, stock_after_lot_correction_g, stock_after_g, compensating_adjustment_g, physical_count_id,
    original_values, corrected_values, original_order_costs, corrected_order_costs
  ) values (
    v_correction_key, v_reason, v_purchase_item_id, v_purchase_id, v_inventory_item_id, v_production_id, v_production_batch_id,
    v_stock_before, v_stock_after_lot_correction, v_stock_after, v_compensating_adjustment, v_count_id,
    v_original_values, v_corrected_values, v_original_order_costs, v_corrected_order_costs
  );
end;
$correction$;

notify pgrst, 'reload schema';
