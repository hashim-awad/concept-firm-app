-- Local tests: Phase 2 settings (plan step 3): business hours, booking link, T1 rule values, staff phone.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test',
  (select id from public.roles where name = 'Staff'));

select test.check('T1 rule values start at the checked figures', (select value ->> 'moving_km' from public.settings where key = 't1_rules') = '40'
  and (select (value ->> 't1135_simple_over')::int from public.settings where key = 't1_rules') = 100000
  and (select (value ->> 't1135_detailed_from')::int from public.settings where key = 't1_rules') = 250000);
select test.check('business hours start empty (not set)', (select value from public.settings where key = 'business_hours') ->> 'mon' is null);

select test.check('owner sets business hours', test.try($$select public.update_setting('business_hours', '{"mon":["09:00","17:00"],"tue":["09:00","17:00"],"wed":["09:00","17:00"],"thu":["09:00","17:00"],"fri":["09:00","15:00"],"sat":null,"sun":null}')$$) = 'OK');
select test.check('saved', (select value -> 'fri' ->> 1 from public.settings where key = 'business_hours') = '15:00');
select test.check('start must be before end', test.try($$select public.update_setting('business_hours', '{"mon":["17:00","09:00"]}')$$) like 'Each day needs%');
select test.check('times must be HH:MM', test.try($$select public.update_setting('business_hours', '{"mon":["9am","5pm"]}')$$) like 'Each day needs%');
select test.check('booking link must be https', test.try($$select public.update_setting('booking_link', '"http://calendly.com/x"')$$) like 'The booking link%'
  and test.try($$select public.update_setting('booking_link', '"https://calendly.com/concept/intro"')$$) = 'OK');
select test.check('T1 values: detailed above simplified', test.try($$select public.update_setting('t1_rules', '{"moving_km":40,"t1135_simple_over":250000,"t1135_detailed_from":100000,"checked_on":"2026-11-09"}')$$) like '%detailed T1135%');
select test.check('T1 values: owner changes them', test.try($$select public.update_setting('t1_rules', '{"moving_km":40,"t1135_simple_over":100000,"t1135_detailed_from":250000,"checked_on":"2026-11-10"}')$$) = 'OK');

select test.check('owner sets a staff phone', test.try($$select public.update_staff_phone('00000000-0000-0000-0000-00000000000c', '226-789-9591')$$) = 'OK');
select test.check('phone must look like a phone number', test.try($$select public.update_staff_phone('00000000-0000-0000-0000-00000000000c', 'call me')$$) like 'Enter the phone%');

set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('staff change their own phone', test.try($$select public.update_staff_phone('00000000-0000-0000-0000-00000000000c', '(519) 555-0100')$$) = 'OK');
select test.check('staff cannot change someone else''s phone', test.try($$select public.update_staff_phone('00000000-0000-0000-0000-00000000000a', '519-555-0101')$$) like 'You do not have permission%');
select test.check('staff cannot change T1 rule values', test.try($$select public.update_setting('t1_rules', '{"moving_km":10,"t1135_simple_over":1,"t1135_detailed_from":2,"checked_on":"2026-11-10"}')$$) <> 'OK');
reset role;
