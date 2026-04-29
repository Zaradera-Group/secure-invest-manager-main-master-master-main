create extension if not exists citext with schema public;

update public.allowed_auth_users
set
  email = lower(trim(email)),
  updated_at = now()
where email is distinct from lower(trim(email));

alter table public.allowed_auth_users
  drop constraint if exists allowed_auth_users_email_lower_unique;

alter table public.allowed_auth_users
  alter column email type public.citext
  using lower(trim(email))::public.citext;

alter table public.allowed_auth_users
  add constraint allowed_auth_users_email_unique unique (email);

create or replace function public.set_allowed_auth_users_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.email = lower(trim(new.email))::public.citext;
  return new;
end;
$$;

create or replace function public.is_allowed_auth_email(target_email text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.allowed_auth_users aau
    where aau.email = lower(trim(target_email))::public.citext
      and aau.is_active = true
  );
$$;

create or replace function public.get_allowed_auth_user(target_email text)
returns public.allowed_auth_users
language sql
security definer
set search_path = public
as $$
  select *
  from public.allowed_auth_users aau
  where aau.email = lower(trim(target_email))::public.citext
    and aau.is_active = true
  limit 1;
$$;

create or replace function public.upsert_allowed_auth_user(
  target_email text,
  target_role public.app_role,
  target_full_name text default null,
  target_is_active boolean default true
)
returns public.allowed_auth_users
language plpgsql
security definer
set search_path = public
as $$
declare
  upserted_row public.allowed_auth_users;
begin
  insert into public.allowed_auth_users (email, role, full_name, is_active)
  values (
    lower(trim(target_email))::public.citext,
    target_role,
    nullif(trim(target_full_name), ''),
    coalesce(target_is_active, true)
  )
  on conflict on constraint allowed_auth_users_email_unique
  do update
    set
      role = excluded.role,
      full_name = excluded.full_name,
      is_active = excluded.is_active,
      updated_at = now()
  returning * into upserted_row;

  return upserted_row;
end;
$$;

revoke all on function public.upsert_allowed_auth_user(text, public.app_role, text, boolean) from public;
grant execute on function public.upsert_allowed_auth_user(text, public.app_role, text, boolean) to authenticated, service_role;

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
    where aau.email = lower(trim(new.email))::public.citext
      and aau.is_active = true
  ) then
    raise exception 'This system is closed to public signup. Contact an administrator.';
  end if;

  select count(*)
  into allowed_count
  from auth.users au
  where lower(trim(au.email))::public.citext in (
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
