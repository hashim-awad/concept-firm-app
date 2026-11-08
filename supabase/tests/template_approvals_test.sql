-- Local tests: template approvals are owner-only and permanent.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test',
  (select id from public.roles where name = 'Staff'));
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('staff cannot approve a template', test.try($$insert into public.template_approvals (template_key, template_name, el_version) values ('sPayroll', 'Schedule: payroll', 'EL v3.31')$$) like '%row-level security%');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('owner approves a template', test.try($$insert into public.template_approvals (template_key, template_name, el_version) values ('sPayroll', 'Schedule: payroll', 'EL v3.31')$$) = 'OK');
select test.check('approval is dated and signed', (select approved_on is not null and created_by = '00000000-0000-0000-0000-00000000000a' from public.template_approvals));
select test.check('approval cannot be changed', test.try($$update public.template_approvals set el_version = 'x'$$) <> 'OK');
select test.check('approval cannot be deleted', test.try($$delete from public.template_approvals$$) <> 'OK');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('staff can read approvals', (select count(*) from public.template_approvals) = 1);
reset role;
