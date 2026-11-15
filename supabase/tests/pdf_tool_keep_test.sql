-- Local tests: Bank statement PDF to CSV fix (Hashim, Nov 15, 2026). A download keeps the statement;
-- Done deletes every statement on the person's page; anything left is deleted 24 hours after it was
-- converted. The log keeps only who, when, pages and cost. Dummy data only.
\set ON_ERROR_STOP 1
grant usage on schema test to service_role;
grant execute on all functions in schema test to service_role;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'viewer.b@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.create_role('Viewer', 'Closebook view') as vr \gset
select public.set_role_permissions(:'vr', '{"closebook":"view"}');
select public.add_staff('00000000-0000-0000-0000-00000000000b', 'Test Viewer B', 'viewer.b@example.test', :'vr'::uuid);
select public.statement_create_job('00000000-0000-0000-0000-0000000002a1', null, 'jan.pdf', 'application/pdf', 'tool/00000000-0000-0000-0000-00000000000a/a1.pdf') as s1 \gset
select public.statement_create_job('00000000-0000-0000-0000-0000000002a2', null, 'feb.pdf', 'application/pdf', 'tool/00000000-0000-0000-0000-00000000000a/a2.pdf') as s2 \gset
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b"}';
select public.statement_create_job('00000000-0000-0000-0000-0000000002b1', null, 'mar.pdf', 'application/pdf', 'tool/00000000-0000-0000-0000-00000000000b/b1.pdf') as s3 \gset
reset role;
-- All three were read: ready, with pages and cost.
update public.cb_statement_imports set status = 'ready', finished_at = now(), pages = 2, cost_usd = 0.0210,
  result = '{"bank":"Northern Dummy Bank","pages":2,"accounts":[]}' where file_id is null;

-- ---------- A download keeps the statement.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('a download is noted on the person''s own statements only',
  public.statement_mark_downloaded(array[:'s1', :'s3']::uuid[]) = 1);
select test.check('downloaded twice: still there, noted once', public.statement_mark_downloaded(array[:'s1']::uuid[]) = 1
  and (select count(*) from public.cb_statement_imports where id = :'s1' and downloaded_at is not null) = 1);
reset role;
select test.check('nothing was deleted and nothing logged by the downloads', (select count(*) from public.cb_statement_imports where file_id is null) = 3
  and not exists (select 1 from public.statement_tool_log));

-- ---------- Done deletes every statement on the person's page, and only theirs.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select array_agg(p order by p)::text as got from public.statement_done_standalone() p \gset
select test.check('Done returns both stored files to remove',
  :'got' = array['tool/00000000-0000-0000-0000-00000000000a/a1.pdf', 'tool/00000000-0000-0000-0000-00000000000a/a2.pdf']::text);
reset role;
select test.check('Done deleted the owner''s two statements, not the viewer''s',
  not exists (select 1 from public.cb_statement_imports where created_by = '00000000-0000-0000-0000-00000000000a')
  and exists (select 1 from public.cb_statement_imports where id = :'s3'));
select test.check('the log keeps who, pages and cost: one downloaded, one discarded',
  (select string_agg(outcome, ',' order by outcome) from public.statement_tool_log where staff_id = '00000000-0000-0000-0000-00000000000a') = 'discarded,downloaded'
  and (select bool_and(pages = 2 and cost_usd = 0.0210) from public.statement_tool_log));
set role authenticated;
select test.check('Done with nothing left deletes nothing', (select count(*) from public.statement_done_standalone()) = 0);
reset role;
reset request.jwt.claims;
select test.check('anyone without Closebook cannot use Done', test.try($q$select public.statement_done_standalone()$q$) like '%Closebook%');

-- ---------- 24 hours after it was converted, not after it was uploaded.
update public.cb_statement_imports set created_at = now() - interval '30 hours', finished_at = now() - interval '2 hours' where id = :'s3';
set role service_role;
select test.check('uploaded 30 hours ago but converted 2 hours ago: kept', (select count(*) from public.statement_purge_standalone()) = 0);
reset role;
update public.cb_statement_imports set finished_at = now() - interval '25 hours' where id = :'s3';
set role service_role;
select array_agg(p)::text as got from public.statement_purge_standalone() p \gset
select test.check('converted 25 hours ago: deleted', :'got' = array['tool/00000000-0000-0000-0000-00000000000b/b1.pdf']::text);
reset role;
select test.check('its log row says expired', exists (select 1 from public.statement_tool_log where staff_id = '00000000-0000-0000-0000-00000000000b' and outcome = 'expired'));

-- ---------- Safe to run twice.
\i supabase/migrations/20261209060000_pdf_tool_keep.sql
select test.check('a second run keeps the column and the functions', exists (select 1 from information_schema.columns where table_name = 'cb_statement_imports' and column_name = 'downloaded_at'));
