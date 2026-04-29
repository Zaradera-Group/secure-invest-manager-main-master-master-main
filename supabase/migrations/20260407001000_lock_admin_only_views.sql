drop policy if exists "Authenticated users can view announcements" on public.announcements;
drop policy if exists "Admin users can manage announcements" on public.announcements;

create policy "Admins can view announcements"
  on public.announcements
  for select
  using (public.has_role(auth.uid(), 'admin'));

create policy "Admins can manage announcements"
  on public.announcements
  for all
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Users can view job runs" on public.job_runs;
drop policy if exists "Service role can manage job runs" on public.job_runs;

create policy "Admins can view job runs"
  on public.job_runs
  for select
  using (public.has_role(auth.uid(), 'admin'));

create policy "Service role can manage job runs"
  on public.job_runs
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "Admin and staff can read audit logs" on public.audit_logs;

create policy "Admins can read audit logs"
  on public.audit_logs
  for select
  using (public.has_role(auth.uid(), 'admin'));
