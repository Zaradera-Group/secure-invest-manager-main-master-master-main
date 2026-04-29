create or replace function public.ensure_single_business_role_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role in (
    'super_admin'::public.app_role,
    'admin'::public.app_role,
    'general_manager'::public.app_role,
    'investment_manager'::public.app_role,
    'software_engineer'::public.app_role
  ) then
    if exists (
      select 1
      from public.user_roles
      where role = new.role
        and user_id <> new.user_id
    ) then
      raise exception 'A user is already assigned to the % role. Remove that account first before registering another one.', new.role;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_single_business_role_assignment on public.user_roles;

create trigger enforce_single_business_role_assignment
before insert or update on public.user_roles
for each row
execute function public.ensure_single_business_role_assignment();

create unique index if not exists idx_user_roles_single_super_admin
  on public.user_roles(role)
  where role = 'super_admin'::public.app_role;

create unique index if not exists idx_user_roles_single_admin
  on public.user_roles(role)
  where role = 'admin'::public.app_role;

create unique index if not exists idx_user_roles_single_general_manager
  on public.user_roles(role)
  where role = 'general_manager'::public.app_role;

create unique index if not exists idx_user_roles_single_investment_manager
  on public.user_roles(role)
  where role = 'investment_manager'::public.app_role;

create unique index if not exists idx_user_roles_single_software_engineer
  on public.user_roles(role)
  where role = 'software_engineer'::public.app_role;
