-- Local tests: piece R1 (Hashim, Nov 19, 2026, version 2): GIFI in one place, step 8 "Match accounts to GIFI".
-- T1 the box and the gate on a bank-statement file; T2 the ties and an override that breaks one; T3 an override clears step 8
-- only, with History; the refusals (another type, system rows, trial balance files, the reviewer's accounts, locked lines);
-- step 7 on bank files; the fingerprint; the roll forward; the wording. Dummy data only.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'), ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test', (select id from public.roles where name = 'Staff'));
reset role; reset request.jwt.claims;
update public.role_permissions set level = 'edit' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Staff');
insert into public.clients (kind, legal_name, province) values ('corporation', 'Aspen Dummy Match Inc.', 'ON') returning id as client \gset
insert into public.clients (kind, legal_name, province) values ('corporation', 'Cedar Dummy Import Inc.', 'ON') returning id as client2 \gset

set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_create_file(:'client', '2026-08-31', '2025-09-01', '', 'full', 'statements', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a') as f \gset
select public.cb_create_file(:'client2', '2026-08-31', '2025-09-01', '', 'full', 'client_software', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a') as tbf \gset
reset role; reset request.jwt.claims;
-- A bank-statement file built from the standard chart (dummy figures), and one account added with no line (68500).
insert into public.cb_accounts (file_id, account_key, number, name, line_no, this_year, mapping_source) values
  (:'f', 'chart:10100', '10100', 'Chequing', '1002.00', 18760, 'chart'),
  (:'f', 'chart:40100', '40100', 'Commission income', '8000.00', -50000, 'chart'),
  (:'f', 'chart:65100', '65100', 'Office expenses', '8810.00', 10000, 'chart'),
  (:'f', 'chart:60000', '60000', 'Advertising dummy', '8521.00', 20000, 'chart'),
  (:'f', 'chart:68500', '68500', 'Dummy added account', null, 1240, null),
  (:'f', 'chart:10900', '10900', 'Clearing', null, 0, null);
update public.cb_accounts set account_type = 'Expense' where file_id = :'f' and number = '68500';
select id as chq from public.cb_accounts where file_id = :'f' and number = '10100' \gset
select id as off from public.cb_accounts where file_id = :'f' and number = '65100' \gset
select id as dum from public.cb_accounts where file_id = :'f' and number = '68500' \gset
select id as clr from public.cb_accounts where file_id = :'f' and number = '10900' \gset

\set items 'select coalesce(string_agg(a.number || '':'' || i.reason, '','' order by a.number), ''none'') from private.cb_match_items(:''f'') i join public.cb_accounts a on a.id = i.account_id'
\set state 'select coalesce(string_agg(step, \',\' order by step), \'none\') from public.cb_step_signoffs where file_id = :''f'' and (prepared_at is not null or reviewed_at is not null)'
\set signed 'insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at, reviewed_by, reviewed_at) select :''f'', s, ''00000000-0000-0000-0000-00000000000c'', now(), ''00000000-0000-0000-0000-00000000000a'', now() from unnest(array[''code'', ''entries'', ''compare'', ''review'', ''t2'', ''statements'']) s on conflict (file_id, step) do update set prepared_at = excluded.prepared_at, reviewed_at = excluded.reviewed_at'
\set checks '[{"title":"a","ok":true},{"title":"b","ok":true},{"title":"c","ok":true},{"title":"d","ok":true},{"title":"e","ok":true}]'

-- ---------- T1: every standard chart account counts as matched; the added account with no line is the only box item.
select test.check('T1: only the added account with no group is in the box', (:items) = '68500:no_group');
select test.check('T1: step 8 waits for it', private.cb_step8_problems(:'f') @> array['1 account needs a decision in Match accounts to GIFI.']);
select test.check('T1: and the net income tie shows the difference (no group counts on the chart side)',
  private.cb_match_problems(:'f') @> array['Net income 18,760.00 does not equal GIFI 9999 20,000.00: a difference of (1,240.00).']);
select test.check('T1: total assets tie', (private.cb_match_ties(:'f') ->> 'assets_chart')::numeric = 18760 and (private.cb_match_ties(:'f') ->> 'assets_gifi')::numeric = 18760);
select test.check('T1: step 6 says "no group"', private.cb_step_problems(:'f', 'compare') @> array['1 account with no group: choose a group.']);
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('T1: the GIFI export refuses', test.try(format('select public.cb_record_gifi_export(%L, %L, %L, %L, %L::jsonb, %L::jsonb)', :'f', 'final', 'x.gfi', '"GIFI01",x', '{}', :'checks')) like 'Export refused.%');
select test.check('T1: no override on an account with no group', test.try(format('select public.cb_set_gifi_override(%L, %L)', :'dum', '8810.00')) = 'Choose a group for the account first.');
select test.check('T1: step 8 cannot be signed', test.try(format('select public.cb_sign_step(%L, %L, %L)', :'f', 't2', 'prepared')) like 'Not yet:%1 account needs a decision in Match accounts to GIFI.%');
-- "Choose a group" (the existing Change window) writes the group.
select public.cb_map_account(:'dum', '9270.00');
reset role; reset request.jwt.claims;
select test.check('T1: matched, the box is empty and the ties are met', (:items) = 'none' and private.cb_match_problems(:'f') = '{}');

-- ---------- T2: an override that breaks a tie. A savings account overdrawn by 500.00 reports as a bank overdraft (pair 2600)
-- on the chart side; moved to an asset line with no pair, GIFI 2599 counts -500.00.
insert into public.cb_accounts (file_id, account_key, number, name, line_no, this_year, mapping_source) values (:'f', 'chart:10200', '10200', 'Savings dummy', '1002.00', -500, 'chart');
update public.cb_accounts set this_year = 19260 where id = :'chq';
select id as sav from public.cb_accounts where file_id = :'f' and number = '10200' \gset
select test.check('T2: before the override the ties are met', private.cb_match_problems(:'f') = '{}');
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_set_gifi_override(:'sav', '1060.00');
reset role; reset request.jwt.claims;
select test.check('T2: total assets tie fails by 500.00', exists (select 1 from unnest(private.cb_match_problems(:'f')) p where p = 'Total assets 19,260.00 do not equal GIFI 2599 18,760.00: a difference of 500.00.'));
select test.check('T2: the wrong-side flag tests the override line', (:items) = '10200:side');
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('T2: step 8 cannot be signed', test.try(format('select public.cb_sign_step(%L, %L, %L)', :'f', 't2', 'prepared')) like '%Total assets 19,260.00 do not equal GIFI 2599%');
select test.check('T2: the export refuses', test.try(format('select public.cb_record_gifi_export(%L, %L, %L, %L, %L::jsonb, %L::jsonb)', :'f', 'final', 'x.gfi', '"GIFI01",x', '{}', :'checks')) like 'Export refused.%Total assets%');
select public.cb_set_gifi_override(:'sav', null);
reset role; reset request.jwt.claims;
select test.check('T2: removed, the ties are met again', private.cb_match_problems(:'f') = '{}');
delete from public.cb_accounts where id = :'sav';
update public.cb_accounts set this_year = 18760 where id = :'chq';

-- ---------- T3: an override clears step 8 (then 9 and 10) only; History names the account and the lines.
:signed;
select private.cb_tb_fingerprint(:'f') as fp0 \gset
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_set_gifi_override(:'off', '8811.00');
reset role; reset request.jwt.claims;
select test.check('T3: steps 4, 5, 6 and 7 stay signed; 8 and 9 clear', (:state) = 'code,compare,entries,review');
select test.check('T3: History names the account, old and new line', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'gifi_override'
  and detail = '65100 Office expenses: GIFI 8810 to 8811' and old_value = 'GIFI 8810' and new_value = 'GIFI 8811'));
select test.check('T3: the step 8 clearing gives the same reason', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'signoff_cleared' and step = 't2' and detail = '65100 Office expenses: GIFI 8810 to 8811'));
select test.check('T3: the export fingerprint changes', private.cb_tb_fingerprint(:'f') <> :'fp0');
select test.check('T3: the group is unchanged', (select line_no from public.cb_accounts where id = :'off') = '8810.00');
:signed;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_set_gifi_override(:'off', '8811.00');
reset role; reset request.jwt.claims;
select test.check('T3: the same line again changes nothing', (:state) = 'code,compare,entries,review,statements,t2');

