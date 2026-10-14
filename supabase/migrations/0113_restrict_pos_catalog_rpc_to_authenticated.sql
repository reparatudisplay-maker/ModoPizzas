-- Remove the legacy explicit anon grant. The POS catalog is only for staff
-- authenticated in Pedidos; the function itself keeps the module access check.
revoke all on function public.get_pos_sale_product_catalog() from anon;
grant execute on function public.get_pos_sale_product_catalog() to authenticated;

notify pgrst, 'reload schema';
