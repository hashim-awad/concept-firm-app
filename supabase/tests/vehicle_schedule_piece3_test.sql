-- Local tests: piece 3 of the step 5 restructure (Hashim, Nov 18, 2026): an entry made from the Vehicle schedule.
-- The schedule is saved with its entry and put in again on the same entry; its amounts are locked in the database
-- (cb_add_entry, cb_edit_entry, Reclassify); its accounts can change; "Claim the ITC" changes only by the reviewer or
-- an owner; it goes to the reviewer like a typed entry; deleting the entry deletes the schedule; History has each
-- event. The figures are T4's (allowance 8,300.00, company fuel 450.00); they are worked out by the app
-- (tests/closebook-vehicle-schedule.test.ts). Dummy data only.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'), ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
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
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test', (select id from public.roles where name = 'Accountant'));
reset role;
update public.role_permissions set level = 'edit' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Accountant');
\set C '''00000000-0000-0000-0000-00000000000c'''
\set A '''00000000-0000-0000-0000-00000000000a'''
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
insert into public.clients (kind, legal_name, province) values ('corporation', 'Birch Dummy Schedule Inc.', 'ON') returning id as client \gset
select public.cb_create_file(:'client', '2026-08-31', '2025-09-01', '', 'full', 'statements', :C::uuid, :A::uuid) as f \gset

-- T4's lines: the allowance (with its ITC) and the company-paid fuel moved to the shareholder.
\set lines '''[{"chart":"70600","amount":7345.13,"memo":"Per-km allowance","tax_code":"HST_ON","schedule_part":"allowance"},{"chart":"21500","amount":954.87,"is_tax":true,"schedule_part":"allowance_itc"},{"chart":"23000","amount":-8300,"schedule_part":"allowance_due"},{"chart":"23000","amount":450,"schedule_part":"company_due"},{"chart":"70600","amount":-398.22,"tax_code":"HST_ON","schedule_part":"company_cost:a"},{"chart":"21500","amount":-51.78,"is_tax":true,"schedule_part":"company_gst"}]'''
\set sched '''{"kind":"vehicle","method":"prorated","choice":"higher","itc":true,"inputs":{"businessKm":12000,"totalKm":20000},"snapshot":{"province":"ON"},"result":{"allowance":830000},"summary":"Per-km allowance 8,300.00 used","lines":[{"schedule_part":"allowance","amount":7345.13},{"schedule_part":"allowance_itc","amount":954.87,"is_tax":true},{"schedule_part":"allowance_due","amount":-8300},{"schedule_part":"company_due","amount":450},{"schedule_part":"company_cost:a","amount":-398.22},{"schedule_part":"company_gst","amount":-51.78,"is_tax":true}]}'''

-- A tagged line cannot be typed in a normal entry.
select test.check('lock: cb_add_entry refuses a line tagged as a schedule amount',
  test.try(format($q$select public.cb_add_entry(%L, 'AJE', 'correction', 'Typed car entry', false, %L, 'Vehicle schedule')$q$, :'f', :lines)) = 'Change this amount in its schedule: click the Schedule tag.');
select test.check('lock: the schedule must hold the amounts the entry posts',
  test.try(format($q$select public.cb_save_schedule_entry(%L, null, 'AJE', 'correction', 'Vehicle, owner''s car', false, %L, 'Vehicle schedule', null, '{}', null, %L)$q$,
    :'f', replace(:lines, '7345.13', '7345.14'), :sched)) = 'Change this amount in its schedule: click the Schedule tag.');

-- T4: the preparer puts the schedule in a new entry.
select public.cb_save_schedule_entry(:'f', null, 'AJE', 'correction', 'Vehicle, owner''s car', false, :lines, 'Vehicle schedule', null, '{}', null, :sched) as e \gset
select test.check('T4: the entry is an AJE at year end, origin schedule, W/P ref Vehicle schedule',
  (select kind = 'AJE' and origin = 'schedule' and entry_date = '2026-08-31' and wp_ref = 'Vehicle schedule' and note = 'Vehicle, owner''s car' from public.cb_entries where id = :'e'));
select test.check('T4: six lines, each tagged with its part, debits 8,750.00',
  (select count(*) = 6 and count(schedule_part) = 6 and sum(amount) filter (where amount > 0) = 8750 from public.cb_entry_lines where entry_id = :'e'));
