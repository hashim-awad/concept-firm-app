-- Local tests: round 20 (Hashim, Nov 15, 2026), the quick method's two rates. Services and Goods for resale
-- per province, added as pending (from the CRA table or typed from CRA's page) and approved by an owner;
-- the rate a period uses; step 1's quick_method_type answer; the round 13 rates moved across once. The
-- rates below are dummy figures for the tests, not CRA's.
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

-- ---------- The round 13 rate moves across once, as approved; running the migration again adds nothing.
insert into public.cb_gst_quick_rates (province, rate) values ('ON', 0.05);
\i supabase/migrations/20261209020000_round20_quick_method.sql
\i supabase/migrations/20261209020000_round20_quick_method.sql
select test.check('the round 13 rate moved across once, approved, services only, for every period',
  (select count(*) = 1 and bool_and(legacy and status = 'approved' and services_rate = 0.05 and goods_rate is null and effective_from is null) from public.cb_quick_rates where province = 'ON'));

-- ---------- Adding rates: owners only, as pending, from a canada.ca page.
\set src 'https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/rc4058/quick-method-accounting-gst-hst.html'
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('staff cannot add quick method rates', test.try(format($q$select public.cb_add_quick_rates('[{"province":"ON","services":0.06,"goods":0.03}]', '2026-01-01', %L, '2026-11-15')$q$, :'src')) = 'Only an owner adds quick method rates.');
select test.check('staff cannot approve', test.try($q$select public.cb_approve_quick_rates()$q$) = 'Only an owner can approve quick method rates.');
select test.check('staff read the approved rate (Closebook view)', public.cb_quick_rate('ON', 'services', '2026-01-01') = 0.05);
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('the source must be canada.ca', test.try($q$select public.cb_add_quick_rates('[{"province":"ON","services":0.06}]', '2026-01-01', 'https://example.test/rates', '2026-11-15')$q$) = 'The source must be a canada.ca page.');
select test.check('a rate over 100% is refused', test.try(format($q$select public.cb_add_quick_rates('[{"province":"ON","services":6}]', '2026-01-01', %L, '2026-11-15')$q$, :'src')) = 'A quick method rate is from 0 to 100%.');
select test.check('a row needs a rate', test.try(format($q$select public.cb_add_quick_rates('[{"province":"ON","services":"","goods":""}]', '2026-01-01', %L, '2026-11-15')$q$, :'src')) = 'ON: enter the services rate, the goods for resale rate, or both.');
select test.check('the start date is needed', test.try(format($q$select public.cb_add_quick_rates('[{"province":"ON","services":0.06}]', null, %L, '2026-11-15')$q$, :'src')) like 'Enter the date the rates apply from%');
select test.check('the date read cannot be in the future', test.try(format($q$select public.cb_add_quick_rates('[{"province":"ON","services":0.06}]', '2026-01-01', %L, '2099-01-01')$q$, :'src')) like 'Enter the date you read the rates%');
select test.check('the owner loads two provinces as pending',
  public.cb_add_quick_rates('[{"province":"ON","services":0.06,"goods":0.03},{"province":"AB","services":0.04,"goods":0.02}]', '2026-01-01', :'src', '2026-11-15', 'Dummy load') = 2);
select test.check('loading the same table again adds nothing',
  public.cb_add_quick_rates('[{"province":"ON","services":0.06,"goods":0.03},{"province":"AB","services":0.04,"goods":0.02}]', '2026-01-01', :'src', '2026-11-15', 'Dummy load') = 0);
select test.check('different rates for the same province and date are refused while one is live',
  test.try(format($q$select public.cb_add_quick_rates('[{"province":"ON","services":0.07,"goods":0.03}]', '2026-01-01', %L, '2026-11-15')$q$, :'src')) = 'ON already has pending quick method rates from Jan 1, 2026. Retire them first.');
select test.check('pending rows record the source, the date read and who read it',
  (select bool_and(status = 'pending' and source_url = :'src' and checked_on = '2026-11-15' and checked_by = '00000000-0000-0000-0000-00000000000a' and notes = 'Dummy load') from public.cb_quick_rates where not legacy));

-- ---------- Pending rates are not used; the approved rate for the type and the period is.
select test.check('pending: the 2026 period still uses the approved round 13 rate', public.cb_quick_rate('ON', 'services', '2026-01-01') = 0.05);
select test.check('pending: no goods rate in Ontario', public.cb_quick_rate('ON', 'goods', '2026-01-01') is null);
select test.check('pending: nothing in Alberta', public.cb_quick_rate('AB', 'services', '2026-01-01') is null);
select test.check('the owner approves one row', test.try(format($q$select public.cb_set_quick_rate_status(%L, 'approved')$q$, (select id from public.cb_quick_rates where province = 'AB'))) = 'OK');
select test.check('approved: who and when are recorded', (select approved_by = '00000000-0000-0000-0000-00000000000a' and approved_at is not null from public.cb_quick_rates where province = 'AB'));
select test.check('approve all approves the rest', public.cb_approve_quick_rates() = 1);
select test.check('services and goods for resale, Ontario, 2026', public.cb_quick_rate('ON', 'services', '2026-01-01') = 0.06 and public.cb_quick_rate('ON', 'goods', '2026-04-01') = 0.03);
select test.check('no type answered: services', public.cb_quick_rate('AB', null, '2026-01-01') = 0.04);
select test.check('a period that starts before the new rates uses the older rate', public.cb_quick_rate('ON', 'services', '2025-10-01') = 0.05);
select test.check('no goods rate before the new rates: missing, not guessed', public.cb_quick_rate('ON', 'goods', '2025-10-01') is null);
select test.check('an approved row cannot be approved again', test.try(format($q$select public.cb_set_quick_rate_status(%L, 'approved')$q$, (select id from public.cb_quick_rates where province = 'AB'))) = 'Only a pending rate can be approved.');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('staff cannot retire a rate', test.try(format($q$select public.cb_set_quick_rate_status(%L, 'retired')$q$, (select id from public.cb_quick_rates where province = 'AB'))) = 'Only an owner can approve or retire a quick method rate.');
select test.check('staff cannot write the table directly', test.try($q$update public.cb_quick_rates set services_rate = 0.5$q$) like 'permission denied%');
reset role;
reset request.jwt.claims;
select test.check('an approved rate cannot be changed', test.try($q$update public.cb_quick_rates set goods_rate = 0.5 where province = 'AB'$q$) = 'An approved rate cannot be changed. Add a new rate and retire this one.');
select test.check('rates are never deleted', test.try($q$delete from public.cb_quick_rates where province = 'AB'$q$) like 'Quick method rates are kept as a record%');
select test.check('a new row cannot start approved', test.try($q$insert into public.cb_quick_rates (province, services_rate, status, legacy) values ('BC', 0.04, 'approved', true)$q$) = 'New rates start as pending. An owner approves them.');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_set_quick_rate_status((select id from public.cb_quick_rates where province = 'AB'), 'retired');
select test.check('retired: Alberta has no rate, so the return says it is missing', public.cb_quick_rate('AB', 'services', '2026-01-01') is null);
select test.check('after retiring, new rates for the same date can be added', public.cb_add_quick_rates('[{"province":"AB","services":0.045}]', '2026-01-01', :'src', '2026-11-15') = 1);

-- ---------- Step 1: which quick method rate applies.
reset role;
reset request.jwt.claims;
insert into public.clients (kind, legal_name, province) values ('corporation', 'Maple Dummy Realty Inc.', 'ON') returning id as client \gset
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_create_file(:'client', '2026-12-31', '2026-01-01', '', 'full', 'statements', '00000000-0000-0000-0000-00000000000c'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid) as f \gset
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_save_setup(:'f', '{"gst_registered":true,"gst_frequency":"annual","quick_method":true,"gst_rt":"RT0001","gst_year_same":true}');
select test.check('no answer yet: nothing stored (the app reads it as services)', not ((select setup from public.cb_files where id = :'f') ? 'quick_method_type'));
select test.check('a type other than services or goods is refused', test.try(format($q$select public.cb_save_setup(%L, '{"quick_method_type":"retail"}')$q$, :'f')) = 'Choose Services or Goods for resale.');
select test.check('unknown questions are still refused', test.try(format($q$select public.cb_save_setup(%L, '{"quick_type":"goods"}')$q$, :'f')) = 'Unknown question quick_type.');
select test.check('the round 13 rules still hold', test.try(format($q$select public.cb_save_setup(%L, '{"gst_rt":"RT1"}')$q$, :'f')) = 'The GST/HST account is RT and four digits, for example RT0001.');
reset role;
reset request.jwt.claims;
insert into public.cb_bank_accounts (file_id, name, name_key, kind, chart_account) values (:'f', 'Dummy chequing', 'dummy chequing', 'bank', '10000') returning id as ba \gset
insert into public.cb_bank_statements (file_id, account_id, first_date, last_date, period_start, period_end, opening, closing, lines, plus_total, minus_total)
  values (:'f', :'ba', '2026-02-01', '2026-02-02', '2026-02-01', '2026-02-28', 0, 0, 2, 0, 0) returning id as st \gset
insert into public.cb_bank_lines (statement_id, file_id, account_id, row_no, txn_date, description, amount, chart_account, tax_code, status) values
  (:'st', :'f', :'ba', 1, '2026-02-01', 'SAMPLE BROKERAGE COMMISSION', 11300, '40200', 'HST_ON', 'done') returning id as taxed \gset
insert into public.cb_bank_lines (statement_id, file_id, account_id, row_no, txn_date, description, amount, chart_account, tax_code, status) values
  (:'st', :'f', :'ba', 2, '2026-02-02', 'SAMPLE BANK FEE', -12, '60100', 'EXEMPT', 'done') returning id as untaxed \gset
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_save_setup(:'f', '{"quick_method_type":"services"}');
select test.check('saving services when it was not answered (services) changes nothing', (select status from public.cb_bank_lines where id = :'taxed') = 'done');
select public.cb_save_setup(:'f', '{"quick_method_type":"goods"}');
select test.check('goods for resale is kept', (select setup ->> 'quick_method_type' from public.cb_files where id = :'f') = 'goods');
select test.check('changing the type sends taxed work back to the reviewer, as the quick method answer does',
  (select status || '|' || reviewer_reason from public.cb_bank_lines where id = :'taxed') = 'reviewer|The GST/HST answers changed: the sales tax was worked out again. Check it.');
select test.check('a line with no tax stays done', (select status from public.cb_bank_lines where id = :'untaxed') = 'done');
-- Not on the quick method: the type does not matter, so changing it sends nothing back.
reset role;
reset request.jwt.claims;
update public.cb_bank_lines set status = 'done', reviewer_reason = '' where id = :'taxed';
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_save_setup(:'f', '{"quick_method":false}');
reset role;
reset request.jwt.claims;
update public.cb_bank_lines set status = 'done', reviewer_reason = '' where id = :'taxed';
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_save_setup(:'f', '{"quick_method_type":"services"}');
select test.check('regular method: changing the type sends nothing back', (select status from public.cb_bank_lines where id = :'taxed') = 'done');
reset role;
reset request.jwt.claims;
