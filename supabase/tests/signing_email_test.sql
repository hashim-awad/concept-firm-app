-- Local tests: signing email switches (Hashim, Nov 12, 2026).
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'), ('00000000-0000-0000-0000-00000000000b', 'staff.b@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000b', 'Test Staff B', 'staff.b@example.test', (select id from public.roles where name = 'Staff'));
select test.check('off by default', public.signing_email_settings() = '{"letters": false, "quotes": false, "proposals": false}'::jsonb);
select public.set_signing_email(true, false, false);
select test.check('an owner switches New letters on', (public.signing_email_settings() ->> 'letters')::boolean);
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b"}';
select test.check('staff cannot change it', test.try('select public.set_signing_email(true, true, true)') like 'Only an owner%');
select test.check('staff can read it', (public.signing_email_settings() ->> 'letters')::boolean);
select test.check('staff cannot record a send result', test.try($f$select public.record_quote_email(gen_random_uuid(), '{}')$f$) <> 'OK');
