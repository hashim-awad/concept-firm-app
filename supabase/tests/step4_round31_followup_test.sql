-- Local tests: round 31 follow-up, step 4 (Hashim, Nov 17, 2026). "Excluded lines reviewed": only the file's reviewer
-- (or an owner) can tick it; History logs who ticked it and when. Dummy data only.
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
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
\set A '''00000000-0000-0000-0000-00000000000a'''
\set C '''00000000-0000-0000-0000-00000000000c'''
insert into public.clients (kind, legal_name, province) values ('corporation', 'Maple Dummy Review Inc.', 'ON') returning id as client \gset
-- C prepares, A reviews.
select public.cb_create_file(:'client', '2026-08-31', '2025-09-01', '', 'full', 'statements', :C::uuid, :A::uuid) as f \gset
select public.cb_save_bank_account(:'f', null, 'chequing', 'Dummy Chq', '1357', 1000.00, false, false) as chq \gset
reset role;
select private.cb_add_statement(:'f', :'chq', 'chq.pdf', 1000.00, 955.00, '[{"line": 1, "date": "2026-01-21", "description": "DUPLICATE CHARGE DUMMY", "amount": -45.00}]',
  '2025-09-01', '2026-08-31', 1000.00, 955.00, null);
select id as l from public.cb_bank_lines where file_id = :'f' \gset

-- The preparer excludes the line, but cannot tick the review.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_exclude_lines(:'f', array[:'l']::uuid[], 'duplicate', '');
select test.check('the preparer cannot tick "Excluded lines reviewed"', test.try(format('select public.cb_excluded_reviewed(%L, true)', :'f')) = 'Only the reviewer ticks this.');

-- The reviewer ticks it: History has who and when.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_excluded_reviewed(:'f', true);
reset role;
select test.check('the reviewer ticks it; History logs who and when', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'excluded_reviewed'
  and detail = 'Excluded lines reviewed' and actor_id = :A::uuid and at > now() - interval '1 minute'));
select test.check('the tick is kept with who and when', (select excluded_reviewed_by = :A::uuid and excluded_reviewed_at is not null from public.cb_files where id = :'f'));
select test.check('ticked: the sign-off no longer lists the excluded line', not exists (select 1 from unnest(private.cb_step_problems(:'f', 'code')) x where x like 'Excluded:%'));
