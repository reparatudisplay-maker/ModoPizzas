-- Local MVP simplification.
-- Keep only auth-linked users/roles, master data, purchases, purchase lines and simple inventory catalog.

drop table if exists public.print_jobs cascade;
drop table if exists public.payments cascade;
drop table if exists public.cash_register_sessions cascade;
drop table if exists public.order_status_events cascade;
drop table if exists public.order_item_extras cascade;
drop table if exists public.order_items cascade;
drop table if exists public.orders cascade;

drop table if exists public.combo_items cascade;
drop table if exists public.combos cascade;
drop table if exists public.recipes cascade;
drop table if exists public.pizza_flavor_prices cascade;
drop table if exists public.pizza_flavors cascade;
drop table if exists public.pizza_sizes cascade;
drop table if exists public.pizza_extras cascade;
drop table if exists public.products cascade;

drop table if exists public.expenses cascade;
drop table if exists public.inventory_movements cascade;

drop type if exists public.order_kind cascade;
drop type if exists public.order_status cascade;
drop type if exists public.payment_method cascade;
drop type if exists public.print_job_kind cascade;
drop type if exists public.inventory_movement_kind cascade;
