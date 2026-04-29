ALTER TABLE public.email_notifications
ADD COLUMN IF NOT EXISTS delivery_channel TEXT NOT NULL DEFAULT 'email',
ADD COLUMN IF NOT EXISTS recipient TEXT;

UPDATE public.email_notifications
SET recipient = COALESCE(recipient, 'Unknown recipient')
WHERE recipient IS NULL;

ALTER TABLE public.email_notifications
ALTER COLUMN recipient SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_notifications_delivery_channel
  ON public.email_notifications(delivery_channel);

COMMENT ON COLUMN public.email_notifications.delivery_channel IS 'Delivery channel used for the notification, such as email or sms.';
COMMENT ON COLUMN public.email_notifications.recipient IS 'Resolved recipient address used to deliver the notification.';

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.trigger_birthday_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM
    net.http_post(
      url := (SELECT supabase_url FROM public.supabase_settings LIMIT 1) || '/functions/v1/send-birthday-notifications',
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
    WHERE jobname = 'send-daily-birthday-notifications'
  ) THEN
    PERFORM cron.unschedule('send-daily-birthday-notifications');
  END IF;

  PERFORM cron.schedule(
    'send-daily-birthday-notifications',
    '0 9 * * *',
    $job$SELECT public.trigger_birthday_notifications();$job$
  );
END;
$$;
