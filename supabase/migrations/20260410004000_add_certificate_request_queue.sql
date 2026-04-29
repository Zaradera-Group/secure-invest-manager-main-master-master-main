create table if not exists public.certificate_workflow_requests (
  id uuid primary key default gen_random_uuid(),
  investor_id uuid not null references public.investors(id) on delete cascade,
  action text not null check (
    action in (
      'generate',
      'approve_investment_manager',
      'approve_general_manager',
      'approve_ceo',
      'send_to_investor'
    )
  ),
  issue_date date null,
  signature_data_url text null,
  notes text null,
  requested_by uuid not null,
  requested_role public.app_role not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  attempts integer not null default 0,
  last_error text null,
  result jsonb not null default '{}'::jsonb,
  locked_at timestamptz null,
  processed_at timestamptz null,
  created_at timestamptz not null default now()
);

alter table public.certificate_workflow_requests enable row level security;

drop policy if exists "Workflow users can queue certificate requests" on public.certificate_workflow_requests;
create policy "Workflow users can queue certificate requests"
  on public.certificate_workflow_requests
  for insert
  to authenticated
  with check (
    requested_by = auth.uid()
    and public.can_access_certificate_workflow(auth.uid())
  );

drop policy if exists "Workflow users can view own certificate requests" on public.certificate_workflow_requests;
create policy "Workflow users can view own certificate requests"
  on public.certificate_workflow_requests
  for select
  to authenticated
  using (
    requested_by = auth.uid()
    or public.has_role(auth.uid(), 'admin'::public.app_role)
    or public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

drop policy if exists "Service role can manage certificate requests" on public.certificate_workflow_requests;
create policy "Service role can manage certificate requests"
  on public.certificate_workflow_requests
  for all
  to authenticated
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create index if not exists idx_certificate_workflow_requests_status_created_at
  on public.certificate_workflow_requests(status, created_at asc);

create index if not exists idx_certificate_workflow_requests_investor_id
  on public.certificate_workflow_requests(investor_id, created_at desc);

create extension if not exists pg_net;
create extension if not exists pg_cron;

create or replace function public.trigger_certificate_request_worker()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform
    net.http_post(
      url := (select supabase_url from public.supabase_settings limit 1) || '/functions/v1/process-certificate-requests',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select service_role_key from public.supabase_settings limit 1)
      ),
      body := jsonb_build_object('batchSize', 10)
    );
end;
$$;

do $$
begin
  if exists (
    select 1
    from cron.job
    where jobname = 'process-certificate-workflow-requests'
  ) then
    perform cron.unschedule('process-certificate-workflow-requests');
  end if;

  perform cron.schedule(
    'process-certificate-workflow-requests',
    '* * * * *',
    $job$select public.trigger_certificate_request_worker();$job$
  );
end;
$$;
