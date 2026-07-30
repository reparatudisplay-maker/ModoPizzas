alter table public.conservation_profile_rules add column if not exists temperature_min numeric(6, 2);
alter table public.conservation_profile_rules add column if not exists temperature_max numeric(6, 2);

update public.conservation_profile_rules rule
set
  temperature_min = coalesce(rule.temperature_min, profile.temperature_min),
  temperature_max = coalesce(rule.temperature_max, profile.temperature_max)
from public.conservation_profiles profile
where profile.id = rule.profile_id;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'conservation_profile_rules_temperature_range_check') then
    alter table public.conservation_profile_rules add constraint conservation_profile_rules_temperature_range_check
      check (temperature_min is null or temperature_max is null or temperature_min <= temperature_max);
  end if;
end $$;

notify pgrst, 'reload schema';
