create policy "Users can manage own profile images"
  on storage.objects for all
  to authenticated
  using (
    bucket_id = 'profile-images'
    and (storage.foldername(name))[1] = 'profiles'
    and (storage.foldername(name))[2] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'profile-images'
    and (storage.foldername(name))[1] = 'profiles'
    and (storage.foldername(name))[2] = (select auth.uid()::text)
  );

create or replace function public.get_pos_order_audit_profiles(p_profile_ids uuid[])
returns table (id uuid, full_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.current_user_can_access_module('pedidos') then
    raise exception 'No tienes acceso a los pedidos.';
  end if;

  return query
    select profile.id, coalesce(nullif(profile.full_name, ''), 'Sin registro')
    from public.profiles profile
    where profile.id = any(p_profile_ids);
end;
$$;

revoke all on function public.get_pos_order_audit_profiles(uuid[]) from public;
grant execute on function public.get_pos_order_audit_profiles(uuid[]) to authenticated;
