-- Local tests: piece 6 (Hashim, Nov 18, 2026, version 2): a tax entry (TJE) keeps steps 5, 6 and 7 signed and clears step 8;
-- a change of type to or from TJE is an AJE change; lead sheet flags leave out this year's TJE lines and never apply to INCTAX
-- or AMORT accounts. Dummy data only.
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
insert into public.clients (kind, legal_name, province) values ('corporation', 'Birch Dummy Tax Entries Inc.', 'ON') returning id as client \gset
select public.cb_create_file(:'client', '2026-08-31', '2025-09-01', '', 'full', 'client_software', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a') as f \gset
select public.cb_import_tb(:'f', 'this_year', 'client_software', 'tb.csv', '[
  {"number":"10100","name":"Chequing","amount":106400},{"number":"41000","name":"Commission income","amount":-100000},
  {"number":"64250","name":"Accounting fees","amount":8000},{"number":"90000","name":"Income tax expense","amount":0},
  {"number":"26800","name":"Income taxes payable","amount":0},{"number":"17880","name":"Accumulated amortization","amount":-14400},
  {"number":"86700","name":"Amortization","amount":0}]');
select public.cb_map_account(id, case number when '10100' then '1002.00' when '41000' then '8000.00' when '64250' then '8862.00' when '90000' then '9990.00'
  when '26800' then '2680.00' when '17880' then '1788.00' else '8670.00' end) from public.cb_accounts where file_id = :'f';
reset role;
reset request.jwt.claims;
-- Accounts with no balance this year are not imported: the client's books still hold them (dummy fixture).
insert into public.cb_accounts (file_id, account_key, number, name, line_no, this_year, last_year, mapping_source)
values (:'f', '90000', '90000', 'Income tax expense', '9990.00', 0, 0, 'preparer'), (:'f', '26800', '26800', 'Income taxes payable', '2680.00', 0, 0, 'preparer'),
       (:'f', '86700', '86700', 'Amortization', '8670.00', 0, 0, 'preparer');
-- Last year's final balances (dummy): income tax expense 9,000.00; accumulated amortization 14,400.00 (credit).
update public.cb_accounts set last_year = case number when '10100' then 100000 when '41000' then -100000 when '64250' then 8000 when '90000' then 9000
  when '17880' then -14400 when '86700' then 6400 else 0 end where file_id = :'f';
select id as chq from public.cb_accounts where file_id = :'f' and number = '10100' \gset
select id as fees from public.cb_accounts where file_id = :'f' and number = '64250' \gset
select id as itx from public.cb_accounts where file_id = :'f' and number = '90000' \gset
select id as itp from public.cb_accounts where file_id = :'f' and number = '26800' \gset
select id as acc from public.cb_accounts where file_id = :'f' and number = '17880' \gset
select id as amo from public.cb_accounts where file_id = :'f' and number = '86700' \gset

-- Steps 5 to 8 signed (dummy fixture).
create temporary table sign_all as select 1;
\set signed 'insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at) select :''f'', s, ''00000000-0000-0000-0000-00000000000c'', now() from unnest(array[''entries'', ''mapping'', ''review'', ''t2'']) s on conflict (file_id, step) do update set prepared_at = excluded.prepared_at, prepared_by = excluded.prepared_by'
\set state 'select string_agg(step, \',\' order by step) from public.cb_step_signoffs where file_id = :''f'' and step in (''entries'', ''mapping'', ''review'', ''t2'') and prepared_at is not null'
:signed;
select test.check('fixture: steps 5 to 8 signed', (:state) = 'entries,mapping,review,t2');

-- T1: a TJE added: steps 5, 6 and 7 stay signed; step 8 is cleared, with the reason in History.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_add_entry(:'f', 'TJE', 'tax', 'Income tax provision.', false, jsonb_build_array(jsonb_build_object('account', :'itx', 'amount', 12000), jsonb_build_object('account', :'itp', 'amount', -12000)), 'Income tax schedule') as tje \gset
reset role; reset request.jwt.claims;
select test.check('T1: a TJE keeps steps 5, 6 and 7; step 8 cleared', (:state) = 'entries,mapping,review');
select test.check('T1: History says why step 8 was cleared', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'signoff_cleared' and step = 't2' and detail like 'Entry 2026-001 added%'));

