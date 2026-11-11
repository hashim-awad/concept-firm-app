-- Local tests: signing T1 quotes (Phase 2 step 8).
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
insert into public.settings (key, value) values ('start_page_open', 'true') on conflict (key) do update set value = 'true';
set role anon;
select public.submit_lead('personal', '{"first_name":"Jane","last_name":"Dummy","email":"jane@example.test","phone":"519-555-0100","province":"ON"}',
  '{"tax_year": 2026, "household": {"filing_type":"couple","spouse_first_name":"Sam","spouse_last_name":"Dummy","spouse_email":"sam@example.test"}, "people": [{}, {}]}', repeat('f', 64)) as lead \gset
reset role;
insert into public.lead_quotes (lead_id, lines, subtotal_cents) values (:'lead', '[{"code":"PTX-111","person":null,"quantity":1,"unit_cents":34900,"total_cents":34900}]', 34900);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.create_t1_quote(:'lead') as q \gset
reset role;
reset request.jwt.claims;
\set h '''aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'''

select test.check('a draft quote cannot be signed',
  test.try(format($f$select public.record_t1_signature(%L, 0, 'Jane Dummy', '1.2.3.4', 'Test browser', %L, false)$f$, :'q', :h)) like '%cannot be signed%');

set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.mark_t1_quote_sent(:'q');
select test.check('staff cannot record a signature themselves',
  test.try(format($f$select public.record_t1_signature(%L, 0, 'Jane Dummy', '', '', %L, false)$f$, :'q', :h)) <> 'OK');
reset role;
reset request.jwt.claims;

select test.check('a name is needed', test.try(format($f$select public.record_t1_signature(%L, 0, ' ', '', '', %L, false)$f$, :'q', :h)) like 'Type your full name%');
select public.record_t1_signature(:'q', 0, 'Jane Dummy', '1.2.3.4', 'Test browser', :h, false) as first_done \gset
select test.check('one of two signed: not signed yet', :'first_done' = 'f' and (select status from public.quotes where id = :'q') = 'sent');
select test.check('the signing record', (select signed_name || '|' || signed_ip || '|' || signed_agent || '|' || same_device from public.quote_signers where quote_id = :'q' and person = 0)
  = 'Jane Dummy|1.2.3.4|Test browser|false');
select test.check('cannot sign twice', test.try(format($f$select public.record_t1_signature(%L, 0, 'Jane Dummy', '', '', %L, false)$f$, :'q', :h)) like 'Already signed%');
select public.record_t1_signature(:'q', 1, 'Sam Dummy', '1.2.3.4', 'Test browser', :h, true) as all_done \gset
select test.check('both signed: the quote is signed', :'all_done' = 't' and (select status from public.quotes where id = :'q') = 'signed');
select test.check('same-device signing is noted', (select same_device from public.quote_signers where quote_id = :'q' and person = 1));
select test.check('the lead shows Signed', (select status from public.leads where id = :'lead') = 'signed');
select public.store_t1_signed_pdf(:'q', 't1-quotes/x/signed.pdf', :h);
select test.check('the signed PDF is kept', (select pdf_path from public.quotes where id = :'q') = 't1-quotes/x/signed.pdf');
select public.store_t1_signed_pdf(:'q', 't1-quotes/x/other.pdf', :h);
select test.check('the stored PDF is never replaced', (select pdf_path from public.quotes where id = :'q') = 't1-quotes/x/signed.pdf');

-- An expired quote cannot be signed.
set role anon;
select public.submit_lead('personal', '{"first_name":"Late","last_name":"Dummy","email":"late@example.test","phone":"519-555-0102","province":"ON"}', '{"household":{"filing_type":"single"}}', repeat('9', 64)) as lead2 \gset
reset role;
insert into public.lead_quotes (lead_id, lines, subtotal_cents) values (:'lead2', '[]', 29900);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.create_t1_quote(:'lead2') as q2 \gset
select public.mark_t1_quote_sent(:'q2');
reset role;
reset request.jwt.claims;
update public.quotes set valid_until = current_date - 30 where id = :'q2';
select test.check('an expired quote cannot be signed', test.try(format($f$select public.record_t1_signature(%L, 0, 'Late Dummy', '', '', %L, false)$f$, :'q2', :h)) like '%expired%');

-- GST/HST rate for the invoice line: approved rates, Pricing holders only.
insert into public.tax_rates (province, tax, rate_percent, effective_from, source_url, checked_on, checked_by)
values ('ON', 'HST', 13, '2016-07-01', 'https://www.canada.ca/en/revenue-agency.html', current_date, '00000000-0000-0000-0000-00000000000a');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
update public.tax_rates set status = 'approved' where province = 'ON';
select test.check('invoice tax for Ontario', (select tax || ' ' || rate_percent::int from public.t1_invoice_tax('ON')) = 'HST 13');
reset role;
reset request.jwt.claims;
