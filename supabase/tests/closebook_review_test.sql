-- Local tests: round 8 (Hashim, Nov 24, 2026), step sign-offs, review notes, step 6, roles and history.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'prep.c@example.test'),
  ('00000000-0000-0000-0000-00000000000d', 'staff.d@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
-- CB2-0: runs a statement and rolls it back: 'OK' when it would succeed, or the error. Used where a call that used to be
-- refused now succeeds, so the rest of the file still runs on the same data.
create function test.try_rollback(p_sql text) returns text language plpgsql as $$
begin
  begin
    execute p_sql;
    raise exception 'ROLLBACK_OK';
  exception when others then
    if sqlerrm = 'ROLLBACK_OK' then return 'OK'; end if;
    return sqlerrm;
  end;
end $$;
grant execute on function test.try_rollback(text) to authenticated;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Preparer C', 'prep.c@example.test', (select id from public.roles where name = 'Accountant'));
select public.add_staff('00000000-0000-0000-0000-00000000000d', 'Test Staff D', 'staff.d@example.test', (select id from public.roles where name = 'Accountant'));
reset role;
reset request.jwt.claims;
-- Round 8b: Closebook preparer is a permission on a role (Closebook at Edit), not a role of its own.
-- Staff C keeps the Staff role and gets Closebook at Edit on it; Staff D is on a role without it.
select test.check('there is no "Closebook preparer" role', not exists (select 1 from public.roles where name = 'Closebook preparer'));
insert into public.roles (name) values ('Front desk') returning id as fd \gset
update public.staff set role_id = :'fd' where id = '00000000-0000-0000-0000-00000000000d';
update public.role_permissions set level = 'edit' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Accountant');
select test.check('Staff with Closebook at Edit keeps Leads and Quotes too',
  (select string_agg(area_key || ':' || level, ',' order by area_key) from public.role_permissions rp join public.roles r on r.id = rp.role_id
    where r.name = 'Accountant' and area_key in ('closebook', 'leads', 'documents')) = 'closebook:edit,documents:edit,leads:edit');
insert into public.clients (kind, legal_name, province) values ('corporation', 'Larch Test Realty Inc.', 'ON') returning id as client \gset

-- People: the reviewer is an owner; the preparer needs Closebook preparer access.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('a reviewer who is not an owner is refused',
  test.try(format($q$select public.cb_create_file(%L, '2026-12-31', '2026-01-01', '', 'full', 'client_software', '00000000-0000-0000-0000-00000000000c'::uuid, '00000000-0000-0000-0000-00000000000c'::uuid)$q$, :'client')) = 'The reviewer needs the Review right (Settings, Team and roles).');
select test.check('a preparer without Closebook access is refused',
  test.try(format($q$select public.cb_create_file(%L, '2026-12-31', '2026-01-01', '', 'full', 'client_software', '00000000-0000-0000-0000-00000000000d'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid)$q$, :'client')) like 'The preparer needs Closebook Edit and the Prepare right%');
select public.cb_create_file(:'client', '2026-12-31', '2026-01-01', '', 'full', 'client_software', '00000000-0000-0000-0000-00000000000c'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid) as f \gset

-- The preparer works the file.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('the preparer sees the file', exists (select 1 from public.cb_files where id = :'f'));
select test.check('step 1: the preparer can sign while setup questions are open (CB2-0: a warning, not a stop)',
  test.try(format($q$select public.cb_sign_step(%L, 'setup', 'prepared')$q$, :'f')) = 'OK');
reset role;
select test.check('step 1: the open questions are recorded on the sign-off''s History row', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'prepared' and step = 'setup'
  and detail like 'Signed with open items: 6 setup questions to answer.%'));
set role authenticated;
select public.cb_unsign_step(:'f', 'setup', 'prepared');   -- the preparer takes their own sign-off back
select public.cb_save_setup(:'f', '{"realtor":true,"owner_paid":false,"dividends":false,"payroll":false,"holdco":false,"gst_registered":true}');
select test.check('step 1: a registrant''s two open questions do not stop the sign-off either (rolled back here)',
  test.try_rollback(format($q$select public.cb_sign_step(%L, 'setup', 'prepared')$q$, :'f')) = 'OK');
select public.cb_save_setup(:'f', '{"gst_frequency":"annual","quick_method":false}');
-- Round 16: step 1 also needs the acceptance record.
select test.check('step 1: nor does a missing acceptance record (rolled back here)',
  test.try_rollback(format($q$select public.cb_sign_step(%L, 'setup', 'prepared')$q$, :'f')) = 'OK');
