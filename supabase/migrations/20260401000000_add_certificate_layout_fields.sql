alter table public.certificates
  add column if not exists issue_date date,
  add column if not exists investment_tenure text,
  add column if not exists principal_maturity_date date,
  add column if not exists interest_payment text;
