-- Local tests: round 13 (Hashim, Nov 14, 2026), the GST/HST return: who gets one, the new step 1 answers,
-- step 8's sign-off waiting for the year's returns and the check against 21500, the reviewer over the
-- threshold, the settings, and step 10's filing record needed by the lock.
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
insert into public.clients (kind, legal_name, province) values ('corporation', 'Oak Test Realty Inc.', 'ON') returning id as client \gset
insert into public.clients (kind, legal_name, province) values ('corporation', 'Elm Test Realty Inc.', 'ON') returning id as client2 \gset
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_create_file(:'client', '2026-12-31', '2026-01-01', '', 'full', 'statements', '00000000-0000-0000-0000-00000000000c'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid) as f \gset
select public.cb_create_file(:'client2', '2026-12-31', '2026-01-01', '', 'full', 'client_software', '00000000-0000-0000-0000-00000000000c'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid) as own \gset
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('the RT account is RT and four digits', test.try(format($q$select public.cb_save_setup(%L, '{"gst_rt":"RT1"}')$q$, :'f')) = 'The GST/HST account is RT and four digits, for example RT0001.');
select public.cb_save_setup(:'f', '{"gst_registered":true,"gst_frequency":"quarterly","quick_method":false,"gst_rt":"RT0001","gst_year_same":true}');
select public.cb_save_setup(:'own', '{"gst_registered":true,"gst_frequency":"annual","quick_method":false}');
reset role;
reset request.jwt.claims;
select test.check('full files built here have a return; own books do not', private.cb_gst_applies(:'f') and not private.cb_gst_applies(:'own'));
select test.check('quarterly: four returns in the year', private.cb_gst_period_count(:'f') = 4);
select test.check('step 8 waits for the year''s returns', private.cb_gst_problems(:'f') = array['Prepare the GST/HST returns for the year (0 of 4 prepared).']);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('a period outside the year is refused', test.try(format($q$select public.cb_prepare_gst_return(%L, 5, 'Q5', '2027-01-01', '2027-03-31', '2027-04-30', 0, '{"113":0}')$q$, :'f')) = 'That period is not in the fiscal year.');
select test.check('own books: no return', test.try(format($q$select public.cb_prepare_gst_return(%L, 1, 'Y', '2026-01-01', '2026-12-31', '2027-03-31', 0, '{"113":0}')$q$, :'own')) = 'This file has no GST/HST return built in Closebook.');
select public.cb_prepare_gst_return(:'f', n, format('Quarter %s', n), ('2026-01-01'::date + ((n - 1) * 3 || ' months')::interval)::date,
  (('2026-01-01'::date + (n * 3 || ' months')::interval)::date - 1), (('2026-01-01'::date + (n * 3 + 1 || ' months')::interval)::date - 1), 0, '{"103":130000,"106":26000,"109":104000,"113":104000}')
  from generate_series(1, 4) n;
