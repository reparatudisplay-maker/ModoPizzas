-- Historical sales reporting. Amounts and costs are read from frozen POS snapshots.

insert into public.app_modules (key, parent_key, name, route, icon, sort_order, is_active, permission_module_keys)
values
  ('reportes', null, 'Reportes', '/panel/reportes', 'ChartNoAxesCombined', 105, true, array['reportes']),
  ('reportes.ventas', 'reportes', 'Ventas y rentabilidad', '/panel/reportes', 'ChartNoAxesCombined', 106, true, array['reportes'])
on conflict (key) do update
  set parent_key = excluded.parent_key,
      name = excluded.name,
      route = excluded.route,
      icon = excluded.icon,
      sort_order = excluded.sort_order,
      is_active = excluded.is_active,
      permission_module_keys = excluded.permission_module_keys,
      updated_at = now();

insert into public.app_permissions (code, module_key, module_label, action_key, action_label, is_critical, sort_order)
values
  ('reportes.view', 'reportes', 'Reportes', 'view', 'Ver', false, 120),
  ('reportes.export', 'reportes', 'Reportes', 'export', 'Exportar', false, 121)
on conflict (code) do update
  set module_key = excluded.module_key,
      module_label = excluded.module_label,
      action_key = excluded.action_key,
      action_label = excluded.action_label,
      is_critical = excluded.is_critical,
      sort_order = excluded.sort_order;

