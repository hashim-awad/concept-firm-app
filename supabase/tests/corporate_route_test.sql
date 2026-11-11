-- Local tests: the corporate route (Phase 2 step 9).
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');

-- Year-end items from section 11, with their prices.
select test.check('six year-end items with section 11 prices', (
  select string_agg(i.code || '=' || p.amount_cents, ',' order by i.code) from public.catalogue_items i join public.item_prices p on p.item_id = i.id
  where i.code in ('YE-110', 'YE-111', 'YE-112', 'YE-120', 'YE-121', 'GST-110'))
  = 'GST-110=19900,YE-110=180000,YE-111=240000,YE-112=290000,YE-120=25000,YE-121=10000');

-- "Your details" first: the lead exists before the questions.
insert into public.settings (key, value) values ('start_page_open', 'true') on conflict (key) do update set value = 'true';
set role anon;
select public.submit_lead('company', '{"first_name":"Taylor","last_name":"Dummy","email":"taylor@example.test","phone":"","province":"ON"}', '{"form":"corporate-v1","partial":true}', repeat('a', 64)) as lead \gset
select test.check('the public cannot set the key', test.try(format($f$select public.set_company_lead_key(%L, %L)$f$, :'lead', repeat('1', 64))) <> 'OK');
reset role;
\set key '''1111111111111111111111111111111111111111111111111111111111111111'''
set role service_role;
select public.set_company_lead_key(:'lead', :key);
reset role;
select test.check('the key is stored only as a hash', (select draft_token_hash from public.leads where id = :'lead') <> repeat('1', 64)
  and (select draft_token_hash from public.leads where id = :'lead') ~ '^[0-9a-f]{64}$');

select test.try(format($f$select public.complete_company_lead(%L, %L, '{"form":"corporate-v1"}', 'new')$f$, :'lead', repeat('2', 64))) as wrong \gset
select test.check('a wrong key cannot finish the lead', :'wrong' like '%already been sent%');
set role service_role;
select public.complete_company_lead(:'lead', :key, '{"form":"corporate-v1","need":"year_end","books":"statements","extras":{"gst":true,"slips":true},"counts":{"bank":2,"cc":1,"loc":0,"loan":0,"car":1},"business":"Real estate"}', 'new');
reset role;
select test.check('finished: answers stored, key cleared', (select answers ->> 'books' from public.leads where id = :'lead') = 'statements'
  and (select draft_token_hash from public.leads where id = :'lead') is null);
select test.try(format($f$select public.complete_company_lead(%L, %L, '{"form":"corporate-v1"}', 'new')$f$, :'lead', repeat('1', 64))) as again \gset
select test.check('the answers cannot be changed again', :'again' like '%already been sent%');

set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('staff still cannot change what the client entered', test.try(format($f$update public.leads set answers = '{}' where id = %L$f$, :'lead')) like '%cannot be changed%');
reset role;
reset request.jwt.claims;

-- The quote: legal name and year-end first.
insert into public.lead_quotes (lead_id, lines, subtotal_cents) values (:'lead', '[{"code":"YE-112","person":null,"quantity":1,"unit_cents":290000,"total_cents":290000}]', 290000);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('no quote without the legal name', test.try(format($f$select public.create_corporate_quote(%L)$f$, :'lead')) like '%legal name%');
update public.leads set company_name = 'Example Holdings Inc.' where id = :'lead';
select test.check('no quote without the confirmed year-end', test.try(format($f$select public.create_corporate_quote(%L)$f$, :'lead')) like '%year-end%');
update public.leads set year_end = '2026-12-31' where id = :'lead';
select public.create_corporate_quote(:'lead') as q \gset
select test.check('a corporate quote with the company and its answers', (select kind || '|' || company_name || '|' || year_end || '|' || tax_year || '|' || (details ->> 'books') || '|' || (details -> 'extras' ->> 'gst') from public.quotes where id = :'q')
  = 'corporate|Example Holdings Inc.|2026-12-31|2026|statements|true');
select test.check('the quote keeps the account counts', (select details -> 'counts' ->> 'bank' || '/' || (details -> 'counts' ->> 'car') from public.quotes where id = :'q') = '2/1');
select test.check('one signer, with a private link', (select count(*) from public.quote_signers where quote_id = :'q') = 1);
update public.leads set company_name = 'Example Holdings Ltd.' where id = :'lead';
select public.create_corporate_quote(:'lead');
select test.check('a draft picks up a corrected legal name', (select company_name from public.quotes where id = :'q') = 'Example Holdings Ltd.');
select public.mark_t1_quote_sent(:'q');
select test.check('sent; the lead shows Quote sent', (select status from public.quotes where id = :'q') = 'sent' and (select status from public.leads where id = :'lead') = 'sent');
update public.leads set company_name = 'Changed After Sending' where id = :'lead';
select public.create_corporate_quote(:'lead');
select test.check('a sent quote never changes', (select company_name from public.quotes where id = :'q') = 'Example Holdings Ltd.');
update public.leads set first_year_tag_done = true where id = :'lead';
update public.leads set client_kind = 'team' where id = :'lead';
select test.check('staff mark the client type for the package', (select client_kind from public.leads where id = :'lead') = 'team');
select test.check('only agent, team or other', test.try(format($f$update public.leads set client_kind = 'x' where id = %L$f$, :'lead')) <> 'OK');
select test.check('staff tick the first-year checklist', (select first_year_tag_done from public.leads where id = :'lead'));
reset role;
reset request.jwt.claims;

-- Signing: a company's signer must give their title (shown next to "I have authority to bind the Company.").
\set hash '''aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'''
select test.try(format($f$select public.record_t1_signature(%L, 0, 'Taylor Dummy', '', '', %L, false, '')$f$, :'q', :hash)) as notitle \gset
select test.check('no signature without the title', :'notitle' like '%title%');
set role service_role;
select public.record_t1_signature(:'q', 0, 'Taylor Dummy', '', '', :hash, false, 'President');
reset role;
select test.check('signed, with the title kept', (select signed_title from public.quote_signers where quote_id = :'q') = 'President'
  and (select status from public.quotes where id = :'q') = 'signed');
