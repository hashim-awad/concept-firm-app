-- Local tests: round 9b (Hashim, Nov 27, 2026), the account on each line of "Expenses paid personally",
-- chosen on the file.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
insert into public.clients (kind, legal_name, province) values ('corporation', 'Fir Test Realty Inc.', 'ON') returning id as client \gset
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_create_file(:'client', '2026-12-31', '2026-01-01', '', 'full', 'client_software', '00000000-0000-0000-0000-00000000000a'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid) as f \gset
select public.cb_import_tb(:'f', 'this_year', 'client_software', 'tb.csv', '[
  {"number":"10100","name":"Chequing","amount":1000},{"number":"64310","name":"Office supplies:Printing","amount":200},
  {"number":"64320","name":"Office supplies:Postage","amount":300},{"number":"26000","name":"Shareholder loan","amount":-1500}]');
select public.cb_map_account(id, case number when '10100' then '1002.00' when '26000' then '2781.10' else '8810.00' end) from public.cb_accounts where file_id = :'f';
select test.check('a pick line keeps its own picker', test.try(format($q$select public.cb_save_expense_line_account(%L, 'cra', 'client', '64320')$q$, :'f')) = 'This line''s account is picked on the entry itself.');
select test.check('an own-books file uses the client''s accounts, not the standard chart', test.try(format($q$select public.cb_save_expense_line_account(%L, 'office', 'chart', '65000')$q$, :'f')) = 'Choose one of the client''s accounts, or a new account.');
select test.check('only an account in the client''s books', test.try(format($q$select public.cb_save_expense_line_account(%L, 'office', 'client', '99999')$q$, :'f')) = 'Choose one of the client''s accounts.');
select test.check('a new account needs a name', test.try(format($q$select public.cb_save_expense_line_account(%L, 'office', 'new', 'ab')$q$, :'f')) = 'Name the new account in plain words.');
select public.cb_save_expense_line_account(:'f', 'office', 'client', '64320');
select public.cb_save_expense_line_account(:'f', 'meals', 'new', 'Client meals');
select public.cb_save_expense_line_account(:'f', 'meals', 'new', 'Client lunches');
reset role;
reset request.jwt.claims;
select test.check('the choice is kept for the file, one per line, by the client''s account number',
  (select string_agg(key || '=' || kind || ':' || value, ',' order by key) from public.cb_expense_line_accounts where file_id = :'f') = 'meals=new:Client lunches,office=client:64320');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_save_expense_line_account(:'f', 'meals', 'default', '');
reset role;
reset request.jwt.claims;
select test.check('back to the default removes the choice', not exists (select 1 from public.cb_expense_line_accounts where file_id = :'f' and key = 'meals'));
-- Next year's file for the same client reads the choice through the client (the app takes the newest).
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_create_file(:'client', '2027-12-31', '2027-01-01', '', 'full', 'client_software', '00000000-0000-0000-0000-00000000000a'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid) as f2 \gset
select test.check('the choice rolls forward: next year''s file sees it', (select count(*) from public.cb_expense_line_accounts l join public.cb_files x on x.id = l.file_id
  where x.client_id = :'client' and x.year_end <= '2027-12-31' and l.key = 'office') = 1);
reset role;
reset request.jwt.claims;
update public.cb_files set phase = 'locked' where id = :'f';
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('a locked file refuses a change', test.try(format($q$select public.cb_save_expense_line_account(%L, 'office', 'client', '64310')$q$, :'f')) = 'This file is locked or missing.');
reset role;
reset request.jwt.claims;
