-- Local tests: piece 8 (Hashim, Nov 18, 2026, version 5): the shareholder loans leave step 5; the reviewer answers them in
-- step 7 (Update, flags, "Repaid by", "Noted: repay by"); a change clears step 7 only; the shareholder name. Dummy data only.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'), ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test', (select id from public.roles where name = 'Staff'));
reset role;
update public.role_permissions set level = 'edit' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Staff');
insert into public.clients (kind, legal_name, province) values ('corporation', 'Birch Dummy Loans Inc.', 'ON') returning id as client \gset
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_create_file(:'client', '2026-08-31', '2025-09-01', '', 'full', 'client_software', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a') as f \gset
select public.cb_save_setup(:'f', '{"realtor":false,"owner_paid":false,"dividends":false,"payroll":false,"holdco":false,"gst_registered":false}');
select public.cb_import_tb(:'f', 'this_year', 'client_software', 'tb.csv', '[
  {"number":"10100","name":"Chequing","amount":-46872.40},{"number":"23000","name":"Due to shareholder 1","amount":46872.40},
  {"number":"23050","name":"Due to shareholder 2","amount":-8200},{"number":"41000","name":"Sales","amount":8200}]');
select public.cb_map_account(id, case number when '10100' then '1002.00' when '23000' then '2781.10' when '23050' then '2781.20' else '8000.00' end) from public.cb_accounts where file_id = :'f';
reset role; reset request.jwt.claims;

\set state 'select coalesce(string_agg(step, \',\' order by step), \'none\') from public.cb_step_signoffs where file_id = :''f'' and step in (''entries'', ''review'') and (prepared_at is not null or reviewed_at is not null)'
\set signed 'insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at) values (:''f'', ''entries'', ''00000000-0000-0000-0000-00000000000c'', now()) on conflict (file_id, step) do update set prepared_at = now(); insert into public.cb_step_signoffs (file_id, step, reviewed_by, reviewed_at) values (:''f'', ''review'', ''00000000-0000-0000-0000-00000000000a'', now()) on conflict (file_id, step) do update set reviewed_at = now()'
\set rows '[{"account_key":"23000","number":"23000","name":"Due to shareholder 1","line_no":"2781.00","opening":0,"closing":46872.40,"tb":46872.40,"shareholder":1,"owner_source":"picked"},{"account_key":"23050","number":"23050","name":"Due to shareholder 2","line_no":"2781.00","opening":0,"closing":-8200,"tb":-8200,"shareholder":2,"owner_source":"picked"}]'
\set groups '[{"group_key":"sh:1","shareholder":1,"accounts":["23000"],"opening":0,"closing":46872.40,"reductions":0,"last_part":0,"this_part":46872.40,"due_on":"2027-08-31","flags":[]},{"group_key":"sh:2","shareholder":2,"accounts":["23050"],"opening":0,"closing":-8200,"reductions":0,"last_part":0,"this_part":0,"due_on":"","flags":[]}]'

-- T3: step 5 no longer asks for the shareholder loans.
select test.check('T3: step 5 has no shareholder loan item', not exists (select 1 from unnest(private.cb_step5_problems(:'f')) p where p like 'Shareholder loan%'));
select test.check('T3: step 5 waits on nothing of them', not exists (select 1 from unnest(private.cb_step5_waiting(:'f')) p where p like '%shareholder%'));
select test.check('step 7 asks for the figures first', private.cb_review_problems(:'f') @> array['Shareholder loans: click Update to work out the figures.']);

-- The figures saved ("Update"; the reviewer in the app, any editor in the database as before).
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_set_sh_owner(:'f', '23000', 1), public.cb_set_sh_owner(:'f', '23050', 2);
select public.cb_prepare_sh_schedule(:'f', :'rows', :'groups');
reset role; reset request.jwt.claims;
select test.check('T2: step 7 needs the repay-by date noted for the account owed by the shareholder (one, not shareholder 2''s)',
  private.cb_sh_review_problems(:'f') = array['Shareholder loans: note the repay-by date for 1 account owed by the shareholder.']);
select test.check('History logs the update under step 7', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'sh_prepared' and step = 'review'));

