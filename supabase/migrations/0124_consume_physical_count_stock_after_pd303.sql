-- Physical counts establish a stock baseline. Before this correction, a positive
-- count could remain available forever when its historical lot had already been
-- exhausted. Keep previous manual regularizations intact and consume the
-- baseline from PD303 onward.

create table if not exists public.inventory_stock_reconciliation_baselines (
  source_kind text not null check (source_kind in ('inventory_item', 'preparation')),
  source_id uuid not null,
  effective_at timestamptz not null,
  reason text not null,
  created_at timestamptz not null default now(),
  primary key (source_kind, source_id)
);

alter table public.inventory_stock_reconciliation_baselines enable row level security;

drop policy if exists "inventory stock baselines readable by inventory users" on public.inventory_stock_reconciliation_baselines;
create policy "inventory stock baselines readable by inventory users"
  on public.inventory_stock_reconciliation_baselines
  for select to authenticated
  using (public.current_user_can_access_module('inventario'));

insert into public.inventory_stock_reconciliation_baselines (source_kind, source_id, effective_at, reason)
select
  consumption.source_kind,
  coalesce(consumption.inventory_item_id, consumption.source_preparation_id),
  min(allocation.created_at),
  'Linea base de conciliacion: PD303; los consumos posteriores descuentan conteos fisicos acumulados.'
from public.pos_order_consumptions consumption
join public.pos_orders order_header on order_header.id = consumption.order_id
join public.pos_order_consumption_allocations allocation on allocation.consumption_id = consumption.id
where order_header.code = 'PD303'
group by consumption.source_kind, coalesce(consumption.inventory_item_id, consumption.source_preparation_id)
on conflict (source_kind, source_id) do nothing;

do $migration$
declare
  definition text;
  baseline_block text := $block$
  select baseline.effective_at
    into baseline_at
  from public.inventory_stock_reconciliation_baselines baseline
  where baseline.source_kind = p_source_kind
    and baseline.source_id = p_source_id;

  if baseline_at is not null then
    for origin_index in 1..origin_count loop
      if coalesce(origin_initial_stocks[origin_index], 0) > 0 then
        continue;
      end if;

      if p_source_kind = 'inventory_item' then
        select coalesce(sum(allocated.quantity_base), 0)
          into baseline_consumed
        from (
          select public.production_convert_quantity(allocation.quantity_base, allocation.base_unit, p_base_unit, null) as quantity_base
          from public.production_consumption_allocations allocation
          where allocation.purchase_item_id = origin_ids[origin_index]
            and allocation.created_at >= baseline_at
          union all
          select public.production_convert_quantity(allocation.quantity_base, allocation.base_unit, p_base_unit, null) as quantity_base
          from public.pos_order_consumption_allocations allocation
          join public.pos_order_consumptions consumption on consumption.id = allocation.consumption_id
          join public.pos_orders order_header on order_header.id = consumption.order_id
          where allocation.purchase_item_id = origin_ids[origin_index]
            and allocation.created_at >= baseline_at
            and order_header.status <> 'cancelled'
        ) allocated;
      else
        select coalesce(sum(allocated.quantity_base), 0)
          into baseline_consumed
        from (
          select public.production_convert_quantity(allocation.quantity_base, allocation.base_unit, p_base_unit, null) as quantity_base
          from public.production_consumption_allocations allocation
          where allocation.production_batch_id = origin_ids[origin_index]
            and allocation.created_at >= baseline_at
          union all
          select public.production_convert_quantity(allocation.quantity_base, allocation.base_unit, p_base_unit, null) as quantity_base
          from public.pos_order_consumption_allocations allocation
          join public.pos_order_consumptions consumption on consumption.id = allocation.consumption_id
          join public.pos_orders order_header on order_header.id = consumption.order_id
          where allocation.production_batch_id = origin_ids[origin_index]
            and allocation.created_at >= baseline_at
            and order_header.status <> 'cancelled'
        ) allocated;
      end if;

      origin_stocks[origin_index] := greatest(0, origin_stocks[origin_index] - baseline_consumed);
    end loop;
  end if;

$block$;
begin
  select pg_get_functiondef(
    'app_private.inventory_source_lots(text,uuid,public.stock_unit)'::regprocedure
  ) into definition;

  if position('origin_stocks numeric[] := array[]::numeric[];' in definition) = 0
    or position('for origin_index in 1..origin_count loop' in definition) = 0 then
    raise exception 'La funcion de disponibilidad no coincide con la version auditada.';
  end if;

  definition := replace(
    definition,
    'origin_stocks numeric[] := array[]::numeric[];',
    E'origin_stocks numeric[] := array[]::numeric[];\n  origin_initial_stocks numeric[] := array[]::numeric[];\n  baseline_at timestamptz;\n  baseline_consumed numeric;'
  );
  definition := replace(
    definition,
    'origin_stocks := array_append(origin_stocks, lot.available_base);',
    E'origin_stocks := array_append(origin_stocks, lot.available_base);\n      origin_initial_stocks := array_append(origin_initial_stocks, lot.available_base);'
  );
  definition := replace(
    definition,
    E'  for origin_index in 1..origin_count loop\n    origin_id := origin_ids[origin_index];',
    baseline_block || E'  for origin_index in 1..origin_count loop\n    origin_id := origin_ids[origin_index];'
  );

  execute definition;
end;
$migration$;

notify pgrst, 'reload schema';
