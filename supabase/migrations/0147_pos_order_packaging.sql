begin;

create table if not exists public.pos_packaging_rules (
  id uuid primary key default gen_random_uuid(),
  target_kind text not null check (target_kind in ('pizza_size', 'sale_product')),
  pizza_size_id uuid references public.pizza_sizes(id) on delete cascade,
  sale_product_id uuid references public.inventory_items(id) on delete cascade,
  service_kind text not null check (service_kind in ('local', 'pickup', 'takeaway', 'delivery')),
  packaging_inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  quantity_base numeric(14,3) not null check (quantity_base > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_packaging_rules_target_check check (
    (target_kind = 'pizza_size' and pizza_size_id is not null and sale_product_id is null)
    or (target_kind = 'sale_product' and sale_product_id is not null and pizza_size_id is null)
  )
);

create unique index if not exists pos_packaging_rules_pizza_unique
  on public.pos_packaging_rules(pizza_size_id, service_kind, packaging_inventory_item_id)
  where target_kind = 'pizza_size';
create unique index if not exists pos_packaging_rules_product_unique
  on public.pos_packaging_rules(sale_product_id, service_kind, packaging_inventory_item_id)
  where target_kind = 'sale_product';

alter table public.pos_packaging_rules enable row level security;
drop policy if exists "Read POS packaging rules" on public.pos_packaging_rules;
create policy "Read POS packaging rules" on public.pos_packaging_rules for select to authenticated
  using (public.current_user_can_access_module('pedidos') or public.current_user_can_access_module('menu'));
drop policy if exists "Manage POS packaging rules" on public.pos_packaging_rules;
create policy "Manage POS packaging rules" on public.pos_packaging_rules for all to authenticated
  using (public.current_user_can_access_module('menu'))
  with check (public.current_user_can_access_module('menu'));

alter table public.pos_order_consumptions
  add column if not exists consumption_category text not null default 'recipe';
alter table public.pos_order_consumptions
  drop constraint if exists pos_order_consumptions_category_check;
alter table public.pos_order_consumptions
  add constraint pos_order_consumptions_category_check check (consumption_category in ('recipe', 'packaging'));

create table if not exists public.pos_order_packaging_consumptions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.pos_orders(id) on delete cascade,
  order_item_id uuid not null references public.pos_order_items(id) on delete cascade,
  consumption_id uuid not null unique references public.pos_order_consumptions(id) on delete cascade,
  packaging_inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  automatic_quantity_base numeric(14,3) not null default 0 check (automatic_quantity_base >= 0),
  quantity_base numeric(14,3) not null check (quantity_base > 0),
  unit_cost_cop numeric(14,6) not null default 0 check (unit_cost_cop >= 0),
  cost_cop numeric(14,2) not null default 0 check (cost_cop >= 0),
  created_at timestamptz not null default now()
);
create index if not exists pos_order_packaging_consumptions_order_idx on public.pos_order_packaging_consumptions(order_id);
alter table public.pos_order_packaging_consumptions enable row level security;
drop policy if exists "Read POS packaging consumptions" on public.pos_order_packaging_consumptions;
create policy "Read POS packaging consumptions" on public.pos_order_packaging_consumptions for select to authenticated
  using (public.current_user_can_access_module('pedidos') or public.current_user_can_access_module('inventario'));

