-- Local tests: piece E1 (Hashim, Nov 20, 2026): entry approval retired (CaseWare: the Adjustments page is signed off as a
-- whole). Entries change and delete until the file is locked; booked entries need step 5 Reviewed (TJE: step 8); the step 5
-- preparer does not also sign Reviewed while entries wait to be looked at, unless they have Partner sign-off; deletes keep
-- their lines in History; GST/HST answers that change take back step 5. Dummy data only.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'), ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test', (select id from public.roles where name = 'Senior accountant'));
reset role;
update public.role_permissions set level = 'edit' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Senior accountant');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
insert into public.clients (kind, legal_name, province) values ('corporation', 'Birch Dummy Retire Inc.', 'ON') returning id as client \gset
select public.cb_create_file(:'client', '2026-08-31', '2025-09-01', '', 'full', 'statements', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a') as f \gset
select public.cb_add_entry(:'f', 'AJE', 'correction', 'Accrued fees', false, '[{"chart":"65100","amount":500},{"chart":"23000","amount":-500}]', 'Payables listing', null, null, '{}', null) as e1 \gset
select public.cb_add_entry(:'f', 'AJE', 'correction', 'Small fix', false, '[{"chart":"65100","amount":20},{"chart":"23000","amount":-20}]', 'Payables listing', null, null, '{}', null) as e2 \gset

-- E1-1 approval is retired; entries change and delete freely until the file is locked.
select test.check('E1-1: cb_review_entry refuses', test.try(format('select public.cb_review_entry(%L)', :'e1')) = 'Entry approval was retired. Sign step 5 instead.');
select test.check('E1-1: an entry changes', test.try(format($q$select public.cb_edit_entry(%L, 'AJE', 'correction', 'Accrued fees', false, '[{"chart":"65100","amount":550},{"chart":"23000","amount":-550}]', 'Payables listing')$q$, :'e1')) = 'OK');
select public.cb_delete_entry(:'e2');
reset role;
select test.check('E1-1: a deleted entry keeps its lines in History',
  exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'entry_deleted' and detail like 'Entry % deleted (AJE, Aug 31, 2026): Small fix' and old_value like '%total 20.00%'));
set role authenticated;

-- E1-2 Booked (a QuickBooks file): step 5 Reviewed first (AJE), step 8 Reviewed first (TJE); the History row names the sign-off.
select public.cb_create_file(:'client', '2025-12-31', '2025-01-01', '', 'monthly', 'concept_qbo', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a') as m \gset
select public.cb_import_tb(:'m', 'this_year', 'quickbooks', 'tb.csv', '[{"number":"1000","name":"Chequing","amount":500},{"number":"4000","name":"Commission income","amount":-500}]');
select public.cb_assign(:'m', format('[{"account":"%s","chart":"10000"},{"account":"%s","chart":"40100"}]',
  (select id from public.cb_accounts where file_id = :'m' and number = '1000'), (select id from public.cb_accounts where file_id = :'m' and number = '4000'))::jsonb, 'Assigned 2 accounts');
select public.cb_add_entry(:'m', 'AJE', 'correction', 'Fix', false, '[{"chart":"40100","amount":5},{"chart":"10000","amount":-5}]', 'Bank', null, null, '{}', null) as b1 \gset
select public.cb_add_entry(:'m', 'TJE', 'correction', 'Tax', false, '[{"chart":"40100","amount":7},{"chart":"10000","amount":-7}]', 'ProFile', null, null, '{}', null) as t1 \gset
select test.check('E1-2: an AJE is not booked before step 5 is reviewed', test.try(format('select public.cb_mark_booked(%L, true)', :'b1')) = 'Sign step 5 Reviewed first: entries are booked after step 5 is reviewed.');
reset role;
insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at, reviewed_by, reviewed_at)
values (:'m', 'entries', '00000000-0000-0000-0000-00000000000c', now(), '00000000-0000-0000-0000-00000000000a', now());
set role authenticated;
select test.check('E1-2: a TJE waits for step 8 even with step 5 reviewed', test.try(format('select public.cb_mark_booked(%L, true)', :'t1')) = 'Sign step 8 Reviewed first: a tax entry is booked after step 8 is reviewed.');
select public.cb_mark_booked(:'b1', true);
reset role;
select test.check('E1-2: the booked row names the step 5 sign-off', exists (select 1 from public.cb_file_history where file_id = :'m' and action = 'entry_booked' and detail like '%under step 5 Reviewed by Test Owner A,%'));
set role authenticated;
select test.check('E1-2: a booked entry is not changed (change wording)',
  test.try(format($q$select public.cb_edit_entry(%L, 'AJE', 'correction', 'Fix', false, '[{"chart":"40100","amount":6},{"chart":"10000","amount":-6}]', 'Bank')$q$, :'b1')) = 'This entry is booked in QuickBooks. Unmark it first to change it.');
