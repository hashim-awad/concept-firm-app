-- Local tests: piece 2 of the step 5 restructure (Hashim, Nov 18, 2026): Edit changes an entry in place. Same number,
-- id, creator, created date and standard entry link; History has each change with old and new values; approved,
-- revenue check and Expenses paid personally entries behave as before; the same sign-offs clear as when Edit deleted
-- and re-added the entry; Reclassify and its Undo still work on an edited entry. Dummy data only.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'), ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test', (select id from public.roles where name = 'Staff'));
reset role;
update public.role_permissions set level = 'edit' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Staff');
\set A '''00000000-0000-0000-0000-00000000000a'''
\set C '''00000000-0000-0000-0000-00000000000c'''
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
insert into public.clients (kind, legal_name, province) values ('corporation', 'Maple Dummy Edit Inc.', 'ON') returning id as client \gset
select public.cb_create_file(:'client', '2026-08-31', '2025-09-01', '', 'full', 'statements', :C::uuid, :A::uuid) as f \gset

-- T1: a typed AJE. Change one amount and the description.
select public.cb_add_entry(:'f', 'AJE', 'accrual', 'Licence fee accrual', true, '[{"chart":"64000","amount":400},{"chart":"21100","amount":-400}]', 'Licence invoice') as e1 \gset
select seq as s1, created_by as cb1, created_at as ca1, number as n1 from public.cb_entries where id = :'e1' \gset
reset role;
select pg_sleep(0.01);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';   -- the owner edits it (creator stays staff C)
select public.cb_edit_entry(:'e1', 'AJE', 'accrual', 'Licence fee accrual, September invoice', true, '[{"chart":"64000","amount":450},{"chart":"21100","amount":-450}]', 'Licence invoice') as e1b \gset
select test.check('T1: Edit returns the same entry', :'e1b' = :'e1');
select test.check('T1: number, creator and created date unchanged',
  (select seq = :'s1'::int and number = :'n1'::int and created_by = :'cb1'::uuid and created_at = :'ca1'::timestamptz from public.cb_entries where id = :'e1'));
select test.check('T1: the new description and amount are on the same entry',
  (select note from public.cb_entries where id = :'e1') = 'Licence fee accrual, September invoice'
  and (select sum(amount) filter (where amount > 0) from public.cb_entry_lines where entry_id = :'e1') = 450
  and (select count(*) from public.cb_entry_lines where entry_id = :'e1') = 2);
select test.check('T1: no standard entry link before or after (a typed entry)', (select standard_id is null from public.cb_entries where id = :'e1'));
reset role;
select test.check('T1: History has the description, old and new',
  exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'entry_edited' and reason = 'Description'
          and old_value = 'Licence fee accrual' and new_value = 'Licence fee accrual, September invoice' and ref_label like '2026-001 AJE'
          and actor_id = '00000000-0000-0000-0000-00000000000a'));
select test.check('T1: History has the lines, old and new',
  (select old_value || ' => ' || new_value from public.cb_file_history where file_id = :'f' and action = 'entry_edited' and reason = 'Lines')
  = '64000 Licences and permits Dr 400.00 · 21100 Accrued liabilities Cr 400.00 => 64000 Licences and permits Dr 450.00 · 21100 Accrued liabilities Cr 450.00');
select test.check('T1: only what changed is in History (description and lines)',
  (select string_agg(reason, ',' order by reason) from public.cb_file_history where file_id = :'f' and action = 'entry_edited') = 'Description,Lines');

-- Piece 2b: "Last changed by" for anyone who can view Closebook; History itself stays owner-only.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('2b: staff see who changed the entry last and when (the owner, today)',
  (select changed_by || ' · ' || (changed_at::date = current_date) from public.cb_entry_last_change(:'e1')) = 'Test Owner A · true');
select test.check('2b: staff still cannot read the file history (round 8 rule)', (select count(*) from public.cb_file_history where file_id = :'f') = 0);
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('2b: owners see the same line, and can read the history', (select changed_by from public.cb_entry_last_change(:'e1')) = 'Test Owner A'
  and (select count(*) from public.cb_file_history where file_id = :'f' and action = 'entry_edited') = 2);
reset role;

