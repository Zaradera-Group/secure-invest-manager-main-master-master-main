alter table public.investors
  add column if not exists occupation text,
  add column if not exists source_of_funds text;

alter table public.certificates
  add column if not exists currency_code text not null default 'NGN';