select public.cb_save_gst_check(:'f', 4160, 4160, '');
reset role;
reset request.jwt.claims;
select test.check('all four prepared, the check ties: nothing open', private.cb_gst_problems(:'f') = '{}');
-- A difference under the threshold needs one line; over it, the reviewer.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_save_gst_check(:'f', 4160, 4172.50, '');
reset role;
reset request.jwt.claims;
select test.check('a small difference: explain it in one line', private.cb_gst_problems(:'f') = array['GST/HST payable (21500) differs from the balances owing on the returns by 12.50: explain it in one line, or fix it with an entry.']);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_save_gst_check(:'f', 4160, 4172.50, 'Rounding on the CRA instalment of March 31.');
select public.cb_save_gst_check(:'f', 4160, 14160, '');
select test.check('the preparer cannot accept a difference', test.try(format($q$select public.cb_accept_gst_check(%L, 'ok')$q$, :'f')) like 'Only the reviewer accepts%');
reset role;
reset request.jwt.claims;
select test.check('over the review threshold: the reviewer decides', (private.cb_gst_problems(:'f'))[1] like '%over the review threshold: the reviewer accepts it, or fix it with an entry.');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_accept_gst_check(:'f', 'Last year''s return was reassessed; adjusted next year.');
reset role;
reset request.jwt.claims;
select test.check('accepted by the reviewer: nothing open', private.cb_gst_problems(:'f') = '{}');
-- The books change: the returns must be prepared again.
update public.cb_files set opening_note = 'changed' where id = :'f';
insert into public.cb_accounts (file_id, account_key, number, name, line_no, this_year) values (:'f', 'chart:21500', '21500', 'GST/HST payable', '2680.00', -100);
select test.check('the books changed: prepare again', private.cb_gst_problems(:'f') = array['The books changed after the GST/HST returns were prepared. Prepare them again.']);
-- Settings.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('only an owner changes the GST/HST settings', test.try($q$select public.cb_update_gst_settings(3, 1, null, null, '[]')$q$) like 'Only an owner%');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_update_gst_settings(3, 1, 0.01, 30000, '[{"province":"ON","rate":0.088},{"province":"BC","rate":""}]');
reset role;
reset request.jwt.claims;
select test.check('settings: due dates, credit and the rate kept', (select gst_due_months_annual = 3 and gst_due_months_period = 1 and quick_credit_rate = 0.01 and quick_credit_limit = 30000 from public.cb_settings)
  and (select rate from public.cb_gst_quick_rates where province = 'ON') = 0.088 and not exists (select 1 from public.cb_gst_quick_rates where province = 'BC'));
-- Step 10: each return's filing date and confirmation; the lock needs them.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_save_gst_filing(:'f', 1, '2026-04-20', 'gst-4401');
reset role;
reset request.jwt.claims;
select test.check('the lock names each return still to record', private.cb_lock_problems(:'f') @> array['GST/HST return Quarter 2: the filing date and CRA confirmation number are not recorded.']
  and not private.cb_lock_problems(:'f') @> array['GST/HST return Quarter 1: the filing date and CRA confirmation number are not recorded.']);
select test.check('the confirmation number is kept in capitals', (select confirmation from public.cb_gst_returns where file_id = :'f' and period_no = 1) = 'GST-4401');

-- Round 13 fixes: the revenue check takes the returns' sales; entries into 21500 are instalment candidates.
update public.cb_gst_returns set lines = lines || '{"sales": 1000000}' where file_id = :'f';
select test.check('step 5''s cross-check takes the returns'' sales before tax', (private.cb_revenue_state(:'f') ->> 'gst_from_return')::boolean
  and (private.cb_revenue_state(:'f') ->> 'gst')::numeric = 40000 and (private.cb_revenue_state(:'f') ->> 'n_gst')::int = 4);
select test.check('own books: the cross-check stays typed', not (private.cb_revenue_state(:'own') ->> 'gst_from_return')::boolean);
select test.check('the quick method gain account: 42400 on GIFI 8230', exists (select 1 from public.cb_chart_accounts where number = '42400' and line_no = '8230.00' and account_type = 'Revenue'));
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_add_entry(:'f', 'RJE', 'reclassification', 'Instalment first recorded as income tax', false,
  '[{"chart":"21500","amount":300,"memo":"HST instalment"},{"chart":"21400","amount":-300,"memo":"HST instalment"}]', 'GST-1') as rje \gset
select test.check('an entry from another file is refused', test.try(format($q$select public.cb_confirm_gst_entry(%L, gen_random_uuid(), true)$q$, :'f')) = 'That entry is not in this file.');
select public.cb_confirm_gst_entry(:'f', :'rje', true);
reset role;
reset request.jwt.claims;
select test.check('confirmed as an instalment: kept, the returns to prepare again', (select :'rje'::uuid = any(instalment_entries) from public.cb_gst_check where file_id = :'f')
  and not exists (select 1 from public.cb_gst_returns where file_id = :'f') and exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'gst_instalment_entry'));
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_confirm_gst_entry(:'f', :'rje', false);
reset role;
reset request.jwt.claims;
select test.check('left out again', (select not (:'rje'::uuid = any(instalment_entries)) from public.cb_gst_check where file_id = :'f'));
