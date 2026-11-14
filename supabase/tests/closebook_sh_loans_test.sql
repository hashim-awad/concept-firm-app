-- Local tests: round 14 (Hashim, Nov 14, 2026), the shareholder loan schedule on step 5: prepared with
-- the books' fingerprint, tied to the trial balance, each shareholder's accounts tested together, the
-- debit split by when it arose (last year's part to the reviewer, this year's part with its s.15(2) date
-- on My day), next year's "Repaid by" confirmed from the postings, the picks, the window setting and the lock.
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
insert into public.clients (kind, legal_name, province) values ('corporation', 'Elm Test Realty Inc.', 'ON') returning id as client2 \gset
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_create_file(:'client', '2026-12-31', '2026-01-01', '', 'full', 'statements', '00000000-0000-0000-0000-00000000000c'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid) as f \gset
select public.cb_create_file(:'client', '2027-12-31', '2027-01-01', '', 'full', 'statements', '00000000-0000-0000-0000-00000000000c'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid) as f2 \gset
select public.cb_create_file(:'client2', '2026-12-31', '2026-01-01', '', 'full', 'client_software', '00000000-0000-0000-0000-00000000000c'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid) as own \gset
select public.cb_create_file(:'client2', '2027-12-31', '2027-01-01', '', 'full', 'client_software', '00000000-0000-0000-0000-00000000000c'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid) as own2 \gset
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
-- Opening 5,000.00 owed by the shareholder; 1,000.00 repaid; 4,000.00 new advances: 8,000.00 at year end.
select public.cb_build_tb(:'f', '[{"key":"chart:23000","number":"23000","name":"Due to shareholder 1","line_no":"2781.10","amount":8000,"last":5000,"reviewer":""},
  {"key":"chart:10000","number":"10000","name":"Chequing","line_no":"1002.00","amount":-8000,"last":-5000,"reviewer":""}]');
reset role;
reset request.jwt.claims;
select test.check('a file with a shareholder account has a schedule', private.cb_sh_applies(:'f'));
select test.check('step 5 waits for the schedule', private.cb_sh_problems(:'f') = array['Shareholder loan schedule: prepare it.']);

set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
\set rows '[{"account_key":"chart:23000","number":"23000","name":"Due to shareholder 1","line_no":"2781.10","opening":5000,"closing":8000,"tb":8000,"shareholder":1,"owner_source":"chart"}]'
select test.check('this year''s part is dated one year after the year end', test.try(format($q$select public.cb_prepare_sh_schedule(%L, %L, '[{"group_key":"sh:1","shareholder":1,"accounts":["chart:23000"],"opening":5000,"closing":8000,"last_part":4000,"this_part":4000,"due_on":"2027-06-30","flags":["earlier_debit"]}]')$q$, :'f', :'rows'))
  = 'The s.15(2) date of this year''s part is one year after the year end.');
select test.check('the two parts add up to the debit at year end', test.try(format($q$select public.cb_prepare_sh_schedule(%L, %L, '[{"group_key":"sh:1","shareholder":1,"accounts":["chart:23000"],"opening":5000,"closing":8000,"last_part":4000,"this_part":3000,"due_on":"2027-12-31","flags":["earlier_debit"]}]')$q$, :'f', :'rows'))
  = 'Last year''s part and this year''s part add up to the balance owed at year end.');
select public.cb_prepare_sh_schedule(:'f', :'rows', '[{"group_key":"sh:1","shareholder":1,"accounts":["chart:23000"],"opening":5000,"closing":8000,"reductions":1000,"last_part":4000,"this_part":4000,"due_on":"2027-12-31",
  "prior_due_on":"2026-12-31","prior_opening":5000,"prior_repaid":1000,"prior_unpaid":4000,"flags":["earlier_debit"],"flag_amounts":{"earlier_debit":4000}}]');
reset role;
reset request.jwt.claims;
select test.check('prepared: last year''s part waits for an answer, and "Repaid by" for the confirmation', private.cb_sh_problems(:'f') = array[
  'Shareholder loan schedule: answer 1 flag for the reviewer.', 'Shareholder loan schedule: confirm "Repaid by" for 1 shareholder.']);
