-- Local tests: Closebook step 3, coding bank and card lines (Hashim, Nov 13, 2026).
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'owner.b@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test', (select id from public.roles where name = 'Staff'));
reset role;
reset request.jwt.claims;
update public.role_permissions set level = 'edit' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Staff');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
insert into public.clients (kind, legal_name, province) values ('corporation', 'Maple Test Realty Inc.', 'ON') returning id as client \gset
\set A '''00000000-0000-0000-0000-00000000000a'''
\set C '''00000000-0000-0000-0000-00000000000c'''
-- Staff C prepares, owner A reviews.
select public.cb_create_file(:'client', '2026-12-31', '2026-01-01', '', 'full', 'statements', :C::uuid, :A::uuid) as f \gset
select (public.cb_upload_bank(:'f', null, 'Visa 1234', 'card', 'v.csv', 0, 452.4,
  '[{"line":2,"date":"2026-01-02","description":"SAMPLE PIZZA","amount":113},{"line":3,"date":"2026-01-05","description":"SAMPLE SOFTWARE","amount":226},{"line":4,"date":"2026-01-09","description":"SAMPLE RENT","amount":113.4}]',
  '2026-01-01', '2026-01-31')) ->> 'account_id' as acc \gset
select test.check('the standard chart and the tax codes are in Settings', (select count(*) from public.cb_chart_accounts) = 144
  and (select sum(rate) from public.cb_sales_tax_parts where code = 'MEALS_HST_50') = 0.13
  and (select count(*) from public.cb_sales_tax_codes where provinces is null) = 3);
select test.check('a new card account sits on Credit card', (select chart_account from public.cb_bank_accounts where id = :'acc') = '2200');
select id as pizza from public.cb_bank_lines where description = 'SAMPLE PIZZA' \gset
select id as soft from public.cb_bank_lines where description = 'SAMPLE SOFTWARE' \gset
select id as rent from public.cb_bank_lines where description = 'SAMPLE RENT' \gset

set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_save_setup(:'f', '{"gst_registered": true, "gst_frequency": "quarterly", "quick_method": false}');
select test.check('setup answers saved', (select setup ->> 'gst_frequency' from public.cb_files where id = :'f') = 'quarterly');
select test.check('unknown setup questions are refused', test.try(format($f$select public.cb_save_setup(%L, '{"color": "blue"}')$f$, :'f')) like '%Unknown question%');
select public.cb_code_lines(:'f', format('[{"id":"%s","account":"6020","tax":"HST_ON"},{"id":"%s","account":"6520","tax":"HST_ON"},{"id":"%s","account":"6710","tax":"HST_ON"}]', :'pizza', :'soft', :'rent')::jsonb);
select test.check('meals at the full rate go to the reviewer', (select status || '|' || reviewer_reason from public.cb_bank_lines where id = :'pizza') like 'reviewer|Meals coded at the full rate%');
select test.check('a normal line is done', (select status from public.cb_bank_lines where id = :'soft') = 'done');
select test.check('a "Check" account goes to the reviewer', (select status from public.cb_bank_lines where id = :'rent') = 'reviewer');
select public.cb_save_vendor_rule(:'f', 'SAMPLE SOFTWARE', '6520', 'HST_ON');
select test.check('vendor rules belong to the client', (select count(*) from public.cb_vendor_rules where client_id = :'client' and vendor_key = 'SAMPLE SOFTWARE') = 1);
select public.cb_ask_client(:'f', array[:'rent']::uuid[]);
select test.check('a line can go on the client question list', (select status from public.cb_bank_lines where id = :'rent') = 'ask_client');

