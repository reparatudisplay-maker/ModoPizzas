begin;

create or replace function public.register_platform_settlement(p_platform text, p_received_at timestamptz, p_received_cop numeric, p_destination_account text, p_notes text, p_allocations jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare settlement_id uuid; allocation jsonb; receivable_row public.platform_receivables%rowtype; net_total numeric := 0; allocated_gross numeric;
begin
  if not public.current_user_can_access_module('caja') then raise exception 'No tienes acceso a caja.'; end if;
  if p_platform not in ('rappi', 'didi') or p_received_cop <= 0 or nullif(btrim(p_destination_account), '') is null then raise exception 'La liquidación no es válida.'; end if;
  if jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) = 0 then raise exception 'Selecciona al menos un pedido.'; end if;

  insert into public.platform_settlements(platform, received_at, received_cop, destination_account, notes, created_by)
  values (p_platform, coalesce(p_received_at, now()), p_received_cop, btrim(p_destination_account), nullif(btrim(p_notes), ''), auth.uid()) returning id into settlement_id;

  for allocation in select value from jsonb_array_elements(p_allocations) loop
    select * into receivable_row from public.platform_receivables where id = (allocation->>'receivable_id')::uuid and platform = p_platform and status = 'pending' for update;
    if not found then raise exception 'Una cuenta por cobrar ya no está disponible.'; end if;
    if coalesce((allocation->>'gross_cop')::numeric, 0) <= 0 or coalesce((allocation->>'commission_cop')::numeric, 0) < 0 or coalesce((allocation->>'net_cop')::numeric, 0) <= 0 then raise exception 'Los importes de la liquidación no son válidos.'; end if;

    select coalesce(sum(gross_cop), 0) into allocated_gross from public.platform_settlement_allocations where receivable_id = receivable_row.id;
    if allocated_gross + (allocation->>'gross_cop')::numeric > receivable_row.gross_cop then raise exception 'El abono supera el saldo bruto pendiente.'; end if;

    insert into public.platform_settlement_allocations(settlement_id, receivable_id, gross_cop, commission_cop, net_cop, difference_cop)
    values (settlement_id, receivable_row.id, (allocation->>'gross_cop')::numeric, (allocation->>'commission_cop')::numeric, (allocation->>'net_cop')::numeric, (allocation->>'net_cop')::numeric - (allocation->>'gross_cop')::numeric + (allocation->>'commission_cop')::numeric);
    net_total := net_total + (allocation->>'net_cop')::numeric;

    update public.platform_receivables set status = case when allocated_gross + (allocation->>'gross_cop')::numeric >= gross_cop then 'liquidated' else 'pending' end where id = receivable_row.id;
  end loop;

  if round(net_total, 2) <> round(p_received_cop, 2) then raise exception 'La suma de los pedidos debe coincidir con el valor recibido.'; end if;
  return settlement_id;
end $$;

grant execute on function public.register_platform_settlement(text, timestamptz, numeric, text, text, jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
