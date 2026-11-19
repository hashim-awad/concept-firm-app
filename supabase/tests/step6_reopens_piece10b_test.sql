-- Local tests: piece 10b (Hashim, Nov 19, 2026, version 1): step 6 "Compare to last year" reopens when a balance moves.
-- T1 an AJE with a new unexplained flag clears steps 5 to 8, holds step 6 and the lock; T2 a TJE clears step 8 only;
-- T3 a step 4 coding change on a bank file clears step 6; T4 a trial balance re-import clears step 6; T5 an explanation
-- clears steps 6 and 7 only; and the changes that move no balance leave step 6 signed. Dummy data only.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'), ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test', (select id from public.roles where name = 'Accountant'));
reset role; reset request.jwt.claims;
update public.role_permissions set level = 'edit' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Accountant');
insert into public.clients (kind, legal_name, province) values ('corporation', 'Birch Dummy Reopen Inc.', 'ON') returning id as client \gset

-- A trial balance file with last year's column (dummy figures).
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_create_file(:'client', '2026-08-31', '2025-09-01', '', 'full', 'client_software', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a') as f \gset
\set tb '[{"number":"10100","name":"Chequing","amount":110000},{"number":"40100","name":"Commission income","amount":-200000},{"number":"65100","name":"Office expenses","amount":10000},{"number":"60000","name":"Wages","amount":80000}]'
select public.cb_import_tb(:'f', 'this_year', 'client_software', 'tb.csv', :'tb');
select public.cb_map_account(id, case number when '10100' then '1002.00' when '40100' then '8000.00' when '65100' then '8810.00' else '9066.00' end) from public.cb_accounts where file_id = :'f';
reset role; reset request.jwt.claims;
insert into public.cb_accounts (file_id, account_key, number, name, line_no, this_year, last_year, mapping_source)
values (:'f', '90000', '90000', 'Income tax expense', '9990.00', 0, 0, 'preparer'), (:'f', '26800', '26800', 'Income taxes payable', '2680.00', 0, 0, 'preparer');
update public.cb_accounts set last_year = case number when '10100' then 100000 when '40100' then -195000 when '65100' then 9500 when '60000' then 85500 else 0 end where file_id = :'f';
select id as chq from public.cb_accounts where file_id = :'f' and number = '10100' \gset
select id as off from public.cb_accounts where file_id = :'f' and number = '65100' \gset
select id as itx from public.cb_accounts where file_id = :'f' and number = '90000' \gset
select id as itp from public.cb_accounts where file_id = :'f' and number = '26800' \gset

\set state 'select coalesce(string_agg(step, \',\' order by step), \'none\') from public.cb_step_signoffs where file_id = :''f'' and step in (''code'', ''entries'', ''compare'', ''review'', ''t2'') and (prepared_at is not null or reviewed_at is not null)'
\set signed 'insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at) select :''f'', s, ''00000000-0000-0000-0000-00000000000c'', now() from unnest(array[''code'', ''entries'', ''compare'', ''review'', ''t2'']) s on conflict (file_id, step) do update set prepared_at = excluded.prepared_at, prepared_by = excluded.prepared_by'
\set flags 'select coalesce((select p from unnest(private.cb_step_problems(:''f'', ''compare'')) p where p like ''%flagged change%''), ''none'')'

select test.check('fixture: no flag before the entry', (:flags) = 'none');

-- ---------- T1: steps 4 to 8 signed; an AJE (a cheque not recorded) moves office expenses from 10,000.00 to 18,000.00 (last year 9,500.00): a new flag.
:signed;
select test.check('fixture: steps 4 to 8 signed', (:state) = 'code,compare,entries,review,t2');
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_add_entry(:'f', 'AJE', 'correction', 'Cheque for office invoices not recorded.', false,
  jsonb_build_array(jsonb_build_object('account', :'off', 'amount', 8000), jsonb_build_object('account', :'chq', 'amount', -8000)), 'Bank statement') as aje \gset
reset role; reset request.jwt.claims;
select test.check('T1: the AJE clears steps 5, 6, 7 and 8 (step 4 stays)', (:state) = 'code');
select test.check('T1: History gives the reason on step 6', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'signoff_cleared' and step = 'compare' and detail like 'Entry 2026-001%'));
select test.check('T1: the new flag is open, with the new wording', (:flags) = '1 flagged change to explain in Flagged changes.');
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('T1: step 6 cannot be signed until the flag is explained',
  test.try(format('select public.cb_sign_step(%L, %L, %L)', :'f', 'compare', 'prepared')) like 'Not yet: 1 flagged change to explain in Flagged changes.%');
reset role; reset request.jwt.claims;
select test.check('T1: the file cannot lock', private.cb_lock_problems(:'f') @> array['Step 6, Compare to last year: not signed by the reviewer.']);

