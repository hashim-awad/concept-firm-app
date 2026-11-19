-- Local tests: piece 1 of the step 5 restructure (Hashim, Nov 18, 2026): the CRA rates page. Owners add and change
-- the per-km allowance rates by year and the ITC factor per province; staff cannot; a year cannot be added twice;
-- a factor that is not two whole numbers is refused; every add and change is in the activity log with old and new.
-- Dummy rates typed by the test only (no rates are loaded by the migration).
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'), ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test', (select id from public.roles where name = 'Accountant'));
reset role;
update public.role_permissions set level = 'edit' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Accountant');

select test.check('no rates are loaded by the migration', not exists (select 1 from public.cb_cra_km_rates) and not exists (select 1 from public.cb_cra_itc_factors));

-- T1: an owner enters three years and the Ontario factor.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_save_km_rates(2024, 0.70, 0.64, 0.74, 0.68, true);
select public.cb_save_km_rates(2025, 0.72, 0.66, 0.76, 0.70, true);
select public.cb_save_km_rates(2026, 0.73, 0.67, 0.77, 0.71, true);
select public.cb_save_itc_factor('ON', '13/113');
select test.check('T1: three years saved with their four rates',
  (select string_agg(format('%s %s/%s %s/%s', year, first_prov, after_prov, first_terr, after_terr), '; ' order by year) from public.cb_cra_km_rates)
  = '2024 0.70/0.64 0.74/0.68; 2025 0.72/0.66 0.76/0.70; 2026 0.73/0.67 0.77/0.71');
select test.check('T1: who entered them is kept', (select bool_and(entered_by = '00000000-0000-0000-0000-00000000000a') from public.cb_cra_km_rates));
select test.check('T1: Ontario 13/113 saved', (select format('%s/%s', numerator, denominator) from public.cb_cra_itc_factors where province = 'ON') = '13/113');

-- T2: 2026's first rate to 0.74 and back to 0.73; the activity log keeps both changes with old and new values.
select public.cb_save_km_rates(2026, 0.74, 0.67, 0.77, 0.71, false);
select public.cb_save_km_rates(2026, 0.73, 0.67, 0.77, 0.71, false);
reset role;
select test.check('T2: two updates on 2026 in the activity log, old and new values',
  (select string_agg(format('%s→%s', details -> 'old' ->> 'first_prov', details -> 'new' ->> 'first_prov'), ', ' order by id)
     from public.activity_log where entity_type = 'cb_cra_km_rates' and action = 'update' and entity_id is null and details -> 'new' ->> 'year' = '2026')
  = '0.73→0.74, 0.74→0.73');
select test.check('T2: the changes name who made them', (select bool_and(actor_id = '00000000-0000-0000-0000-00000000000a') from public.activity_log where entity_type = 'cb_cra_km_rates'));
select test.check('T1/T2: the adds are logged too (3 years, 1 province)',
  (select count(*) from public.activity_log where entity_type = 'cb_cra_km_rates' and action = 'insert') = 3
  and (select count(*) from public.activity_log where entity_type = 'cb_cra_itc_factors' and action = 'insert') = 1);
select test.check('T2: 2026 is back to 0.73, updated by the owner', (select first_prov = 0.73 and updated_by = '00000000-0000-0000-0000-00000000000a' from public.cb_cra_km_rates where year = 2026));

-- T3: a staff member who is not an owner cannot change anything (reading is allowed, for the schedules later).
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('T3: staff cannot add a year', test.try($q$select public.cb_save_km_rates(2027, 0.75, 0.69, 0.79, 0.73, true)$q$) = 'Only an Admin can change the CRA rates.');
select test.check('T3: staff cannot change a year', test.try($q$select public.cb_save_km_rates(2026, 0.99, 0.67, 0.77, 0.71, false)$q$) = 'Only an Admin can change the CRA rates.');
select test.check('T3: staff cannot change a factor', test.try($q$select public.cb_save_itc_factor('ON', '5/105')$q$) = 'Only an Admin can change the CRA rates.');
select test.check('T3: staff cannot write the tables directly', test.try($q$insert into public.cb_cra_km_rates (year, first_prov, after_prov, first_terr, after_terr) values (2030, 1, 1, 1, 1)$q$) like '%permission denied%'
  and test.try($q$update public.cb_cra_itc_factors set numerator = 1$q$) like '%permission denied%');
select test.check('T3: nothing changed', (select first_prov from public.cb_cra_km_rates where year = 2026) = 0.73 and not exists (select 1 from public.cb_cra_km_rates where year = 2027));

-- T4: a year cannot be entered twice; a fraction that is not two whole numbers is refused with a plain message.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('T4: a year twice is refused', test.try($q$select public.cb_save_km_rates(2025, 0.10, 0.10, 0.10, 0.10, true)$q$) = '2025 is already in the table. Change its rates instead.');
select test.check('T4: 13.5/113 refused', test.try($q$select public.cb_save_itc_factor('ON', '13.5/113')$q$) = 'Type the factor as two whole numbers with a slash, for example 13/113.');
select test.check('T4: 0.115 refused', test.try($q$select public.cb_save_itc_factor('ON', '0.115')$q$) = 'Type the factor as two whole numbers with a slash, for example 13/113.');
select test.check('T4: 13/ refused', test.try($q$select public.cb_save_itc_factor('BC', '13/')$q$) = 'Type the factor as two whole numbers with a slash, for example 13/113.');
select test.check('T4: 113/13 refused (more than 1)', test.try($q$select public.cb_save_itc_factor('BC', '113/13')$q$) = 'The top number must be more than 0 and smaller than the bottom number, for example 13/113.');
select test.check('T4: more than two decimals refused', test.try($q$select public.cb_save_km_rates(2027, 0.735, 0.67, 0.77, 0.71, true)$q$) = 'Rates have at most two decimals, for example 0.73.');
select test.check('T4: a missing rate refused', test.try($q$select public.cb_save_km_rates(2027, 0.73, null, 0.77, 0.71, true)$q$) = 'Fill in all four rates.');
select test.check('T4: changing a year not in the table refused', test.try($q$select public.cb_save_km_rates(2019, 0.73, 0.67, 0.77, 0.71, false)$q$) = '2019 is not in the table. Add it first.');
select test.check('T4: spaces around the numbers are fine', test.try($q$select public.cb_save_itc_factor('NS', ' 14 / 114 ')$q$) = 'OK');
select test.check('T4: and the factor is kept as 14/114', (select format('%s/%s', numerator, denominator) from public.cb_cra_itc_factors where province = 'NS') = '14/114');
select test.check('T4: an unknown province refused', test.try($q$select public.cb_save_itc_factor('XX', '13/113')$q$) = 'Pick a province or territory.');
reset role;