-- ---------- Refusals.
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('another account type is refused', test.try(format('select public.cb_set_gifi_override(%L, %L)', :'off', '8000.00')) like 'This is a GIFI line for revenue. The account''s group is for expense%');
select test.check('Clearing takes no GIFI line', test.try(format('select public.cb_set_gifi_override(%L, %L)', :'clr', '1002.00')) like 'Clearing and the system rows take no GIFI line.%');
select test.check('a locked line is refused', test.try(format('select public.cb_set_gifi_override(%L, %L)', :'chq', '1301.00')) like 'This line is locked%');
reset role; reset request.jwt.claims;
insert into public.cb_accounts (file_id, account_key, number, name, line_no, this_year, mapping_source) values (:'tbf', 'acc1', '1000', 'Bank TB', '1002.00', 100, 'preparer');
select id as tba from public.cb_accounts where file_id = :'tbf' and number = '1000' \gset
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('trial balance files match in step 4', test.try(format('select public.cb_set_gifi_override(%L, %L)', :'tba', '1001.00')) = 'On this file, match accounts to GIFI in step 4.');
select public.cb_send_to_reviewer(:'chq', 'Which line?');
select test.check('the preparer cannot pick for an account waiting for the reviewer', test.try(format('select public.cb_set_gifi_override(%L, %L)', :'chq', '1001.00')) = 'This account waits for the reviewer''s decision.');
reset role; reset request.jwt.claims;
select test.check('the waiting account is in step 8''s box', (:items) = '10100:reviewer');
select test.check('step 7 on a bank file no longer waits for it', not exists (select 1 from unnest(private.cb_review_problems(:'f')) p where p like '%waiting for the reviewer''s decision%'));
update public.cb_accounts set needs_reviewer = true where id = :'tba';
select test.check('step 7 on a trial balance file still waits for it', private.cb_review_problems(:'tbf') @> array['1 account waiting for the reviewer''s decision.']);
select test.check('trial balance files have no Match box', private.cb_match_problems(:'tbf') = '{}');
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_set_gifi_override(:'chq', '1001.00');
reset role; reset request.jwt.claims;
select test.check('the reviewer can pick', (select gifi_override from public.cb_accounts where id = :'chq') = '1001.00');

-- ---------- Roll forward to the next bank-statement file.
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_create_file(:'client', '2027-08-31', '2026-09-01', '', 'full', 'statements', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a') as f2 \gset
reset role; reset request.jwt.claims;
insert into public.cb_accounts (file_id, account_key, number, name, line_no, this_year, mapping_source) values
  (:'f2', 'chart:65100', '65100', 'Office expenses', '8810.00', 0, 'chart'), (:'f2', 'chart:40100', '40100', 'Commission income', '8000.00', 0, 'chart');
select test.check('the override rolls forward with the account', (select gifi_override from public.cb_accounts where file_id = :'f2' and number = '65100') = '8811.00');
select test.check('an account with no override stays without', (select gifi_override from public.cb_accounts where file_id = :'f2' and number = '40100') is null);

-- ---------- Wording (items 4 and 7).
select test.check('step 10: Banking, Code transactions, Adjustments', private.cb_lock_problems(:'f2') @> array['Step 3, Banking: not signed by the reviewer.', 'Step 4, Code transactions: not signed by the reviewer.', 'Step 5, Adjustments: not signed by the reviewer.', 'Step 8, Tax returns: not signed by the reviewer.']);
