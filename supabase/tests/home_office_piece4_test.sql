-- Local tests: piece 4 (Hashim, Nov 18, 2026, version 2): the Home office schedule on the piece 3 engine. Saved with its
-- entry (kind home_office), put in again on the same entry, the amounts locked, "Claim the ITC" only by the reviewer or
-- an owner, History named "Home office schedule", an entry's schedule keeps its kind, deleting the entry deletes the
-- schedule, and the vehicle first-car rule does not touch it. T1's figures (worked out by the app,
-- tests/closebook-home-office.test.ts). Dummy data only.
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
insert into public.clients (kind, legal_name, province) values ('corporation', 'Birch Dummy Home Office Inc.', 'ON') returning id as client \gset
select public.cb_create_file(:'client', '2026-08-31', '2025-09-01', '', 'full', 'statements', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a') as f \gset

\set lines '''[{"chart":"65100","amount":1310,"tax_code":"HST_ON","schedule_part":"home"},{"chart":"21500","amount":28.60,"is_tax":true,"schedule_part":"home_itc"},{"chart":"23000","amount":-1338.60,"schedule_part":"home_due"}]'''
\set sched '''{"kind":"home_office","itc":true,"inputs":{"mode":"area","homeSqft":2000,"officeSqft":200},"snapshot":{"province":"ON"},"summary":"Owed to the owner 1,338.60 (10.00%)","lines":[{"schedule_part":"home","amount":1310},{"schedule_part":"home_itc","amount":28.60,"is_tax":true},{"schedule_part":"home_due","amount":-1338.60}]}'''

select public.cb_save_schedule_entry(:'f', null, 'AJE', 'correction', 'Home office', false, :lines, 'Home office schedule', null, '{}', null, :sched) as e \gset
select test.check('T1: the entry and its home office schedule', (select origin = 'schedule' and wp_ref = 'Home office schedule' and note = 'Home office' from public.cb_entries where id = :'e')
  and (select kind = 'home_office' and itc_claim from public.cb_schedules where entry_id = :'e'));
select test.check('T1: Dr 65100 1,310.00, Dr 21500 28.60, Cr 23000 1,338.60, tagged',
  (select string_agg(format('%s %s %s', a.number, l.amount, l.schedule_part), ', ' order by l.amount desc) from public.cb_entry_lines l join public.cb_accounts a on a.id = l.account_id where l.entry_id = :'e')
  = '65100 1310.00 home, 21500 28.60 home_itc, 23000 -1338.60 home_due');
select test.check('T1: it goes to the reviewer like a typed entry', (select needs_review from public.cb_entries where id = :'e'));
select test.check('T5 lock: Edit refuses a changed schedule amount',
  test.try(format($q$select public.cb_edit_entry(%L, 'AJE', 'correction', 'Home office', false, %L, 'Home office schedule')$q$, :'e', replace(:lines, '1338.60', '1300')))
  = 'Change this amount in its schedule: click the Schedule tag.');
select test.check('One schedule per entry: a home office entry is not put in as a vehicle schedule',
  test.try(format($q$select public.cb_save_schedule_entry(%L, %L, 'AJE', 'correction', 'Home office', false, %L, 'Home office schedule', null, '{}', null, %L)$q$,
    :'f', :'e', :lines, replace(:sched, '"kind":"home_office"', '"kind":"vehicle"'))) = 'This entry holds another schedule.');
select test.check('T3: the preparer cannot untick the ITC',
  test.try(format($q$select public.cb_save_schedule_entry(%L, %L, 'AJE', 'correction', 'Home office', false, %L, 'Home office schedule', null, '{}', null, %L)$q$,
    :'f', :'e', '[{"chart":"65100","amount":1338.60,"schedule_part":"home"},{"chart":"23000","amount":-1338.60,"schedule_part":"home_due"}]',
    '{"kind":"home_office","itc":false,"inputs":{},"lines":[{"schedule_part":"home","amount":1338.60},{"schedule_part":"home_due","amount":-1338.60}]}')) = 'Only the file''s reviewer or an owner can change "Claim the ITC".');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_save_schedule_entry(:'f', :'e', 'AJE', 'correction', 'Home office', false,
  '[{"chart":"65100","amount":1338.60,"schedule_part":"home"},{"chart":"23000","amount":-1338.60,"schedule_part":"home_due"}]', 'Home office schedule', null, '{}', null,
  '{"kind":"home_office","itc":false,"inputs":{"mode":"area","homeSqft":2000,"officeSqft":200},"summary":"Owed to the owner 1,338.60 (10.00%)","lines":[{"schedule_part":"home","amount":1338.60},{"schedule_part":"home_due","amount":-1338.60}],"changes":[]}') as e2 \gset
select test.check('T3: the reviewer unticks it on the same entry: Dr 65100 1,338.60, Cr 23000 1,338.60', :'e2' = :'e'
  and (select string_agg(format('%s %s', a.number, l.amount), ', ' order by l.amount desc) from public.cb_entry_lines l join public.cb_accounts a on a.id = l.account_id where l.entry_id = :'e') = '65100 1338.60, 23000 -1338.60'
  and (select not itc_claim from public.cb_schedules where entry_id = :'e'));
select public.cb_schedule_printed((select id from public.cb_schedules where entry_id = :'e'));
-- A vehicle schedule on the same file, and the vehicle first-car rule leaves the home office entry alone.
\set vlines '''[{"chart":"70600","amount":8300,"schedule_part":"allowance"},{"chart":"23000","amount":-8300,"schedule_part":"allowance_due"}]'''
\set vsched '''{"kind":"vehicle","method":"prorated","choice":"higher","itc":true,"inputs":{"businessKm":12000},"lines":[{"schedule_part":"allowance","amount":8300},{"schedule_part":"allowance_due","amount":-8300}]}'''
select public.cb_save_schedule_entry(:'f', null, 'AJE', 'correction', 'Vehicle, owner''s car', false, :vlines, 'Vehicle schedule', null, '{}', null, :vsched) as v \gset
select public.cb_delete_entry(:'e');
reset role;
select test.check('T5: the home office entry deletes with its schedule; the vehicle one stays',
  not exists (select 1 from public.cb_schedules where entry_id = :'e') and exists (select 1 from public.cb_schedules where entry_id = :'v' and kind = 'vehicle'));
select test.check('History names the Home office schedule',
  (select string_agg(detail, ' | ' order by id) from public.cb_file_history where file_id = :'f' and action like 'schedule%' and ref_label = '2026-001 AJE')
  = 'Home office schedule created for entry 2026-001 AJE | Home office schedule put into entry 2026-001 AJE | Home office schedule 2026-001 AJE: Claim the ITC unticked | Home office schedule put into entry 2026-001 AJE | Home office schedule 2026-001 AJE printed | Entry 2026-001 AJE deleted with its Home office schedule');
select test.check('the vehicle schedule still names itself', exists (select 1 from public.cb_file_history where file_id = :'f' and detail = 'Vehicle schedule created for entry 2026-002 AJE'));
select test.check('an unknown kind is refused', test.try($q$insert into public.cb_schedules (file_id, entry_id, kind) values (gen_random_uuid(), gen_random_uuid(), 'boat')$q$) like '%cb_schedules_kind_check%');
-- T6: the two retired standard entries keep their records (hidden in the app only).
select test.check('T6: Home office and Auto expenses standard entries still exist with their tax settings',
  (select string_agg(name || ' ' || tax_mode, ', ' order by name) from public.cb_standard_entries where name in ('Home office', 'Auto expenses')) = 'Auto expenses line, Home office none');
