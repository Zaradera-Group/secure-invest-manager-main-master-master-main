alter table public.investors
  add column if not exists investor_category text not null default 'nw',
  add column if not exists category_reference_name text,
  add column if not exists category_reference_email text,
  add column if not exists category_notes text;

alter table public.investors
  drop constraint if exists investors_investor_category_check;

alter table public.investors
  add constraint investors_investor_category_check
  check (investor_category in ('nw', 'tu', 'rw'));

create index if not exists idx_investors_investor_category
  on public.investors(investor_category);
