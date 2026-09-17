alter table public.site_settings
  add column if not exists public_email text,
  add column if not exists legal_contact_email text;

update public.site_settings
set business_name = coalesce(nullif(business_name, ''), 'Modo Pizzas'),
    public_email = coalesce(nullif(public_email, ''), 'modopizzasmedellin@gmail.com'),
    legal_contact_email = coalesce(nullif(legal_contact_email, ''), 'modopizzasmedellin@gmail.com'),
    public_address = coalesce(nullif(public_address, ''), 'Cl. 49 #41-90'),
    public_neighborhood = coalesce(nullif(public_neighborhood, ''), 'La Candelaria'),
    public_city = coalesce(nullif(public_city, ''), 'Medellín, Antioquia'),
    public_phone = coalesce(nullif(public_phone, ''), '+57 317 0135775'),
    whatsapp_number = coalesce(nullif(whatsapp_number, ''), '573170135775')
where id = true;

create or replace function public.get_public_business_information()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_build_object(
    'business_name', business_name,
    'phone', coalesce(nullif(public_phone, ''), whatsapp_number),
    'whatsapp_number', whatsapp_number,
    'address', public_address,
    'neighborhood', public_neighborhood,
    'city', public_city,
    'weekday_hours', public_weekday_hours,
    'weekend_hours', public_weekend_hours,
    'opening_hours', public_opening_hours,
    'maps_url', public_maps_url,
    'info_text', public_info_text,
    'instagram_url', public_instagram_url,
    'facebook_url', public_facebook_url,
    'email', public_email,
    'legal_contact_email', legal_contact_email
  ), '{}'::jsonb)
  from public.site_settings
  where id = true;
$$;

grant execute on function public.get_public_business_information() to anon, authenticated;

notify pgrst, 'reload schema';
