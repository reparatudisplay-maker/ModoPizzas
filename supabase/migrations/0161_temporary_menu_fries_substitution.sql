begin;

-- Approved substitutions retain the commercial price while keeping the meal
-- consumption pending; only a chosen beverage may consume FIFO stock.
update public.pos_temporary_menu_catalog
set allows_fries_substitution = true,
    updated_at = now()
where code in ('ALITAS-MEDIANO', 'ALITAS-GRANDE');

commit;
