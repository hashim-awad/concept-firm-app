-- Local tests: CloseBook2 piece CB2-0 version 7, Part 4 item 5 (Hashim, Nov 21, 2026; rule 12). Every Closebook row carries
-- its firm; a second dummy firm cannot read or change anything of the first, directly or through the database functions.
-- Dummy data only.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'), ('00000000-0000-0000-0000-00000000000b', 'other.b@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000b', 'Other Firm B', 'other.b@example.test', (select id from public.roles where name = 'Accountant'));
reset role;
update public.role_permissions set level = 'edit' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Accountant');
select test.check('staff join Concept by default', (select count(*) from public.firm_members where firm_id = private.concept_firm()) = 2);
-- The second dummy firm.
insert into public.firms (id, name) values ('00000000-0000-4000-8000-0000000000bb', 'Dummy Firm B');
update public.firm_members set firm_id = '00000000-0000-4000-8000-0000000000bb' where user_id = '00000000-0000-0000-0000-00000000000b';

-- Firm A (Concept): a file with an entry.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
insert into public.clients (kind, legal_name, province) values ('corporation', 'Birch Dummy Firms Inc.', 'ON') returning id as client \gset
select public.cb_create_file(:'client', '2026-12-31', '2026-01-01', '', 'full', 'statements', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a') as f \gset
select public.cb_add_entry(:'f', 'AJE', 'correction', 'Dummy accrual', false, '[{"chart":"65100","amount":20},{"chart":"21100","amount":-20}]', 'Payables listing', null, null, '{}', null) as e \gset
reset role;
select test.check('the file, its entry and its History carry Concept''s firm',
  (select firm_id = private.concept_firm() from public.cb_files where id = :'f')
  and not exists (select 1 from public.cb_entries where file_id = :'f' and firm_id <> private.concept_firm())
  and not exists (select 1 from public.cb_entry_lines l join public.cb_entries e on e.id = l.entry_id where e.file_id = :'f' and l.firm_id <> private.concept_firm())
  and exists (select 1 from public.cb_file_history where file_id = :'f') and not exists (select 1 from public.cb_file_history where file_id = :'f' and firm_id <> private.concept_firm()));
select test.check('every cb_ table has a firm ID, row-level security and the guard',
  (select count(*) from pg_tables t where t.schemaname = 'public' and t.tablename like 'cb\_%'
     and exists (select 1 from information_schema.columns c where c.table_name = t.tablename and c.column_name = 'firm_id')
     and exists (select 1 from pg_policies p where p.tablename = t.tablename and p.policyname = 'Own firm only' and p.permissive = 'RESTRICTIVE')
     and exists (select 1 from pg_trigger g where g.tgrelid = ('public.' || t.tablename)::regclass and g.tgname = 'cb_0_firm_guard'))
  = (select count(*) from pg_tables where schemaname = 'public' and tablename like 'cb\_%'));

-- Firm B reads nothing of firm A.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b"}';
select test.check('firm B reads no file, entry, line, account or History of firm A',
  (select count(*) from public.cb_files) = 0 and (select count(*) from public.cb_entries) = 0 and (select count(*) from public.cb_entry_lines) = 0
  and (select count(*) from public.cb_accounts) = 0 and (select count(*) from public.cb_file_history) = 0 and (select count(*) from public.cb_master_lines) = 0);
select test.check('firm B cannot read a file''s data through a database function', test.try(format('select public.cb_close_status(%L)', :'f')) = 'File not found.'
  and test.try(format('select public.cb_step_status(%L)', :'f')) = 'File not found.');
-- Firm B changes nothing of firm A.
select test.check('firm B cannot add an entry to firm A''s file', test.try(format($q$select public.cb_add_entry(%L, 'AJE', 'correction', 'x', false, '[{"chart":"65100","amount":5},{"chart":"21100","amount":-5}]', 'x', null, null, '{}', null)$q$, :'f')) <> 'OK');
select test.check('firm B cannot change or delete firm A''s entry',
  test.try(format($q$select public.cb_edit_entry(%L, 'AJE', 'correction', 'x', false, '[{"chart":"65100","amount":9},{"chart":"21100","amount":-9}]', 'x')$q$, :'e')) <> 'OK'
  and test.try(format('select public.cb_delete_entry(%L)', :'e')) <> 'OK');
select test.check('firm B has no direct write to entries (table rights), and the guard stops the functions', test.try(format($q$update public.cb_entries set note = 'changed' where id = %L$q$, :'e')) like 'permission denied%');
reset role;
select test.check('firm A''s entry is unchanged', (select note = 'Dummy accrual' from public.cb_entries where id = :'e') and (select count(*) from public.cb_entries where file_id = :'f') = 1);

-- Firm B's own file carries firm B; firm A does not see it.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b"}';
insert into public.clients (kind, legal_name, province) values ('corporation', 'Cedar Dummy Firm B Inc.', 'ON') returning id as client_b \gset
select public.cb_create_file(:'client_b', '2026-12-31', '2026-01-01', '', 'full', 'statements', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a') as f_b \gset
select test.check('firm B sees its own file', (select count(*) from public.cb_files) = 1);
reset role;
select test.check('firm B''s file carries firm B', (select firm_id = '00000000-0000-4000-8000-0000000000bb' from public.cb_files where id = :'f_b'));
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('firm A does not see firm B''s file, nor read it through a function', (select count(*) from public.cb_files where id = :'f_b') = 0
  and test.try(format('select public.cb_close_status(%L)', :'f_b')) = 'File not found.');
