-- Local tests, round 21 (Hashim, Nov 16, 2026): the 16 standard chart accounts, summary GIFI lines offering
-- their detail lines' accounts in step 2 (Recommendation A), and 17500 in shareholder 1's loan schedule
-- (the s.15(2) check) while the director accounts stay out. Dummy data only.
\set ON_ERROR_STOP 1
-- Safe to run twice: the migration again on top of itself.
\ir ../migrations/20261210030000_round21_chart_accounts.sql
create function test.on_code(p text) returns text[] language sql security definer set search_path = '' as $$ select private.cb_chart_on_code(p) $$;
create function test.sh_problems(p uuid) returns text[] language sql security definer set search_path = '' as $$ select private.cb_sh_problems(p) $$;
grant execute on function test.on_code(text), test.sh_problems(uuid) to authenticated;

select test.check('the 16 accounts are in the chart, once',
  (select count(*) from public.cb_chart_accounts where number in ('13100', '15700', '15750', '15800', '15850', '15900', '15950', '16250', '17500', '17600', '21250', '23150', '25450', '25500', '30200', '31600')) = 16);
select test.check('chart order is number order (15700 between 15650 and 15750; 32200 right after 32100)',
  (select sort_order from public.cb_chart_accounts where number = '15650') < (select sort_order from public.cb_chart_accounts where number = '15700')
  and (select sort_order from public.cb_chart_accounts where number = '15700') < (select sort_order from public.cb_chart_accounts where number = '15750')
  and (select sort_order from public.cb_chart_accounts where number = '32200') = (select sort_order + 1 from public.cb_chart_accounts where number = '32100')
  and (select count(distinct sort_order) from public.cb_chart_accounts) = (select count(*) from public.cb_chart_accounts));
select test.check('3260 offers 25400 (on 3261) and the director''s 25450 (on 3263)', test.on_code('3260') = array['25400', '25450']);
select test.check('2780 offers 23000, 23050 and 23150', test.on_code('2780') = array['23000', '23050', '23150']);
select test.check('1740 offers its own 15200 first, then its detail lines''', (test.on_code('1740'))[1] = '15200' and '15700' = any(test.on_code('1740')) and '15300' = any(test.on_code('1740')));
select test.check('a detail line keeps its own account only', test.on_code('1744') = array['15700'] and test.on_code('3261') = array['25400']);
select test.check('3740 has 31600 now', test.on_code('3740') = array['31600']);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
insert into public.clients (kind, legal_name, province) values ('corporation', 'Spruce Test Realty Inc.', 'ON') returning id as client \gset
insert into public.clients (kind, legal_name, province) values ('corporation', 'Willow Test Realty Inc.', 'ON') returning id as client2 \gset
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_create_file(:'client', '2026-12-31', '2026-01-01', '', 'full', 'statements', '00000000-0000-0000-0000-00000000000a'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid) as f \gset
select (public.cb_upload_bank(:'f', null, 'TD chequing', 'bank', 'a.csv', 62679, 62689, '[{"line":2,"date":"2026-01-02","description":"SAMPLE A","amount":10}]', '2026-01-01', '2026-01-31')) ->> 'account_id' as td \gset

-- Step 2: last year's T2 printed the summary lines 1000 and 3260 (GIFI-Short).
select public.cb_save_opening(:'f', format('[{"code":"1000","amount":62679,"account":"bank:%s"},{"code":"3260","amount":12849,"account":"25400"},{"code":"1744","amount":10000},{"code":"3660","amount":49830}]', :'td')::jsonb, 49830, 0, 'Prior T2');
select test.check('1000 sits on the file''s bank account (on 1002); 3260 on 25400; 1744 takes 15700, its only account',
  (select string_agg(code || ':' || coalesce(chart_account, case when bank_account = :'td'::uuid then 'td' end, '-'), ',' order by code) from public.cb_opening_balances where file_id = :'f')
    = '1000:td,1744:15700,3260:25400,3660:31000');
select test.check('an account off the line and its detail lines is refused',
  test.try(format($q$select public.cb_save_opening(%L, '[{"code":"3260","amount":1,"account":"15700"}]', null, null, '')$q$, :'f')) like '%not on GIFI line 3260%');

-- The shareholder loan schedule: a long-term amount owed by shareholder 1 on 17500 (8,000.00 at the start,
-- 7,000.00 at the end). The schedule applies, and the s.15(2) flag waits for the preparer's answer.
select public.cb_build_tb(:'f', '[{"key":"chart:17500","number":"17500","name":"Due from shareholder (long-term)","line_no":"2181.00","amount":7000,"last":8000,"reviewer":""},
  {"key":"chart:10000","number":"10000","name":"Chequing","line_no":"1002.00","amount":-7000,"last":-8000,"reviewer":""}]');
select test.check('17500 with a balance: the schedule is needed', test.sh_problems(:'f') = array['Shareholder loan schedule: prepare it.']);
select test.check('the standard chart sets 17500''s shareholder', test.try(format($q$select public.cb_set_sh_owner(%L, 'chart:17500', 2)$q$, :'f')) like '%standard chart sets%');
select public.cb_prepare_sh_schedule(:'f', '[{"account_key":"chart:17500","number":"17500","name":"Due from shareholder (long-term)","line_no":"2181.00","opening":8000,"closing":7000,"tb":7000,"shareholder":1,"owner_source":"chart"}]',
  '[{"group_key":"sh:1","shareholder":1,"accounts":["chart:17500"],"opening":8000,"closing":7000,"reductions":1000,"last_part":7000,"this_part":0,"due_on":"",
    "prior_due_on":"2026-12-31","prior_opening":8000,"prior_repaid":1000,"prior_unpaid":7000,"flags":["earlier_debit"],"flag_amounts":{"earlier_debit":7000}}]');
select test.check('the s.15(2) flag on 17500''s 7,000.00 is open for the preparer',
  exists (select 1 from public.cb_sh_flags where file_id = :'f' and flag = 'earlier_debit' and closing = 7000)
  and 'Shareholder loan schedule: answer 1 flag for the reviewer.' = any (test.sh_problems(:'f')));

-- A director who is not a shareholder: 13100 alone is outside the schedule.
select public.cb_create_file(:'client2', '2026-12-31', '2026-01-01', '', 'full', 'statements', '00000000-0000-0000-0000-00000000000a'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid) as g \gset
select public.cb_build_tb(:'g', '[{"key":"chart:13100","number":"13100","name":"Due from director","line_no":"1303.00","amount":5000,"last":5000,"reviewer":""},
  {"key":"chart:10000","number":"10000","name":"Chequing","line_no":"1002.00","amount":-5000,"last":-5000,"reviewer":""}]');
select test.check('13100 alone: no shareholder loan schedule', cardinality(test.sh_problems(:'g')) = 0);
select test.check('13100 cannot be given a shareholder', test.try(format($q$select public.cb_set_sh_owner(%L, 'chart:13100', 1)$q$, :'g')) like '%director who is not a shareholder%');
reset role;