-- Other fields: type, date, W/P ref, number; a number in use is refused.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_add_entry(:'f', 'AJE', 'correction', 'Second entry', false, '[{"chart":"60000","amount":50},{"chart":"21100","amount":-50}]', 'Payables listing') as e2 \gset
select test.check('a number in use is refused on Edit', test.try(format($q$select public.cb_edit_entry(%L, 'AJE', 'correction', 'Second entry', false, '[{"chart":"60000","amount":50},{"chart":"21100","amount":-50}]', 'Payables listing', null, null, '{}', 1)$q$, :'e2'))
  = 'Entry number 2026-001 is taken. Choose another.');
select public.cb_edit_entry(:'e2', 'RJE', 'reclassification', 'Second entry', false, '[{"chart":"60000","amount":50},{"chart":"64000","amount":-50}]', 'Expense listing', '2026-06-30', null, '{}', 9);
reset role;
select test.check('type, date, W/P ref and a free number all change in place, each in History',
  (select seq || ' ' || kind || ' ' || entry_date || ' ' || wp_ref from public.cb_entries where id = :'e2') = '9 RJE 2026-06-30 Expense listing'
  and (select string_agg(reason || ': ' || old_value || ' → ' || new_value, ' | ' order by reason) from public.cb_file_history where file_id = :'f' and action = 'entry_edited' and ref_label = '2026-009 RJE' and reason <> 'Lines')
    = 'Date: Aug 31, 2026 → Jun 30, 2026 | Number: 2026-002 AJE → 2026-009 RJE | Type: AJE → RJE | W/P ref: Payables listing → Expense listing');

-- T2: an entry made from a standard entry keeps its link.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select id as std from public.cb_standard_entries where name = 'Home office' \gset
select public.cb_add_entry(:'f', 'AJE', 'correction', 'Home office share', false, '[{"chart":"65100","amount":100},{"chart":"23000","amount":-100}]', 'Home office schedule', null, :'std') as e3 \gset
select test.check('T2: before the edit, linked and under the threshold (no review)', (select standard_id = :'std'::uuid and not needs_review from public.cb_entries where id = :'e3'));
select public.cb_edit_entry(:'e3', 'AJE', 'correction', 'Home office share', false, '[{"chart":"65100","amount":120},{"chart":"23000","amount":-120}]', 'Home office schedule');
select test.check('T2: after the edit the link is still there', (select standard_id from public.cb_entries where id = :'e3') = :'std'::uuid);
select test.check('T2: and it goes to the reviewer again, as an edit did before', (select needs_review from public.cb_entries where id = :'e3'));

-- T3: an approved entry, a revenue check entry and an Expenses paid personally entry behave as before.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_review_entry(:'e3');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('T3: an approved entry cannot be edited (same message as before)',
  test.try(format($q$select public.cb_edit_entry(%L, 'AJE', 'correction', 'Home office share', false, '[{"chart":"65100","amount":130},{"chart":"23000","amount":-130}]', 'Home office schedule')$q$, :'e3'))
  = 'An approved entry cannot be deleted. Add a correcting entry instead.');
select test.check('T3: and it is unchanged', (select sum(amount) filter (where amount > 0) from public.cb_entry_lines where entry_id = :'e3') = 120);
select public.cb_add_revenue_entry(:'f', 'Commission booked twice.', '[{"chart":"40100","amount":40},{"chart":"10900","amount":-40}]', false) as rv \gset
select public.cb_edit_entry(:'rv', 'AJE', 'correction', 'Commission booked twice in December.', false, '[{"chart":"40100","amount":45},{"chart":"10900","amount":-45}]', 'Revenue check') as rv2 \gset
select test.check('T3: a revenue check entry keeps its origin and W/P ref, on the same entry',
  :'rv2' = :'rv' and (select origin || '|' || wp_ref from public.cb_entries where id = :'rv') = 'revenue_check|Revenue check');
reset role;
update public.cb_entries set origin = 'expenses_personal' where id = :'e2';
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('T3: an Expenses paid personally entry cannot be edited here (same message as before)',
  test.try(format($q$select public.cb_edit_entry(%L, 'RJE', 'reclassification', 'Second entry', false, '[{"chart":"60000","amount":60},{"chart":"64000","amount":-60}]', 'Expense listing')$q$, :'e2'))
  = 'Change this entry on the Expenses paid personally paper.');

