-- Local tests: Engagement letters (front office batch, step 4).
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'), ('00000000-0000-0000-0000-00000000000b', 'staff.b@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000b', 'Test Staff B', 'staff.b@example.test', (select id from public.roles where name = 'Staff'));
select public.set_role_permissions((select id from public.roles where name = 'Staff'), '{"documents":"view","leads":"none","pricing":"none"}');
reset role;
insert into public.clients (id, kind, legal_name) values ('00000000-0000-0000-0000-0000000000c1', 'corporation', 'Dummy Dental PC');
insert into public.engagements (id, client_id, title, type, status, fiscal_year_end) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1', 'Dummy Dental PC FYE 2026-08-31', 'Year-end compilation + T2', 'EL sent', '2026-08-31');
set role authenticated;
\set det '''{"doc_kind":"corporate_letter","label":"Year-end Aug 31, 2026","engagement_id":"00000000-0000-0000-0000-0000000000e1","inputs":{}}'''
\set sg '''[{"first_name":"Pat","last_name":"Example","email":"Pat@Example.test"}]'''

set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b"}';
select test.check('only an owner issues a Final letter', test.try(format($f$select public.create_letter_quote('00000000-0000-0000-0000-0000000000c1', 'X', 'Dummy Dental PC', %L, %L)$f$, :det, :sg)) like 'Only an owner%');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('the signer needs an email', test.try(format($f$select public.create_letter_quote(null, 'X', '', %L, '[{"first_name":"Pat","last_name":"Example","email":""}]')$f$, :det)) like 'Add the client''s email%');
select public.create_letter_quote('00000000-0000-0000-0000-0000000000c1', 'Dummy Dental PC engagement letter', 'Dummy Dental PC', :det, :sg) as q \gset
select test.check('sent for signing: 21 days, one signer link', (select status = 'sent' and kind = 'letter' and valid_until = (now() at time zone 'America/Toronto')::date + 21 from public.quotes where id = :'q')
  and (select count(*) = 1 and min(email) = 'pat@example.test' from public.quote_signers where quote_id = :'q'));
select test.check('the list: New letter, waiting', (select came_from = 'New letter' and letter = 'Year-end Aug 31, 2026' and client = 'Dummy Dental PC' and status = 'sent' from public.letter_list() where id = :'q'));
select test.check('letters are not in the Quotes list', not exists (select 1 from public.quote_list() where id = :'q'));
select test.check('the badge counts it', public.letters_waiting_count() = 1);
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b"}';
select test.check('staff with Documents see the letter list', (select count(*) from public.letter_list()) = 1);
select test.check('and the letter''s signing link, nothing else', (select count(*) from public.quote_signers) = 1 and (select count(*) from public.quotes where kind <> 'letter') = 0);
reset role;
reset request.jwt.claims;

\set h '''aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'''
select test.check('a company letter needs the signer''s title', test.try(format($f$select public.record_t1_signature(%L, 0, 'Pat Example', '', '', %L, false)$f$, :'q', :h)) like 'Type your title%');
select public.record_t1_signature(:'q', 0, 'Pat Example', '1.2.3.4', 'Test browser', :h, false, 'Director') as done \gset
select test.check('signed: the letter is signed and its engagement too', :'done' = 't' and (select status from public.quotes where id = :'q') = 'signed'
  and (select status = 'EL signed' and el_signed is not null from public.engagements where id = '00000000-0000-0000-0000-0000000000e1'));
