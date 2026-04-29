CREATE OR REPLACE FUNCTION public.claim_notification_jobs(batch_size INTEGER DEFAULT 50)
RETURNS SETOF public.notification_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH jobs_to_claim AS (
    SELECT nj.id
    FROM public.notification_jobs nj
    WHERE nj.status = 'pending'
      AND nj.scheduled_for <= NOW()
      AND (
        nj.locked_at IS NULL
        OR nj.locked_at <= NOW() - INTERVAL '15 minutes'
      )
    ORDER BY nj.scheduled_for ASC, nj.created_at ASC
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.notification_jobs nj
  SET
    status = 'processing',
    locked_at = NOW()
  FROM jobs_to_claim jc
  WHERE nj.id = jc.id
  RETURNING nj.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.requeue_stale_notification_jobs(stale_after_minutes INTEGER DEFAULT 15)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count INTEGER := 0;
BEGIN
  WITH stale_jobs AS (
    UPDATE public.notification_jobs
    SET
      status = CASE
        WHEN attempt_count + 1 >= max_attempts THEN 'failed'
        ELSE 'pending'
      END,
      attempt_count = attempt_count + 1,
      last_error = COALESCE(last_error, 'Job lock expired before completion'),
      locked_at = NULL,
      scheduled_for = CASE
        WHEN attempt_count + 1 >= max_attempts THEN NOW()
        ELSE NOW() + ((attempt_count + 1) * INTERVAL '5 minutes')
      END
    WHERE status = 'processing'
      AND locked_at <= NOW() - make_interval(mins => stale_after_minutes)
    RETURNING 1
  )
  SELECT COUNT(*) INTO updated_count FROM stale_jobs;

  RETURN updated_count;
END;
$$;
