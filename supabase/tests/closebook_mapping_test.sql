-- Local tests: Closebook matching, tax codes and entries (step 1, part 3a).
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
\set A '''00000000-0000-0000-0000-00000000000a'''
\set C '''00000000-0000-0000-0000-00000000000c'''
-- Staff C prepares; owner A reviews.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
reset role;
insert into public.clients (kind, legal_name, province) values ('corporation', 'Maple Test Realty Inc.', 'ON') returning id as client \gset
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_create_file(:'client', '2026-12-31', '2026-01-01', '', 'full', 'statements', :C::uuid, :A::uuid) as f \gset
select public.cb_import_tb(:'f', 'this_year', 'client_software', 'tb.csv', '[{"number":"1000","name":"Chequing","amount":500},{"number":"2100","name":"Due to shareholder","amount":-300},{"number":"4000","name":"Commission income","amount":-1000},{"number":"5300","name":"Office expenses","amount":700},{"number":"5900","name":"Johnson advance","amount":100}]');
select id as chq from public.cb_accounts where file_id = :'f' and account_key = '1000' \gset
select id as sh from public.cb_accounts where file_id = :'f' and account_key = '2100' \gset
select id as rev from public.cb_accounts where file_id = :'f' and account_key = '4000' \gset
select id as off from public.cb_accounts where file_id = :'f' and account_key = '5300' \gset
select id as adv from public.cb_accounts where file_id = :'f' and account_key = '5900' \gset

select public.cb_apply_matching(:'f', format('[{"account":"%s","line":"1002.00"},{"account":"%s","line":"2781.10"},{"account":"%s","line":"8121.00"},{"account":"%s","line":"8810.00"},{"account":"%s","line":null,"reason":"No clear match"}]', :'chq', :'sh', :'rev', :'off', :'adv')::jsonb) as r \gset
select test.check('suggestions applied; no match goes to the reviewer', :'r'::jsonb = '{"history": 0, "suggested": 4, "reviewer": 1}'
  and (select needs_reviewer from public.cb_accounts where id = :'adv'));
select test.check('no total lines', test.try(format($f$select public.cb_map_account(%L, '2599.00')$f$, :'off')) like '%totals are calculated%');
select test.check('the preparer cannot decide the reviewer''s list', test.try(format($f$select public.cb_map_account(%L, '1301.10')$f$, :'adv')) like '%waits for the reviewer%');
select test.check('the preparer cannot change a tax code', test.try(format($f$select public.cb_set_tax_code(%L, 'NONDED')$f$, :'off')) like '%reviewer changes a tax code%');
select public.cb_map_account(:'off', '8811.00');
select test.check('the preparer can change a suggestion', (select line_no || '|' || mapping_source from public.cb_accounts where id = :'off') = '8811.00|preparer');

-- Entries.
select test.check('an entry must balance', test.try(format($f$select public.cb_add_entry(%L, 'AJE', 'accrual', 'Accounting fee', false, '[{"line":"8860.00","amount":2500},{"line":"2620.00","amount":-2400}]')$f$, :'f')) like '%out by 100%');
select test.check('no entry to a total line', test.try(format($f$select public.cb_add_entry(%L, 'AJE', 'accrual', 'Bad', false, '[{"line":"9368.00","amount":10},{"line":"2620.00","amount":-10}]')$f$, :'f')) like '%total line%');
select test.check('accounts must be matched first', test.try(format($f$select public.cb_add_entry(%L, 'AJE', 'correction', 'Fix', false, '[{"account":"%s","amount":100},{"line":"2620.00","amount":-100}]')$f$, :'f', :'adv')) like '%Match every account%');
select test.check('an RJE cannot change the result', test.try(format($f$select public.cb_add_entry(%L, 'RJE', 'reclassification', 'Move', false, '[{"account":"%s","amount":100},{"line":"2620.00","amount":-100}]')$f$, :'f', :'off')) like '%cannot change the result%');
select public.cb_add_entry(:'f', 'AJE', 'accrual', 'Accounting fee accrual', true, '[{"line":"8860.00","amount":2500},{"line":"2620.00","amount":-2500}]') as e1 \gset
select public.cb_add_entry(:'f', 'AJE', 'correction', 'Personal expense', false, format('[{"account":"%s","amount":-200},{"line":"2781.10","amount":200}]', :'off')::jsonb) as e2 \gset
select test.check('numbered AJE-1, AJE-2; free entries go to the reviewer', (select string_agg(kind || '-' || number || ':' || needs_review, ',' order by number) from public.cb_entries where file_id = :'f') = 'AJE-1:true,AJE-2:true');
select test.check('a line given by GIFI line adds an account on that line', (select line_no from public.cb_accounts where file_id = :'f' and account_key = 'line:8860.00') = '8860.00');
select test.check('only the reviewer approves', test.try(format($f$select public.cb_review_entry(%L)$f$, :'e1')) like '%reviewer approves%');
reset role;
reset request.jwt.claims;

-- The reviewer (owner A).
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_map_account(:'adv', '1301.10');
select test.check('the reviewer decides; saved for future years', (select mapping_source || '|' || needs_reviewer from public.cb_accounts where id = :'adv') = 'reviewer|false'
  and (select line_no from public.cb_client_mappings where client_id = :'client' and account_key = '5900') = '1301.10');
select public.cb_set_tax_code(:'off', 'NONDED');
select test.check('the reviewer sets a tax code', (select tax_code from public.cb_accounts where id = :'off') = 'NONDED');
select public.cb_review_entry(:'e1');
select test.check('approved entries cannot be deleted', test.try(format($f$select public.cb_delete_entry(%L)$f$, :'e1')) like '%cannot be deleted%');
select public.cb_delete_entry(:'e2');
select test.check('an unapproved entry can be deleted', (select count(*) from public.cb_entries where file_id = :'f') = 1);
-- Next year's file reuses the client's matching.
select public.cb_create_file(:'client', '2027-12-31', '2027-01-01', '', 'full', 'statements', :C::uuid, :A::uuid) as f2 \gset
select public.cb_import_tb(:'f2', 'this_year', 'client_software', 'tb.csv', '[{"number":"5300","name":"Office expenses","amount":50},{"number":"5900","name":"Johnson advance","amount":-50}]');
select public.cb_apply_matching(:'f2', '[]') as r2 \gset
select test.check('history is reused, with the reviewer''s tax code', (:'r2'::jsonb ->> 'history') = '2'
  and (select line_no || '|' || tax_code from public.cb_accounts where file_id = :'f2' and account_key = '5300') = '8811.00|NONDED');
-- Re-import keeps accounts used by entries.
select public.cb_import_tb(:'f', 'this_year', 'client_software', 'tb2.csv', '[{"number":"1000","name":"Chequing","amount":500},{"number":"4000","name":"Commission income","amount":-500}]');
select test.check('accounts an entry uses survive a re-import', exists (select 1 from public.cb_accounts where file_id = :'f' and account_key = 'line:8860.00'));
-- Monthly files take no entries.
select public.cb_create_file(:'client', '2025-12-31', '2025-01-01', '', 'monthly', 'concept_qbo', :C::uuid, :A::uuid) as m \gset
select test.check('monthly files: entries are made in QuickBooks', test.try(format($f$select public.cb_add_entry(%L, 'AJE', 'accrual', 'X fee', false, '[{"line":"8860.00","amount":1},{"line":"2620.00","amount":-1}]')$f$, :'m')) like '%QuickBooks%');
reset role;
reset request.jwt.claims;