-- ---------- T2: signed again; a TJE clears step 8 only.
:signed;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_add_entry(:'f', 'TJE', 'tax', 'Income tax provision.', false,
  jsonb_build_array(jsonb_build_object('account', :'itx', 'amount', 1500), jsonb_build_object('account', :'itp', 'amount', -1500)), 'Income tax schedule') as tje \gset
reset role; reset request.jwt.claims;
select test.check('T2: a TJE clears step 8 only', (:state) = 'code,compare,entries,review');

-- ---------- Changes that move no balance leave step 6 signed (Hashim's answer: balance moves only).
:signed;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_edit_entry(:'aje', 'AJE', 'correction', 'Cheque for office invoices not recorded, see statement.', false,
  jsonb_build_array(jsonb_build_object('account', :'off', 'amount', 8000), jsonb_build_object('account', :'chq', 'amount', -8000)), 'Bank statement');
reset role; reset request.jwt.claims;
select test.check('an AJE re-saved with the same lines and a new note clears step 5, not step 6',
  (:state) = 'code,compare');
:signed;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_add_revenue_check(:'f');
reset role; reset request.jwt.claims;
select test.check('adding a revenue check (step 5) leaves step 6 signed', (:state) like '%compare%');
:signed;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_review_entry(:'aje');
reset role; reset request.jwt.claims;
select test.check('approving an entry clears nothing', (:state) = 'code,compare,entries,review,t2');

-- ---------- An AJE's lines changed (amount): step 6 clears.
:signed;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_add_entry(:'f', 'AJE', 'correction', 'Second office correction.', false,
  jsonb_build_array(jsonb_build_object('account', :'off', 'amount', 100), jsonb_build_object('account', :'chq', 'amount', -100)), 'Payables listing') as aje2 \gset
reset role; reset request.jwt.claims;
:signed;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_edit_entry(:'aje2', 'AJE', 'correction', 'Second office correction.', false,
  jsonb_build_array(jsonb_build_object('account', :'off', 'amount', 200), jsonb_build_object('account', :'chq', 'amount', -200)), 'Payables listing');
reset role; reset request.jwt.claims;
select test.check('an AJE amount changed clears step 6', (:state) = 'code');
:signed;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_delete_entry(:'aje2');
reset role; reset request.jwt.claims;
select test.check('an AJE deleted clears step 6', (:state) = 'code');

-- An AJE edited so that only its sales tax lines change (the other lines the same) reopens step 6 (security review item 4).
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_add_entry(:'f', 'AJE', 'correction', 'Office supplies with tax.', false,
  jsonb_build_array(jsonb_build_object('account', :'off', 'amount', 100, 'tax_code', 'HST_ON'), jsonb_build_object('account', :'itp', 'amount', 13, 'is_tax', true),
    jsonb_build_object('account', :'chq', 'amount', -113)), 'Bank statement') as aje3 \gset
reset role; reset request.jwt.claims;
:signed;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_edit_entry(:'aje3', 'AJE', 'correction', 'Office supplies with tax.', false,
  jsonb_build_array(jsonb_build_object('account', :'off', 'amount', 100, 'tax_code', 'HST_ON'), jsonb_build_object('account', :'itp', 'amount', 12, 'is_tax', true),
    jsonb_build_object('account', :'itx', 'amount', 1, 'is_tax', true), jsonb_build_object('account', :'chq', 'amount', -113)), 'Bank statement');
reset role; reset request.jwt.claims;
select test.check('the non-tax lines are the same before and after', private.cb_entry_lines_text(:'aje3') like '%Office expenses Dr 100.00 HST_ON%');
select test.check('only the sales tax lines changed: step 6 reopens', (:state) = 'code');

-- ---------- T5: an explanation clears steps 6 and 7, not 5 or 8 (unchanged from piece 10).
:signed;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_explain_flag(:'off', 'other', 'Invoices for the new office missed at year end');
reset role; reset request.jwt.claims;
select test.check('T5: an explanation clears steps 6 and 7 only', (:state) = 'code,entries,t2');

-- ---------- T4: a trial balance re-import clears step 6 (and steps 7 and 8; step 4 and step 5 as their own rules say).
:signed;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_import_tb(:'f', 'this_year', 'client_software', 'tb2.csv', '[{"number":"10100","name":"Chequing","amount":109000},{"number":"40100","name":"Commission income","amount":-200000},{"number":"65100","name":"Office expenses","amount":11000},{"number":"60000","name":"Wages","amount":80000}]');
reset role; reset request.jwt.claims;
select test.check('T4: a trial balance re-import clears step 6', (:state) not like '%compare%' and (:state) like '%entries%');
select test.check('T4: History gives the reason on step 6', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'signoff_cleared' and step = 'compare' and detail like 'Trial balance%tb2.csv%'));

-- ---------- An opening balance change clears step 6 (step 2), not step 5.
:signed;
insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at) values (:'f', 'opening', '00000000-0000-0000-0000-00000000000c', now());
insert into public.cb_opening_balances (file_id, code, amount) values (:'f', '1002', 100000);
select test.check('an opening balance change clears step 6, not step 5', (:state) = 'code,entries');

