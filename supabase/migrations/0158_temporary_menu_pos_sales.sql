begin;

-- Temporary sales for families that are not yet integrated with recipes. This
-- depends on 0157: it reuses its family records and never creates stock lots.
do $$
begin
  if to_regclass('public.menu_families') is null then
    raise exception 'La migración 0158 requiere aplicar primero 0157_universal_menu_families.';
  end if;
end $$;

insert into public.menu_families(name, slug, description, is_active, sort_order)
values
  ('ALITAS', 'alitas', 'Ventas temporales sin consumos hasta integrar recetas.', true, 20),
  ('LASAÑAS', 'lasanas', 'Ventas temporales sin consumos hasta integrar recetas.', true, 30)
on conflict (slug) do update set description = excluded.description, updated_at = now();

insert into public.menu_family_items(family_id, sku, name, commercial_description, is_active, sort_order)
select family.id, source.sku, source.name, source.description, true, source.sort_order
from (
  values
    ('alitas', 'TMP-ALITAS-MINI', 'ALITAS MINI', '2 alitas + 100 G papas + gaseosa 250 ML', 10),
    ('alitas', 'TMP-ALITAS-PERSONAL', 'ALITAS PERSONAL', '4 alitas + 150 G papas + gaseosa 400 ML', 20),
    ('alitas', 'TMP-ALITAS-MEDIANO', 'ALITAS MEDIANO', '8 alitas + 300 G papas + gaseosa 1 L', 30),
    ('alitas', 'TMP-ALITAS-GRANDE', 'ALITAS GRANDE', '16 alitas + 600 G papas + gaseosa 1,5 L', 40),
    ('alitas', 'TMP-ALITA-SUELTA', 'ALITA SUELTA', '1 alita entera', 50),
    ('alitas', 'TMP-PAPAS-120G', 'PORCIÓN DE PAPAS', '120 G de papas', 60),
    ('lasanas', 'TMP-LASANA-CARNE', 'LASAÑA DE CARNE', 'Lasaña de carne', 10)
) as source(family_slug, sku, name, description, sort_order)
join public.menu_families family on family.slug = source.family_slug
on conflict (sku) do update set name = excluded.name, commercial_description = excluded.commercial_description, sort_order = excluded.sort_order, updated_at = now();

create table if not exists public.pos_temporary_menu_catalog (
  code text primary key,
  family_item_id uuid not null unique references public.menu_family_items(id) on delete restrict,
  sale_price_cop numeric(14,2) not null check (sale_price_cop > 0),
  components_snapshot jsonb not null check (jsonb_typeof(components_snapshot) = 'array'),
  beverage_presentation text,
  beverage_choice_required boolean not null default false,
  allows_fries_substitution boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_temporary_menu_catalog_beverage_check check (
    (beverage_presentation is null and not beverage_choice_required and not allows_fries_substitution)
    or beverage_presentation is not null
  )
);

insert into public.pos_temporary_menu_catalog(code, family_item_id, sale_price_cop, components_snapshot, beverage_presentation, beverage_choice_required, allows_fries_substitution)
select source.code, item.id, source.price_cop, source.components_snapshot::jsonb, source.beverage_presentation, source.choice_required, source.allows_substitution
from (
  values
    ('ALITAS-MINI', 'TMP-ALITAS-MINI', 12900::numeric, '[{"name":"ALITAS ENTERAS","quantity":"2"},{"name":"PAPAS","quantity":"100 G"},{"name":"GASEOSA","quantity":"250 ML"}]', '250 ML', true, true),
    ('ALITAS-PERSONAL', 'TMP-ALITAS-PERSONAL', 20900::numeric, '[{"name":"ALITAS ENTERAS","quantity":"4"},{"name":"PAPAS","quantity":"150 G"},{"name":"GASEOSA","quantity":"400 ML"}]', '400 ML', true, true),
    ('ALITAS-MEDIANO', 'TMP-ALITAS-MEDIANO', 36900::numeric, '[{"name":"ALITAS ENTERAS","quantity":"8"},{"name":"PAPAS","quantity":"300 G"},{"name":"GASEOSA","quantity":"1 L"}]', '1 L', false, false),
    ('ALITAS-GRANDE', 'TMP-ALITAS-GRANDE', 64900::numeric, '[{"name":"ALITAS ENTERAS","quantity":"16"},{"name":"PAPAS","quantity":"600 G"},{"name":"GASEOSA","quantity":"1,5 L"}]', '1,5 L', false, false),
    ('ALITA-SUELTA', 'TMP-ALITA-SUELTA', 3000::numeric, '[{"name":"ALITA ENTERA","quantity":"1"}]', null, false, false),
    ('PAPAS-120G', 'TMP-PAPAS-120G', 5500::numeric, '[{"name":"PAPAS","quantity":"120 G"}]', null, false, false),
    ('LASANA-CARNE', 'TMP-LASANA-CARNE', 24900::numeric, '[{"name":"LASAÑA DE CARNE","quantity":"1"}]', null, false, false)
) as source(code, sku, price_cop, components_snapshot, beverage_presentation, choice_required, allows_substitution)
join public.menu_family_items item on item.sku = source.sku
on conflict (code) do update set
  family_item_id = excluded.family_item_id,
  sale_price_cop = excluded.sale_price_cop,
  components_snapshot = excluded.components_snapshot,
  beverage_presentation = excluded.beverage_presentation,
  beverage_choice_required = excluded.beverage_choice_required,
  allows_fries_substitution = excluded.allows_fries_substitution,
  updated_at = now();

