-- Local tests: piece 4b (Hashim, Nov 18, 2026, version 2): Expenses paid personally as a schedule on the piece 3 engine.
-- Saved with its entry (kind expenses), used twice on one file (two entries, two schedules), put in again on the same
-- entry, the amounts locked, "Claim the ITC" only by the reviewer or an owner, History named "Expenses paid personally
-- schedule", one schedule per entry, deleting the entry deletes the schedule. The round 9 standard entry stays. T1's
-- figures (worked out by the app, tests/closebook-expenses-schedule.test.ts). Dummy data only.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'), ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test', (select id from public.roles where name = 'Accountant'));
reset role;
update public.role_permissions set level = 'edit' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Accountant');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
insert into public.clients (kind, legal_name, province) values ('corporation', 'Birch Dummy Expenses Inc.', 'ON') returning id as client \gset
select public.cb_create_file(:'client', '2026-08-31', '2025-09-01', '', 'full', 'statements', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a') as f \gset

-- T1: four lines.
\set lines '''[{"chart":"65000","amount":200,"memo":"Printer ink","tax_code":"HST_ON","schedule_part":"exp_1"},{"chart":"70500","amount":720,"memo":"Cell phone, year","tax_code":"HST_ON","schedule_part":"exp_2"},{"chart":"60200","amount":53.25,"memo":"Client lunch","tax_code":"MEALS_HST_50","schedule_part":"exp_3"},{"chart":"62000","amount":500,"memo":"Liability policy","schedule_part":"exp_4"},{"chart":"21500","amount":122.85,"is_tax":true,"schedule_part":"exp_itc"},{"chart":"23000","amount":-1596.10,"schedule_part":"exp_due"}]'''
\set sched '''{"kind":"expenses","itc":true,"inputs":{"lines":[{"acct":"chart:65000","paid":22600}]},"snapshot":{"province":"ON"},"summary":"Owed to the owner 1,596.10 (4 lines)","lines":[{"schedule_part":"exp_1","amount":200},{"schedule_part":"exp_2","amount":720},{"schedule_part":"exp_3","amount":53.25},{"schedule_part":"exp_4","amount":500},{"schedule_part":"exp_itc","amount":122.85,"is_tax":true},{"schedule_part":"exp_due","amount":-1596.10}]}'''
select public.cb_save_schedule_entry(:'f', null, 'AJE', 'correction', 'Expenses paid personally', false, :lines, 'Expenses paid personally schedule', null, '{}', null, :sched) as e \gset
select test.check('T1: the entry and its expenses schedule', (select origin = 'schedule' and wp_ref = 'Expenses paid personally schedule' and note = 'Expenses paid personally' and kind = 'AJE' and entry_date = '2026-08-31' from public.cb_entries where id = :'e')
  and (select kind = 'expenses' and itc_claim from public.cb_schedules where entry_id = :'e'));
select test.check('T1: four Dr expense lines 1,473.25, Dr 21500 122.85, Cr 23000 1,596.10, tagged',
  (select string_agg(format('%s %s %s %s', a.number, l.amount, coalesce(l.tax_code, '-'), l.schedule_part), ', ' order by l.amount desc) from public.cb_entry_lines l join public.cb_accounts a on a.id = l.account_id where l.entry_id = :'e')
  = '70500 720.00 HST_ON exp_2, 62000 500.00 - exp_4, 65000 200.00 HST_ON exp_1, 21500 122.85 - exp_itc, 60200 53.25 MEALS_HST_50 exp_3, 23000 -1596.10 - exp_due');
select test.check('T1: what it was is the line description', (select memo from public.cb_entry_lines where entry_id = :'e' and schedule_part = 'exp_3') = 'Client lunch');
select test.check('T8 lock: Edit refuses a changed schedule amount',
  test.try(format($q$select public.cb_edit_entry(%L, 'AJE', 'correction', 'Expenses paid personally', false, %L, 'Expenses paid personally schedule')$q$, :'e', replace(:lines, '1596.10', '1500')))
  = 'Change this amount in its schedule: click the Schedule tag.');
select test.check('One schedule per entry: an expenses entry is not put in as a home office schedule',
  test.try(format($q$select public.cb_save_schedule_entry(%L, %L, 'AJE', 'correction', 'Expenses paid personally', false, %L, 'Expenses paid personally schedule', null, '{}', null, %L)$q$,
    :'f', :'e', :lines, replace(:sched, '"kind":"expenses"', '"kind":"home_office"'))) = 'This entry holds another schedule.');
select test.check('the preparer cannot untick the ITC',
  test.try(format($q$select public.cb_save_schedule_entry(%L, %L, 'AJE', 'correction', 'Expenses paid personally', false, %L, 'Expenses paid personally schedule', null, '{}', null, %L)$q$,
    :'f', :'e', '[{"chart":"65000","amount":226,"schedule_part":"exp_1"},{"chart":"23000","amount":-226,"schedule_part":"exp_due"}]',
    '{"kind":"expenses","itc":false,"inputs":{},"lines":[{"schedule_part":"exp_1","amount":226},{"schedule_part":"exp_due","amount":-226}]}')) = 'Only the file''s reviewer or someone with the Review right can change "Claim the ITC".');

-- T2: a second use on the same file: its own entry and its own schedule.
select public.cb_save_schedule_entry(:'f', null, 'AJE', 'correction', 'Expenses paid personally', false,
  '[{"chart":"65000","amount":100,"tax_code":"HST_ON","schedule_part":"exp_1"},{"chart":"21500","amount":13,"is_tax":true,"schedule_part":"exp_itc"},{"chart":"23000","amount":-113,"schedule_part":"exp_due"}]',
  'Expenses paid personally schedule', null, '{}', null,
  '{"kind":"expenses","itc":true,"inputs":{},"lines":[{"schedule_part":"exp_1","amount":100},{"schedule_part":"exp_itc","amount":13,"is_tax":true},{"schedule_part":"exp_due","amount":-113}]}') as e2 \gset
select test.check('T2: two entries from this schedule, each with its own schedule',
  :'e2' <> :'e' and (select count(*) from public.cb_schedules where file_id = :'f' and kind = 'expenses') = 2
  and (select count(distinct entry_id) from public.cb_schedules where file_id = :'f' and kind = 'expenses') = 2);

-- T3: reopen T1 and add a fifth line: the same entry updates to 1,641.30.
select public.cb_save_schedule_entry(:'f', :'e', 'AJE', 'correction', 'Expenses paid personally', false,
  replace(replace(replace(:lines, '"amount":122.85', '"amount":128.05'), '-1596.10', '-1641.30'), '{"chart":"21500"', '{"chart":"65000","amount":40,"memo":"Paper","tax_code":"HST_ON","schedule_part":"exp_5"},{"chart":"21500"')::jsonb,
  'Expenses paid personally schedule', null, '{}', null,
  replace(replace(replace(:sched, '"amount":122.85', '"amount":128.05'), '-1596.10', '-1641.30'), '{"schedule_part":"exp_itc"', '{"schedule_part":"exp_5","amount":40},{"schedule_part":"exp_itc"')::jsonb) as e3 \gset
select test.check('T3: the same entry, owed 1,641.30, no new entry', :'e3' = :'e'
  and (select -amount from public.cb_entry_lines where entry_id = :'e' and schedule_part = 'exp_due') = 1641.30
  and (select count(*) from public.cb_entries where file_id = :'f' and origin = 'schedule') = 2);

select public.cb_schedule_printed((select id from public.cb_schedules where entry_id = :'e'));
select public.cb_delete_entry(:'e2');
reset role;
select test.check('T8: the T2 entry deletes with its schedule; T1 stays',
  not exists (select 1 from public.cb_schedules where entry_id = :'e2') and exists (select 1 from public.cb_schedules where entry_id = :'e' and kind = 'expenses'));
select test.check('History names the Expenses paid personally schedule',
  (select string_agg(detail, ' | ' order by id) from public.cb_file_history where file_id = :'f' and action like 'schedule%' and ref_label = '2026-001 AJE')
  = 'Expenses paid personally schedule created for entry 2026-001 AJE | Expenses paid personally schedule put into entry 2026-001 AJE | Expenses paid personally schedule put into entry 2026-001 AJE | Expenses paid personally schedule 2026-001 AJE printed');
select test.check('the deleted entry names its schedule', exists (select 1 from public.cb_file_history where file_id = :'f' and detail = 'Entry 2026-002 AJE deleted with its Expenses paid personally schedule'));
select test.check('an unknown kind is still refused', test.try($q$insert into public.cb_schedules (file_id, entry_id, kind) values (gen_random_uuid(), gen_random_uuid(), 'boat')$q$) like '%cb_schedules_kind_check%');
select test.check('step 5 problems say nothing about expenses paid personally',
  not exists (select 1 from unnest(private.cb_step5_problems(:'f')) p where p ilike '%personally%'));
-- T12: the round 9 standard entry and its lines stay in the database.
select test.check('T12: the round 9 standard entry and its lines are kept',
  (select count(*) from public.cb_standard_entry_lines l join public.cb_standard_entries s on s.id = l.standard_id where s.name = 'Expenses paid personally' and s.style = 'lines') > 0);
