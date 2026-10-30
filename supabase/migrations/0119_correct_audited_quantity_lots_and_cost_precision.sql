-- Correct the nine audited thousand-separator errors without changing physical stock.
-- Cost snapshots retain six decimal places internally; UI formatting is handled by the app.

alter table public.purchase_items
  alter column unit_cost_cop type numeric(18, 6) using unit_cost_cop::numeric(18, 6);
alter table public.inventory_items
  alter column average_cost_cop type numeric(18, 6) using average_cost_cop::numeric(18, 6);
alter table public.pos_order_consumption_allocations
  alter column cost_cop type numeric(18, 6) using cost_cop::numeric(18, 6);
alter table public.pos_order_consumptions
  alter column cost_cop type numeric(18, 6) using cost_cop::numeric(18, 6);
alter table public.pos_order_items
  alter column line_cost_cop type numeric(18, 6) using line_cost_cop::numeric(18, 6);
alter table public.production_consumption_allocations
  alter column cost_cop type numeric(18, 6) using cost_cop::numeric(18, 6);
alter table public.production_consumptions
  alter column cost_cop type numeric(18, 6) using cost_cop::numeric(18, 6);
alter table public.productions
  alter column total_cost_cop type numeric(18, 6) using total_cost_cop::numeric(18, 6);

create table if not exists public.inventory_quantity_correction_audits (
  id uuid primary key default gen_random_uuid(),
  correction_key text not null unique,
  batch_key text not null,
  reason text not null,
  purchase_item_id uuid not null references public.purchase_items(id) on delete restrict,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  physical_count_id uuid not null references public.physical_inventory_counts(id) on delete restrict,
  stock_before_base numeric(18, 3) not null,
  stock_after_lot_base numeric(18, 3) not null,
  stock_after_base numeric(18, 3) not null,
  compensating_adjustment_base numeric(18, 3) not null,
  original_values jsonb not null,
  corrected_values jsonb not null,
  original_cost_snapshots jsonb not null,
  corrected_cost_snapshots jsonb not null,
  executed_at timestamptz not null default now(),
  executed_by uuid null references auth.users(id) on delete set null
);

alter table public.inventory_quantity_correction_audits enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'inventory_quantity_correction_audits'
      and policyname = 'Managers can read inventory quantity correction audits'
  ) then
    create policy "Managers can read inventory quantity correction audits"
      on public.inventory_quantity_correction_audits for select to authenticated
      using (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]));
  end if;
end $$;

create or replace function public.prevent_inventory_quantity_correction_audit_mutation()
returns trigger language plpgsql set search_path = public as $function$
begin
  raise exception 'Los registros de auditoria de correccion de cantidades son inmutables.';
end;
$function$;

drop trigger if exists inventory_quantity_correction_audits_immutable on public.inventory_quantity_correction_audits;
create trigger inventory_quantity_correction_audits_immutable
before update or delete on public.inventory_quantity_correction_audits
for each row execute function public.prevent_inventory_quantity_correction_audit_mutation();

do $correction$
declare
  v_batch_key constant text := 'audited-thousand-quantity-lots-2026-10-22';
  v_target record;
  v_item record;
  v_stock_before numeric;
  v_stock_after_lot numeric;
  v_stock_after numeric;
  v_compensation numeric;
  v_count_id uuid;
  v_original_snapshots jsonb;
  v_corrected_snapshots jsonb;
  v_orders_before jsonb;
  v_orders_after jsonb;
  v_expected_total numeric;
