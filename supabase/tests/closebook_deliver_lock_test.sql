-- Local tests: round 12 (Hashim, Nov 14, 2026), step 10 "Deliver and lock": the checklist opens once the
-- MAL is signed (old answers cleared once; questions 10 and 11 filled from the signing record), step 10's
-- sign-off rules, the delivery, the filing record, the lock (each missing item named), a locked file
-- read-only everywhere, and an owner's reopen with a reason.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'prep.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Preparer C', 'prep.c@example.test', (select id from public.roles where name = 'Staff'));
reset role;
reset request.jwt.claims;
update public.role_permissions set level = 'edit' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Staff');
insert into public.clients (kind, legal_name, province) values ('corporation', 'Maple Test Realty Inc.', 'ON') returning id as client \gset
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_create_file(:'client', '2026-12-31', '2026-01-01', '', 'full', 'client_software', '00000000-0000-0000-0000-00000000000c'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid) as f \gset
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_import_tb(:'f', 'this_year', 'client_software', 'tb.csv', '[
  {"number":"10100","name":"Chequing","amount":10000},{"number":"41000","name":"Commission income","amount":-20000},{"number":"64250","name":"Accounting fees","amount":10000}]');
select public.cb_map_account(id, case number when '10100' then '1002.00' when '41000' then '8000.00' else '8862.00' end) from public.cb_accounts where file_id = :'f';
\set checks '[{"key":"tb","title":"TB","ok":true},{"key":"bs","title":"BS","ok":true},{"key":"ni","title":"NI","ok":true},{"key":"re","title":"RE","ok":true},{"key":"opening","title":"Opening","ok":true}]'
select public.cb_record_gifi_export(:'f', 'final', 'Maple final.gfi', '"GIFI01",""', '{"9999":10000,"2599":10000,"amort":0,"inctax":0}', :'checks');
select public.cb_save_t2_tieout(:'f', 10000, 10000, 0, 0, 'files/t2.pdf');
select public.cb_sign_step(:'f', 't2', 'prepared');
select public.cb_save_fs_fields(:'f', '{"officer_name":"Pat Dummy","officer_position":"President","officer_email":"pat@example.test","first_year":true,"audit_waiver":true,"related":{},"dividends":[]}');
select public.cb_sign_step(:'f', 'statements', 'prepared');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_sign_step(:'f', 'statements', 'reviewed');
reset role;
reset request.jwt.claims;
update public.cb_files set year_end = (now() at time zone 'America/Toronto')::date - 1, year_start = (now() at time zone 'America/Toronto')::date - 365 where id = :'f';
-- An answer saved before the checklist opened (round 8b allowed it).
insert into public.cb_checklist_answers (file_id, question, answer) values (:'f', 'wb200000002', 'yes');

set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('the checklist is closed before the MAL is signed', test.try(format($q$select public.cb_save_checklist(%L, '[{"question":"wb200000001","answer":"yes"}]')$q$, :'f'))
  = 'The checklist opens once the MAL is signed (step 9).');
select test.check('step 10 waits for the MAL', (public.cb_close_status(:'f') -> 'step10') = '["The MAL is not signed yet (step 9)."]');
select public.cb_send_mal(:'f', 'MAL', '<p>' || repeat('MAL text ', 30) || '</p>', '[{"text":"MAL"}]') as mal \gset
reset role;
reset request.jwt.claims;
select public.record_t1_signature(:'mal', 0, 'Pat Dummy', '127.0.0.1', 'test', repeat('a', 64), false, 'President', null);
select test.check('the MAL is signed: the checklist opens, the answer saved before is cleared',
  not exists (select 1 from public.cb_checklist_answers where file_id = :'f' and question = 'wb200000002')
  and exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'checklist_opened'));
select test.check('questions 10 and 11 are filled by Closebook from the signing record', (
  select count(*) = 2 and bool_and(a.answer = 'yes' and a.answered_by is null) and bool_or(a.note like 'Filled by Closebook from the signing record: the MAL was signed by Pat Dummy, President, on %')
    from public.cb_checklist_answers a join public.cb_checklist_questions q on q.key = a.question where a.file_id = :'f' and q.sort_order in (10, 11)));

set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_save_checklist(:'f', '[{"question":"wb20000000a","answer":"no","note":"x"},{"question":"wb200000001","answer":"yes"}]');
reset role;
reset request.jwt.claims;
select test.check('question 10 is read-only: an answer typed for it is ignored', (select answer from public.cb_checklist_answers where file_id = :'f' and question = 'wb20000000a') = 'yes');
select test.check('the other rules stay: 9 questions still to answer', private.cb_checklist_problems(:'f') = array['9 checklist questions to answer.']);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('a "No" needs a note', test.try(format($q$select public.cb_save_checklist(%L, '[{"question":"wb200000002","answer":"no","note":""}]')$q$, :'f')) like 'A "No" needs a note%');
select test.check('Not applicable only on 8 and 9', test.try(format($q$select public.cb_save_checklist(%L, '[{"question":"wb200000003","answer":"na"}]')$q$, :'f')) like 'Question 3 cannot be Not applicable%');
select public.cb_save_checklist(:'f', (select jsonb_agg(jsonb_build_object('question', key, 'answer', case when sort_order in (8, 9) then 'na' else 'yes' end))
  from public.cb_checklist_questions where sort_order not in (1, 10, 11)));
