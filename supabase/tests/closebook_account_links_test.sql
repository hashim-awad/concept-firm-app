-- Local tests: account links (Hashim, Nov 18, 2026, round 4b): unique bank account numbers, last year's
-- balance on the chosen bank account, and no posting on a bare GIFI line in a file on the standard chart.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
insert into public.clients (kind, legal_name, province) values ('corporation', 'Birch Test Realty Inc.', 'ON') returning id as client \gset
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_create_file(:'client', '2026-12-31', '2026-01-01', '', 'full', 'statements', '00000000-0000-0000-0000-00000000000a'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid) as f \gset
select (public.cb_upload_bank(:'f', null, 'TD chequing', 'bank', 'a.csv', 100, 110, '[{"line":2,"date":"2026-01-02","description":"SAMPLE A","amount":10}]', '2026-01-01', '2026-01-31')) ->> 'account_id' as td \gset
select (public.cb_upload_bank(:'f', null, 'TD savings 9999', 'bank', 'b.csv', 0, 5, '[{"line":2,"date":"2026-01-03","description":"SAMPLE B","amount":5}]', '2026-01-01', '2026-01-31')) ->> 'account_id' as sv \gset
select (public.cb_upload_bank(:'f', null, 'Visa 1234', 'card', 'c.csv', 0, 5, '[{"line":2,"date":"2026-01-04","description":"SAMPLE C","amount":5}]', '2026-01-01', '2026-01-31')) ->> 'account_id' as visa \gset
select test.check('each bank account has its own number: the first on 10000 takes it, the next 10010',
  (select string_agg(name || '=' || number, ',' order by number) from public.cb_bank_accounts where file_id = :'f') = 'TD chequing=10000,TD savings 9999=10010,Visa 1234=22000');
select test.check('two bank accounts never share a number in a file', test.try(format($f$update public.cb_bank_accounts set number = '10000' where id = %L$f$, :'sv')) <> 'OK');
select public.cb_set_bank_chart_account(:'sv', '10100');
select test.check('moving savings to 10100 Savings gives it that number', (select number from public.cb_bank_accounts where id = :'sv') = '10100');
select public.cb_set_bank_chart_account(:'sv', '10000');
-- Step 2: last year's 1002 on TD chequing.
select public.cb_save_opening(:'f', format('[{"code":"1002","amount":48210,"account":"bank:%s"},{"code":"3660","amount":48210}]', :'td')::jsonb, 48210, 0, 'Prior T2');
select test.check('last year''s balance names the bank account it belongs to', (select bank_account from public.cb_opening_balances where file_id = :'f' and code = '1002') = :'td'::uuid);
select test.check('a bank account on another GIFI line is refused', test.try(format($f$select public.cb_save_opening(%L, '[{"code":"1002","amount":1,"account":"bank:%s"}]', null, null, '')$f$, :'f', :'visa')) like '%not on GIFI line 1002%');
reset role;
-- An entry from before November 16 on a bare GIFI line (8670), and one on a line with no chart account.
insert into public.cb_accounts (file_id, account_key, number, name, line_no) values (:'f', 'line:8670.00', '', 'Amortization of tangible assets', '8670.00') returning id as l1 \gset
insert into public.cb_accounts (file_id, account_key, number, name, line_no) values (:'f', 'line:1004.00', '', 'Deposits in foreign banks – Canadian currency', '1004.00') returning id as l2 \gset
insert into public.cb_entries (file_id, kind, number, seq, reason, note, wp_ref) values (:'f', 'AJE', 1, 1, 'correction', 'Amortization', 'Capital assets schedule') returning id as e \gset
insert into public.cb_entry_lines (entry_id, account_id, amount) values (:'e', :'l1', 1960), (:'e', :'l2', -1960);
select private.cb_repair_line_postings();
select test.check('the line moves to the chart account on that line (61500), and the bare line account goes',
  (select string_agg(a.account_key || ':' || a.number, ',' order by l.amount desc) from public.cb_entry_lines l join public.cb_accounts a on a.id = l.account_id where l.entry_id = :'e')
    like 'chart:61500:61500,line:1004.00:%' and not exists (select 1 from public.cb_accounts where id = :'l1'));
select test.check('a line with no chart account keeps its account, with a 5-digit number in its type''s range',
  (select number from public.cb_accounts where id = :'l2') ~ '^19\d{3}$');
