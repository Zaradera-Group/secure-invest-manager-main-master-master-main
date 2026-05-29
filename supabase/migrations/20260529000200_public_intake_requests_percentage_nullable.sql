alter table public.public_intake_requests
  alter column percentage drop not null;

comment on column public.public_intake_requests.percentage is 'Optional indicative rate captured during public intake; may be null when not provided by the submitter.';
