-- Local tests: round 33 (Hashim, Nov 17, 2026): internal notes never reach the client page. A question is sent only by a
-- Notify client or Copy link; one not sent yet can be edited, deleted or moved to the internal note; a sent one can't;
-- History logs each change; the internal note holds 2,000 characters with line breaks; the firm's contact details are
-- an owner's setting. Dummy data only.
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
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
\set A '''00000000-0000-0000-0000-00000000000a'''
insert into public.clients (kind, legal_name, province, email) values ('corporation', 'Maple Dummy Notes Inc.', 'ON', 'client@example.test') returning id as client \gset
select public.cb_create_file(:'client', '2026-08-31', '2025-09-01', '', 'full', 'statements', :A::uuid, :A::uuid) as f \gset
select public.cb_save_setup(:'f', '{"gst_registered": true, "gst_frequency": "quarterly", "quick_method": false}');
select public.cb_save_bank_account(:'f', null, 'chequing', 'Dummy Chq', '1357', 1000.00, false, false) as chq \gset
reset role;
select private.cb_add_statement(:'f', :'chq', 'chq.pdf', 1000.00, 776.00, '[
  {"line": 1, "date": "2025-11-10", "description": "PAD DUMMY TAX", "amount": -12.00},
  {"line": 2, "date": "2025-11-12", "description": "OFFICE SUPPLY DUMMY", "amount": -113.00},
  {"line": 3, "date": "2025-12-04", "description": "SOFTWARE DUMMY", "amount": -99.00}]', '2025-09-01', '2026-08-31', 1000.00, 776.00, null);
create function test.n(p_desc text) returns uuid language sql security definer set search_path = '' as $$ select id from public.cb_bank_lines where description = p_desc $$;
grant execute on function test.n(text) to authenticated;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';

-- ---------- The internal note: long, with line breaks.
select public.cb_set_line_memo(test.n('PAD DUMMY TAX'), E'Applied by CRA to HST period ending Aug 31, 2023.\nTotal owing, all periods: 0.00 (dummy).' || repeat(' x', 200), true);
select test.check('the internal note keeps its line breaks and holds more than 300 characters', (select memo like E'Applied by CRA%\nTotal owing%' and length(memo) > 300 from public.cb_bank_lines where id = test.n('PAD DUMMY TAX')));
select test.check('an internal note over 2,000 characters is refused', test.try(format('select public.cb_set_line_memo(%L, %L, true)', test.n('PAD DUMMY TAX'), repeat('y', 2001))) like 'Keep the internal note under 2,000%');

-- ---------- Questions on three lines; one line is posted before the link goes.
select public.cb_ask_questions(:'f', array[test.n('PAD DUMMY TAX'), test.n('OFFICE SUPPLY DUMMY'), test.n('SOFTWARE DUMMY')], 'What was this for?');
select public.cb_post_lines(:'f', jsonb_build_array(jsonb_build_object('id', test.n('SOFTWARE DUMMY'), 'kind', 'code', 'account', '63000', 'tax', 'EXEMPT')));
select public.cb_question_link_create(:'f', repeat('a', 64), array[test.n('PAD DUMMY TAX'), test.n('OFFICE SUPPLY DUMMY'), test.n('SOFTWARE DUMMY')], '{}', '{}', current_date + 7, now() + interval '30 days') as k1 \gset
select public.cb_question_link_copied(:'k1');
reset role;
select test.check('the link marks the questions on its open lines as sent', (select count(*) = 2 from public.cb_line_questions where file_id = :'f' and kind = 'q' and sent_at is not null and sent_link_id = :'k1'));
select test.check('the posted line''s question was not sent', (select sent_at is null from public.cb_line_questions where line_id = test.n('SOFTWARE DUMMY')));
select test.check('the link has its sent time', (select sent_at is not null from public.cb_question_links where id = :'k1'));
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';

-- ---------- A sent question can't change.
select id as qsent from public.cb_line_questions where line_id = test.n('OFFICE SUPPLY DUMMY') and kind = 'q' \gset
select test.check('a sent question can''t be edited', test.try(format('select public.cb_question_edit(%L, %L)', :'qsent', 'Changed?')) like 'This question was sent to the client%');
select test.check('a sent question can''t be deleted', test.try(format('select public.cb_question_delete(%L)', :'qsent')) like 'This question was sent to the client%');
select test.check('a sent question can''t be moved to the note', test.try(format('select public.cb_question_to_note(%L)', :'qsent')) like 'This question was sent to the client%');

