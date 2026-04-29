CREATE TABLE IF NOT EXISTS public.notification_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_type TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  investor_id UUID REFERENCES public.investors(id) ON DELETE CASCADE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT notification_jobs_status_check
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled'))
);

ALTER TABLE public.notification_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notification jobs" ON public.notification_jobs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage notification jobs" ON public.notification_jobs
  FOR ALL USING (true)
  WITH CHECK (true);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_jobs_dedupe_key
  ON public.notification_jobs(dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notification_jobs_status_scheduled_for
  ON public.notification_jobs(status, scheduled_for);

CREATE INDEX IF NOT EXISTS idx_notification_jobs_user_type
  ON public.notification_jobs(user_id, notification_type);

CREATE INDEX IF NOT EXISTS idx_notification_jobs_investor_type
  ON public.notification_jobs(investor_id, notification_type);

CREATE INDEX IF NOT EXISTS idx_notification_jobs_locked_at
  ON public.notification_jobs(locked_at)
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS idx_investors_created_by_status
  ON public.investors(created_by, liquidation_status);

CREATE INDEX IF NOT EXISTS idx_investors_date_of_birth
  ON public.investors(date_of_birth)
  WHERE date_of_birth IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_investors_start_date
  ON public.investors(start_date);

CREATE INDEX IF NOT EXISTS idx_email_notifications_investor_type_sent_at
  ON public.email_notifications(investor_id, notification_type, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_notifications_user_type_sent_at
  ON public.email_notifications(user_id, notification_type, sent_at DESC);

CREATE OR REPLACE FUNCTION public.update_notification_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS update_notification_jobs_updated_at ON public.notification_jobs;

CREATE TRIGGER update_notification_jobs_updated_at
  BEFORE UPDATE ON public.notification_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_notification_jobs_updated_at();

COMMENT ON TABLE public.notification_jobs IS 'Queued notification work for batched reminder processing and retries.';
COMMENT ON COLUMN public.notification_jobs.dedupe_key IS 'Unique idempotency key used to prevent duplicate notification jobs.';
