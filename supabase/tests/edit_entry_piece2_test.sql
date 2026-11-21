-- Local tests: piece 2 of the step 5 restructure (Hashim, Nov 18, 2026): Edit changes an entry in place. Same number,
-- id, creator, created date and standard entry link; History has each change with old and new values; approved,
-- revenue check and Expenses paid personally entries behave as before; the same sign-offs clear as when Edit deleted
-- and re-added the entry; Reclassify and its Undo still work on an edited entry. Dummy data only.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'), ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test', (select id from public.roles where name = 'Accountant'));
reset role;
update public.role_permissions set level = 'edit' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Accountant');
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
select test.check('T1: History has one row for the edit, naming what changed (CB2-0 step 2: one action, one row)',
  exists (select 1 from public.cb_file_history where file_id = :'f' and entry_id = :'e1' and action = 'entry_edited' and reason = 'description, lines'
          and detail = 'Entry 2026-001 AJE changed: description, lines' and ref_label = '2026-001 AJE'
          and actor_id = '00000000-0000-0000-0000-00000000000a'));
select test.check('T1: the row has the description, old and new',
  (select split_part(old_value, E'\n', 1) || ' => ' || split_part(new_value, E'\n', 1) from public.cb_file_history where file_id = :'f' and action = 'entry_edited')
  = 'Description: Licence fee accrual => Description: Licence fee accrual, September invoice');
select test.check('T1: the row has the lines, old and new',
  (select split_part(old_value, E'\n', 2) || ' => ' || split_part(new_value, E'\n', 2) from public.cb_file_history where file_id = :'f' and action = 'entry_edited')
  = 'Lines: 64000 Licences and permits Dr 400.00 · 21100 Accrued liabilities Cr 400.00 => Lines: 64000 Licences and permits Dr 450.00 · 21100 Accrued liabilities Cr 450.00');
select test.check('T1: only what changed is in History (description and lines), in one row',
  (select string_agg(reason, ',' order by reason) from public.cb_file_history where file_id = :'f' and action = 'entry_edited') = 'description, lines');

-- Piece 2b: "Last changed by" for anyone who can view Closebook; History itself stays owner-only.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('2b: staff see who changed the entry last and when (the owner, today)',
  (select changed_by || ' · ' || (changed_at::date = current_date) from public.cb_entry_last_change(:'e1')) = 'Test Owner A · true');
select test.check('2b: staff read the file history (CB2-0 v7: everyone who can open the file)', (select count(*) from public.cb_file_history where file_id = :'f') > 0);
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('2b: owners see the same line, and can read the history', (select changed_by from public.cb_entry_last_change(:'e1')) = 'Test Owner A'
  and (select count(*) from public.cb_file_history where file_id = :'f' and action = 'entry_edited') = 1);
reset role;

-- Other fields: type, date, W/P ref, number; a number in use is refused.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_add_entry(:'f', 'AJE', 'correction', 'Second entry', false, '[{"chart":"60000","amount":50},{"chart":"21100","amount":-50}]', 'Payables listing') as e2 \gset
select test.check('a number in use is refused on Edit', test.try(format($q$select public.cb_edit_entry(%L, 'AJE', 'correction', 'Second entry', false, '[{"chart":"60000","amount":50},{"chart":"21100","amount":-50}]', 'Payables listing', null, null, '{}', 1)$q$, :'e2'))
  = 'Entry number 2026-001 is taken. Choose another.');
select public.cb_edit_entry(:'e2', 'RJE', 'reclassification', 'Second entry', false, '[{"chart":"60000","amount":50},{"chart":"64000","amount":-50}]', 'Expense listing', '2026-06-30', null, '{}', 9);
reset role;
select test.check('type, date, W/P ref and a free number all change in place, in one History row (CB2-0 step 2)',
  (select seq || ' ' || kind || ' ' || entry_date || ' ' || wp_ref from public.cb_entries where id = :'e2') = '9 RJE 2026-06-30 Expense listing'
  and (select count(*) from public.cb_file_history where entry_id = :'e2' and action = 'entry_edited') = 1
  and (select reason || ' | ' || left(old_value, strpos(old_value, E'\nLines:') - 1) || ' → ' || left(new_value, strpos(new_value, E'\nLines:') - 1)
         from public.cb_file_history where file_id = :'f' and action = 'entry_edited' and ref_label = '2026-009 RJE')
    = E'number, type, date, w/p ref, lines | Number: 2026-002 AJE\nType: AJE\nDate: Aug 31, 2026\nW/P ref: Payables listing → Number: 2026-009 RJE\nType: RJE\nDate: Jun 30, 2026\nW/P ref: Expense listing');