-- The reviewer's coding is final, Check or not.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_code_lines(:'f', format('[{"id":"%s","account":"6020","tax":"MEALS_HST_50"},{"id":"%s","account":"6710","tax":"HST_ON"}]', :'pizza', :'rent')::jsonb);
select test.check('the reviewer decides', (select string_agg(status, ',' order by description) from public.cb_bank_lines where file_id = :'f') = 'done,done,done');
select (public.cb_upload_bank(:'f', :'acc', '', '', 'v2.csv', 452.4, 565.4, '[{"line":2,"date":"2026-02-02","description":"SAMPLE DINER","amount":113}]', '2026-02-01', '2026-02-28')) is not null;
select public.cb_code_lines(:'f', format('[{"id":"%s","account":"6020","tax":"HST_ON"}]', (select id from public.cb_bank_lines where description = 'SAMPLE DINER'))::jsonb);
select test.check('no sales tax code: refused, nothing saved', test.try(format($f$select public.cb_code_lines(%L, '[{"id":"%s","account":"6510","tax":""}]')$f$, :'f', (select id from public.cb_bank_lines where description = 'SAMPLE DINER'))) like '%Choose a sales tax code%'
  and (select status from public.cb_bank_lines where description = 'SAMPLE DINER') = 'reviewer');
select test.check('even the reviewer coding meals at the full rate sends it to the reviewer list first', (select status from public.cb_bank_lines where description = 'SAMPLE DINER') = 'reviewer');
select public.cb_uncode_lines(:'f', array[:'soft']::uuid[]);
select test.check('Undo puts a coded line back in Needs you, cleared', (select status || '|' || coalesce(chart_account, '-') || '|' || coalesce(tax_code, '-') from public.cb_bank_lines where id = :'soft') = 'new|-|-');
select test.check('only the six bank chart accounts', test.try(format($f$select public.cb_set_bank_chart_account(%L, '6510')$f$, :'acc')) like '%Choose chequing%');
-- The built trial balance (step 3 to step 4).
select test.check('an unbalanced build is refused', test.try(format($f$select public.cb_build_tb(%L, '[{"key":"chart:6510","number":"6510","name":"Office","line_no":"8810.00","amount":5}]')$f$, :'f')) like '%does not balance%');
select public.cb_build_tb(:'f', '[{"key":"chart:1000","number":"1000","name":"Chequing","line_no":"1002.00","amount":100},{"key":"chart:6510","number":"6510","name":"Office","line_no":"8810.00","amount":20},{"key":"opening","number":"","name":"Opening balances to enter","line_no":"","amount":-120,"reviewer":"Enter last year."}]');
select test.check('built rows saved with their GIFI line; the holding account waits for the reviewer',
  (select line_no || '|' || mapping_source || '|' || this_year from public.cb_accounts where file_id = :'f' and account_key = 'chart:6510') = '8810.00|chart|20.00'
  and (select needs_reviewer from public.cb_accounts where file_id = :'f' and account_key = 'opening'));
reset role;
update public.cb_accounts set line_no = '8811.00', mapping_source = 'reviewer' where file_id = :'f' and account_key = 'chart:6510';
set role authenticated;
select public.cb_build_tb(:'f', '[{"key":"chart:1000","number":"1000","name":"Chequing","line_no":"1002.00","amount":100},{"key":"opening","number":"","name":"Opening balances to enter","line_no":"","amount":-100,"reviewer":"Enter last year."}]');
select test.check('a rebuild keeps the reviewer''s GIFI line and removes empty built rows',
  not exists (select 1 from public.cb_accounts where file_id = :'f' and account_key = 'chart:6510')
  and (select this_year from public.cb_accounts where file_id = :'f' and account_key = 'chart:1000') = 100);
-- Opening balances by GIFI code.
select test.check('a typed or imported route needs last year''s 3849', test.try(format($f$select public.cb_set_opening(%L, 'manual', '[{"code":"1002","amount":100}]', null)$f$, :'f')) like '%3849%');
select test.check('3849 itself is refused as a line', test.try(format($f$select public.cb_set_opening(%L, 'manual', '[{"code":"3849","amount":100}]', 100)$f$, :'f')) like '%cannot be used%');
select public.cb_set_opening(:'f', 'gifi_file', '[{"code":"1002","amount":100},{"code":"3660","amount":100}]', 100);
select test.check('opening balances saved with their source', (select count(*) from public.cb_opening_balances where file_id = :'f') = 2
  and (select opening_source || '|' || opening_re_stated from public.cb_files where id = :'f') = 'gifi_file|100.00');
