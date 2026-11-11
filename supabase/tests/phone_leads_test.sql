-- Local tests: New lead by phone (front office batch, step 2).
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'), ('00000000-0000-0000-0000-00000000000b', 'staff.b@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000b', 'Test Staff B', 'staff.b@example.test', (select id from public.roles where name = 'Staff'));
select public.set_role_permissions((select id from public.roles where name = 'Staff'), '{"leads":"view"}');
\set c '''{"first_name":"Jane","last_name":"Dummy","email":"Jane@Example.test","phone":"519-555-0100","province":"ON"}'''

select public.create_phone_lead('personal', :c, '{"tax_year":2026,"household":{},"people":[{}]}', 'new', null, null) as l \gset
select test.check('a phone lead: source Phone, taken by and assigned to the caller''s staff member', (select source = 'Phone' and taken_by = '00000000-0000-0000-0000-00000000000a' and assigned_to = taken_by and email = 'jane@example.test' and status = 'new' from public.leads where id = :'l'));
select public.create_phone_lead('company', :c, '{"need":"monthly"}', 'call_needed', null, 'Dummy Realty Inc.') as l2 \gset
select test.check('sent to Hashim', (select status = 'call_needed' and company_name = 'Dummy Realty Inc.' from public.leads where id = :'l2'));
select test.check('a phone number is needed', test.try($f$select public.create_phone_lead('personal', '{"first_name":"A","last_name":"B","email":"a@b.test","phone":"","province":"ON"}', '{}', 'new', null, null)$f$) like 'Enter the caller''s phone%');
select test.check('only the three finishes', test.try(format($f$select public.create_phone_lead('personal', %L, '{}', 'signed', null, null)$f$, :c)) like 'Unknown finish%');

set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b"}';
select test.check('view-only staff cannot enter a phone lead', test.try(format($f$select public.create_phone_lead('personal', %L, '{}', 'new', null, null)$f$, :c)) like 'You need Edit on Leads%');
reset role;
reset request.jwt.claims;
select test.check('no alert or reminder for a lead staff entered', (select count(*) from public.lead_alerts where lead_id = :'l' and sent_at is not null) = 2);
select test.check('a lead sent to Hashim alerts as usual', (select count(*) from public.lead_alerts where lead_id = :'l2') = 0);
