-- Local tests: round 20 (Hashim, Nov 15, 2026), Bank statement PDF to CSV. Jobs and who sees them, the
-- runner's claim (at most 3 reading across the firm, stale jobs back in the queue, 3 tries), finish and
-- fail, edits, discard, import into a file through cb_upload_bank with the conversion record and the last
-- digits, the standalone tool's log and its 24-hour clean-up. Dummy data only.
\set ON_ERROR_STOP 1
-- The runner works with the secret key (service_role); the checks run as that role too.
grant usage on schema test to service_role;
grant execute on all functions in schema test to service_role;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'viewer.b@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'none.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.create_role('Viewer', 'Closebook view') as vr \gset
select public.set_role_permissions(:'vr', '{"closebook":"view","clients":"view"}');
select public.add_staff('00000000-0000-0000-0000-00000000000b', 'Test Viewer B', 'viewer.b@example.test', :'vr'::uuid);
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'none.c@example.test', (select id from public.roles where name = 'Staff'));
insert into public.clients (kind, legal_name, province) values ('corporation', 'Maple Dummy Realty Inc.', 'ON') returning id as client \gset
\set A '''00000000-0000-0000-0000-00000000000a'''
select public.cb_create_file(:'client', '2026-12-31', '2026-01-01', '', 'full', 'statements', :A::uuid, :A::uuid) as f \gset
select public.cb_create_file(:'client', '2025-12-31', '2025-01-01', '', 'monthly', 'concept_qbo', :A::uuid, :A::uuid) as m \gset

-- ---------- The bucket, the columns
reset role;
select test.check('the private bucket is there', exists (select 1 from storage.buckets where id = 'statement-uploads' and not public));
select test.check('the statement keeps a conversion record', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'cb_bank_statements'
  and column_name in ('statement_import_id', 'source', 'model', 'pages', 'input_tokens', 'output_tokens', 'cost_usd', 'check_result', 'edits', 'attachment_path', 'converted_by', 'converted_at')) = 12);
select test.check('bank accounts have last digits', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cb_bank_accounts' and column_name = 'last4'));
set role authenticated;

-- ---------- New jobs
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('a file job needs a path under the file', test.try(format($q$select public.statement_create_job(null, %L, 'jan.pdf', 'application/pdf', 'tool/x/1.pdf')$q$, :'f')) like '%right place%');
select test.check('monthly files have nothing to upload', test.try(format($q$select public.statement_create_job(null, %L, 'jan.pdf', 'application/pdf', 'file/%s/1.pdf')$q$, :'m', :'m')) like '%Monthly files%');
select test.check('only PDF and photos', test.try(format($q$select public.statement_create_job(null, %L, 'jan.docx', 'application/msword', 'file/%s/1.docx')$q$, :'f', :'f')) like 'Upload a PDF%');
select public.statement_create_job('00000000-0000-0000-0000-0000000001a1', :'f', 'jan.pdf', 'application/pdf', 'file/' || :'f' || '/00000000-0000-0000-0000-0000000001a1.pdf') as j1 \gset
select public.statement_create_job('00000000-0000-0000-0000-0000000001a2', :'f', 'feb.pdf', 'application/pdf', 'file/' || :'f' || '/a2.pdf') as j2 \gset
select public.statement_create_job('00000000-0000-0000-0000-0000000001a3', :'f', 'mar.jpg', 'image/jpeg', 'file/' || :'f' || '/a3.jpg') as j3 \gset
select public.statement_create_job('00000000-0000-0000-0000-0000000001a4', :'f', 'apr.heic', 'image/heic', 'file/' || :'f' || '/a4.heic') as j4 \gset
select public.statement_create_job('00000000-0000-0000-0000-0000000001a5', null, 'mine.pdf', 'application/pdf', 'tool/00000000-0000-0000-0000-00000000000a/a5.pdf') as t1 \gset
select test.check('jobs start queued, with no tries', (select count(*) from public.cb_statement_imports where status = 'queued' and attempts = 0) = 5);
select test.check('the upload is in the file history', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'statement_uploaded' and detail like '%jan.pdf'));
select test.check('nobody inserts jobs directly', test.try($q$insert into public.cb_statement_imports (file_name, media_type, storage_path) values ('x.pdf', 'application/pdf', 'x')$q$) like '%permission denied%');