begin
  perform pg_advisory_xact_lock(hashtext(v_batch_key));
  lock table public.purchase_items in share row exclusive mode;
  lock table public.physical_inventory_counts in share row exclusive mode;
  lock table public.pos_order_consumption_allocations in share row exclusive mode;
  lock table public.pos_order_consumptions in share row exclusive mode;
  lock table public.pos_order_items in share row exclusive mode;

  if exists (select 1 from public.inventory_quantity_correction_audits where batch_key = v_batch_key) then
    raise exception 'La correccion auditada de los nueve lotes ya fue ejecutada.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('code', o.code, 'total_cop', o.total_cop, 'payment_method', o.payment_method) order by o.code), '[]'::jsonb)
    into v_orders_before
  from public.pos_orders o
  where o.code = 'PD185';

  for v_target in
    select *
    from jsonb_to_recordset($json$
      [
        {"id":"4884492e-b7a0-4f44-806f-f6865c5462c8","quantity":2840,"original":2.840,"total":25300,"compensation":-2712.160},
        {"id":"85dbb89a-1708-45f3-b0b2-faa13553e243","quantity":2420,"original":2.420,"total":22766,"compensation":-2417.580},
        {"id":"89c9050c-5151-418b-b4e8-8571acfabb8b","quantity":10275,"original":10.275,"total":68209,"compensation":-10264.725},
        {"id":"8214fe3f-8be1-4452-8e57-cff707e56e5f","quantity":2095,"original":2.095,"total":20531,"compensation":-2092.905},
        {"id":"8ff87d09-1709-453b-a2d1-b4aba1f3912f","quantity":4425,"original":4.425,"total":28542,"compensation":-4420.575},
        {"id":"2523ba01-fa3e-48a0-9f48-6809a5b11428","quantity":5530,"original":5.530,"total":35668,"compensation":-5524.470},
        {"id":"18806b24-8982-4cc2-92fe-994aafffa07a","quantity":1000,"original":1.000,"total":19800,"compensation":-999.000},
        {"id":"5964b719-23be-4a1c-a9ff-3cfac5bb6497","quantity":1800,"original":1.800,"total":40700,"compensation":-1798.200},
        {"id":"470ded2e-fe3a-4fde-944a-8d12d3488e8a","quantity":3000,"original":3.000,"total":43900,"compensation":-2997.000}
      ]
    $json$::jsonb) as targets(id uuid, quantity numeric, original numeric, total numeric, compensation numeric)
  loop
    select pi.id, pi.inventory_item_id, pi.quantity, pi.purchased_quantity, pi.presentation_quantity,
           pi.unit_cost_cop, coalesce(pi.landed_total_cop, pi.line_total_cop) as total_cop,
           ii.name, pi.unit
      into v_item
    from public.purchase_items pi
    join public.inventory_items ii on ii.id = pi.inventory_item_id
    where pi.id = v_target.id
    for update;

    if v_item.id is null or v_item.unit <> 'g'::public.stock_unit
      or v_item.quantity <> v_target.original or v_item.total_cop <> v_target.total then
      raise exception 'El lote % ya no coincide con la auditoria.', v_target.id;
    end if;

    select round(coalesce(sum(available_base), 0), 3)
      into v_stock_before
    from app_private.inventory_source_lots('inventory_item', v_item.inventory_item_id, 'g'::public.stock_unit);

    select coalesce(jsonb_agg(jsonb_build_object(
      'allocation_id', a.id, 'consumption_id', c.id, 'order_code', o.code,
      'quantity_base', a.quantity_base, 'allocation_cost_cop', a.cost_cop,
      'consumption_cost_cop', c.cost_cop, 'line_cost_cop', oi.line_cost_cop
    ) order by a.id), '[]'::jsonb)
      into v_original_snapshots
    from public.pos_order_consumption_allocations a
    join public.pos_order_consumptions c on c.id = a.consumption_id
    join public.pos_order_items oi on oi.id = c.order_item_id
    join public.pos_orders o on o.id = c.order_id
    where a.purchase_item_id = v_item.id;

    update public.purchase_items
       set quantity = v_target.quantity,
           purchased_quantity = v_target.quantity,
           presentation_quantity = case when presentation_quantity = v_item.quantity then v_target.quantity else presentation_quantity end,
           unit_cost_cop = v_item.total_cop / nullif(v_target.quantity, 0)
     where id = v_item.id;

    update public.pos_order_consumption_allocations a
       set cost_cop = a.quantity_base * v_item.total_cop / nullif(v_target.quantity, 0)
     where a.purchase_item_id = v_item.id;

    update public.pos_order_consumptions c
       set cost_cop = totals.cost_cop
      from (
        select c2.id, sum(a2.cost_cop) as cost_cop
        from public.pos_order_consumptions c2
        join public.pos_order_consumption_allocations a2 on a2.consumption_id = c2.id
        where c2.id in (select consumption_id from public.pos_order_consumption_allocations where purchase_item_id = v_item.id)
        group by c2.id
      ) totals
     where c.id = totals.id;

    update public.pos_order_items oi
       set line_cost_cop = totals.cost_cop
      from (
        select c.order_item_id, sum(c.cost_cop) as cost_cop
        from public.pos_order_consumptions c
        where c.order_item_id in (
          select c2.order_item_id
          from public.pos_order_consumptions c2
          join public.pos_order_consumption_allocations a2 on a2.consumption_id = c2.id
          where a2.purchase_item_id = v_item.id
        )
        group by c.order_item_id
      ) totals
     where oi.id = totals.order_item_id;

    select round(coalesce(sum(available_base), 0), 3)
      into v_stock_after_lot
    from app_private.inventory_source_lots('inventory_item', v_item.inventory_item_id, 'g'::public.stock_unit);

    v_compensation := v_stock_before - v_stock_after_lot;
    if v_compensation <> v_target.compensation then
      raise exception 'El compensatorio calculado para el lote % (%) no coincide con la auditoria (%).', v_item.id, v_compensation, v_target.compensation;
    end if;

    insert into public.physical_inventory_counts (
      source_kind, inventory_item_id, theoretical_quantity_base, physical_quantity_base,
      difference_quantity_base, base_unit, average_cost_cop, adjustment_kind, reason
    ) values (
      'inventory_item', v_item.inventory_item_id, v_stock_after_lot, v_stock_before,
      v_compensation, 'g'::public.stock_unit, v_item.total_cop / v_target.quantity, 'waste',
      'AJUSTE TECNICO SIN EFECTO EN STOCK FISICO | Correccion auditada de separador de miles: ' || v_item.name || ' (' || v_item.id || ')'
    ) returning id into v_count_id;

    select round(coalesce(sum(available_base), 0), 3)
      into v_stock_after
    from app_private.inventory_source_lots('inventory_item', v_item.inventory_item_id, 'g'::public.stock_unit);

    if v_stock_after <> v_stock_before then
      raise exception 'El stock fisico de % cambio de % a %.', v_item.name, v_stock_before, v_stock_after;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'allocation_id', a.id, 'consumption_id', c.id, 'order_code', o.code,
      'quantity_base', a.quantity_base, 'allocation_cost_cop', a.cost_cop,
      'consumption_cost_cop', c.cost_cop, 'line_cost_cop', oi.line_cost_cop
    ) order by a.id), '[]'::jsonb)
      into v_corrected_snapshots
    from public.pos_order_consumption_allocations a
    join public.pos_order_consumptions c on c.id = a.consumption_id
    join public.pos_order_items oi on oi.id = c.order_item_id
    join public.pos_orders o on o.id = c.order_id
    where a.purchase_item_id = v_item.id;

    insert into public.inventory_quantity_correction_audits (
      correction_key, batch_key, reason, purchase_item_id, inventory_item_id, physical_count_id,
      stock_before_base, stock_after_lot_base, stock_after_base, compensating_adjustment_base,
      original_values, corrected_values, original_cost_snapshots, corrected_cost_snapshots
    ) values (
      'quantity-x1000-' || v_item.id::text, v_batch_key,
      'Cantidad ingresada con separador de miles interpretado como decimal; se conserva el valor total y se compensa el stock tecnico.',
      v_item.id, v_item.inventory_item_id, v_count_id,
      v_stock_before, v_stock_after_lot, v_stock_after, v_compensation,
      jsonb_build_object('quantity_g', v_item.quantity, 'purchased_quantity_g', v_item.purchased_quantity, 'unit_cost_cop', v_item.unit_cost_cop, 'total_cop', v_item.total_cop),
      jsonb_build_object('quantity_g', v_target.quantity, 'unit_cost_cop', v_item.total_cop / v_target.quantity, 'total_cop', v_item.total_cop),
      v_original_snapshots, v_corrected_snapshots
    );
  end loop;

  update public.inventory_items item
     set average_cost_cop = totals.average_cost
    from (
      select pi.inventory_item_id, sum(pi.quantity) as quantity,
             sum(coalesce(pi.landed_total_cop, pi.line_total_cop)) / nullif(sum(pi.quantity), 0) as average_cost
      from public.purchase_items pi
      where pi.inventory_item_id in (
        select inventory_item_id from public.inventory_quantity_correction_audits where batch_key = v_batch_key
      )
      group by pi.inventory_item_id
    ) totals
   where item.id = totals.inventory_item_id;

  select coalesce(jsonb_agg(jsonb_build_object('code', o.code, 'total_cop', o.total_cop, 'payment_method', o.payment_method) order by o.code), '[]'::jsonb)
    into v_orders_after
  from public.pos_orders o
  where o.code = 'PD185';

  if v_orders_after <> v_orders_before then
    raise exception 'La correccion no puede modificar ventas ni pagos.';
  end if;

  select sum(oi.line_cost_cop) into v_expected_total
  from public.pos_order_items oi join public.pos_orders o on o.id = oi.order_id
  where o.code = 'PD185';
  if abs(v_expected_total - 23676.466) > 0.000001 then
    raise exception 'El costo final de PD185 (%) no coincide con la correccion auditada.', v_expected_total;
  end if;
end;
$correction$;

notify pgrst, 'reload schema';