-- T4: the sign-offs an edit clears are the same as when Edit deleted and re-added the entry.
reset role;
create temp table t4 (how text, cleared text);
grant all on t4 to authenticated;
insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at, reviewed_by, reviewed_at)
select :'f', s, :C::uuid, now(), :A::uuid, now() from unnest(array['code', 'entries', 'review', 't2']) s on conflict (file_id, step) do update set prepared_at = now(), reviewed_at = now();
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_edit_entry(:'e1', 'AJE', 'accrual', 'Licence fee accrual, September invoice', true, '[{"chart":"64000","amount":460},{"chart":"21100","amount":-460}]', 'Licence invoice');
reset role;
insert into t4 select 'edit in place', string_agg(s, ',' order by s) from unnest(array['code', 'entries', 'review', 't2']) s
  where not exists (select 1 from public.cb_step_signoffs where file_id = :'f' and step = s);
insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at, reviewed_by, reviewed_at)
select :'f', s, :C::uuid, now(), :A::uuid, now() from unnest(array['code', 'entries', 'review', 't2']) s on conflict (file_id, step) do update set prepared_at = now(), reviewed_at = now();
-- What Edit did before this piece: delete the entry, then add it again with its number.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_delete_entry(:'e1');
select public.cb_add_entry(:'f', 'AJE', 'accrual', 'Licence fee accrual, September invoice', true, '[{"chart":"64000","amount":470},{"chart":"21100","amount":-470}]', 'Licence invoice', null, null, '{}', 1) as e1 \gset
reset role;
insert into t4 select 'delete and add (before)', string_agg(s, ',' order by s) from unnest(array['code', 'entries', 'review', 't2']) s
  where not exists (select 1 from public.cb_step_signoffs where file_id = :'f' and step = s);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('2b: a new entry that took a deleted entry''s number shows no "Last changed" line', not exists (select 1 from public.cb_entry_last_change(:'e1')));
select public.cb_add_entry(:'f', 'AJE', 'correction', 'Never changed', false, '[{"chart":"60000","amount":20},{"chart":"21100","amount":-20}]', 'Payables listing') as e9 \gset
select test.check('2b: a new, unedited entry shows no "Last changed" line', not exists (select 1 from public.cb_entry_last_change(:'e9')));
reset role;
select test.check('T4: an edit clears steps 5, 7 and 8 and keeps step 4, as before',
  (select cleared from t4 where how = 'edit in place') = 'entries,review,t2' and (select cleared from t4 where how = 'delete and add (before)') = 'entries,review,t2');
select test.check('T4: the reason names the entry', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'signoff_cleared' and step = 'entries' and detail like 'Entry 2026-001%'));

-- T5: Reclassify and its Undo still work on a typed entry that was edited.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_edit_entry(:'e1', 'AJE', 'accrual', 'Licence fee accrual, September invoice', true, '[{"chart":"64000","amount":480},{"chart":"21100","amount":-480}]', 'Licence invoice');
select l.id as ln from public.cb_entry_lines l join public.cb_accounts a on a.id = l.account_id where l.entry_id = :'e1' and a.account_key = 'chart:64000' \gset
select public.cb_reclassify(:'f', jsonb_build_array(jsonb_build_object('kind', 'entry', 'id', :'ln')), '63000', null, 480) as b \gset
select test.check('T5: Reclassify moves the edited entry''s line to 63000',
  (select a.account_key from public.cb_entry_lines l join public.cb_accounts a on a.id = l.account_id where l.id = :'ln') = 'chart:63000');
select public.cb_reclassify_undo(:'b');
select test.check('T5: Undo puts it back on 64000',
  (select a.account_key from public.cb_entry_lines l join public.cb_accounts a on a.id = l.account_id where l.id = :'ln') = 'chart:64000');
select test.check('T5: and the entry can still be edited after', test.try(format($q$select public.cb_edit_entry(%L, 'AJE', 'accrual', 'Licence fee accrual, September invoice', true, '[{"chart":"64000","amount":490},{"chart":"21100","amount":-490}]', 'Licence invoice')$q$, :'e1')) = 'OK');
reset role;
-- Last: lock the file (a lock cannot be undone in this test).
reset role;
update public.cb_files set phase = 'locked' where id = :'f';
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('T3 (last, as a lock is final here): a locked file refuses an edit (as before)', test.try(format($q$select public.cb_edit_entry(%L, 'AJE', 'correction', 'Commission booked twice.', false, '[{"chart":"40100","amount":50},{"chart":"10900","amount":-50}]', 'Revenue check')$q$, :'rv'))
  = 'This file is locked.');
reset role;
