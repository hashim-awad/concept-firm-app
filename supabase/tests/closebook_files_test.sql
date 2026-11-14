-- Local tests: Closebook files, core documents and trial balance import (step 1, part 2a).
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test', (select id from public.roles where name = 'Staff'));
insert into public.clients (kind, legal_name, province) values ('corporation', 'Maple Test Realty Inc.', 'ON') returning id as client \gset
insert into public.clients (kind, legal_name, province) values ('individual', 'Pat Test', 'ON') returning id as person \gset
\set A '''00000000-0000-0000-0000-00000000000a'''
\set C '''00000000-0000-0000-0000-00000000000c'''

-- New file.
select test.check('only companies get a file', test.try(format($f$select public.cb_create_file(%L, '2026-12-31', '2026-01-01', '', 'full', 'statements', %L, %L)$f$, :'person', :A, :A)) like '%company%');
select test.check('a short year needs a reason', test.try(format($f$select public.cb_create_file(%L, '2026-12-31', '2026-05-01', '', 'full', 'statements', %L, %L)$f$, :'client', :A, :A)) like '%reason%');
select test.check('monthly files are Concept QuickBooks clients', test.try(format($f$select public.cb_create_file(%L, '2026-12-31', '2026-01-01', '', 'monthly', 'statements', %L, %L)$f$, :'client', :A, :A)) <> 'OK');
select public.cb_create_file(:'client', '2026-12-31', '2026-01-01', '', 'full', 'statements', :A::uuid, :A::uuid) as f \gset
select test.check('the full file has the 18 core documents, F4 included', (select count(*) from public.cb_documents where file_id = :'f') = 18
  and (select title from public.cb_documents where file_id = :'f' and code = 'F3') = 'Reconcile bank and cards');
select test.check('one file per client and year-end', test.try(format($f$select public.cb_create_file(%L, '2026-12-31', '2026-01-01', '', 'full', 'statements', %L, %L)$f$, :'client', :A, :A)) like '%already has a file%');
select public.cb_create_file(:'client', '2025-12-31', '2025-05-15', 'Incorporated May 15, 2025', 'monthly', 'concept_qbo', :A::uuid, :A::uuid) as m \gset
select test.check('a monthly file: no entries document, bank and cards confirmed', (select count(*) from public.cb_documents where file_id = :'m') = 17
  and not exists (select 1 from public.cb_documents where file_id = :'m' and code = 'F4')
  and (select title from public.cb_documents where file_id = :'m' and code = 'F3') = 'Confirm bank and cards'
  and (select year_change_reason from public.cb_files where id = :'m') = 'Incorporated May 15, 2025');

-- Trial balance import.
select test.check('an import must balance', test.try(format($f$select public.cb_import_tb(%L, 'this_year', 'client_software', 'tb.csv', '[{"number":"1000","name":"Chequing","amount":100},{"number":"4000","name":"Revenue","amount":-90}]')$f$, :'f')) like '%does not balance%difference 10%');
select public.cb_import_tb(:'f', 'this_year', 'client_software', 'tb.csv', '[{"number":"1000","name":"Chequing","amount":1500.25},{"number":"4000","name":"Revenue","amount":-2000},{"number":"","name":"Office  supplies","amount":499.75}]');
select test.check('accounts saved; no number means the name is the key', (select count(*) from public.cb_accounts where file_id = :'f') = 3
  and (select this_year from public.cb_accounts where file_id = :'f' and account_key = 'office supplies') = 499.75);
select public.cb_import_tb(:'f', 'last_year', 'prior_accountant', 'prior.csv', '[{"number":"1000","name":"Chequing","amount":800},{"number":"3600","name":"Retained earnings","amount":-800}]');
select test.check('last year goes in its own column, accounts matched', (select last_year || '/' || this_year from public.cb_accounts where file_id = :'f' and account_key = '1000') = '800.00/1500.25'
  and (select count(*) from public.cb_accounts where file_id = :'f') = 4);
select public.cb_import_tb(:'f', 'this_year', 'client_software', 'tb2.csv', '[{"number":"1000","name":"Chequing","amount":1000},{"number":"4000","name":"Revenue","amount":-1000}]');
select test.check('importing again replaces this year; empty accounts go', (select count(*) from public.cb_accounts where file_id = :'f') = 3
  and not exists (select 1 from public.cb_accounts where file_id = :'f' and account_key = 'office supplies')
  and (select last_year from public.cb_accounts where file_id = :'f' and account_key = '3600') = -800);
select test.check('each import is recorded', (select count(*) from public.cb_imports where file_id = :'f') = 3);
reset role;
reset request.jwt.claims;

-- Staff without Closebook.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('staff without Closebook see no files', (select count(*) from public.cb_files) = 0);
select test.check('and cannot start one', test.try(format($f$select public.cb_create_file(%L, '2027-12-31', '2027-01-01', '', 'full', 'statements', %L, %L)$f$, :'client', :C, :C)) like '%Edit on Closebook%');
select test.check('or import', test.try(format($f$select public.cb_import_tb(%L, 'this_year', 'client_software', 'x', '[{"number":"1","name":"A","amount":0}]')$f$, :'f')) like '%Edit on Closebook%');
reset role;
reset request.jwt.claims;
