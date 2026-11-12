-- Local tests: a signing adds the client and the engagement (front office batch, step 5).
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
insert into public.settings (key, value) values ('start_page_open', 'true') on conflict (key) do update set value = 'true';
\set h '''aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'''

-- A couple's T1 quote: two people, one household engagement.
set role anon;
select public.submit_lead('personal', '{"first_name":"Jane","last_name":"Dummy","email":"jane@example.test","phone":"519-555-0100","province":"ON"}',
  '{"tax_year": 2026, "household": {"filing_type":"couple","spouse_first_name":"Sam","spouse_last_name":"Dummy","spouse_email":"sam@example.test"}, "people": [{}, {}]}', repeat('f', 64)) as lead \gset
reset role;
insert into public.lead_quotes (lead_id, lines, subtotal_cents) values (:'lead', '[{"code":"PTX-111","person":null,"quantity":1,"unit_cents":34900,"total_cents":34900}]', 34900);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.create_t1_quote(:'lead') as q \gset
select public.mark_t1_quote_sent(:'q') \g /dev/null
reset role;
reset request.jwt.claims;
select public.record_t1_signature(:'q', 0, 'Jane Dummy', '', '', :h, false) \g /dev/null
select test.check('nothing yet while one of two has signed', not exists (select 1 from public.engagements where quote_id = :'q'));
select public.record_t1_signature(:'q', 1, 'Sam Dummy', '', '', :h, true) \g /dev/null
select test.check('one household engagement, both people linked', (select count(*) from public.engagements where quote_id = :'q') = 1
  and (select client_id is not null and client2_id is not null and client_id <> client2_id and type = 'T1 personal' and t1_fee = 349 and status = 'EL signed'
       and came_from = 'Quote (website)' and fiscal_year_end = '2026-12-31' from public.engagements where quote_id = :'q'));
select test.check('two people added, waiting for TaxDome', (select count(*) from public.clients where created_from_quote = :'q' and kind = 'individual' and status = 'waiting_taxdome') = 2);
select test.check('the lead and quote point at the client', (select client_id is not null from public.leads where id = :'lead') and (select client_id is not null from public.quotes where id = :'q'));

-- A company year-end quote for an existing client: no new client.
insert into public.clients (id, kind, legal_name) values ('00000000-0000-0000-0000-0000000000c1', 'corporation', 'Dummy Holdings Inc.');
set role anon;
select public.submit_lead('company', '{"first_name":"Pat","last_name":"Example","email":"pat@example.test","phone":"","province":"ON"}', '{"form":"corporate-v1"}', repeat('e', 64)) as lead2 \gset
reset role;
update public.leads set company_name = 'Dummy Holdings Inc.', year_end = '2026-06-30' where id = :'lead2';
insert into public.lead_quotes (lead_id, lines, subtotal_cents) values (:'lead2', '[]', 340000);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.create_corporate_quote(:'lead2') as q2 \gset
select public.mark_t1_quote_sent(:'q2') \g /dev/null
reset role;
reset request.jwt.claims;
select public.record_t1_signature(:'q2', 0, 'Pat Example', '', '', :h, false, 'Director') \g /dev/null
select test.check('a company quote: matched to the existing client by legal name', (select client_id = '00000000-0000-0000-0000-0000000000c1' and type = 'Year-end compilation + T2' and fee = 3400 and fiscal_year_end = '2026-06-30' from public.engagements where quote_id = :'q2'));
select test.check('no duplicate client', (select count(*) from public.clients where lower(legal_name) = 'dummy holdings inc.') = 1);

-- A proposal: monthly option chosen; software stays out of the monthly fee.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.save_proposal(null, null, null, 'Dummy Realty Team Inc.', '{"f":{"name":"Dummy Realty Team Inc.","province":"ON","L_company":"Dummy Realty Team Inc.","L_ye":"2026-12-31","L_startMonth":"2027-01","L_city":"Kitchener"},"opts":[{"name":"Core","svc":{"books":true},"lines":[{"svc":"Monthly accounting and compliance services","kind":"month","amt":"2331"},{"svc":"Software subscription (QuickBooks Online and Dext)","kind":"month","amt":"69"},{"svc":"Year-end financial statements and T2","kind":"year","amt":"3,400"}]}],"rec":0}') as p \gset
select public.send_proposal(:'p', 'Pat', 'Realty', 'pat.r@example.test') \g /dev/null
reset role;
reset request.jwt.claims;
select public.record_t1_signature(:'p', 0, 'Pat Realty', '', '', :h, false, 'Director', 0) \g /dev/null
select test.check('a proposal: monthly engagement, fee without software', (select type = 'Monthly full service' and monthly_fee = 2331 and fee = 3400 and monthly_billing_starts = '2027-01-01'
  and came_from = 'Proposal (Core)' and fiscal_year_end = '2026-12-31' from public.engagements where quote_id = :'p'));
select test.check('the new company waits for TaxDome', (select status = 'waiting_taxdome' and city = 'Kitchener' and year_end_md = '12-31' from public.clients where created_from_quote = :'p'));

-- TaxDome: the import's match makes a company Active; an owner marks a person matched.
select set_config('app.taxdome_import', 'on', false) \g /dev/null
update public.clients set taxdome_account_id = 'TD-1' where created_from_quote = :'p';
select set_config('app.taxdome_import', 'off', false) \g /dev/null
select test.check('matched by the TaxDome import: Active', (select status from public.clients where created_from_quote = :'p') = 'active');
select id as person from public.clients where created_from_quote = :'q' order by legal_name limit 1 \gset
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.mark_client_in_taxdome(:'person');
select test.check('a person marked matched by an owner: Active', (select status from public.clients where id = :'person') = 'active');
