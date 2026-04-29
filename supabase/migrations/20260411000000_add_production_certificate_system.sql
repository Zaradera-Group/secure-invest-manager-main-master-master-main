do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'certificate_status'
  ) then
    create type public.certificate_status as enum (
      'pending_manager',
      'pending_ceo',
      'approved',
      'sent'
    );
  end if;
end
$$;

create table if not exists public.certificates (
  id uuid primary key default gen_random_uuid(),
  investor_name text not null,
  investor_email text not null,
  amount numeric(15,2) not null check (amount >= 0),
  interest_rate numeric(8,4) not null check (interest_rate >= 0),
  status public.certificate_status not null default 'pending_manager',
  manager_signature text,
  ceo_signature text,
  certificate_url text,
  created_by uuid references auth.users(id) on delete set null,
  manager_reviewed_by uuid references auth.users(id) on delete set null,
  ceo_approved_by uuid references auth.users(id) on delete set null,
  sent_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  manager_notified_at timestamptz,
  ceo_notified_at timestamptz,
  approved_at timestamptz,
  sent_at timestamptz
);

create index if not exists idx_certificates_status on public.certificates(status);
create index if not exists idx_certificates_investor_email on public.certificates(lower(investor_email));
create index if not exists idx_certificates_created_by on public.certificates(created_by);

create or replace function public.update_certificates_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists update_certificates_updated_at on public.certificates;
create trigger update_certificates_updated_at
before update on public.certificates
for each row execute function public.update_certificates_updated_at();

alter table public.certificates enable row level security;

drop policy if exists "Investment managers can insert certificates" on public.certificates;
create policy "Investment managers can insert certificates"
on public.certificates
for insert
to authenticated
with check (
  exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role = 'investment_manager'::public.app_role
  )
);

drop policy if exists "Investment managers can view created certificates" on public.certificates;
create policy "Investment managers can view created certificates"
on public.certificates
for select
to authenticated
using (
  created_by = auth.uid()
  or exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role = 'investment_manager'::public.app_role
  )
);

drop policy if exists "General managers can view pending manager certificates" on public.certificates;
create policy "General managers can view pending manager certificates"
on public.certificates
for select
to authenticated
using (
  status = 'pending_manager'::public.certificate_status
  and exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role = 'general_manager'::public.app_role
  )
);

drop policy if exists "General managers can update pending manager certificates" on public.certificates;
create policy "General managers can update pending manager certificates"
on public.certificates
for update
to authenticated
using (
  status = 'pending_manager'::public.certificate_status
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

drop policy if exists "CEO can view pending CEO certificates" on public.certificates;
create policy "CEO can view pending CEO certificates"
on public.certificates
for select
to authenticated
using (
  status = 'pending_ceo'::public.certificate_status
  and exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role = 'super_admin'::public.app_role
  )
);

drop policy if exists "CEO can update pending CEO certificates" on public.certificates;
create policy "CEO can update pending CEO certificates"
on public.certificates
for update
to authenticated
using (
  status = 'pending_ceo'::public.certificate_status
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

drop policy if exists "Investors can view own certificates" on public.certificates;
create policy "Investors can view own certificates"
on public.certificates
for select
to authenticated
using (
  lower(investor_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
);

insert into storage.buckets (id, name, public)
select 'certificates', 'certificates', true
where not exists (
  select 1 from storage.buckets where id = 'certificates'
);

insert into storage.buckets (id, name, public)
select 'certificate-signatures', 'certificate-signatures', false
where not exists (
  select 1 from storage.buckets where id = 'certificate-signatures'
);

drop policy if exists "Service role manages certificates bucket" on storage.objects;
create policy "Service role manages certificates bucket"
on storage.objects
for all
to service_role
using (bucket_id = 'certificates')
with check (bucket_id = 'certificates');

drop policy if exists "Authenticated can read certificates bucket" on storage.objects;
create policy "Authenticated can read certificates bucket"
on storage.objects
for select
to authenticated
using (bucket_id = 'certificates');

drop policy if exists "Service role manages certificate signatures bucket" on storage.objects;
create policy "Service role manages certificate signatures bucket"
on storage.objects
for all
to service_role
using (bucket_id = 'certificate-signatures')
with check (bucket_id = 'certificate-signatures');

drop policy if exists "Authenticated can read certificate signatures bucket" on storage.objects;
create policy "Authenticated can read certificate signatures bucket"
on storage.objects
for select
to authenticated
using (bucket_id = 'certificate-signatures');

create or replace view public.manager_certificate_dashboard
with (security_invoker = on)
as
select *
from public.certificates
where status = 'pending_manager'::public.certificate_status
order by created_at desc;

create or replace view public.ceo_certificate_dashboard
with (security_invoker = on)
as
select *
from public.certificates
where status = 'pending_ceo'::public.certificate_status
order by created_at desc;

create or replace function public.get_investor_certificates()
returns setof public.certificates
language sql
stable
security invoker
as $$
  select *
  from public.certificates
  where lower(investor_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  order by created_at desc;
$$;

grant select on public.manager_certificate_dashboard to authenticated;
grant select on public.ceo_certificate_dashboard to authenticated;
grant execute on function public.get_investor_certificates() to authenticated;
