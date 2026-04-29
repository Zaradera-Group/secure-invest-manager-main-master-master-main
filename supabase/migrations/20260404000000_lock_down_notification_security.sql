drop policy if exists "Service role can insert email notifications" on public.email_notifications;

create policy "Users can insert own email notifications"
  on public.email_notifications
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "System can insert audit logs" on public.audit_logs;

create policy "Authenticated users can insert own audit logs"
  on public.audit_logs
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "System can assign default roles" on public.user_roles;

create policy "System can assign default roles"
  on public.user_roles
  for insert
  to postgres, supabase_auth_admin, service_role
  with check (true);

alter table public.supabase_settings enable row level security;

drop policy if exists "No direct access to supabase settings" on public.supabase_settings;

create policy "No direct access to supabase settings"
  on public.supabase_settings
  for all
  using (false)
  with check (false);

alter table public.email_notifications_archive enable row level security;
alter table public.notification_jobs_archive enable row level security;
alter table public.job_runs_archive enable row level security;

drop policy if exists "Admins can view archived email notifications" on public.email_notifications_archive;
drop policy if exists "Admins can view archived notification jobs" on public.notification_jobs_archive;
drop policy if exists "Admins can view archived job runs" on public.job_runs_archive;

create policy "Admins can view archived email notifications"
  on public.email_notifications_archive
  for select
  using (public.has_role(auth.uid(), 'admin'));

create policy "Admins can view archived notification jobs"
  on public.notification_jobs_archive
  for select
  using (public.has_role(auth.uid(), 'admin'));

create policy "Admins can view archived job runs"
  on public.job_runs_archive
  for select
  using (public.has_role(auth.uid(), 'admin'));
