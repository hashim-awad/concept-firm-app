-- Local tests: piece S1 (Hashim, Nov 20, 2026): a saved schedule changes through its window. Saving updates the same entry
-- and number and takes back the step 5 sign-offs. Piece E1 (approved test change) retired entry approval, so the approval
-- checks are gone. Vehicle, Home office and Expenses paid personally. Dummy data only.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'), ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test', (select id from public.roles where name = 'Accountant'));
reset role;
update public.role_permissions set level = 'edit' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Accountant');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
insert into public.clients (kind, legal_name, province) values ('corporation', 'Birch Dummy Schedules Inc.', 'ON') returning id as client \gset
select public.cb_create_file(:'client', '2026-08-31', '2025-09-01', '', 'full', 'statements', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a') as f \gset

-- Three schedules, made by the preparer.
\set vlines '''[{"chart":"70600","amount":8300,"schedule_part":"allowance"},{"chart":"23000","amount":-8300,"schedule_part":"allowance_due"}]'''
\set vsched '''{"kind":"vehicle","method":"prorated","choice":"higher","itc":true,"inputs":{"businessKm":12000},"lines":[{"schedule_part":"allowance","amount":8300},{"schedule_part":"allowance_due","amount":-8300}]}'''
select public.cb_save_schedule_entry(:'f', null, 'AJE', 'correction', 'Vehicle, owner''s car', false, :vlines, 'Vehicle schedule', null, '{}', null, :vsched) as v \gset
\set hlines '''[{"chart":"65100","amount":1338.60,"schedule_part":"home"},{"chart":"23000","amount":-1338.60,"schedule_part":"home_due"}]'''
\set hsched '''{"kind":"home_office","itc":true,"inputs":{"mode":"area","homeSqft":2000,"officeSqft":200},"lines":[{"schedule_part":"home","amount":1338.60},{"schedule_part":"home_due","amount":-1338.60}]}'''
select public.cb_save_schedule_entry(:'f', null, 'AJE', 'correction', 'Home office', false, :hlines, 'Home office schedule', null, '{}', null, :hsched) as h \gset
\set xlines '''[{"chart":"62000","amount":500,"memo":"Liability policy","schedule_part":"exp_1"},{"chart":"23000","amount":-500,"schedule_part":"exp_due"}]'''
\set xsched '''{"kind":"expenses","itc":true,"inputs":{"lines":[{"acct":"chart:62000","paid":50000}]},"lines":[{"schedule_part":"exp_1","amount":500},{"schedule_part":"exp_due","amount":-500}]}'''
select public.cb_save_schedule_entry(:'f', null, 'AJE', 'correction', 'Expenses paid personally', false, :xlines, 'Expenses paid personally schedule', null, '{}', null, :xsched) as x \gset

select (select seq from public.cb_entries where id = :'v') as vseq \gset

-- S1-1 the preparer changes the vehicle schedule: same entry and number, new amount, approval taken back.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_save_schedule_entry(:'f', :'v', 'AJE', 'correction', 'Vehicle, owner''s car', false, replace(:vlines, '8300', '9100')::jsonb, 'Vehicle schedule', null, '{}', null,
  replace(replace(:vsched, '8300', '9100'), '12000', '13500')::jsonb) as v2 \gset
select test.check('S1-1: the same entry and number', :'v2' = :'v' and (select seq from public.cb_entries where id = :'v') = :vseq);
select test.check('S1-1: the new amount, Dr 70600 9,100.00', (select string_agg(format('%s %s', a.number, l.amount), ', ' order by l.amount desc) from public.cb_entry_lines l join public.cb_accounts a on a.id = l.account_id where l.entry_id = :'v') = '70600 9100.00, 23000 -9100.00');
select test.check('S1-1: the saved inputs are the new ones', (select inputs ->> 'businessKm' from public.cb_schedules where entry_id = :'v') = '13500');
select test.check('S1-1: it is on the reviewer''s list again', (select needs_review from public.cb_entries where id = :'v'));

-- S1-2 Home office and Expenses paid personally, the same.
select public.cb_save_schedule_entry(:'f', :'h', 'AJE', 'correction', 'Home office', false, replace(:hlines, '1338.60', '1400')::jsonb, 'Home office schedule', null, '{}', null, replace(:hsched, '1338.60', '1400')::jsonb) as h2 \gset
select public.cb_save_schedule_entry(:'f', :'x', 'AJE', 'correction', 'Expenses paid personally', false, replace(:xlines, '500', '650')::jsonb, 'Expenses paid personally schedule', null, '{}', null, replace(:xsched, '500', '650')::jsonb) as x2 \gset
select test.check('S1-2: Home office changed on the same entry', :'h2' = :'h'
  and (select sum(amount) filter (where amount > 0) from public.cb_entry_lines where entry_id = :'h') = 1400);
select test.check('S1-2: Expenses paid personally changed on the same entry', :'x2' = :'x'
  and (select sum(amount) filter (where amount > 0) from public.cb_entry_lines where entry_id = :'x') = 650);

-- S1-3 an amount from a schedule still changes only in its schedule.
select test.check('S1-3: a schedule amount is not changed outside its schedule',
  test.try(format($q$select public.cb_edit_entry(%L, 'AJE', 'correction', 'New words', false, %L, 'Vehicle schedule')$q$, :'v', replace(:vlines, '8300', '9900')))
  = 'Change this amount in its schedule: click the Schedule tag.');

-- S1-6 the step 5 sign-offs are taken back when the schedule changes.
reset role;
insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at, reviewed_by, reviewed_at)
values (:'f', 'entries', '00000000-0000-0000-0000-00000000000c', now(), '00000000-0000-0000-0000-00000000000a', now())
on conflict (file_id, step) do update set prepared_at = now(), reviewed_at = now();
set role authenticated;
select public.cb_save_schedule_entry(:'f', :'v', 'AJE', 'correction', 'Vehicle, owner''s car', false, replace(:vlines, '8300', '9300')::jsonb, 'Vehicle schedule', null, '{}', null, replace(:vsched, '8300', '9300')::jsonb);
reset role;
select test.check('S1-6: the step 5 sign-offs are taken back', not exists (select 1 from public.cb_step_signoffs where file_id = :'f' and step = 'entries' and (prepared_at is not null or reviewed_at is not null)));
set role authenticated;

-- S1-4 a locked file refuses it.
reset role;
update public.cb_files set phase = 'locked' where id = :'f';
set role authenticated;
select test.check('S1-4: a locked file refuses the change',
  test.try(format($q$select public.cb_save_schedule_entry(%L, %L, 'AJE', 'correction', 'Vehicle, owner''s car', false, %L, 'Vehicle schedule', null, '{}', null, %L)$q$,
    :'f', :'v', replace(:vlines, '8300', '9500'), replace(:vsched, '8300', '9500'))) like '%locked%');
reset role;