update public.menu_family_prices price
set sale_price_cop = catalog.sale_price_cop, updated_at = now()
from public.pos_temporary_menu_catalog catalog
where price.family_item_id = catalog.family_item_id
  and price.presentation_id is null
  and price.is_active
  and price.valid_until is null;

insert into public.menu_family_prices(family_item_id, sale_price_cop, is_active)
select catalog.family_item_id, catalog.sale_price_cop, true
from public.pos_temporary_menu_catalog catalog
where not exists (
  select 1
  from public.menu_family_prices price
  where price.family_item_id = catalog.family_item_id
    and price.presentation_id is null
    and price.is_active
    and price.valid_until is null
);

alter table public.pos_order_items drop constraint if exists pos_order_items_item_kind_check;
alter table public.pos_order_items add constraint pos_order_items_item_kind_check
  check (item_kind in ('pizza', 'sale_product', 'free_sale', 'temporary_menu'));
alter table public.pos_order_items drop constraint if exists pos_order_items_source_check;
alter table public.pos_order_items add constraint pos_order_items_source_check check (
  (item_kind = 'pizza' and pizza_price_config_id is not null and inventory_item_id is null)
  or (item_kind = 'sale_product' and inventory_item_id is not null and pizza_price_config_id is null)
  or (item_kind in ('free_sale', 'temporary_menu') and inventory_item_id is null and pizza_price_config_id is null)
);
alter table public.pos_order_items alter column line_cost_cop drop not null;

create table if not exists public.pos_order_temporary_menu_details (
  order_item_id uuid primary key references public.pos_order_items(id) on delete restrict,
  family_item_id uuid not null references public.menu_family_items(id) on delete restrict,
  catalog_code text not null references public.pos_temporary_menu_catalog(code) on delete restrict,
  integration_status text not null default 'pending' check (integration_status in ('pending', 'integrated', 'regularized')),
  cost_status text not null default 'pending' check (cost_status in ('pending', 'estimated', 'finalized')),
  components_snapshot jsonb not null check (jsonb_typeof(components_snapshot) = 'array'),
  selection_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(selection_snapshot) = 'object'),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create index if not exists pos_order_temporary_menu_details_pending_idx on public.pos_order_temporary_menu_details(integration_status, created_at);
alter table public.pos_temporary_menu_catalog enable row level security;
alter table public.pos_order_temporary_menu_details enable row level security;
drop policy if exists "Read temporary POS catalog" on public.pos_temporary_menu_catalog;
drop policy if exists "Read temporary POS details" on public.pos_order_temporary_menu_details;
create policy "Read temporary POS catalog" on public.pos_temporary_menu_catalog for select to authenticated using (public.current_user_can_access_module('pedidos'));
create policy "Read temporary POS details" on public.pos_order_temporary_menu_details for select to authenticated using (public.current_user_can_access_module('pedidos') or public.current_user_can_access_module('reportes') or public.current_user_can_access_module('cocina'));