select public.cb_save_acceptance(:'f', '{"q1":"yes","q2":"yes","q3":"yes","q4":"yes","q5":"yes","q5_note":"","q9":"yes"}'::jsonb);
select public.cb_acceptance_confirm_client(:'f');
select public.cb_sign_step(:'f', 'setup', 'prepared');
select test.check('the preparer cannot sign as reviewer', test.try(format($q$select public.cb_sign_step(%L, 'setup', 'reviewed')$q$, :'f')) like 'You need the Review right to sign as reviewer%');
select test.check('the preparer cannot add a review note', test.try(format($q$select public.cb_add_note(%L, 'setup', 'step', null, 'x')$q$, :'f')) like 'Only the reviewer adds review notes%');
select test.check('step 3: nothing imported yet does not stop the sign-off (rolled back here)', test.try_rollback(format($q$select public.cb_sign_step(%L, 'records', 'prepared')$q$, :'f')) = 'OK');
select public.cb_import_tb(:'f', 'this_year', 'client_software', 'tb.csv', '[
  {"number":"10100","name":"Chequing","amount":12000},{"number":"41000","name":"Commission income","amount":-20000},
  {"number":"64250","name":"Accounting fees","amount":8000}]');
select public.cb_sign_step(:'f', 'records', 'prepared');
select test.check('step 4: three accounts to match do not stop the sign-off (rolled back here)', test.try_rollback(format($q$select public.cb_sign_step(%L, 'code', 'prepared')$q$, :'f')) = 'OK');
select public.cb_map_account(id, case number when '10100' then '1002.00' when '41000' then '8000.00' else '8862.00' end) from public.cb_accounts where file_id = :'f';
select public.cb_sign_step(:'f', 'code', 'prepared');
select test.check('step 10 has its sign-off (round 12); the MAL not signed is a warning (rolled back here)', test.try_rollback(format($q$select public.cb_sign_step(%L, 'lock', 'prepared')$q$, :'f')) = 'OK');
reset role;
reset request.jwt.claims;

-- The reviewer signs after the preparer.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('the reviewer may sign before the preparer (CB2-0: no order rule; rolled back here)', test.try_rollback(format($q$select public.cb_sign_step(%L, 'entries', 'reviewed')$q$, :'f')) = 'OK');
select public.cb_sign_step(:'f', 'setup', 'reviewed');
select public.cb_sign_step(:'f', 'records', 'reviewed');
reset role;
reset request.jwt.claims;
select test.check('step 1 shows both sign-offs with name and date',
  (select prepared_by::text || '|' || reviewed_by::text || '|' || (prepared_at <= reviewed_at) from public.cb_step_signoffs where file_id = :'f' and step = 'setup')
  = '00000000-0000-0000-0000-00000000000c|00000000-0000-0000-0000-00000000000a|true');

-- CB2-0 step 2: a change to a signed step keeps every sign-off; History records the change.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_save_setup(:'f', '{"payroll":true}');
reset role;
reset request.jwt.claims;
select test.check('a setup change keeps step 1''s sign-offs', exists (select 1 from public.cb_step_signoffs where file_id = :'f' and step = 'setup' and prepared_at is not null and reviewed_at is not null));
select test.check('step 3 keeps its sign-offs', exists (select 1 from public.cb_step_signoffs where file_id = :'f' and step = 'records' and reviewed_at is not null));
select test.check('the history records the change, with who', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'changed' and step = 'setup'
  and actor_id = '00000000-0000-0000-0000-00000000000c' and detail = 'Payroll: No to Yes'));
select test.check('one row for it, and no sign-off cleared', (select count(*) from public.cb_file_history where file_id = :'f' and detail = 'Payroll: No to Yes') = 1
  and not exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'signoff_cleared'));

-- Review notes: added, replied, fixed (reopening only its step), cleared.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_add_note(:'f', 'records', 'step', null, 'Attach the trial balance export to the file.') as n1 \gset
select public.cb_add_note(:'f', 'code', 'account', id, 'Is this the right line?') as n2 from public.cb_accounts where file_id = :'f' and number = '64250' \gset
select test.check('a note on an account names it', (select target_label from public.cb_review_notes where id = :'n2') = '64250 Accounting fees');
select test.check('the reviewer can sign a step with a note to clear (CB2-0: a warning; rolled back here)',
  test.try_rollback(format($q$select public.cb_sign_step(%L, 'code', 'reviewed')$q$, :'f')) = 'OK');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('the preparer cannot clear a note', test.try(format($q$select public.cb_clear_note(%L, null)$q$, :'n1')) like 'Only the reviewer clears%');
