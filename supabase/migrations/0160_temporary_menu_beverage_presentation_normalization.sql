begin;

-- The POS displays friendly volumes (400 ML, 1 L, 1,5 L), while inventory
-- numerics can be stored as 400.000 ML or 1500.000 ML. Compare both sides
-- in canonical millilitres so a valid selected beverage reaches FIFO.
do $patch_temporary_beverage_presentation$
declare
  definition text;
  previous_condition text := E'            and upper(trim(coalesce(presentation_quantity::text, '''') || '' '' || coalesce(presentation_unit::text, ''''))) = upper(temporary_catalog.beverage_presentation)';
  normalized_condition text := E'            and (case when presentation_unit::text = ''l'' then presentation_quantity * 1000 else presentation_quantity end) =\n              (case\n                when upper(trim(temporary_catalog.beverage_presentation)) like ''% L'' then\n                  replace(regexp_replace(upper(trim(temporary_catalog.beverage_presentation)), ''[^0-9,\\.]'', '''', ''g''), '','', ''.'')::numeric * 1000\n                else\n                  replace(regexp_replace(upper(trim(temporary_catalog.beverage_presentation)), ''[^0-9,\\.]'', '''', ''g''), '','', ''.'')::numeric\n              end)';
begin
  select pg_get_functiondef('public.create_pos_order(text,text,text,numeric,numeric,text,text,jsonb)'::regprocedure)
    into definition;

  if position('temporary_beverage_presentation_normalized' in definition) = 0 then
    if position(previous_condition in definition) = 0 then
      raise exception 'No se encontró la validación de presentación temporal esperada.';
    end if;
    definition := replace(definition, previous_condition, normalized_condition);
    definition := replace(
      definition,
      'temporary_selection_snapshot := jsonb_build_object(''mode'', ''drink'', ''beverage_inventory_item_id'', temporary_beverage.id, ''beverage_name'', temporary_beverage.name);',
      'temporary_selection_snapshot := jsonb_build_object(''mode'', ''drink'', ''beverage_inventory_item_id'', temporary_beverage.id, ''beverage_name'', temporary_beverage.name, ''temporary_beverage_presentation_normalized'', true);'
    );
    if position('temporary_beverage_presentation_normalized' in definition) = 0 then
      raise exception 'No se pudo instalar la validación normalizada de bebidas temporales.';
    end if;
    execute definition;
  end if;
end;
$patch_temporary_beverage_presentation$;

notify pgrst, 'reload schema';
commit;
