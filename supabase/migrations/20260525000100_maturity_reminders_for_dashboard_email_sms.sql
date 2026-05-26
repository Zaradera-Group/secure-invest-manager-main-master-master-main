alter table public.notifications
  alter column certificate_id drop not null;

create or replace function public.enqueue_maturity_reminder_jobs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer := 0;
begin
  with maturity_candidates as (
    select
      i.id as investor_id,
      i.created_by as user_id,
      i.name as investor_name,
      i.email,
      i.investment_type,
      i.investment_amount,
      i.maturity_date,
      (i.maturity_date - current_date) as days_until_maturity
    from public.investors i
    where i.created_by is not null
      and i.liquidation_status = 'Active'
      and i.maturity_date >= current_date
      and i.maturity_date <= current_date + 5
      and (i.maturity_date - current_date) in (5, 0)
  ),
  filtered_candidates as (
    select
      mc.*,
      ('maturity:' || mc.investor_id::text || ':' || mc.days_until_maturity::text || ':' || mc.maturity_date::text) as dedupe_key
    from maturity_candidates mc
    where not exists (
      select 1
      from public.email_notifications en
      where en.investor_id = mc.investor_id
        and en.notification_type = 'maturity_reminder'
        and en.days_until_maturity = mc.days_until_maturity
        and en.sent_at >= now() - interval '24 hours'
    )
  ),
  inserted as (
    insert into public.notification_jobs (
      notification_type,
      user_id,
      investor_id,
      payload,
      dedupe_key,
      status,
      scheduled_for
    )
    select
      'maturity_reminder',
      fc.user_id,
      fc.investor_id,
      jsonb_build_object(
        'investorName', fc.investor_name,
        'email', fc.email,
        'investmentType', fc.investment_type,
        'investmentAmount', fc.investment_amount,
        'maturityDate', fc.maturity_date,
        'daysUntilMaturity', fc.days_until_maturity
      ),
      fc.dedupe_key,
      'pending',
      now()
    from filtered_candidates fc
    on conflict (dedupe_key) do nothing
    returning 1
  )
  select count(*) into inserted_count from inserted;

  return inserted_count;
end;
$$;
