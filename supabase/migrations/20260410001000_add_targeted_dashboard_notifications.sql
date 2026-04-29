create table if not exists public.dashboard_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid references auth.users(id) on delete cascade,
  target_role public.app_role,
  title text not null,
  detail text not null,
  notification_type text not null default 'info',
  related_investor_id uuid references public.investors(id) on delete set null,
  action_path text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.dashboard_notifications enable row level security;

drop policy if exists "Users can view own dashboard notifications" on public.dashboard_notifications;
drop policy if exists "Users can update own dashboard notifications" on public.dashboard_notifications;
drop policy if exists "Certificate workflow can insert dashboard notifications" on public.dashboard_notifications;
drop policy if exists "Admins can manage dashboard notifications" on public.dashboard_notifications;

create policy "Users can view own dashboard notifications"
  on public.dashboard_notifications
  for select
  using (
    recipient_user_id = auth.uid()
    or (
      recipient_user_id is null
      and target_role is not null
      and exists (
        select 1
        from public.user_roles
        where user_id = auth.uid()
          and role = target_role
      )
    )
  );

create policy "Users can update own dashboard notifications"
  on public.dashboard_notifications
  for update
  using (
    recipient_user_id = auth.uid()
    or (
      recipient_user_id is null
      and target_role is not null
      and exists (
        select 1
        from public.user_roles
        where user_id = auth.uid()
          and role = target_role
      )
    )
  )
  with check (
    recipient_user_id = auth.uid()
    or (
      recipient_user_id is null
      and target_role is not null
      and exists (
        select 1
        from public.user_roles
        where user_id = auth.uid()
          and role = target_role
      )
    )
  );

create policy "Certificate workflow can insert dashboard notifications"
  on public.dashboard_notifications
  for insert
  with check (public.can_access_certificate_workflow(auth.uid()));

create policy "Admins can manage dashboard notifications"
  on public.dashboard_notifications
  for all
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

create index if not exists idx_dashboard_notifications_recipient
  on public.dashboard_notifications(recipient_user_id, is_read, created_at desc);

create index if not exists idx_dashboard_notifications_role
  on public.dashboard_notifications(target_role, is_read, created_at desc);