select test.check('T4: 23000 net credit 7,850.00; 70600 net 6,946.91 on the entry (with 398.22 in the books: 7,345.13)',
  (select sum(l.amount) from public.cb_entry_lines l join public.cb_accounts a on a.id = l.account_id where l.entry_id = :'e' and a.number = '23000') = -7850
  and (select sum(l.amount) from public.cb_entry_lines l join public.cb_accounts a on a.id = l.account_id where l.entry_id = :'e' and a.number = '70600') = 6946.91);
select test.check('T4: one schedule with the entry, its inputs kept', (select count(*) = 1 and min(inputs ->> 'businessKm') = '12000' and bool_and(itc_claim) from public.cb_schedules where entry_id = :'e'));
select test.check('T4: it goes to the reviewer like a typed entry', (select needs_review and reviewed_at is null from public.cb_entries where id = :'e'));
select test.check('T4: staff can read the schedule', (select count(*) from public.cb_schedules where file_id = :'f') = 1);

-- T10 (CB2-0 review round): no lock. Edit changes a schedule amount on the entry; the account and the description can change.
-- An entry that no longer balances is still refused (the kept hard stop).
select test.check('T10: Edit with only the owed line changed is refused as unbalanced',
  test.try(format($q$select public.cb_edit_entry(%L, 'AJE', 'correction', 'Vehicle, owner''s car', false, %L, 'Vehicle schedule')$q$, :'e', replace(:lines, '8300', '8000'))) = 'The entry does not balance: it is out by 300.00.');
select test.check('T10: Edit changes a schedule amount when the entry balances (rolled back here)',
  test.try_rollback(format($q$select public.cb_edit_entry(%L, 'AJE', 'correction', 'Vehicle, owner''s car', false, %L, 'Vehicle schedule')$q$, :'e',
    replace(replace(:lines, '7345.13', '7045.13'), '-8300', '-8000'))) = 'OK');
select test.check('T10: a schedule line taken out leaves the entry unbalanced: refused by the hard stop',
  test.try(format($q$select public.cb_edit_entry(%L, 'AJE', 'correction', 'Vehicle, owner''s car', false, %L, 'Vehicle schedule')$q$, :'e',
    (select jsonb_agg(x) from jsonb_array_elements(:lines::jsonb) x where x ->> 'schedule_part' <> 'company_gst')::text)) = 'The entry does not balance: it is out by 51.78.');
-- The account of the allowance line changed to 70650, and a normal line added; the same schedule amounts.
\set lines2 '''[{"chart":"70650","amount":7345.13,"tax_code":"HST_ON","schedule_part":"allowance"},{"chart":"21500","amount":954.87,"is_tax":true,"schedule_part":"allowance_itc"},{"chart":"23000","amount":-8300,"schedule_part":"allowance_due"},{"chart":"23000","amount":450,"schedule_part":"company_due"},{"chart":"70600","amount":-398.22,"tax_code":"HST_ON","schedule_part":"company_cost:a"},{"chart":"21500","amount":-51.78,"is_tax":true,"schedule_part":"company_gst"},{"chart":"64000","amount":10},{"chart":"21100","amount":-10}]'''
select public.cb_save_schedule_entry(:'f', :'e', 'AJE', 'correction', 'Vehicle, owner''s car (2026)', false, :lines2, 'Vehicle schedule', null, '{}', null, null) as e2 \gset
select test.check('T10: the account changed and a normal line was added, on the same entry', :'e2' = :'e'
  and (select a.number from public.cb_entry_lines l join public.cb_accounts a on a.id = l.account_id where l.entry_id = :'e' and l.schedule_part = 'allowance') = '70650'
  and (select count(*) from public.cb_entry_lines where entry_id = :'e') = 8);
select test.check('T10: Reclassify refuses any line of the entry, the added normal line included',
  test.try(format($q$select public.cb_reclassify(%L, %L, '67300', '')$q$, :'f',
    jsonb_build_array(jsonb_build_object('kind', 'entry', 'id', (select id from public.cb_entry_lines where entry_id = :'e' and schedule_part is null and amount > 0)))::text))
  like '%comes from a working paper: change it there. Nothing was changed.');

