-- POS staff may validate and consume stock through these narrow, guarded RPCs.
-- They do not receive direct read access to inventory, purchases, or production lots.

alter function public.get_pos_order_stock_shortages(jsonb)
  rename to get_pos_order_stock_shortages_internal;

revoke all on function public.get_pos_order_stock_shortages_internal(jsonb) from public;
revoke all on function public.get_pos_order_stock_shortages_internal(jsonb) from authenticated;

create or replace function public.get_pos_order_stock_shortages(p_items jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.current_user_can_access_module('pedidos') then
    raise exception 'No tienes acceso operativo a pedidos.';
  end if;

  return public.get_pos_order_stock_shortages_internal(p_items);
end;
$$;

revoke all on function public.get_pos_order_stock_shortages(jsonb) from public;
grant execute on function public.get_pos_order_stock_shortages(jsonb) to authenticated;

-- The payment RPC locks and allocates FEFO/FIFO lots in the same transaction.
-- It must read those protected rows as its owner after authorizing the caller.
alter function public.create_pos_order_with_payment(text, text, text, numeric, numeric, text, text, jsonb, numeric, numeric)
  security definer;
alter function public.create_pos_order_with_payment(text, text, text, numeric, numeric, text, text, jsonb, numeric, numeric)
  set search_path = public, pg_temp;

notify pgrst, 'reload schema';
