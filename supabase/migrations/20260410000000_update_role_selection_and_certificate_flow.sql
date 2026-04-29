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
          'general_manager'::public.app_role,
          'super_admin'::public.app_role
        ))
        or role = _role
      )
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role text;
  assigned_role public.app_role;
begin
  requested_role := new.raw_user_meta_data->>'requested_role';
  assigned_role := public.map_signup_role(requested_role);

  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, assigned_role)
  on conflict (user_id, role) do nothing;

  return new;
end;
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
      and role::text in ('super_admin', 'admin', 'investment_manager', 'general_manager', 'software_engineer')
  );
$$;

drop policy if exists "Certificate workflow roles can view templates" on public.certificate_templates;
drop policy if exists "Admins and software engineers can manage templates" on public.certificate_templates;
drop policy if exists "Certificate workflow roles can view certificates" on public.investor_certificates;
drop policy if exists "Certificate workflow roles can insert certificates" on public.investor_certificates;
drop policy if exists "Certificate workflow roles can update certificates" on public.investor_certificates;
drop policy if exists "Creators and admins can delete certificates" on public.investor_certificates;
drop policy if exists "Certificate workflow roles can view approval events" on public.certificate_approval_events;

create policy "Certificate workflow roles can view templates"
  on public.certificate_templates
  for select
  using (public.can_access_certificate_workflow(auth.uid()));

create policy "Admins and software engineers can manage templates"
  on public.certificate_templates
  for all
  using (
    exists (
      select 1
      from public.user_roles
      where user_id = auth.uid()
        and role::text in ('super_admin', 'admin', 'software_engineer')
    )
  )
  with check (
    exists (
      select 1
      from public.user_roles
      where user_id = auth.uid()
        and role::text in ('super_admin', 'admin', 'software_engineer')
    )
  );

create policy "Certificate workflow roles can view certificates"
  on public.investor_certificates
  for select
  using (public.can_access_certificate_workflow(auth.uid()));

create policy "Certificate workflow roles can insert certificates"
  on public.investor_certificates
  for insert
  with check (public.can_access_certificate_workflow(auth.uid()));

create policy "Certificate workflow roles can update certificates"
  on public.investor_certificates
  for update
  using (public.can_access_certificate_workflow(auth.uid()))
  with check (public.can_access_certificate_workflow(auth.uid()));

create policy "Creators and admins can delete certificates"
  on public.investor_certificates
  for delete
  using (
    created_by = auth.uid()
    or exists (
      select 1
      from public.user_roles
      where user_id = auth.uid()
        and role::text in ('super_admin', 'admin')
    )
  );

create policy "Certificate workflow roles can view approval events"
  on public.certificate_approval_events
  for select
  using (public.can_access_certificate_workflow(auth.uid()));

drop policy if exists "Certificate workflow can read template files" on storage.objects;
drop policy if exists "Certificate workflow can upload template files" on storage.objects;
drop policy if exists "Certificate workflow can upload signatures" on storage.objects;
drop policy if exists "Certificate workflow can read signatures" on storage.objects;
drop policy if exists "Certificate workflow can manage generated certificates" on storage.objects;

create policy "Certificate workflow can read template files"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'certificate-templates'
    and public.can_access_certificate_workflow(auth.uid())
  );

create policy "Certificate workflow can upload template files"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'certificate-templates'
    and exists (
      select 1
      from public.user_roles
      where user_id = auth.uid()
        and role::text in ('super_admin', 'admin', 'software_engineer')
    )
  );

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
        and role::text in ('super_admin', 'general_manager', 'investment_manager')
    )
  );

create policy "Certificate workflow can read signatures"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'certificate-signatures'
    and public.can_access_certificate_workflow(auth.uid())
  );

create policy "Certificate workflow can manage generated certificates"
  on storage.objects
  for all
  to authenticated
  using (
    bucket_id = 'generated-certificates'
    and public.can_access_certificate_workflow(auth.uid())
  )
  with check (
    bucket_id = 'generated-certificates'
    and public.can_access_certificate_workflow(auth.uid())
  );
