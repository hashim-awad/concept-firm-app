-- Local tests: Download full export (decision 9, Phase 2 step 11). Owners only, every table, every file.
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
insert into storage.objects (bucket_id, name) values ('documents', 't1-quotes/q1/signed-abc.pdf'), ('documents', 'vault/c1/letter.pdf');

-- Staff and the public cannot use it.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('staff cannot list the tables', test.try('select public.export_tables()') like '%Only an owner%');
select test.check('staff cannot read rows', test.try($$select public.export_rows('staff', 0, 10)$$) like '%Only an owner%');
select test.check('staff cannot list the files', test.try('select public.export_files()') like '%Only an owner%');
reset role;
reset request.jwt.claims;
set role anon;
select test.check('the public cannot use it', test.try('select public.export_tables()') <> 'OK');
reset role;

-- The owner gets every table, every row past row security, and every file.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('every public table is listed', (select count(*) from public.export_tables()) =
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p')));
select test.check('the activity log is in it', exists (select 1 from public.export_tables() t where t = 'activity_log'));
select test.check('all rows of a table, in pages', jsonb_array_length(public.export_rows('staff', 0, 1)) = 1
  and jsonb_array_length(public.export_rows('staff', 1, 1)) = 1 and jsonb_array_length(public.export_rows('staff', 2, 1)) = 0);
select test.check('pages do not overlap', public.export_rows('staff', 0, 1) <> public.export_rows('staff', 1, 1));
select test.check('rows come as JSON with every column', public.export_rows('roles', 0, 1) -> 0 ? 'is_owner');
select test.check('an unknown table is refused', test.try($$select public.export_rows('pg_authid', 0, 10)$$) like '%Unknown table%');
select test.check('no SQL through the table name', test.try($$select public.export_rows('staff; drop table public.staff', 0, 10)$$) like '%Unknown table%');
select test.check('a huge page is refused', test.try($$select public.export_rows('staff', 0, 100000)$$) like '%Bad page%');
select test.check('every stored file is listed', (select count(*) from public.export_files()) = 2);
select public.record_full_export(30, 120, 2);
select test.check('the export is recorded', (select value ->> 'files' from public.settings where key = 'last_full_export') = '2');
reset role;
reset request.jwt.claims;
select test.check('and it is in the activity log', exists (select 1 from public.activity_log where details::text like '%last_full_export%'));
