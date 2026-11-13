-- Local tests: entries for clients who keep their own books (Hashim, Nov 15, 2026), and 31500 Prior period
-- adjustments in the standard chart.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
insert into public.clients (kind, legal_name, province) values ('corporation', 'Cedar Test Realty Inc.', 'ON') returning id as client \gset
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('31500 Prior period adjustments is on GIFI 3720', (select name || '|' || line_no from public.cb_chart_accounts where number = '31500') = 'Prior period adjustments|3720.00');
select public.cb_create_file(:'client', '2026-12-31', '2026-01-01', '', 'full', 'client_software', '00000000-0000-0000-0000-00000000000a'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid) as f \gset
select public.cb_import_tb(:'f', 'this_year', 'client_software', 'tb.csv', '[{"number":"15000","name":"Computer equipment","amount":6000},{"number":"15100","name":"Accum. amortization - computer","amount":-2400},{"number":"32000","name":"Retained earnings","amount":-3600}]');
select public.cb_map_account(id, case number when '15000' then '1774.00' when '15100' then '1775.00' else '3600.00' end) from public.cb_accounts where file_id = :'f';
select id as acc from public.cb_accounts where file_id = :'f' and number = '15100' \gset
select id as re from public.cb_accounts where file_id = :'f' and number = '32000' \gset
select test.check('a GIFI line alone is refused: the client''s account or a named new one', test.try(format($f$select public.cb_add_entry(%L, 'AJE', 'correction', 'Amortization', false, '[{"line":"8670.00","amount":1200},{"account":"%s","amount":-1200}]', 'Capital assets schedule')$f$, :'f', :'acc')) like '%name a new account%');
select test.check('a new account needs its QuickBooks type', test.try(format($f$select public.cb_add_entry(%L, 'AJE', 'correction', 'Amortization', false, '[{"line":"8670.00","new_name":"Amortization expense","amount":1200},{"account":"%s","amount":-1200}]', 'Capital assets schedule')$f$, :'f', :'acc')) like '%QuickBooks account type%');
select public.cb_add_entry(:'f', 'AJE', 'correction', 'To record amortization for the year.', false,
  format('[{"line":"8670.00","new_name":"Amortization expense","new_type":"Expenses","amount":1200},{"account":"%s","amount":-1200}]', :'acc')::jsonb, 'Capital assets schedule') as e1 \gset
select test.check('the new account carries the plain name, its type and the GIFI line', (select name || '|' || qbo_type || '|' || line_no || '|' || client_new from public.cb_accounts where file_id = :'f' and account_key = 'new:amortization expense')
  = 'Amortization expense|Expenses|8670.00|true');
select public.cb_add_entry(:'f', 'AJE', 'prior_period', 'Missed accrual last year.', false, format('[{"account":"%s","amount":500},{"account":"%s","amount":-500}]', :'re', :'acc')::jsonb, 'Prior year file');
select test.check('a prior period adjustment in the client''s books goes to a new "Prior period adjustments" account on 3720',
  (select name || '|' || qbo_type || '|' || line_no from public.cb_accounts where file_id = :'f' and account_key = 'new:prior period adjustments') = 'Prior period adjustments|Equity|3720.00');
select test.check('no GIFI-line account was created in the client''s books', not exists (select 1 from public.cb_accounts where file_id = :'f' and account_key like 'line:%'));
select test.check('32200 Dividends declared is on GIFI 3700, after the other dividend accounts', (select name || '|' || line_no from public.cb_chart_accounts where number = '32200') = 'Dividends declared|3700.00'
  and (select sort_order from public.cb_chart_accounts where number = '32200') = (select sort_order + 1 from public.cb_chart_accounts where number = '32100'));