-- T2: the TJE's amount edited; then deleted: the same.
:signed;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_edit_entry(:'tje', 'TJE', 'tax', 'Income tax provision.', false, jsonb_build_array(jsonb_build_object('account', :'itx', 'amount', 12500), jsonb_build_object('account', :'itp', 'amount', -12500)), 'Income tax schedule');
reset role; reset request.jwt.claims;
select test.check('T2: the TJE edited: steps 5, 6 and 7 kept; step 8 cleared', (:state) = 'entries,mapping,review');
:signed;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_delete_entry(:'tje');
reset role; reset request.jwt.claims;
select test.check('T2: the TJE deleted: steps 5, 6 and 7 kept; step 8 cleared', (:state) = 'entries,mapping,review');

-- T4: an AJE added: cleared exactly as before (step 5, and 7 and 8 through the chain; step 6 stays).
:signed;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_add_entry(:'f', 'AJE', 'correction', 'Accrued accounting fee.', false, jsonb_build_array(jsonb_build_object('account', :'fees', 'amount', 6000), jsonb_build_object('account', :'chq', 'amount', -6000)), 'Payables listing') as aje \gset
reset role; reset request.jwt.claims;
select test.check('T4: an AJE clears steps 5, 7 and 8 as before', (:state) = 'mapping');

-- T3: an AJE changed into a TJE, and back: each an AJE change.
:signed;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_edit_entry(:'aje', 'TJE', 'tax', 'Accrued accounting fee.', false, jsonb_build_array(jsonb_build_object('account', :'fees', 'amount', 6000), jsonb_build_object('account', :'chq', 'amount', -6000)), 'Payables listing');
reset role; reset request.jwt.claims;
select test.check('T3: AJE into TJE clears steps 5, 7 and 8', (:state) = 'mapping');
:signed;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_edit_entry(:'aje', 'AJE', 'correction', 'Accrued accounting fee.', false, jsonb_build_array(jsonb_build_object('account', :'fees', 'amount', 6000), jsonb_build_object('account', :'chq', 'amount', -6000)), 'Payables listing');
reset role; reset request.jwt.claims;
select test.check('T3: TJE into AJE clears steps 5, 7 and 8', (:state) = 'mapping');

-- T5, T6, T6b: the flags (step 5's own check).
\set flags 'select coalesce((select p from unnest(private.cb_step_problems(:''f'', ''entries'')) p where p like ''%flagged change%''), ''none'')'
select test.check('T6: the AJE moves accounting fees from 8,000.00 to 14,000.00: flagged as before', (:flags) = '1 flagged change to explain on the lead sheets.');
select test.check('T5: income tax expense (INCTAX, 9,000.00 last year, nothing this year) is not flagged', (:flags) = '1 flagged change to explain on the lead sheets.');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_add_entry(:'f', 'TJE', 'tax', 'Income tax provision.', false, jsonb_build_array(jsonb_build_object('account', :'itx', 'amount', 12000), jsonb_build_object('account', :'itp', 'amount', -12000)), 'Income tax schedule');
select public.cb_add_entry(:'f', 'TJE', 'tax', 'Amortization for the year.', false, jsonb_build_array(jsonb_build_object('account', :'amo', 'amount', 6400), jsonb_build_object('account', :'acc', 'amount', -6400)), 'Capital assets schedule');
reset role; reset request.jwt.claims;
select test.check('T5/T6b: after a TJE of 12,000.00 (expense and payable) and amortization of 6,400.00: no new flag', (:flags) = '1 flagged change to explain on the lead sheets.');
select test.check('T5: the payable and the accumulated amortization move by the TJEs only: final balances include them',
  (select private.cb_account_final(:'itp')) = -12000 and (select private.cb_account_final(:'acc')) = -20800);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_explain_flag(:'fees', 'one_time', 'Year-end accrual.');
reset role; reset request.jwt.claims;
-- Without piece 6 the payable (0.00 to 12,000.00 credit), the accumulated amortization (14,400.00 to 20,800.00) and the
-- income tax expense (9,000.00 last year) would each be flagged; the only flag was the accounting fees, now explained.
select test.check('T5: step 5 has no flagged change left', (:flags) = 'none');
