-- Local tests: CloseBook2 piece CB2-0 step 2 (Hashim, Nov 21, 2026; rule 14). QuickBooks Online's audit history: every
-- change is recorded, nothing is pushed onto the screen. A change leaves every sign-off identical (same person, same time,
-- no flag); one action writes exactly one History row, the details inside it. The MAL is never withdrawn. Dummy data only.
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

-- Every step signed by both, as on a file at the end of the year, and the MAL out for signing.
reset role;
insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at, reviewed_by, reviewed_at)
select :'f', s, '00000000-0000-0000-0000-00000000000c', '2026-11-01 10:00+00', '00000000-0000-0000-0000-00000000000a', '2026-11-02 10:00+00'
  from unnest(array['setup', 'opening', 'entries', 'compare', 'review', 't2', 'statements', 'lock']) s;
insert into public.cb_file_fs (file_id, mal_sent_at) values (:'f', now()) on conflict (file_id) do update set mal_sent_at = excluded.mal_sent_at;
create temp table before_signs as select * from public.cb_step_signoffs where file_id = :'f';
grant select on before_signs to authenticated;
set role authenticated;

-- K1 an AJE added after review: no sign-off moves; one History row, the entry's own.
select count(*) as h0 from public.cb_file_history where file_id = :'f' \gset
select public.cb_add_entry(:'f', 'AJE', 'correction', 'Late fix', false, '[{"chart":"65100","amount":20},{"chart":"23000","amount":-20}]', 'Payables listing', null, null, '{}', null) as e1 \gset
reset role;
select test.check('K1: every sign-off is exactly as signed',
  not exists (select * from public.cb_step_signoffs where file_id = :'f' except select * from before_signs)
  and (select count(*) from public.cb_step_signoffs where file_id = :'f') = 8);
select test.check('K1: one History row for the save', (select count(*) from public.cb_file_history where file_id = :'f') = :h0 + 1);
select test.check('K1: it is the entry''s own row (who, when, what)',
  exists (select 1 from public.cb_file_history where entry_id = :'e1' and action = 'entry_created' and actor_id = '00000000-0000-0000-0000-00000000000c'
    and detail = 'Entry 2026-001 added' and new_value like '2026-001 AJE, Aug 31, 2026, Late fix: Dr 65100 % 20.00; Cr 23000 % 20.00'));
select test.check('K1: nothing is cleared and the MAL is not withdrawn',
  not exists (select 1 from public.cb_file_history where file_id = :'f' and action in ('signoff_cleared', 'mal_withdrawn'))
  and (select mal_sent_at is not null and mal_withdrawn_at is null from public.cb_file_fs where file_id = :'f'));
select test.check('K1: the entry waits to be looked at', (select needs_review from public.cb_entries where id = :'e1'));

-- K2 the entry changed: one row with the entry before and after.
set role authenticated;
select count(*) as h1 from public.cb_file_history where file_id = :'f' \gset
select public.cb_edit_entry(:'e1', 'AJE', 'correction', 'Late fix', false, '[{"chart":"65100","amount":25},{"chart":"23000","amount":-25}]', 'Payables listing');
reset role;
select test.check('K2: one History row for the change', (select count(*) from public.cb_file_history where file_id = :'f') = :h1 + 1);
select test.check('K2: before and after are kept',
  exists (select 1 from public.cb_file_history where entry_id = :'e1' and action = 'entry_edited' and reason = 'lines' and detail = 'Entry 2026-001 AJE changed: lines' and old_value like 'Lines: %20.00%' and new_value like 'Lines: %25.00%'));
select test.check('K2: sign-offs still exactly as signed', not exists (select * from public.cb_step_signoffs where file_id = :'f' except select * from before_signs));
select test.check('K2: the entry''s audit history reads newest first',
  (select array_agg(action order by at desc, id desc) from public.cb_file_history where entry_id = :'e1') = array['entry_edited', 'entry_created']);

-- K3 step 2 saved again: its sign-off and the file's "opening signed" stay; one History row.
update public.cb_files set opening_signed_by = '00000000-0000-0000-0000-00000000000c', opening_signed_at = '2026-11-01 10:00+00' where id = :'f';
set role authenticated;
select count(*) as h2 from public.cb_file_history where file_id = :'f' \gset
select public.cb_save_opening(:'f', '[{"code":"1002","amount":100},{"code":"3500","amount":100}]', 0, null, '');
reset role;
select test.check('K3: step 2 keeps its sign-off', not exists (select * from public.cb_step_signoffs where file_id = :'f' except select * from before_signs));
select test.check('K3: the file keeps "opening signed"', (select opening_signed_at is not null from public.cb_files where id = :'f'));
select test.check('K3: one History row for the save', (select count(*) from public.cb_file_history where file_id = :'f') = :h2 + 1);
select test.check('K3: it belongs to step 2', exists (select 1 from public.cb_file_history where file_id = :'f' and step = 'opening' and id = (select max(id) from public.cb_file_history where file_id = :'f')));

-- K4 taking back your own reviewer sign-off on a step leaves step 7 as signed.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_unsign_step(:'f', 'compare', 'reviewed');
reset role;
select test.check('K4: the reviewer circle on step 6 is taken back', (select reviewed_at is null from public.cb_step_signoffs where file_id = :'f' and step = 'compare'));
select test.check('K4: step 7 is untouched', (select reviewed_at = '2026-11-02 10:00+00' from public.cb_step_signoffs where file_id = :'f' and step = 'review'));

-- K5 a save that changes nothing the entry shows writes nothing.
set role authenticated;
select count(*) as h3 from public.cb_file_history where entry_id = :'e1' \gset
select public.cb_edit_entry(:'e1', 'AJE', 'correction', 'Late fix', false, '[{"chart":"65100","amount":25},{"chart":"23000","amount":-25}]', 'Payables listing');
reset role;
select test.check('K5: an unchanged save writes no row', (select count(*) from public.cb_file_history where entry_id = :'e1') = :h3);

-- K6 a delete is one row with the whole entry inside.
set role authenticated;
select count(*) as h4 from public.cb_file_history where file_id = :'f' \gset
select public.cb_delete_entry(:'e1');
reset role;
select test.check('K6: one History row for the delete', (select count(*) from public.cb_file_history where file_id = :'f') = :h4 + 1);
select test.check('K6: the lines are inside it', exists (select 1 from public.cb_file_history where entry_id = :'e1' and action = 'entry_deleted' and old_value like '%Dr 65100 % 25.00; Cr 23000 % 25.00'));
select test.check('K6: sign-offs still identical', not exists (select * from public.cb_step_signoffs where file_id = :'f' and step <> 'compare' except select * from before_signs));
select test.check('K6: no row ever says a sign-off was cleared', not exists (select 1 from public.cb_file_history where file_id = :'f' and action in ('signoff_cleared', 'signoff_changed')));
