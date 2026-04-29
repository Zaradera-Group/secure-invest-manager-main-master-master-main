drop policy if exists "Admins have full access to investors" on public.investors;
drop policy if exists "Staff can read investors" on public.investors;
drop policy if exists "Staff can create investors" on public.investors;
drop policy if exists "Staff-equivalent roles can update investors" on public.investors;
drop policy if exists "Admin and staff can read audit logs" on public.audit_logs;
drop policy if exists "Admins can view all roles" on public.user_roles;
drop policy if exists "Admins can manage roles" on public.user_roles;
drop policy if exists "Users can view own profile" on public.profiles;

create policy "Executive roles have full access to investors"
  on public.investors
  for all
  using (
    public.has_role(auth.uid(), 'admin')
    or public.has_role(auth.uid(), 'super_admin')
  )
  with check (
    public.has_role(auth.uid(), 'admin')
    or public.has_role(auth.uid(), 'super_admin')
  );

create policy "Users can view own created investors"
  on public.investors
  for select
  using (created_by = auth.uid());

create policy "Users can create own investors"
  on public.investors
  for insert
  with check (auth.uid() is not null and created_by = auth.uid());

create policy "Users can update own investors"
  on public.investors
  for update
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

create policy "Users can delete own investors"
  on public.investors
  for delete
  using (created_by = auth.uid());

create policy "Executive roles can read all audit logs"
  on public.audit_logs
  for select
  using (
    public.has_role(auth.uid(), 'admin')
    or public.has_role(auth.uid(), 'super_admin')
  );

create policy "Executive roles can view all roles"
  on public.user_roles
  for select
  using (
    public.has_role(auth.uid(), 'admin')
    or public.has_role(auth.uid(), 'super_admin')
  );

create policy "Executive roles can manage roles"
  on public.user_roles
  for all
  using (
    public.has_role(auth.uid(), 'admin')
    or public.has_role(auth.uid(), 'super_admin')
  )
  with check (
    public.has_role(auth.uid(), 'admin')
    or public.has_role(auth.uid(), 'super_admin')
  );

create policy "Executive roles can view all profiles"
  on public.profiles
  for select
  using (
    auth.uid() = id
    or public.has_role(auth.uid(), 'admin')
    or public.has_role(auth.uid(), 'super_admin')
  );
