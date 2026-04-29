create table if not exists public.certificate_notifications (
  id uuid primary key default gen_random_uuid(),
  certificate_id uuid not null references public.certificates(id) on delete cascade,
  recipient_user_id uuid references auth.users(id) on delete cascade,
  recipient_email text,
  target_role public.app_role,
  channel text not null default 'dashboard',
  subject text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  is_read boolean not null default false,
  read_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  constraint certificate_notifications_recipient_check
    check (recipient_user_id is not null or recipient_email is not null or target_role is not null),
  constraint certificate_notifications_channel_check
    check (channel in ('dashboard', 'email'))
);

create index if not exists idx_certificate_notifications_certificate
  on public.certificate_notifications(certificate_id, created_at desc);

create index if not exists idx_certificate_notifications_recipient_user
  on public.certificate_notifications(recipient_user_id, is_read, created_at desc);

create index if not exists idx_certificate_notifications_recipient_email
  on public.certificate_notifications(lower(recipient_email), is_read, created_at desc);

create index if not exists idx_certificate_notifications_target_role
  on public.certificate_notifications(target_role, is_read, created_at desc);

alter table public.certificate_notifications enable row level security;

drop policy if exists "Recipients can view own certificate notifications" on public.certificate_notifications;
create policy "Recipients can view own certificate notifications"
on public.certificate_notifications
for select
to authenticated
using (
  recipient_user_id = auth.uid()
  or lower(coalesce(recipient_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
  or (
    target_role is not null
    and exists (
      select 1
      from public.user_roles ur
      where ur.user_id = auth.uid()
        and ur.role = target_role
    )
  )
);

drop policy if exists "Recipients can update own certificate notifications" on public.certificate_notifications;
create policy "Recipients can update own certificate notifications"
on public.certificate_notifications
for update
to authenticated
using (
  recipient_user_id = auth.uid()
  or lower(coalesce(recipient_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
  or (
    target_role is not null
    and exists (
      select 1
      from public.user_roles ur
      where ur.user_id = auth.uid()
        and ur.role = target_role
    )
  )
)
with check (
  recipient_user_id = auth.uid()
  or lower(coalesce(recipient_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
  or (
    target_role is not null
    and exists (
      select 1
      from public.user_roles ur
      where ur.user_id = auth.uid()
        and ur.role = target_role
    )
  )
);

drop policy if exists "Service role manages certificate notifications" on public.certificate_notifications;
create policy "Service role manages certificate notifications"
on public.certificate_notifications
for all
to service_role
using (true)
with check (true);
