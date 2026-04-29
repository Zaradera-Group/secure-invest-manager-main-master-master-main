CREATE TABLE IF NOT EXISTS public.job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  batch_size INTEGER NOT NULL DEFAULT 0,
  jobs_claimed INTEGER NOT NULL DEFAULT 0,
  jobs_completed INTEGER NOT NULL DEFAULT 0,
  jobs_failed INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT job_runs_status_check
    CHECK (status IN ('running', 'completed', 'failed', 'partial'))
);

ALTER TABLE public.job_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view job runs" ON public.job_runs;
CREATE POLICY "Users can view job runs" ON public.job_runs
  FOR SELECT USING (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff')
  );

DROP POLICY IF EXISTS "Service role can manage job runs" ON public.job_runs;
CREATE POLICY "Service role can manage job runs" ON public.job_runs
  FOR ALL USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_job_runs_worker_started_at
  ON public.job_runs(worker_name, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_job_runs_status_started_at
  ON public.job_runs(status, started_at DESC);

COMMENT ON TABLE public.job_runs IS 'Execution history for background workers and queue processors.';
