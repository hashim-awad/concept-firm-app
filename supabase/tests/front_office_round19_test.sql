-- Local tests: round 19 (Hashim, Nov 15, 2026), the front office. Letter permissions on the role, one list
-- of letters (Studio and "Outside Studio"), the badge from the same list, and deadlines: mark done before a
-- date with a same-day undo, reopen one line, and the EFILE number marking the T2 filing deadline done.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'staff.b@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'book.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.create_role('Bookkeeper', 'T1 letters only') as bk \gset
select public.set_role_permissions(:'bk', '{"documents":"edit","leads":"none","pricing":"none","clients":"edit","closebook":"edit"}');
select public.add_staff('00000000-0000-0000-0000-00000000000b', 'Test Staff B', 'staff.b@example.test', (select id from public.roles where name = 'Staff'));
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Bookkeeper C', 'book.c@example.test', :'bk'::uuid);
select public.set_role_permissions((select id from public.roles where name = 'Staff'), '{"documents":"view","leads":"none","pricing":"view","clients":"view"}');

-- ---------- Letter permissions on the role
select test.check('a new role starts with no letter types', (select not can_t1_letters and not can_corporate_letters from public.roles where id = :'bk'));
select test.check('the owner ticks T1 letters on the role', test.try(format($q$select public.set_role_letters(%L, true, false)$q$, :'bk')) = 'OK');
select test.check('the change is in the activity log', exists (select 1 from public.activity_log where action = 'role_letters_changed' and entity_id::text = :'bk' and details ->> 't1' = 'true'));
select test.check('the Owner role cannot be changed', test.try(format($q$select public.set_role_letters(%L, false, false)$q$, (select id from public.roles where is_owner))) like 'The Owner role%');
select test.check('owners have every letter type', public.my_access() -> 'letters' = '{"t1": true, "corporate": true}');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('staff cannot change roles', test.try(format($q$select public.set_role_letters(%L, true, true)$q$, :'bk')) like 'Only an owner%');
select test.check('my_access gives the role''s letter types', public.my_access() -> 'letters' = '{"t1": true, "corporate": false}');
select test.check('a T1 letter draft is allowed', test.try($q$insert into public.documents (kind, title) values ('t1_letter', 'Dummy T1')$q$) = 'OK');
select test.check('a corporate letter draft is refused', test.try($q$insert into public.documents (kind, title) values ('corporate_letter', 'Dummy corporate')$q$) like 'Your role does not include corporate letters%');

-- ---------- One list of letters
reset role;
reset request.jwt.claims;
insert into public.clients (id, kind, legal_name, province) values
  ('00000000-0000-0000-0000-0000000000c1', 'corporation', 'Spruce Dummy Realty Inc.', 'ON'),
  ('00000000-0000-0000-0000-0000000000c2', 'corporation', 'Aspen Dummy Realty Inc.', 'ON'),
  ('00000000-0000-0000-0000-0000000000c3', 'individual', 'Robin Dummy', 'ON'),
  ('00000000-0000-0000-0000-0000000000c4', 'corporation', 'Larch Dummy Realty Inc.', 'ON');
insert into public.engagements (id, client_id, title, type, status, fiscal_year_end, el_issued, el_signed) values
  -- Sent outside Studio, waiting: the case that showed on My day but not in the letters list.
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1', 'Year-end 2025', 'Year-end compilation + T2', 'EL sent', '2025-12-31', '2026-10-28', null),
  -- Signed outside Studio.
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000c2', 'Monthly full service', 'Monthly full service', 'EL signed', null, '2026-01-10', '2026-01-14'),
  -- A Studio letter is on its way for this one: not outside.
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000c3', 'T1 2025', 'T1 personal', 'EL sent', '2025-12-31', null, null),
  -- No letter dates and not sent: not a letter.
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000c4', 'Draft engagement', 'T2 only', 'EL drafted', '2025-12-31', null, null);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.create_letter_quote('00000000-0000-0000-0000-0000000000c3', 'Robin Dummy T1 2025', '',
  '{"doc_kind":"t1_letter","label":"Personal tax 2025","engagement_id":"00000000-0000-0000-0000-0000000000e3","inputs":{}}',
  '[{"first_name":"Robin","last_name":"Dummy","email":"robin.dummy@example.test"}]') as t1q \gset
