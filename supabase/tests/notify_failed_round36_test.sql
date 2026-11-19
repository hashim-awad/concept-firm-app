-- Local tests: round 36 (Hashim, Nov 17, 2026): Notify client could not send. History keeps Microsoft's full reply
-- with the plain sentence; the pending link goes; no other link changes. Dummy data only.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test', (select id from public.roles where name = 'Accountant'));
reset role;
update public.role_permissions set level = 'edit' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Accountant');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
\set A '''00000000-0000-0000-0000-00000000000a'''
\set C '''00000000-0000-0000-0000-00000000000c'''
insert into public.clients (kind, legal_name, province, email) values ('corporation', 'Maple Dummy Notify Inc.', 'ON', 'client@example.test') returning id as client \gset
select public.cb_create_file(:'client', '2026-08-31', '2025-09-01', '', 'full', 'statements', :C::uuid, :A::uuid) as f \gset
select public.cb_save_bank_account(:'f', null, 'chequing', 'Dummy Chq', '7509', 1000.00, false, false) as chq \gset
reset role;
select private.cb_add_statement(:'f', :'chq', 'chq.pdf', 1000.00, 988.00, '[
  {"line": 1, "date": "2025-10-02", "description": "CAFE DUMMY", "amount": -12.00}]', '2025-09-01', '2026-08-31', 1000.00, 988.00, null);
select id as line from public.cb_bank_lines where description = 'CAFE DUMMY' \gset
set role authenticated;
select public.cb_ask_questions(:'f', array[:'line']::uuid[], 'What was this for?');
select public.cb_question_link_create(:'f', repeat('a', 64), array[:'line']::uuid[], array['client@example.test'], '{}', current_date + 7, now() + interval '30 days') as k \gset
select test.check('another person cannot log the failure', (set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a"}', true) is not null)
  and test.try(format('select public.cb_question_link_failed(%L, %L, %L)', :'k', 'x', 'y')) = 'Link not found.');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_question_link_failed(:'k', 'Not sent. Microsoft 365 has not allowed Studio to send from staff.c@example.test yet. Nothing went to the client.',
  '{"error":{"code":"ErrorAccessDenied","message":"Access is denied. Check credentials and try again."}}');
reset role;
select test.check('History: "Email not sent", the plain sentence and the full reply, by the sender', exists (select 1 from public.cb_file_history where file_id = :'f'
  and action = 'questions_send_failed' and detail = 'Email not sent' and ref_label = '1 question to client@example.test' and reason like 'Not sent. Microsoft 365 has not allowed%'
  and new_value = '{"error":{"code":"ErrorAccessDenied","message":"Access is denied. Check credentials and try again."}}' and actor_id = :C::uuid));
select test.check('the pending link is gone; the question is still Not sent', not exists (select 1 from public.cb_question_links where id = :'k')
  and (select q_status = 'not_sent' from public.cb_bank_lines where id = :'line'));
set role authenticated;
select public.cb_question_link_create(:'f', repeat('b', 64), array[:'line']::uuid[], array['client@example.test'], '{}', current_date + 7, now() + interval '30 days') as k2 \gset
select public.cb_question_link_sent(:'k2');
select test.check('a sent link cannot be marked failed', test.try(format('select public.cb_question_link_failed(%L, %L, %L)', :'k2', 'x', 'y')) = 'Link not found.');
