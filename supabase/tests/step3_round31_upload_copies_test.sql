-- Local tests: round 31 (Hashim, Nov 17, 2026). A file uploaded again (the same statement already waiting in the list)
-- is still removed as a copy, but now says which upload it is a copy of, so the upload window can say so and follow
-- that upload instead of showing nothing. A refused import keeps its reason until Fix it or Read again clears it.
-- Safe to run twice. Dummy data only.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
\set A '''00000000-0000-0000-0000-00000000000a'''
insert into public.clients (kind, legal_name, province) values ('corporation', 'Maple Dummy Upload Inc.', 'ON') returning id as client \gset
select public.cb_create_file(:'client', '2026-08-31', '2025-09-01', '', 'full', 'statements', :A::uuid, :A::uuid) as f \gset
select public.cb_save_bank_account(:'f', null, 'card', 'Dummy MC', '4417', 1250.00, false, false) as card \gset
reset role;
-- The first upload of a card statement: read, adds up, still waiting (its import was never tried again in that tab).
insert into public.cb_statement_imports (id, file_id, created_by, file_name, media_type, storage_path, status, file_sha256, summary, result, created_at, target_account) values
  ('00000000-0000-0000-0000-0000000031a1', :'f', :A::uuid, 'card-2025-12-18.pdf', 'application/pdf', 'f/a1.pdf', 'ready', 'sha-dummy-a',
   '{"period_start":"2025-12-18","period_end":"2026-01-19","found":[{"name":"MC","last4":"4417","kind":"card"}]}', '{"accounts": []}', now() - interval '1 day', :'card'),
-- The same file uploaded again today: fingerprinted by the reader, not read yet.
  ('00000000-0000-0000-0000-0000000031a2', :'f', :A::uuid, 'card-2025-12-18.pdf', 'application/pdf', 'f/a2.pdf', 'reading', 'sha-dummy-a', null, null, now(), :'card');
select public.statement_keep_one('00000000-0000-0000-0000-0000000031a2') as kept \gset
select test.check('the same file uploaded again: the new upload goes, the first stays waiting',
  :'kept' = '00000000-0000-0000-0000-0000000031a1'
  and (select status = 'discarded' from public.cb_statement_imports where id = '00000000-0000-0000-0000-0000000031a2')
  and (select status = 'ready' from public.cb_statement_imports where id = '00000000-0000-0000-0000-0000000031a1'));
select test.check('the removed upload says which upload it is a copy of, with the reason',
  (select copy_of = '00000000-0000-0000-0000-0000000031a1' and error = 'Another copy of this statement is already in the list.'
     from public.cb_statement_imports where id = '00000000-0000-0000-0000-0000000031a2'));
set role authenticated;
select test.check('the person who uploaded can see the copy and what it is a copy of (the window reads it)',
  exists (select 1 from public.cb_statement_imports where id = '00000000-0000-0000-0000-0000000031a2' and copy_of is not null));

-- A refused import keeps its reason ("To fix", not tried again by itself); Read again clears it.
select public.statement_refuse('00000000-0000-0000-0000-0000000031a1', 'A line is dated outside the statement period.', false);
select test.check('refused import: waits in To fix with its reason', (select status = 'needs_look' and error like 'A line is dated outside%'
  from public.cb_statement_imports where id = '00000000-0000-0000-0000-0000000031a1'));
select public.statement_read_again('00000000-0000-0000-0000-0000000031a1');
select test.check('read again: the reason is cleared, back to the reader', (select status = 'queued' and error is null
  from public.cb_statement_imports where id = '00000000-0000-0000-0000-0000000031a1'));

-- ---------- Safe to run twice
reset role;
\i supabase/migrations/20261212070000_round31_upload_copies.sql
select test.check('safe to run twice: one copy_of column, the patch placed once',
  (select count(*) = 1 from information_schema.columns where table_schema = 'public' and table_name = 'cb_statement_imports' and column_name = 'copy_of')
  and (select (length(d) - length(replace(d, 'copy_of = k.id', ''))) / length('copy_of = k.id') = 1
       from (select pg_get_functiondef('public.statement_keep_one(uuid)'::regprocedure) d) x));
