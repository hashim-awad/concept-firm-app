-- Local tests: round 32 fix (Hashim, Nov 17, 2026): the client's link after failed and good sends. A failed send never
-- creates a link and never switches one off; a good send switches on its own link and switches off the earlier one;
-- one live link per file; the reply-by date plays no part; a refused link is in History with the reason; the server key
-- has every right the client page needs (the cause on Live). Dummy data only.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
\set A '''00000000-0000-0000-0000-00000000000a'''
insert into public.clients (kind, legal_name, province, email) values ('corporation', 'Maple Dummy Link Inc.', 'ON', 'client@example.test') returning id as client \gset
select public.cb_create_file(:'client', '2026-08-31', '2025-09-01', '', 'full', 'statements', :A::uuid, :A::uuid) as f \gset
select public.cb_save_bank_account(:'f', null, 'chequing', 'Dummy Chq', '1357', 1000.00, false, false) as chq \gset
reset role;
select private.cb_add_statement(:'f', :'chq', 'chq.pdf', 1000.00, 988.00, '[{"line": 1, "date": "2025-10-02", "description": "CAFE DUMMY 1", "amount": -12.00}]',
  '2025-09-01', '2026-08-31', 1000.00, 988.00, null);
select id as l from public.cb_bank_lines where file_id = :'f' \gset
grant usage on schema test to service_role;
grant execute on all functions in schema test to service_role;

-- ---------- The server key: take its rights away (as on Live), run the fix again, and every right is back.
revoke all on public.cb_question_links, public.cb_files, public.cb_line_questions, public.cb_line_files from service_role;
select test.check('without the rights, the server key cannot read the links (the Live symptom)', not has_table_privilege('service_role', 'public.cb_question_links', 'select'));
\i supabase/migrations/20261212110000_round32_server_rights_no_code.sql
select test.check('after the fix the server key reads links, files, questions and receipts',
  has_table_privilege('service_role', 'public.cb_question_links', 'select') and has_table_privilege('service_role', 'public.cb_files', 'select')
  and has_table_privilege('service_role', 'public.cb_line_questions', 'select') and has_table_privilege('service_role', 'public.cb_line_files', 'select')
  and has_function_privilege('service_role', 'public.cb_question_link_refused(uuid, text)', 'execute'));
set role service_role;
select test.check('as the server key: the link table can be read', test.try('select count(*) from public.cb_question_links') = 'OK');
reset role;

set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_ask_questions(:'f', array[:'l']::uuid[], 'What was this for?');

-- ---------- Two failed sends (Microsoft 403), then a good one, reply by today.
select public.cb_question_link_create(:'f', repeat('1', 64), array[:'l']::uuid[], array['client@example.test'], '{}', current_date, now() + interval '30 days') as f1 \gset
select test.check('a send in progress makes a pending link: not live', (select not active and not sent from public.cb_question_links where id = :'f1'));
select public.cb_question_link_cancel(:'f1');
select public.cb_question_link_create(:'f', repeat('2', 64), array[:'l']::uuid[], array['client@example.test'], '{}', current_date, now() + interval '30 days') as f2 \gset
select public.cb_question_link_cancel(:'f2');
select test.check('two failed sends leave no link at all', (select count(*) = 0 from public.cb_question_links where file_id = :'f'));
select public.cb_question_link_create(:'f', repeat('3', 64), array[:'l']::uuid[], array['client@example.test'], '{}', current_date, now() + interval '30 days') as g1 \gset
select public.cb_question_link_sent(:'g1');
select test.check('the good send: one link, live and sent, reply by today', (select count(*) = 1 from public.cb_question_links where file_id = :'f')
  and (select active and sent and reply_by = current_date from public.cb_question_links where id = :'g1'));
select test.check('sent twice (a retry) changes nothing', public.cb_question_link_sent(:'g1') = 0 and (select active from public.cb_question_links where id = :'g1'));

-- ---------- A failed send after a good one leaves the good link live.
select public.cb_question_link_create(:'f', repeat('4', 64), array[:'l']::uuid[], array['client@example.test'], '{}', current_date, now() + interval '30 days') as f3 \gset
select public.cb_question_link_cancel(:'f3');
select test.check('a failed send does not touch the live link', (select active from public.cb_question_links where id = :'g1') and (select count(*) = 1 from public.cb_question_links where file_id = :'f'));

-- ---------- A second good send: the first link is replaced, the second is live; one live link per file.
select public.cb_question_link_create(:'f', repeat('5', 64), array[:'l']::uuid[], array['client@example.test'], '{}', current_date + 7, now() + interval '30 days') as g2 \gset
select test.check('until the email goes, the first link stays live', (select active from public.cb_question_links where id = :'g1'));
select public.cb_question_link_sent(:'g2');
reset role;
select test.check('second good send: first switched off, second live, it records which it replaced',
  (select not active from public.cb_question_links where id = :'g1') and (select active and replaced = :'g1'::uuid from public.cb_question_links where id = :'g2')
  and (select count(*) = 1 from public.cb_question_links where file_id = :'f' and active));