-- Existing payment, platform and cash writers all call this core writer. Extend
-- it only with a validated temporary branch so Pizza behavior stays unchanged.
do $patch_core$
declare
  definition text;
  old_branch text := E'    else\n      raise exception ''Tipo de item no valido.'';\n    end if;';
  new_branch text := E'    elsif item_kind_value = ''temporary_menu'' then\n      select * into temporary_catalog\n      from public.pos_temporary_menu_catalog\n      where code = coalesce(item->>''id'', '''') and is_active\n      for share;\n      if not found then raise exception ''Producto temporal no disponible.''; end if;\n      temporary_selection := coalesce(item->''temporary_menu'', ''{}''::jsonb);\n      temporary_mode := coalesce(temporary_selection->>''selection_mode'', ''none'');\n      temporary_components := temporary_catalog.components_snapshot;\n      temporary_selection_snapshot := jsonb_build_object(''mode'', temporary_mode);\n      if temporary_catalog.beverage_choice_required then\n        if temporary_mode = ''fries'' and temporary_catalog.allows_fries_substitution then\n          temporary_components := jsonb_set(temporary_components, ''{2,name}'', ''"PAPAS ADICIONALES"''::jsonb, true);\n          temporary_components := jsonb_set(temporary_components, ''{2,quantity}'', coalesce(temporary_components->1->''quantity'', temporary_components->2->''quantity''), true);\n          temporary_selection_snapshot := jsonb_build_object(''mode'', ''fries'', ''replacement'', ''Gaseosa sustituida por papas adicionales'');\n        elsif temporary_mode = ''drink'' then\n          select id, name into temporary_beverage\n          from public.inventory_items\n          where id = nullif(temporary_selection->>''beverage_inventory_item_id'', '''')::uuid\n            and item_kind = ''sale_product'' and is_active and sale_is_enabled\n            and upper(trim(coalesce(presentation_quantity::text, '''') || '' '' || coalesce(presentation_unit::text, ''''))) = upper(temporary_catalog.beverage_presentation)\n          for share;\n          if not found then raise exception ''Selecciona una gaseosa disponible de %.'', temporary_catalog.beverage_presentation; end if;\n          temporary_components := jsonb_set(temporary_components, ''{2,name}'', to_jsonb(temporary_beverage.name), true);\n          temporary_selection_snapshot := jsonb_build_object(''mode'', ''drink'', ''beverage_inventory_item_id'', temporary_beverage.id, ''beverage_name'', temporary_beverage.name);\n        else\n          raise exception ''Selecciona la gaseosa o la sustitución por papas.'';\n        end if;\n      elsif temporary_mode not in (''none'', '''') then\n        raise exception ''La opción temporal no corresponde a este producto.'';\n      end if;\n      line_price := temporary_catalog.sale_price_cop;\n      item_subtotal := round(line_price * item_quantity, 2);\n      subtotal_value := subtotal_value + item_subtotal;\n      insert into public.pos_order_items(order_id, item_kind, quantity, product_name_snapshot, sku_snapshot, unit_price_cop, line_subtotal_cop, line_cost_cop, cart_line_key, notes)\n      values(new_order_id, ''temporary_menu'', item_quantity, (select item.name from public.menu_family_items item where item.id = temporary_catalog.family_item_id), (select item.sku from public.menu_family_items item where item.id = temporary_catalog.family_item_id), line_price, item_subtotal, null, nullif(item->>''line_key'', ''''), ''PENDIENTE DE INTEGRACIÓN DE COSTOS Y CONSUMOS'')\n      returning id into inserted_item_id;\n      insert into public.pos_order_temporary_menu_details(order_item_id, family_item_id, catalog_code, components_snapshot, selection_snapshot, created_by)\n      values(inserted_item_id, temporary_catalog.family_item_id, temporary_catalog.code, temporary_components, temporary_selection_snapshot, auth.uid());\n    else\n      raise exception ''Tipo de item no valido.'';\n    end if;';
