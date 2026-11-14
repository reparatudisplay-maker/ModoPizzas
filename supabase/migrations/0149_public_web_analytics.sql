begin;

create table if not exists public.public_web_analytics_hourly (
  hour_bucket timestamptz not null,
  event_type text not null check (event_type in ('page_view', 'product_view', 'product_order', 'combo_select', 'cta_click')),
  event_action text not null default '',
  page_path text not null default '/',
  entity_kind text not null default '' check (entity_kind in ('', 'pizza_price', 'sale_product', 'combo')),
  entity_id uuid not null default '00000000-0000-0000-0000-000000000000',
  browser text not null default 'Other',
  device_type text not null default 'desktop' check (device_type in ('desktop', 'mobile', 'tablet', 'other')),
  operating_system text not null default 'Other',
  country text not null default '',
  city text not null default '',
  event_count bigint not null default 0 check (event_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (hour_bucket, event_type, event_action, page_path, entity_kind, entity_id, browser, device_type, operating_system, country, city)
);

create index if not exists public_web_analytics_hourly_range_idx
  on public.public_web_analytics_hourly (hour_bucket, event_type);

alter table public.public_web_analytics_hourly enable row level security;

create or replace function public.increment_public_web_analytics(
  p_hour_bucket timestamptz,
  p_event_type text,
  p_event_action text,
  p_page_path text,
  p_entity_kind text,
  p_entity_id uuid,
  p_browser text,
  p_device_type text,
  p_operating_system text,
  p_country text,
  p_city text,
  p_event_count integer default 1
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_event_count < 1 or p_event_count > 12 then
    raise exception 'Cantidad de eventos no válida.';
  end if;

  insert into public.public_web_analytics_hourly (
    hour_bucket, event_type, event_action, page_path, entity_kind, entity_id,
    browser, device_type, operating_system, country, city, event_count
  ) values (
    date_trunc('hour', p_hour_bucket), p_event_type, coalesce(p_event_action, ''), coalesce(p_page_path, '/'),
    coalesce(p_entity_kind, ''), coalesce(p_entity_id, '00000000-0000-0000-0000-000000000000'),
    coalesce(p_browser, 'Other'), coalesce(p_device_type, 'other'), coalesce(p_operating_system, 'Other'),
    coalesce(p_country, ''), coalesce(p_city, ''), p_event_count
  )
  on conflict (hour_bucket, event_type, event_action, page_path, entity_kind, entity_id, browser, device_type, operating_system, country, city)
  do update set event_count = public.public_web_analytics_hourly.event_count + excluded.event_count,
                updated_at = now();
end;
$$;

revoke all on function public.increment_public_web_analytics(timestamptz, text, text, text, text, uuid, text, text, text, text, text, integer) from public;
grant execute on function public.increment_public_web_analytics(timestamptz, text, text, text, text, uuid, text, text, text, text, text, integer) to service_role;

create or replace function public.get_public_web_analytics_report(
  p_from timestamptz,
  p_to timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not public.current_user_can_access_module('reportes') then
    raise exception 'No tienes acceso a reportes.';
  end if;

  with filtered as (
    select *
    from public.public_web_analytics_hourly
    where hour_bucket >= p_from and hour_bucket < p_to
  ), summary as (
    select
      coalesce(sum(event_count) filter (where event_type = 'page_view'), 0) as visits,
      coalesce(sum(event_count) filter (where event_type <> 'page_view'), 0) as interactions,
      coalesce(sum(event_count) filter (where event_type in ('product_view', 'product_order', 'combo_select')), 0) as product_consults,
      coalesce(sum(event_count) filter (where event_type = 'cta_click'), 0) as commercial_clicks
    from filtered
  ), timeline as (
    select
      to_char(hour_bucket at time zone 'America/Bogota', 'DD/MM HH24:00') as label,
      min(hour_bucket) as sort_at,
      sum(event_count) filter (where event_type = 'page_view') as visits,
      sum(event_count) filter (where event_type <> 'page_view') as interactions
    from filtered
    group by hour_bucket
    order by sort_at
  ), products as (
    select
      case
        when entity_kind = 'pizza_price' then coalesce(flavor.name || ' · ' || size.name, 'Pizza')
        when entity_kind = 'sale_product' then coalesce(item.name, 'Producto')
        when entity_kind = 'combo' then coalesce(combo.name, 'Combo')
        else 'Sin referencia'
      end as name,
      entity_kind as kind,
      sum(event_count) as count
    from filtered f
    left join public.pizza_price_configs price on f.entity_kind = 'pizza_price' and price.id = f.entity_id
    left join public.pizza_flavors flavor on flavor.id = price.flavor_id
    left join public.pizza_sizes size on size.id = price.size_id
    left join public.inventory_items item on f.entity_kind = 'sale_product' and item.id = f.entity_id
    left join public.combo_configs combo on f.entity_kind = 'combo' and combo.id = f.entity_id
    where event_type in ('product_view', 'product_order', 'combo_select')
    group by 1, 2
    order by count desc, name
    limit 12
  ), calls_to_action as (
    select event_action as name, sum(event_count) as count
    from filtered
    where event_type in ('cta_click', 'product_order', 'combo_select')
    group by event_action
    order by count desc, name
  ), browsers as (
    select browser as name, sum(event_count) as count
    from filtered
    where event_type = 'page_view'
    group by browser
    order by count desc, name
  ), devices as (
    select device_type as name, sum(event_count) as count
    from filtered
    where event_type = 'page_view'
    group by device_type
    order by count desc, name
  ), operating_systems as (
    select operating_system as name, sum(event_count) as count
    from filtered
    where event_type = 'page_view'
    group by operating_system
    order by count desc, name
  ), locations as (
    select nullif(city, '') as city, nullif(country, '') as country, sum(event_count) as count
    from filtered
    where event_type = 'page_view' and (city <> '' or country <> '')
    group by 1, 2
    order by count desc, city nulls last, country nulls last
    limit 12
  )
  select jsonb_build_object(
    'summary', (select jsonb_build_object('visits', visits, 'interactions', interactions, 'product_consults', product_consults, 'commercial_clicks', commercial_clicks) from summary),
    'timeline', coalesce((select jsonb_agg(jsonb_build_object('label', label, 'visits', visits, 'interactions', interactions) order by sort_at) from timeline), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'kind', kind, 'count', count)) from products), '[]'::jsonb),
    'ctas', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'count', count)) from calls_to_action), '[]'::jsonb),
    'browsers', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'count', count)) from browsers), '[]'::jsonb),
    'devices', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'count', count)) from devices), '[]'::jsonb),
    'operating_systems', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'count', count)) from operating_systems), '[]'::jsonb),
    'locations', coalesce((select jsonb_agg(jsonb_build_object('city', city, 'country', country, 'count', count)) from locations), '[]'::jsonb)
  ) into v_result;

  return coalesce(v_result, '{}'::jsonb);
end;
$$;

revoke all on function public.get_public_web_analytics_report(timestamptz, timestamptz) from public;
grant execute on function public.get_public_web_analytics_report(timestamptz, timestamptz) to authenticated;

notify pgrst, 'reload schema';
commit;
