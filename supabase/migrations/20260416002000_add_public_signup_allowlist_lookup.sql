create or replace function public.get_signup_allowed_auth_user(target_email text)
returns table (
  email text,
  role text,
  full_name text,
  is_active boolean
)
language sql
security definer
set search_path = public
as $$
  select
    aau.email::text,
    aau.role::text,
    aau.full_name,
    aau.is_active
  from public.allowed_auth_users aau
  where aau.email = lower(trim(target_email))::public.citext
    and aau.is_active = true
  limit 1;
$$;

revoke all on function public.get_signup_allowed_auth_user(text) from public;
grant execute on function public.get_signup_allowed_auth_user(text) to anon, authenticated, service_role;