select public.cb_build_tb(:'f', '[{"key":"chart:1000","number":"1000","name":"Chequing","line_no":"1002.00","amount":100,"last":100},{"key":"gifi:3660","number":"3660","name":"Retained earnings","line_no":"3600.00","amount":-100,"last":-100}]');
select test.check('the build writes last year too; a cleared opening row goes', (select last_year from public.cb_accounts where file_id = :'f' and account_key = 'gifi:3660') = -100
  and not exists (select 1 from public.cb_accounts where file_id = :'f' and account_key = 'opening'));
-- Route 3: the prior accountant's trial balance in last year's column, then dropped once converted.
select public.cb_import_tb(:'f', 'last_year', 'prior_accountant', 'prior.csv', '[{"number":"1000","name":"Bank","amount":500},{"number":"3000","name":"Equity","amount":-500}]');
select test.check('the prior trial balance lands in last year''s column', (select count(*) from public.cb_accounts where file_id = :'f' and account_key in ('1000', '3000')) = 2);
select public.cb_drop_imported_rows(:'f');
select test.check('once converted, the imported rows go; built rows stay', not exists (select 1 from public.cb_accounts where file_id = :'f' and account_key in ('1000', '3000'))
  and exists (select 1 from public.cb_accounts where file_id = :'f' and account_key = 'chart:1000'));
-- Step 2, the Schedule 101 opening balances (the board's figures, 3,750.00 typed instead of 4,250.00).
select public.cb_save_opening(:'f', '[{"code":"1002","amount":48210},{"code":"1062","amount":6500},{"code":"1774","amount":9800},{"code":"1775","amount":-3920},{"code":"2620","amount":3750},{"code":"2680","amount":2110},{"code":"2781","amount":12400},{"code":"3500","amount":100},{"code":"3660","amount":29480},{"code":"3700","amount":8000}]', 41730, 20250, 'Prior T2, year ended Oct 31, 2025');
select test.check('a total cannot be typed as a line', test.try(format($f$select public.cb_save_opening(%L, '[{"code":"2599","amount":1}]', 1, 1, '')$f$, :'f')) like '%is a total%');
select test.check('sign-off refused while 3640 is out', test.try(format($f$select public.cb_sign_opening(%L)$f$, :'f')) like '%3640%does not equal total assets%');
select public.cb_save_opening(:'f', '[{"code":"1002","amount":48210},{"code":"1062","amount":6500},{"code":"1774","amount":9800},{"code":"1775","amount":-3920},{"code":"2620","amount":4250},{"code":"2680","amount":2110},{"code":"2781","amount":12400},{"code":"3500","amount":100},{"code":"3660","amount":29480},{"code":"3700","amount":8000}]', 41730, 20250, 'Prior T2, year ended Oct 31, 2025');
select test.check('a dividend typed as printed (positive) is stored negative', (select amount from public.cb_opening_balances where file_id = :'f' and code = '3700') = -8000);
select public.cb_sign_opening(:'f');
select test.check('signed once everything ties', (select opening_signed_at is not null and opening_note like 'Prior T2%' from public.cb_files where id = :'f'));
select public.cb_save_opening(:'f', '[{"code":"1002","amount":48210}]', 41730, 20250, '');
select test.check('saving again clears the sign-off', (select opening_signed_at is null from public.cb_files where id = :'f'));
select test.check('a wrong 3849 is refused', test.try(format($f$select public.cb_sign_opening(%L)$f$, :'f')) like '%3849%');
reset role;