select test.check('the flag carries last year''s part', (select closing = 4000 from public.cb_sh_flags where file_id = :'f' and account_key = 'sh:1'));

set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_answer_sh_flag(:'f', 'sh:1', 'earlier_debit', '4,000.00 owed since 2025. The shareholder says it will be repaid in March.');
select public.cb_confirm_sh_repaid(:'f', 'sh:1');
select test.check('the preparer cannot accept a flag', test.try(format($q$select public.cb_accept_sh_flag(%L, 'sh:1', 'earlier_debit', 'ok then')$q$, :'f')) like 'Only the reviewer accepts%');
reset role;
reset request.jwt.claims;
select test.check('confirmed as worked out: 1,000.00 repaid, 4,000.00 not', (select repaid = 1000 and unpaid = 4000 and due_on = '2026-12-31' from public.cb_sh_repaid where file_id = :'f'));
select test.check('answered and confirmed: nothing open for the preparer', private.cb_sh_problems(:'f') = '{}');
select test.check('last year''s part waits for the reviewer', private.cb_sh_waiting(:'f') = array['1 shareholder loan flag for the reviewer.']);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_accept_sh_flag(:'f', 'sh:1', 'earlier_debit', 'Include 4,000.00 in the shareholder''s 2025 income.');
reset role;
reset request.jwt.claims;
select test.check('accepted: nothing waits', private.cb_sh_waiting(:'f') = '{}');

-- A changed figure needs the confirmation again; the books changing needs the schedule again.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_prepare_sh_schedule(:'f', :'rows', '[{"group_key":"sh:1","shareholder":1,"accounts":["chart:23000"],"opening":5000,"closing":8000,"reductions":1500,"last_part":3500,"this_part":4500,"due_on":"2027-12-31",
  "prior_due_on":"2026-12-31","prior_opening":5000,"prior_repaid":1500,"prior_unpaid":3500,"flags":["earlier_debit"],"flag_amounts":{"earlier_debit":3500}}]');
reset role;
reset request.jwt.claims;
select test.check('a changed split: the flag and the confirmation again', private.cb_sh_problems(:'f') = array[
  'Shareholder loan schedule: answer 1 flag for the reviewer.', 'Shareholder loan schedule: confirm "Repaid by" for 1 shareholder.']);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_build_tb(:'f', '[{"key":"chart:23000","number":"23000","name":"Due to shareholder 1","line_no":"2781.10","amount":9000,"last":5000,"reviewer":""},
  {"key":"chart:10000","number":"10000","name":"Chequing","line_no":"1002.00","amount":-9000,"last":-5000,"reviewer":""}]');
select test.check('the books changed: no confirming until it is prepared again', test.try(format($q$select public.cb_confirm_sh_repaid(%L, 'sh:1')$q$, :'f')) like 'The books changed%');
reset role;
reset request.jwt.claims;
select test.check('the books changed: prepare again', private.cb_sh_problems(:'f') = array['Shareholder loan schedule: the books changed after it was prepared. Prepare it again.']);

-- Back to the 8,000.00 split 4,000.00 / 4,000.00, answered and confirmed.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_build_tb(:'f', '[{"key":"chart:23000","number":"23000","name":"Due to shareholder 1","line_no":"2781.10","amount":8000,"last":5000,"reviewer":""},
  {"key":"chart:10000","number":"10000","name":"Chequing","line_no":"1002.00","amount":-8000,"last":-5000,"reviewer":""}]');
select public.cb_prepare_sh_schedule(:'f', :'rows', '[{"group_key":"sh:1","shareholder":1,"accounts":["chart:23000"],"opening":5000,"closing":8000,"reductions":1000,"last_part":4000,"this_part":4000,"due_on":"2027-12-31",
  "prior_due_on":"2026-12-31","prior_opening":5000,"prior_repaid":1000,"prior_unpaid":4000,"flags":["earlier_debit"],"flag_amounts":{"earlier_debit":4000}}]');