select test.check('E1-2: a booked entry is not deleted (delete wording)', test.try(format('select public.cb_delete_entry(%L)', :'b1')) = 'This entry is booked in QuickBooks. Unmark it first to delete it.');
select public.cb_mark_booked(:'b1', false);
-- A change after step 5 Reviewed takes the sign-off back, so the entry is not booked until step 5 is signed again.
select public.cb_edit_entry(:'b1', 'AJE', 'correction', 'Fix', false, '[{"chart":"40100","amount":6},{"chart":"10000","amount":-6}]', 'Bank');
select test.check('E1-2: after a change, booking waits for step 5 again', test.try(format('select public.cb_mark_booked(%L, true)', :'b1')) = 'Sign step 5 Reviewed first: entries are booked after step 5 is reviewed.');

-- E1-3 D5 B: the step 5 preparer does not also sign Reviewed while entries wait to be looked at.
reset role;
insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at) values (:'f', 'entries', '00000000-0000-0000-0000-00000000000c', now());
set role authenticated;
select test.check('E1-3: entries wait to be looked at', (select count(*) from public.cb_entries where file_id = :'f' and needs_review) > 0);
select test.check('E1-3: the preparer without Partner sign-off is refused',
  test.try(format($q$select public.cb_sign_step(%L, 'entries', 'reviewed')$q$, :'f')) = 'You prepared step 5 and entries wait to be looked at. Someone else signs Reviewed, or someone with Partner sign-off.');
reset role;
update public.cb_step_signoffs set prepared_by = '00000000-0000-0000-0000-00000000000a' where file_id = :'f' and step = 'entries';
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('E1-3: a partner who prepared it may sign Reviewed', test.try(format($q$select public.cb_sign_step(%L, 'entries', 'reviewed')$q$, :'f')) = 'OK');
reset role;
select test.check('E1-3: History gives the reason', exists (select 1 from public.cb_file_history where file_id = :'f' and detail = 'Prepared and reviewed by the same person (Partner sign-off)'));
select test.check('E1-3: step 5 Reviewed records what it covered', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'step5_covered' and detail like 'Step 5 Reviewed covers 1 AJE and RJE entry, debits 550.00; % to look at'));

-- E1-4b deleting a taxed entry keeps every line in History, the sales tax line included.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_add_entry(:'f', 'AJE', 'correction', 'Taxed', false, '[{"chart":"65100","amount":100,"tax_code":"HST_ON"},{"chart":"21500","amount":13,"is_tax":true},{"chart":"23000","amount":-113}]', 'Invoice', null, null, '{}', null) as e9 \gset
select public.cb_delete_entry(:'e9');
reset role;
select test.check('E1-4b: the deleted entry''s lines are all in History, tax line included',
  (select count(*) from public.cb_file_history where file_id = :'f' and action = 'entry_deleted_line' and detail like '% deleted, line: %') >= 3
  and exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'entry_deleted_line' and detail like '%21500 % Dr 13.00%'));

-- E1-4 GST/HST answers that change take back step 5 when an entry carries sales tax.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_edit_entry(:'e1', 'AJE', 'correction', 'Accrued fees', false, '[{"chart":"65100","amount":500,"tax_code":"HST_ON"},{"chart":"21500","amount":65,"is_tax":true},{"chart":"23000","amount":-565}]', 'Payables listing');
reset role;
insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at, reviewed_by, reviewed_at)
values (:'f', 'entries', '00000000-0000-0000-0000-00000000000c', now(), '00000000-0000-0000-0000-00000000000a', now())
on conflict (file_id, step) do update set prepared_at = now(), reviewed_at = now(), prepared_by = excluded.prepared_by, reviewed_by = excluded.reviewed_by;
set role authenticated;
select public.cb_save_setup(:'f', '{"gst_registered": false}');
reset role;
select test.check('E1-4: the step 5 sign-offs are taken back', not exists (select 1 from public.cb_step_signoffs where file_id = :'f' and step = 'entries' and (prepared_at is not null or reviewed_at is not null)));
set role authenticated;

-- E1-5 a locked file refuses both, with their own words.
reset role;
update public.cb_files set phase = 'locked' where id = :'f';
set role authenticated;
select test.check('E1-5: locked, change refused', test.try(format($q$select public.cb_edit_entry(%L, 'AJE', 'correction', 'x', false, '[{"chart":"65100","amount":1},{"chart":"23000","amount":-1}]', 'Payables listing')$q$, :'e1')) = 'This file is locked. Reopen it to change entries.');
select test.check('E1-5: locked, delete refused', test.try(format('select public.cb_delete_entry(%L)', :'e1')) = 'This file is locked. Reopen it to delete entries.');
reset role;