-- Viewers: file jobs yes, someone else's standalone job no; and they cannot upload into a file.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b"}';
select test.check('a Closebook viewer sees the file''s jobs, not the owner''s standalone job', (select count(*) from public.cb_statement_imports) = 4);
select test.check('a viewer cannot upload into a file', test.try(format($q$select public.statement_create_job(null, %L, 'x.pdf', 'application/pdf', 'file/%s/x.pdf')$q$, :'f', :'f')) like '%Edit on Closebook%');
select public.statement_create_job('00000000-0000-0000-0000-0000000001b1', null, 'viewer.pdf', 'application/pdf', 'tool/00000000-0000-0000-0000-00000000000b/b1.pdf') as tb \gset
select test.check('a viewer uses the standalone tool, in their own folder only',
  (select count(*) from public.cb_statement_imports where file_id is null) = 1
  and test.try($q$select public.statement_create_job(null, null, 'x.pdf', 'application/pdf', 'tool/00000000-0000-0000-0000-00000000000a/x.pdf')$q$) like '%right place%');
select test.check('a viewer cannot discard a file''s job', test.try(format($q$select public.statement_discard(%L)$q$, :'j1')) like '%Edit on Closebook%');
select test.check('or another person''s standalone job', test.try(format($q$select public.statement_discard(%L)$q$, :'t1')) like 'Statement not found%');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('staff without Closebook see nothing', (select count(*) from public.cb_statement_imports) = 0);
select test.check('and cannot use the tool', test.try($q$select public.statement_create_job(null, null, 'x.pdf', 'application/pdf', 'tool/00000000-0000-0000-0000-00000000000c/x.pdf')$q$) like 'You need Closebook%');
select test.check('the runner functions are not for signed-in people', test.try($q$select public.statement_claim_jobs(3)$q$) like '%permission denied%');

-- ---------- The runner's claim
reset role;
reset request.jwt.claims;
set role service_role;
select test.check('the first claim takes the 3 oldest', (select count(*) from public.statement_claim_jobs(5)) = 3);
select test.check('they are reading, on their first try', (select array_agg(id::text order by created_at) from public.cb_statement_imports where status = 'reading') = array[:'j1', :'j2', :'j3']
  and (select bool_and(attempts = 1 and started_at is not null) from public.cb_statement_imports where status = 'reading'));
