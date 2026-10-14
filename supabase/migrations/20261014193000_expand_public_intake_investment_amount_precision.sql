-- The public intake table may have been created before its current schema
-- definition. Align the live column with the intended amount precision.
alter table public.public_intake_requests
  alter column investment_amount type numeric(15,2)
  using investment_amount::numeric(15,2);
