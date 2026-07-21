do $$
declare
  function_sql text;
begin
  select pg_get_functiondef(
    'public.create_production(uuid, text, date, date, numeric, public.stock_unit, numeric, public.stock_unit, jsonb)'::regprocedure
  )
  into function_sql;

  function_sql := replace(
    function_sql,
    'select unit, public.production_unit_kind(unit) as unit_kind
      into source_base_unit, source_unit_kind
      from public.inventory_items
      where id = source_id_value
        and is_active = true
        and item_kind = ''ingredient''
        and presentation_quantity is null;',
    'select
        case
          when unit in (''g'', ''kg'') then ''g''::public.stock_unit
          when unit in (''ml'', ''l'') then ''ml''::public.stock_unit
          else ''unit''::public.stock_unit
        end,
        public.production_unit_kind(
          case
            when unit in (''g'', ''kg'') then ''g''::public.stock_unit
            when unit in (''ml'', ''l'') then ''ml''::public.stock_unit
            else ''unit''::public.stock_unit
          end
        )
      into source_base_unit, source_unit_kind
      from public.inventory_items
      where id = source_id_value
        and is_active = true
        and item_kind = ''ingredient''
        and presentation_quantity is null;'
  );

  execute function_sql;
end $$;

with converted_allocations as (
  select
    pca.id,
    public.production_convert_quantity(pca.quantity_base, pca.base_unit, pi.unit, null) as normalized_quantity,
    pi.unit as normalized_unit,
    round(public.production_convert_quantity(pca.quantity_base, pca.base_unit, pi.unit, null) * (pi.line_total_cop / nullif(pi.quantity, 0)), 2) as normalized_cost
  from public.production_consumption_allocations pca
  join public.purchase_items pi on pi.id = pca.purchase_item_id
  where pca.base_unit <> pi.unit
    and public.production_unit_kind(pca.base_unit) = public.production_unit_kind(pi.unit)
)
update public.production_consumption_allocations pca
set quantity_base = converted_allocations.normalized_quantity,
    base_unit = converted_allocations.normalized_unit,
    cost_cop = converted_allocations.normalized_cost
from converted_allocations
where pca.id = converted_allocations.id;

with consumption_totals as (
  select
    pc.id,
    min(pca.base_unit) as base_unit,
    sum(pca.quantity_base) as quantity_base,
    sum(pca.cost_cop) as cost_cop
  from public.production_consumptions pc
  join public.production_consumption_allocations pca on pca.consumption_id = pc.id
  where pc.source_kind = 'inventory_item'
    and pca.purchase_item_id is not null
  group by pc.id
)
update public.production_consumptions pc
set quantity_base = consumption_totals.quantity_base,
    base_unit = consumption_totals.base_unit,
    cost_cop = round(consumption_totals.cost_cop, 2)
from consumption_totals
where pc.id = consumption_totals.id;

with production_totals as (
  select
    p.id,
    coalesce(sum(pc.cost_cop), 0) as total_cost
  from public.productions p
  left join public.production_consumptions pc on pc.production_id = p.id
  group by p.id
)
update public.productions p
set total_cost_cop = round(production_totals.total_cost, 2),
    unit_cost_cop = case
      when p.actual_quantity_base > 0 then round(production_totals.total_cost / p.actual_quantity_base, 6)
      else 0
    end
from production_totals
where p.id = production_totals.id;

notify pgrst, 'reload schema';
