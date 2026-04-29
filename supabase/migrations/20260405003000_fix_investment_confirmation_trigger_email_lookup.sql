create or replace function public.send_investment_confirmation()
returns trigger as $$
declare
  user_email text;
begin
  select au.email
  into user_email
  from auth.users au
  where au.id = new.created_by;

  perform
    net.http_post(
      url := (select supabase_url from public.supabase_settings limit 1) || '/functions/v1/send-investment-confirmation',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select service_role_key from public.supabase_settings limit 1)
      ),
      body := jsonb_build_object(
        'id', new.id,
        'name', new.name,
        'email', new.email,
        'investment_amount', new.investment_amount,
        'investment_type', new.investment_type,
        'maturity_date', new.maturity_date,
        'start_date', new.start_date,
        'percentage', new.percentage,
        'tenure', new.tenure,
        'expected_maturity_amount', new.expected_maturity_amount,
        'created_by', new.created_by,
        'profiles', jsonb_build_object('email', user_email)
      )
    );

  return new;
end;
$$ language plpgsql security definer set search_path = public;
