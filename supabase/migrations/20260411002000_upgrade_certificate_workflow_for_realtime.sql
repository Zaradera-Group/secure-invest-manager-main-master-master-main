do $$
begin
  begin
    alter type public.certificate_status add value if not exists 'pending_general_manager';
  exception
    when duplicate_object then null;
  end;
end
$$;

alter table public.certificates
  add column if not exists general_manager_signature text,
  add column if not exists general_manager_reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists general_manager_notified_at timestamptz;

drop policy if exists "Investment managers can view created certificates" on public.certificates;
drop policy if exists "General managers can view pending manager certificates" on public.certificates;
drop policy if exists "General managers can update pending manager certificates" on public.certificates;
drop policy if exists "CEO can view pending CEO certificates" on public.certificates;
drop policy if exists "CEO can update pending CEO certificates" on public.certificates;
drop policy if exists "Investors can view own certificates" on public.certificates;

create policy "Investment managers can view pending manager certificates"
on public.certificates
for select
to authenticated
using (
  status::text = 'pending_manager'
  and exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role = 'investment_manager'::public.app_role
  )
);

create policy "Investment managers can update pending manager certificates"
on public.certificates
for update
to authenticated
using (
  status::text = 'pending_manager'
  and exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role = 'investment_manager'::public.app_role
  )
)
with check (
  exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role = 'investment_manager'::public.app_role
  )
);

create policy "General managers can view pending general manager certificates"
on public.certificates
for select
to authenticated
using (
  status::text = 'pending_general_manager'
  and exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role = 'general_manager'::public.app_role
  )
);

create policy "General managers can update pending general manager certificates"
on public.certificates
for update
to authenticated
using (
  status::text = 'pending_general_manager'
  and exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role = 'general_manager'::public.app_role
  )
)
with check (
  exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role = 'general_manager'::public.app_role
  )
);

create policy "CEO can view pending CEO certificates"
on public.certificates
for select
to authenticated
using (
  status::text = 'pending_ceo'
  and exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role = 'super_admin'::public.app_role
  )
);

create policy "CEO can update pending CEO certificates"
on public.certificates
for update
to authenticated
using (
  status::text = 'pending_ceo'
  and exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role = 'super_admin'::public.app_role
  )
)
with check (
  exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role = 'super_admin'::public.app_role
  )
);

create policy "Investors can view own certificates"
on public.certificates
for select
to authenticated
using (
  lower(investor_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_role text not null check (user_role in ('manager', 'general_manager', 'ceo', 'investor')),
  message text not null,
  certificate_id uuid not null references public.certificates(id) on delete cascade,
  read boolean not null default false,
  recipient_user_id uuid references auth.users(id) on delete cascade,
  recipient_email text,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user_role_created_at
  on public.notifications(user_role, read, created_at desc);

create index if not exists idx_notifications_recipient_user
  on public.notifications(recipient_user_id, read, created_at desc);

create index if not exists idx_notifications_recipient_email
  on public.notifications(lower(recipient_email), read, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "Recipients can view own realtime notifications" on public.notifications;
drop policy if exists "Recipients can update own realtime notifications" on public.notifications;
drop policy if exists "Service role manages realtime notifications" on public.notifications;

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
        and ur.role = 'investment_manager'::public.app_role
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

create policy "Recipients can update own realtime notifications"
on public.notifications
for update
to authenticated
using (
  recipient_user_id = auth.uid()
  or lower(coalesce(recipient_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
)
with check (
  recipient_user_id = auth.uid()
  or lower(coalesce(recipient_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
);

create policy "Service role manages realtime notifications"
on public.notifications
for all
to service_role
using (true)
with check (true);

create or replace view public.manager_certificate_dashboard
with (security_invoker = on)
as
select *
from public.certificates
where status::text = 'pending_manager'
order by created_at desc;

create or replace view public.general_manager_certificate_dashboard
with (security_invoker = on)
as
select *
from public.certificates
where status::text = 'pending_general_manager'
order by created_at desc;

create or replace view public.ceo_certificate_dashboard
with (security_invoker = on)
as
select *
from public.certificates
where status::text = 'pending_ceo'
order by created_at desc;

grant select on public.general_manager_certificate_dashboard to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'certificates'
  ) then
    alter publication supabase_realtime add table public.certificates;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;
