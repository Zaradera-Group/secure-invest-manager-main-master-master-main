alter table public.email_notifications
  add column if not exists provider_name text,
  add column if not exists provider_message_id text,
  add column if not exists provider_status text,
  add column if not exists provider_response jsonb,
  add column if not exists provider_error_code text,
  add column if not exists provider_error_message text;

create table if not exists public.email_notifications_archive
(
  like public.email_notifications including defaults including constraints including indexes
);

alter table public.email_notifications_archive
  add column if not exists archived_at timestamptz not null default now();

create table if not exists public.notification_jobs_archive
(
  like public.notification_jobs including defaults including constraints including indexes
);

alter table public.notification_jobs_archive
  add column if not exists archived_at timestamptz not null default now();

create table if not exists public.job_runs_archive
(
  like public.job_runs including defaults including constraints including indexes
);

alter table public.job_runs_archive
  add column if not exists archived_at timestamptz not null default now();

create or replace function public.archive_notification_history(
  completed_job_archive_days integer default 60,
  email_notification_archive_days integer default 365,
  job_run_archive_days integer default 180
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  archived_email_notifications integer := 0;
  archived_notification_jobs integer := 0;
  archived_job_runs integer := 0;
begin
  with moved_rows as (
    delete from public.email_notifications
    where sent_at < now() - make_interval(days => email_notification_archive_days)
    returning *
  )
  insert into public.email_notifications_archive
  select moved_rows.*, now() as archived_at from moved_rows
  on conflict do nothing;

  get diagnostics archived_email_notifications = row_count;

  with moved_rows as (
    delete from public.notification_jobs
    where status in ('completed', 'cancelled')
      and coalesce(processed_at, updated_at, created_at) < now() - make_interval(days => completed_job_archive_days)
    returning *
  )
  insert into public.notification_jobs_archive
  select moved_rows.*, now() as archived_at from moved_rows
  on conflict do nothing;

  get diagnostics archived_notification_jobs = row_count;

  with moved_rows as (
    delete from public.job_runs
    where coalesce(completed_at, started_at, created_at) < now() - make_interval(days => job_run_archive_days)
    returning *
  )
  insert into public.job_runs_archive
  select moved_rows.*, now() as archived_at from moved_rows
  on conflict do nothing;

  get diagnostics archived_job_runs = row_count;

  return jsonb_build_object(
    'archived_email_notifications', archived_email_notifications,
    'archived_notification_jobs', archived_notification_jobs,
    'archived_job_runs', archived_job_runs
  );
end;
$$;

grant execute on function public.archive_notification_history(integer, integer, integer) to service_role;

select cron.unschedule(jobid)
from cron.job
where jobname = 'archive-notification-history';

select
  cron.schedule(
    'archive-notification-history',
    '0 3 * * 0',
    $$
    select public.archive_notification_history();
    $$
  );

create or replace function public.get_maturity_alerts(
  limit_count integer default 20,
  offset_count integer default 0
)
returns table (
  id uuid,
  name text,
  investment_type investment_type,
  expected_maturity_amount numeric,
  client_bank text,
  maturity_date date,
  liquidation_status liquidation_status
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    investors.id,
    investors.name,
    investors.investment_type,
    investors.expected_maturity_amount,
    investors.client_bank,
    investors.maturity_date,
    investors.liquidation_status
  from public.investors
  where investors.created_by = auth.uid()
    and investors.liquidation_status = 'Active'
  order by investors.maturity_date asc
  limit greatest(limit_count, 1)
  offset greatest(offset_count, 0);
$$;

grant execute on function public.get_maturity_alerts(integer, integer) to authenticated;
