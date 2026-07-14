alter table public.inventory_movements
drop constraint if exists inventory_movements_movement_kind_check;

alter table public.inventory_movements
add constraint inventory_movements_movement_kind_check
check (movement_kind in ('purchase', 'sale', 'adjustment', 'adjustment_in', 'adjustment_out', 'waste'));