select test.check('no more than 3 read at once across the firm', (select count(*) from public.statement_claim_jobs(3)) = 0);
-- A runner stopped: j1 has been reading for 11 minutes. It goes back in the queue and is claimed again.
reset role; update public.cb_statement_imports set started_at = now() - interval '11 minutes' where id = :'j1'; set role service_role;
-- (A function's changes show in the next statement, so each claim is checked in two steps.)
select array_agg(id::text)::text as got from public.statement_claim_jobs(3) \gset
select test.check('a stale job is claimed again, as its second try', :'got' = array[:'j1']::text and (select attempts from public.cb_statement_imports where id = :'j1') = 2);
-- After 3 tries a stale job fails.
reset role; update public.cb_statement_imports set started_at = now() - interval '11 minutes', attempts = 3 where id = :'j1'; set role service_role;
select array_agg(id::text)::text as got from public.statement_claim_jobs(3) \gset
select test.check('after 3 tries a stale job fails and frees its slot', :'got' = array[:'j4']::text
  and (select status = 'failed' and error like 'The statement could not be read after 3 tries%' from public.cb_statement_imports where id = :'j1'));

-- Finish and fail.
select test.check('finish: result, status and cost', public.statement_finish_job(:'j2', 'ready',
  '{"bank":"Northern Dummy Bank","pages":2,"accounts":[{"key":"a1","last4":"4321","name":"Business chequing","kind":"bank","periodStart":"2026-02-01","periodEnd":"2026-02-28","opening":100000,"closing":95000,"summary":null,"lines":[{"id":"l1","date":"2026-02-03","description":"SAMPLE DEPOSIT","amountCents":5000,"dir":"in","balanceCents":105000,"page":1,"unsure":false,"unsureReason":"","source":"read"},{"id":"l2","date":"2026-02-10","description":"SAMPLE RENT","amountCents":10000,"dir":"out","balanceCents":95000,"page":2,"unsure":false,"unsureReason":"","source":"read"}]}]}',
  '{"accounts":1,"lines":2,"difference_cents":0,"review":0}', 2, 'claude-sonnet-5-5', 12000, 900, 0.0363, null, null));
select test.check('the record is kept', (select status = 'ready' and pages = 2 and model = 'claude-sonnet-5-5' and input_tokens = 12000 and output_tokens = 900 and cost_usd = 0.0363 and finished_at is not null
  from public.cb_statement_imports where id = :'j2'));
select test.check('a job not reading is not finished twice', not public.statement_finish_job(:'j2', 'ready', '{}', '{}', 1, 'x', 1, 1, 1, null, null));
select public.statement_fail_job(:'j3', 'Busy.', true, 1, 'claude-sonnet-5-5', 100, 0, 0.0002) as got \gset
select test.check('a passing problem: back in the queue, the cost kept', :'got' = 'queued'
  and (select cost_usd = 0.0002 and started_at is null from public.cb_statement_imports where id = :'j3'));
select count(*) as got from public.statement_claim_jobs(1) \gset
select test.check('claimed again: its second try', :'got' = '1' and (select attempts from public.cb_statement_imports where id = :'j3') = 2);
reset role; update public.cb_statement_imports set attempts = 3 where id = :'j3'; set role service_role;
select test.check('a passing problem on the last try fails', public.statement_fail_job(:'j3', 'Busy.', true, null, null, null, null, null) = 'failed');
select public.statement_finish_job(:'j4', 'needs_look', '{"bank":"","pages":1,"accounts":[]}', '{"accounts":0,"lines":0,"difference_cents":null,"review":0}',
  1, 'claude-sonnet-5-5', 1, 1, 0, 'file/' || :'f' || '/a4.jpg', 'image/jpeg') as got \gset
select test.check('the converted photo replaces the stored file', :'got' = 't' and (select media_type = 'image/jpeg' and storage_path like '%a4.jpg' from public.cb_statement_imports where id = :'j4'));
reset role;

-- ---------- The person: retry, edits, discard
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('only a failed job is tried again', test.try(format($q$select public.statement_retry(%L)$q$, :'j2')) like 'Only a statement that failed%');
select public.statement_retry(:'j3');
select test.check('retry: back in the queue with 3 new tries', (select status = 'queued' and attempts = 0 and error is null from public.cb_statement_imports where id = :'j3'));
select test.check('edits need accounts', test.try(format($q$select public.statement_save_edits(%L, '{}', '{}', 'ready')$q$, :'j2')) like '%no accounts%');
select public.statement_save_edits(:'j4', '{"bank":"","pages":1,"accounts":[]}', '{"accounts":0,"lines":0,"difference_cents":null,"review":0}', 'needs_look');
select test.check('the working copy is saved', (select edited is not null from public.cb_statement_imports where id = :'j4'));
select public.statement_discard(:'j4') as p4 \gset
select test.check('a file''s job is discarded, its cost kept, the stored path returned', :'p4' like '%a4.jpg'
  and (select status = 'discarded' and result is null and edited is null from public.cb_statement_imports where id = :'j4')
  and exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'statement_discarded'));

