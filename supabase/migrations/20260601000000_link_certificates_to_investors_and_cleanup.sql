alter table public.certificates
  add column if not exists investor_id uuid references public.investors(id) on delete cascade;

create index if not exists idx_certificates_investor_id on public.certificates(investor_id);

update public.certificates c
set investor_id = i.id
from public.investors i
where c.investor_id is null
  and lower(c.investor_email) = lower(i.email)
  and c.investor_name = i.name;