-- ---------- Questions typed after the send: edit, delete, move.
select public.cb_ask_questions(:'f', array[test.n('OFFICE SUPPLY DUMMY')], 'Please send the receipt.');
select public.cb_ask_questions(:'f', array[test.n('OFFICE SUPPLY DUMMY')], 'Total owing per CRA notice (a note, typed here by mistake).');
select id as q2 from public.cb_line_questions where line_id = test.n('OFFICE SUPPLY DUMMY') and body = 'Please send the receipt.' \gset
select id as q3 from public.cb_line_questions where line_id = test.n('OFFICE SUPPLY DUMMY') and body like 'Total owing%' \gset
select test.check('after the follow-ups the line is Not sent', (select q_status = 'not_sent' from public.cb_bank_lines where id = test.n('OFFICE SUPPLY DUMMY')));
select public.cb_question_edit(:'q2', 'Please send the receipt or invoice.');
select test.check('an unsent question is edited', (select body = 'Please send the receipt or invoice.' from public.cb_line_questions where id = :'q2'));
select public.cb_question_to_note(:'q3');
select test.check('moved to the internal note: the question is gone, the text is at the end of the memo', not exists (select 1 from public.cb_line_questions where id = :'q3')
  and (select memo like 'Total owing per CRA notice%' from public.cb_bank_lines where id = test.n('OFFICE SUPPLY DUMMY')));
select public.cb_question_delete(:'q2');
select test.check('the last unsent question deleted: the line is Waiting again (its sent question stands)', (select q_status = 'waiting' from public.cb_bank_lines where id = test.n('OFFICE SUPPLY DUMMY')));
reset role;
select test.check('History logs the edit, the move and the delete', (select count(distinct action) = 3 from public.cb_file_history where file_id = :'f'
  and action in ('line_question_edited', 'line_question_to_note', 'line_question_deleted')));
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
-- A line asked only once and never sent: delete its question and it has no status.
select id as qpad from public.cb_line_questions where line_id = test.n('PAD DUMMY TAX') and kind = 'q' \gset
select test.check('the PAD line''s question went out', (select sent_at is not null from public.cb_line_questions where id = :'qpad'));
-- Round 35b: a posted line can be asked about and stays posted.
select test.check('a posted line can be asked about', test.try(format('select public.cb_ask_questions(%L, array[%L]::uuid[], %L)', :'f', test.n('SOFTWARE DUMMY'), 'More?')) = 'OK');
select test.check('it stays posted, with a new open question', (select status <> 'new' and chart_account = '63000' and q_status = 'not_sent' from public.cb_bank_lines where id = test.n('SOFTWARE DUMMY')));

-- ---------- The backfill on Live: questions typed before a send that carried their line count as sent; later ones don't.
reset role;
update public.cb_line_questions set sent_at = null, sent_link_id = null where file_id = :'f';
update public.cb_question_links set sent_at = null where file_id = :'f';
insert into public.cb_line_questions (file_id, line_id, kind, body, asked_by, created_at) values (:'f', test.n('PAD DUMMY TAX'), 'q', 'A note typed after the send', :A::uuid, now() + interval '1 minute');
\i supabase/migrations/20261212130000_round33_client_notes.sql
\i supabase/migrations/20261212380000_piece_r3a1_roles_rights.sql   -- piece R3a-1: the replay above restores owner checks; put the rights back
select test.check('backfill: the questions typed before the send are sent; the one typed after is not', (select count(*) = 2 from public.cb_line_questions where id in (:'qsent', :'qpad') and sent_link_id = :'k1')
  and (select sent_at is null from public.cb_line_questions where body = 'A note typed after the send'));
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';

-- ---------- The firm's contact details: owners only.
select public.update_firm_contact('1 Dummy Street, Kitchener, ON A1A 1A1', '555-555-0100', 'Office@Example.test');
reset role;
select test.check('the owner saves the firm''s contact details', (select value ->> 'email' = 'office@example.test' and value ->> 'phone' = '555-555-0100' from public.settings where key = 'firm_contact'));
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('staff can''t change them', test.try('select public.update_firm_contact(''x street 1'', ''555-555-0199'', ''a@b.test'')') like 'Only an Admin%');
reset role;
