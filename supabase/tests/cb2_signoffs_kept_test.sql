-- Local tests: CloseBook2 piece CB2-0 step 2 (Hashim, Nov 21, 2026): sign-offs are never cleared. A change stamps the
-- sign-off "Changed since review" (when, who, why) on the step where it was made and, when trial balance figures move,
-- on steps 6, 8 and 9; never on 7 or 10; the MAL is never withdrawn by a change. Signing again clears the stamp.
-- Taking back a sign-off is still a person's own act. Dummy data only.
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
insert into public.clients (kind, legal_name, province) values ('corporation', 'Birch Dummy Kept Inc.', 'ON') returning id as client \gset
select public.cb_create_file(:'client', '2026-08-31', '2025-09-01', '', 'full', 'statements', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a') as f \gset
select public.cb_add_entry(:'f', 'AJE', 'correction', 'Accrued fees', false, '[{"chart":"65100","amount":500},{"chart":"23000","amount":-500}]', 'Payables listing', null, null, '{}', null) as e1 \gset

-- Every step signed by both, as on a file at the end of the year.
reset role;
insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at, reviewed_by, reviewed_at)
select :'f', s, '00000000-0000-0000-0000-00000000000c', now() - interval '1 hour', '00000000-0000-0000-0000-00000000000a', now() - interval '1 hour'
  from unnest(array['setup', 'opening', 'entries', 'compare', 'review', 't2', 'statements', 'lock']) s;
insert into public.cb_file_fs (file_id, mal_sent_at) values (:'f', now()) on conflict (file_id) do update set mal_sent_at = excluded.mal_sent_at;
set role authenticated;

-- K1 a new entry after the steps are signed: every sign-off stays.
select public.cb_add_entry(:'f', 'AJE', 'correction', 'Late fix', false, '[{"chart":"65100","amount":20},{"chart":"23000","amount":-20}]', 'Payables listing', null, null, '{}', null) as e2 \gset
reset role;
select test.check('K1: no sign-off is removed', (select count(*) from public.cb_step_signoffs where file_id = :'f' and prepared_at is not null and reviewed_at is not null) = 8);
select test.check('K1: step 5 is stamped', (select changed_at is not null and changed_by = '00000000-0000-0000-0000-00000000000c' from public.cb_step_signoffs where file_id = :'f' and step = 'entries'));
select test.check('K1: steps 6, 8 and 9 are stamped (trial balance figures moved)',
  (select count(*) from public.cb_step_signoffs where file_id = :'f' and step in ('compare', 't2', 'statements') and changed_at is not null) = 3);
select test.check('K1: step 7 and step 10 are not stamped', (select count(*) from public.cb_step_signoffs where file_id = :'f' and step in ('review', 'lock') and changed_at is not null) = 0);
select test.check('K1: steps 1 and 2 are not stamped', (select count(*) from public.cb_step_signoffs where file_id = :'f' and step in ('setup', 'opening') and changed_at is not null) = 0);
select test.check('K1: History records the change on step 5', (select count(*) from public.cb_file_history where file_id = :'f' and action = 'signoff_changed' and step = 'entries' and detail = 'Entry 2026-002 added') = 1);
select count(*) as k1_rows from public.cb_file_history where file_id = :'f' and action = 'signoff_changed' and step = 'entries' \gset
select changed_at as k1_at from public.cb_step_signoffs where file_id = :'f' and step = 'entries' \gset
select test.check('K1: nothing is recorded as cleared', not exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'signoff_cleared'));
select test.check('K1: the MAL is not withdrawn', (select mal_sent_at is not null and mal_withdrawn_at is null from public.cb_file_fs where file_id = :'f'));

-- K2 a second change keeps the first stamp (when and who) and adds no second stamp row.
set role authenticated;
select public.cb_delete_entry(:'e2');
reset role;
select test.check('K2: the second change is listed too', (select count(*) from public.cb_file_history where file_id = :'f' and action = 'signoff_changed' and step = 'entries') > :k1_rows);
select test.check('K2: the stamp keeps the first change (when)', (select changed_at = :'k1_at'::timestamptz from public.cb_step_signoffs where file_id = :'f' and step = 'entries'));
select test.check('K2: the delete itself is in History', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'entry_deleted'));

-- K3 signing again clears the stamp; nothing else does.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('K3: the reviewer signs step 5 again', test.try(format($q$select public.cb_sign_step(%L, 'entries', 'reviewed')$q$, :'f')) = 'OK');
reset role;
select test.check('K3: the step 5 stamp is gone', (select changed_at is null and changed_why = '' from public.cb_step_signoffs where file_id = :'f' and step = 'entries'));
select test.check('K3: step 8 keeps its stamp until it is signed again', (select changed_at is not null from public.cb_step_signoffs where file_id = :'f' and step = 't2'));
set role authenticated;
select test.check('K3: an unchanged step is still "already reviewed"', test.try(format($q$select public.cb_sign_step(%L, 'setup', 'reviewed')$q$, :'f')) = 'This step is already reviewed.');

-- K4 step 2 changes: the sign-off and its mirror on the file stay; the step is stamped.
reset role;
update public.cb_files set opening_signed_by = '00000000-0000-0000-0000-00000000000c', opening_signed_at = now() where id = :'f';
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_save_opening(:'f', '[{"code":"1002","amount":100},{"code":"3500","amount":100}]', 0, null, '');
reset role;
select test.check('K4: step 2 keeps its sign-off', (select prepared_at is not null from public.cb_step_signoffs where file_id = :'f' and step = 'opening'));
select test.check('K4: the file keeps "opening signed"', (select opening_signed_at is not null from public.cb_files where id = :'f'));
select test.check('K4: step 2 is stamped', (select changed_at is not null from public.cb_step_signoffs where file_id = :'f' and step = 'opening'));

-- K5 taking back a sign-off is still a person's act and removes it.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_unsign_step(:'f', 'compare', 'reviewed');
reset role;
select test.check('K5: the reviewer circle is taken back', (select reviewed_at is null from public.cb_step_signoffs where file_id = :'f' and step = 'compare'));
select test.check('K5: taking it back does not stamp step 7', (select changed_at is null from public.cb_step_signoffs where file_id = :'f' and step = 'review'));

-- K6 the screens read the stamp.
set role authenticated;
select test.check('K6: cb_step_status returns the stamp', (public.cb_step_status(:'f') -> 't2' ->> 'changed_at') is not null and (public.cb_step_status(:'f') -> 't2' ->> 'changed_why') <> '');
