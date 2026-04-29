create or replace function public.cleanup_notification_history(
  completed_job_retention_days integer default 30,
  email_notification_retention_days integer default 180,
  job_run_retention_days integer default 90,
  audit_log_retention_days integer default 365
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_completed_jobs integer := 0;
  deleted_email_notifications integer := 0;
  deleted_job_runs integer := 0;
  deleted_audit_logs integer := 0;
begin
  delete from public.notification_jobs
  where status in ('completed', 'cancelled')
    and coalesce(processed_at, updated_at, created_at) < now() - make_interval(days => completed_job_retention_days);

  get diagnostics deleted_completed_jobs = row_count;

  delete from public.email_notifications
  where sent_at < now() - make_interval(days => email_notification_retention_days);

  get diagnostics deleted_email_notifications = row_count;

  delete from public.job_runs
  where coalesce(completed_at, started_at, created_at) < now() - make_interval(days => job_run_retention_days);

  get diagnostics deleted_job_runs = row_count;

  if to_regclass('public.audit_logs') is not null then
    execute format(
      'delete from public.audit_logs where created_at < now() - make_interval(days => %s)',
      audit_log_retention_days
    );

    get diagnostics deleted_audit_logs = row_count;
  end if;

  return jsonb_build_object(
    'deleted_completed_jobs', deleted_completed_jobs,
    'deleted_email_notifications', deleted_email_notifications,
    'deleted_job_runs', deleted_job_runs,
    'deleted_audit_logs', deleted_audit_logs
  );
end;
$$;

grant execute on function public.cleanup_notification_history(integer, integer, integer, integer) to service_role;

select cron.unschedule(jobid)
from cron.job
where jobname = 'cleanup-notification-history';

select
  cron.schedule(
    'cleanup-notification-history',
    '30 2 * * *',
    $$
    select public.cleanup_notification_history();
    $$
  );

create or replace view public.dashboard_portfolio_summary
with (security_invoker = on)
as
select
  created_by as user_id,
  count(*) as total_investments,
  coalesce(sum(investment_amount), 0::numeric) as total_investment_value,
  count(*) filter (where liquidation_status = 'Active') as active_investments,
  count(*) filter (
    where liquidation_status = 'Active'
      and maturity_date::date between current_date and current_date + 30
  ) as maturing_soon,
  count(*) filter (where liquidation_status = 'Liquidated') as liquidated_investments
from public.investors
where created_by is not null
group by created_by;

create or replace view public.dashboard_investment_type_summary
with (security_invoker = on)
as
select
  created_by as user_id,
  investment_type,
  count(*) as investor_count,
  coalesce(sum(investment_amount), 0::numeric) as total_investment_value
from public.investors
where created_by is not null
group by created_by, investment_type;

create or replace function public.get_dashboard_upcoming_maturities(limit_count integer default 5)
returns table (
  id uuid,
  name text,
  investment_amount numeric,
  maturity_date date,
  liquidation_status liquidation_status,
  investment_type investment_type
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    investors.id,
    investors.name,
    investors.investment_amount,
    investors.maturity_date,
    investors.liquidation_status,
    investors.investment_type
  from public.investors
  where investors.created_by = auth.uid()
    and investors.liquidation_status = 'Active'
  order by investors.maturity_date asc
  limit greatest(limit_count, 1);
$$;

grant select on public.dashboard_portfolio_summary to authenticated;
grant select on public.dashboard_investment_type_summary to authenticated;
grant execute on function public.get_dashboard_upcoming_maturities(integer) to authenticated;
