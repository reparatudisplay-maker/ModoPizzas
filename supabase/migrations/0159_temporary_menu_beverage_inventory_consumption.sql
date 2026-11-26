begin;

-- Alitas remain temporary. Only the explicitly selected, already-inventoried
-- beverage is consumed through the standard FIFO allocation path.
update public.pos_temporary_menu_catalog
set beverage_choice_required = true,
    updated_at = now()
where code in ('ALITAS-MEDIANO', 'ALITAS-GRANDE')
  and beverage_presentation is not null;

alter table public.pos_order_consumptions
  drop constraint if exists pos_order_consumptions_category_check;
alter table public.pos_order_consumptions
  add constraint pos_order_consumptions_category_check
  check (consumption_category in ('recipe', 'packaging', 'beverage'));

do $patch_temporary_beverage_consumption$
declare
  definition text;
  detail_insert text := 'values(inserted_item_id, temporary_catalog.family_item_id, temporary_catalog.code, temporary_components, temporary_selection_snapshot, auth.uid());';
  detail_insert_with_consumption text := E'values(inserted_item_id, temporary_catalog.family_item_id, temporary_catalog.code, temporary_components, temporary_selection_snapshot, auth.uid());\n      -- temporary_beverage_stock_consumption: leaves the meal cost pending while the selected beverage consumes FIFO stock.\n      if temporary_mode = ''drink'' then\n        perform public.pos_allocate_consumption(\n          new_order_id, inserted_item_id, null, ''inventory_item'', temporary_beverage.id, item_quantity, ''unit''::public.stock_unit\n        );\n        update public.pos_order_consumptions\n        set consumption_category = ''beverage''\n        where order_id = new_order_id\n          and order_item_id = inserted_item_id\n          and inventory_item_id = temporary_beverage.id\n          and consumption_category = ''recipe'';\n      end if;';
begin
  select pg_get_functiondef('public.create_pos_order(text,text,text,numeric,numeric,text,text,jsonb)'::regprocedure)
    into definition;

  if position('temporary_beverage_stock_consumption' in definition) = 0 then
    if position(detail_insert in definition) = 0 then
      raise exception 'No se encontró la inserción temporal esperada para registrar el consumo de bebida.';
    end if;
    definition := replace(definition, detail_insert, detail_insert_with_consumption);
    if position('temporary_beverage_stock_consumption' in definition) = 0 then
      raise exception 'No se pudo añadir el consumo FIFO de la bebida temporal.';
    end if;
    execute definition;
  end if;
end;
$patch_temporary_beverage_consumption$;

-- Include only the selected beverage in stock checks and inventory previews.
-- Alitas, papas, lasañas and packaging continue outside temporary consumption.
do $patch_temporary_beverage_shortages$
declare
  definition text;
  sale_product_tail text := E'    from cart_items cart\n    where cart.line_kind = ''sale_product''\n  ),\n  source_metadata as (';
  replacement text := E'    from cart_items cart\n    where cart.line_kind = ''sale_product''\n\n    union all\n\n    select\n      cart.line_position,\n      ''temporary_menu''::text,\n      temporary_catalog.code,\n      cart.quantity,\n      ''inventory_item''::text,\n      nullif(cart.item->''temporary_menu''->>''beverage_inventory_item_id'', '''')::uuid,\n      cart.quantity::numeric,\n      ''unit''::public.stock_unit\n    from cart_items cart\n    join public.pos_temporary_menu_catalog temporary_catalog\n      on temporary_catalog.code = cart.item->>''id''\n    where cart.line_kind = ''temporary_menu''\n      and coalesce(cart.item->''temporary_menu''->>''selection_mode'', '''') = ''drink''\n      and nullif(cart.item->''temporary_menu''->>''beverage_inventory_item_id'', '''') is not null\n  ),\n  source_metadata as (';
begin
  select pg_get_functiondef('public.get_pos_order_stock_shortages_internal(jsonb)'::regprocedure)
    into definition;

  if position('temporary_catalog.code' in definition) = 0 then
    if position(sale_product_tail in definition) = 0 then
      raise exception 'No se encontró el bloque de productos para venta en la validación de stock.';
    end if;
    definition := replace(definition, sale_product_tail, replacement);
    if position('temporary_catalog.code' in definition) = 0 then
      raise exception 'No se pudo añadir la bebida temporal a la validación de stock.';
    end if;
    execute definition;
  end if;
end;
$patch_temporary_beverage_shortages$;

notify pgrst, 'reload schema';
commit;
