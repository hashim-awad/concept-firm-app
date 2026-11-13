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
select test.check('only the six bank chart accounts', test.try(format($f$select public.cb_set_bank_chart_account(%L, '6510')$f$, :'acc')) like '%Choose chequing%');
reset role;