select test.check('step 10: the email figures are "To fill"', (public.cb_close_status(:'f') -> 'step10') @> '["To fill: the corporate tax balance owing or refund (A).", "To fill: federal and provincial tax for the year filed (C)."]');
select test.check('the preparer cannot sign step 10 yet', test.try(format($q$select public.cb_sign_step(%L, 'lock', 'prepared')$q$, :'f')) like 'Not yet: To fill:%');
select test.check('an instalment needs a date and an amount', test.try(format($q$select public.cb_save_close_fields(%L, '{"instalments":[{"date":"","amount":5}]}')$q$, :'f')) = 'Each instalment needs a due date and an amount.');
select public.cb_save_close_fields(:'f', '{"tax_balance":1250.40,"tax_due":"2027-03-31","filed_on":"2027-02-15","noa_issued":false,"fed_tax":900,"prov_tax":350.40,"fed_tax_prior":0,"prov_tax_prior":0,"instalments":[]}');
select public.cb_sign_step(:'f', 'lock', 'prepared');
select test.check('the documents wait for the reviewer: the email is a draft until then',
  test.try(format($q$select public.cb_record_delivery(%L, 'closebook/%s/delivered/x.zip', repeat('b', 64), '{"subject":"S"}')$q$, :'f', :'f')) = 'The reviewer signs step 10 first: until then the email is a draft.');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_sign_step(:'f', 'lock', 'reviewed');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_record_delivery(:'f', format('closebook/%s/delivered/x.zip', :'f'), repeat('b', 64), '{"subject":"S","text":"T","html":"H"}');
select test.check('the email figures are kept as sent', test.try(format($q$select public.cb_save_close_fields(%L, '{"tax_balance":1}')$q$, :'f')) = 'The email was sent: its figures are kept as sent.');
select test.check('only an owner locks', test.try(format($q$select public.cb_lock_file(%L)$q$, :'f')) = 'Only an owner locks a file.');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('the lock is refused, each missing item named',
  test.try(format($q$select public.cb_lock_file(%L)$q$, :'f')) like 'The file cannot be locked yet: Step 1, Set up the file: not signed by the reviewer.%Step 8, T2 tie-out: not signed by the reviewer.%The EFILE confirmation number is not recorded.');
reset role;
reset request.jwt.claims;
-- Steps 1 to 8 reviewed (their own rules are tested in their rounds).
insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at, reviewed_by, reviewed_at)
select :'f', s, '00000000-0000-0000-0000-00000000000c', now(), '00000000-0000-0000-0000-00000000000a', now() from unnest(array['setup', 'opening', 'records', 'code', 'entries', 'review', 'mapping', 't2']) s
on conflict (file_id, step) do update set reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('the EFILE number is letters and digits', test.try(format($q$select public.cb_save_filing_record(%L, null, 'no spaces allowed')$q$, :'f')) like 'The EFILE confirmation number%');
select public.cb_save_filing_record(:'f', ((now() at time zone 'America/Toronto')::date - 1), 'efa12345');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_lock_file(:'f');
reset role;
reset request.jwt.claims;
select test.check('locked: the file reads locked, the EFILE kept in capitals', (select phase from public.cb_files where id = :'f') = 'locked'
  and (select efile_number from public.cb_file_close where file_id = :'f') = 'EFA12345');

-- Read-only everywhere: the functions, and the tables themselves.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('a locked file refuses its functions', test.try(format($q$select public.cb_save_filing_record(%L, null, '')$q$, :'f')) = 'This file is locked or missing.');
reset role;
reset request.jwt.claims;
select test.check('a locked file refuses a change to its tables, even without the functions',
  test.try(format($q$update public.cb_accounts set name = 'x' where file_id = %L$q$, :'f')) = 'This file is locked. An owner can reopen it.'
  and test.try(format($q$delete from public.cb_checklist_answers where file_id = %L$q$, :'f')) = 'This file is locked. An owner can reopen it.'
  and test.try(format($q$update public.cb_files set year_change_reason = 'x' where id = %L$q$, :'f')) = 'This file is locked. An owner can reopen it.'
  and test.try(format($q$delete from public.cb_files where id = %L$q$, :'f')) = 'This file is locked. An owner can reopen it.');

-- Reopen: owners only, with a reason; logged; back to step 10.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('only an owner reopens', test.try(format($q$select public.cb_reopen_file(%L, 'Late NOA change')$q$, :'f')) = 'Only an owner reopens a locked file.');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('a reason is needed', test.try(format($q$select public.cb_reopen_file(%L, '')$q$, :'f')) = 'Say why the file is reopened.');
select public.cb_reopen_file(:'f', 'The CRA reassessed: update the email');
reset role;
reset request.jwt.claims;
select test.check('reopened: the phase is back, step 10 is open again, the history has the reason',
  (select phase from public.cb_files where id = :'f') <> 'locked'
  and not exists (select 1 from public.cb_step_signoffs where file_id = :'f' and step = 'lock')
  and exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'reopened' and detail = 'The CRA reassessed: update the email')
  and exists (select 1 from public.cb_step_signoffs where file_id = :'f' and step = 'statements' and reviewed_at is not null));

-- A package change after delivery: the MAL is taken back, questions 10 and 11 empty again, the delivery cleared.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_import_tb(:'f', 'this_year', 'client_software', 'tb2.csv', '[
  {"number":"10100","name":"Chequing","amount":10500},{"number":"41000","name":"Commission income","amount":-20500},{"number":"64250","name":"Accounting fees","amount":10000}]');
reset role;
reset request.jwt.claims;
select test.check('a TB change after delivery: MAL taken back, questions 10 and 11 empty, delivery cleared',
  (select mal_quote_id is null from public.cb_file_fs where file_id = :'f')
  and not exists (select 1 from public.cb_checklist_answers a join public.cb_checklist_questions q on q.key = a.question where a.file_id = :'f' and q.sort_order in (10, 11))
  and (select delivered_at is null from public.cb_file_close where file_id = :'f'));
select test.check('the instalment threshold is a setting (3,000)', (select instalment_threshold from public.cb_settings) = 3000);
