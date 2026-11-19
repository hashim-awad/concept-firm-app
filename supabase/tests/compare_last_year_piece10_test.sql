-- Local tests: piece 10 (Hashim, Nov 19, 2026, version 2): step 6 becomes "Compare to last year" (key 'compare'; 'mapping'
-- retired). T1 to T10 of the spec, plus Hashim's two additions: a GIFI line, tax code or type change clears step 4 on a trial
-- balance file; the owner's decision on an account sent to the reviewer clears nothing. Dummy data only.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'), ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test', (select id from public.roles where name = 'Staff'));
reset role; reset request.jwt.claims;
update public.role_permissions set level = 'edit' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Staff');
insert into public.clients (kind, legal_name, province) values ('corporation', 'Birch Dummy Design Inc.', 'ON') returning id as client \gset

-- A trial balance file (dummy figures, mock L).
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_create_file(:'client', '2026-08-31', '2025-09-01', '', 'full', 'client_software', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a') as f \gset
select public.cb_import_tb(:'f', 'this_year', 'client_software', 'tb.csv', '[
  {"number":"10100","name":"Chequing","amount":145000},{"number":"40100","name":"Commission income","amount":-300000},
  {"number":"70600","name":"Vehicle expenses","amount":7345.13},{"number":"65100","name":"Office expenses","amount":6700},
  {"number":"67300","name":"Vehicle lease","amount":2400},{"number":"60000","name":"Wages","amount":138554.87}]');
select public.cb_map_account(id, case number when '10100' then '1002.00' when '40100' then '8000.00' when '70600' then '9281.00' when '65100' then '8810.00'
  when '67300' then '8915.00' else '9060.00' end) from public.cb_accounts where file_id = :'f';
reset role; reset request.jwt.claims;
-- An account with no balance this year is not imported: the client's books still hold it (dummy fixture), as Clearing.
insert into public.cb_accounts (file_id, account_key, number, name, line_no, this_year, last_year, mapping_source)
values (:'f', '62000', '62000', 'Insurance', '8690.00', 0, 500, 'preparer');
update public.cb_accounts set last_year = case number when '10100' then 125000 when '40100' then -215000 when '70600' then 1900 when '65100' then 400
  when '60000' then 93200 when '62000' then 500 else 0 end where file_id = :'f';
select id as chq from public.cb_accounts where file_id = :'f' and number = '10100' \gset
select id as rev from public.cb_accounts where file_id = :'f' and number = '40100' \gset
select id as veh from public.cb_accounts where file_id = :'f' and number = '70600' \gset
select id as off from public.cb_accounts where file_id = :'f' and number = '65100' \gset
select id as wag from public.cb_accounts where file_id = :'f' and number = '60000' \gset

\set p6 'select coalesce(string_agg(p, \' | \'), \'none\') from unnest(private.cb_step_problems(:''f'', ''compare'')) p'
\set state 'select coalesce(string_agg(step, \',\' order by step), \'none\') from public.cb_step_signoffs where file_id = :''f'' and step in (''code'', ''entries'', ''compare'', ''review'', ''t2'') and (prepared_at is not null or reviewed_at is not null)'
\set signed 'insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at) select :''f'', s, ''00000000-0000-0000-0000-00000000000c'', now() from unnest(array[''code'', ''entries'', ''compare'', ''review'', ''t2'']) s on conflict (file_id, step) do update set prepared_at = excluded.prepared_at, prepared_by = excluded.prepared_by'

-- T2: the flagged changes listed in step 6 are the flags the lead sheets showed before this piece (the old step 5 rule, run here).
select count(*) as old_flags from (
  select a.id, private.cb_account_final(a.id) fin, a.last_year from public.cb_accounts a join public.cb_master_lines m on m.line_no = a.line_no
   where a.file_id = :'f' and m.lead_sheet is not null and left(coalesce(a.line_no, ''), 4) not in ('3600', '3660')
     and coalesce(a.tax_code, m.default_tax_code, '') not in ('INCTAX', 'AMORT')) x
 where abs(fin - last_year) > 5000 and (last_year = 0 or abs(fin - last_year) / abs(last_year) * 100 > 20) \gset
select test.check('T2: the same flags as before the piece (Commission income, Vehicle, Office, Wages: 4)', :old_flags = 4
  and (:p6) like '4 flagged changes to explain in Flagged changes.%');
select test.check('T2: an unexplained flag blocks step 6, not step 5', not exists (select 1 from unnest(private.cb_step_problems(:'f', 'entries')) p where p like '%flagged%'));
select test.check('step 6 lists every open item', (:p6) = '4 flagged changes to explain in Flagged changes. | 1 new account to confirm. | Accounts not used this year: tick Seen. | What changed this year: 6 questions to answer.');
select test.check('the two account lists (Vehicle lease new; Insurance not used)', (select string_agg(kind || ':' || account_key, ',' order by kind) from private.cb_compare_accounts(:'f')) = 'new:67300,unused:62000');

-- T1: the keys. Step 6 is signed only with the new key; the old key is refused.
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('T1: the old key is refused', test.try(format('select public.cb_sign_step(%L, %L, %L)', :'f', 'mapping', 'prepared')) = 'Unknown step.');
select test.check('T1: step 6 cannot be signed with open items', test.try(format('select public.cb_sign_step(%L, %L, %L)', :'f', 'compare', 'prepared')) like 'Not yet: 4 flagged changes%');
-- The preparer's work: explanations, the new account, Seen, the six answers.
select public.cb_explain_flag(:'rev', 'revenue_grew', 'More deals closed in spring');
select public.cb_explain_flag(:'veh', 'one_time', 'Vehicle schedule, first year');
select public.cb_explain_flag(:'off', 'other', 'New office set up in May');
select public.cb_explain_flag(:'wag', 'other', 'Second assistant hired');
-- T4: a new account is confirmed before step 6 is signed.
select test.check('T4: the new account still holds step 6', test.try(format('select public.cb_sign_step(%L, %L, %L)', :'f', 'compare', 'prepared')) like 'Not yet: 1 new account to confirm.%');
select public.cb_confirm_new_account(:'f', '67300', true);
select public.cb_seen_unused(:'f', true);
-- T9: a "yes" without a note is refused.
select test.check('T9: a "yes" without a note is refused', test.try(format('select public.cb_answer_year_change(%L, %L, true, %L)', :'f', 'loans', ' ')) = 'A "yes" needs a short note.');
select public.cb_answer_year_change(:'f', q, false, '') from unnest(array['assets', 'shareholders', 'related', 'revenue', 'equity']) q;
select public.cb_answer_year_change(:'f', 'loans', true, 'Car loan repaid in March');
reset role; reset request.jwt.claims;
select test.check('step 6 is clear', (:p6) = 'none');
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_sign_step(:'f', 'compare', 'prepared');
reset role; reset request.jwt.claims;
select test.check('T1: signed with the new key', exists (select 1 from public.cb_step_signoffs where file_id = :'f' and step = 'compare' and prepared_at is not null));
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('T1: the status reports step 6 as compare, with no mapping', (select (s ? 'compare') and not (s ? 'mapping') and s -> 'compare' ->> 'prepared_at' is not null from (select public.cb_step_status(:'f') s) x));
select public.cb_sign_step(:'f', 'compare', 'reviewed');
reset role; reset request.jwt.claims;
select test.check('T1: reviewed with the new key', exists (select 1 from public.cb_step_signoffs where file_id = :'f' and step = 'compare' and reviewed_at is not null));

-- T9: the "yes" shows in step 7 and waits there until the reviewer marks it reviewed. T4: the new account too.
select test.check('T9/T4: step 7 waits on the new account and the "yes"', private.cb_review_problems(:'f') @> array['New accounts this year: 1 to mark reviewed.', 'What changed this year: 1 "yes" answer to mark reviewed.']);
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('T4: only the reviewer marks it reviewed', test.try(format('select public.cb_review_new_account(%L, %L, true)', :'f', '67300')) = 'Only the reviewer marks it reviewed. Reviewers are owners.');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_review_new_account(:'f', '67300', true);
select public.cb_review_year_change(:'f', 'loans', true);
reset role; reset request.jwt.claims;
select test.check('T4/T9: marked reviewed: nothing of them waits in step 7', not exists (select 1 from unnest(private.cb_review_problems(:'f')) p where p like 'New accounts%' or p like 'What changed%'));
select test.check('marking reviewed kept step 6 signed', (:state) = 'compare');

-- T3: changing an explanation clears step 6 and step 7, not step 5 or step 8.
:signed;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_explain_flag(:'off', 'other', 'New office set up in May, see lease');
reset role; reset request.jwt.claims;
select test.check('T3: an explanation clears steps 6 and 7 only', (:state) = 'code,entries,t2');
select test.check('T3: History says why', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'signoff_cleared' and step = 'compare' and detail like 'Lead sheet explanation changed: 65100%'));
-- A tick and an answer do the same.
:signed;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_seen_unused(:'f', false);
reset role; reset request.jwt.claims;
select test.check('a tick clears steps 6 and 7 only', (:state) = 'code,entries,t2');
:signed;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_seen_unused(:'f', true);
reset role; reset request.jwt.claims;
:signed;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_answer_year_change(:'f', 'assets', true, 'New laptop bought in March');
reset role; reset request.jwt.claims;
select test.check('an answer clears steps 6 and 7 only', (:state) = 'code,entries,t2');
select test.check('a changed answer waits for the reviewer again', private.cb_review_problems(:'f') @> array['What changed this year: 1 "yes" answer to mark reviewed.']);
:signed;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_review_year_change(:'f', 'assets', true);
reset role; reset request.jwt.claims;
select test.check('the reviewer''s mark clears step 7 only', (:state) = 'code,compare,entries,t2');

