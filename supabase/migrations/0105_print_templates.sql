begin;

create table if not exists public.print_templates (
  kind text primary key check (kind in ('kitchen', 'receipt')),
  elements jsonb not null default '[]'::jsonb,
  margin_mm smallint not null default 0 check (margin_mm between 0 and 4),
  line_spacing smallint not null default 1 check (line_spacing between 1 and 3),
  leading_blank_lines smallint not null default 0 check (leading_blank_lines between 0 and 20),
  trailing_blank_lines smallint not null default 3 check (trailing_blank_lines between 0 and 20),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.print_templates (kind)
values ('kitchen'), ('receipt')
on conflict (kind) do nothing;

alter table public.print_templates enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'print_templates'
      and policyname = 'Operational staff can read print templates'
  ) then
    create policy "Operational staff can read print templates"
      on public.print_templates for select to authenticated
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
    where schemaname = 'public' and tablename = 'print_templates'
      and policyname = 'Authorized staff can manage print templates'
  ) then
    create policy "Authorized staff can manage print templates"
      on public.print_templates for all to authenticated
      using (public.current_user_has_permission('configuracion.edit'))
      with check (public.current_user_has_permission('configuracion.edit'));
  end if;
end $$;

revoke all on table public.print_templates from public;
grant select, insert, update, delete on table public.print_templates to authenticated;

notify pgrst, 'reload schema';

commit;
