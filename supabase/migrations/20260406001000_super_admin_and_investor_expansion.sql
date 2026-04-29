alter type public.app_role add value if not exists 'super_admin';

alter table public.investors
  add column if not exists currency_code text not null default 'NGN',
  add column if not exists nin text,
  add column if not exists bvn text,
  add column if not exists address text,
  add column if not exists next_of_kin_name text,
  add column if not exists next_of_kin_phone text,
  add column if not exists next_of_kin_relationship text,
  add column if not exists passport_photo_url text,
  add column if not exists nin_verification_status text not null default 'unverified',
  add column if not exists bvn_verification_status text not null default 'unverified',
  add column if not exists verification_provider text,
  add column if not exists last_verified_at timestamptz;

create index if not exists idx_investors_currency_code on public.investors(currency_code);
create index if not exists idx_investors_nin on public.investors(nin);
create index if not exists idx_investors_bvn on public.investors(bvn);

insert into storage.buckets (id, name, public)
values ('investor-passports', 'investor-passports', true)
on conflict (id) do nothing;

drop policy if exists "Authenticated users can upload investor passports" on storage.objects;
drop policy if exists "Authenticated users can view investor passports" on storage.objects;
drop policy if exists "Authenticated users can update investor passports" on storage.objects;

create policy "Authenticated users can upload investor passports"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'investor-passports');

create policy "Authenticated users can view investor passports"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'investor-passports');

create policy "Authenticated users can update investor passports"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'investor-passports')
  with check (bucket_id = 'investor-passports');
