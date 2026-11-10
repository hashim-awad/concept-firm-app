-- Local tests: lead alerts (Phase 2 step 5). Recipients are active staff whose role has Pricing (and
-- owners); only the server can read the list or the alert records.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'pricing.b@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.create_role('Pricer');
select public.set_role_permissions((select id from public.roles where name = 'Pricer'), '{"pricing":"view","leads":"view"}');
select public.add_staff('00000000-0000-0000-0000-00000000000b', 'Test Pricer B', 'pricing.b@example.test', (select id from public.roles where name = 'Pricer'));
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test', (select id from public.roles where name = 'Staff'));
select public.set_role_permissions((select id from public.roles where name = 'Staff'), '{"pricing":"none","leads":"view"}');
select test.check('staff cannot get the recipient list', test.try($$select public.lead_alert_recipients()$$) <> 'OK');
select test.check('staff cannot read alert records', test.try($$select count(*) from public.lead_alerts$$) <> 'OK');
reset role;
reset request.jwt.claims;

-- The server's view (service role), checked afterwards.
set role service_role;
select array_to_string(array_agg(e order by e), ',') as r1 from public.lead_alert_recipients() e \gset
reset role;
select test.check('recipients: owner and the Pricing role, not Staff without Pricing', :'r1' = 'owner.a@example.test,pricing.b@example.test');

update public.staff set is_active = false where id = '00000000-0000-0000-0000-00000000000b';
set role service_role;
select array_to_string(array_agg(e order by e), ',') as r2 from public.lead_alert_recipients() e \gset
reset role;
select test.check('switched-off staff get no alerts', :'r2' = 'owner.a@example.test');

-- An alert is claimed once: a second claim for the same lead and kind does nothing.
insert into public.settings (key, value) values ('start_page_open', 'true') on conflict (key) do update set value = 'true';
set role anon;
select public.submit_lead('personal', '{"first_name":"Jane","last_name":"Dummy","email":"jane@example.test","phone":"519-555-0100","province":"ON"}', '{}', repeat('b', 64)) as lead \gset
reset role;
set role service_role;
insert into public.lead_alerts (lead_id, kind) values (:'lead', 'new') on conflict do nothing;
insert into public.lead_alerts (lead_id, kind) values (:'lead', 'new') on conflict do nothing;
reset role;
select test.check('one record per lead and kind', (select count(*) from public.lead_alerts where lead_id = :'lead') = 1);
delete from public.leads where id = :'lead';
select test.check('records go with the lead', (select count(*) from public.lead_alerts where lead_id = :'lead') = 0);
