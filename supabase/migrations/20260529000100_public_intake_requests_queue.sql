create table if not exists public.public_intake_requests (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'submitted',
  submitted_by_name text not null,
  email text not null,
  phone text not null,
  date_of_birth date,
  gender public.gender_type,
  address text,
  investment_amount numeric(15,2) not null,
  start_date date not null,
  maturity_date date not null,
  tenure integer not null,
  percentage numeric(5,2) not null,
  investment_type public.investment_type not null,
  client_account_number text not null,
  client_bank text not null,
  brought_by text default 'Self',
  currency_code text not null default 'NGN',
  occupation text,
  source_of_funds text,
  next_of_kin_name text,
  next_of_kin_phone text,
  next_of_kin_relationship text,
  investor_category text default 'nw',
  category_reference_name text,
  category_reference_email text,
  category_notes text,
  assigned_user_id uuid not null references auth.users(id) on delete restrict,
  assigned_email text,
  review_notes text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  submitted_ip inet,
  submitted_user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint public_intake_requests_status_check check (
    status in ('submitted', 'reviewed', 'archived', 'rejected')
  ),
  constraint public_intake_requests_percentage_check check (percentage >= 0),
  constraint public_intake_requests_tenure_check check (tenure > 0)
);

create index if not exists idx_public_intake_requests_status_created_at
  on public.public_intake_requests(status, created_at desc);

create index if not exists idx_public_intake_requests_assigned_user_id_created_at
  on public.public_intake_requests(assigned_user_id, created_at desc);

create index if not exists idx_public_intake_requests_email_created_at
  on public.public_intake_requests(lower(email), created_at desc);

alter table public.public_intake_requests enable row level security;

drop policy if exists "Workflow users can view public intake requests" on public.public_intake_requests;
create policy "Workflow users can view public intake requests"
  on public.public_intake_requests
  for select
  using (public.can_access_certificate_workflow(auth.uid()));

drop policy if exists "Workflow users can update public intake requests" on public.public_intake_requests;
create policy "Workflow users can update public intake requests"
  on public.public_intake_requests
  for update
  using (public.can_access_certificate_workflow(auth.uid()))
  with check (public.can_access_certificate_workflow(auth.uid()));

drop policy if exists "Workflow users can delete public intake requests" on public.public_intake_requests;
create policy "Workflow users can delete public intake requests"
  on public.public_intake_requests
  for delete
  using (public.can_access_certificate_workflow(auth.uid()));

drop policy if exists "Workflow users can insert public intake requests" on public.public_intake_requests;
create policy "Workflow users can insert public intake requests"
  on public.public_intake_requests
  for insert
  with check (false);

drop trigger if exists update_public_intake_requests_updated_at on public.public_intake_requests;
create trigger update_public_intake_requests_updated_at
  before update on public.public_intake_requests
  for each row execute function public.update_updated_at_column();

comment on table public.public_intake_requests is 'Queue for external investor intake submissions awaiting manual review and investor creation.';