-- T2: an entry made from a standard entry keeps its link.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select id as std from public.cb_standard_entries where name = 'Home office' \gset
select public.cb_add_entry(:'f', 'AJE', 'correction', 'Home office share', false, '[{"chart":"65100","amount":100},{"chart":"23000","amount":-100}]', 'Home office schedule', null, :'std') as e3 \gset
select test.check('T2: before the edit, linked and under the threshold (no review)', (select standard_id = :'std'::uuid and not needs_review from public.cb_entries where id = :'e3'));
select public.cb_edit_entry(:'e3', 'AJE', 'correction', 'Home office share', false, '[{"chart":"65100","amount":120},{"chart":"23000","amount":-120}]', 'Home office schedule');
select test.check('T2: after the edit the link is still there', (select standard_id from public.cb_entries where id = :'e3') = :'std'::uuid);
select test.check('T2: and it goes to the reviewer again, as an edit did before', (select needs_review from public.cb_entries where id = :'e3'));

-- T3: a revenue check entry and an Expenses paid personally entry behave as before. Piece E1 (approved test change): there
-- is no approved entry any more; the entry changes until the file is locked.
select test.check('T3 (E1): the entry can be edited again',
  test.try(format($q$select public.cb_edit_entry(%L, 'AJE', 'correction', 'Home office share', false, '[{"chart":"65100","amount":130},{"chart":"23000","amount":-130}]', 'Home office schedule')$q$, :'e3'))
  = 'OK');
select test.check('T3 (E1): and it changed', (select sum(amount) filter (where amount > 0) from public.cb_entry_lines where entry_id = :'e3') = 130);
select public.cb_add_revenue_entry(:'f', 'Commission booked twice.', '[{"chart":"40100","amount":40},{"chart":"10900","amount":-40}]', false) as rv \gset
select public.cb_edit_entry(:'rv', 'AJE', 'correction', 'Commission booked twice in December.', false, '[{"chart":"40100","amount":45},{"chart":"10900","amount":-45}]', 'Revenue check') as rv2 \gset
select test.check('T3: a revenue check entry keeps its origin and W/P ref, on the same entry',
  :'rv2' = :'rv' and (select origin || '|' || wp_ref from public.cb_entries where id = :'rv') = 'revenue_check|Revenue check');
reset role;
update public.cb_entries set origin = 'expenses_personal' where id = :'e2';
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('T3 (CB2-0 review round): an Expenses paid personally entry can be edited here',
  test.try(format($q$select public.cb_edit_entry(%L, 'RJE', 'reclassification', 'Second entry', false, '[{"chart":"60000","amount":60},{"chart":"64000","amount":-60}]', 'Expense listing')$q$, :'e2'))
  = 'OK');

-- T4: an edit clears no sign-off, the same as when Edit deleted and re-added the entry (CB2-0 step 2).
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
select test.check('T4: an edit, or a delete and add, keeps every sign-off (CB2-0 step 2: software never clears a sign-off)',
  (select count(*) from t4) = 2 and (select cleared from t4 where how = 'edit in place') is null and (select cleared from t4 where how = 'delete and add (before)') is null);
select test.check('T4: History has the change instead, naming the entry; nothing says a sign-off was cleared',
  exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'entry_edited' and detail = 'Entry 2026-001 AJE changed: lines' and new_value like '%Dr 460.00%')
  and exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'entry_deleted' and detail like 'Entry 2026-001 AJE deleted%')
  and not exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'signoff_cleared'));

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
select test.check('T3 (last, as a lock is final here): a locked file refuses an edit (E1 D6 wording)', test.try(format($q$select public.cb_edit_entry(%L, 'AJE', 'correction', 'Commission booked twice.', false, '[{"chart":"40100","amount":50},{"chart":"10900","amount":-50}]', 'Revenue check')$q$, :'rv'))
  = 'This file is locked. Reopen it to change entries.');  -- E1 D6 wording
reset role;
