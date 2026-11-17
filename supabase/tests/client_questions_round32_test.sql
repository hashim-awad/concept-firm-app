-- Local tests: round 32 (Hashim, Nov 18, 2026): questions to the client. Asking posts nothing; saved questions; Mark as sent;
-- one live link per file; the client's answer (server only) with files, History and one bell notice per 10 minutes;
-- a follow-up question; posting closes; the staff signature. Dummy data only.
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
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
\set A '''00000000-0000-0000-0000-00000000000a'''
\set C '''00000000-0000-0000-0000-00000000000c'''
insert into public.clients (kind, legal_name, province, email) values ('corporation', 'Maple Dummy Questions Inc.', 'ON', 'client@example.test') returning id as client \gset
select public.cb_create_file(:'client', '2026-08-31', '2025-09-01', '', 'full', 'statements', :C::uuid, :A::uuid) as f \gset
select public.cb_save_setup(:'f', '{"gst_registered": true, "gst_frequency": "quarterly", "quick_method": false}');
select public.cb_save_bank_account(:'f', null, 'chequing', 'Dummy Chq', '1357', 1000.00, false, false) as chq \gset
reset role;
select private.cb_add_statement(:'f', :'chq', 'chq.pdf', 1000.00, 776.00, '[
  {"line": 1, "date": "2025-10-02", "description": "CAFE DUMMY 1", "amount": -12.00},
  {"line": 2, "date": "2025-11-03", "description": "OFFICE SUPPLY DUMMY", "amount": -113.00},
  {"line": 3, "date": "2025-12-04", "description": "SOFTWARE DUMMY", "amount": -99.00}]', '2025-09-01', '2026-08-31', 1000.00, 776.00, null);
create function test.q(p_desc text) returns uuid language sql security definer set search_path = '' as $$ select id from public.cb_bank_lines where description = p_desc $$;
grant execute on function test.q(text) to authenticated, service_role;
grant usage on schema test to service_role;
grant execute on all functions in schema test to service_role;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';

-- ---------- Saved questions: three defaults, add, remove (each person their own).
select test.check('three saved questions to start', (select count(*) = 3 from public.cb_my_saved_questions()));
select public.cb_saved_question_add('Is this a personal expense?') as sq \gset
select test.check('a saved question is added', (select count(*) = 4 from public.cb_my_saved_questions()));
select public.cb_saved_question_remove(:'sq');
select test.check('a saved question is removed', (select count(*) = 3 from public.cb_my_saved_questions()));

-- ---------- Asking posts nothing and sets Not sent.
select public.cb_ask_questions(:'f', array[test.q('CAFE DUMMY 1'), test.q('OFFICE SUPPLY DUMMY')], 'What was this for?');
select test.check('asking: Not sent, still Pending, nothing posted', (select bool_and(q_status = 'not_sent' and status = 'new' and chart_account is null)
  from public.cb_bank_lines where id in (test.q('CAFE DUMMY 1'), test.q('OFFICE SUPPLY DUMMY'))));
select test.check('the question is in the thread with who asked', (select count(*) = 2 from public.cb_line_questions where file_id = :'f' and kind = 'q' and asked_by = :C::uuid));
reset role;
select test.check('History logs the question', (select count(*) = 2 from public.cb_file_history where file_id = :'f' and action = 'line_question'));
set role authenticated;
select test.check('a question over 400 characters is refused', test.try(format('select public.cb_ask_questions(%L, array[%L]::uuid[], %L)', :'f', test.q('SOFTWARE DUMMY'), repeat('x', 401))) like 'Type the question%');

-- ---------- Mark as sent asks for a date: Waiting, Sent on that date.
select public.cb_mark_questions_sent(:'f', array[test.q('CAFE DUMMY 1')], '2026-11-10');
select test.check('marked as sent: Waiting on Nov 10', (select q_status = 'waiting' and q_sent_on = '2026-11-10' from public.cb_bank_lines where id = test.q('CAFE DUMMY 1')));
select test.check('a date in the future is refused', test.try(format('select public.cb_mark_questions_sent(%L, array[%L]::uuid[], %L)', :'f', test.q('OFFICE SUPPLY DUMMY'), (current_date + 5)::text)) like 'Enter the date%');

-- ---------- Notify client: one live link per file.
select public.cb_question_link_create(:'f', repeat('a', 64), array[test.q('CAFE DUMMY 1'), test.q('OFFICE SUPPLY DUMMY')], array['client@example.test'], '{}', current_date + 7, now() + interval '30 days') as k1 \gset
select public.cb_question_link_sent(:'k1');
select test.check('sent: both lines Waiting, sent today', (select bool_and(q_status = 'waiting' and q_sent_on = (now() at time zone 'America/Toronto')::date)
  from public.cb_bank_lines where id in (test.q('CAFE DUMMY 1'), test.q('OFFICE SUPPLY DUMMY'))));
reset role;
select test.check('History logs the email', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'questions_sent'));
set role authenticated;
select public.cb_question_link_create(:'f', repeat('b', 64), array[test.q('CAFE DUMMY 1')], array['client@example.test'], '{}', current_date + 7, now() + interval '30 days') as k2 \gset
select test.check('a new link switches the old one off', (select not active from public.cb_question_links where id = :'k1') and (select active from public.cb_question_links where id = :'k2'));
select public.cb_question_link_cancel(:'k2');
select test.check('sending failed: the old link is back', (select active from public.cb_question_links where id = :'k1') and not exists (select 1 from public.cb_question_links where id = :'k2'));

