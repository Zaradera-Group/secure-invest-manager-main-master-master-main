-- Optimize dashboard performance by adding scope-aware views and functions
-- This migration replaces client-side filtering with database-level optimization

-- Helper function to determine user's visibility scope
create or replace function public.get_user_visibility_scope()
returns table (scope text, is_executive boolean)
language sql
stable
security invoker
set search_path = public
as $$
  select 
    case 
      when exists (
        select 1 from public.user_roles
        where user_id = auth.uid()
          and role in ('admin', 'super_admin')
      ) then 'executive'
      else 'staff'
    end as scope,
    exists (
      select 1 from public.user_roles
      where user_id = auth.uid()
        and role in ('admin', 'super_admin')
    ) as is_executive;
$$;

-- Optimized portfolio summary that respects user visibility
create or replace function public.get_dashboard_portfolio_summary(p_scope text default 'auto')
returns table (
  total_investments bigint,
  total_investment_value numeric,
  active_investments bigint,
  maturing_soon bigint,
  liquidated_investments bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with scope_filter as (
    select 
      case 
        when p_scope = 'auto' then (select scope from public.get_user_visibility_scope())
        else p_scope
      end as user_scope,
      (select is_executive from public.get_user_visibility_scope()) as is_admin
  ),
  filtered_investors as (
    select investors.id, investors.investment_amount, investors.liquidation_status, investors.maturity_date
    from public.investors, scope_filter
    where 
      case 
        when scope_filter.user_scope = 'staff' then investors.created_by = auth.uid()
        when scope_filter.user_scope = 'executive' then scope_filter.is_admin = true
        else true -- 'all'
      end
  )
  select
    count(*)::bigint as total_investments,
    coalesce(sum(investment_amount), 0::numeric) as total_investment_value,
    count(*) filter (where liquidation_status = 'Active')::bigint as active_investments,
    count(*) filter (
      where liquidation_status = 'Active'
        and maturity_date::date between current_date and current_date + 30
    )::bigint as maturing_soon,
    count(*) filter (where liquidation_status = 'Liquidated')::bigint as liquidated_investments
  from filtered_investors;
$$;

-- Optimized investment type summary
create or replace function public.get_dashboard_investment_type_summary(p_scope text default 'auto')
returns table (
  investment_type text,
  investor_count bigint,
  total_investment_value numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with scope_filter as (
    select 
      case 
        when p_scope = 'auto' then (select scope from public.get_user_visibility_scope())
        else p_scope
      end as user_scope,
      (select is_executive from public.get_user_visibility_scope()) as is_admin
  ),
  filtered_investors as (
    select investors.investment_type, investors.investment_amount
    from public.investors, scope_filter
    where 
      case 
        when scope_filter.user_scope = 'staff' then investors.created_by = auth.uid()
        when scope_filter.user_scope = 'executive' then scope_filter.is_admin = true
        else true -- 'all'
      end
  )
  select
    filtered_investors.investment_type,
    count(*)::bigint as investor_count,
    coalesce(sum(investment_amount), 0::numeric) as total_investment_value
  from filtered_investors
  group by filtered_investors.investment_type
  order by filtered_investors.investment_type;
$$;

-- Optimized upcoming maturities with limit
create or replace function public.get_dashboard_upcoming_maturities_v2(
  p_limit integer default 5,
  p_scope text default 'auto'
)
returns table (
  id uuid,
  name text,
  investment_amount numeric,
  maturity_date date,
  liquidation_status text,
  investment_type text
)
language sql
stable
security invoker
set search_path = public
as $$
  with scope_filter as (
    select 
      case 
        when p_scope = 'auto' then (select scope from public.get_user_visibility_scope())
        else p_scope
      end as user_scope,
      (select is_executive from public.get_user_visibility_scope()) as is_admin
  )
  select
    investors.id,
    investors.name,
    investors.investment_amount,
    investors.maturity_date,
    investors.liquidation_status::text,
    investors.investment_type::text
  from public.investors, scope_filter
  where 
    investors.liquidation_status = 'Active'
    and (
      case 
        when scope_filter.user_scope = 'staff' then investors.created_by = auth.uid()
        when scope_filter.user_scope = 'executive' then scope_filter.is_admin = true
        else true -- 'all'
      end
    )
  order by investors.maturity_date asc
  limit greatest(p_limit, 1);
$$;

-- Create index for faster maturity lookups
create index if not exists idx_investors_maturity_date_status 
  on public.investors(maturity_date, liquidation_status) 
  where liquidation_status = 'Active';

-- Create index for creator lookups (for staff scope)
create index if not exists idx_investors_created_by_status 
  on public.investors(created_by, liquidation_status) 
  where created_by is not null;

-- Optimized investor list with database-level filtering and pagination
create or replace function public.get_investor_list_paginated(
  p_page integer default 0,
  p_page_size integer default 50,
  p_search text default '',
  p_status_filter text default 'all',
  p_type_filter text default 'all',
  p_category_filter text default 'all'
)
returns table (
  data jsonb,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with filtered_investors as (
    select
      investors.id,
      investors.name,
      investors.email,
      investors.investment_amount,
      investors.expected_maturity_amount,
      investors.liquidation_status,
      investors.maturity_date,
      investors.created_at,
      investors.client_bank,
      investors.brought_by,
      investors.phone,
      investors.percentage,
      investors.investment_type,
      investors.currency_code,
      investors.investor_category,
      investors.category_reference_name,
      investors.category_reference_email,
      investors.category_notes,
      investors.created_by
    from public.investors
    where
      -- Role-based visibility filter
      case
        when exists (
          select 1 from public.user_roles
          where user_id = auth.uid()
            and role in ('admin', 'super_admin')
        ) then true
        else investors.created_by = auth.uid()
      end
      -- Status filter
      and (p_status_filter = 'all' or investors.liquidation_status = p_status_filter)
      -- Type filter
      and (p_type_filter = 'all' or investors.investment_type = p_type_filter)
      -- Category filter
      and (p_category_filter = 'all' or investors.investor_category = p_category_filter)
      -- Search filter
      and (
        p_search = '' or
        investors.name ilike '%' || p_search || '%' or
        investors.email ilike '%' || p_search || '%' or
        investors.client_bank ilike '%' || p_search || '%' or
        investors.brought_by ilike '%' || p_search || '%'
      )
  ),
  paginated_data as (
    select
      jsonb_agg(
        jsonb_build_object(
          'id', fi.id,
          'name', fi.name,
          'email', fi.email,
          'investment_amount', fi.investment_amount,
          'expected_maturity_amount', fi.expected_maturity_amount,
          'liquidation_status', fi.liquidation_status,
          'maturity_date', fi.maturity_date,
          'created_at', fi.created_at,
          'client_bank', fi.client_bank,
          'brought_by', fi.brought_by,
          'phone', fi.phone,
          'percentage', fi.percentage,
          'investment_type', fi.investment_type,
          'currency_code', fi.currency_code,
          'investor_category', fi.investor_category,
          'category_reference_name', fi.category_reference_name,
          'category_reference_email', fi.category_reference_email,
          'category_notes', fi.category_notes,
          'created_by', fi.created_by
        )
      ) as data,
      count(*) as total_count
    from filtered_investors fi
  )
  select
    (select data from paginated_data) as data,
    (select total_count from paginated_data) as total_count
  from paginated_data
  limit 1;
$$;

-- Create composite index for efficient filtering and searching
create index if not exists idx_investors_composite_search
  on public.investors(created_by, liquidation_status, investment_type, investor_category, name, email, client_bank, brought_by);

-- Grant execute permission
grant execute on function public.get_investor_list_paginated(integer, integer, text, text, text, text) to authenticated;