-- ---------- Import into the file (round 22: accounts are added in step 3 first)
select public.cb_save_bank_account(:'f', null, 'chequing', 'NDB', '4321', 1000, false, false) as acc0 \gset
select public.cb_save_bank_account(:'f', null, 'card', 'NDB', '8888', 0, false, false) as visa0 \gset
\set acc1 '{"key":"a1","account":":ACC0","name":"Northern Dummy chequing","kind":"bank","last4":"4321","opening":1000.00,"closing":950.00,"period_start":"2026-02-01","period_end":"2026-02-28","rows":[{"line":1,"date":"2026-02-03","description":"SAMPLE DEPOSIT","amount":50.00},{"line":2,"date":"2026-02-10","description":"SAMPLE RENT","amount":-100.00}],"check":{"differenceCents":0,"ok":true},"edits":{"edited":1,"added":0,"deleted":0}}'
select replace(:'acc1', ':ACC0', :'acc0') as acc1 \gset
select test.check('a job that is not ready is not imported', test.try(format($q$select public.cb_import_statement(%L, %L, false, '')$q$, :'j3', '[' || :'acc1' || ']')) like '%not ready%');
select test.check('an account must be on the file: none is made on import', test.try(format($q$select public.cb_import_statement(%L, %L, false, '')$q$, :'j2', '[' || replace(:'acc1', :'acc0', '') || ']')) like '%Add the account in step 3%');
select test.check('a statement that does not balance is refused by cb_upload_bank, nothing kept',
  test.try(format($q$select public.cb_import_statement(%L, %L, false, '')$q$, :'j2', '[' || replace(:'acc1', '"closing":950.00', '"closing":950.01') || ']')) like '%does not balance%'
  and not exists (select 1 from public.cb_bank_statements where file_id = :'f')
  and (select status from public.cb_statement_imports where id = :'j2') = 'ready');
select public.cb_import_statement(:'j2', ('[' || :'acc1' || ']')::jsonb, false, 'closebook/' || :'f' || '/statements/' || :'j2' || '.pdf') as imp \gset
select test.check('imported: one statement for the account', jsonb_array_length(:'imp') = 1 and (:'imp'::jsonb -> 0 ->> 'key') = 'a1' and (:'imp'::jsonb -> 0 ->> 'lines') = '2');
select test.check('the conversion record is on the statement', (select source = 'pdf' and statement_import_id = :'j2' and model = 'claude-sonnet-5-5' and pages = 2 and input_tokens = 12000
    and output_tokens = 900 and cost_usd = 0.0363 and (check_result ->> 'ok') = 'true' and edits = '{"edited":1,"added":0,"deleted":0}' and attachment_path like '%statements/%.pdf'
    and converted_by = :A::uuid and converted_at is not null
  from public.cb_bank_statements where file_id = :'f'));