-- ---------- The client's answer: only the server (service role) may record it.
select test.check('a signed-in person cannot record a client answer', test.try(format('select public.cb_client_answer(%L, %L, %L, %L, %L)', :'k1', test.q('CAFE DUMMY 1'), 'client@example.test', 'Coffee with a client', '[]')) like '%permission denied%');
reset role;
set role anon;
select test.check('anon cannot read links', test.try('select count(*) from public.cb_question_links') like '%permission denied%');
select test.check('anon cannot read codes', test.try('select count(*) from public.cb_question_codes') like '%permission denied%');
reset role;
set role service_role;
select test.check('a file in the wrong place is refused', test.try(format('select public.cb_client_answer(%L, %L, %L, %L, %L)', :'k1', test.q('CAFE DUMMY 1'), 'client@example.test', '',
  jsonb_build_array(jsonb_build_object('path', 'closebook/other/receipt.pdf', 'name', 'r.pdf', 'size', 10)))) = 'Wrong place for the file.');
select test.check('an empty answer is refused', test.try(format('select public.cb_client_answer(%L, %L, %L, %L, %L)', :'k1', test.q('CAFE DUMMY 1'), 'client@example.test', ' ', '[]')) = 'Type an answer or attach a file.');
select public.cb_client_answer(:'k1', test.q('CAFE DUMMY 1'), 'Client@Example.test', 'Coffee with a client',
  jsonb_build_array(jsonb_build_object('path', format('closebook/%s/lines/%s/client/abc.pdf', :'f', test.q('CAFE DUMMY 1')), 'name', 'receipt.pdf', 'size', 2048)));
reset role;
select test.check('answered at once: the line is Answered, still Pending', (select q_status = 'answered' and status = 'new' from public.cb_bank_lines where id = test.q('CAFE DUMMY 1')));
select test.check('the answer is in the thread with the contact''s email', exists (select 1 from public.cb_line_questions where line_id = test.q('CAFE DUMMY 1') and kind = 'a' and answered_by = 'client@example.test'));
select test.check('the file is on the line''s 📎', (select count(*) = 1 from public.cb_line_files where line_id = test.q('CAFE DUMMY 1') and from_client = 'client@example.test' and question_id is not null));
select test.check('History logs the answer, the time and the email', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'client_answer' and reason = 'client@example.test'
  and new_value like 'Coffee with a client (1 file attached)%' and at > now() - interval '1 minute'));
select test.check('the bell: one notice to the person who sent it', (select count(*) = 1 and min(title) = 'Maple Dummy Questions Inc. answered 1 question.' and min(href) = format('/closebook/%s?area=reporting&report=questions', :'f')
  from public.staff_notices where staff_id = :C::uuid));
set role service_role;
select test.check('an answered question cannot be answered twice', test.try(format('select public.cb_client_answer(%L, %L, %L, %L, %L)', :'k1', test.q('CAFE DUMMY 1'), 'client@example.test', 'again', '[]')) = 'This question is already answered.');
select public.cb_client_answer(:'k1', test.q('OFFICE SUPPLY DUMMY'), 'client@example.test', 'Printer paper', '[]');
reset role;
select test.check('two answers within 10 minutes: one notice, "answered 2 questions."', (select count(*) = 1 and min(title) = 'Maple Dummy Questions Inc. answered 2 questions.' and min(count) = 2
  from public.staff_notices where staff_id = :C::uuid));

-- ---------- Each person sees only their own notices; reading clears the count.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('another person does not see the notice', (select count(*) = 0 from public.staff_notices));
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.staff_notices_read();
select test.check('opened: no unread notices', (select count(*) = 0 from public.staff_notices where read_at is null));

-- ---------- A follow-up question sets the line back to Not sent; posting closes it.
select public.cb_ask_questions(:'f', array[test.q('OFFICE SUPPLY DUMMY')], 'Can you send the receipt?');
select test.check('a follow-up: Not sent again, thread Q A Q', (select q_status = 'not_sent' from public.cb_bank_lines where id = test.q('OFFICE SUPPLY DUMMY'))
  and (select string_agg(kind, '' order by created_at) = 'qaq' from public.cb_line_questions where line_id = test.q('OFFICE SUPPLY DUMMY')));
select public.cb_post_lines(:'f', jsonb_build_array(jsonb_build_object('id', test.q('CAFE DUMMY 1'), 'kind', 'code', 'account', '63000', 'tax', 'EXEMPT')));
select test.check('posted: no longer Pending, so the report shows Closed', (select not private.cb_line_pending(l) from public.cb_bank_lines l where id = test.q('CAFE DUMMY 1')));
select test.check('a posted line cannot be asked about', test.try(format('select public.cb_ask_questions(%L, array[%L]::uuid[], %L)', :'f', test.q('CAFE DUMMY 1'), 'More?')) = 'Only Pending lines can be asked about.');

-- ---------- The signature: a person sets their own; not someone else's.
select public.update_staff_signature(:C::uuid, 'CPA', 'Senior Accountant');
select test.check('own credentials and title saved', (select credentials = 'CPA' and title = 'Senior Accountant' from public.staff where id = :C::uuid));
select test.check('staff cannot change another person''s signature', test.try(format('select public.update_staff_signature(%L, %L, %L)', :A, 'X', 'Y')) like 'You do not have permission%');
reset role;