select public.create_letter_quote('00000000-0000-0000-0000-0000000000c4', 'Larch Dummy Realty Inc. letter', 'Larch Dummy Realty Inc.',
  '{"doc_kind":"corporate_letter","label":"Year-end Dec 31, 2025","inputs":{}}',
  '[{"first_name":"Lee","last_name":"Dummy","email":"lee.dummy@example.test"}]') as corpq \gset
reset role;
insert into public.quotes (id, kind, status, title, client_id, proposal, chosen_option, sent_at, valid_until)
values ('00000000-0000-0000-0000-0000000000f1', 'proposal', 'sent', 'Larch Dummy Realty Inc.', '00000000-0000-0000-0000-0000000000c4',
        '{"opts":[{"name":"Option B"}]}', 0, now(), (now() at time zone 'America/Toronto')::date + 30);
set role authenticated;

select test.check('owner: every letter, Studio and outside', (select count(*) from public.letter_list()) = 5);
select test.check('sent outside Studio: waiting, marked outside, with its date',
  (select source = 'outside' and letter_type = 'corporate' and status = 'sent' and came_from = 'Recorded on the engagement' and sent_at::date = '2026-10-28' and client = 'Spruce Dummy Realty Inc.'
     from public.letter_list() where id = '00000000-0000-0000-0000-0000000000e1'));
select test.check('signed outside Studio: signed, with both dates',
  (select source = 'outside' and status = 'signed' and sent_at::date = '2026-01-10' and signed_at::date = '2026-01-14' from public.letter_list() where id = '00000000-0000-0000-0000-0000000000e2'));
select test.check('an engagement a Studio letter points to is not listed twice', not exists (select 1 from public.letter_list() where id = '00000000-0000-0000-0000-0000000000e3'));
select test.check('an engagement with no letter dates is not a letter', not exists (select 1 from public.letter_list() where id = '00000000-0000-0000-0000-0000000000e4'));
select test.check('types: T1 letter, corporate letter, proposal',
  (select letter_type from public.letter_list() where id = :'t1q') = 't1' and (select letter_type from public.letter_list() where id = :'corpq') = 'corporate'
  and (select letter_type from public.letter_list() where id = '00000000-0000-0000-0000-0000000000f1') = 'proposal');
select test.check('the badge counts every waiting letter, outside Studio too', public.letters_waiting_count() = 4);

set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('T1 only: the list shows T1 letters only', (select array_agg(distinct letter_type) from public.letter_list()) = array['t1']);
select test.check('T1 only: the badge counts T1 letters only', public.letters_waiting_count() = 1);
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b"}';
select test.check('Staff (both boxes, Pricing view): corporate, T1 and proposals',
  (select count(*) from public.letter_list()) = 5);
reset role;
update public.role_permissions set level = 'none' where area_key = 'pricing' and role_id = (select id from public.roles where name = 'Staff');
set role authenticated;
select test.check('without Pricing, proposals do not show', not exists (select 1 from public.letter_list() where letter_type = 'proposal') and (select count(*) from public.letter_list()) = 4);

-- ---------- The first-time ticks run once
reset role;
reset request.jwt.claims;
update public.roles set can_t1_letters = false, can_corporate_letters = false where name = 'Staff';
\i supabase/migrations/20261208000000_round19_front_office.sql
select test.check('running the migration again does not tick a box an owner cleared', (select not can_t1_letters and not can_corporate_letters from public.roles where name = 'Staff'));

-- ---------- Deadlines: mark done before a date, undo the batch the same day, reopen a line
\set items '''[{"client_id":"00000000-0000-0000-0000-0000000000c1","year_end":"2025-12-31","kind":"filing"},{"client_id":"00000000-0000-0000-0000-0000000000c1","year_end":"2025-12-31","kind":"balance"},{"client_id":"00000000-0000-0000-0000-0000000000c2","year_end":"2025-12-31","kind":"filing"}]'''
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('only an owner marks done in one step', test.try(format($q$select public.deadlines_mark_done_before('2026-11-01', 'Filed before Studio', %L)$q$, :items)) like 'Only an owner%');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('the reason is required', test.try(format($q$select public.deadlines_mark_done_before('2026-11-01', ' ', %L)$q$, :items)) like 'Give the reason%');
select test.check('an unknown deadline type is refused', test.try($q$select public.deadlines_mark_done_before('2026-11-01', 'Filed before Studio', '[{"client_id":"00000000-0000-0000-0000-0000000000c1","year_end":"2025-12-31","kind":"gst"}]')$q$) like 'A deadline in the list is not valid%');
select public.deadlines_mark_done_before('2026-11-01', 'Filed before Studio', :items) as r \gset
select test.check('three marked done with the reason and one batch', (:'r'::jsonb ->> 'count')::int = 3
  and (select count(*) = 3 and count(distinct batch_id) = 1 and bool_and(reason = 'Filed before Studio' and source = 'batch' and done_by = '00000000-0000-0000-0000-00000000000a') from public.t2_deadline_done));
