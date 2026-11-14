-- Local tests: round 14 (Hashim, Nov 14, 2026), the shareholder loan schedule on step 5: prepared with
-- the books' fingerprint, tied to the trial balance, the s.15(2) date, the two reviewer flags, next
-- year's "Repaid by" question with its evidence, My day's list, the window setting and the lock.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'prep.c@example.test'),
  ('00000000-0000-0000-0000-00000000000d', 'prep.d@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Preparer C', 'prep.c@example.test', (select id from public.roles where name = 'Staff'));
select public.add_staff('00000000-0000-0000-0000-00000000000d', 'Test Preparer D', 'prep.d@example.test', (select id from public.roles where name = 'Staff'));
reset role;
reset request.jwt.claims;
update public.role_permissions set level = 'edit' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Staff');
insert into public.clients (kind, legal_name, province) values ('corporation', 'Oak Test Realty Inc.', 'ON') returning id as client \gset
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_create_file(:'client', '2026-12-31', '2026-01-01', '', 'full', 'statements', '00000000-0000-0000-0000-00000000000c'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid) as f \gset
select public.cb_create_file(:'client', '2027-12-31', '2027-01-01', '', 'full', 'statements', '00000000-0000-0000-0000-00000000000c'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid) as f2 \gset
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_build_tb(:'f', '[{"key":"chart:23000","number":"23000","name":"Due to shareholder 1","line_no":"2781.10","amount":800,"last":500,"reviewer":""},
  {"key":"chart:10000","number":"10000","name":"Chequing","line_no":"1002.00","amount":-800,"last":-500,"reviewer":""}]');
reset role;
reset request.jwt.claims;
select test.check('a file with a shareholder account has a schedule', private.cb_sh_applies(:'f'));
select test.check('step 5 waits for the schedule', private.cb_sh_problems(:'f') = array['Shareholder loan schedule: prepare it.']);
select test.check('step 5''s own list carries it', 'Shareholder loan schedule: prepare it.' = any (private.cb_step5_problems(:'f')));

set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('the s.15(2) date is one year after the year end', test.try(format($q$select public.cb_prepare_sh_schedule(%L, '[{"account_key":"chart:23000","opening":500,"closing":800,"tb":800,"flags":["earlier_debit"],"due_on":"2027-06-30"}]')$q$, :'f'))
  = 'The s.15(2) date is one year after the year end.');
select public.cb_prepare_sh_schedule(:'f', '[{"account_key":"chart:23000","number":"23000","name":"Due to shareholder 1","line_no":"2781.10","opening":500,"closing":800,"tb":800,"movements":[{"kind":"paid","amount":300,"n":1}],"flags":["earlier_debit"],"due_on":"2027-12-31","prior_due_on":"2026-12-31"}]');
reset role;
reset request.jwt.claims;
select test.check('prepared: the flag and last year''s question wait for the preparer', private.cb_sh_problems(:'f') = array[
  'Shareholder loan schedule: answer 1 flag for the reviewer.', 'Shareholder loan schedule: answer "Repaid by" for 1 account.']);

set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('a flag needs an answer', test.try(format($q$select public.cb_answer_sh_flag(%L, 'chart:23000', 'earlier_debit', '')$q$, :'f')) = 'Say what the reviewer needs to know.');
select public.cb_answer_sh_flag(:'f', 'chart:23000', 'earlier_debit', 'Opening 500.00 repaid March 2; the 800.00 is new advances in October.');
select test.check('Yes needs the evidence', test.try(format($q$select public.cb_answer_sh_repaid(%L, 'chart:23000', 'yes', null, null, '')$q$, :'f')) like 'Yes: attach the evidence%');
select test.check('No needs a note', test.try(format($q$select public.cb_answer_sh_repaid(%L, 'chart:23000', 'no', null, null, '')$q$, :'f')) = 'No: say what happened, for the reviewer.');
select public.cb_answer_sh_repaid(:'f', 'chart:23000', 'no', null, null, 'Not repaid. Include 500.00 in the shareholder''s 2026 income.');
select test.check('the preparer cannot accept a flag', test.try(format($q$select public.cb_accept_sh_flag(%L, 'chart:23000', 'earlier_debit', 'ok then')$q$, :'f')) like 'Only the reviewer accepts%');
reset role;
reset request.jwt.claims;
select test.check('answered: nothing open for the preparer', private.cb_sh_problems(:'f') = '{}');
select test.check('the flag and the unpaid loan wait for the reviewer', private.cb_sh_waiting(:'f') = array['1 shareholder loan flag for the reviewer.', '1 shareholder loan not repaid by the s.15(2) date.']);
select test.check('step 5''s waiting list carries them', cardinality(private.cb_step5_waiting(:'f')) = 2);

set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_accept_sh_flag(:'f', 'chart:23000', 'earlier_debit', 'Repayment of the opening balance seen on the March statement.');
select public.cb_accept_sh_repaid(:'f', 'chart:23000', 'Income inclusion on the shareholder''s T1.');
reset role;
reset request.jwt.claims;
select test.check('accepted: nothing waits', private.cb_sh_waiting(:'f') = '{}');

-- Preparing again with the same balance keeps the answers; a changed balance needs them again.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_prepare_sh_schedule(:'f', '[{"account_key":"chart:23000","opening":500,"closing":800,"tb":800,"flags":["earlier_debit"],"due_on":"2027-12-31","prior_due_on":"2026-12-31"}]');
reset role;
reset request.jwt.claims;
select test.check('same balance: the answer and acceptance stay', (select note <> '' and accepted_at is not null from public.cb_sh_flags where file_id = :'f'));
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_build_tb(:'f', '[{"key":"chart:23000","number":"23000","name":"Due to shareholder 1","line_no":"2781.10","amount":900,"last":500,"reviewer":""},
  {"key":"chart:10000","number":"10000","name":"Chequing","line_no":"1002.00","amount":-900,"last":-500,"reviewer":""}]');
