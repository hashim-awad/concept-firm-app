-- Local tests, round 21 (Hashim, Nov 15, 2026), step 2: one sign rule (dividends negative, 3720 and 3740
-- as printed), one place for Schedule 125, an account on every Schedule 100 line, source and PDF before
-- sign-off, the retained earnings message, and one problem counted once. Dummy data only.
\set ON_ERROR_STOP 1
-- Safe to run twice: the migration again on top of itself.
\ir ../migrations/20261210010000_round21_opening.sql
-- Step 2's problems, read as the database's owner (the function is private).
create function test.op(p uuid) returns text[] language sql security definer set search_path = '' as $$ select private.cb_opening_problems(p) $$;
grant execute on function test.op(uuid) to authenticated;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
insert into public.clients (kind, legal_name, province) values ('corporation', 'Maple Test Realty Inc.', 'ON') returning id as client \gset
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_create_file(:'client', '2026-12-31', '2026-01-01', '', 'full', 'statements', '00000000-0000-0000-0000-00000000000a'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid) as f \gset
select (public.cb_upload_bank(:'f', null, 'TD chequing', 'bank', 'a.csv', 47830, 47840, '[{"line":2,"date":"2026-01-02","description":"SAMPLE A","amount":10}]', '2026-01-01', '2026-01-31')) ->> 'account_id' as td \gset