-- T2/T4: "Noted: repay by Aug 31, 2027": the reviewer's; clears step 7 only.
:signed;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('T2: the preparer cannot note it', test.try(format('select public.cb_note_sh_due(%L, %L)', :'f', '23050')) like 'Only the reviewer%');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('only an account owed by the shareholder', test.try(format('select public.cb_note_sh_due(%L, %L)', :'f', '23050')) = 'This account is not owed by the shareholder at year-end.');
select public.cb_note_sh_due(:'f', '23000');
reset role; reset request.jwt.claims;
select test.check('T2: noted with the date one year after the year end', (select due_on = '2027-08-31' and closing = 46872.40 from public.cb_sh_noted where file_id = :'f' and account_key = '23000'));
select test.check('T2: nothing left for step 7 from the shareholder loans', private.cb_sh_review_problems(:'f') = '{}');
select test.check('T4: noting clears step 7, not step 5', (:state) = 'entries');
select test.check('History: noted, under step 7', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'sh_due_noted' and step = 'review' and detail like '23000 Due to shareholder 1: owed by the shareholder at year-end 46,872.40; repay by Aug 31, 2027'));

-- A flag decided by the reviewer, with no preparer's answer first; the decision clears step 7 only.
\set groups2 '[{"group_key":"sh:1","shareholder":1,"accounts":["23000"],"opening":0,"closing":46872.40,"reductions":0,"last_part":0,"this_part":46872.40,"due_on":"2027-08-31","flags":["late_repayment"],"flag_amounts":{"late_repayment":46872.40}},{"group_key":"sh:2","shareholder":2,"accounts":["23050"],"opening":0,"closing":-8200,"reductions":0,"last_part":0,"this_part":0,"due_on":"","flags":[]}]'
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_prepare_sh_schedule(:'f', :'rows', :'groups2');
reset role; reset request.jwt.claims;
select test.check('a flag raised waits in step 7', private.cb_sh_review_problems(:'f') = array['Shareholder loans: decide 1 flag.']);
:signed;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_accept_sh_flag(:'f', 'sh:1', 'late_repayment', 'One loan, repaid after year end: not a series.');
reset role; reset request.jwt.claims;
select test.check('the reviewer decides without a preparer''s answer', private.cb_sh_review_problems(:'f') = '{}');
select test.check('T4: the reviewer''s decision clears step 7, not step 5', (:state) = 'entries');

-- A change in the books: Update again; a changed balance needs noting again.
:signed;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_set_sh_owner(:'f', '23050', 3);
reset role; reset request.jwt.claims;
select test.check('the books changed: Update', private.cb_sh_review_problems(:'f') = array['Shareholder loans: the books changed. Click Update.']);
select test.check('T4: picking an account''s shareholder does not clear step 5', (:state) like 'entries%');

-- Who is who: the shareholder name.
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_set_sh_name(:'f', '23000', 'Pat Dummy');
select public.cb_set_sh_name(:'f', '23050', 'Sam Dummy');
select public.cb_set_sh_name(:'f', '23050', 'Sam Dummy');
select test.check('only a shareholder account takes a name', test.try(format('select public.cb_set_sh_name(%L, %L, %L)', :'f', '10100', 'Pat Dummy')) = 'Only a shareholder account takes a shareholder name.');
select public.cb_set_sh_name(:'f', '23050', 'Sam B. Dummy');
reset role; reset request.jwt.claims;
select test.check('T10: names saved', (select string_agg(account_key || '=' || name, ',' order by account_key) from public.cb_sh_names where file_id = :'f') = '23000=Pat Dummy,23050=Sam B. Dummy');
select test.check('T10: History records each change once (the same name twice is one change)',
  (select string_agg(detail, ' | ' order by id) from public.cb_file_history where file_id = :'f' and action = 'sh_name')
  = '23000 Due to shareholder 1: shareholder "Pat Dummy" | 23050 Due to shareholder 2: shareholder "Sam Dummy" | 23050 Due to shareholder 2: shareholder "Sam B. Dummy" (was "Sam Dummy")');
select test.check('a name clears no step', (:state) like 'entries%');

-- Locked: no noting, no name.
update public.cb_files set phase = 'locked' where id = :'f';
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('locked: no noting', test.try(format('select public.cb_note_sh_due(%L, %L)', :'f', '23000')) = 'This file is locked or missing.');
select test.check('locked: no name', test.try(format('select public.cb_set_sh_name(%L, %L, %L)', :'f', '23000', 'X')) = 'This file is locked or missing.');
reset role; reset request.jwt.claims;
