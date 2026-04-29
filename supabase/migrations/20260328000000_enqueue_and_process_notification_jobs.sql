CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.enqueue_payment_reminder_jobs()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count INTEGER := 0;
BEGIN
  WITH payment_candidates AS (
    SELECT
      i.id AS investor_id,
      i.created_by AS user_id,
      i.name AS investor_name,
      i.email,
      i.investment_type,
      i.investment_amount,
      i.start_date,
      i.maturity_date,
      CASE
        WHEN i.investment_type = 'Monthly' THEN
          i.start_date + (((GREATEST(0, ((CURRENT_DATE - i.start_date) / 30)) + 1) * 30) * INTERVAL '1 day')
        WHEN i.investment_type = 'Quarterly' THEN
          i.start_date + (((GREATEST(0, ((CURRENT_DATE - i.start_date) / 90)) + 1) * 90) * INTERVAL '1 day')
        WHEN i.investment_type = 'Upfront' THEN
          i.start_date::timestamp
        WHEN i.investment_type = 'At Maturity' THEN
          i.maturity_date::timestamp
        ELSE NULL
      END AS next_payment_date,
      CASE
        WHEN i.investment_type = 'Monthly' THEN ROUND((i.investment_amount / 12.0)::numeric, 2)
        WHEN i.investment_type = 'Quarterly' THEN ROUND((i.investment_amount / 4.0)::numeric, 2)
        ELSE i.investment_amount
      END AS payment_amount,
      CASE
        WHEN i.investment_type = 'Monthly' THEN 'Monthly Payment Due'
        WHEN i.investment_type = 'Quarterly' THEN 'Quarterly Payment Due'
        WHEN i.investment_type = 'Upfront' THEN 'Upfront Payment Confirmation'
        WHEN i.investment_type = 'At Maturity' THEN 'Maturity Payment Due'
        ELSE 'Payment Reminder'
      END AS reminder_type
    FROM public.investors i
    INNER JOIN public.notification_preferences np
      ON np.user_id = i.created_by
    WHERE i.created_by IS NOT NULL
      AND i.liquidation_status = 'Active'
      AND np.email_enabled = true
      AND np.payment_reminders = true
      AND (
        (i.investment_type = 'Monthly' AND
          (i.start_date + (((GREATEST(0, ((CURRENT_DATE - i.start_date) / 30)) + 1) * 30) * INTERVAL '1 day'))::date
            BETWEEN CURRENT_DATE AND CURRENT_DATE + 3)
        OR
        (i.investment_type = 'Quarterly' AND
          (i.start_date + (((GREATEST(0, ((CURRENT_DATE - i.start_date) / 90)) + 1) * 90) * INTERVAL '1 day'))::date
            BETWEEN CURRENT_DATE AND CURRENT_DATE + 7)
        OR
        (i.investment_type = 'Upfront' AND CURRENT_DATE = i.start_date + 7)
        OR
        (i.investment_type = 'At Maturity' AND i.maturity_date = CURRENT_DATE + 30)
      )
  ),
  filtered_candidates AS (
    SELECT
      pc.*,
      ('payment:' || pc.investor_id::text || ':' || pc.next_payment_date::date::text) AS dedupe_key
    FROM payment_candidates pc
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.email_notifications en
      WHERE en.investor_id = pc.investor_id
        AND en.notification_type = 'payment_reminder'
        AND en.sent_at >= NOW() - INTERVAL '24 hours'
    )
  ),
  inserted AS (
    INSERT INTO public.notification_jobs (
      notification_type,
      user_id,
      investor_id,
      payload,
      dedupe_key,
      status,
      scheduled_for
    )
    SELECT
      'payment_reminder',
      fc.user_id,
      fc.investor_id,
      jsonb_build_object(
        'investorName', fc.investor_name,
        'email', fc.email,
        'investmentType', fc.investment_type,
        'paymentAmount', fc.payment_amount,
        'reminderType', fc.reminder_type,
        'nextPaymentDate', fc.next_payment_date::date,
        'maturityDate', fc.maturity_date
      ),
      fc.dedupe_key,
      'pending',
      NOW()
    FROM filtered_candidates fc
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO inserted_count FROM inserted;

  RETURN inserted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_maturity_reminder_jobs()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count INTEGER := 0;
BEGIN
  WITH maturity_candidates AS (
    SELECT
      i.id AS investor_id,
      i.created_by AS user_id,
      i.name AS investor_name,
      i.email,
      i.investment_type,
      i.investment_amount,
      i.maturity_date,
      (i.maturity_date - CURRENT_DATE) AS days_until_maturity
    FROM public.investors i
    INNER JOIN public.notification_preferences np
      ON np.user_id = i.created_by
    WHERE i.created_by IS NOT NULL
      AND i.liquidation_status = 'Active'
      AND np.email_enabled = true
      AND np.maturity_reminders = true
      AND i.maturity_date >= CURRENT_DATE
      AND i.maturity_date <= CURRENT_DATE + 30
      AND (i.maturity_date - CURRENT_DATE) = ANY(np.reminder_days_before)
  ),
  filtered_candidates AS (
    SELECT
      mc.*,
      ('maturity:' || mc.investor_id::text || ':' || mc.days_until_maturity::text || ':' || mc.maturity_date::text) AS dedupe_key
    FROM maturity_candidates mc
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.email_notifications en
      WHERE en.investor_id = mc.investor_id
        AND en.notification_type = 'maturity_reminder'
        AND en.days_until_maturity = mc.days_until_maturity
        AND en.sent_at >= NOW() - INTERVAL '24 hours'
    )
  ),
  inserted AS (
    INSERT INTO public.notification_jobs (
      notification_type,
      user_id,
      investor_id,
      payload,
      dedupe_key,
      status,
      scheduled_for
    )
    SELECT
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
      NOW()
    FROM filtered_candidates fc
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO inserted_count FROM inserted;

  RETURN inserted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_payment_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.enqueue_payment_reminder_jobs();
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_maturity_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.enqueue_maturity_reminder_jobs();
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_notification_job_worker()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM
    net.http_post(
      url := (SELECT supabase_url FROM public.supabase_settings LIMIT 1) || '/functions/v1/process-notification-jobs',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT service_role_key FROM public.supabase_settings LIMIT 1)
      ),
      body := '{"batchSize":50}'::jsonb
    );
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'process-notification-jobs'
  ) THEN
    PERFORM cron.unschedule('process-notification-jobs');
  END IF;

  PERFORM cron.schedule(
    'process-notification-jobs',
    '*/5 * * * *',
    $job$SELECT public.trigger_notification_job_worker();$job$
  );
END;
$$;
