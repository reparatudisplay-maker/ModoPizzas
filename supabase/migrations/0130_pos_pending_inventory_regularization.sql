-- Registra faltantes excepcionales como deuda trazable, sin crear lotes ni alterar stock.

create table if not exists public.pos_inventory_regularization_debts (
  id uuid primary key default gen_random_uuid(),
  consumption_id uuid not null unique references public.pos_order_consumptions(id) on delete restrict,
  order_id uuid not null references public.pos_orders(id) on delete restrict,
  source_kind text not null check (source_kind in ('inventory_item', 'preparation')),
  source_id uuid not null,
  quantity_base numeric(14, 6) not null check (quantity_base > 0),
  base_unit public.stock_unit not null,
  estimated_unit_cost_cop numeric(18, 8) not null check (estimated_unit_cost_cop >= 0),
  status text not null default 'pending' check (status in ('pending', 'regularized', 'voided')),
  regularized_at timestamptz,
  regularized_by uuid references auth.users(id) on delete set null,
  regularization_notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint pos_inventory_regularization_debts_resolution_check check (
    (status = 'pending' and regularized_at is null and regularized_by is null)
    or status in ('regularized', 'voided')
  )
);

create index if not exists pos_inventory_regularization_debts_pending_idx
  on public.pos_inventory_regularization_debts (status, source_kind, source_id, created_at);

alter table public.pos_inventory_regularization_debts enable row level security;

drop policy if exists "Order staff read pending inventory regularizations" on public.pos_inventory_regularization_debts;
create policy "Order staff read pending inventory regularizations"
  on public.pos_inventory_regularization_debts for select to authenticated
  using (
    public.current_user_can_access_module('pedidos')
    or public.current_user_can_access_module('compras')
    or public.current_user_can_access_module('inventario')
  );

do $patch_allocation$
declare
  definition text;
  old_declaration text := '  total_cost numeric := 0;';
  new_declaration text := E'  total_cost numeric := 0;\n  estimated_unit_cost numeric := 0;';
  old_shortage text := E'  if remaining_base > 0.0001 then\n    raise exception \'Stock insuficiente. Faltan % %.\', round(remaining_base, 3), upper(p_base_unit::text);\n  end if;';
  new_shortage text := E'  if remaining_base > 0.0001 then\n    if coalesce(current_setting(\'app.allow_pending_inventory_regularization\', true), \'false\') = \'true\' then\n      if p_source_kind = \'inventory_item\' then\n        select coalesce(pi.line_total_cop / nullif(public.production_convert_quantity(pi.quantity, pi.unit, p_base_unit, null), 0), 0)\n        into estimated_unit_cost\n        from public.purchase_items pi\n        join public.purchases p on p.id = pi.purchase_id\n        where pi.inventory_item_id = p_source_id\n        order by p.purchased_at desc, pi.id desc\n        limit 1;\n      else\n        select coalesce(pb.unit_cost_cop, 0)\n        into estimated_unit_cost\n        from public.production_batches pb\n        where pb.preparation_id = p_source_id\n        order by pb.elaborated_at desc, pb.production_number desc, pb.id desc\n        limit 1;\n      end if;\n\n      estimated_unit_cost := coalesce(estimated_unit_cost, 0);\n      insert into public.pos_inventory_regularization_debts (\n        consumption_id, order_id, source_kind, source_id, quantity_base, base_unit,\n        estimated_unit_cost_cop, created_by\n      ) values (\n        new_consumption_id, p_order_id, p_source_kind, p_source_id, remaining_base,\n        p_base_unit, estimated_unit_cost, auth.uid()\n      );\n      total_cost := total_cost + remaining_base * estimated_unit_cost;\n    else\n      raise exception \'Stock insuficiente. Faltan % %.\', round(remaining_base, 3), upper(p_base_unit::text);\n    end if;\n  end if;';
