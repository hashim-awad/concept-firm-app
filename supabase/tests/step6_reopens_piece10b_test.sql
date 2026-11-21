-- Local tests: piece 10b (Hashim, Nov 19, 2026, version 1), updated for CB2-0 (rules 7, 13 and 14): step 6 "Compare to
-- last year" no longer reopens when a balance moves. Every change below (an AJE, a TJE, an edit, a delete, a coding change,
-- a trial balance re-import, an explanation, an opening balance, a split) keeps every sign-off exactly as signed and is
-- recorded in History. There is no $5,000/20% flag, and step 6 signs with open items. Dummy data only.
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
select test.check('T1: the AJE keeps steps 4 to 8 signed (CB2-0 step 2)', (:state) = 'code,compare,entries,review,t2');
select test.check('T1: History has the entry, one row, and no sign-off cleared', (select count(*) from public.cb_file_history where file_id = :'f' and entry_id = :'aje') = 1
  and exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'entry_created' and detail = 'Entry 2026-001 added')
  and not exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'signoff_cleared'));
select test.check('T1: no year-over-year flag (CB2-0 step 5: no $5,000 or 20% threshold)', (:flags) = 'none');
delete from public.cb_step_signoffs where file_id = :'f' and step = 'compare';   -- the preparer took their own step 6 sign-off back
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('T1: step 6 can be signed (no flag to explain)',
  test.try(format('select public.cb_sign_step(%L, %L, %L)', :'f', 'compare', 'prepared')) = 'OK');
reset role; reset request.jwt.claims;
select test.check('T1: the lock lists step 6 not reviewed (a warning on step 10)', private.cb_lock_problems(:'f') @> array['Step 6, Compare to last year: not signed by the reviewer.']);

-- ---------- T2: signed again; a TJE clears nothing (CB2-0 step 2).
:signed;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_add_entry(:'f', 'TJE', 'tax', 'Income tax provision.', false,
  jsonb_build_array(jsonb_build_object('account', :'itx', 'amount', 1500), jsonb_build_object('account', :'itp', 'amount', -1500)), 'Income tax schedule') as tje \gset
reset role; reset request.jwt.claims;
select test.check('T2: a TJE clears nothing, step 8 included (CB2-0 step 2)', (:state) = 'code,compare,entries,review,t2'
  and exists (select 1 from public.cb_file_history where entry_id = :'tje' and action = 'entry_created'));

-- ---------- Changes that move no balance leave step 6 signed (Hashim's answer: balance moves only).
:signed;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_edit_entry(:'aje', 'AJE', 'correction', 'Cheque for office invoices not recorded, see statement.', false,
  jsonb_build_array(jsonb_build_object('account', :'off', 'amount', 8000), jsonb_build_object('account', :'chq', 'amount', -8000)), 'Bank statement');
reset role; reset request.jwt.claims;
select test.check('an AJE re-saved with the same lines and a new note clears nothing; History has the edit',
  (:state) = 'code,compare,entries,review,t2' and exists (select 1 from public.cb_file_history where entry_id = :'aje' and action = 'entry_edited' and reason = 'description'));
:signed;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_add_revenue_check(:'f');
reset role; reset request.jwt.claims;
select test.check('adding a revenue check (step 5) leaves step 6 signed', (:state) like '%compare%');
:signed;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('E1: entry approval is retired (approved test change)', test.try(format('select public.cb_review_entry(%L)', :'aje')) = 'Entry approval was retired. Sign step 5 instead.');
reset role; reset request.jwt.claims;
select test.check('the refused call clears nothing', (:state) = 'code,compare,entries,review,t2');

-- ---------- An AJE's lines changed (amount): nothing clears (CB2-0 step 2).
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
select test.check('an AJE amount changed clears nothing; History has the edit', (:state) = 'code,compare,entries,review,t2'
  and exists (select 1 from public.cb_file_history where entry_id = :'aje2' and action = 'entry_edited' and reason = 'lines'));
:signed;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_delete_entry(:'aje2');
reset role; reset request.jwt.claims;
select test.check('an AJE deleted clears nothing; History has the delete', (:state) = 'code,compare,entries,review,t2'
  and exists (select 1 from public.cb_file_history where entry_id = :'aje2' and action = 'entry_deleted'));

-- An AJE edited so that only its sales tax lines change (the other lines the same): nothing clears; History has it.
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
select test.check('only the sales tax lines changed: nothing clears; History has the change (one row)', (:state) = 'code,compare,entries,review,t2'
  and (select count(*) from public.cb_file_history where entry_id = :'aje3' and action <> 'entry_created') = 1);

-- ---------- T5: an explanation clears nothing (CB2-0 step 2); History has it.
:signed;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_explain_flag(:'off', 'other', 'Invoices for the new office missed at year end');
reset role; reset request.jwt.claims;
select test.check('T5: an explanation clears nothing', (:state) = 'code,compare,entries,review,t2'
  and exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'changed' and step = 'compare' and detail = 'Lead sheet explanation added: 65100 Office expenses'));

