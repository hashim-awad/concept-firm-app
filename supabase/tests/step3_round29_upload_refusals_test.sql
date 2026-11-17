-- Local tests: round 29 (Hashim, Nov 17, 2026). A refused upload goes to the file's History with who, when, the file
-- and the reason, and is removed (or kept waiting, for an import refusal). Safe to run twice. Dummy data only.
\set ON_ERROR_STOP 1
create function test.h() returns setof public.cb_file_history language sql security definer set search_path = '' as $$ select * from public.cb_file_history $$;
grant execute on function test.h() to authenticated;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
\set A '''00000000-0000-0000-0000-00000000000a'''
insert into public.clients (kind, legal_name, province) values ('corporation', 'Maple Dummy Upload Inc.', 'ON') returning id as client \gset
select public.cb_create_file(:'client', '2026-08-31', '2025-09-01', '', 'full', 'statements', :A::uuid, :A::uuid) as f \gset
reset role;
insert into public.cb_statement_imports (id, file_id, created_by, file_name, media_type, storage_path, status, summary, result, finished_at) values
  ('00000000-0000-0000-0000-0000000029a1', :'f', :A::uuid, 'again-dummy.pdf', 'application/pdf', 'f/a1.pdf', 'ready', '{}', '{"accounts": []}', now()),
  ('00000000-0000-0000-0000-0000000029a2', :'f', :A::uuid, 'overlap-dummy.pdf', 'application/pdf', 'f/a2.pdf', 'ready', '{}', '{"accounts": []}', now()),
  ('00000000-0000-0000-0000-0000000029a3', :'f', :A::uuid, 'done-dummy.pdf', 'application/pdf', 'f/a3.pdf', 'imported', '{}', '{"accounts": []}', now());
set role authenticated;
select test.check('a refusal returns the stored file to remove', public.statement_refuse('00000000-0000-0000-0000-0000000029a1', 'It is already in.') = 'f/a1.pdf');
select test.check('the refused upload is removed', (select status = 'discarded' and result is null from public.cb_statement_imports where id = '00000000-0000-0000-0000-0000000029a1'));
select test.check('History keeps who, the file and the reason, once', (select count(*) = 1 from test.h() where file_id = :'f' and action = 'upload_refused'
  and ref_label = 'again-dummy.pdf' and reason = 'It is already in.' and actor_id = :A::uuid and import_id = '00000000-0000-0000-0000-0000000029a1')
  and not exists (select 1 from test.h() where file_id = :'f' and action = 'statement_discarded'));
select public.statement_refuse('00000000-0000-0000-0000-0000000029a2', 'This period overlaps a statement already imported.', false);
select test.check('an import refusal is logged and the statement stays waiting', (select status = 'ready' from public.cb_statement_imports where id = '00000000-0000-0000-0000-0000000029a2')
  and exists (select 1 from test.h() where action = 'upload_refused' and ref_label = 'overlap-dummy.pdf'));
select test.check('an imported statement is not refused here', test.try($q$select public.statement_refuse('00000000-0000-0000-0000-0000000029a3', 'x')$q$)
  = 'This statement is imported. Exclude it in View statements instead.');
reset role;
\i supabase/migrations/20261212050000_round29_upload_refusals.sql
select test.check('safe to run twice', to_regprocedure('public.statement_refuse(uuid, text, boolean)') is not null);