select test.check('History says the earlier link was switched off', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'questions_sent' and reason = 'The earlier link was switched off.'));
select test.check('two live links for one file are refused', test.try(format('update public.cb_question_links set active = true where id = %L', :'g1')) like '%cb_question_links_one_live%');

-- ---------- A refused link goes in History with the reason, once an hour.
set role service_role;
select public.cb_question_link_refused(:'g1', 'replaced');
select public.cb_question_link_refused(:'g1', 'replaced');
reset role;
select test.check('the refused link is in History once, with the reason', (select count(*) = 1 from public.cb_file_history where file_id = :'f' and action = 'client_link_refused'
  and reason = 'Replaced by a newer link' and new_value = :'g1'));
set role authenticated;
select test.check('a signed-in person cannot write refusals', test.try(format('select public.cb_question_link_refused(%L, %L)', :'g1', 'expired')) like '%permission denied%');
reset role;

-- ---------- Hashim's additions: rights by default, the rights check, errors in History and the bell.
create table public.zz_future_table (id int);
create sequence public.zz_future_seq;
create function public.zz_future_fn() returns int language sql as $$ select 1 $$;
select test.check('a table, sequence and function made later get the server key''s rights by default',
  has_table_privilege('service_role', 'public.zz_future_table', 'select') and has_table_privilege('service_role', 'public.zz_future_table', 'insert')
  and has_sequence_privilege('service_role', 'public.zz_future_seq', 'usage') and has_function_privilege('service_role', 'public.zz_future_fn()', 'execute'));
drop table public.zz_future_table; drop sequence public.zz_future_seq; drop function public.zz_future_fn();
select test.check('the rights check returns no rows', (select count(*) = 0 from private.server_key_gaps()));
revoke select on public.cb_files from service_role;
select test.check('the rights check names a missing right', exists (select 1 from private.server_key_gaps() where kind = 'table' and name = 'public.cb_files' and missing = 'select'));
grant select on public.cb_files to service_role;
select test.check('the app''s storage buckets exist', (select count(*) = 3 from storage.buckets where id in ('documents', 'brand-private', 'statement-uploads')));

-- A database error on the client page: History, and one bell notice each for the preparer and the reviewer.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test', (select id from public.roles where name = 'Staff'));
reset role;
update public.role_permissions set level = 'edit' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Staff');
update public.cb_files set preparer_id = '00000000-0000-0000-0000-00000000000c' where id = :'f';
set role service_role;
select public.cb_question_link_error(repeat('5', 64), 'read the link: permission denied for table cb_question_links');
select public.cb_question_link_error(repeat('5', 64), 'read the link: permission denied for table cb_question_links');
reset role;
select test.check('the error is in History once, with the reason', (select count(*) = 1 from public.cb_file_history where file_id = :'f' and action = 'client_link_error'
  and reason = 'read the link: permission denied for table cb_question_links'));
select test.check('the preparer and the reviewer each get one bell notice, counting the repeat',
  (select count(*) = 2 and min(count) = 2 and min(title) = 'Client link error on Maple Dummy Link Inc.: read the link: permission denied for table cb_question_links'
   from public.staff_notices where group_key like 'cbqerr:%'));

-- ---------- Firm decision: no code. Copy link, and every opening in History.
select test.check('the code, session and lock are gone', to_regclass('public.cb_question_codes') is null and to_regclass('public.cb_question_sessions') is null
  and not exists (select 1 from information_schema.columns where table_name = 'cb_question_links' and column_name in ('failed_codes', 'locked_until')));
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_question_link_create(:'f', repeat('6', 64), array[:'l']::uuid[], '{}', '{}', current_date + 7, now() + interval '30 days') as c1 \gset
select public.cb_question_link_copied(:'c1');
reset role;
select test.check('Copy link: live without an email, the earlier link off, the line Waiting today, History "Link copied"',
  (select active and sent from public.cb_question_links where id = :'c1') and (select count(*) = 1 from public.cb_question_links where file_id = :'f' and active)
  and (select q_status = 'waiting' and q_sent_on = (now() at time zone 'America/Toronto')::date from public.cb_bank_lines where id = :'l')
  and exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'questions_link_copied' and detail = 'Link copied'));
set role authenticated;
select public.cb_question_link_create(:'f', repeat('7', 64), array[:'l']::uuid[], '{}', '{}', current_date + 7, now() + interval '30 days') as c2 \gset
select public.cb_question_link_copied(:'c2');
reset role;
select test.check('a second Copy link switches off the first', (select not active from public.cb_question_links where id = :'c1') and (select active from public.cb_question_links where id = :'c2'));
set role service_role;
select public.cb_question_link_opened(:'c2', 'phone');
select public.cb_question_link_opened(:'c2', 'computer');
reset role;
select test.check('every opening is in History with the device', (select string_agg(reason, ',' order by at, id) = 'phone,computer' from public.cb_file_history
  where file_id = :'f' and action = 'client_link_opened' and new_value = :'c2'));
select test.check('opening changes nothing on the link', (select active and sent from public.cb_question_links where id = :'c2'));