create or replace function public.create_pos_order_with_packaging(
  p_kind text, p_pickup_mode text,
  p_customer_name text, p_customer_phone text, p_discount_type text, p_discount_value numeric, p_discount_cop numeric, p_delivery_cop numeric,
  p_payment_method text, p_source_channel text, p_collection_party text, p_notes text, p_items jsonb,
  p_cash_received_cop numeric default null, p_cash_change_cop numeric default null, p_platform_service text default 'none',
  p_line_pricing jsonb default '[]'::jsonb, p_direct_sales jsonb default '[]'::jsonb, p_allow_pending_stock boolean default false,
  p_packaging_quantities jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public, app_private, pg_temp as $$
declare
  created_order jsonb;
  v_order_id uuid;
  v_order_item_id uuid;
  plan record;
  final_quantity numeric;
  consumption_cost numeric;
  v_consumption_id uuid;
begin
  if not public.current_user_can_access_module('pedidos') then raise exception 'No tienes acceso operativo a pedidos.'; end if;
  if p_kind not in ('local', 'pickup', 'delivery') then raise exception 'Tipo de pedido no válido.'; end if;
  if p_pickup_mode not in ('pickup', 'takeaway') then p_pickup_mode := 'pickup'; end if;
  if jsonb_typeof(coalesce(p_packaging_quantities, '[]'::jsonb)) <> 'array' then raise exception 'Los empaques del pedido no son válidos.'; end if;
  if p_allow_pending_stock then
    if not app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]) then
      raise exception 'Solo Gerente o Administrador del sistema puede registrar faltantes pendientes.';
    end if;
    perform set_config('app.allow_pending_inventory_regularization', 'true', true);
  end if;

  if jsonb_array_length(coalesce(p_direct_sales, '[]'::jsonb)) > 0 then
    created_order := public.create_pos_order_with_direct_sales(
      p_kind, p_customer_name, p_customer_phone, p_discount_type, p_discount_value, p_discount_cop, p_delivery_cop,
      p_payment_method, p_source_channel, p_collection_party, p_notes, p_items, p_cash_received_cop, p_cash_change_cop,
      p_direct_sales, p_allow_pending_stock
    );
  elsif p_source_channel = 'didi' and p_collection_party = 'business' then
    created_order := public.create_pos_order_with_platform_payment_service(
      p_kind, p_customer_name, p_customer_phone, p_discount_type, p_discount_value, p_discount_cop, p_delivery_cop,
      p_payment_method, p_source_channel, p_collection_party, p_notes, p_items, p_cash_received_cop, p_cash_change_cop, p_platform_service
    );
  elsif p_source_channel = 'didi' and p_collection_party = 'platform' then
    if p_allow_pending_stock then
      created_order := public.create_pos_order_with_platform_line_pricing_service_and_pending_stock(
        p_kind, p_customer_name, p_customer_phone, p_discount_type, p_discount_value, p_discount_cop, p_delivery_cop,
        p_payment_method, p_source_channel, p_collection_party, p_notes, p_items, p_cash_received_cop, p_cash_change_cop, p_platform_service, p_line_pricing
      );
    else
      created_order := public.create_pos_order_with_platform_line_pricing_service(
        p_kind, p_customer_name, p_customer_phone, p_discount_type, p_discount_value, p_discount_cop, p_delivery_cop,
        p_payment_method, p_source_channel, p_collection_party, p_notes, p_items, p_cash_received_cop, p_cash_change_cop, p_platform_service, p_line_pricing
      );
    end if;
  elsif p_collection_party = 'platform' then
    if p_allow_pending_stock then
      created_order := public.create_pos_order_with_platform_line_pricing_and_pending_stock(
        p_kind, p_customer_name, p_customer_phone, p_discount_type, p_discount_value, p_discount_cop, p_delivery_cop,
        p_payment_method, p_source_channel, p_collection_party, p_notes, p_items, p_cash_received_cop, p_cash_change_cop, p_line_pricing
      );
    else
      created_order := public.create_pos_order_with_platform_line_pricing(
        p_kind, p_customer_name, p_customer_phone, p_discount_type, p_discount_value, p_discount_cop, p_delivery_cop,
        p_payment_method, p_source_channel, p_collection_party, p_notes, p_items, p_cash_received_cop, p_cash_change_cop, p_line_pricing
      );
    end if;
  elsif p_allow_pending_stock then
    created_order := public.create_pos_order_with_pending_stock(
      p_kind, p_customer_name, p_customer_phone, p_discount_type, p_discount_value, p_discount_cop, p_delivery_cop,
      p_payment_method, p_source_channel, p_collection_party, p_notes, p_items, p_cash_received_cop, p_cash_change_cop
    );
  else
    created_order := public.create_pos_order_with_platform_payment(
      p_kind, p_customer_name, p_customer_phone, p_discount_type, p_discount_value, p_discount_cop, p_delivery_cop,
      p_payment_method, p_source_channel, p_collection_party, p_notes, p_items, p_cash_received_cop, p_cash_change_cop
    );
  end if;

  v_order_id := (created_order->>'id')::uuid;
  select id into v_order_item_id from public.pos_order_items where order_id = v_order_id order by created_at, id limit 1;
  if v_order_item_id is null then return created_order; end if;

  if exists (
    with target_lines as (
      select 'pizza_size'::text as target_kind, config.size_id as target_id from jsonb_array_elements(p_items) item(value) join public.pizza_price_configs config on config.id = (item.value->>'id')::uuid where item.value->>'kind' = 'pizza'
      union
      select 'sale_product'::text, (item.value->>'id')::uuid from jsonb_array_elements(p_items) item(value) where item.value->>'kind' = 'sale_product'
    ), eligible as (
      select distinct rule.packaging_inventory_item_id
      from public.pos_packaging_rules rule join target_lines target on (rule.target_kind = target.target_kind and ((rule.target_kind = 'pizza_size' and rule.pizza_size_id = target.target_id) or (rule.target_kind = 'sale_product' and rule.sale_product_id = target.target_id)))
      where rule.is_active and rule.service_kind = case when p_kind = 'delivery' then 'delivery' when p_kind = 'local' then 'local' when p_pickup_mode = 'takeaway' then 'takeaway' else 'pickup' end
    )
    select 1 from jsonb_array_elements(coalesce(p_packaging_quantities, '[]'::jsonb)) entry
    where not exists (select 1 from eligible where packaging_inventory_item_id::text = entry->>'inventory_item_id')
  ) then raise exception 'El empaque seleccionado no corresponde a este pedido.'; end if;

  for plan in
    with target_lines as (
      select 'pizza_size'::text as target_kind, config.size_id as target_id, sum((item.value->>'quantity')::numeric) as quantity
      from jsonb_array_elements(p_items) item(value)
      join public.pizza_price_configs config on config.id = (item.value->>'id')::uuid
      where item.value->>'kind' = 'pizza'
      group by config.size_id
      union all
      select 'sale_product'::text, (item.value->>'id')::uuid, sum((item.value->>'quantity')::numeric)
      from jsonb_array_elements(p_items) item(value)
      where item.value->>'kind' = 'sale_product'
      group by (item.value->>'id')::uuid
    ), automatic as (
      select rule.packaging_inventory_item_id, sum(rule.quantity_base * target.quantity) as automatic_quantity
      from public.pos_packaging_rules rule
      join target_lines target on (rule.target_kind = target.target_kind and ((rule.target_kind = 'pizza_size' and rule.pizza_size_id = target.target_id) or (rule.target_kind = 'sale_product' and rule.sale_product_id = target.target_id)))
      where rule.is_active and rule.service_kind = case when p_kind = 'delivery' then 'delivery' when p_kind = 'local' then 'local' when p_pickup_mode = 'takeaway' then 'takeaway' else 'pickup' end
      group by rule.packaging_inventory_item_id
    )
    select packaging_inventory_item_id, automatic_quantity from automatic
  loop
    select coalesce((entry->>'quantity_base')::numeric, plan.automatic_quantity)
      into final_quantity
    from jsonb_array_elements(coalesce(p_packaging_quantities, '[]'::jsonb)) entry
    where entry->>'inventory_item_id' = plan.packaging_inventory_item_id::text
    limit 1;
    final_quantity := coalesce(final_quantity, plan.automatic_quantity);
    if final_quantity < 0 then raise exception 'La cantidad de empaque no puede ser negativa.'; end if;
    if final_quantity = 0 then continue; end if;
    consumption_cost := public.pos_allocate_consumption(v_order_id, v_order_item_id, null, 'inventory_item', plan.packaging_inventory_item_id, final_quantity, 'unit');
    select id into v_consumption_id from public.pos_order_consumptions
      where order_id = v_order_id and order_item_id = v_order_item_id and inventory_item_id = plan.packaging_inventory_item_id
      order by created_at desc, id desc limit 1;
    update public.pos_order_consumptions set consumption_category = 'packaging' where id = v_consumption_id;
    insert into public.pos_order_packaging_consumptions(order_id, order_item_id, consumption_id, packaging_inventory_item_id, automatic_quantity_base, quantity_base, unit_cost_cop, cost_cop)
    values(v_order_id, v_order_item_id, v_consumption_id, plan.packaging_inventory_item_id, plan.automatic_quantity, final_quantity, case when final_quantity = 0 then 0 else consumption_cost / final_quantity end, consumption_cost);
  end loop;

  update public.pos_order_items item
  set line_cost_cop = coalesce((select sum(cost_cop) from public.pos_order_consumptions consumption where consumption.order_item_id = item.id), 0)
  where item.id = v_order_item_id;
  return created_order;
end;
$$;

revoke all on function public.create_pos_order_with_packaging(text, text, text, text, text, numeric, numeric, numeric, text, text, text, text, jsonb, numeric, numeric, text, jsonb, jsonb, boolean, jsonb) from public;
grant execute on function public.create_pos_order_with_packaging(text, text, text, text, text, numeric, numeric, numeric, text, text, text, text, jsonb, numeric, numeric, text, jsonb, jsonb, boolean, jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
