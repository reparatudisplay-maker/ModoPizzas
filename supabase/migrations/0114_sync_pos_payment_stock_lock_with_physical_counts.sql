-- Keep the pre-payment sale-product lock in sync with the physical-count-aware
-- allocator. The core order writer already allocates from inventory_source_lots,
-- but this earlier guard still read raw purchase balances and could reject a
-- valid sale after a finalized physical count.
do $$
declare
  definition text;
  old_sale_product_lock text := $old$
    for lot in
      select pi.id, greatest(0,
        public.production_convert_quantity(pi.quantity, pi.unit, 'unit'::public.stock_unit, null)
        - coalesce((
          select sum(public.production_convert_quantity(pca.quantity_base, pca.base_unit, 'unit'::public.stock_unit, null))
          from public.production_consumption_allocations pca
          where pca.purchase_item_id = pi.id
        ), 0)
        - coalesce((
          select sum(public.production_convert_quantity(poca.quantity_base, poca.base_unit, 'unit'::public.stock_unit, null))
          from public.pos_order_consumption_allocations poca
          join public.pos_order_consumptions poc on poc.id = poca.consumption_id
          join public.pos_orders po on po.id = poc.order_id
          where poca.purchase_item_id = pi.id and po.status <> 'cancelled'
        ), 0)
      ) as available_quantity
      from public.purchase_items pi
      join public.purchases p on p.id = pi.purchase_id
      where pi.inventory_item_id = sale_product.inventory_item_id
      order by pi.expiration_date asc nulls last, p.purchased_at asc, pi.id asc
      for update of pi
    loop
      available_quantity := lot.available_quantity;
      remaining_quantity := greatest(0, remaining_quantity - available_quantity);
    end loop;$old$;
  new_sale_product_lock text := $new$
    for lot in
      select pi.id, lots.available_base as available_quantity
      from public.purchase_items pi
      join public.purchases p on p.id = pi.purchase_id
      join lateral app_private.inventory_source_lots(
        'inventory_item',
        sale_product.inventory_item_id,
        'unit'::public.stock_unit
      ) lots on lots.origin_id = pi.id
      where pi.inventory_item_id = sale_product.inventory_item_id
        and lots.available_base > 0
      order by pi.expiration_date asc nulls last, p.purchased_at asc, pi.id asc
      for update of pi
    loop
      available_quantity := lot.available_quantity;
      remaining_quantity := greatest(0, remaining_quantity - available_quantity);
    end loop;$new$;
begin
  select pg_get_functiondef(
    'public.create_pos_order_with_discount_payment(text,text,text,text,numeric,numeric,numeric,text,text,jsonb,numeric,numeric)'::regprocedure
  ) into definition;

  if position(old_sale_product_lock in definition) = 0 then
    raise exception 'La validacion de stock POS no coincide con la version esperada.';
  end if;

  execute replace(definition, old_sale_product_lock, new_sale_product_lock);
end;
$$;

notify pgrst, 'reload schema';