select test.check('the lines are in, signed', (select array_agg(amount order by row_no) from public.cb_bank_lines where file_id = :'f') = array[50.00, -100.00]::numeric[]);
select test.check('the account keeps the last digits it was added with', (select last4 from public.cb_bank_accounts where id = :'acc0') = '4321');
select test.check('the job is imported, by whom and when', (select status = 'imported' and imported_by = :A::uuid and imported_at is not null from public.cb_statement_imports where id = :'j2'));
select test.check('the import is in the file history', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'statement_imported' and detail like '%1 account, 2 lines%'));
select test.check('an imported job is not imported twice', test.try(format($q$select public.cb_import_statement(%L, %L, false, '')$q$, :'j2', '[' || :'acc1' || ']')) like '%not ready%');
select test.check('an imported job is not discarded', test.try(format($q$select public.statement_discard(%L)$q$, :'j2')) like '%is imported%');
select test.check('CSV uploads are marked csv', (select column_default from information_schema.columns where table_name = 'cb_bank_statements' and column_name = 'source') like '''csv''%');

-- A second statement for the same account, already in the file: confirmed duplicates go to the reviewer;
-- an account that already has last digits keeps them.
reset role;
set role service_role;
reset role; update public.cb_statement_imports set status = 'reading' where id = :'j3'; set role service_role;
select public.statement_finish_job(:'j3', 'needs_look', '{"bank":"Northern Dummy Bank","pages":1,"accounts":[]}', '{}', 1, 'claude-sonnet-5', 1, 1, 0, null, null);
reset role; update public.cb_statement_imports set input_tokens = 1001, output_tokens = 333, cost_usd = 0.0101 where id = :'j3'; set role service_role;
reset role;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select :'acc0' as acc \gset
select public.cb_import_statement(:'j3', ('[{"key":"a1","account":"' || :'acc' || '","name":"","kind":"","last4":"9999","opening":950.00,"closing":990.00,"period_start":"2026-03-01","period_end":"2026-03-31","rows":[{"line":1,"date":"2026-03-02","description":"SAMPLE DEPOSIT","amount":50.00},{"line":2,"date":"2026-03-05","description":"SAMPLE FEE","amount":-10.00}],"check":{},"edits":{}},'
  || '{"key":"a2","account":"' || :'visa0' || '","name":"Northern Dummy Visa","kind":"card","last4":"8888","opening":0,"closing":50.00,"period_start":"2026-02-01","period_end":"2026-02-28","rows":[{"line":1,"date":"2026-02-03","description":"sample deposit","amount":50.00}],"check":{},"edits":{}}]')::jsonb, true, '') as imp2 \gset
select test.check('two accounts found: two statements, in one step', jsonb_array_length(:'imp2') = 2 and (select count(*) from public.cb_bank_statements where statement_import_id = :'j3') = 2);
select test.check('tokens and cost split by line count (2 and 1), the remainder on the first, adding up to the job''s',
  (select array_agg(array[input_tokens, output_tokens, cost_usd * 10000] order by (select count(*) from public.cb_bank_lines l where l.statement_id = b.id) desc)
     from public.cb_bank_statements b where statement_import_id = :'j3') = array[array[668, 222, 67], array[333, 111, 34]]::numeric[]
  and (select sum(input_tokens) = 1001 and sum(output_tokens) = 333 and sum(cost_usd) = 0.0101 from public.cb_bank_statements where statement_import_id = :'j3')
  and (select input_tokens = 1001 and output_tokens = 333 and cost_usd = 0.0101 from public.cb_statement_imports where id = :'j3'));
select test.check('confirmed duplicates go to the reviewer', (select count(*) from public.cb_bank_lines where file_id = :'f' and dup_confirmed and status = 'reviewer') = 1);
select test.check('last digits are the account''s own, not the statement''s', (select last4 from public.cb_bank_accounts where id = :'acc') = '4321'
  and (select last4 from public.cb_bank_accounts where id = :'visa0') = '8888');

-- ---------- My day
select test.check('My day counts my statements ready or needing a look', public.statement_ready_counts() ->> 'ready' = '0' and public.statement_ready_counts() ->> 'needs_look' = '0');
reset role;
update public.cb_statement_imports set status = 'ready' where id = :'t1';
set role authenticated;
select test.check('My day: the standalone one counts, on its own row with no file, listed last',
  public.statement_ready_counts() ->> 'ready' = '1'
  and (select (e ->> 'ready')::int = 1 and (e ->> 'n')::int = 1 and e ->> 'client' is null
         from jsonb_array_elements(public.statement_ready_counts() -> 'files') e where e ->> 'fileId' is null)
  and public.statement_ready_counts() -> 'files' -> -1 ->> 'fileId' is null);
select test.check('My day: a file row has the client, the year end and its failed statements',
  (select e ->> 'client' is not null and e ->> 'yearEnd' = '2026-12-31' and (e ->> 'failed')::int >= 1
     from jsonb_array_elements(public.statement_ready_counts() -> 'files') e where e ->> 'fileId' = :'f'));

-- ---------- The standalone tool
select test.check('a standalone job cannot be imported', test.try(format($q$select public.cb_import_statement(%L, %L, false, '')$q$, :'t1', '[' || :'acc1' || ']')) like '%does not belong to a file%');
reset role;
update public.cb_statement_imports set pages = 3, cost_usd = 0.0440 where id = :'t1';
set role authenticated;
select public.statement_finish_standalone(:'t1') as tp \gset
select test.check('after the download the job is gone, a log row stays', :'tp' like 'tool/%a5.pdf' and not exists (select 1 from public.cb_statement_imports where id = :'t1')
  and exists (select 1 from public.statement_tool_log where staff_id = :A::uuid and pages = 3 and cost_usd = 0.0440 and outcome = 'downloaded'));
select test.check('a file''s job is not finished as standalone', test.try(format($q$select public.statement_finish_standalone(%L)$q$, :'j3')) like '%belongs to a file%');
select test.check('the owner reads the log', (select count(*) from public.statement_tool_log) = 1);
reset role;
select test.check('the activity log has the line, no client details', exists (select 1 from public.activity_log where action = 'statement_tool_downloaded' and details ->> 'pages' = '3' and details::text not like '%mine.pdf%'));
-- The viewer's standalone job is 25 hours old: the runner deletes it, with a log row.
update public.cb_statement_imports set created_at = now() - interval '25 hours' where id = :'tb';
set role service_role;
select array_agg(p)::text as got from public.statement_purge_standalone() p \gset
select test.check('standalone jobs over 24 hours are deleted', :'got' = array['tool/00000000-0000-0000-0000-00000000000b/b1.pdf']::text
  and not exists (select 1 from public.cb_statement_imports where file_id is null));
reset role;
select test.check('their log row says expired', exists (select 1 from public.statement_tool_log where staff_id = '00000000-0000-0000-0000-00000000000b' and outcome = 'expired'));
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b"}';
select test.check('only owners read the log', (select count(*) from public.statement_tool_log) = 0);

-- ---------- Direct uploads (the browser sends the file straight to storage)
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.statement_begin_upload('00000000-0000-0000-0000-0000000001c1', :'f', 'big scan.pdf', 'application/pdf', 'file/' || :'f' || '/c1.pdf') as u1 \gset
select test.check('a direct upload starts as uploading, not yet in the file history', (select status from public.cb_statement_imports where id = :'u1') = 'uploading'
  and not exists (select 1 from public.cb_file_history where file_id = :'f' and detail like '%big scan.pdf'));
reset role;
set role service_role;
select count(*) as got from public.statement_claim_jobs(3) \gset
select test.check('an upload not confirmed is not read', :'got' = '0');
reset role;
set role authenticated;
select public.statement_confirm_upload(:'u1');
select test.check('confirmed: in the queue and in the file history', (select status from public.cb_statement_imports where id = :'u1') = 'queued'
  and exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'statement_uploaded' and detail like '%big scan.pdf'));
select test.check('confirmed only once', test.try(format($q$select public.statement_confirm_upload(%L)$q$, :'u1')) like '%already uploaded%');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b"}';
select test.check('a viewer cannot start a direct upload into a file', test.try(format($q$select public.statement_begin_upload(null, %L, 'x.pdf', 'application/pdf', 'file/%s/x.pdf')$q$, :'f', :'f')) like '%Edit on Closebook%');
select test.check('a viewer cannot confirm a file''s upload', test.try(format($q$select public.statement_confirm_upload(%L)$q$, :'u1')) like '%Edit on Closebook%');
select public.statement_begin_upload('00000000-0000-0000-0000-0000000001c2', null, 'phone.heic', 'image/heic', 'tool/00000000-0000-0000-0000-00000000000b/c2.heic') as u2 \gset
reset role;
update public.cb_statement_imports set created_at = now() - interval '25 hours' where id = :'u2';
set role service_role;
select array_agg(p)::text as got from public.statement_purge_standalone() p \gset
select test.check('an upload never confirmed is removed after 24 hours', :'got' = array['tool/00000000-0000-0000-0000-00000000000b/c2.heic']::text
  and not exists (select 1 from public.cb_statement_imports where id = :'u2'));
reset role;
select test.check('no log row for it: nothing was read', (select count(*) from public.statement_tool_log where staff_id = '00000000-0000-0000-0000-00000000000b') = 1);
reset role;
reset request.jwt.claims;
