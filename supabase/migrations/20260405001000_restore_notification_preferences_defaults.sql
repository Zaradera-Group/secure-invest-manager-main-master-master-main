alter table public.notification_preferences
  alter column email_enabled set default true,
  alter column maturity_reminders set default true,
  alter column payment_reminders set default true,
  alter column monthly_reports set default true,
  alter column birthday_notifications set default true,
  alter column reminder_days_before set default '{7,3,1}';

update public.notification_preferences
set
  email_enabled = true,
  maturity_reminders = true,
  payment_reminders = true,
  monthly_reports = true,
  birthday_notifications = true,
  reminder_days_before = '{7,3,1}',
  updated_at = now();
