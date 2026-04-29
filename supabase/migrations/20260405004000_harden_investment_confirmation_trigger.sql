create or replace function public.send_investment_confirmation()
returns trigger as $$
declare
  user_email text;
  configured_supabase_url text;
  configured_service_role_key text;
begin
  select au.email
  into user_email
  from auth.users au
  where au.id = new.created_by;

  select ss.supabase_url, ss.service_role_key
  into configured_supabase_url, configured_service_role_key
  from public.supabase_settings ss
  limit 1;

  if coalesce(configured_supabase_url, '') = '' or coalesce(configured_service_role_key, '') = '' then
    return new;
  end if;

  begin
    perform
      net.http_post(
        url := configured_supabase_url || '/functions/v1/send-investment-confirmation',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || configured_service_role_key
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
  exception
    when others then
      raise warning 'send_investment_confirmation trigger failed for investor %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$ language plpgsql security definer set search_path = public;
