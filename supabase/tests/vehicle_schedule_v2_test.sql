-- Local tests: piece 3, version 2 (Hashim, Nov 18, 2026). The entry whose Vehicle schedule holds the company-paid car
-- costs (the file's first) cannot be deleted while another Vehicle schedule entry exists; the other one can, and then
-- the first can too. A preparer cannot change "Claim the ITC" (the database refuses, not only the screen). Dummy data only.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'), ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test', (select id from public.roles where name = 'Staff'));
reset role;
update public.role_permissions set level = 'edit' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Staff');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
insert into public.clients (kind, legal_name, province) values ('corporation', 'Birch Dummy Two Cars Inc.', 'ON') returning id as client \gset
select public.cb_create_file(:'client', '2026-08-31', '2025-09-01', '', 'full', 'statements', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a') as f \gset

\set lines '''[{"chart":"70600","amount":8300,"schedule_part":"allowance"},{"chart":"23000","amount":-8300,"schedule_part":"allowance_due"}]'''
\set sched '''{"kind":"vehicle","method":"prorated","choice":"higher","itc":true,"inputs":{"businessKm":12000},"lines":[{"schedule_part":"allowance","amount":8300},{"schedule_part":"allowance_due","amount":-8300}]}'''
select public.cb_save_schedule_entry(:'f', null, 'AJE', 'correction', 'Vehicle, owner''s car', false, :lines, 'Vehicle schedule', null, '{}', null, :sched) as car1 \gset
select public.cb_save_schedule_entry(:'f', null, 'AJE', 'correction', 'Vehicle, second car', false, :lines, 'Vehicle schedule', null, '{}', null, :sched) as car2 \gset

select test.check('Fix 2: the first car''s entry is refused while the second exists, naming the second',
  test.try(format($q$select public.cb_delete_entry(%L)$q$, :'car1')) = 'This entry holds the company-paid car costs. Delete 2026-002 first.');
select test.check('Fix 2: refused, nothing changed', (select count(*) from public.cb_entries where file_id = :'f') = 2 and (select count(*) from public.cb_schedules where file_id = :'f') = 2);
select test.check('Fix 2: the other car''s entry deletes as before', test.try(format($q$select public.cb_delete_entry(%L)$q$, :'car2')) = 'OK');
select test.check('Fix 2: then the first car''s entry, now the only one, deletes as before', test.try(format($q$select public.cb_delete_entry(%L)$q$, :'car1')) = 'OK');
reset role;
select test.check('Fix 2: History has both deletions', (select count(*) from public.cb_file_history where file_id = :'f' and action = 'schedule_deleted') = 2);

-- Fix 5: a preparer cannot change "Claim the ITC" on the server.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('Fix 5: the preparer is refused by the database',
  test.try(format($q$select public.cb_save_schedule_entry(%L, null, 'AJE', 'correction', 'Vehicle, owner''s car', false, %L, 'Vehicle schedule', null, '{}', null, %L)$q$,
    :'f', :lines, replace(:sched, '"itc":true', '"itc":false'))) = 'Only the file''s reviewer or an owner can change "Claim the ITC".');
reset role;
-- The rule is in the trigger, so a delete that does not go through cb_delete_entry is refused too.
select public.cb_save_schedule_entry(:'f', null, 'AJE', 'correction', 'Vehicle, owner''s car', false, :lines, 'Vehicle schedule', null, '{}', null, :sched) as car3 \gset
select public.cb_save_schedule_entry(:'f', null, 'AJE', 'correction', 'Vehicle, second car', false, :lines, 'Vehicle schedule', null, '{}', null, :sched) as car4 \gset
select test.check('Fix 2: a direct delete (as the database owner) is refused by the trigger',
  test.try(format($q$delete from public.cb_entries where id = %L$q$, :'car3')) = 'This entry holds the company-paid car costs. Delete 2026-002 first.');