reset role;
reset request.jwt.claims;
select test.check('the books changed: prepare again', private.cb_sh_problems(:'f') = array['Shareholder loan schedule: the books changed after it was prepared. Prepare it again.']);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_prepare_sh_schedule(:'f', '[{"account_key":"chart:23000","number":"23000","name":"Due to shareholder 1","line_no":"2781.10","opening":500,"closing":900,"tb":850,"flags":["earlier_debit"],"due_on":"2027-12-31","prior_due_on":"2026-12-31"}]');
reset role;
reset request.jwt.claims;
select test.check('a changed balance: the flag is answered again, and the schedule must tie', private.cb_sh_problems(:'f') = array[
  'Shareholder loan schedule: 1 account does not tie to the trial balance.', 'Shareholder loan schedule: answer 1 flag for the reviewer.']);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_prepare_sh_schedule(:'f', '[{"account_key":"chart:23000","number":"23000","name":"Due to shareholder 1","line_no":"2781.10","opening":500,"closing":900,"tb":900,"flags":[],"due_on":"2027-12-31","prior_due_on":"2026-12-31"}]');
reset role;
reset request.jwt.claims;
select test.check('a flag no longer raised goes', not exists (select 1 from public.cb_sh_flags where file_id = :'f'));

-- My day: the date until next year's file answers Yes with the evidence. Owners see every file;
-- other staff the files they prepare.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('the preparer sees the date, next year''s file not answered', (select due_on = '2027-12-31' and closing = 900 and next_file = :'f2' and answer is null from public.cb_sh_due_list() where file_id = :'f'));
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000d"}';
select test.check('another preparer does not', not exists (select 1 from public.cb_sh_due_list()));
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('an owner does', exists (select 1 from public.cb_sh_due_list() where file_id = :'f'));

-- Next year's file: "Repaid by December 31, 2027?" Yes with a bank line or entry on this file. The debit
-- balance on 23000 carries to its pair, 13000 Due from shareholder 1: My day matches the answer there.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_build_tb(:'f2', '[{"key":"chart:13000","number":"13000","name":"Due from shareholder 1","line_no":"1301.10","amount":900,"last":900,"reviewer":""},
  {"key":"chart:10000","number":"10000","name":"Chequing","line_no":"1002.00","amount":-900,"last":-900,"reviewer":""}]');
select public.cb_add_entry(:'f', 'AJE', 'correction', 'Other file', false, '[{"chart":"10000","amount":900},{"chart":"23000","amount":-900}]', 'Bank statements') as e_other \gset
select public.cb_add_entry(:'f2', 'AJE', 'correction', 'Repayment by the shareholder', false, '[{"chart":"10000","amount":900},{"chart":"13000","amount":-900}]', 'Bank statements', '2027-06-15') as e_repay \gset
select public.cb_prepare_sh_schedule(:'f2', '[{"account_key":"chart:13000","number":"13000","name":"Due from shareholder 1","line_no":"1301.10","opening":900,"closing":0,"tb":0,"flags":[],"due_on":"","prior_due_on":"2027-12-31"}]');
reset role;
reset request.jwt.claims;
select test.check('next year: the question waits', private.cb_sh_problems(:'f2') = array['Shareholder loan schedule: answer "Repaid by" for 1 account.']);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('the evidence must be on this file', test.try(format($q$select public.cb_answer_sh_repaid(%L, 'chart:13000', 'yes', 'entry', %L, '')$q$, :'f2', :'e_other')) = 'The evidence must be a bank line or entry on this file.');
select public.cb_answer_sh_repaid(:'f2', 'chart:13000', 'yes', 'entry', :'e_repay', '');
select test.check('Yes with the evidence: off My day', not exists (select 1 from public.cb_sh_due_list() where file_id = :'f'));
reset role;
reset request.jwt.claims;
select test.check('the evidence is named', (select evidence_label like 'Entry 2027-%Repayment by the shareholder' from public.cb_sh_repaid where file_id = :'f2'));
select test.check('Yes: nothing waits', private.cb_sh_waiting(:'f2') = '{}' and private.cb_sh_problems(:'f2') = '{}');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_answer_sh_repaid(:'f2', 'chart:13000', 'no', null, null, 'Repaid in January 2028, after the date.');
select test.check('No: back on My day, marked for the reviewer', (select answer = 'no' from public.cb_sh_due_list() where file_id = :'f'));
reset role;
reset request.jwt.claims;
select test.check('No goes to the reviewer', private.cb_sh_waiting(:'f2') = array['1 shareholder loan not repaid by the s.15(2) date.']);

-- Settings: the window, owners only.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('staff cannot change the window', test.try('select public.cb_update_sh_window(45)') = 'Only an owner changes thresholds.');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('the window is 1 to 365 days', test.try('select public.cb_update_sh_window(0)') like 'Shareholder loan repayment window%');
select public.cb_update_sh_window(45);
reset role;
reset request.jwt.claims;
select test.check('the window is saved, 30 by default before', (select sh_repay_window_days = 45 from public.cb_settings));

-- A locked file is read-only.
update public.cb_files set phase = 'locked' where id = :'f';
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('locked: no new schedule', test.try(format($q$select public.cb_prepare_sh_schedule(%L, '[]')$q$, :'f')) = 'This file is locked or missing.');
reset role;
reset request.jwt.claims;
select test.check('locked: the tables refuse writes', test.try(format($q$delete from public.cb_sh_schedules where file_id = %L$q$, :'f')) = 'This file is locked. An owner can reopen it.');
