create policy "Staff-equivalent roles can update investors"
  on public.investors
  for update
  using (public.has_role(auth.uid(), 'staff'))
  with check (public.has_role(auth.uid(), 'staff'));