-- ---------- T4: a trial balance re-import clears nothing (CB2-0 step 2); History has it.
:signed;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_import_tb(:'f', 'this_year', 'client_software', 'tb2.csv', '[{"number":"10100","name":"Chequing","amount":109000},{"number":"40100","name":"Commission income","amount":-200000},{"number":"65100","name":"Office expenses","amount":11000},{"number":"60000","name":"Wages","amount":80000}]');
reset role; reset request.jwt.claims;
select test.check('T4: a trial balance re-import clears nothing', (:state) = 'code,compare,entries,review,t2');
select test.check('T4: History has the re-import, one row', (select count(*) from public.cb_file_history where file_id = :'f' and detail like 'Trial balance%tb2.csv%') = 1);

-- ---------- An opening balance change clears nothing (CB2-0 step 2); History has it.
:signed;
insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at) values (:'f', 'opening', '00000000-0000-0000-0000-00000000000c', now());
insert into public.cb_opening_balances (file_id, code, amount) values (:'f', '1002', 100000);
select test.check('an opening balance change clears nothing', (:state) = 'code,compare,entries,review,t2'
  and exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'changed' and step = 'opening' and detail = 'Last year''s balance sheet: GIFI 1002 added'));

-- ---------- T3: a bank-statement file: a step 4 coding change clears nothing (CB2-0 step 2).
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
select test.check('T3: a step 4 coding change on a bank file clears nothing', (:bstate) = 'code,compare,entries,review');
select test.check('T3: History has the coding', exists (select 1 from public.cb_file_history where file_id = :'b' and action = 'line_coded' and step = 'code')
  and not exists (select 1 from public.cb_file_history where file_id = :'b' and action = 'signoff_cleared'));

-- Bank file, step 3 not fully signed (Hashim's answer: close the gap): statements and an account's opening balance.
select test.check('fixture: no sub-step signed', not exists (select 1 from public.cb_substep_signoffs where file_id = :'b' and prepared_at is not null));
:bsigned;
select private.cb_add_statement(:'b', :'bchq', 'chq2.pdf', 4994.00, 4990.00, '[{"line": 1, "date": "2025-10-31", "description": "Monthly fee", "amount": -4.00}]', '2025-10-01', '2025-10-31', 4994.00, 4990.00, null);
select test.check('a statement added clears nothing', (:bstate) = 'code,compare,entries,review'
  and exists (select 1 from public.cb_file_history where file_id = :'b' and action = 'changed' and detail like '%Statement added%Oct 1, 2025 to Oct 31, 2025'));
:bsigned;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_save_bank_account(:'b', :'bchq', 'chequing', 'Dummy Chq', '1357', 5100.00, false, false, true);
reset role; reset request.jwt.claims;
select test.check('an account''s opening balance changed clears nothing', (:bstate) = 'code,compare,entries,review');
select test.check('History: the balance, old and new', exists (select 1 from public.cb_file_history where file_id = :'b' and action = 'bank_account_changed' and detail = 'Balance at last year end changed'
  and old_value = '5,000.00' and new_value = '5,100.00'));
:bsigned;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_save_bank_account(:'b', :'bchq', 'chequing', 'Dummy Chq', '2468', 5100.00, false, false, true);
reset role; reset request.jwt.claims;
select test.check('the last four digits changed (no balance moves) leave step 6 signed', (:bstate) = 'code,compare,entries,review');
:bsigned;
update public.cb_bank_accounts set chart_account = '10100' where id = :'bchq';
select test.check('a bank account''s chart account changed (its balance moves to another row) clears nothing; History has it', (:bstate) = 'code,compare,entries,review'
  and exists (select 1 from public.cb_file_history where file_id = :'b' and action = 'changed' and detail like '%Dummy Chq%: chart account changed'));

-- A posted line split again: a coding change (Hashim, option A): nothing clears (CB2-0 step 2); History has it.
:bsigned;
insert into public.cb_line_splits (file_id, line_id, row_no, chart_account, tax_code, amount)
select :'b', id, 1, '63000', tax_code_or_default, -3.00 from (select id, 'EXEMPT' tax_code_or_default from public.cb_bank_lines where file_id = :'b' and status = 'done' limit 1) x
on conflict do nothing;
select test.check('a posted line split clears nothing', (:bstate) = 'code,compare,entries,review');
select test.check('History names the line', exists (select 1 from public.cb_file_history where file_id = :'b' and action = 'changed' and step = 'code' and detail = 'Sep 30 Monthly fee: split changed'));
:bsigned;
update public.cb_line_splits set memo = 'just a memo' where file_id = :'b';
select test.check('a split memo changed moves nothing: step 6 stays', (:bstate) = 'code,compare,entries,review');

-- A statement changed in place (its file name; no line, no balance) leaves step 6 signed.
:bsigned;
update public.cb_bank_statements set file_name = 'chq-renamed.pdf' where file_id = :'b' and file_name = 'chq.pdf';
select test.check('a statement changed in place moves nothing: step 6 stays', (:bstate) like '%compare%');
