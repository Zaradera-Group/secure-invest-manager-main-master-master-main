create or replace function public.enforce_auth_user_limit()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if (select count(*) from auth.users) >= 3 then
    raise exception 'Maximum number of users reached. Only three users are allowed for this system.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_auth_user_limit on auth.users;

create trigger enforce_auth_user_limit
  before insert on auth.users
  for each row execute function public.enforce_auth_user_limit();
