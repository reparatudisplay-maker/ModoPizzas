begin;

create table if not exists public.printer_settings (
  id boolean primary key default true check (id = true),
  ip_address inet not null default '192.168.28.21'::inet,
  port integer not null default 9100 check (port between 1 and 65535),
  model text not null default 'JP58W',
  paper_width_mm integer not null default 58 check (paper_width_mm = 58),
  printable_width_mm integer not null default 48 check (printable_width_mm between 40 and 58),
  preferred_print_method text not null default 'auto'
    check (preferred_print_method in ('auto', 'browser', 'ipad_shortcut')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.printer_settings (id)
values (true)
on conflict (id) do nothing;

create table if not exists public.thermal_print_jobs (
  created_by uuid primary key references auth.users(id) on delete cascade,
  token uuid not null default gen_random_uuid() unique,
  payload_base64 text not null check (length(payload_base64) between 1 and 65536),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  consumed_at timestamptz
);

create index if not exists thermal_print_jobs_expiration_idx
  on public.thermal_print_jobs (expires_at)
  where consumed_at is null;

alter table public.printer_settings enable row level security;
alter table public.thermal_print_jobs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'printer_settings'
      and policyname = 'Operational staff can read printer settings'
  ) then
    create policy "Operational staff can read printer settings"
      on public.printer_settings for select to authenticated
      using (
        public.current_user_has_permission('configuracion.view')
        or public.current_user_has_permission('configuracion.edit')
        or public.current_user_has_permission('pedidos.view')
        or public.current_user_has_permission('pedidos.create')
        or public.current_user_has_permission('cocina.view')
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'printer_settings'
      and policyname = 'Authorized staff can manage printer settings'
  ) then
    create policy "Authorized staff can manage printer settings"
      on public.printer_settings for all to authenticated
      using (public.current_user_has_permission('configuracion.edit'))
      with check (public.current_user_has_permission('configuracion.edit'));
  end if;
end $$;

create or replace function public.create_thermal_print_job(p_payload_base64 text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  job_token uuid;
  decoded_payload bytea;
begin
  if auth.uid() is null or not (
    public.current_user_has_permission('configuracion.edit')
    or public.current_user_has_permission('pedidos.view')
    or public.current_user_has_permission('pedidos.create')
    or public.current_user_has_permission('cocina.view')
  ) then
    raise exception 'No tienes permisos para imprimir documentos operativos.';
  end if;

  if length(coalesce(p_payload_base64, '')) = 0 or length(p_payload_base64) > 65536 then
    raise exception 'El documento de impresión no es válido.';
  end if;

  begin
    decoded_payload := decode(p_payload_base64, 'base64');
  exception when others then
    raise exception 'El documento de impresión no tiene un formato válido.';
  end;

  if octet_length(decoded_payload) = 0 or octet_length(decoded_payload) > 49152 then
    raise exception 'El documento de impresión no tiene un tamaño válido.';
  end if;

  insert into public.thermal_print_jobs (created_by, payload_base64, expires_at, consumed_at)
  values (auth.uid(), p_payload_base64, now() + interval '5 minutes', null)
  on conflict (created_by) do update
    set token = gen_random_uuid(),
        payload_base64 = excluded.payload_base64,
        created_at = now(),
        expires_at = excluded.expires_at,
        consumed_at = null
  returning token into job_token;

  return job_token;
end;
$$;

revoke all on table public.printer_settings from public;
revoke all on table public.thermal_print_jobs from public;
grant select, insert, update, delete on table public.printer_settings to authenticated;
grant execute on function public.create_thermal_print_job(text) to authenticated;

notify pgrst, 'reload schema';

commit;
