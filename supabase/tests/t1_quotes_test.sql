-- Local tests: T1 quotes (Phase 2 step 7). Pricing and Leads only; one private link per signer;
-- Mark as sent starts the 21-day clock, keeps the wording and signer, and marks the lead Quote sent.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test', (select id from public.roles where name = 'Staff'));
select public.set_role_permissions((select id from public.roles where name = 'Staff'), '{"pricing":"none","leads":"edit"}');
select public.update_setting('signer_engagement_letter', '{"name":"Hashim Abouelfetouh, CPA","title":"Director"}');
reset role;
reset request.jwt.claims;

-- A couple lead with its quote, as the start page saves it.
insert into public.settings (key, value) values ('start_page_open', 'true') on conflict (key) do update set value = 'true';
set role anon;
select public.submit_lead('personal', '{"first_name":"Jane","last_name":"Dummy","email":"jane@example.test","phone":"519-555-0100","province":"ON"}',
  '{"tax_year": 2026, "household": {"filing_type":"couple","spouse_first_name":"Sam","spouse_last_name":"Dummy","spouse_email":"Sam@Example.test"}, "people": [{}, {}]}', repeat('d', 64)) as lead \gset
select public.submit_lead('personal', '{"first_name":"Out","last_name":"Scope","email":"out@example.test","phone":"519-555-0101","province":"ON"}', '{}', repeat('e', 64)) as oos \gset
reset role;
insert into public.lead_quotes (lead_id, lines, subtotal_cents) values (:'lead', '[{"code":"PTX-111","person":null,"quantity":1,"unit_cents":34900,"total_cents":34900}]', 34900);

set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('staff without Pricing cannot prepare a quote', test.try($$select public.create_t1_quote('$$ || :'lead' || $$')$$) like 'You need Edit on Pricing and Leads%');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('no quote without a quote from the answers', test.try($$select public.create_t1_quote('$$ || :'oos' || $$')$$) like '%has no quote from its answers%');
select public.create_t1_quote(:'lead') as q \gset
select test.check('preparing again returns the same quote', public.create_t1_quote(:'lead') = :'q'::uuid);
select test.check('a draft quote', (select status || ' ' || tax_year || ' ' || couple || ' ' || total_cents from public.t1_quotes where id = :'q') = 'draft 2026 true 34900');
select test.check('two signers, each with a private link', (select count(distinct token) from public.t1_quote_signers where quote_id = :'q') = 2
  and (select email from public.t1_quote_signers where quote_id = :'q' and person = 1) = 'sam@example.test');
select test.check('staff cannot change a quote directly', test.try($$update public.t1_quotes set total_cents = 1 where id = '$$ || :'q' || $$'$$) <> 'OK'
  or (select total_cents from public.t1_quotes where id = :'q') = 34900);
select public.mark_t1_quote_sent(:'q') as until \gset
select test.check('valid 21 days from today', :'until'::date = (now() at time zone 'America/Toronto')::date + 21);
select test.check('sent: sender, signer and wording kept', (select status from public.t1_quotes where id = :'q') = 'sent'
  and (select sender ->> 'name' from public.t1_quotes where id = :'q') = 'Test Owner A'
  and (select signer ->> 'name' from public.t1_quotes where id = :'q') = 'Hashim Abouelfetouh, CPA'
  and (select wording is not null from public.t1_quotes where id = :'q'));
select test.check('the lead shows Quote sent', (select status from public.leads where id = :'lead') = 'sent');
select test.check('cannot mark sent twice', test.try($$select public.mark_t1_quote_sent('$$ || :'q' || $$')$$) like '%already marked sent%');

set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('staff without Pricing see no quotes or links', (select count(*) from public.t1_quotes) = 0 and (select count(*) from public.t1_quote_signers) = 0);
reset role;
reset request.jwt.claims;
set role anon;
select test.check('the public cannot read quotes or links', test.try($$select count(*) from public.t1_quote_signers$$) <> 'OK');
reset role;
set role service_role;
select count(*) as by_token from public.t1_quote_signers where token = (select token from public.t1_quote_signers where quote_id = :'q' and person = 0) \gset
reset role;
select test.check('the server finds a quote by its private link', :by_token = 1);

-- Tax year when the answers do not say: until June last year, from July this year.
select test.check('tax year rule', private.t1_tax_year('2027-03-15 12:00-05') = 2026 and private.t1_tax_year('2026-11-10 12:00-05') = 2026);
