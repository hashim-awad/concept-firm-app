-- Local tests: proposals as quotes, sent and signed with a chosen option (front office batch, step 1).
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'), ('00000000-0000-0000-0000-00000000000b', 'staff.b@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000b', 'Test Staff B', 'staff.b@example.test', (select id from public.roles where name = 'Staff'));
select public.set_role_permissions((select id from public.roles where name = 'Staff'), '{"pricing":"view","documents":"edit","leads":"none"}');
\set data '''{"f":{"name":"Dummy Realty Team Inc.","L_company":"Dummy Realty Team Inc."},"opts":[{"name":"Option A"},{"name":"Option B"}],"rec":0}'''

select public.save_proposal(null, null, null, 'Dummy Realty Team Inc.', :data) as p \gset
select test.check('a proposal is a draft quote from the start', (select kind = 'proposal' and status = 'draft' from public.quotes where id = :'p'));
select test.check('saving again keeps one record', public.save_proposal(:'p', null, null, 'Dummy Realty Team', :data) = :'p'::uuid and (select count(*) from public.quotes where kind = 'proposal') = 1);

-- Staff with Documents and Pricing work on drafts but cannot send.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b"}';
select test.check('staff can save a draft', test.try(format($f$select public.save_proposal(%L, null, null, 'Dummy Realty Team', %L)$f$, :'p', :data)) = 'OK');
select test.check('staff can read their proposal without Leads', (select count(*) from public.quotes where id = :'p') = 1);
select test.check('only an owner sends', test.try(format($f$select public.send_proposal(%L, 'Pat', 'Example', 'pat@example.test')$f$, :'p')) like 'Only an owner%');

set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('a signing email is needed', test.try(format($f$select public.send_proposal(%L, 'Pat', 'Example', 'not an email')$f$, :'p')) like 'Enter the signing officer''s email%');
select public.send_proposal(:'p', 'Pat', 'Example', 'Pat@Example.test') as until \gset
select test.check('sent: 21 days, the signer gets a link', :'until'::date = (now() at time zone 'America/Toronto')::date + 21
  and (select email from public.quote_signers where quote_id = :'p') = 'pat@example.test'
  and (select status = 'sent' and company_name = 'Dummy Realty Team Inc.' and sender ->> 'name' = 'Test Owner A' from public.quotes where id = :'p'));
select test.check('a sent proposal cannot change', test.try(format($f$select public.save_proposal(%L, null, null, 'X', %L)$f$, :'p', :data)) like 'This proposal was sent%');
select test.check('a sent proposal cannot be deleted', test.try(format($f$select public.delete_proposal_draft(%L)$f$, :'p')) like 'Only a draft%');
reset role;
reset request.jwt.claims;

\set h '''aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'''
select test.check('the client must choose an option', test.try(format($f$select public.record_t1_signature(%L, 0, 'Pat Example', '', '', %L, false, 'Director')$f$, :'p', :h)) like 'Choose an option%');
select test.check('only an option on the proposal', test.try(format($f$select public.record_t1_signature(%L, 0, 'Pat Example', '', '', %L, false, 'Director', 2)$f$, :'p', :h)) like 'Choose an option%');
select test.check('a title is needed', test.try(format($f$select public.record_t1_signature(%L, 0, 'Pat Example', '', '', %L, false, '', 1)$f$, :'p', :h)) like 'Type your title%');
select public.record_t1_signature(:'p', 0, 'Pat Example', '1.2.3.4', 'Test browser', :h, false, 'Director', 1) as done \gset
select test.check('signed with option B', :'done' = 't' and (select status = 'signed' and chosen_option = 1 from public.quotes where id = :'p'));

-- A draft can be deleted.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.save_proposal(null, null, null, 'Second', :data) as p2 \gset
select public.delete_proposal_draft(:'p2');
select test.check('a draft is deleted', (select count(*) from public.quotes where id = :'p2') = 0);