-- ---------- T3: a bank-statement file: a step 4 coding change clears step 6.
insert into public.clients (kind, legal_name, province) values ('corporation', 'Maple Dummy Reopen Inc.', 'ON') returning id as client2 \gset
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_create_file(:'client2', '2026-08-31', '2025-09-01', '', 'full', 'statements', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a') as b \gset
select public.cb_save_bank_account(:'b', null, 'chequing', 'Dummy Chq', '1357', 5000.00, false, false) as bchq \gset
reset role; reset request.jwt.claims;
select private.cb_add_statement(:'b', :'bchq', 'chq.pdf', 5000.00, 4994.00, '[{"line": 1, "date": "2025-09-30", "description": "Monthly fee", "amount": -6.00}]', '2025-09-01', '2025-09-30', 5000.00, 4994.00, null);
\set bstate 'select coalesce(string_agg(step, \',\' order by step), \'none\') from public.cb_step_signoffs where file_id = :''b'' and step in (''code'', ''entries'', ''compare'', ''review'') and prepared_at is not null'
\set bsigned 'insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at) select :''b'', s, ''00000000-0000-0000-0000-00000000000c'', now() from unnest(array[''code'', ''entries'', ''compare'', ''review'']) s on conflict (file_id, step) do update set prepared_at = excluded.prepared_at'
:bsigned;
update public.cb_bank_lines set status = 'done', chart_account = '63000' where file_id = :'b';
select test.check('T3: a step 4 coding change on a bank file clears step 6 (and step 7), not step 5', (:bstate) = 'entries');
select test.check('T3: History gives the reason on step 6', exists (select 1 from public.cb_file_history where file_id = :'b' and action = 'signoff_cleared' and step = 'compare' and detail like 'Sep 30 Monthly fee%'));

-- Bank file, step 3 not fully signed (Hashim's answer: close the gap): statements and an account's opening balance.
select test.check('fixture: no sub-step signed', not exists (select 1 from public.cb_substep_signoffs where file_id = :'b' and prepared_at is not null));
:bsigned;
select private.cb_add_statement(:'b', :'bchq', 'chq2.pdf', 4994.00, 4990.00, '[{"line": 1, "date": "2025-10-31", "description": "Monthly fee", "amount": -4.00}]', '2025-10-01', '2025-10-31', 4994.00, 4990.00, null);
select test.check('a statement added clears step 6 although step 3 is not signed', (:bstate) = 'code,entries');
:bsigned;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_save_bank_account(:'b', :'bchq', 'chequing', 'Dummy Chq', '1357', 5100.00, false, false, true);
reset role; reset request.jwt.claims;
select test.check('an account''s opening balance changed clears step 6 although step 3 is not signed', (:bstate) not like '%compare%');
select test.check('History: the account and the reason', exists (select 1 from public.cb_file_history where file_id = :'b' and action = 'signoff_cleared' and step = 'compare' and detail like '%Dummy Chq%: opening balance changed'));
:bsigned;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_save_bank_account(:'b', :'bchq', 'chequing', 'Dummy Chq', '2468', 5100.00, false, false, true);
reset role; reset request.jwt.claims;
select test.check('the last four digits changed (no balance moves) leave step 6 signed', (:bstate) = 'code,compare,entries,review');
:bsigned;
update public.cb_bank_accounts set chart_account = '10100' where id = :'bchq';
select test.check('a bank account''s chart account changed (its balance moves to another row) clears step 6', (:bstate) not like '%compare%');

-- A posted line split again: a coding change (Hashim, option A): steps 4, 6, 7 and 8 clear; step 5 stays.
:bsigned;
insert into public.cb_line_splits (file_id, line_id, row_no, chart_account, tax_code, amount)
select :'b', id, 1, '63000', tax_code_or_default, -3.00 from (select id, 'EXEMPT' tax_code_or_default from public.cb_bank_lines where file_id = :'b' and status = 'done' limit 1) x
on conflict do nothing;
select test.check('a posted line split clears steps 4, 6 and 7 (and 8), not step 5', (:bstate) = 'entries');
select test.check('History names the line', exists (select 1 from public.cb_file_history where file_id = :'b' and action = 'signoff_cleared' and step = 'compare' and detail like '%: split changed'));
:bsigned;
update public.cb_line_splits set memo = 'just a memo' where file_id = :'b';
select test.check('a split memo changed moves nothing: step 6 stays', (:bstate) = 'code,compare,entries,review');

-- A statement changed in place (its file name; no line, no balance) leaves step 6 signed.
:bsigned;
update public.cb_bank_statements set file_name = 'chq-renamed.pdf' where file_id = :'b' and file_name = 'chq.pdf';
select test.check('a statement changed in place moves nothing: step 6 stays', (:bstate) like '%compare%');
