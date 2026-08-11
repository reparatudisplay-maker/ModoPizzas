alter table public.inventory_items
  add column if not exists sale_is_enabled boolean not null default false;

update public.inventory_items
set sale_is_enabled = true
where item_kind = 'sale_product'
  and presentation_quantity is not null
  and sale_price_cop > 0
  and sale_is_enabled = false;

create table if not exists public.sale_product_price_history (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  previous_price_cop numeric(14,2) null check (previous_price_cop is null or previous_price_cop >= 0),
  new_price_cop numeric(14,2) not null check (new_price_cop >= 0),
  cost_cop numeric(14,6) null check (cost_cop is null or cost_cop >= 0),
  sale_is_enabled boolean not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists sale_product_price_history_item_created_idx
  on public.sale_product_price_history (inventory_item_id, created_at desc);

alter table public.sale_product_price_history enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'sale_product_price_history'
      and policyname = 'Managers can manage sale product price history'
  ) then
    create policy "Managers can manage sale product price history"
      on public.sale_product_price_history for all
      to authenticated
      using (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]))
      with check (app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]));
  end if;
end $$;

drop view if exists public.pos_sale_product_references;

create or replace view public.pos_sale_product_references
with (security_invoker = true) as
select
  refs.id,
  refs.sku,
  refs.name,
  coalesce(master.image_url, refs.image_url) as image_url,
  refs.presentation_quantity,
  refs.presentation_unit,
  refs.sale_price_cop,
  refs.sale_is_enabled,
  refs.unit,
  refs.is_active,
  master.id as master_inventory_item_id,
  exists (
    select 1
    from public.purchase_items purchase_line
    join public.purchases purchase_header on purchase_header.id = purchase_line.purchase_id
    where purchase_line.inventory_item_id = refs.id
  ) as has_purchase_history
from public.inventory_items refs
join public.inventory_items master
  on master.item_kind = 'sale_product'
 and master.presentation_quantity is null
 and master.is_active = true
 and upper(master.name) = upper(refs.name)
where refs.item_kind = 'sale_product'
  and refs.presentation_quantity is not null
  and refs.presentation_unit is not null
  and refs.is_active = true
  and exists (
    select 1
    from public.purchase_items purchase_line
    join public.purchases purchase_header on purchase_header.id = purchase_line.purchase_id
    where purchase_line.inventory_item_id = refs.id
  );

grant select on public.pos_sale_product_references to authenticated;

create or replace function public.create_pos_order_with_payment(
  p_kind text,
  p_customer_name text,
  p_customer_phone text,
  p_discount_cop numeric,
  p_delivery_cop numeric,
  p_payment_method text,
  p_notes text,
  p_items jsonb,
  p_cash_received_cop numeric default null,
  p_cash_change_cop numeric default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  created_order jsonb;
  item jsonb;
  normalized_items jsonb := '[]'::jsonb;
  configured_price numeric;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'El pedido no tiene productos validos.';
  end if;

  for item in select value from jsonb_array_elements(p_items) with ordinality as items(value, position) order by position
  loop
    if item->>'kind' = 'sale_product' then
      select sale_price_cop
      into configured_price
      from public.inventory_items
      where id = (item->>'id')::uuid
        and item_kind = 'sale_product'
        and presentation_quantity is not null
        and is_active = true
        and sale_is_enabled = true;

      if not found then
        raise exception 'Producto para venta no disponible.';
      end if;

      if configured_price <= 0 then
        raise exception 'El producto % no tiene precio de venta configurado.', coalesce(item->>'id', '');
      end if;

      normalized_items := normalized_items || jsonb_build_array(jsonb_set(item, '{unit_price_cop}', to_jsonb(configured_price), true));
    else
      normalized_items := normalized_items || jsonb_build_array(item);
    end if;
  end loop;

  if p_payment_method = 'cash' then
    if p_cash_received_cop is null then
      raise exception 'Confirma el monto recibido en efectivo.';
    end if;
    if p_cash_change_cop is null then
      raise exception 'Confirma el cambio entregado.';
    end if;
  end if;

  created_order := public.create_pos_order(
    p_kind,
    p_customer_name,
    p_customer_phone,
    p_discount_cop,
    p_delivery_cop,
    p_payment_method,
    p_notes,
    normalized_items
  );

  if p_payment_method = 'cash' then
    perform public.record_pos_cash_payment(
      (created_order->>'id')::uuid,
      p_cash_received_cop,
      p_cash_change_cop
    );

    created_order := jsonb_set(created_order, '{cash_received_cop}', to_jsonb(p_cash_received_cop), true);
    created_order := jsonb_set(created_order, '{cash_change_cop}', to_jsonb(p_cash_change_cop), true);
  end if;

  return created_order;
end;
$$;

grant execute on function public.create_pos_order_with_payment(text, text, text, numeric, numeric, text, text, jsonb, numeric, numeric) to authenticated;

notify pgrst, 'reload schema';
