-- Local tests: round 5 (Hashim, Nov 21, 2026), the step 7 type check works from each account's type.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test', (select id from public.roles where name = 'Staff'));
reset role;
reset request.jwt.claims;
update public.role_permissions set level = 'edit' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Staff');
insert into public.clients (kind, legal_name, province) values ('corporation', 'Spruce Test Realty Inc.', 'ON') returning id as client \gset

-- Preparer: Staff C. Reviewer: Owner A.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_create_file(:'client', '2026-12-31', '2026-01-01', '', 'full', 'client_software', '00000000-0000-0000-0000-00000000000c'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid) as f \gset
-- A trial balance with a Type column on some rows only (Xero and QuickBooks Online account list exports).
select public.cb_import_tb(:'f', 'this_year', 'client_software', 'tb.csv', '[
  {"number":"","name":"Computer gear","amount":3000,"type":"Fixed Assets"},
  {"number":"","name":"Sundry","amount":200},
  {"number":"15500","name":"Office furniture","amount":800},
  {"number":"","name":"Consulting income","amount":-4000,"type":"Income"},
  {"number":"","name":"Odd item","amount":0.5,"type":"Detail"},
  {"number":"","name":"Rounding","amount":-0.5,"type":"Something else entirely, longer than sixty characters, for the length rule"}]');
reset role;
reset request.jwt.claims;
select test.check('the import keeps the Type column, and the account takes its type from it',
  (select account_type || '|' || type_source || '|' || tb_type from public.cb_accounts where file_id = :'f' and name = 'Computer gear') = 'Asset|import|Fixed Assets');
select test.check('"Income" is a revenue type', (select account_type from public.cb_accounts where file_id = :'f' and name = 'Consulting income') = 'Revenue');
select test.check('a client account with no type and no number has no type', (select account_type is null and type_source is null from public.cb_accounts where file_id = :'f' and name = 'Sundry'));
select test.check('no type, but a 5-digit number: the number is the fallback (15500 is an asset)',
  (select account_type || '|' || type_source from public.cb_accounts where file_id = :'f' and name = 'Office furniture') = 'Asset|number');
select test.check('a type word Closebook does not know gives no type', (select account_type is null from public.cb_accounts where file_id = :'f' and name = 'Odd item'));
select test.check('a long type is cut to 60 characters', (select length(tb_type) from public.cb_accounts where file_id = :'f' and name = 'Rounding') = 60);
-- A standard chart account in the same file (as a bank-statement file carries).
insert into public.cb_accounts (file_id, account_key, number, name, this_year) values (:'f', 'chart:15000', '15000', 'Computer equipment', 1200);
select test.check('a standard chart account takes the chart''s type', (select account_type || '|' || type_source from public.cb_accounts where file_id = :'f' and account_key = 'chart:15000') = 'Asset|chart');

-- The preparer matches each account to an expense line (8810 Office expenses).
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_map_account(id, '8810.00') from public.cb_accounts where file_id = :'f' and name in ('Computer gear', 'Sundry', 'Office furniture', 'Computer equipment');
reset role;
reset request.jwt.claims;
select test.check('three open type flags: the standard chart asset, the client asset with a type, the asset by its number',
  private.cb_open_type_flags(:'f') = 3);
select test.check('the client account with no type is not flagged',
  not exists (select 1 from public.cb_accounts a join public.cb_master_lines m on m.line_no = a.line_no where a.file_id = :'f' and a.name = 'Sundry' and a.account_type is not null));
-- A matching type is not flagged: the revenue account on a revenue line.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_map_account(id, '8000.00') from public.cb_accounts where file_id = :'f' and name = 'Consulting income';
reset role;
reset request.jwt.claims;
select test.check('a revenue account on a revenue line is not flagged', private.cb_open_type_flags(:'f') = 3);
-- The reviewer's match confirms it.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_map_account(id, '8810.00') from public.cb_accounts where file_id = :'f' and name = 'Computer gear';
reset role;
reset request.jwt.claims;
select test.check('round 6: the reviewer''s match alone no longer confirms it', private.cb_open_type_flags(:'f') = 3);
-- Round 6 item 1: the reviewer confirms with a reason.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select id as gear from public.cb_accounts where file_id = :'f' and name = 'Computer gear' \gset
select id as inc from public.cb_accounts where file_id = :'f' and name = 'Consulting income' \gset
select test.check('no reason, no confirm', test.try(format($q$select public.cb_confirm_type(%L, '   ')$q$, :'gear')) like 'Type the reason%');
select test.check('a reason over 300 characters is refused', test.try(format($q$select public.cb_confirm_type(%L, %L)$q$, :'gear', repeat('x', 301))) like '%300 characters%');
select test.check('an account whose type matches its line has nothing to confirm', test.try(format($q$select public.cb_confirm_type(%L, 'Fine')$q$, :'inc')) like '%nothing to confirm%');
select public.cb_confirm_type(:'gear', 'Small tools under the capitalization limit: expensed by policy.');
reset role;
reset request.jwt.claims;
select test.check('confirmed with a reason: two flags left', private.cb_open_type_flags(:'f') = 2);
select test.check('the reason, who and when are kept, for the line it was given on',
  (select type_confirm_reason || '|' || type_confirmed_by || '|' || type_confirmed_line || '|' || (type_confirmed_at is not null) from public.cb_accounts where id = :'gear')
  = 'Small tools under the capitalization limit: expensed by policy.|00000000-0000-0000-0000-00000000000a|8810.00|true');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('the preparer cannot confirm', test.try(format($q$select public.cb_confirm_type(%L, 'Because')$q$, :'gear')) like 'Only the file''s reviewer%');
