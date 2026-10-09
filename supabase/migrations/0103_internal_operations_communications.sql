begin;

create table if not exists public.internal_operations_communications (
  id uuid primary key default gen_random_uuid(),
  origin_module text not null check (origin_module in ('caja', 'cocina')),
  target_module text not null check (target_module in ('caja', 'cocina')),
  communication_kind text not null check (communication_kind in ('message', 'call')),
  body text not null check (char_length(btrim(body)) between 1 and 500),
  sender_user_id uuid not null references public.profiles(id) on delete restrict,
  sender_name_snapshot text not null,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.profiles(id) on delete set null,
  constraint internal_operations_communications_modules_check check (origin_module <> target_module)
);

create index if not exists internal_operations_communications_recent_idx
  on public.internal_operations_communications (created_at desc);

create index if not exists internal_operations_communications_target_unread_idx
  on public.internal_operations_communications (target_module, created_at desc)
  where acknowledged_at is null;

create or replace function app_private.can_use_internal_operations_module(p_module_key text)
returns boolean
language sql
stable
security definer
set search_path = public, app_private
as $$
  select case p_module_key
    when 'caja' then public.current_user_can_access_module('pedidos') or public.current_user_can_access_module('caja')
    when 'cocina' then public.current_user_can_access_module('cocina')
    else false
  end;
$$;

create or replace function public.send_internal_operations_communication(
  p_origin_module text,
  p_target_module text,
  p_communication_kind text,
  p_body text default null
)
returns public.internal_operations_communications
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  actor uuid := auth.uid();
  sender_name text;
  normalized_body text := nullif(btrim(coalesce(p_body, '')), '');
  created_communication public.internal_operations_communications;
begin
  if actor is null then
    raise exception 'Debes iniciar sesion para comunicarte internamente.';
  end if;

  if p_origin_module not in ('caja', 'cocina')
    or p_target_module not in ('caja', 'cocina')
    or p_origin_module = p_target_module then
    raise exception 'El destino de la comunicacion no es valido.';
  end if;

  if p_communication_kind not in ('message', 'call') then
    raise exception 'El tipo de comunicacion no es valido.';
  end if;

  if not app_private.can_use_internal_operations_module(p_origin_module) then
    raise exception 'No tienes acceso para comunicarte con este modulo.';
  end if;

  if p_communication_kind = 'call' then
    normalized_body := coalesce(normalized_body, initcap(p_origin_module) || ' esta llamando a ' || initcap(p_target_module));
    if exists (
      select 1
      from public.internal_operations_communications
      where sender_user_id = actor
        and origin_module = p_origin_module
        and target_module = p_target_module
        and communication_kind = 'call'
        and created_at > now() - interval '8 seconds'
    ) then
      raise exception 'Espera unos segundos antes de volver a llamar.';
    end if;
  end if;

  if normalized_body is null or char_length(normalized_body) > 500 then
    raise exception 'El mensaje debe tener entre 1 y 500 caracteres.';
  end if;

  select coalesce(nullif(btrim(full_name), ''), 'Usuario')
  into sender_name
  from public.profiles
  where id = actor;

  insert into public.internal_operations_communications (
    origin_module,
    target_module,
    communication_kind,
    body,
    sender_user_id,
    sender_name_snapshot
  )
  values (
    p_origin_module,
    p_target_module,
    p_communication_kind,
    normalized_body,
    actor,
    coalesce(sender_name, 'Usuario')
  )
  returning * into created_communication;

  return created_communication;
end;
$$;

create or replace function public.acknowledge_internal_operations_communications(p_communication_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  acknowledged_count integer;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesion para actualizar mensajes.';
  end if;

  update public.internal_operations_communications
  set acknowledged_at = now(),
      acknowledged_by = auth.uid()
  where id = any(coalesce(p_communication_ids, '{}'))
    and acknowledged_at is null
    and app_private.can_use_internal_operations_module(target_module);

  get diagnostics acknowledged_count = row_count;
  return acknowledged_count;
end;
$$;

alter table public.internal_operations_communications enable row level security;

drop policy if exists "Operations users can read internal communications" on public.internal_operations_communications;
create policy "Operations users can read internal communications"
  on public.internal_operations_communications
  for select to authenticated
  using (
    app_private.can_use_internal_operations_module(origin_module)
    or app_private.can_use_internal_operations_module(target_module)
  );

revoke all on public.internal_operations_communications from anon;
grant select on public.internal_operations_communications to authenticated;

revoke all on function app_private.can_use_internal_operations_module(text) from public;
revoke all on function public.send_internal_operations_communication(text, text, text, text) from public;
revoke all on function public.acknowledge_internal_operations_communications(uuid[]) from public;
grant execute on function app_private.can_use_internal_operations_module(text) to authenticated;
grant execute on function public.send_internal_operations_communication(text, text, text, text) to authenticated;
grant execute on function public.acknowledge_internal_operations_communications(uuid[]) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'internal_operations_communications'
  ) then
    alter publication supabase_realtime add table public.internal_operations_communications;
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
