alter type public.app_role add value if not exists 'investment_manager';
alter type public.app_role add value if not exists 'general_manager';
alter type public.app_role add value if not exists 'software_engineer';

create table if not exists public.certificate_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  storage_bucket text not null default 'certificate-templates',
  storage_path text not null unique,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.investor_certificates (
  id uuid primary key default gen_random_uuid(),
  investor_id uuid not null references public.investors(id) on delete cascade,
  template_id uuid references public.certificate_templates(id),
  status text not null default 'draft',
  issue_date date not null default current_date,
  mode_of_payment text not null,
  calculated_interest_payment numeric(15,2) not null default 0,
  generated_storage_bucket text not null default 'generated-certificates',
  generated_storage_path text,
  investment_manager_signature_url text,
  investment_manager_signed_at timestamptz,
  general_manager_signature_url text,
  general_manager_signed_at timestamptz,
  ceo_approved_at timestamptz,
  ceo_approved_by uuid references auth.users(id),
  sent_at timestamptz,
  sent_by uuid references auth.users(id),
  last_generated_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint investor_certificates_status_check check (
    status in ('draft', 'pending_general_manager', 'pending_ceo', 'approved', 'sent', 'rejected')
  ),
  constraint investor_certificates_one_active unique (investor_id)
);

create table if not exists public.certificate_approval_events (
  id uuid primary key default gen_random_uuid(),
  certificate_id uuid not null references public.investor_certificates(id) on delete cascade,
  approver_id uuid not null references auth.users(id),
  approver_role public.app_role not null,
  action text not null,
  signature_url text,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.certificate_templates enable row level security;
alter table public.investor_certificates enable row level security;
alter table public.certificate_approval_events enable row level security;

create or replace function public.can_access_certificate_workflow(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id
      and role::text in ('admin', 'investment_manager', 'general_manager', 'software_engineer')
  );
$$;

create policy "Certificate workflow roles can view templates"
  on public.certificate_templates
  for select
  using (public.can_access_certificate_workflow(auth.uid()));

create policy "Admins and software engineers can manage templates"
  on public.certificate_templates
  for all
  using (
    exists (
      select 1 from public.user_roles
      where user_id = auth.uid()
        and role::text in ('admin', 'software_engineer')
    )
  )
  with check (
    exists (
      select 1 from public.user_roles
      where user_id = auth.uid()
        and role::text in ('admin', 'software_engineer')
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
    created_by = auth.uid() or
    exists (
      select 1 from public.user_roles
      where user_id = auth.uid()
        and role::text = 'admin'
    )
  );

create policy "Certificate workflow roles can view approval events"
  on public.certificate_approval_events
  for select
  using (public.can_access_certificate_workflow(auth.uid()));

create or replace function public.update_investor_certificates_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists update_investor_certificates_updated_at on public.investor_certificates;

create trigger update_investor_certificates_updated_at
before update on public.investor_certificates
for each row execute function public.update_investor_certificates_updated_at();

insert into storage.buckets (id, name, public)
values
  ('certificate-templates', 'certificate-templates', false),
  ('certificate-signatures', 'certificate-signatures', false),
  ('generated-certificates', 'generated-certificates', false)
on conflict (id) do nothing;

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
    and (
      exists (
        select 1 from public.user_roles
        where user_id = auth.uid()
          and role::text in ('admin', 'software_engineer')
      )
    )
  );

create policy "Certificate workflow can upload signatures"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'certificate-signatures'
    and (
      exists (
        select 1 from public.user_roles
        where user_id = auth.uid()
          and role::text in ('investment_manager', 'general_manager', 'admin')
      )
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

create index if not exists idx_investor_certificates_investor_id on public.investor_certificates(investor_id);
create index if not exists idx_investor_certificates_status on public.investor_certificates(status);
create index if not exists idx_certificate_approval_events_certificate_id on public.certificate_approval_events(certificate_id, created_at desc);
