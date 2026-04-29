ALTER TABLE public.supabase_settings
ADD COLUMN IF NOT EXISTS id INTEGER,
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE public.supabase_settings
SET id = 1
WHERE id IS NULL;

DELETE FROM public.supabase_settings
WHERE ctid NOT IN (
  SELECT ctid
  FROM public.supabase_settings
  ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
  LIMIT 1
);

ALTER TABLE public.supabase_settings
ALTER COLUMN id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'supabase_settings_pkey'
      AND conrelid = 'public.supabase_settings'::regclass
  ) THEN
    ALTER TABLE public.supabase_settings
    ADD CONSTRAINT supabase_settings_pkey PRIMARY KEY (id);
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'supabase_settings_single_row'
      AND conrelid = 'public.supabase_settings'::regclass
  ) THEN
    ALTER TABLE public.supabase_settings
    ADD CONSTRAINT supabase_settings_single_row CHECK (id = 1);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_supabase_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS update_supabase_settings_updated_at ON public.supabase_settings;

CREATE TRIGGER update_supabase_settings_updated_at
  BEFORE UPDATE ON public.supabase_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_supabase_settings_updated_at();

COMMENT ON TABLE public.supabase_settings IS 'Single-row operational configuration for database-triggered Supabase function calls.';