begin
  select pg_get_functiondef('public.pos_allocate_consumption(uuid,uuid,uuid,text,uuid,numeric,public.stock_unit)'::regprocedure)
    into definition;
  if position(old_declaration in definition) = 0 or position(old_shortage in definition) = 0 then
    raise exception 'La función de consumo POS no coincide con la versión auditada.';
  end if;
  definition := replace(definition, old_declaration, new_declaration);
  definition := replace(definition, old_shortage, new_shortage);
  execute definition;
end;
$patch_allocation$;

do $patch_discount_writer$
declare
  definition text;
  old_shortage_check text := E'  shortages := public.get_pos_order_stock_shortages(p_items);\n  if jsonb_array_length(shortages) > 0 then\n    raise exception using message = \'POS_STOCK_SHORTAGE\', detail = shortages::text;\n  end if;';
  new_shortage_check text := E'  shortages := public.get_pos_order_stock_shortages(p_items);\n  if jsonb_array_length(shortages) > 0\n    and coalesce(current_setting(\'app.allow_pending_inventory_regularization\', true), \'false\') <> \'true\' then\n    raise exception using message = \'POS_STOCK_SHORTAGE\', detail = shortages::text;\n  end if;';
  old_product_check text := E'    if remaining_quantity > 0 then\n      shortages := public.get_pos_order_stock_shortages(p_items);\n      raise exception using message = \'POS_STOCK_SHORTAGE\', detail = shortages::text;\n    end if;';
  new_product_check text := E'    if remaining_quantity > 0\n      and coalesce(current_setting(\'app.allow_pending_inventory_regularization\', true), \'false\') <> \'true\' then\n      shortages := public.get_pos_order_stock_shortages(p_items);\n      raise exception using message = \'POS_STOCK_SHORTAGE\', detail = shortages::text;\n    end if;';
begin
  select pg_get_functiondef('public.create_pos_order_with_discount_payment(text,text,text,text,numeric,numeric,numeric,text,text,jsonb,numeric,numeric)'::regprocedure)
    into definition;
  if position(old_shortage_check in definition) = 0 or position(old_product_check in definition) = 0 then
    raise exception 'La función de descuentos POS no coincide con la versión auditada.';
  end if;
  definition := replace(definition, old_shortage_check, new_shortage_check);
  definition := replace(definition, old_product_check, new_product_check);
  execute definition;
end;
$patch_discount_writer$;

create or replace function public.create_pos_order_with_pending_stock(
  p_kind text, p_customer_name text, p_customer_phone text, p_discount_type text,
  p_discount_value numeric, p_discount_cop numeric, p_delivery_cop numeric,
  p_payment_method text, p_source_channel text, p_collection_party text, p_notes text,
  p_items jsonb, p_cash_received_cop numeric default null, p_cash_change_cop numeric default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app_private.has_any_role(array['gerente'::public.app_role, 'admin_sistema'::public.app_role]) then
    raise exception 'Solo Gerente o Administrador del sistema puede registrar faltantes pendientes.';
  end if;
  if p_collection_party <> 'business' or p_source_channel <> 'direct' then
    raise exception 'La regularización temporal de faltantes no está disponible para plataformas.';
  end if;
  perform set_config('app.allow_pending_inventory_regularization', 'true', true);
  return public.create_pos_order_with_platform_payment(
    p_kind, p_customer_name, p_customer_phone, p_discount_type, p_discount_value,
    p_discount_cop, p_delivery_cop, p_payment_method, p_source_channel,
    p_collection_party, p_notes, p_items, p_cash_received_cop, p_cash_change_cop
  );
end;
$$;

revoke all on function public.create_pos_order_with_pending_stock(text,text,text,text,numeric,numeric,numeric,text,text,text,text,jsonb,numeric,numeric) from public;
grant execute on function public.create_pos_order_with_pending_stock(text,text,text,text,numeric,numeric,numeric,text,text,text,text,jsonb,numeric,numeric) to authenticated;

notify pgrst, 'reload schema';
