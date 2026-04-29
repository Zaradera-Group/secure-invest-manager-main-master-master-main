-- Fix notifications table schema to match application expectations
-- Add missing columns: title, detail, action_path
-- Rename read to is_read for consistency

-- Add new columns
alter table public.notifications
  add column if not exists title text,
  add column if not exists detail text,
  add column if not exists action_path text;

-- Rename read to is_read (this will require dropping and recreating constraints/indexes if any)
-- First, check if column exists and rename it
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'notifications'
      and column_name = 'read'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'notifications'
      and column_name = 'is_read'
  ) then
    alter table public.notifications rename column read to is_read;
  end if;
end $$;

-- Update existing records to populate new columns
update public.notifications
set
  title = 'Certificate workflow update',
  detail = coalesce(message, ''),
  action_path = '/certificates/' || certificate_id::text
where title is null or detail is null or action_path is null;

-- Make title and detail not null after populating
alter table public.notifications
  alter column title set not null,
  alter column detail set not null;

-- Update indexes to use is_read instead of read
drop index if exists idx_notifications_user_role_created_at;
create index if not exists idx_notifications_user_role_is_read_created_at
  on public.notifications(user_role, is_read, created_at desc);

drop index if exists idx_notifications_recipient_user;
create index if not exists idx_notifications_recipient_user_is_read
  on public.notifications(recipient_user_id, is_read, created_at desc);

drop index if exists idx_notifications_recipient_email;
create index if not exists idx_notifications_recipient_email_is_read
  on public.notifications(lower(recipient_email), is_read, created_at desc);
