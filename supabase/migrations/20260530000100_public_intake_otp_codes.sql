create table if not exists public.public_intake_otp_codes (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  email text,
  code_hash text not null,
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_public_intake_otp_codes_phone_created_at
  on public.public_intake_otp_codes(phone, created_at desc);

create index if not exists idx_public_intake_otp_codes_expires_at
  on public.public_intake_otp_codes(expires_at);

alter table public.public_intake_otp_codes enable row level security;

drop policy if exists "Service role manages public intake otp codes" on public.public_intake_otp_codes;
create policy "Service role manages public intake otp codes"
  on public.public_intake_otp_codes
  for all
  using (true)
  with check (true);

drop trigger if exists update_public_intake_otp_codes_updated_at on public.public_intake_otp_codes;
create trigger update_public_intake_otp_codes_updated_at
  before update on public.public_intake_otp_codes
  for each row execute function public.update_updated_at_column();

comment on table public.public_intake_otp_codes is 'Short-lived OTP codes used to confirm public intake consent.';