select test.check('the batch is logged with its date and reason', exists (select 1 from public.activity_log where action = 'deadlines_marked_done_before' and entity_id::text = :'r'::jsonb ->> 'batch_id' and details ->> 'before' = '2026-11-01' and details ->> 'reason' = 'Filed before Studio'));
select test.check('marking again skips what is already done', (public.deadlines_mark_done_before('2026-11-01', 'Again', :items) ->> 'count')::int = 0);
select test.check('the batch is undone in one step the same day', public.deadlines_undo_batch((:'r'::jsonb ->> 'batch_id')::uuid) = 3);
select test.check('nothing is left done', not exists (select 1 from public.t2_deadline_done));
select test.check('undoing twice says so', test.try(format($q$select public.deadlines_undo_batch(%L)$q$, :'r'::jsonb ->> 'batch_id')) like 'That batch is already undone%');
select public.deadlines_mark_done_before('2026-11-01', 'Filed before Studio', :items) as r2 \gset
reset role;
update public.t2_deadline_done set done_at = done_at - interval '1 day';
set role authenticated;
select test.check('after that day the batch is not undone in one step', test.try(format($q$select public.deadlines_undo_batch(%L)$q$, :'r2'::jsonb ->> 'batch_id')) like 'A batch can be undone in one step only on the day%');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('a client editor reopens one line', test.try($q$delete from public.t2_deadline_done where client_id = '00000000-0000-0000-0000-0000000000c2'$q$) = 'OK');
select test.check('two lines left', (select count(*) from public.t2_deadline_done) = 2);
reset role;
select test.check('the reopened line is logged with its reason', exists (select 1 from public.activity_log where entity_type = 't2_deadline_done' and action ilike '%delete%' and details::text like '%Filed before Studio%'));
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b"}';
select test.try($q$delete from public.t2_deadline_done$q$);
select test.check('a client viewer cannot reopen', (select count(*) from public.t2_deadline_done) = 2);

-- ---------- The EFILE number marks the T2 filing deadline done
reset role;
reset request.jwt.claims;
insert into public.clients (id, kind, legal_name, province) values ('00000000-0000-0000-0000-0000000000c5', 'corporation', 'Birch Dummy Realty Inc.', 'ON');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_create_file('00000000-0000-0000-0000-0000000000c5', '2026-03-31', '2025-04-01', '', 'full', 'client_software', '00000000-0000-0000-0000-00000000000c'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid) as f \gset
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_save_filing_record(:'f', null, '');
select test.check('no EFILE number: the deadline stays open', not exists (select 1 from public.t2_deadline_done where client_id = '00000000-0000-0000-0000-0000000000c5'));
select public.cb_save_filing_record(:'f', null, 'efa12345');
select test.check('the EFILE number marks the T2 filing deadline done, with the reason',
  (select kind = 'filing' and year_end = '2026-03-31' and source = 'efile' and reason = 'EFILE confirmation EFA12345 recorded in Closebook' and done_by = '00000000-0000-0000-0000-00000000000c'
     from public.t2_deadline_done where client_id = '00000000-0000-0000-0000-0000000000c5'));
select test.check('the balance-due deadline is not touched', not exists (select 1 from public.t2_deadline_done where client_id = '00000000-0000-0000-0000-0000000000c5' and kind = 'balance'));
select public.cb_save_filing_record(:'f', null, '');
select test.check('clearing the number reopens nothing', exists (select 1 from public.t2_deadline_done where client_id = '00000000-0000-0000-0000-0000000000c5'));
reset role;
reset request.jwt.claims;
