-- Local tests: round 8b (Hashim, Nov 25, 2026), review by exception. Items waiting for the reviewer do
-- not hold the preparer; the reviewer's decision on them keeps the preparer's sign-off; the reviewer
-- cannot sign while anything waits. Also: a note on a bank line names that line (round 8b item 5).
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'prep.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Preparer C', 'prep.c@example.test', (select id from public.roles where name = 'Staff'));
reset role;
reset request.jwt.claims;
update public.role_permissions set level = 'edit' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Staff');
insert into public.clients (kind, legal_name, province) values ('corporation', 'Willow Test Realty Inc.', 'ON') returning id as client \gset

-- A trial balance file: preparer C, reviewer A.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_create_file(:'client', '2026-12-31', '2026-01-01', '', 'full', 'client_software', '00000000-0000-0000-0000-00000000000c'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid) as f \gset
select public.cb_import_tb(:'f', 'this_year', 'client_software', 'tb.csv', '[
  {"number":"","name":"Computer gear","amount":3000,"type":"Fixed Assets"},
  {"number":"","name":"Mystery receipts","amount":-4000},
  {"number":"","name":"Office costs","amount":1000,"type":"Expenses"}]');
select public.cb_map_account(id, case name when 'Computer gear' then '8810.00' when 'Office costs' then '8810.00' else '8000.00' end) from public.cb_accounts where file_id = :'f';
select public.cb_send_to_reviewer(id, 'Preparer not sure') from public.cb_accounts where file_id = :'f' and name = 'Mystery receipts';
reset role;
select test.check('an account for the reviewer, and an asset on an expense line, wait for the reviewer',
  (select private.cb_step_waiting(:'f', 'mapping')) = array['1 account waiting for the reviewer''s decision.', '1 account on a GIFI line of another type.']);
set role authenticated;
-- The preparer signs steps 4 and 7 although those items wait.
select public.cb_sign_step(:'f', 'code', 'prepared');
select public.cb_sign_step(:'f', 'mapping', 'prepared');
reset role;
reset request.jwt.claims;
select test.check('items waiting for the reviewer do not hold the preparer', (select count(*) from public.cb_step_signoffs where file_id = :'f' and prepared_at is not null) = 2);

-- The reviewer cannot sign while anything waits.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('the reviewer cannot sign step 7 while items wait',
  test.try(format($q$select public.cb_sign_step(%L, 'mapping', 'reviewed')$q$, :'f')) = 'Not yet: 1 account waiting for the reviewer''s decision. 1 account on a GIFI line of another type.');
-- The reviewer decides both: the preparer's sign-offs stay.
select public.cb_map_account(id, '8230.00') from public.cb_accounts where file_id = :'f' and name = 'Mystery receipts';
select public.cb_confirm_type(id, 'Small tools under the capitalization limit, expensed by policy.') from public.cb_accounts where file_id = :'f' and name = 'Computer gear';
reset role;
reset request.jwt.claims;
select test.check('the reviewer''s decisions keep the preparer''s sign-offs on steps 4 and 7',
  (select count(*) from public.cb_step_signoffs where file_id = :'f' and step in ('code', 'mapping') and prepared_at is not null) = 2);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_sign_step(:'f', 'mapping', 'reviewed');
select public.cb_sign_step(:'f', 'code', 'reviewed');
-- Any other change still clears: the reviewer moving an account that waited for nothing.
select public.cb_map_account(id, '8811.00') from public.cb_accounts where file_id = :'f' and name = 'Office costs';
reset role;
reset request.jwt.claims;
select test.check('any other change, even by the reviewer, clears the sign-offs',
  not exists (select 1 from public.cb_step_signoffs where file_id = :'f' and step in ('code', 'mapping')));
select test.check('and the history names it', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'signoff_cleared' and step = 'mapping'
  and detail = 'Office costs: GIFI 8810 to 8811'));

-- A bank-statement file: a line sent to the reviewer.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_create_file(:'client', '2025-12-31', '2025-01-01', '', 'full', 'statements', '00000000-0000-0000-0000-00000000000c'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid) as g \gset
reset role;
reset request.jwt.claims;
insert into public.cb_bank_accounts (file_id, name, name_key, kind, chart_account) values (:'g', 'Visa 4111', 'visa 4111', 'card', '22000') returning id as ba \gset
insert into public.cb_bank_statements (file_id, account_id, first_date, last_date, period_start, period_end, opening, closing, lines, plus_total, minus_total)
  values (:'g', :'ba', '2025-01-08', '2025-01-15', '2025-01-01', '2025-01-31', 0, 0, 2, 0, 0) returning id as st \gset
insert into public.cb_bank_lines (statement_id, file_id, account_id, row_no, txn_date, description, amount, chart_account, tax_code, status) values
  (:'st', :'g', :'ba', 1, '2025-01-08', 'SAMPLE BISTRO KITCHENER', -84.75, '60200', 'HST_ON', 'reviewer'),
  (:'st', :'g', :'ba', 2, '2025-01-15', 'SAMPLE BROKERAGE COMMISSION', 11300, '40200', 'HST_ON', 'done');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_sign_step(:'g', 'code', 'prepared');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('the reviewer cannot sign step 4 while a line waits', test.try(format($q$select public.cb_sign_step(%L, 'code', 'reviewed')$q$, :'g')) = 'Not yet: 1 line for the reviewer.');
-- Item 5: a note on a bank line names that line, not another.
select public.cb_add_note(:'g', 'code', 'bank_line', id, 'Coded to meals: is this a client lunch? Keep the receipt.') as nb from public.cb_bank_lines where file_id = :'g' and row_no = 1 \gset
reset role;
reset request.jwt.claims;
select test.check('a note on the Bistro line is on the Bistro line', (select target_id = (select id from public.cb_bank_lines where file_id = :'g' and row_no = 1)
  and target_label = 'Jan 8 SAMPLE BISTRO KITCHENER -84.75' from public.cb_review_notes where id = :'nb'));
-- The reviewer decides the line (run as the owner, as the coding screen does): the preparer's sign-off stays.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
update public.cb_bank_lines set status = 'done', tax_code = 'MEALS_HST_50' where file_id = :'g' and row_no = 1;
select test.check('the reviewer deciding a line sent to the reviewer keeps the preparer''s sign-off',
  exists (select 1 from public.cb_step_signoffs where file_id = :'g' and step = 'code' and prepared_at is not null));
-- The preparer changing a coded line clears it, and the history says which line and what.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
update public.cb_bank_lines set chart_account = '40250' where file_id = :'g' and row_no = 2;
reset request.jwt.claims;
select test.check('the preparer recoding a coded line clears the sign-off', not exists (select 1 from public.cb_step_signoffs where file_id = :'g' and step = 'code'));
select test.check('the history names the line and the change', exists (select 1 from public.cb_file_history where file_id = :'g' and step = 'code'
  and detail = 'Jan 15 SAMPLE BROKERAGE COMMISSION: account 40200 to 40250'));
