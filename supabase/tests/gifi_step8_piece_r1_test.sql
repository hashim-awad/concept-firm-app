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
  private.cb_match_problems(:'f') @> array['Net income 18,760.00 · GIFI 9999 20,000.00 · Out of balance (1,240.00).']);
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
select test.check('T2: total assets tie fails by 500.00', exists (select 1 from unnest(private.cb_match_problems(:'f')) p where p = 'Total assets 19,260.00 · GIFI 2599 18,760.00 · Out of balance 500.00.'));
select test.check('T2: the wrong-side flag tests the override line', (:items) = '10200:side');
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('T2: step 8 cannot be signed', test.try(format('select public.cb_sign_step(%L, %L, %L)', :'f', 't2', 'prepared')) like '%Total assets 19,260.00 · GIFI 2599%');
select test.check('T2: the export refuses', test.try(format('select public.cb_record_gifi_export(%L, %L, %L, %L, %L::jsonb, %L::jsonb)', :'f', 'final', 'x.gfi', '"GIFI01",x', '{}', :'checks')) like 'Export refused.%Total assets%');
select public.cb_set_gifi_override(:'sav', null);
reset role; reset request.jwt.claims;
select test.check('T2: removed, the ties are met again', private.cb_match_problems(:'f') = '{}');
delete from public.cb_accounts where id = :'sav';
update public.cb_accounts set this_year = 18760 where id = :'chq';

-- ---------- T3: an override clears step 8 (then 9 and 10) only; History names the account and the lines.
:signed;
select private.cb_gifi_fingerprint(:'f') as fp0 \gset
select private.cb_tb_fingerprint(:'f') as tb0 \gset
select array_to_string(private.cb_gst_problems(:'f') || private.cb_sh_review_problems(:'f'), '|') as gs0 \gset
select private.cb_sh_fingerprint(:'f') as sh0 \gset
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_set_gifi_override(:'off', '8811.00');
reset role; reset request.jwt.claims;
select test.check('T3: steps 4, 5, 6 and 7 stay signed; 8 and 9 clear', (:state) = 'code,compare,entries,review');
select test.check('T3: History names the account, old and new line', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'gifi_override'
  and detail = '65100 Office expenses: GIFI 8810 to 8811' and old_value = 'GIFI 8810' and new_value = 'GIFI 8811'));
select test.check('T3: the step 8 clearing gives the same reason', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'signoff_cleared' and step = 't2' and detail = '65100 Office expenses: GIFI 8810 to 8811'));
select test.check('T3: the GIFI export fingerprint changes', private.cb_gifi_fingerprint(:'f') <> :'fp0');
select test.check('T3: the trial balance fingerprint (GST/HST returns, 21500, shareholder loans) does not', private.cb_tb_fingerprint(:'f') = :'tb0');
select test.check('T3: the shareholder loan fingerprint does not change', private.cb_sh_fingerprint(:'f') = :'sh0');
select test.check('T3: GST/HST and shareholder loan checks unchanged', array_to_string(private.cb_gst_problems(:'f') || private.cb_sh_review_problems(:'f'), '|') = :'gs0');
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
-- Piece R2 (item 2, D18): trial balance files take the step 8 override, with R1's rules.
select test.try(format('select public.cb_set_gifi_override(%L, %L)', :'tba', '1001.00')) as tbo \gset
reset role; reset request.jwt.claims;
select test.check('piece R2: a trial balance file takes the step 8 override', :'tbo' = 'OK' and (select gifi_override from public.cb_accounts where id = :'tba') = '1001.00');
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_set_gifi_override(:'tba', null);
select public.cb_send_to_reviewer(:'chq', 'Which line?');
select test.check('the preparer cannot pick for an account waiting for the reviewer', test.try(format('select public.cb_set_gifi_override(%L, %L)', :'chq', '1001.00')) = 'This account waits for the reviewer''s decision.');
reset role; reset request.jwt.claims;
select test.check('the waiting account is in step 8''s box', (:items) = '10100:reviewer');
select test.check('step 7 on a bank file no longer waits for it', not exists (select 1 from unnest(private.cb_review_problems(:'f')) p where p like '%waiting for the reviewer''s decision%'));
update public.cb_accounts set needs_reviewer = true where id = :'tba';
-- Piece R2 (item 3, D18): step 7's GIFI checks moved to step 8 on trial balance files too.
select test.check('piece R2: step 7 on a trial balance file no longer waits for it', not exists (select 1 from unnest(private.cb_review_problems(:'tbf')) p where p like '%waiting for the reviewer''s decision%'));
select test.check('piece R2: step 8 on a trial balance file holds it in the Match box', private.cb_match_problems(:'tbf') @> array['1 account needs a decision in Match accounts to GIFI.']);
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
select test.check('the carried override is in the new file''s History', exists (select 1 from public.cb_file_history where file_id = :'f2' and action = 'gifi_override' and detail = '65100 Office expenses: GIFI 8811 carried from last year'));
select test.check('an account with no override stays without', (select gifi_override from public.cb_accounts where file_id = :'f2' and number = '40100') is null);