-- Moved to another expense line: checked again.
select public.cb_map_account(:'gear', '8811.00');
reset role;
reset request.jwt.claims;
select test.check('moved to another line, the confirmation no longer counts: three flags', private.cb_open_type_flags(:'f') = 3);
-- A new import with no Type column keeps the type it had.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_import_tb(:'f', 'this_year', 'client_software', 'tb2.csv', '[{"number":"","name":"Computer gear","amount":3100},{"number":"","name":"Consulting income","amount":-3100}]');
reset role;
reset request.jwt.claims;
select test.check('a re-import without a Type column keeps the type from before', (select account_type || '|' || type_source from public.cb_accounts where file_id = :'f' and name = 'Computer gear') = 'Asset|import');
select test.check('the number rule matches step 7''s: 1 asset, 2 liability, 3 equity, 4 revenue, 5 to 9 expense, 4 or 5 digits only',
  private.cb_type_from_number('1500') = 'Asset' and private.cb_type_from_number('21000') = 'Liability' and private.cb_type_from_number('3600') = 'Equity'
  and private.cb_type_from_number('40000') = 'Revenue' and private.cb_type_from_number('61500') = 'Expense' and private.cb_type_from_number('9100.10') = 'Expense'
  and private.cb_type_from_number('150') is null and private.cb_type_from_number('150000') is null and private.cb_type_from_number('A100') is null);

-- Round 6 item 2: the QuickBooks Online Account List gives each account its type.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_create_file(:'client', '2025-12-31', '2025-01-01', '', 'full', 'client_software', '00000000-0000-0000-0000-00000000000c'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid) as g \gset
select test.check('the Account List needs the trial balance first',
  test.try(format($q$select public.cb_import_account_list(%L, 'list.csv', '[{"number":"","name":"Sundry","type":"Expenses"}]')$q$, :'g')) like 'Import the trial balance first%');
select public.cb_import_tb(:'g', 'this_year', 'quickbooks', 'tb.csv', '[
  {"number":"","name":"Office  Supplies","amount":250},
  {"number":"60100","name":"Rent","amount":1000},
  {"number":"","name":"Mystery","amount":-1250}]');
select public.cb_import_account_list(:'g', 'list.xlsx', '[
  {"number":"","name":"office supplies","type":"Expenses"},
  {"number":"60100","name":"Rent or lease","type":"Fixed Assets"},
  {"number":"","name":"Rent","type":"Income"}]') as res \gset
reset role;
reset request.jwt.claims;
select test.check('matched by name, ignoring case and spacing', (select account_type || '|' || type_source from public.cb_accounts where file_id = :'g' and name = 'Office  Supplies') = 'Expense|import');
select test.check('matched by number first, even when the name differs', (select account_type from public.cb_accounts where file_id = :'g' and number = '60100') = 'Asset');
select test.check('an account not on the list keeps no type', (select account_type is null from public.cb_accounts where file_id = :'g' and name = 'Mystery'));
select test.check('the result counts rows read, accounts matched and accounts still without a type',
  :'res'::jsonb = '{"rows": 3, "matched": 2, "accounts_without": 1}'::jsonb);
select test.check('the upload is recorded once as the account list', (select count(*) from public.cb_imports where file_id = :'g' and target = 'account_list') = 1);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_import_account_list(:'g', 'list2.xlsx', '[{"number":"","name":"Mystery","type":"Other Current Liabilities"}]');
reset role;
reset request.jwt.claims;
select test.check('uploading again replaces the record and adds types; earlier types stay',
  (select count(*) from public.cb_imports where file_id = :'g' and target = 'account_list') = 1
  and (select account_type from public.cb_accounts where file_id = :'g' and name = 'Mystery') = 'Liability'
  and (select account_type from public.cb_accounts where file_id = :'g' and number = '60100') = 'Asset');
