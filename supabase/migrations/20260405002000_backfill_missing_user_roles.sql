insert into public.user_roles (user_id, role)
select p.id, 'staff'::public.app_role
from public.profiles p
left join public.user_roles ur
  on ur.user_id = p.id
where ur.user_id is null
on conflict (user_id, role) do nothing;
