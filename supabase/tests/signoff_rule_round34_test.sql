-- Local tests: round 34 (Hashim, Nov 17, 2026), updated for CB2-0 step 2 (rule 14): no change removes a sign-off.
-- 3.1, 3.2 and 3.3 stay signed through every step 4 action and through 3.2 work (statement excluded or added, an
-- outstanding item); History records each change. Dummy data only.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
\set A '''00000000-0000-0000-0000-00000000000a'''
insert into public.clients (kind, legal_name, province, email) values ('corporation', 'Maple Dummy Signoff Inc.', 'ON', 'client@example.test') returning id as client \gset
select public.cb_create_file(:'client', '2026-08-31', '2025-09-01', '', 'full', 'statements', :A::uuid, :A::uuid) as f \gset
select public.cb_save_setup(:'f', '{"gst_registered": true, "gst_frequency": "quarterly", "quick_method": false}');
select public.cb_save_bank_account(:'f', null, 'chequing', 'Dummy Chq', '1357', 5000.00, false, false) as chq \gset
select public.cb_save_bank_account(:'f', null, 'loc', 'Dummy LOC', '1111', 4000.00, false, false) as loc \gset
reset role;
select private.cb_add_statement(:'f', :'chq', 'chq.pdf', 5000.00, 3893.00, '[
  {"line": 1, "date": "2025-09-02", "description": "LOAN PAYMENT", "amount": -800.00},
  {"line": 2, "date": "2025-09-30", "description": "Monthly fee", "amount": -6.00},
  {"line": 3, "date": "2025-11-10", "description": "PAD TAX DUMMY", "amount": -100.00},
  {"line": 4, "date": "2025-11-12", "description": "OFFICE SUPPLY DUMMY", "amount": -113.00},
  {"line": 5, "date": "2026-01-21", "description": "DUPLICATE CHARGE DUMMY", "amount": -45.00},
  {"line": 6, "date": "2026-02-10", "description": "CAFE DUMMY", "amount": -43.00}]', '2025-09-01', '2026-07-31', 5000.00, 3893.00, null);
select private.cb_add_statement(:'f', :'loc', 'loc.pdf', 4000.00, 3200.00, '[
  {"line": 1, "date": "2025-09-02", "description": "PAYMENT", "amount": -800.00}]', '2025-09-01', '2026-07-31', 4000.00, 3200.00, null);
-- A second chequing statement, excluded at the end.
select private.cb_add_statement(:'f', :'chq', 'chq-extra.pdf', 3893.00, 3883.00, '[
  {"line": 1, "date": "2026-08-14", "description": "AUGUST FEE DUMMY", "amount": -10.00}]', '2026-08-01', '2026-08-31', 3893.00, 3883.00, null);
select id as extra from public.cb_bank_statements where file_id = :'f' and file_name = 'chq-extra.pdf' \gset
create function test.l(p_desc text) returns uuid language sql security definer set search_path = '' as $$ select id from public.cb_bank_lines where description = p_desc $$;
grant execute on function test.l(text) to authenticated, service_role;
grant usage on schema test to service_role;
grant execute on all functions in schema test to service_role;
create function test.signed() returns text language sql security definer set search_path = '' as $$
  select coalesce(string_agg(substep, ',' order by substep), '') from public.cb_substep_signoffs s join public.cb_files f on f.id = s.file_id
   where f.books = 'statements' and s.prepared_at is not null $$;
grant execute on function test.signed() to authenticated, service_role;
-- Sign 3.1, 3.2 and 3.3 (the sub-step checks are covered by the banking tests); step 3 follows.
insert into public.cb_substep_signoffs (file_id, substep, prepared_by, prepared_at) values (:'f', '3.1', :A::uuid, now()), (:'f', '3.2', :A::uuid, now()), (:'f', '3.3', :A::uuid, now());
select private.cb_records_follow(:'f');
select test.check('signed: 3.1, 3.2, 3.3 and step 3 with them', test.signed() = '3.1,3.2,3.3'
  and exists (select 1 from public.cb_step_signoffs where file_id = :'f' and step = 'records' and prepared_at is not null));
set role authenticated;

-- ---------- Step 4 work: every sub-step stays signed.
select public.cb_post_lines(:'f', jsonb_build_array(jsonb_build_object('id', test.l('Monthly fee'), 'kind', 'code', 'account', '63000', 'tax', 'EXEMPT')));
select test.check('post a line: 3.1 to 3.3 stay signed', test.signed() = '3.1,3.2,3.3');
select public.cb_unpost_lines(:'f', array[test.l('Monthly fee')]);
select test.check('Undo: still signed', test.signed() = '3.1,3.2,3.3');
select public.cb_post_lines(:'f', jsonb_build_array(jsonb_build_object('id', test.l('PAYMENT'), 'kind', 'pair', 'other', test.l('LOAN PAYMENT'))));
select test.check('pair a transfer: still signed', test.signed() = '3.1,3.2,3.3'
  and (select status = 'matched' from public.cb_bank_lines where id = test.l('PAYMENT')));
select public.cb_save_rule(:'f', null, '{"name": "Cafe", "direction": "out", "accounts": [], "match_all": true, "conditions": [{"field": "description", "op": "contains", "value": "CAFE"}],
  "txn_type": "expense", "account": "63000", "tax": "EXEMPT", "memo": "", "auto_post": false}') as rule \gset
