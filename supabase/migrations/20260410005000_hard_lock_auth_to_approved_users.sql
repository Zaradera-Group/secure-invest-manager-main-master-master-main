create table if not exists public.allowed_auth_users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  role public.app_role not null,
  full_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint allowed_auth_users_email_lower_unique unique (email)
);

create or replace function public.set_allowed_auth_users_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.email = lower(trim(new.email));
  return new;
end;
$$;

drop trigger if exists set_allowed_auth_users_updated_at on public.allowed_auth_users;
create trigger set_allowed_auth_users_updated_at
before insert or update on public.allowed_auth_users
for each row execute function public.set_allowed_auth_users_updated_at();

alter table public.allowed_auth_users enable row level security;

drop policy if exists "Admins manage allowed auth users" on public.allowed_auth_users;
create policy "Admins manage allowed auth users"
on public.allowed_auth_users
for all
to authenticated
using (
  exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role in ('super_admin'::public.app_role, 'admin'::public.app_role)
  )
)
with check (
  exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role in ('super_admin'::public.app_role, 'admin'::public.app_role)
  )
);

create or replace function public.is_allowed_auth_email(target_email text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.allowed_auth_users aau
    where aau.email = lower(trim(target_email))
      and aau.is_active = true
  );
$$;

revoke all on function public.is_allowed_auth_email(text) from public;
grant execute on function public.is_allowed_auth_email(text) to anon, authenticated, service_role;

create or replace function public.get_allowed_auth_user(target_email text)
returns public.allowed_auth_users
language sql
security definer
set search_path = public
as $$
  select *
  from public.allowed_auth_users aau
  where aau.email = lower(trim(target_email))
    and aau.is_active = true
  limit 1;
$$;

revoke all on function public.get_allowed_auth_user(text) from public;
grant execute on function public.get_allowed_auth_user(text) to authenticated, service_role;

create or replace function public.enforce_auth_user_allowlist()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  allowed_count integer;
begin
  if new.email is null then
    raise exception 'Signup is disabled for this system.';
  end if;

  if not exists (
    select 1
    from public.allowed_auth_users aau
    where aau.email = lower(trim(new.email))
      and aau.is_active = true
  ) then
    raise exception 'This system is closed to public signup. Contact an administrator.';
  end if;

  select count(*)
  into allowed_count
  from auth.users au
  where lower(au.email) in (
    select aau.email
    from public.allowed_auth_users aau
    where aau.is_active = true
  );

  if allowed_count >= 4 then
    raise exception 'Maximum number of approved users reached for this system.';
  end if;

  new.email = lower(trim(new.email));
  return new;
end;
$$;

drop trigger if exists enforce_auth_user_allowlist on auth.users;
create trigger enforce_auth_user_allowlist
before insert on auth.users
for each row execute function public.enforce_auth_user_allowlist();