select test.check('a reply needs words', test.try(format($q$select public.cb_reply_note(%L, ' ', true)$q$, :'n1')) like 'Type the reply%');
select public.cb_reply_note(:'n1', 'Attached in the document vault.', true);
reset role;
reset request.jwt.claims;
select test.check('fixing a note reopens nothing (CB2-0): steps 3 and 4 keep their sign-offs',
  exists (select 1 from public.cb_step_signoffs where file_id = :'f' and step = 'records' and reviewed_at is not null)
  and exists (select 1 from public.cb_step_signoffs where file_id = :'f' and step = 'code' and prepared_at is not null));
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_clear_note(:'n2', 'Still on 8862: move it to 8860 if it is the audit fee.');
reset role;
reset request.jwt.claims;
select test.check('the reviewer can reopen a note with a reply', (select status from public.cb_review_notes where id = :'n2') = 'open'
  and (select count(*) from public.cb_review_note_replies where note_id = :'n2') = 1);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_clear_note(:'n1', null);
select public.cb_clear_note(:'n2', null);
reset role;
reset request.jwt.claims;
select test.check('cleared notes are closed with who and when', (select count(*) from public.cb_review_notes where file_id = :'f' and status = 'cleared' and cleared_by is not null and cleared_at is not null) = 2);
select test.check('the history has every note action',
  (select string_agg(action, ',' order by id) from public.cb_file_history where file_id = :'f' and action like 'note%') = 'note_added,note_added,note_replied,note_fixed,note_reopened,note_cleared,note_cleared');

-- Step 5: piece 10 moved the explanations to step 6; step 5 no longer needs them.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
-- Round 9: the revenue check ties out (commission statement, GST/HST returns, the brokerage's T4A).
select public.cb_add_revenue_source(:'f', 'commission_statement', '', 'Tax worksheet', 20000, 'files/statement.pdf');
select public.cb_add_revenue_source(:'f', 'gst_returns', '', 'Annual return', 20000, 'files/gst.pdf');
select public.cb_add_revenue_source(:'f', 't4a', 'brokerage', 'T4A', 20000, 'files/t4a.pdf');
select public.cb_sign_step(:'f', 'entries', 'prepared');
reset role;
reset request.jwt.claims;
select test.check('step 6: no flagged changes (CB2-0 step 5: no threshold)', not exists (select 1 from unnest(private.cb_step_problems(:'f', 'compare')) p where p like '%flagged%'));
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_explain_flag(id, 'revenue_grew', 'First full year of trading.') from public.cb_accounts where file_id = :'f';
-- Piece 10: step 6's other items (the three accounts are new this year; nothing went unused; the six questions).
select public.cb_confirm_new_account(:'f', account_key, true) from public.cb_accounts where file_id = :'f' and last_year = 0 and this_year <> 0;
select public.cb_answer_year_change(:'f', q, false, '') from unnest(array['assets', 'loans', 'shareholders', 'related', 'revenue', 'equity']) q;
reset role;
reset request.jwt.claims;

-- The same person may prepare and review; the history says so.
-- CB2-0: nothing above cleared steps 1 and 3, so their signers take their own sign-offs back first (a person's act).
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_unsign_step(:'f', 'setup', 'reviewed');
select public.cb_unsign_step(:'f', 'records', 'reviewed');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_unsign_step(:'f', 'setup', 'prepared');
select public.cb_unsign_step(:'f', 'records', 'prepared');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_sign_step(:'f', 'setup', 'prepared');
select public.cb_sign_step(:'f', 'setup', 'reviewed');
select public.cb_sign_step(:'f', 'opening', 'prepared');
select public.cb_sign_step(:'f', 'opening', 'reviewed');
select public.cb_sign_step(:'f', 'records', 'prepared');
select public.cb_sign_step(:'f', 'records', 'reviewed');
select public.cb_sign_step(:'f', 'code', 'reviewed');
select public.cb_sign_step(:'f', 'entries', 'reviewed');
select public.cb_sign_step(:'f', 'compare', 'prepared');
select public.cb_sign_step(:'f', 'compare', 'reviewed');
-- Piece 10: the reviewer marks the new accounts reviewed in step 7.
select public.cb_review_new_account(:'f', account_key, true) from public.cb_accounts where file_id = :'f' and last_year = 0 and this_year <> 0;
reset role;
reset request.jwt.claims;
select test.check('the history says when one person prepared and reviewed', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'reviewed' and step = 'setup' and detail like 'Prepared and reviewed by the same person.%'));

-- Round 8b: the completion checklist belongs to step 10. Step 6 does not need it. Round 12: it opens once
-- the MAL is signed (its rules are tested in closebook_deliver_lock_test.sql).
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('the checklist can be answered before the MAL is signed (CB2-0: a warning; rolled back here)', test.try_rollback(format($q$select public.cb_save_checklist(%L, '[{"question":"wb20000000d","answer":"yes"}]')$q$, :'f')) = 'OK');
reset role;
reset request.jwt.claims;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_add_note(:'f', 'review', 'step', null, 'Check the MAL date against the report date.') as n3 \gset
select test.check('step 7 can be signed while a note is open (CB2-0: a warning; rolled back here)', test.try_rollback(format($q$select public.cb_sign_step(%L, 'review', 'reviewed')$q$, :'f')) = 'OK');
select public.cb_clear_note(:'n3', null);
select public.cb_sign_step(:'f', 'review', 'reviewed');
reset role;
reset request.jwt.claims;
select test.check('step 6 is signed by the reviewer', exists (select 1 from public.cb_step_signoffs where file_id = :'f' and step = 'review' and reviewed_by = '00000000-0000-0000-0000-00000000000a'));
-- CB2-0 step 2: a later change to any step clears nothing; History has it.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_map_account(id, '8810.00') from public.cb_accounts where file_id = :'f' and number = '64250';
reset role;
reset request.jwt.claims;
select test.check('a line change on a trial balance file keeps steps 4, 5, 6 and 7 signed',
  (select count(*) from public.cb_step_signoffs where file_id = :'f' and step in ('code', 'entries', 'compare', 'review') and reviewed_at is not null) = 4);
select test.check('and History has the change', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'changed' and step = 'code' and detail like '64250 Accounting fees:%'));
select test.check('history is for owners only: the preparer sees none', true);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('the preparer cannot read the file history', (select count(*) from public.cb_file_history where file_id = :'f') = 0);
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('the owner reads the file history', (select count(*) from public.cb_file_history where file_id = :'f') > 20);
reset role;
reset request.jwt.claims;

