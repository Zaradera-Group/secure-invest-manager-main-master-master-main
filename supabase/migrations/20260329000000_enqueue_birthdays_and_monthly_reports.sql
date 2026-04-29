CREATE OR REPLACE FUNCTION public.enqueue_birthday_notification_jobs()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count INTEGER := 0;
BEGIN
  WITH birthday_candidates AS (
    SELECT
      i.id AS investor_id,
      i.created_by AS user_id,
      i.name AS investor_name,
      i.email,
      i.date_of_birth,
      EXTRACT(YEAR FROM CURRENT_DATE) - EXTRACT(YEAR FROM i.date_of_birth) AS age
    FROM public.investors i
    INNER JOIN public.notification_preferences np
      ON np.user_id = i.created_by
    WHERE i.created_by IS NOT NULL
      AND i.liquidation_status = 'Active'
      AND i.date_of_birth IS NOT NULL
      AND np.email_enabled = true
      AND np.birthday_notifications = true
      AND to_char(i.date_of_birth, 'MM-DD') = to_char(CURRENT_DATE, 'MM-DD')
      AND i.email IS NOT NULL
      AND i.email <> ''
  ),
  filtered_candidates AS (
    SELECT
      bc.*,
      ('birthday:' || bc.investor_id::text || ':' || EXTRACT(YEAR FROM CURRENT_DATE)::text) AS dedupe_key
    FROM birthday_candidates bc
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.email_notifications en
      WHERE en.investor_id = bc.investor_id
        AND en.notification_type = 'birthday_greeting'
        AND en.sent_at >= date_trunc('year', CURRENT_DATE::timestamp)
        AND en.sent_at < date_trunc('year', CURRENT_DATE::timestamp) + INTERVAL '1 year'
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
      'birthday_greeting',
      fc.user_id,
      fc.investor_id,
      jsonb_build_object(
        'investorName', fc.investor_name,
        'email', fc.email,
        'age', fc.age
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

CREATE OR REPLACE FUNCTION public.enqueue_monthly_report_jobs()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count INTEGER := 0;
BEGIN
  WITH report_candidates AS (
    SELECT
      np.user_id,
      MIN(i.email) FILTER (WHERE i.email IS NOT NULL AND i.email <> '') AS recipient_email
    FROM public.notification_preferences np
    LEFT JOIN public.investors i
      ON i.created_by = np.user_id
    WHERE np.email_enabled = true
      AND np.monthly_reports = true
    GROUP BY np.user_id
  ),
  filtered_candidates AS (
    SELECT
      rc.*,
      ('monthly_report:' || rc.user_id::text || ':' || to_char(CURRENT_DATE, 'YYYY-MM')) AS dedupe_key
    FROM report_candidates rc
    WHERE rc.recipient_email IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.email_notifications en
        WHERE en.user_id = rc.user_id
          AND en.notification_type = 'monthly_report'
          AND en.sent_at >= date_trunc('month', CURRENT_DATE::timestamp)
          AND en.sent_at < date_trunc('month', CURRENT_DATE::timestamp) + INTERVAL '1 month'
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
      'monthly_report',
      fc.user_id,
      NULL,
      jsonb_build_object(
        'email', fc.recipient_email,
        'reportMonth', to_char(CURRENT_DATE, 'YYYY-MM')
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

CREATE OR REPLACE FUNCTION public.trigger_birthday_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.enqueue_birthday_notification_jobs();
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_monthly_reports()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.enqueue_monthly_report_jobs();
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'send-monthly-reports'
  ) THEN
    PERFORM cron.unschedule('send-monthly-reports');
  END IF;

  PERFORM cron.schedule(
    'send-monthly-reports',
    '0 9 1 * *',
    $job$SELECT public.trigger_monthly_reports();$job$
  );
END;
$$;
