-- Explicitly revoke inherited anonymous execution. The public API only lets
-- authenticated client accounts create requests, while staff handle reviews.
revoke all on function public.create_public_order_request(text, text, text, text, text, text, text, jsonb, uuid) from public, anon;
revoke all on function public.accept_public_order_request(uuid) from public, anon;
revoke all on function public.reject_public_order_request(uuid, text) from public, anon;

grant execute on function public.create_public_order_request(text, text, text, text, text, text, text, jsonb, uuid) to authenticated;
grant execute on function public.accept_public_order_request(uuid) to authenticated;
grant execute on function public.reject_public_order_request(uuid, text) to authenticated;

notify pgrst, 'reload schema';