select public.cb_answer_sh_flag(:'f', 'sh:1', 'earlier_debit', '4,000.00 owed since 2025.');
select public.cb_confirm_sh_repaid(:'f', 'sh:1');

-- My day: this year's part only, until the next file confirms it was repaid in full.
select test.check('the preparer sees this year''s part and its date', (select amount = 4000 and due_on = '2027-12-31' and shareholder = 1 and next_file = :'f2' and unpaid is null and accounts = '23000 Due to shareholder 1'
  from public.cb_sh_due_list() where file_id = :'f'));
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000d"}';
select test.check('another preparer does not', not exists (select 1 from public.cb_sh_due_list()));
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('an owner does', exists (select 1 from public.cb_sh_due_list() where file_id = :'f'));

-- Next year: 8,000.00 owed at the start (on the pair, 13000); 4,000.00 repaid in the year.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_build_tb(:'f2', '[{"key":"chart:13000","number":"13000","name":"Due from shareholder 1","line_no":"1301.10","amount":4000,"last":8000,"reviewer":""},
  {"key":"chart:10000","number":"10000","name":"Chequing","line_no":"1002.00","amount":-4000,"last":-8000,"reviewer":""}]');
select public.cb_prepare_sh_schedule(:'f2', '[{"account_key":"chart:13000","number":"13000","name":"Due from shareholder 1","line_no":"1301.10","opening":8000,"closing":4000,"tb":4000,"shareholder":1,"owner_source":"chart"}]',
  '[{"group_key":"sh:1","shareholder":1,"accounts":["chart:13000"],"opening":8000,"closing":4000,"reductions":4000,"last_part":4000,"this_part":0,"due_on":"",
    "prior_due_on":"2027-12-31","prior_opening":8000,"prior_repaid":4000,"prior_unpaid":4000,"flags":["earlier_debit"],"flag_amounts":{"earlier_debit":4000}}]');
select public.cb_confirm_sh_repaid(:'f2', 'sh:1');
select test.check('repaid in part: on My day with what is unpaid', (select unpaid = 4000 from public.cb_sh_due_list() where file_id = :'f'));
select public.cb_build_tb(:'f2', '[{"key":"chart:13000","number":"13000","name":"Due from shareholder 1","line_no":"1301.10","amount":0,"last":8000,"reviewer":""},
  {"key":"chart:10000","number":"10000","name":"Chequing","line_no":"1002.00","amount":0,"last":-8000,"reviewer":""}]');
select public.cb_prepare_sh_schedule(:'f2', '[{"account_key":"chart:13000","number":"13000","name":"Due from shareholder 1","line_no":"1301.10","opening":8000,"closing":0,"tb":0,"shareholder":1,"owner_source":"chart"}]',
  '[{"group_key":"sh:1","shareholder":1,"accounts":["chart:13000"],"opening":8000,"closing":0,"reductions":8000,"last_part":0,"this_part":0,"due_on":"",
    "prior_due_on":"2027-12-31","prior_opening":8000,"prior_repaid":8000,"prior_unpaid":0,"flags":[]}]');
reset role;
select test.check('re-prepared with new figures: the confirmation is asked again', 'Shareholder loan schedule: confirm "Repaid by" for 1 shareholder.' = any (private.cb_sh_problems(:'f2')));
set role authenticated;
select public.cb_confirm_sh_repaid(:'f2', 'sh:1');
select test.check('repaid in full: off My day', not exists (select 1 from public.cb_sh_due_list() where file_id = :'f'));
select test.check('no flag left on the next file', not exists (select 1 from public.cb_sh_flags where file_id = :'f2'));

