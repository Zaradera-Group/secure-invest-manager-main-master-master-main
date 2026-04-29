alter table public.certificates
  add column if not exists investor_phone text;
