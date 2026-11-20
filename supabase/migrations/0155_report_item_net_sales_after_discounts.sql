-- Keep summary KPIs as implemented in 0078, but report each sold line at the
-- amount actually retained by the store after order-level discounts and combo
-- adjustments. Historical order lines remain immutable.

alter function public.get_sales_profitability_report(timestamptz, timestamptz, text)
  rename to get_sales_profitability_report_gross_item_sales;

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
  pizzas jsonb;
  products jsonb;
  additions jsonb;
begin
  -- The renamed function preserves the authorization and all non-item report data.
  result := public.get_sales_profitability_report_gross_item_sales(p_from, p_to, p_bucket);

  with valid_orders as (
    select o.id, o.total_cop, o.delivery_cop
    from public.pos_orders o
    where o.ordered_at >= p_from
      and o.ordered_at < p_to
      and o.status <> 'cancelled'
  ), order_line_totals as (
    select lines.order_id, sum(lines.gross_cop)::numeric as gross_cop
    from (
      select i.order_id, i.line_subtotal_cop::numeric as gross_cop
      from public.pos_order_items i
      join valid_orders o on o.id = i.order_id
      union all
      select i.order_id, a.line_subtotal_cop::numeric as gross_cop
      from public.pos_order_item_additions a
      join public.pos_order_items i on i.id = a.order_item_id
      join valid_orders o on o.id = i.order_id
    ) lines
    group by lines.order_id
  ), item_metrics as (
    select
      i.id,
      i.order_id,
      i.item_kind,
      i.product_name_snapshot,
      i.quantity,
      i.line_cost_cop::numeric as cost_cop,
      case when coalesce(t.gross_cop, 0) > 0
        then i.line_subtotal_cop::numeric * greatest(o.total_cop - o.delivery_cop, 0)::numeric / t.gross_cop
        else 0::numeric
      end as sales_cop
    from public.pos_order_items i
    join valid_orders o on o.id = i.order_id
    join order_line_totals t on t.order_id = i.order_id
  ), addition_metrics as (
    select
      a.name_snapshot,
      a.quantity,
      a.line_cost_cop::numeric as cost_cop,
      case when coalesce(t.gross_cop, 0) > 0
        then a.line_subtotal_cop::numeric * greatest(o.total_cop - o.delivery_cop, 0)::numeric / t.gross_cop
        else 0::numeric
      end as sales_cop
    from public.pos_order_item_additions a
    join public.pos_order_items i on i.id = a.order_item_id
    join valid_orders o on o.id = i.order_id
    join order_line_totals t on t.order_id = i.order_id
  )
  select
    coalesce((select jsonb_agg(to_jsonb(rows) order by rows.sales_cop desc) from (
      select product_name_snapshot as name, sum(quantity)::numeric as units, sum(sales_cop)::numeric as sales_cop,
        sum(cost_cop)::numeric as cost_cop, sum(sales_cop - cost_cop)::numeric as profit_cop,
        case when sum(sales_cop) > 0 then round(sum(sales_cop - cost_cop) * 100 / sum(sales_cop), 2) else null end as margin_pct
      from item_metrics where item_kind = 'pizza' group by product_name_snapshot
    ) rows), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(rows) order by rows.sales_cop desc) from (
      select product_name_snapshot as name, sum(quantity)::numeric as units, sum(sales_cop)::numeric as sales_cop,
        sum(cost_cop)::numeric as cost_cop, sum(sales_cop - cost_cop)::numeric as profit_cop,
        case when sum(sales_cop) > 0 then round(sum(sales_cop - cost_cop) * 100 / sum(sales_cop), 2) else null end as margin_pct
      from item_metrics where item_kind = 'sale_product' group by product_name_snapshot
    ) rows), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(rows) order by rows.sales_cop desc) from (
      select name_snapshot as name, sum(quantity)::numeric as units, sum(sales_cop)::numeric as sales_cop,
        sum(cost_cop)::numeric as cost_cop, sum(sales_cop - cost_cop)::numeric as profit_cop,
        case when sum(sales_cop) > 0 then round(sum(sales_cop - cost_cop) * 100 / sum(sales_cop), 2) else null end as margin_pct
      from addition_metrics group by name_snapshot
    ) rows), '[]'::jsonb)
  into pizzas, products, additions;

  result := jsonb_set(result, '{pizzas}', pizzas, true);
  result := jsonb_set(result, '{products}', products, true);
  result := jsonb_set(result, '{additions}', additions, true);
  return result;
end;
$$;

revoke all on function public.get_sales_profitability_report(timestamptz, timestamptz, text) from public;
grant execute on function public.get_sales_profitability_report(timestamptz, timestamptz, text) to authenticated;

notify pgrst, 'reload schema';
