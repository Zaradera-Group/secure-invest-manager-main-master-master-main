create sequence if not exists public.investor_reference_seq start 100000;

alter table public.investors
  add column if not exists reference_number bigint;

alter table public.investors
  alter column reference_number set default nextval('public.investor_reference_seq');

update public.investors
set reference_number = nextval('public.investor_reference_seq')
where reference_number is null;

select setval(
  'public.investor_reference_seq',
  greatest(
    coalesce((select max(reference_number) from public.investors), 99999),
    99999
  ),
  true
);

alter table public.investors
  alter column reference_number set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'investors_reference_number_key'
      and conrelid = 'public.investors'::regclass
  ) then
    alter table public.investors
      add constraint investors_reference_number_key unique (reference_number);
  end if;
end $$;

update public.investors
set next_of_kin_relationship = 'Other'
where next_of_kin_relationship is not null
  and next_of_kin_relationship not in (
    'Father',
    'Mother',
    'Sister',
    'Brother',
    'Uncle',
    'Aunt',
    'Husband',
    'Wife',
    'Cousin',
    'Son',
    'Daughter',
    'Nephew',
    'Niece',
    'Grandfather',
    'Grandmother',
    'Guardian',
    'Friend',
    'Other'
  );

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'investors_next_of_kin_relationship_check'
      and conrelid = 'public.investors'::regclass
  ) then
    alter table public.investors
      drop constraint investors_next_of_kin_relationship_check;
  end if;
end $$;

alter table public.investors
  add constraint investors_next_of_kin_relationship_check
  check (
    next_of_kin_relationship is null
    or next_of_kin_relationship in (
      'Father',
      'Mother',
      'Sister',
      'Brother',
      'Uncle',
      'Aunt',
      'Husband',
      'Wife',
      'Cousin',
      'Son',
      'Daughter',
      'Nephew',
      'Niece',
      'Grandfather',
      'Grandmother',
      'Guardian',
      'Friend',
      'Other'
    )
  );