-- ---------- Wording (items 4 and 7).
select test.check('step 10: Banking, Code transactions, Adjustments', private.cb_lock_problems(:'f2') @> array['Step 3, Banking: not signed by the reviewer.', 'Step 4, Code transactions: not signed by the reviewer.', 'Step 5, Adjustments: not signed by the reviewer.', 'Step 8, Tax returns: not signed by the reviewer.']);

-- ---------- T4 guard: with no override the export fingerprint is exactly the old one, so no saved GIFI export or shareholder
-- schedule turns stale when the migration runs.
select test.check('no override: the fingerprint is the old one', private.cb_tb_fingerprint(:'tbf') = (select md5(coalesce(string_agg(a.id::text || ':' || coalesce(a.line_no, '') || ':'
  || coalesce(a.tax_code, '') || ':' || private.cb_account_final(a.id)::text, ',' order by a.id), '')) from public.cb_accounts a where a.file_id = :'tbf'));

-- ---------- Accounting review of the build (fixes 1 to 4).
select test.check('fix 1: the reviewer''s pick clears the waiting item from step 8''s box', not exists (select 1 from private.cb_match_items(:'f') i where i.account_id = :'chq'));
update public.cb_accounts set needs_reviewer = true where id = :'off';
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_set_gifi_override(:'off', '8811.00');   -- the reviewer keeps the line it is on
reset role; reset request.jwt.claims;
select test.check('fix 1: saving the same line settles it, with History', not (select needs_reviewer from public.cb_accounts where id = :'off')
  and exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'account_reviewed' and ref_label = '65100 Office expenses'));
update public.cb_accounts set mapping_source = 'suggested' where id = :'off';
select test.check('fix 2: a suggestion shows in the box', exists (select 1 from private.cb_match_items(:'f') i where i.account_id = :'off' and i.reason = 'suggested'));
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_set_gifi_override(:'off', '8811.00');
reset role; reset request.jwt.claims;
insert into public.cb_accounts (file_id, account_key, number, name, line_no, this_year, mapping_source) values (:'f', 'chart:30000', '30000', 'Common shares', '3500.00', 0, 'chart');
select id as shr from public.cb_accounts where file_id = :'f' and number = '30000' \gset
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('fix 4: retained earnings (3600) is refused as an override on an equity account',
  test.try(format('select public.cb_set_gifi_override(%L, %L)', :'shr', '3600.00')) = 'Retained earnings, dividends and prior period adjustments (3600 to 3849) take no override. Use an entry.');
reset role; reset request.jwt.claims;
select test.check('fix 2: saving the line confirms the suggestion', (select mapping_source from public.cb_accounts where id = :'off') = 'preparer'
  and not exists (select 1 from private.cb_match_items(:'f') i where i.account_id = :'off'));
update public.cb_accounts set line_no = '8000.00' where id = :'off';
select test.check('fix 3: a group of another type drops the override, with History', (select gifi_override from public.cb_accounts where id = :'off') is null
  and exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'gifi_override' and detail = '65100 Office expenses: GIFI 8811 dropped, the group changed to another type'));