-- Own books: the preparer picks the shareholder; the pick rolls forward.
reset role;
reset request.jwt.claims;
insert into public.cb_accounts (file_id, account_key, number, name, line_no, this_year, last_year)
  values (:'own', '2600', '2600', 'Shareholder loan', '2781.00', -1500, -1000), (:'own2', '2600', '2600', 'Shareholder loan', '2781.00', -1200, -1500);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_prepare_sh_schedule(:'own', '[{"account_key":"2600","number":"2600","name":"Shareholder loan","line_no":"2781.00","opening":-1000,"closing":-1500,"tb":-1500,"shareholder":"","owner_source":"none"}]',
  '[{"group_key":"none:2600","shareholder":"","accounts":["2600"],"opening":-1000,"closing":-1500,"last_part":0,"this_part":0,"due_on":"","flags":[]}]');
reset role;
reset request.jwt.claims;
select test.check('own books: the shareholder must be picked', private.cb_sh_problems(:'own') = array['Shareholder loan schedule: pick the shareholder for 1 account.']);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('the standard chart''s accounts are not picked', test.try(format($q$select public.cb_set_sh_owner(%L, 'chart:23000', 2)$q$, :'own')) = 'The standard chart sets this account''s shareholder.');
select test.check('only accounts on a shareholder line', test.try(format($q$select public.cb_set_sh_owner(%L, 'nope', 2)$q$, :'own')) = 'That account is not on a shareholder line.');
select public.cb_set_sh_owner(:'own', '2600', 2);
reset role;
reset request.jwt.claims;
select test.check('a pick changes the books the schedule rests on', private.cb_sh_problems(:'own') = array['Shareholder loan schedule: the books changed after it was prepared. Prepare it again.']);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_prepare_sh_schedule(:'own', '[{"account_key":"2600","number":"2600","name":"Shareholder loan","line_no":"2781.00","opening":-1000,"closing":-1500,"tb":-1500,"shareholder":2,"owner_source":"picked"}]',
  '[{"group_key":"sh:2","shareholder":2,"accounts":["2600"],"opening":-1000,"closing":-1500,"last_part":0,"this_part":0,"due_on":"","flags":[]}]');
-- Next year the app reads the pick from this file and prepares with it as "rolled"; the database keeps it there too.
select public.cb_prepare_sh_schedule(:'own2', '[{"account_key":"2600","number":"2600","name":"Shareholder loan","line_no":"2781.00","opening":-1500,"closing":-1200,"tb":-1200,"shareholder":2,"owner_source":"rolled"}]',
  '[{"group_key":"sh:2","shareholder":2,"accounts":["2600"],"opening":-1500,"closing":-1200,"last_part":0,"this_part":0,"due_on":"","flags":[]}]');
reset role;
reset request.jwt.claims;
select test.check('own books: picked, nothing open', private.cb_sh_problems(:'own') = '{}');
select test.check('the pick rolled forward is kept on next year''s file', (select shareholder = 2 and source = 'rolled' from public.cb_sh_owners where file_id = :'own2' and account_key = '2600'));
select test.check('next year: nothing open', private.cb_sh_problems(:'own2') = '{}');

-- Settings: the window, owners only.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('staff cannot change the window', test.try('select public.cb_update_sh_window(45)') = 'Only an owner changes thresholds.');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('the window is 1 to 365 days', test.try('select public.cb_update_sh_window(0)') like 'Shareholder loan repayment window%');
select public.cb_update_sh_window(45);
reset role;
reset request.jwt.claims;
select test.check('the window is saved', (select sh_repay_window_days = 45 from public.cb_settings));

-- A locked file is read-only.
update public.cb_files set phase = 'locked' where id = :'f';
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('locked: no new schedule', test.try(format($q$select public.cb_prepare_sh_schedule(%L, '[]', '[]')$q$, :'f')) = 'This file is locked or missing.');
select test.check('locked: no confirming', test.try(format($q$select public.cb_confirm_sh_repaid(%L, 'sh:1')$q$, :'f')) = 'This file is locked or missing.');
reset role;
reset request.jwt.claims;
select test.check('locked: the tables refuse writes', test.try(format($q$delete from public.cb_sh_groups where file_id = %L$q$, :'f')) = 'This file is locked. An owner can reopen it.');
