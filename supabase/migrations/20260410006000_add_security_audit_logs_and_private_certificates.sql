create table if not exists public.security_audit_logs (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  actor_user_id uuid,
  actor_email text,
  actor_role text,
  certificate_id uuid references public.certificates(id) on delete set null,
  target_email text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_security_audit_logs_created_at
  on public.security_audit_logs(created_at desc);

create index if not exists idx_security_audit_logs_certificate_id
  on public.security_audit_logs(certificate_id);

alter table public.security_audit_logs enable row level security;

drop policy if exists "Admins can view security audit logs" on public.security_audit_logs;
create policy "Admins can view security audit logs"
on public.security_audit_logs
for select
to authenticated
using (
  exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role in ('super_admin'::public.app_role, 'admin'::public.app_role)
  )
);

drop policy if exists "Service role can manage security audit logs" on public.security_audit_logs;
create policy "Service role can manage security audit logs"
on public.security_audit_logs
for all
to service_role
using (true)
with check (true);

update storage.buckets
set public = false
where id = 'certificates';
