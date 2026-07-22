create or replace function public.map_signup_role(_requested_role text)
returns public.app_role
language plpgsql
stable
set search_path = public
as $$
begin
  case lower(coalesce(_requested_role, ''))
    when 'ceo' then
      return 'super_admin'::public.app_role;
    when 'general_manager' then
      return 'general_manager'::public.app_role;
    when 'investment_manager' then
      return 'investment_manager'::public.app_role;
    when 'accountant' then
      return 'accountant'::public.app_role;
    when 'it_manager' then
      return 'admin'::public.app_role;
    else
      return 'staff'::public.app_role;
  end case;
end;
$$;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = _user_id
      and (
        role = 'super_admin'::public.app_role
        or (_role = 'admin'::public.app_role and role in ('admin'::public.app_role, 'super_admin'::public.app_role))
        or (_role = 'staff'::public.app_role and role in (
          'staff'::public.app_role,
          'investment_manager'::public.app_role,
          'accountant'::public.app_role,
          'general_manager'::public.app_role,
          'super_admin'::public.app_role
        ))
        or role = _role
      )
  );
$$;

create or replace function public.can_access_certificate_workflow(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = _user_id
      and role::text in ('super_admin', 'admin', 'investment_manager', 'accountant', 'general_manager', 'software_engineer')
  );
$$;

drop policy if exists "Workflow roles can view certificates they created, need to act on, or already handled" on public.certificates;

create policy "Workflow roles can view certificates they created, need to act on, or already handled"
  on public.certificates
  for select
  to authenticated
  using (
    created_by = auth.uid()
    or (
      status::text in ('pending_manager', 'approved')
      and exists (
        select 1
        from public.user_roles ur
        where ur.user_id = auth.uid()
          and ur.role in ('investment_manager'::public.app_role, 'accountant'::public.app_role)
      )
    )
    or (
      exists (
        select 1
        from public.user_roles ur
        where ur.user_id = auth.uid()
          and ur.role = 'general_manager'::public.app_role
      )
      and (
        status::text = 'pending_general_manager'
        or general_manager_reviewed_by = auth.uid()
      )
    )
    or (
      exists (
        select 1
        from public.user_roles ur
        where ur.user_id = auth.uid()
          and ur.role = 'super_admin'::public.app_role
      )
      and (
        status::text = 'pending_ceo'
        or ceo_approved_by = auth.uid()
      )
    )
    or lower(investor_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

drop policy if exists "Workflow approvers can view certificate-linked investors" on public.investors;

create policy "Workflow approvers can view certificate-linked investors"
  on public.investors
  for select
  using (
    exists (
      select 1
      from public.certificates c
      where (
          c.investor_id = public.investors.id
          or (
            lower(c.investor_email) = lower(public.investors.email)
            and c.investor_name = public.investors.name
          )
        )
        and (
          (
            c.status::text in ('pending_manager', 'approved')
            and exists (
              select 1
              from public.user_roles ur
              where ur.user_id = auth.uid()
                and ur.role in ('investment_manager'::public.app_role, 'accountant'::public.app_role)
            )
          )
          or (
            exists (
              select 1
              from public.user_roles ur
              where ur.user_id = auth.uid()
                and ur.role = 'general_manager'::public.app_role
            )
            and (
              c.status::text = 'pending_general_manager'
              or c.general_manager_reviewed_by = auth.uid()
            )
          )
          or (
            exists (
              select 1
              from public.user_roles ur
              where ur.user_id = auth.uid()
                and ur.role = 'super_admin'::public.app_role
            )
            and (
              c.status::text = 'pending_ceo'
              or c.ceo_approved_by = auth.uid()
            )
          )
          or (
            c.status::text = 'approved'
            and c.created_by = auth.uid()
          )
          or (
            c.status::text = 'sent'
            and c.created_by = auth.uid()
          )
        )
    )
  );

drop policy if exists "Recipients can view own realtime notifications" on public.notifications;

create policy "Recipients can view own realtime notifications"
on public.notifications
for select
to authenticated
using (
  recipient_user_id = auth.uid()
  or lower(coalesce(recipient_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
  or (
    user_role = 'manager'
    and exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid()
        and ur.role in ('investment_manager'::public.app_role, 'accountant'::public.app_role)
    )
  )
  or (
    user_role = 'general_manager'
    and exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid()
        and ur.role = 'general_manager'::public.app_role
    )
  )
  or (
    user_role = 'ceo'
    and exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid()
        and ur.role = 'super_admin'::public.app_role
    )
  )
  or (
    user_role = 'investor'
    and lower(coalesce(recipient_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
);

update public.notifications n
set action_path = '/investors/' || i.id::text
from public.certificates c
join public.investors i
  on (
    i.id = c.investor_id
    or (
      lower(i.email) = lower(c.investor_email)
      and i.name = c.investor_name
    )
  )
where n.certificate_id = c.id
  and n.user_role in ('manager', 'general_manager', 'ceo')
  and (n.action_path is null or n.action_path = '/investors');

drop policy if exists "Certificate workflow can upload signatures" on storage.objects;

create policy "Certificate workflow can upload signatures"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'certificate-signatures'
    and exists (
      select 1
      from public.user_roles
      where user_id = auth.uid()
        and role::text in ('super_admin', 'general_manager', 'investment_manager', 'accountant')
    )
  );
