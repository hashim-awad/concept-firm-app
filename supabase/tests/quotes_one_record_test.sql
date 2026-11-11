-- Local tests: one quote record (front office batch, step 1).
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'), ('00000000-0000-0000-0000-00000000000b', 'staff.b@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
insert into public.settings (key, value) values ('start_page_open', 'true') on conflict (key) do update set value = 'true';
set role anon;
select public.submit_lead('personal', '{"first_name":"Jane","last_name":"Dummy","email":"jane@example.test","phone":"519-555-0100","province":"ON"}',
  '{"tax_year": 2026, "household": {"filing_type":"single"}, "people": [{}]}', repeat('f', 64)) as lead \gset
reset role;
insert into public.lead_quotes (lead_id, lines, subtotal_cents) values (:'lead', '[{"code":"PTX-100","person":0,"quantity":1,"unit_cents":29900,"total_cents":29900}]', 29900);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.create_t1_quote(:'lead') as q \gset
select public.mark_t1_quote_sent(:'q') \g /dev/null
reset role;
reset request.jwt.claims;
select token as tok from public.quote_signers where quote_id = :'q' \gset
\set h '''aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'''

-- Viewed
select test.check('the old table name is gone', to_regclass('public.t1_quotes') is null and to_regclass('public.quotes') is not null);
select test.check('staff cannot mark a quote viewed', test.try(format($f$set local role authenticated; select public.mark_quote_viewed(%L)$f$, :'tok')) <> 'OK');
select public.mark_quote_viewed(:'tok');
select test.check('opening the link marks it viewed', (select status = 'viewed' and viewed_at is not null from public.quotes where id = :'q'));
select public.mark_quote_viewed(:'tok');
select public.record_t1_signature(:'q', 0, 'Jane Dummy', '1.2.3.4', 'Test browser', :h, false) as done \gset
select test.check('a viewed quote can be signed', :'done' = 't');
select test.check('signed; the lead is closed', (select status from public.quotes where id = :'q') = 'signed' and (select status = 'signed' and closed_at is not null from public.leads where id = :'lead'));
select public.mark_quote_viewed(:'tok');
select test.check('opening a signed quote does not change it', (select status from public.quotes where id = :'q') = 'signed');

-- Expired
update public.quotes set status = 'sent', signed_at = null where id = :'q';
update public.quotes set valid_until = (now() at time zone 'America/Toronto')::date where id = :'q';
select test.check('on day 21 nothing expires', public.expire_quotes() = 0);
update public.quotes set valid_until = (now() at time zone 'America/Toronto')::date - 1 where id = :'q';
select public.expire_quotes() as n \gset
select test.check('on day 22 it expires', :n = 1 and (select status from public.quotes where id = :'q') = 'expired');
select public.mark_quote_viewed(:'tok');
select test.check('an expired quote is not marked viewed', (select status from public.quotes where id = :'q') = 'expired');

-- Declined
update public.quotes set status = 'sent', valid_until = (now() at time zone 'America/Toronto')::date + 5 where id = :'q';
update public.leads set status = 'sent', closed_at = null where id = :'lead';
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.mark_quote_declined(:'q');
select test.check('declined; the lead is lost', (select status from public.quotes where id = :'q') = 'declined' and (select status from public.leads where id = :'lead') = 'lost');
select test.check('a declined quote cannot be declined again', test.try(format($f$select public.mark_quote_declined(%L)$f$, :'q')) like 'Only an open quote%');

-- The list: totals only with Pricing
select test.check('the owner sees the total', (select total_cents from public.quote_list() where id = :'q') = 29900);
select public.add_staff('00000000-0000-0000-0000-00000000000b', 'Test Staff B', 'staff.b@example.test', (select id from public.roles where name = 'Staff'));
select public.set_role_permissions((select id from public.roles where name = 'Staff'), '{"pricing":"none","leads":"view"}');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b"}';
select test.check('staff without Pricing see the quote, not the total', (select client = 'Jane Dummy' and total_cents is null from public.quote_list() where id = :'q'));
select test.check('staff without Pricing cannot read the quote table', (select count(*) from public.quotes) = 0);
reset role;
reset request.jwt.claims;
select public.set_role_permissions((select id from public.roles where name = 'Staff'), '{"pricing":"none","leads":"none"}') from (select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a"}', true)) x;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b"}';
select test.check('staff without Leads cannot list quotes', test.try('select * from public.quote_list()') like 'You do not have access%');
reset role;
reset request.jwt.claims;

-- Old Proposals rows were copied in (migration); a new one copies the same way.
select test.check('proposals are a quote kind', test.try($f$insert into public.quotes (kind, status, title) values ('proposal', 'draft', 'Dummy Realty Team')$f$) = 'OK');
select test.check('a T1 quote still needs its lead, year and total', test.try($f$insert into public.quotes (kind, status) values ('t1', 'draft')$f$) <> 'OK');
