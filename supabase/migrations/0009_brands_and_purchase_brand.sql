create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brands_name_unique unique (name)
);

alter table public.brands enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'brands'
      and policyname = 'Managers can manage brands'
  ) then
    create policy "Managers can manage brands"
      on public.brands for all
      to authenticated
      using (
        app_private.has_any_role(array[
          'gerente'::public.app_role,
          'admin_sistema'::public.app_role
        ])
      )
      with check (
        app_private.has_any_role(array[
          'gerente'::public.app_role,
          'admin_sistema'::public.app_role
        ])
      );
  end if;
end $$;

alter table public.purchases
  add column if not exists brand_id uuid references public.brands(id);

create index if not exists purchases_brand_id_idx on public.purchases (brand_id);
create index if not exists brands_is_active_name_idx on public.brands (is_active, name);

insert into public.brands (name, category, notes)
values
  ('Haz de Oros', 'Harinas', 'Harina de trigo para masas'),
  ('Robin Hood', 'Harinas', 'Harina de trigo para masas'),
  ('La Nieve', 'Harinas', 'Harina de trigo para masas'),
  ('Colanta', 'Quesos y lacteos', 'Quesos y lacteos para pizza'),
  ('Alpina', 'Quesos y lacteos', 'Quesos y lacteos'),
  ('Del Vecchio', 'Quesos y lacteos', 'Quesos para preparacion'),
  ('Zenu', 'Carnes frias', 'Peperoni, jamon y carnes frias'),
  ('Rica', 'Carnes frias', 'Carnes frias y embutidos'),
  ('Ranchera', 'Carnes frias', 'Embutidos y carnes frias'),
  ('Fruco', 'Salsas', 'Salsas y aderezos'),
  ('San Jorge', 'Salsas', 'Salsas y conservas'),
  ('Darnel', 'Empaques', 'Empaques para alimentos')
on conflict (name) do update
set
  category = excluded.category,
  notes = excluded.notes,
  is_active = true,
  updated_at = now();