-- Typed as printed on the T2: dividends 8,000.00 positive, a negative prior period adjustment, Schedule 125
-- revenue and expenses positive. 3849 = 41,930 + 20,000 − 8,000 − 1,200 = 52,730.
select public.cb_save_opening(:'f', format('[{"code":"1002","amount":47830,"account":"bank:%s"},{"code":"1744","amount":10000},{"code":"2620","amount":5000},{"code":"3500","amount":100},
  {"code":"3660","amount":41930},{"code":"3700","amount":8000},{"code":"3720","amount":-1200},{"code":"8120","amount":30000},{"code":"8810","amount":10000}]', :'td')::jsonb, 52730, null, '');
select test.check('dividends are stored negative', (select amount from public.cb_opening_balances where file_id = :'f' and code = '3700') = -8000);
select test.check('a prior period adjustment keeps the sign printed', (select amount from public.cb_opening_balances where file_id = :'f' and code = '3720') = -1200);
select public.cb_save_opening(:'f', format('[{"code":"1002","amount":47830,"account":"bank:%s"},{"code":"1744","amount":10000},{"code":"2620","amount":5000},{"code":"3500","amount":100},
  {"code":"3660","amount":41930},{"code":"3700","amount":-8000},{"code":"3720","amount":1200},{"code":"8120","amount":30000},{"code":"8810","amount":12400}]', :'td')::jsonb, 52730 + 2400 - 2400, null, '');
select test.check('typed negative, dividends stay negative; a positive adjustment stays positive',
  (select string_agg(code || '=' || amount, ',' order by code) from public.cb_opening_balances where file_id = :'f' and code in ('3700', '3720')) = '3700=-8000.00,3720=1200.00');
select public.cb_save_opening(:'f', format('[{"code":"1002","amount":47830,"account":"bank:%s"},{"code":"1744","amount":10000},{"code":"2620","amount":5000},{"code":"3500","amount":100},
  {"code":"3660","amount":41930},{"code":"3700","amount":8000},{"code":"3720","amount":-1200},{"code":"8120","amount":30000},{"code":"8810","amount":10000}]', :'td')::jsonb, 52730, null, '');
select test.check('the Schedule 125 tab is the one place: its lines are copied for the statements',
  (select string_agg(code || '=' || amount, ',' order by code) from public.cb_opening_s125 where file_id = :'f') = '8120=30000.00,8810=10000.00');
select test.check('a line with one standard account takes it (2620 on 21100, 3500 on 30000, 3660 on 31000, 3700 on 32200)',
  (select string_agg(code || ':' || coalesce(chart_account, '-'), ',' order by code) from public.cb_opening_balances where file_id = :'f' and code in ('2620', '3500', '3660', '3700')) = '2620:21100,3500:30000,3660:31000,3700:32200');
select test.check('3680 is a total: refused as a line', test.try(format($f$select public.cb_save_opening(%L, '[{"code":"3680","amount":1}]', null, null, '')$f$, :'f')) like '%total%');

-- What step 2 still needs: source, PDF and an account for 1744 (no standard chart account on it).
select test.check('each problem is its own line: source, PDF, 1744 account',
  test.op(:'f') = array['Type the source: which T2 or CRA assessment the balances come from.', 'Attach the PDF of last year''s T2 or the CRA assessment.', 'GIFI 1744: pick an account.']);
select test.check('the Issues panel lists each one under "To fix"',
  (public.cb_step_status(:'f') -> 'opening' -> 'problems') = to_jsonb(test.op(:'f')));
select test.check('sign-off refused without the source', test.try(format('select public.cb_sign_opening(%L)', :'f')) like 'Type the source%');
select test.check('the step sign-off refuses too', test.try(format($f$select public.cb_sign_step(%L, 'opening', 'prepared')$f$, :'f')) like 'Not yet: Type the source%');

-- 3660 left blank: flagged, and the plain message, difference in brackets.
select public.cb_save_opening(:'f', format('[{"code":"1002","amount":47830,"account":"bank:%s"},{"code":"1740","amount":10000},{"code":"2620","amount":5000},{"code":"3500","amount":100},
  {"code":"3700","amount":8000},{"code":"3720","amount":-1200},{"code":"8120","amount":30000},{"code":"8810","amount":10000}]', :'td')::jsonb, 52730, null, 'Prior T2, year ended Dec 31, 2025');
select test.check('3660 blank is flagged, and the tie message names the difference',
  test.op(:'f') = array['Attach the PDF of last year''s T2 or the CRA assessment.', 'Line 3660 is blank. Type it from last year''s T2, or 0.00 if the T2 shows none.',
    'Retained earnings do not tie. Start (3660) + net income (3680) − dividends (3700) + adjustments (3720, 3740) should equal 3849. Difference: (41,930.00). Check line 3660 on last year''s T2.']);
select public.cb_set_opening_pdf(:'f', 'closebook/' || :'f' || '/opening-1.pdf');
select public.cb_save_opening(:'f', format('[{"code":"1002","amount":47830,"account":"bank:%s"},{"code":"1740","amount":10000,"account":"15200"},{"code":"2620","amount":5000},{"code":"3500","amount":100},
  {"code":"3660","amount":41930},{"code":"3700","amount":8000},{"code":"3720","amount":-1200},{"code":"8120","amount":30000},{"code":"8810","amount":10000}]', :'td')::jsonb, 52730, null, 'Prior T2, year ended Dec 31, 2025');
select test.check('tied, with source, PDF and accounts: nothing left', cardinality(test.op(:'f')) = 0);
select public.cb_sign_step(:'f', 'opening', 'prepared');
select test.check('signed as preparer', (select opening_signed_at is not null from public.cb_files where id = :'f'));

-- 3680 typed when the Schedule 125 tab is empty.
select public.cb_unsign_step(:'f', 'opening', 'prepared');
select public.cb_save_opening(:'f', format('[{"code":"1002","amount":47830,"account":"bank:%s"},{"code":"1740","amount":10000,"account":"15200"},{"code":"2620","amount":5000},{"code":"3500","amount":100},
  {"code":"3660","amount":41930},{"code":"3700","amount":8000},{"code":"3720","amount":-1200}]', :'td')::jsonb, 52730, null, 'Prior T2');
select test.check('no Schedule 125 and no 3680: asked for', test.op(:'f') = array['Type last year''s net income (3680), or enter the Schedule 125 tab.']);
select test.check('emptying the Schedule 125 tab empties the copy', not exists (select 1 from public.cb_opening_s125 where file_id = :'f'));
select public.cb_save_opening(:'f', format('[{"code":"1002","amount":47830,"account":"bank:%s"},{"code":"1740","amount":10000,"account":"15200"},{"code":"2620","amount":5000},{"code":"3500","amount":100},
  {"code":"3660","amount":41930},{"code":"3700","amount":8000},{"code":"3720","amount":-1200}]', :'td')::jsonb, 52730, 20000, 'Prior T2');
select test.check('3680 typed: ties', cardinality(test.op(:'f')) = 0);
select public.cb_sign_step(:'f', 'opening', 'prepared');
reset role;

-- Item 11: one review note shows once. Open: under "To fix" only. Fixed: under "With the reviewer" only.
insert into public.cb_review_notes (file_id, step, target_type, body, created_by) values (:'f', 'opening', 'step', 'Check 3720 against the T2.', '00000000-0000-0000-0000-00000000000a') returning id as note \gset
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('an open note: "To fix" has it', (public.cb_step_status(:'f') -> 'opening' -> 'problems') ? '1 review note to fix.');
select test.check('an open note: "With the reviewer" does not repeat it', (public.cb_step_status(:'f') -> 'opening' -> 'waiting') = '[]'::jsonb);
select test.check('an open note still stops the reviewer''s sign-off', test.try(format($f$select public.cb_sign_step(%L, 'opening', 'reviewed')$f$, :'f')) like 'Not yet: 1 review note to clear.%');
reset role;
update public.cb_review_notes set status = 'fixed', fixed_by = created_by, fixed_at = now() where id = :'note';
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('fixed: "To fix" is clear', (public.cb_step_status(:'f') -> 'opening' -> 'problems') = '[]'::jsonb);
select test.check('fixed: with the reviewer, once', (public.cb_step_status(:'f') -> 'opening' -> 'waiting') = '["1 review note fixed, to clear."]'::jsonb);
reset role;

-- A first-year file: nothing to enter, nothing asked.
update public.cb_files set first_year = true where id = :'f';
select test.check('first year: no step 2 problems', cardinality(test.op(:'f')) = 0);
