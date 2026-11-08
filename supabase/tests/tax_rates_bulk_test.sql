-- Local tests: loading the CRA table and "Approve all".
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test',
  (select id from public.roles where name = 'Staff'));
select test.check('owner loads several rates as pending', test.try($$insert into public.tax_rates (province, tax, rate_percent, effective_from, source_url, checked_on, checked_by) values
  ('ON', 'HST', 13, '2025-04-01', 'https://www.canada.ca/en/revenue-agency/x', '2026-11-08', '00000000-0000-0000-0000-00000000000a'),
  ('NS', 'HST', 14, '2025-04-01', 'https://www.canada.ca/en/revenue-agency/x', '2026-11-08', '00000000-0000-0000-0000-00000000000a'),
  ('AB', 'GST', 5, '2025-04-01', 'https://www.canada.ca/en/revenue-agency/x', '2026-11-08', '00000000-0000-0000-0000-00000000000a')$$) = 'OK');
select test.check('nothing used before approval', not exists (select 1 from public.approved_tax_rate('ON', '2026-11-08')));
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('staff cannot approve all', test.try($$update public.tax_rates set status = 'approved' where status = 'pending'$$) <> 'OK'
  or (select count(*) from public.tax_rates where status = 'approved') = 0);
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('owner approves all in one step', test.try($$update public.tax_rates set status = 'approved' where status = 'pending'$$) = 'OK');
select test.check('all three approved, with approver', (select count(*) from public.tax_rates where status = 'approved' and approved_by = '00000000-0000-0000-0000-00000000000a') = 3);
select test.check('Ontario 13% HST now used', (select rate_percent from public.approved_tax_rate('ON', '2026-11-08')) = 13);
select test.check('not before its effective date', not exists (select 1 from public.approved_tax_rate('NS', '2025-03-31')));
reset role;
