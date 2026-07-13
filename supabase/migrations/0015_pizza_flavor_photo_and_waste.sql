alter table public.pizza_flavors
add column if not exists image_url text;

alter table public.pizza_flavor_prices
add column if not exists waste_percent numeric(5, 2) not null default 5;
