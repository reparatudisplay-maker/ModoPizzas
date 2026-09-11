update public.site_settings
set public_city = 'Medellín, Antioquia'
where id = true
  and public_city = 'Medellin, Antioquia';

notify pgrst, 'reload schema';
