-- Images used by the internal order-entry catalog must not affect the public catalog.
alter table public.pizza_flavors
  add column if not exists pos_image_url text;

comment on column public.pizza_flavors.pos_image_url is
  'Imagen exclusiva para Pedidos > Crear pedido. image_url permanece reservado para el catálogo público.';
