-- Local tests: round 35b (Hashim, Nov 17, 2026): a question on a posted line never changes the books.
-- Posting a line closes the questions still waiting on it (never on the client page). A question asked on a posted
-- line stays open until the client answers; the line stays posted, with its account, tax and reviewer flag, and
-- step 4's sign-off stays. An excluded line cannot be asked about. Dummy data only.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test', (select id from public.roles where name = 'Accountant'));
reset role;
reset request.jwt.claims;
update public.role_permissions set level = 'edit' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Accountant');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
\set A '''00000000-0000-0000-0000-00000000000a'''
\set C '''00000000-0000-0000-0000-00000000000c'''
insert into public.clients (kind, legal_name, province, email) values ('corporation', 'Maple Dummy Posted Q Inc.', 'ON', 'client@example.test') returning id as client \gset
select public.cb_create_file(:'client', '2026-08-31', '2025-09-01', '', 'full', 'statements', :C::uuid, :A::uuid) as f \gset
select public.cb_save_setup(:'f', '{"gst_registered": true, "gst_frequency": "quarterly", "quick_method": false}');
select public.cb_save_bank_account(:'f', null, 'chequing', 'Dummy Chq', '7509', 1000.00, false, false) as chq \gset
select public.cb_save_bank_account(:'f', null, 'savings', 'Dummy Sav', '2468', 0.00, false, false) as sav \gset
reset role;
select private.cb_add_statement(:'f', :'chq', 'chq.pdf', 1000.00, 1011.00, '[
  {"line": 1, "date": "2025-10-02", "description": "REFUND DUMMY", "amount": 173.00},
  {"line": 2, "date": "2025-11-03", "description": "CAFE DUMMY", "amount": -12.00},
  {"line": 3, "date": "2025-12-04", "description": "SOFTWARE DUMMY", "amount": -99.00},
  {"line": 4, "date": "2026-01-05", "description": "DUPLICATE DUMMY", "amount": -1.00},
  {"line": 5, "date": "2026-02-02", "description": "TRANSFER OUT DUMMY", "amount": -50.00}]', '2025-09-01', '2026-08-31', 1000.00, 1011.00, null);
select private.cb_add_statement(:'f', :'sav', 'sav.pdf', 0.00, 50.00, '[
  {"line": 1, "date": "2026-02-02", "description": "TRANSFER IN DUMMY", "amount": 50.00}]', '2025-09-01', '2026-08-31', 0.00, 50.00, null);
create function test.q(p_desc text) returns uuid language sql security definer set search_path = '' as $$ select id from public.cb_bank_lines where description = p_desc $$;
grant execute on function test.q(text) to authenticated, service_role;
grant usage on schema test to service_role;
grant execute on all functions in schema test to service_role;
create function test.tb() returns text language sql security definer set search_path = '' as $$
  select coalesce(string_agg(format('%s=%s', account, amount), ',' order by account), '') from (
    select coalesce(chart_account, '') account, sum(amount) amount from public.cb_bank_lines where status not in ('new', 'excluded') group by 1) x $$;
grant execute on function test.tb() to authenticated;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';

-- ---------- 1. Posting closes the questions still open on the line at that moment.
select public.cb_ask_questions(:'f', array[test.q('CAFE DUMMY')], 'What was this for?');
select public.cb_post_lines(:'f', jsonb_build_array(jsonb_build_object('id', test.q('CAFE DUMMY'), 'kind', 'code', 'account', '63000', 'tax', 'EXEMPT')));
reset role;
select test.check('posting closed the unsent question: Closed', (select q_status = 'closed' from public.cb_bank_lines where id = test.q('CAFE DUMMY'))
  and (select bool_and(closed_at is not null) from public.cb_line_questions where line_id = test.q('CAFE DUMMY') and kind = 'q'));
set role authenticated;
select test.check('a closed question cannot be changed', test.try(format('select public.cb_question_edit(%L, %L)',
  (select id from public.cb_line_questions where line_id = test.q('CAFE DUMMY') and kind = 'q'), 'Changed?')) = 'This question was closed when the line was posted.');

-- ---------- 2. A question on a posted line (with the reviewer): the line stays posted with its coding and flag.
select public.cb_post_lines(:'f', jsonb_build_array(jsonb_build_object('id', test.q('REFUND DUMMY'), 'kind', 'code', 'account', '64000', 'tax', 'EXEMPT')));
select test.check('money in coded to an expense: with the reviewer', (select status = 'reviewer' from public.cb_bank_lines where id = test.q('REFUND DUMMY')));
reset role;
insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at) values (:'f', 'code', :C::uuid, now());
select test.tb() as tb_before \gset
set role authenticated;
select public.cb_ask_questions(:'f', array[test.q('REFUND DUMMY')], 'Is this a refund from a supplier?');
reset role;
select test.check('asked: still with the reviewer, same account, tax and reason; Not sent', (select status = 'reviewer' and chart_account = '64000' and tax_code = 'EXEMPT'
  and reviewer_reason <> '' and q_status = 'not_sent' from public.cb_bank_lines where id = test.q('REFUND DUMMY')));
