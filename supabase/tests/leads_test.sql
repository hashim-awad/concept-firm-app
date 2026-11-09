-- Local tests: leads (Phase 2 step 4). Public form closed until an owner opens it; submission limit;
-- assignment rule; staff edit status, only owners reassign; what the client entered cannot change;
-- the activity log holds no client details; closed leads deleted after the retention period.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test',
  (select id from public.roles where name = 'Staff'));
reset role;

\set c '{"first_name":"Jane","last_name":"Dummy","email":"Jane.Dummy@example.test","phone":"519-555-0100","province":"ON"}'
\set h '''aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'''

set role anon;
set request.jwt.claims = '{}';
select test.check('closed start page refuses the public', test.try($$select public.submit_lead('personal', '{"first_name":"A","last_name":"B","email":"a@b.co","phone":"5195550100","province":"ON"}', '{}', repeat('a', 64))$$) like 'This form is not open%');
select test.check('the public cannot read leads', test.try($$select count(*) from public.leads$$) <> 'OK');
reset role;

set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('owner opens the start page', test.try($$select public.update_setting('start_page_open', 'true')$$) = 'OK');
select test.check('owner sets assignment to one person', test.try($$select public.update_setting('lead_assignment', '{"mode":"single","staff_ids":["00000000-0000-0000-0000-00000000000c"]}')$$) = 'OK');
reset role;

set role anon;
set request.jwt.claims = '{}';
select test.check('the public submits a lead', test.try(format($$select public.submit_lead('personal', %L, '{}', %L)$$, :'c', :h)) = 'OK');
select test.check('phone required on the personal form', test.try(format($$select public.submit_lead('personal', %L, '{}', %L)$$, '{"first_name":"A","last_name":"B","email":"a@b.co","province":"ON"}', :h)) like 'Enter your phone%');
select test.check('company form without phone is fine', test.try(format($$select public.submit_lead('company', %L, '{}', %L)$$, '{"first_name":"Co","last_name":"Owner","email":"co@example.test","province":"AB"}', :h)) = 'OK');
select test.check('bad email refused', test.try(format($$select public.submit_lead('company', %L, '{}', %L)$$, '{"first_name":"Co","last_name":"Owner","email":"not-an-email","province":"AB"}', :h)) <> 'OK');
select test.check('province must be a Canadian province or territory', test.try(format($$select public.submit_lead('company', %L, '{}', %L)$$, '{"first_name":"Co","last_name":"Owner","email":"x@y.co","province":"NY"}', :h)) <> 'OK');
select public.submit_lead('company', '{"first_name":"C","last_name":"D","email":"c3@example.test","province":"ON"}', '{}', repeat('a', 64));
select public.submit_lead('company', '{"first_name":"C","last_name":"D","email":"c4@example.test","province":"ON"}', '{}', repeat('a', 64));
select public.submit_lead('company', '{"first_name":"C","last_name":"D","email":"c5@example.test","province":"ON"}', '{}', repeat('a', 64));
select test.check('limit: 5 per visitor per hour', test.try($$select public.submit_lead('company', '{"first_name":"C","last_name":"D","email":"c6@example.test","province":"ON"}', '{}', repeat('a', 64))$$) like 'You have sent this form several times%');
select test.check('another visitor still gets through', test.try($$select public.submit_lead('company', '{"first_name":"E","last_name":"F","email":"e@example.test","province":"ON"}', '{}', repeat('b', 64))$$) = 'OK');
reset role;

select test.check('email stored in lower case; assigned by the rule', (select email from public.leads where first_name = 'Jane') = 'jane.dummy@example.test'
  and (select assigned_to from public.leads where first_name = 'Jane') = '00000000-0000-0000-0000-00000000000c');
select test.check('the log holds no client details', not exists (select 1 from public.activity_log where entity_type = 'leads' and (details::text like '%Jane%' or details::text like '%example.test%')));

set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('staff read leads', (select count(*) from public.leads) = 6);
select test.check('staff mark a lead lost', test.try($$update public.leads set status = 'lost', notes = 'No reply' where first_name = 'Jane'$$) = 'OK');
select test.check('closing date set', (select closed_at is not null from public.leads where first_name = 'Jane'));
select test.check('staff cannot reassign', test.try($$update public.leads set assigned_to = null where first_name = 'Jane'$$) like 'Only an owner%');
select test.check('what the client entered cannot change', test.try($$update public.leads set email = 'x@y.co' where first_name = 'Jane'$$) like 'What the client entered%');
select test.check('staff cannot delete leads', test.try($$delete from public.leads$$) <> 'OK' or (select count(*) from public.leads) = 6);
select test.check('staff cannot run the deletion', test.try($$select public.purge_closed_leads()$$) <> 'OK');
reset role;

select test.check('the change log names fields, not values', (select details from public.activity_log where entity_type = 'leads' and action = 'update' order by id desc limit 1) = '{"fields": ["notes", "status"], "status": "lost"}');

-- Retention: a lost lead closed 25 months ago is deleted; a recent one and a signed one are kept.
update public.leads set closed_at = now() - interval '25 months' where first_name = 'Jane';
set role service_role;
select public.purge_closed_leads() as purged \gset
reset role;
select test.check('server deletes closed leads past retention', :purged = 1);
select test.check('deleted, logged with count only', not exists (select 1 from public.leads where first_name = 'Jane')
  and (select details from public.activity_log where action = 'leads_deleted') = '{"count": 1, "months": 24}');
