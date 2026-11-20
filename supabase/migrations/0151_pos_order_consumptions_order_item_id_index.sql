-- Cocina consulta los consumos por las líneas activas de pedido. Este índice evita
-- recorrer todos los consumos cuando se carga más de una línea de cocina.
create index if not exists pos_order_consumptions_order_item_id_idx
  on public.pos_order_consumptions (order_item_id);
