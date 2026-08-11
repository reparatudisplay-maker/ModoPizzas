create or replace function app_private.has_role(required_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles
    join public.profiles on profiles.id = user_roles.user_id
    join public.app_roles on app_roles.role = user_roles.role
    where user_roles.user_id = (select auth.uid())
      and user_roles.role = required_role
      and coalesce(profiles.is_active, true)
      and app_roles.is_active
  );
$$;

create or replace function app_private.has_any_role(required_roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles
    join public.profiles on profiles.id = user_roles.user_id
    join public.app_roles on app_roles.role = user_roles.role
    where user_roles.user_id = (select auth.uid())
      and user_roles.role = any(required_roles)
      and coalesce(profiles.is_active, true)
      and app_roles.is_active
  );
$$;

revoke all on function app_private.has_role(public.app_role) from public;
revoke all on function app_private.has_any_role(public.app_role[]) from public;
grant execute on function app_private.has_role(public.app_role) to authenticated;
grant execute on function app_private.has_any_role(public.app_role[]) to authenticated;