select test.check('the trial balance does not change', test.tb() = :'tb_before');
select test.check('step 4 stays signed', exists (select 1 from public.cb_step_signoffs where file_id = :'f' and step = 'code' and prepared_at is not null));
select test.check('the question is open', (select closed_at is null from public.cb_line_questions where line_id = test.q('REFUND DUMMY') and kind = 'q'));

-- ---------- 3. Copy link: Waiting; the client answers; the line stays posted.
set role authenticated;
select public.cb_question_link_create(:'f', repeat('c', 64), array[test.q('REFUND DUMMY'), test.q('CAFE DUMMY')], array['client@example.test'], '{}', current_date + 7, now() + interval '30 days') as k \gset
select public.cb_question_link_copied(:'k');
reset role;
select test.check('sent: the posted line is Waiting', (select q_status = 'waiting' from public.cb_bank_lines where id = test.q('REFUND DUMMY')));
select test.check('the closed question is never sent', (select sent_at is null and closed_at is not null from public.cb_line_questions where line_id = test.q('CAFE DUMMY') and kind = 'q')
  and (select q_status = 'closed' from public.cb_bank_lines where id = test.q('CAFE DUMMY')));
set role service_role;
select test.check('the closed line cannot be answered', test.try(format('select public.cb_client_answer(%L, %L, %L, %L, %L)', :'k', test.q('CAFE DUMMY'), 'client@example.test', 'Coffee', '[]')) is not null);
select public.cb_client_answer(:'k', test.q('REFUND DUMMY'), 'client@example.test', 'Yes, a supplier refund (dummy).', '[]');
reset role;
select test.check('answered: Answered, still with the reviewer, same coding', (select q_status = 'answered' and status = 'reviewer' and chart_account = '64000' from public.cb_bank_lines where id = test.q('REFUND DUMMY')));
select test.check('the trial balance still does not change', test.tb() = :'tb_before');
select test.check('the answer is in the thread', exists (select 1 from public.cb_line_questions where line_id = test.q('REFUND DUMMY') and kind = 'a' and body like 'Yes, a supplier refund%'));

-- ---------- 4. An excluded line cannot be asked about.
set role authenticated;
select public.cb_exclude_lines(:'f', array[test.q('DUPLICATE DUMMY')], 'duplicate', '');
select test.check('an excluded line cannot be asked about', test.try(format('select public.cb_ask_questions(%L, array[%L]::uuid[], %L)', :'f', test.q('DUPLICATE DUMMY'), 'Why?')) = 'An excluded line cannot be asked about.');

-- ---------- 5. A sent question still waiting on a pending line: posting closes it too; the client can no longer answer.
set role authenticated;
select public.cb_ask_questions(:'f', array[test.q('SOFTWARE DUMMY')], 'Which software is this?');
select public.cb_question_link_create(:'f', repeat('d', 64), array[test.q('SOFTWARE DUMMY')], array['client@example.test'], '{}', current_date + 7, now() + interval '30 days') as k2 \gset
select public.cb_question_link_copied(:'k2');
select public.cb_post_lines(:'f', jsonb_build_array(jsonb_build_object('id', test.q('SOFTWARE DUMMY'), 'kind', 'code', 'account', '68000', 'tax', 'EXEMPT')));
reset role;
select test.check('posting closed the waiting question', (select q_status = 'closed' from public.cb_bank_lines where id = test.q('SOFTWARE DUMMY'))
  and (select closed_at is not null and sent_at is not null from public.cb_line_questions where line_id = test.q('SOFTWARE DUMMY') and kind = 'q'));
set role service_role;
select test.check('the client cannot answer a closed question', test.try(format('select public.cb_client_answer(%L, %L, %L, %L, %L)', :'k2', test.q('SOFTWARE DUMMY'), 'client@example.test', 'Accounting app', '[]')) is not null);
reset role;
select test.check('the answered question on the posted line is still open', (select q_status = 'answered' and status = 'reviewer' from public.cb_bank_lines where id = test.q('REFUND DUMMY')));

-- ---------- 6. A transfer pair with an open question on each side posts; the questions close (the pairing is not refused).
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_ask_questions(:'f', array[test.q('TRANSFER OUT DUMMY'), test.q('TRANSFER IN DUMMY')], 'Which account is this?');
select test.check('a transfer pair with open questions posts', test.try(format('select public.cb_post_lines(%L, %L)', :'f',
  jsonb_build_array(jsonb_build_object('id', test.q('TRANSFER OUT DUMMY'), 'kind', 'pair', 'other', test.q('TRANSFER IN DUMMY'))))) = 'OK');
reset role;
select test.check('both sides posted, both questions closed', (select count(*) = 2 from public.cb_bank_lines where id in (test.q('TRANSFER OUT DUMMY'), test.q('TRANSFER IN DUMMY'))
  and status in ('done', 'matched') and q_status = 'closed'));