-- T7: a GIFI line change clears steps 6, 7 and 8, and step 4 on a trial balance file (Hashim's addition 1); the new account
-- needs confirming again on its new line.
:signed;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_map_account(id, '9281.00') from public.cb_accounts where file_id = :'f' and number = '67300';
reset role; reset request.jwt.claims;
select test.check('T7: a GIFI line change clears steps 4, 6, 7 and 8 (trial balance file)', (:state) = 'entries');
select test.check('T7: the new account is confirmed again on its new line', (:p6) = '1 new account to confirm.');
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_confirm_new_account(:'f', '67300', true);
reset role; reset request.jwt.claims;
-- A tax code change does the same.
:signed;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_set_tax_code(:'off', 'NONDED');
reset role; reset request.jwt.claims;
select test.check('T7: a tax code change clears steps 4, 6, 7 and 8 (trial balance file)', (:state) = 'entries');

-- T8: a TJE added after steps 5 to 8 are signed clears step 8 only.
insert into public.cb_accounts (file_id, account_key, number, name, line_no, this_year, last_year, mapping_source)
values (:'f', '90000', '90000', 'Income tax expense', '9990.00', 0, 0, 'preparer'), (:'f', '26800', '26800', 'Income taxes payable', '2680.00', 0, 0, 'preparer');
select id as itx from public.cb_accounts where file_id = :'f' and number = '90000' \gset
select id as itp from public.cb_accounts where file_id = :'f' and number = '26800' \gset
:signed;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_add_entry(:'f', 'TJE', 'tax', 'Income tax provision.', false, jsonb_build_array(jsonb_build_object('account', :'itx', 'amount', 1200), jsonb_build_object('account', :'itp', 'amount', -1200)), 'Income tax schedule') as tje \gset
reset role; reset request.jwt.claims;
select test.check('T8: a TJE clears step 8 only', (:state) = 'code,compare,entries,review');

-- T6 and Hashim's addition 2: an account sent to the reviewer, then an open type flag, block step 7; the owner's decision on
-- the account clears nothing.
:signed;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_send_to_reviewer(:'wag', 'Wages or subcontracts?');
reset role; reset request.jwt.claims;
select test.check('T6: an account waiting for the reviewer blocks step 7', private.cb_review_problems(:'f') @> array['1 account waiting for the reviewer''s decision.']);
select test.check('T6: it no longer waits on step 6', not exists (select 1 from unnest(private.cb_step_waiting(:'f', 'compare')) w where w like '%reviewer''s decision%'));
:signed;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_map_account(:'wag', '9060.00');
reset role; reset request.jwt.claims;
select test.check('addition 2: the owner''s decision on the account clears nothing', (:state) = 'code,compare,entries,review,t2');
select test.check('the decision removed the item from step 7', not (private.cb_review_problems(:'f') @> array['1 account waiting for the reviewer''s decision.']));
-- An asset account on an expense line: an open type flag.
update public.cb_accounts set account_type = 'Asset' where id = :'off';
select test.check('T6: an open type flag blocks step 7', private.cb_review_problems(:'f') @> array['1 account on a GIFI line of another type.']);
update public.cb_accounts set account_type = null where id = :'off';

-- T5: an unmatched account, or a balance in Clearing 10900, blocks the preparer's sign-off of step 6.
delete from public.cb_step_signoffs where file_id = :'f' and step in ('compare', 'review');
insert into public.cb_accounts (file_id, account_key, number, name, this_year, last_year) values (:'f', '61000', '61000', 'Unmatched dummy', 100, 100);
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('T5: an unmatched account blocks step 6', test.try(format('select public.cb_sign_step(%L, %L, %L)', :'f', 'compare', 'prepared')) like 'Not yet:%1 account with no GIFI line.%');
reset role; reset request.jwt.claims;
delete from public.cb_accounts where file_id = :'f' and account_key = '61000';
insert into public.cb_accounts (file_id, account_key, number, name, this_year, last_year) values (:'f', 'chart:10900', '10900', 'Clearing', 250, 0);
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('T5: a balance in Clearing blocks step 6', test.try(format('select public.cb_sign_step(%L, %L, %L)', :'f', 'compare', 'prepared')) like 'Not yet:%Clearing (10900) has a balance%');
reset role; reset request.jwt.claims;
delete from public.cb_accounts where file_id = :'f' and account_key = 'chart:10900';
select test.check('T5: Clearing is never a new account', not exists (select 1 from private.cb_compare_accounts(:'f') where account_key = 'chart:10900'));

-- T1: clearing what is typed in step 6 (gear menu "Clear step"): the explanations, ticks and answers go; step 7 clears.
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_clear_typed_step(:'f', 'compare');
reset role; reset request.jwt.claims;
select test.check('T1: Clear step 6 removes its explanations, ticks and answers', not exists (select 1 from public.cb_flag_notes where file_id = :'f')
  and not exists (select 1 from public.cb_new_accounts where file_id = :'f') and not exists (select 1 from public.cb_compare_seen where file_id = :'f')
  and not exists (select 1 from public.cb_year_changes where file_id = :'f'));

-- T1: a file with only an old "mapping" sign-off: step 6 unsigned, cannot lock; steps 7 to 10 keep their sign-offs.
insert into public.clients (kind, legal_name, province) values ('corporation', 'Cedar Dummy Old Key Inc.', 'ON') returning id as client2 \gset
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_create_file(:'client2', '2026-08-31', '2025-09-01', '', 'full', 'client_software', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a') as f2 \gset
reset role; reset request.jwt.claims;
insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at, reviewed_by, reviewed_at)
select :'f2', s, '00000000-0000-0000-0000-00000000000c', now(), '00000000-0000-0000-0000-00000000000a', now()
  from unnest(array['setup', 'opening', 'records', 'code', 'entries', 'mapping', 'review', 't2', 'statements', 'lock']) s;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('T1: an old "mapping" sign-off leaves step 6 unsigned', (select s -> 'compare' ->> 'prepared_at' is null and s -> 'compare' ->> 'reviewed_at' is null from (select public.cb_step_status(:'f2') s) x));
reset role; reset request.jwt.claims;
select test.check('T1: it cannot lock until step 6 is signed', private.cb_lock_problems(:'f2') @> array['Step 6, Compare to last year: not signed by the reviewer.']);
select test.check('T1: steps 7 to 10 keep their sign-offs', (select count(*) from public.cb_step_signoffs where file_id = :'f2' and step in ('review', 't2', 'statements', 'lock') and reviewed_at is not null) = 4);
select test.check('T1: step 7''s gate needs step 6 reviewed', private.cb_review_problems(:'f2') @> array['Review step 6 first.']);
insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at, reviewed_by, reviewed_at)
values (:'f2', 'compare', '00000000-0000-0000-0000-00000000000c', now(), '00000000-0000-0000-0000-00000000000a', now());
select test.check('T1: signed with the new key, step 6 no longer holds the lock', not exists (select 1 from unnest(private.cb_lock_problems(:'f2')) p where p like 'Step 6%'));
select test.check('T1: lock''s step list is in order', not exists (select 1 from unnest(private.cb_lock_problems(:'f2')) p where p like 'Step 7, %'));