-- ---------- Accounting recheck: retained earnings stays on its line (no override away from 3600 either).
insert into public.cb_accounts (file_id, account_key, number, name, line_no, this_year, mapping_source) values (:'f', 'chart:31000', '31000', 'Retained earnings', '3600.00', 0, 'chart');
select id as re from public.cb_accounts where file_id = :'f' and number = '31000' \gset
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('retained earnings cannot be moved to another equity line', test.try(format('select public.cb_set_gifi_override(%L, %L)', :'re', '3500.00'))
  = 'Retained earnings, dividends and prior period adjustments (3600 to 3849) take no override. Use an entry.');
reset role; reset request.jwt.claims;
-- An equity account with an override whose group moves to retained earnings drops the override, with History.
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_set_gifi_override(:'shr', '3520.00');
reset role; reset request.jwt.claims;
select test.check('fixture: common shares carry an override', (select gifi_override from public.cb_accounts where id = :'shr') = '3520.00');
update public.cb_accounts set line_no = '3600.00' where id = :'shr';
select test.check('a group moved to retained earnings drops the override, with History', (select gifi_override from public.cb_accounts where id = :'shr') is null
  and exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'gifi_override' and detail = '30000 Common shares: GIFI 3520 dropped, the group is now retained earnings, dividends or a prior period adjustment'));

-- ---------- Hashim (Nov 19): 3600 to 3849 neither take nor give an override; an override equal to the group goes.
update public.cb_accounts set line_no = '3500.00' where id = :'shr';
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('share capital cannot move to prior period adjustments (3720)', test.try(format('select public.cb_set_gifi_override(%L, %L)', :'shr', '3720.00')) = 'Retained earnings, dividends and prior period adjustments (3600 to 3849) take no override. Use an entry.');
select test.check('share capital cannot move to dividends (3700)', test.try(format('select public.cb_set_gifi_override(%L, %L)', :'shr', '3700.00')) = 'Retained earnings, dividends and prior period adjustments (3600 to 3849) take no override. Use an entry.');
select public.cb_set_gifi_override(:'shr', '3520.00');
reset role; reset request.jwt.claims;
update public.cb_accounts set line_no = '3520.00' where id = :'shr';
select test.check('an override equal to the new group goes, with History', (select gifi_override from public.cb_accounts where id = :'shr') is null
  and exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'gifi_override' and detail = '30000 Common shares: GIFI 3520 dropped, it is now the group'));
select test.check('no override: the GIFI fingerprint is the trial balance one', private.cb_gifi_fingerprint(:'tbf') = private.cb_tb_fingerprint(:'tbf'));

-- ---------- Roll forward: from the year just before only, never onto or from 3600 to 3849.
insert into public.cb_accounts (file_id, account_key, number, name, line_no, this_year, mapping_source, gifi_override)
  values (:'f2', 'chart:31000', '31000', 'Retained earnings', '3500.00', 0, 'chart', '3520.00');   -- direct fixture: an equity override on last year's file
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_create_file(:'client', '2028-08-31', '2027-09-01', '', 'full', 'statements', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a') as f4 \gset
select public.cb_create_file(:'client', '2030-08-31', '2029-09-01', '', 'full', 'statements', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a') as f5 \gset
reset role; reset request.jwt.claims;
insert into public.cb_accounts (file_id, account_key, number, name, line_no, this_year, mapping_source) values
  (:'f4', 'chart:65100', '65100', 'Office expenses', '8810.00', 0, 'chart'), (:'f4', 'chart:31000', '31000', 'Retained earnings', '3600.00', 0, 'chart');
select test.check('roll forward: the year just before carries the override', (select gifi_override from public.cb_accounts where file_id = :'f4' and number = '65100') = '8811.00');
select test.check('roll forward: nothing lands on retained earnings (3600 to 3849)', (select gifi_override from public.cb_accounts where file_id = :'f4' and number = '31000') is null);
insert into public.cb_accounts (file_id, account_key, number, name, line_no, this_year, mapping_source) values (:'f5', 'chart:65100', '65100', 'Office expenses', '8810.00', 0, 'chart');
select test.check('roll forward: a gap year carries nothing', (select gifi_override from public.cb_accounts where file_id = :'f5' and number = '65100') is null);
