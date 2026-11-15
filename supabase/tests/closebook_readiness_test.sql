-- Local tests: round 16 readiness (acceptance, checklist rules, people, first year).
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test', (select id from public.roles where name = 'Staff'));
reset role;
reset request.jwt.claims;
update public.role_permissions set level = 'edit' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Staff');
\set A '''00000000-0000-0000-0000-00000000000a'''
\set C '''00000000-0000-0000-0000-00000000000c'''
-- Staff C prepares; owner A reviews.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
reset role;
insert into public.clients (kind, legal_name, province) values ('corporation', 'Maple Test Realty Inc.', 'ON') returning id as client \gset
set role authenticated;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_create_file(:'client', '2026-12-31', '2026-01-01', '', 'full', 'statements', :C::uuid, :A::uuid) as f \gset

-- 1. Acceptance: answers, the rules on them, and step 1's sign-off.
reset role;
select test.check('step 1 waits for the acceptance record', exists (select 1 from unnest(private.cb_step_problems(:'f', 'setup')) x where x = 'Answer the acceptance questions.'));
set role authenticated;
select public.cb_save_acceptance(:'f', '{"q1":"yes","q2":"no","q3":"yes","q4":"yes","q5":"no","q5_note":"","users":[{"kind":"lender","name":"Dummy Credit Union","agreed":"no"},{"kind":"other","name":"Dummy Landlord","agreed":"yes"}],"q8":"different","q8_note":"","q9":"yes"}'::jsonb);
reset role;
select test.check('question 2 No: a new or amended letter', 'Acceptance question 2 is No: a new or amended engagement letter is needed before work continues.' = any (private.cb_acceptance_problems(:'f')));
set role authenticated;
reset role;
select test.check('question 5 No needs a note', 'Acceptance question 5: say what affects independence.' = any (private.cb_acceptance_problems(:'f')));
set role authenticated;
reset role;
select test.check('question 7 per named user', 'Acceptance question 7 must be Yes for Dummy Credit Union.' = any (private.cb_acceptance_problems(:'f'))
  and not exists (select 1 from unnest(private.cb_acceptance_problems(:'f')) x where x like '%Dummy Landlord%'));
set role authenticated;
reset role;
select test.check('question 8 Different needs a note', 'Acceptance question 8: say how the basis differs.' = any (private.cb_acceptance_problems(:'f')));
set role authenticated;
select test.check('each answer records who and when', (select (answered -> 'q1' ->> 'by') = :A or (answered -> 'q1' ->> 'by') = :C from public.cb_acceptance where file_id = :'f'));
select test.check('an outside user needs a name', test.try(format($f$select public.cb_save_acceptance(%L, '{"users":[{"kind":"lender","name":"","agreed":"yes"}]}'::jsonb)$f$, :'f')) like '%Name each outside user%');
select public.cb_save_acceptance(:'f', '{"q1":"yes","q2":"yes","q3":"yes","q4":"yes","q5":"no","q5_note":"Our bookkeeper is the shareholder''s daughter.","users":[{"kind":"lender","name":"Dummy Credit Union","agreed":"yes"}],"q8":"confirmed","q8_note":"","q9":"yes"}'::jsonb);
reset role;
select test.check('a complete record clears the acceptance problems', cardinality(private.cb_acceptance_problems(:'f')) = 0);
set role authenticated;

-- 2. People: only an owner changes them; the reviewer must be an owner.
select test.check('staff cannot change the people', test.try(format($f$select public.cb_set_people(%L, %L, %L)$f$, :'f', :C, :A)) like '%Only an owner%');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('a non-owner is refused as reviewer', test.try(format($f$select public.cb_set_people(%L, %L, %L)$f$, :'f', :A, :C)) like 'Test Staff C is not an owner%');
select public.cb_set_people(:'f', :A, :A);
select test.check('an owner may prepare and review', (select preparer_id = reviewer_id from public.cb_files where id = :'f'));
select public.cb_set_people(:'f', :C, :A);
select test.check('the change is in the file history', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'people_changed'));
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';

-- 3. First year: no opening balances; refused when the client has an earlier file.
select public.cb_set_first_year(:'f', true);
reset role;
select test.check('a first year has no opening problem', private.cb_opening_problem(:'f') is null and (select first_year from public.cb_files where id = :'f')
  and (select first_year from public.cb_file_fs where file_id = :'f'));
set role authenticated;
select public.cb_create_file(:'client', '2027-12-31', '2027-01-01', '', 'full', 'statements', :C::uuid, :A::uuid) as f2 \gset
select test.check('the next year is not a first year', test.try(format($f$select public.cb_set_first_year(%L, true)$f$, :'f2')) like '%earlier Closebook file%');

-- 4. The acceptance rolls forward: "Same as last year for all" confirms every answer.
select public.cb_acceptance_same_as_last(:'f2');
select test.check('rolled forward and confirmed', (select q1 = 'yes' and users -> 0 ->> 'name' = 'Dummy Credit Union' and (answered -> 'q9' ->> 'same')::boolean and (answered -> 'q6' ->> 'same')::boolean
  from public.cb_acceptance where file_id = :'f2'));

-- 5. The checklist has 13 questions; the first 12 are kept for files answered on them.
select test.check('13 active questions', (select count(*) from public.cb_checklist_questions where active) = 13 and (select count(*) from public.cb_checklist_questions where not active) = 12);

-- 6. Shareholder loans (round 16 fix): an amount decided in an earlier file sits outside last year's
-- part and this year's part; the three add up to the balance owed.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('decided amount outside the two parts: refused when it does not add up',
  test.try(format($q$select public.cb_prepare_sh_schedule(%L, '[]', '[{"group_key":"sh:1","shareholder":1,"accounts":["chart:13000"],"opening":3000,"closing":3000,"last_part":3000,"this_part":0,"due_on":"","decided_left":3000,"decided":[],"flags":[]}]')$q$, :'f2')) like 'Decided amounts, last year''s part and this year''s part add up%');
select public.cb_prepare_sh_schedule(:'f2', '[]', '[{"group_key":"sh:1","shareholder":1,"accounts":["chart:13000"],"opening":3000,"closing":3000,"last_part":0,"this_part":0,"due_on":"","prior_due_on":"","decided_left":3000,
  "decided":[{"year":2026,"kind":"not_included","income_year":null,"why":"Repaid in March.","start":3000,"left":3000,"repaid":0}],"flags":[]}]');
reset role;
reset request.jwt.claims;
select test.check('all decided: no date, no "Repaid by", the decision kept', (select last_part = 0 and due_on is null and prior_due_on is null and decided_left = 3000 and decided -> 0 ->> 'kind' = 'not_included'
  from public.cb_sh_groups where file_id = :'f2'));
