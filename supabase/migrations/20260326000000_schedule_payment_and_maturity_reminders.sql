CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.trigger_payment_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM
    net.http_post(
      url := (SELECT supabase_url FROM public.supabase_settings LIMIT 1) || '/functions/v1/send-payment-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT service_role_key FROM public.supabase_settings LIMIT 1)
      ),
      body := '{}'::jsonb
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_maturity_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM
    net.http_post(
      url := (SELECT supabase_url FROM public.supabase_settings LIMIT 1) || '/functions/v1/send-maturity-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT service_role_key FROM public.supabase_settings LIMIT 1)
      ),
      body := '{}'::jsonb
    );
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'send-daily-payment-reminders'
  ) THEN
    PERFORM cron.unschedule('send-daily-payment-reminders');
  END IF;

  PERFORM cron.schedule(
    'send-daily-payment-reminders',
    '0 8 * * *',
    $job$SELECT public.trigger_payment_reminders();$job$
  );

  IF EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'send-daily-maturity-reminders'
  ) THEN
    PERFORM cron.unschedule('send-daily-maturity-reminders');
  END IF;

  PERFORM cron.schedule(
    'send-daily-maturity-reminders',
    '15 8 * * *',
    $job$SELECT public.trigger_maturity_reminders();$job$
  );
END;
$$;