begin
  select pg_get_functiondef('public.create_pos_order(text,text,text,numeric,numeric,text,text,jsonb)'::regprocedure) into definition;
  if position('temporary_menu' in definition) = 0 then
    definition := replace(definition, 'source_unit_value public.stock_unit;', 'source_unit_value public.stock_unit; temporary_catalog record; temporary_beverage record; temporary_selection jsonb; temporary_selection_snapshot jsonb; temporary_components jsonb; temporary_mode text;');
    definition := replace(definition, 'item_id := (item->>''id'')::uuid;', 'item_id := case when item_kind_value = ''temporary_menu'' then null else (item->>''id'')::uuid end;');
    definition := replace(definition, old_branch, new_branch);
    if position('temporary_catalog record' in definition) = 0 or position('Producto temporal no disponible.' in definition) = 0 then
      raise exception 'No se pudo extender de forma segura el escritor POS para ventas temporales.';
    end if;
    execute definition;
  end if;
end;
$patch_core$;

do $patch_shortages$
declare definition text;
begin
  select pg_get_functiondef('public.get_pos_order_stock_shortages_internal(jsonb)'::regprocedure) into definition;
  if position('temporary_menu' in definition) = 0 then
    definition := replace(definition, 'nullif(item.value->>''id'', '''')::uuid as item_id,', 'case when item.value->>''kind'' = ''temporary_menu'' then null else nullif(item.value->>''id'', '''')::uuid end as item_id,');
    if position('case when item.value->>''kind'' = ''temporary_menu''' in definition) = 0 then raise exception 'No se pudo excluir las líneas temporales de la validación de stock.'; end if;
    execute definition;
  end if;
end;
$patch_shortages$;

create or replace function public.create_kitchen_item_for_pos_order_item()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.item_kind in ('pizza', 'temporary_menu') then
    insert into public.kitchen_order_items(order_id, order_item_id, status, created_by)
    values (new.order_id, new.id, 'pending', auth.uid()) on conflict (order_item_id) do nothing;
  end if;
  return new;
end;
$$;

-- Packaging remains tied only to Pizza and sale-product targets. Never replace a
-- null temporary cost with zero when a mixed order contains packaging.
do $patch_packaging$
declare definition text;
begin
  select pg_get_functiondef('public.create_pos_order_with_packaging(text,text,text,text,text,numeric,numeric,numeric,text,text,text,text,jsonb,numeric,numeric,text,jsonb,jsonb,boolean,jsonb)'::regprocedure) into definition;
  if position('item.item_kind <> ''temporary_menu''' in definition) = 0 then
    definition := replace(definition, 'where item.id = v_order_item_id;', 'where item.id = v_order_item_id and item.item_kind <> ''temporary_menu'';');
    if position('item.item_kind <> ''temporary_menu''' in definition) = 0 then raise exception 'No se pudo preservar el costo pendiente de líneas temporales.'; end if;
    execute definition;
  end if;
end;
$patch_packaging$;

-- Profitability must never interpret a pending cost as zero. Sales remain in
-- revenue, while profitability KPIs are explicitly unavailable until costs are integrated.
alter function public.get_sales_profitability_report(timestamptz, timestamptz, text)
  rename to get_sales_profitability_report_before_temporary_menu;
create or replace function public.get_sales_profitability_report(p_from timestamptz, p_to timestamptz, p_bucket text default 'day')
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare result jsonb; pending_sales numeric;
begin
  result := public.get_sales_profitability_report_before_temporary_menu(p_from, p_to, p_bucket);
  select coalesce(sum(item.line_subtotal_cop), 0) into pending_sales
  from public.pos_order_items item join public.pos_orders order_header on order_header.id = item.order_id
  where item.item_kind = 'temporary_menu' and order_header.status <> 'cancelled' and order_header.ordered_at >= p_from and order_header.ordered_at < p_to;
  if pending_sales > 0 then
    result := jsonb_set(result, '{summary,pending_cost_sales_cop}', to_jsonb(pending_sales), true);
    result := jsonb_set(result, '{summary,cost_cop}', 'null'::jsonb, true);
    result := jsonb_set(result, '{summary,gross_profit_cop}', 'null'::jsonb, true);
    result := jsonb_set(result, '{summary,operating_result_cop}', 'null'::jsonb, true);
    result := jsonb_set(result, '{summary,gross_margin_pct}', 'null'::jsonb, true);
    result := jsonb_set(result, '{summary,operating_margin_pct}', 'null'::jsonb, true);
  end if;
  return result;
end;
$$;
revoke all on function public.get_sales_profitability_report(timestamptz, timestamptz, text) from public;
grant execute on function public.get_sales_profitability_report(timestamptz, timestamptz, text) to authenticated;

notify pgrst, 'reload schema';
commit;