-- T10: a trial balance import with unmatched accounts still works; the GIFI export refuses until they are matched.
insert into public.clients (kind, legal_name, province) values ('corporation', 'Aspen Dummy Import Inc.', 'ON') returning id as client3 \gset
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_create_file(:'client3', '2026-12-31', '2026-01-01', '', 'full', 'client_software', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a') as f3 \gset
select public.cb_import_tb(:'f3', 'this_year', 'client_software', 'tb.csv', '[{"number":"","name":"Mystery account","amount":500},{"number":"","name":"Other mystery","amount":-500}]');
select test.check('T10: the import works with unmatched accounts', (select count(*) from public.cb_accounts where file_id = :'f3' and line_no is null) = 2);
\set checks '[{"key":"tb","title":"TB","ok":true},{"key":"bs","title":"BS","ok":true},{"key":"ni","title":"NI","ok":true},{"key":"re","title":"RE","ok":true},{"key":"opening","title":"Opening","ok":true}]'
select test.check('T10: the GIFI export refuses until they are matched',
  test.try(format($q$select public.cb_record_gifi_export(%L, 'final', 'x.gfi', '"GIFI01",""', %L, %L)$q$, :'f3', '{"9999":0,"2599":0,"amort":0,"inctax":0}', :'checks')) like 'Export refused. 2 accounts are not matched%');
reset role; reset request.jwt.claims;

-- The key rules still accept "mapping" rows (old rows fit); review notes take the new key.
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_add_note(:'f', 'compare', 'step', null, 'Check the office explanation.') as n6 \gset
select test.check('no new note on the old key', test.try(format('select public.cb_add_note(%L, %L, %L, null, %L)', :'f', 'mapping', 'step', 'x')) = 'Choose a step.');
reset role; reset request.jwt.claims;
select test.check('a review note on step 6 holds step 6', (:p6) like '%1 review note to fix.%');

-- Locked: nothing in step 6 changes.
update public.cb_files set phase = 'locked' where id = :'f';
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('locked: no tick', test.try(format('select public.cb_seen_unused(%L, true)', :'f')) = 'This file is locked or missing.');
select test.check('locked: no answer', test.try(format('select public.cb_answer_year_change(%L, %L, false, %L)', :'f', 'assets', '')) = 'This file is locked or missing.');
reset role; reset request.jwt.claims;
