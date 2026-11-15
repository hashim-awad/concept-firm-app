-- Local tests: round 20 fix before merge (Hashim, Nov 15, 2026), the Quick method rates page. Only the
-- provinces in use; CRA's figures pre-filled as drafts and approved with one click; the credit with its
-- own draft and approval; a draft beside an approved rate replaces it when approved.
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
\set src 'https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/rc4058/quick-method-accounting-gst-hst.html'

-- ---------- What the migration leaves: three provinces, three drafts, a draft credit; nothing applies yet.
select test.check('the provinces in use are Ontario, Alberta and British Columbia',
  (select string_agg(province, ',' order by province) from public.cb_quick_provinces) = 'AB,BC,ON');
select test.check('CRA''s figures wait as drafts with their source',
  (select count(*) = 3 and bool_and(status = 'pending' and source_url = :'src' and source_name = 'CRA guide RC4058, Quick Method of Accounting for GST/HST' and effective_from is null)
     from public.cb_quick_rates)
  and (select services_rate = 0.088 and goods_rate = 0.044 from public.cb_quick_rates where province = 'ON')
  and (select services_rate = 0.036 and goods_rate = 0.018 from public.cb_quick_rates where province = 'AB')
  and (select services_rate = 0.036 and goods_rate = 0.018 from public.cb_quick_rates where province = 'BC'));
select test.check('the credit waits as a draft: 1% on the first $30,000; nothing approved yet',
  (select (quick_credit_draft ->> 'rate')::numeric = 0.01 and (quick_credit_draft ->> 'limit')::numeric = 30000 and quick_credit_rate is null and quick_credit_limit is null from public.cb_settings));
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('drafts do not apply: the return finds no rate', public.cb_quick_rate('ON', 'services', '2026-01-01') is null);
select test.check('staff cannot approve', test.try($q$select public.cb_approve_quick_rates()$q$) = 'Only an owner can approve quick method rates.');
select test.check('staff cannot add a province', test.try($q$select public.cb_add_quick_province('SK')$q$) = 'Only an owner adds a province.');
select test.check('staff cannot change the credit', test.try(format($q$select public.cb_set_quick_credit(0.02, 1000, %L, '2026-11-15')$q$, :'src')) = 'Only an owner changes the quick method credit.');
select test.check('staff cannot write the provinces directly', test.try($q$insert into public.cb_quick_provinces (province) values ('SK')$q$) like 'permission denied%');

-- ---------- One click approves the three rates and the credit.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('approve all: three rates and the credit', public.cb_approve_quick_rates() = 4);
select test.check('approved: who and when on each rate', (select bool_and(status = 'approved' and approved_by = '00000000-0000-0000-0000-00000000000a' and approved_at is not null) from public.cb_quick_rates));
select test.check('Ontario services and goods apply', public.cb_quick_rate('ON', 'services', '2026-01-01') = 0.088 and public.cb_quick_rate('ON', 'goods', '2026-01-01') = 0.044);
select test.check('Alberta and British Columbia apply', public.cb_quick_rate('AB', 'services', '2026-01-01') = 0.036 and public.cb_quick_rate('BC', 'goods', '2026-01-01') = 0.018);
select test.check('a province with no rate stays missing: the return flags it', public.cb_quick_rate('SK', 'services', '2026-01-01') is null);
select test.check('the credit applies, with who and when and its source',
  (select quick_credit_rate = 0.01 and quick_credit_limit = 30000 and quick_credit_draft is null and quick_credit_approved_by = '00000000-0000-0000-0000-00000000000a'
     and quick_credit_approved_at is not null and quick_credit_source_url = :'src' from public.cb_settings));
select test.check('nothing left to approve', public.cb_approve_quick_rates() = 0);

-- ---------- Add a province; new rates wait beside the approved ones and replace them when approved.
select public.cb_add_quick_province('SK');
select public.cb_add_quick_province('SK');
select test.check('Add a province adds one row, once', (select count(*) from public.cb_quick_provinces where province = 'SK') = 1);
select test.check('a new Ontario draft can wait beside the approved rate',
  public.cb_add_quick_rates('[{"province":"ON","services":0.09,"goods":0.045}]', null, :'src', '2026-11-15', 'Dummy change') = 1);
select test.check('while it waits, the approved rate still applies', public.cb_quick_rate('ON', 'services', '2026-01-01') = 0.088);
select test.check('a second, different draft for the same province is refused',
  test.try(format($q$select public.cb_add_quick_rates('[{"province":"ON","services":0.1}]', null, %L, '2026-11-15')$q$, :'src')) = 'ON already has rates waiting for approval. Reject them first.');
select public.cb_set_quick_rate_status((select id from public.cb_quick_rates where province = 'ON' and status = 'pending'), 'approved');
select test.check('approving the draft retires the rate it replaces',
  (select count(*) from public.cb_quick_rates where province = 'ON' and status = 'approved') = 1
  and public.cb_quick_rate('ON', 'services', '2026-01-01') = 0.09
  and (select status from public.cb_quick_rates where province = 'ON' and services_rate = 0.088) = 'retired');
select public.cb_add_quick_rates('[{"province":"AB","services":0.5}]', null, :'src', '2026-11-15', 'Dummy wrong');
select public.cb_set_quick_rate_status((select id from public.cb_quick_rates where province = 'AB' and status = 'pending'), 'retired');
select test.check('rejecting a draft keeps the approved rate', public.cb_quick_rate('AB', 'services', '2026-01-01') = 0.036);

-- ---------- The credit: Edit makes a draft; reject keeps the approved one; the due dates never change it.
select public.cb_set_quick_credit(0.02, 50000, :'src', '2026-11-15');
select test.check('an edited credit waits; the approved one still applies',
  (select quick_credit_rate = 0.01 and (quick_credit_draft ->> 'rate')::numeric = 0.02 from public.cb_settings));
select public.cb_decide_quick_credit(false);
select test.check('rejected: the approved credit stays', (select quick_credit_rate = 0.01 and quick_credit_limit = 30000 and quick_credit_draft is null from public.cb_settings));
select test.check('nothing to decide when no draft waits', test.try($q$select public.cb_decide_quick_credit(true)$q$) = 'No credit is waiting for approval.');
select test.check('the credit source must be canada.ca', test.try($q$select public.cb_set_quick_credit(0.01, 30000, 'https://example.test', '2026-11-15')$q$) = 'The source must be a canada.ca page.');
select public.cb_update_gst_settings(4, 2, 0.05, 1, '[]');
select test.check('saving the due dates leaves the credit alone',
  (select gst_due_months_annual = 4 and gst_due_months_period = 2 and quick_credit_rate = 0.01 and quick_credit_limit = 30000 from public.cb_settings));
reset role;
reset request.jwt.claims;

-- ---------- Safe to run twice: no second set of drafts, and the approved rates stay.
\i supabase/migrations/20261209050000_round20_quick_rates_page.sql
select test.check('a second run adds no drafts and changes no approved rate or credit',
  not exists (select 1 from public.cb_quick_rates where status = 'pending')
  and (select count(*) from public.cb_quick_rates where status = 'approved') = 3
  and (select quick_credit_rate = 0.01 and quick_credit_draft is null from public.cb_settings));