-- Taking back a sign-off.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('the preparer cannot take back a reviewed step', test.try(format($q$select public.cb_unsign_step(%L, 'entries', 'prepared')$q$, :'f')) like 'The step is reviewed%');
reset role;
reset request.jwt.claims;

-- A bank-statement file: step 3 counts the missing months.
insert into public.clients (kind, legal_name, province) values ('corporation', 'Hemlock Test Realty Inc.', 'ON') returning id as client2 \gset
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_create_file(:'client2', '2026-12-31', '2026-01-01', '', 'full', 'statements', '00000000-0000-0000-0000-00000000000c'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid) as g \gset
-- Round 23: on a bank file step 3 is "Banking", signed in its sub-steps.
select test.check('step 3 on a bank file is signed in its sub-steps', test.try(format($q$select public.cb_sign_step(%L, 'records', 'prepared')$q$, :'g')) = 'Step 3 is signed in its sub-steps: 3.1, 3.2 and 3.3.');
select test.check('3.1 signs with no bank account (CB2-0: a warning; rolled back here)', test.try_rollback(format($q$select public.cb_sign_substep(%L, '3.1', 'prepared')$q$, :'g')) = 'OK');
reset role;
reset request.jwt.claims;
insert into public.cb_bank_accounts (file_id, name, name_key, kind, chart_account) values (:'g', 'TD chequing', 'td chequing', 'bank', '10000') returning id as ba \gset
insert into public.cb_bank_statements (file_id, account_id, first_date, last_date, period_start, period_end, opening, closing, lines, plus_total, minus_total) values (:'g', :'ba', '2026-01-01', '2026-03-31', '2026-01-01', '2026-03-31', 0, 0, 0, 0, 0);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('3.1 and 3.2 sign with items open (CB2-0: warnings; rolled back here)',
  test.try_rollback(format($q$select public.cb_sign_substep(%L, '3.1', 'prepared')$q$, :'g')) = 'OK'
  and test.try_rollback(format($q$select public.cb_sign_substep(%L, '3.2', 'prepared')$q$, :'g')) = 'OK');
select test.check('step 2 on a bank file signs without last year''s balance sheet (CB2-0: a warning; rolled back here)', test.try_rollback(format($q$select public.cb_sign_step(%L, 'opening', 'prepared')$q$, :'g')) = 'OK');
reset role;
reset request.jwt.claims;
select test.check('3.1 still names the balance at last year end; 3.2 counts the gap (Apr to Dec is one)',
  private.cb_banking_problems(:'g', '3.1') = array['10000 TD chequing: enter its balance at last year end.']
  and private.cb_banking_problems(:'g', '3.2') = array['10000 TD chequing: 1 missing.']);
select test.check('step 2 on a bank file still names last year''s balance sheet', private.cb_opening_problems(:'g') = array['Type the source: which T2 or CRA assessment the balances come from.', 'Attach the PDF of last year''s T2 or the CRA assessment.', 'Enter last year''s balance sheet (Schedule 100).']);
-- Deleting a file with sign-offs leaves nothing behind.
delete from public.cb_files where id = :'f';
select test.check('a deleted file takes its sign-offs, notes and history with it',
  not exists (select 1 from public.cb_step_signoffs where file_id = :'f') and not exists (select 1 from public.cb_file_history where file_id = :'f'));