-- T12: "Claim the ITC". CB2-0: anyone with Edit can untick it (the preparer's try is rolled back here); the reviewer unticks it below.
\set unticked '''{"kind":"vehicle","method":"prorated","choice":"higher","itc":false,"inputs":{"businessKm":12000},"summary":"Per-km allowance 8,300.00 used","lines":[{"schedule_part":"allowance","amount":8300},{"schedule_part":"allowance_due","amount":-8300}],"changes":[{"what":"Total km in the year","old":"20,000","new":"empty"}]}'''
\set ulines '''[{"chart":"70600","amount":8300,"schedule_part":"allowance"},{"chart":"23000","amount":-8300,"schedule_part":"allowance_due"}]'''
select test.check('T12: the preparer can change Claim the ITC (CB2-0: anyone with Edit)',
  test.try_rollback(format($q$select public.cb_save_schedule_entry(%L, %L, 'AJE', 'correction', 'Vehicle, owner''s car', false, %L, 'Vehicle schedule', null, '{}', null, %L)$q$,
    :'f', :'e', :ulines, :unticked)) = 'OK');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_save_schedule_entry(:'f', :'e', 'AJE', 'correction', 'Vehicle, owner''s car', false, :ulines, 'Vehicle schedule', null, '{}', null, :unticked) as e3 \gset
select test.check('T12/T9: put in again by the reviewer: same entry, Dr 70600 8,300.00, Cr 23000 8,300.00', :'e3' = :'e'
  and (select string_agg(format('%s %s', a.number, l.amount), ', ' order by l.amount desc) from public.cb_entry_lines l join public.cb_accounts a on a.id = l.account_id where l.entry_id = :'e')
      = '70600 8300.00, 23000 -8300.00'
  and (select count(*) from public.cb_entries where file_id = :'f') = 1);
select test.check('T12: the schedule keeps the new inputs and the unticked ITC', (select not itc_claim and inputs ->> 'totalKm' is null from public.cb_schedules where entry_id = :'e'));
select test.check('T12: put in again, it goes to the reviewer again', (select needs_review from public.cb_entries where id = :'e'));
-- Print.
select public.cb_schedule_printed((select id from public.cb_schedules where entry_id = :'e'));
reset role;

select test.check('History: one row per save (CB2-0 v7 item 8): created, saved (input changed), saved (ITC unticked), printed',
  (select string_agg(action, ',' order by id) from public.cb_file_history where file_id = :'f' and action like 'schedule%')
  = 'schedule_created,schedule_saved,schedule_saved,schedule_printed');
select test.check('History: the ITC save names who (the reviewer) with old and new',
  exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'schedule_saved' and actor_id = '00000000-0000-0000-0000-00000000000a'
          and old_value like '%Claim the ITC: Ticked%' and new_value like '%Claim the ITC: Unticked%' and ref_label = '2026-001 AJE'));
select test.check('History: the input change has old and new', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'schedule_saved'
  and old_value like '%Total km in the year: 20,000%' and new_value like '%Total km in the year: empty%'));

-- T11: deleting the entry deletes the schedule; History records it.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_delete_entry(:'e');
reset role;
select test.check('T11: the entry and its schedule are gone', not exists (select 1 from public.cb_entries where id = :'e') and not exists (select 1 from public.cb_schedules where entry_id = :'e'));
select test.check('T11: History has the entry deleted with its schedule',
  exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'schedule_deleted' and detail = 'Entry 2026-001 AJE deleted with its Vehicle schedule'));

-- Two cars: two entries, each with its own schedule.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_save_schedule_entry(:'f', null, 'AJE', 'correction', 'Vehicle, owner''s car', false, :lines, 'Vehicle schedule', null, '{}', null, :sched) as car1 \gset
select public.cb_save_schedule_entry(:'f', null, 'AJE', 'correction', 'Vehicle, second car', false, :ulines, 'Vehicle schedule', null, '{}', null,
  replace(:unticked, '"itc":false', '"itc":true')::jsonb) as car2 \gset
select test.check('two cars: two entries, two schedules', :'car1' <> :'car2' and (select count(*) from public.cb_schedules where file_id = :'f') = 2);
select test.check('a normal entry cannot be saved as a schedule entry',
  test.try(format($q$select public.cb_save_schedule_entry(%L, %L, 'AJE', 'correction', 'x car', false, %L, 'Vehicle schedule', null, '{}', null, null)$q$, :'f',
    public.cb_add_entry(:'f', 'AJE', 'correction', 'Typed entry', false, '[{"chart":"64000","amount":5},{"chart":"21100","amount":-5}]', 'Invoice'), :ulines)) = 'Entry not found.');
select test.check('staff cannot write the schedules table directly', test.try($q$update public.cb_schedules set itc_claim = false$q$) like '%permission denied%');
reset role;
-- Expenses paid personally and revenue check origins still allowed.
select test.check('the three origins are allowed', test.try($q$update public.cb_entries set origin = 'expenses_personal' where false$q$) = 'OK');
