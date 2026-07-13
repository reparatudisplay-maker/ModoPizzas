alter table public.pizza_sizes
add column if not exists diameter_cm numeric(6, 2);
