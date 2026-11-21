-- Local tests: CloseBook2 piece CB2-1 version 4, PR A (Hashim, Nov 21, 2026). Books per client: the client list, the client's
-- chart of accounts (new, edit, merge, inactive, History), journal entries saved by date with no type, and firm isolation
-- on every new table (Part 4.4). Dummy data only.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'), ('00000000-0000-0000-0000-00000000000b', 'other.b@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000b', 'Other Firm B', 'other.b@example.test', (select id from public.roles where name = 'Accountant'));
reset role;
update public.role_permissions set level = 'edit' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Accountant');
insert into public.firms (id, name) values ('00000000-0000-4000-8000-0000000000bb', 'Dummy Firm B');
update public.firm_members set firm_id = '00000000-0000-4000-8000-0000000000bb' where user_id = '00000000-0000-0000-0000-00000000000b';

-- Firm A: a year file made the old way gets its Books client.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
insert into public.clients (kind, legal_name, province) values ('corporation', 'Birch Dummy Books Inc.', 'ON') returning id as client \gset
select public.cb_create_file(:'client', '2026-12-31', '2026-01-01', '', 'full', 'statements', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a') as f \gset
select cb_client_id as c from public.cb_files where id = :'f' \gset
select test.check('a year file made the old way belongs to a Books client of the firm, linked to the Studio client',
  (select studio_client_id = :'client'::uuid and name = 'Birch Dummy Books Inc.' and firm_id = private.concept_firm() from public.cb_clients where id = :'c'));

-- Chart of accounts: New, the same number refused, edit, merge (asks once), inactive; one History row per action.
select public.cb_books_save_account(:'c', null, '65100', 'Office expenses', 'Expense', (select line_no from public.cb_chart_accounts where number = '65100'), 'HST_ON') as office \gset
select public.cb_books_save_account(:'c', null, '21100', 'Accrued liabilities', 'Liability', (select line_no from public.cb_chart_accounts where number = '21100'), null) as accr \gset
select public.cb_books_save_account(:'c', null, '65150', 'Dummy supplies', 'Expense', null, null) as supplies \gset
select test.check('a new account with no GIFI line saves (it shows as Unmatched)', (select line_no is null and source = 'user' from public.cb_client_accounts where id = :'supplies'));
select test.check('a second account with the same number is refused',
  test.try(format($q$select public.cb_books_save_account(%L, null, '65100', 'Office again', 'Expense', null, null)$q$, :'c')) = 'Account number 65100 is already used by Office expenses.');
select public.cb_books_save_account(:'c', :'supplies', '65150', 'Dummy office supplies', 'Expense', null, null);
select test.check('giving an account another account''s number asks once to merge',
  test.try(format($q$select public.cb_books_save_account(%L, %L, '65100', 'Dummy office supplies', 'Expense', null, null)$q$, :'c', :'supplies')) like 'MERGE|' || :'office' || '|65100 Office expenses');
select public.cb_books_save_account(:'c', :'supplies', '65100', 'Dummy office supplies', 'Expense', null, null, true);
select public.cb_books_set_active(:'accr', false);
reset role;
select test.check('the merged account points at the other; nothing posted is rewritten',
  (select merged_into = :'office'::uuid and not active from public.cb_client_accounts where id = :'supplies'));
select test.check('History: one row per action (added, changed, merged on both accounts, made inactive)',
  (select count(*) from public.cb_books_history where account_id = :'supplies') = 3
  and (select count(*) from public.cb_books_history where account_id = :'office' and action = 'account_merged_in') = 1
  and (select count(*) from public.cb_books_history where account_id = :'accr') = 2);
set role authenticated;
select public.cb_books_set_active(:'accr', true);

-- Journal entries by date: no type, memo optional, typed journal number, Reclass entry; the year that covers the date.
reset role;
select count(*) as h0 from public.cb_file_history where file_id = :'f' \gset
set role authenticated;
select public.cb_books_save_entry(:'c', null, '2026-06-30', 'JE-77', true, '', format('[{"account":"%s","amount":113,"memo":"Dummy"},{"account":"%s","amount":-113}]', :'office', :'accr')::jsonb) as e1 \gset
reset role;
select test.check('a Books entry: no type, memo empty, typed number, Reclass entry ticked, in the 2026 file',
  (select kind is null and note = '' and journal_no = 'JE-77' and is_reclass and file_id = :'f'::uuid and entry_date = '2026-06-30' from public.cb_entries where id = :'e1'));
select test.check('saving an entry writes one History row, naming its number', (select count(*) from public.cb_file_history where file_id = :'f') = :h0 + 1
  and exists (select 1 from public.cb_file_history where entry_id = :'e1' and detail like '%JE-77%'));
select test.check('its lines landed on the year''s own accounts by number',
  (select string_agg(a.number || ':' || l.amount, ',' order by a.number) from public.cb_entry_lines l join public.cb_accounts a on a.id = l.account_id where l.entry_id = :'e1') = '21100:-113.00,65100:113.00');
set role authenticated;
select test.check('an unbalanced entry is refused (the hard stop)',
  test.try(format($q$select public.cb_books_save_entry(%L, null, '2026-06-30', '', false, '', '[{"account":"%s","amount":10},{"account":"%s","amount":-9}]')$q$, :'c', :'office', :'accr')) like 'The entry does not balance%');
select test.check('a date no year covers is refused',
  test.try(format($q$select public.cb_books_save_entry(%L, null, '2030-01-15', '', false, '', '[{"account":"%s","amount":10},{"account":"%s","amount":-10}]')$q$, :'c', :'office', :'accr')) = 'No year in Closebook covers Jan 15, 2030. Add the year first.');
select public.cb_books_save_entry(:'c', null, '2025-12-31', '', false, 'Opening balances', format('[{"account":"%s","amount":50},{"account":"%s","amount":-50}]', :'office', :'accr')::jsonb, '{}', 'opening_balances') as ob \gset
reset role;
select test.check('the opening balances entry is dated the day before the year, marked as such, with its one History row',
  (select origin = 'opening_balances' and entry_date = '2025-12-31' and file_id = :'f'::uuid from public.cb_entries where id = :'ob')
  and (select count(*) from public.cb_file_history where file_id = :'f') = :h0 + 2);
set role authenticated;
select public.cb_books_save_entry(:'c', :'e1', '2026-07-31', 'JE-77', false, 'Changed', format('[{"account":"%s","amount":200},{"account":"%s","amount":-200}]', :'office', :'accr')::jsonb);
reset role;
select test.check('an entry changes in place, with one more History row',
  (select entry_date = '2026-07-31' and note = 'Changed' and not is_reclass from public.cb_entries where id = :'e1')
  and (select count(*) from public.cb_file_history where file_id = :'f') = :h0 + 3);
select test.check('the three opening refusals are gone (warnings only)',
  (select prosrc from pg_proc where proname = 'cb_entry_write_lines') not like '%Enter last year''''s closing retained earnings in step 2 first%'
  and (select prosrc from pg_proc where proname = 'cb_entry_write_lines') not like '%must clear Opening Balance Equity to nil%'
  and (select prosrc from pg_proc where proname = 'cb_entry_write_lines') not like '%is already moved to retained earnings by another entry%');

-- Part 4.4: firm B reads and changes nothing of firm A's clients, charts, History and tax codes.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b"}';
select test.check('firm B reads no Books client, client account, account History or tax code of firm A',
  (select count(*) from public.cb_clients) = 0 and (select count(*) from public.cb_client_accounts) = 0
  and (select count(*) from public.cb_books_history) = 0 and (select count(*) from public.cb_sales_tax_codes) = 0 and (select count(*) from public.cb_sales_tax_parts) = 0);
select test.check('firm B cannot change firm A''s chart, accounts or entries through the database functions',
  test.try(format($q$select public.cb_books_save_account(%L, null, '99999', 'Intruder', 'Expense', null, null)$q$, :'c')) = 'Client not found.'
  and test.try(format($q$select public.cb_books_save_account(%L, %L, '65100', 'Renamed', 'Expense', null, null)$q$, :'c', :'office')) = 'Client not found.'
  and test.try(format('select public.cb_books_set_active(%L, false)', :'office')) = 'Account not found.'
  and test.try(format($q$select public.cb_books_sync_accounts(%L, '[{"number":"1","name":"x","type":"Asset"}]')$q$, :'c')) = 'Client not found.'
  and test.try(format($q$select public.cb_books_save_entry(%L, null, '2026-06-30', '', false, '', '[{"account":"%s","amount":1},{"account":"%s","amount":-1}]')$q$, :'c', :'office', :'accr')) = 'Client not found.');
select test.check('firm B cannot write to firm A''s rows directly', test.try(format($q$update public.cb_client_accounts set name = 'x' where id = %L$q$, :'office')) <> 'OK'
  or (select name from public.cb_client_accounts where id = :'office') is null);
select public.cb_books_add_client('Dummy Firm B Client Ltd.', 'AB') as cb \gset
reset role;
select test.check('firm B adds its own client by hand; it carries firm B',
  (select firm_id = '00000000-0000-4000-8000-0000000000bb'::uuid and studio_client_id is null and province = 'AB' from public.cb_clients where id = :'cb'));
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('firm A does not see firm B''s client', not exists (select 1 from public.cb_clients where id = :'cb'));
select test.check('firm A''s account is unchanged', (select name from public.cb_client_accounts where id = :'office') = 'Office expenses');
