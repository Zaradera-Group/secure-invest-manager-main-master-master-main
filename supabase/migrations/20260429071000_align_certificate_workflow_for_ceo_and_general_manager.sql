drop policy if exists "Investment managers can view pending manager certificates" on public.certificates;
drop policy if exists "General managers can view pending general manager certificates" on public.certificates;
drop policy if exists "CEO can view pending CEO certificates" on public.certificates;
drop policy if exists "Investors can view own certificates" on public.certificates;
drop policy if exists "Investment managers can view created certificates" on public.certificates;
drop policy if exists "General managers can view pending manager certificates" on public.certificates;

create policy "Workflow roles can view certificates they created or need to act on"
  on public.certificates
  for select
  to authenticated
  using (
    created_by = auth.uid()
    or (
      status::text = 'pending_manager'
      and exists (
        select 1
        from public.user_roles ur
        where ur.user_id = auth.uid()
          and ur.role = 'investment_manager'::public.app_role
      )
    )
    or (
      status::text = 'pending_general_manager'
      and exists (
        select 1
        from public.user_roles ur
        where ur.user_id = auth.uid()
          and ur.role = 'general_manager'::public.app_role
      )
    )
    or (
      status::text = 'pending_ceo'
      and exists (
        select 1
        from public.user_roles ur
        where ur.user_id = auth.uid()
          and ur.role = 'super_admin'::public.app_role
      )
    )
    or (
      lower(investor_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  );

drop policy if exists "Workflow approvers can view certificate-linked investors" on public.investors;
create policy "Workflow approvers can view certificate-linked investors"
  on public.investors
  for select
  using (
    exists (
      select 1
      from public.certificates c
      where lower(c.investor_email) = lower(public.investors.email)
        and c.investor_name = public.investors.name
        and (
          (
            c.status::text = 'pending_manager'
            and exists (
              select 1
              from public.user_roles ur
              where ur.user_id = auth.uid()
                and ur.role = 'investment_manager'::public.app_role
            )
          )
          or (
            c.status::text = 'pending_general_manager'
            and exists (
              select 1
              from public.user_roles ur
              where ur.user_id = auth.uid()
                and ur.role = 'general_manager'::public.app_role
            )
          )
          or (
            c.status::text = 'pending_ceo'
            and exists (
              select 1
              from public.user_roles ur
              where ur.user_id = auth.uid()
                and ur.role = 'super_admin'::public.app_role
            )
          )
          or (
            c.status::text = 'approved'
            and c.created_by = auth.uid()
          )
        )
    )
  );
