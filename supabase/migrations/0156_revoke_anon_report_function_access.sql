-- The reporting RPC is security definer and already performs role checks.
-- Do not expose it to anonymous callers through inherited default privileges.
revoke all on function public.get_sales_profitability_report(timestamptz, timestamptz, text) from anon;
revoke all on function public.get_sales_profitability_report(timestamptz, timestamptz, text) from public;
grant execute on function public.get_sales_profitability_report(timestamptz, timestamptz, text) to authenticated;

notify pgrst, 'reload schema';