create or replace function public.get_sales_profitability_report(
  p_from timestamptz,
  p_to timestamptz,
  p_bucket text default 'day'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  if not public.current_user_can_access_module('reportes') then
    raise exception 'No tienes acceso a reportes.';
  end if;
  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'El rango de fechas no es valido.';
  end if;
  if p_bucket not in ('hour', 'day', 'week', 'month') then
    p_bucket := 'day';
  end if;

  with valid_orders as (
    select o.*
    from public.pos_orders o
    where o.created_at >= p_from and o.created_at < p_to and o.status <> 'cancelled'
  ), item_metrics as (
    select i.order_id, i.id, i.item_kind, i.product_name_snapshot, i.quantity,
      i.unit_price_cop, i.line_subtotal_cop, i.line_cost_cop
    from public.pos_order_items i join valid_orders o on o.id = i.order_id
  ), sales as (
    select count(*)::numeric as orders,
      coalesce(sum(total_cop), 0) as revenue,
      coalesce(sum((select coalesce(sum(im.line_cost_cop), 0) from item_metrics im where im.order_id = o.id)), 0) as cost
    from valid_orders o
  ), expense_totals as (
    select coalesce(sum(amount_cop), 0) as amount
    from public.expenses
    where status = 'active' and spent_at >= p_from and spent_at < p_to
  ), cancellations as (
    select count(*)::numeric as count, coalesce(sum(total_cop), 0) as amount
    from public.pos_orders
    where status = 'cancelled' and cancelled_at >= p_from and cancelled_at < p_to
  ), metrics as (
    select s.orders, s.revenue, s.cost, e.amount as expenses, c.count as cancelled_orders, c.amount as cancelled_amount,
      s.revenue - s.cost as gross_profit, s.revenue - s.cost - e.amount as operating_result
    from sales s cross join expense_totals e cross join cancellations c
  )
  select jsonb_build_object(
    'summary', (select jsonb_build_object(
      'sales_cop', revenue, 'cost_cop', cost, 'gross_profit_cop', gross_profit,
      'expenses_cop', expenses, 'operating_result_cop', operating_result,
      'gross_margin_pct', case when revenue > 0 then round(gross_profit * 100 / revenue, 2) else null end,
      'operating_margin_pct', case when revenue > 0 then round(operating_result * 100 / revenue, 2) else null end,
      'orders', orders, 'average_ticket_cop', case when orders > 0 then round(revenue / orders, 2) else 0 end,
      'cancelled_orders', cancelled_orders, 'cancelled_amount_cop', cancelled_amount
    ) from metrics),
    'series', coalesce((select jsonb_agg(jsonb_build_object('label', label, 'sales_cop', sales_cop, 'cost_cop', cost_cop, 'gross_profit_cop', sales_cop - cost_cop, 'orders', orders) order by bucket) from (
      select date_trunc(p_bucket, o.created_at) as bucket,
        to_char(date_trunc(p_bucket, o.created_at) at time zone 'America/Bogota', case when p_bucket = 'hour' then 'HH24:00' when p_bucket = 'month' then 'Mon YYYY' else 'DD Mon' end) as label,
        coalesce(sum(o.total_cop), 0) as sales_cop,
        coalesce(sum((select sum(im.line_cost_cop) from item_metrics im where im.order_id = o.id), 0), 0) as cost_cop,
        count(*)::numeric as orders
      from valid_orders o group by 1, 2
    ) series_rows), '[]'::jsonb),
    'pizzas', coalesce((select jsonb_agg(to_jsonb(rows) order by rows.sales_cop desc) from (
      select product_name_snapshot as name, sum(quantity)::numeric as units, sum(line_subtotal_cop)::numeric as sales_cop,
        sum(line_cost_cop)::numeric as cost_cop, sum(line_subtotal_cop - line_cost_cop)::numeric as profit_cop,
        case when sum(line_subtotal_cop) > 0 then round(sum(line_subtotal_cop - line_cost_cop) * 100 / sum(line_subtotal_cop), 2) else null end as margin_pct
      from item_metrics where item_kind = 'pizza' group by product_name_snapshot
    ) rows), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(to_jsonb(rows) order by rows.sales_cop desc) from (
      select product_name_snapshot as name, sum(quantity)::numeric as units, sum(line_subtotal_cop)::numeric as sales_cop,
        sum(line_cost_cop)::numeric as cost_cop, sum(line_subtotal_cop - line_cost_cop)::numeric as profit_cop,
        case when sum(line_subtotal_cop) > 0 then round(sum(line_subtotal_cop - line_cost_cop) * 100 / sum(line_subtotal_cop), 2) else null end as margin_pct
      from item_metrics where item_kind = 'sale_product' group by product_name_snapshot
    ) rows), '[]'::jsonb),
    'additions', coalesce((select jsonb_agg(to_jsonb(rows) order by rows.sales_cop desc) from (
      select a.name_snapshot as name, sum(a.quantity)::numeric as units, sum(a.line_subtotal_cop)::numeric as sales_cop,
        sum(a.line_cost_cop)::numeric as cost_cop, sum(a.line_subtotal_cop - a.line_cost_cop)::numeric as profit_cop,
        case when sum(a.line_subtotal_cop) > 0 then round(sum(a.line_subtotal_cop - a.line_cost_cop) * 100 / sum(a.line_subtotal_cop), 2) else null end as margin_pct
      from public.pos_order_item_additions a join item_metrics i on i.id = a.order_item_id group by a.name_snapshot
    ) rows), '[]'::jsonb),
    'expenses', coalesce((select jsonb_agg(jsonb_build_object('category', category, 'amount_cop', amount_cop, 'count', count) order by amount_cop desc) from (
      select coalesce(ec.name, 'Sin categoria') as category, sum(e.amount_cop)::numeric as amount_cop, count(*)::numeric as count
      from public.expenses e left join public.expense_categories ec on ec.id = e.category_id
      where e.status = 'active' and e.spent_at >= p_from and e.spent_at < p_to group by coalesce(ec.name, 'Sin categoria')
    ) rows), '[]'::jsonb),
    'types', coalesce((select jsonb_agg(to_jsonb(rows) order by rows.sales_cop desc) from (
      select kind, count(*)::numeric as orders, sum(total_cop)::numeric as sales_cop,
        coalesce(sum((select sum(im.line_cost_cop) from item_metrics im where im.order_id = o.id)), 0)::numeric as cost_cop,
        case when count(*) > 0 then round(sum(total_cop) / count(*), 2) else 0 end as ticket_cop
      from valid_orders o group by kind
    ) rows), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('method', method, 'amount_cop', amount_cop, 'orders', orders) order by amount_cop desc) from (
      select p.method, sum(p.amount_cop)::numeric as amount_cop, count(distinct p.order_id)::numeric as orders
      from public.pos_order_payments p join valid_orders o on o.id = p.order_id group by p.method
    ) rows), '[]'::jsonb),
    'users', coalesce((select jsonb_agg(to_jsonb(rows) order by rows.sales_cop desc) from (
      select coalesce(p.full_name, 'Sin registro') as name, count(*)::numeric as orders, sum(o.total_cop)::numeric as sales_cop,
        coalesce(sum((select sum(im.line_cost_cop) from item_metrics im where im.order_id = o.id)), 0)::numeric as cost_cop,
        sum(o.total_cop - coalesce((select sum(im.line_cost_cop) from item_metrics im where im.order_id = o.id), 0))::numeric as profit_cop,
        case when count(*) > 0 then round(sum(o.total_cop) / count(*), 2) else 0 end as ticket_cop
      from valid_orders o left join public.profiles p on p.id = o.created_by group by coalesce(p.full_name, 'Sin registro')
    ) rows), '[]'::jsonb),
    'hours', coalesce((select jsonb_agg(jsonb_build_object('hour', "hour_value", 'sales_cop', sales_cop, 'orders', orders, 'profit_cop', profit_cop) order by "hour_value") from (
      select extract(hour from o.created_at at time zone 'America/Bogota')::integer as "hour_value", sum(o.total_cop)::numeric as sales_cop, count(*)::numeric as orders,
        sum(o.total_cop - coalesce((select sum(im.line_cost_cop) from item_metrics im where im.order_id = o.id), 0))::numeric as profit_cop
      from valid_orders o group by 1
    ) rows), '[]'::jsonb),
    'cancellations', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'amount_cop', total_cop, 'reason', cancel_reason, 'cancelled_at', cancelled_at, 'user', coalesce(p.full_name, 'Sin registro')) order by cancelled_at desc) from public.pos_orders o left join public.profiles p on p.id = o.cancelled_by where o.status = 'cancelled' and o.cancelled_at >= p_from and o.cancelled_at < p_to), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_sales_profitability_report(timestamptz, timestamptz, text) from public;
grant execute on function public.get_sales_profitability_report(timestamptz, timestamptz, text) to authenticated;

create index if not exists pos_orders_report_period_idx on public.pos_orders (created_at) where status <> 'cancelled';
create index if not exists expenses_report_period_idx on public.expenses (spent_at) where status = 'active';
create index if not exists pos_order_items_report_order_idx on public.pos_order_items (order_id);

notify pgrst, 'reload schema';