select public.cb_fill_lines(:'f', jsonb_build_array(jsonb_build_object('id', test.l('CAFE DUMMY'), 'account', '63000', 'tax', 'EXEMPT', 'rule', :'rule')));
select public.cb_post_lines(:'f', jsonb_build_array(jsonb_build_object('id', test.l('CAFE DUMMY'), 'kind', 'code', 'account', '63000', 'tax', 'EXEMPT')));
select test.check('apply a rule and post: still signed', test.signed() = '3.1,3.2,3.3');
select public.cb_exclude_lines(:'f', array[test.l('DUPLICATE CHARGE DUMMY')], 'duplicate', '');
select test.check('exclude a line in step 4: still signed', test.signed() = '3.1,3.2,3.3');
select public.cb_set_line_memo(test.l('PAD TAX DUMMY'), 'INTERNAL NOTE DUMMY: applied to HST period ending Aug 31 (dummy).', true);
select test.check('add an internal note (memo), even with confirm on: still signed', test.signed() = '3.1,3.2,3.3');
select public.cb_set_line_date(test.l('OFFICE SUPPLY DUMMY'), '2025-11-14', true);
select test.check('change the accounting date: still signed', test.signed() = '3.1,3.2,3.3');
select public.cb_ask_questions(:'f', array[test.l('PAD TAX DUMMY')], 'A note typed as a question (dummy).');
select id as q from public.cb_line_questions where line_id = test.l('PAD TAX DUMMY') \gset
select public.cb_question_to_note(:'q');
select test.check('move a question to the internal note: still signed; the note has both parts', test.signed() = '3.1,3.2,3.3'
  and (select memo like 'INTERNAL NOTE DUMMY%' || E'\n' || 'A note typed as a question (dummy).' from public.cb_bank_lines where id = test.l('PAD TAX DUMMY')));
select public.cb_ask_questions(:'f', array[test.l('OFFICE SUPPLY DUMMY')], 'What did you buy here?');
select public.cb_question_link_create(:'f', repeat('d', 64), array[test.l('OFFICE SUPPLY DUMMY')], array['client@example.test'], '{}', current_date + 7, now() + interval '30 days') as k \gset
select public.cb_question_link_sent(:'k');
reset role;
set role service_role;
select public.cb_client_answer(:'k', test.l('OFFICE SUPPLY DUMMY'), 'client@example.test', 'Printer paper (dummy)', '[]');
reset role;
select test.check('ask a client question, send it, the client answers: still signed', test.signed() = '3.1,3.2,3.3'
  and (select q_status = 'answered' from public.cb_bank_lines where id = test.l('OFFICE SUPPLY DUMMY')));
select test.check('History has no sign-off removal for 3.x', not exists (select 1 from public.cb_file_history where file_id = :'f' and action in ('signoff_removed', 'signoff_cleared') and step = 'records'));
select test.check('step 3 still signed', exists (select 1 from public.cb_step_signoffs where file_id = :'f' and step = 'records' and prepared_at is not null));

-- ---------- 3.2 work (CB2-0 rule 14): a statement excluded is not asked about and removes no sign-off; History has it.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('excluding a statement does not ask first (CB2-0: no confirm prompts)', test.try(format($q$select public.cb_exclude_statement(%L, 'twice', '')$q$, :'extra')) = 'OK');
select test.check('the statement is gone: excluding it again is refused', test.try(format($q$select public.cb_exclude_statement(%L, 'twice', '', true)$q$, :'extra')) = 'Statement not found, or already excluded.');
reset role;
select test.check('statement excluded: 3.1, 3.2 and 3.3 all stay signed', test.signed() = '3.1,3.2,3.3');
select test.check('step 3 stays signed', exists (select 1 from public.cb_step_signoffs where file_id = :'f' and step = 'records' and prepared_at is not null));
select test.check('History has the exclusion, and no sign-off removal', exists (select 1 from public.cb_file_history where file_id = :'f' and step = 'records'
  and action = 'statement_excluded' and reason = 'Imported twice')
  and not exists (select 1 from public.cb_file_history where file_id = :'f' and action in ('signoff_removed', 'signoff_cleared')));

-- ---------- An outstanding item removes no sign-off (CB2-0); History has the change.
insert into public.cb_substep_signoffs (file_id, substep, prepared_by, prepared_at) values (:'f', '3.2', :A::uuid, now()), (:'f', '3.3', :A::uuid, now()) on conflict do nothing;
set role authenticated;
select public.cb_add_outstanding(:'chq', 'end', '2026-08-30', 'CHEQUE DUMMY 101', 'out', 50.00, null, 'item');
reset role;
select test.check('an outstanding item: 3.1, 3.2 and 3.3 all stay signed', test.signed() = '3.1,3.2,3.3');
select test.check('History: the outstanding item, in one row', (select count(*) from public.cb_file_history where file_id = :'f'
  and action = 'bank_outstanding' and detail = 'Outstanding item added at the end of the year') = 1);

-- ---------- A statement added on a bank file clears no sign-off (CB2-0); History has the change.
insert into public.cb_substep_signoffs (file_id, substep, prepared_by, prepared_at) values (:'f', '3.3', :A::uuid, now()) on conflict do nothing;
select private.cb_records_follow(:'f');
select private.cb_add_statement(:'f', :'loc', 'loc-2.pdf', 3200.00, 3195.00, '[
  {"line": 1, "date": "2026-08-20", "description": "LOC INTEREST DUMMY", "amount": -5.00}]', '2026-08-01', '2026-08-31', 3200.00, 3195.00, null);
select test.check('a statement added: 3.1, 3.2, 3.3 and step 3 all stay signed', test.signed() = '3.1,3.2,3.3'
  and exists (select 1 from public.cb_step_signoffs where file_id = :'f' and step = 'records' and prepared_at is not null));
select test.check('History has the statement added', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'changed' and step = 'records' and detail like '%A statement was added'));
