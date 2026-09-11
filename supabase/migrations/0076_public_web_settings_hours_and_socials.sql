alter table public.site_settings
  add column if not exists public_opening_hours jsonb,
  add column if not exists public_instagram_url text,
  add column if not exists public_facebook_url text;

update public.site_settings
set public_address = coalesce(nullif(public_address, ''), 'Cl. 49 #41-90'),
    public_neighborhood = coalesce(nullif(public_neighborhood, ''), 'La Candelaria'),
    public_city = coalesce(nullif(public_city, ''), 'Medellín, Antioquia'),
    public_phone = coalesce(nullif(public_phone, ''), '+57 317 013 5775'),
    whatsapp_number = coalesce(nullif(whatsapp_number, ''), '573170135775'),
    public_maps_url = coalesce(nullif(public_maps_url, ''), 'https://maps.app.goo.gl/hbnKQpowDC5RZbsh8'),
    public_opening_hours = coalesce(public_opening_hours, jsonb_build_array(
      jsonb_build_object('day', 'Lunes', 'is_open', true, 'opens_at', '11:30', 'closes_at', '22:00'),
      jsonb_build_object('day', 'Martes', 'is_open', true, 'opens_at', '11:30', 'closes_at', '22:00'),
      jsonb_build_object('day', 'Miercoles', 'is_open', true, 'opens_at', '11:30', 'closes_at', '22:00'),
      jsonb_build_object('day', 'Jueves', 'is_open', true, 'opens_at', '11:30', 'closes_at', '22:00'),
      jsonb_build_object('day', 'Viernes', 'is_open', true, 'opens_at', '11:30', 'closes_at', '22:00'),
      jsonb_build_object('day', 'Sabado', 'is_open', true, 'opens_at', '11:30', 'closes_at', '22:00'),
      jsonb_build_object('day', 'Domingo', 'is_open', true, 'opens_at', '04:00', 'closes_at', '22:00')
    ))
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
    'facebook_url', public_facebook_url
  ), '{}'::jsonb)
  from public.site_settings
  where id = true;
$$;

grant execute on function public.get_public_business_information() to anon, authenticated;

notify pgrst, 'reload schema';
