-- Local tests: piece R3a-1 (Hashim, Nov 19, 2026): no Owner role; roles are titles; Admin is Edit on Staff accounts and
-- Settings and at least one active person keeps it; Closebook switches; every owner check is a specific right. Dummy data only.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'partner.a@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'manager.b@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'accountant.c@example.test'),
  ('00000000-0000-0000-0000-00000000000d', 'senior.d@example.test'),
  ('00000000-0000-0000-0000-00000000000f', 'desk.f@example.test'),
  ('00000000-0000-0000-0000-00000000000e', 'office.e@example.test');
select private.bootstrap_owner('partner.a@example.test', 'Test Partner A');
\set A '\'00000000-0000-0000-0000-00000000000a\''
\set C '\'00000000-0000-0000-0000-00000000000c\''
\set D '\'00000000-0000-0000-0000-00000000000d\''
\set as_a 'set role authenticated; set request.jwt.claims = \'{"sub":"00000000-0000-0000-0000-00000000000a"}\''
\set as_b 'set role authenticated; set request.jwt.claims = \'{"sub":"00000000-0000-0000-0000-00000000000b"}\''
\set as_c 'set role authenticated; set request.jwt.claims = \'{"sub":"00000000-0000-0000-0000-00000000000c"}\''
\set as_d 'set role authenticated; set request.jwt.claims = \'{"sub":"00000000-0000-0000-0000-00000000000d"}\''
\set as_e 'set role authenticated; set request.jwt.claims = \'{"sub":"00000000-0000-0000-0000-00000000000e"}\''
\set as_f 'set role authenticated; set request.jwt.claims = \'{"sub":"00000000-0000-0000-0000-00000000000f"}\''
\set out 'reset role; reset request.jwt.claims'

-- 1. The titles and their starting rights.
select test.check('the four titles, no Owner role', (select string_agg(name, ',' order by name) from public.roles) = 'Accountant,Manager,Partner,Senior accountant'
  and not exists (select 1 from public.roles where is_owner));
select test.check('starting switches: Partner all; Manager and Senior Prepare and Review; Accountant Prepare',
  (select string_agg(name || ':' || cb_prepare::int || cb_review::int || cb_partner::int || cb_lock::int || cb_remove_signoffs::int || can_final_letters::int, ',' order by name) from public.roles)
  = 'Accountant:100000,Manager:110000,Partner:111111,Senior accountant:110000');
select test.check('Closebook Edit on all four; Exports only on Partner; Admin only on Partner',
  (select bool_and(level = 'edit') from public.role_permissions where area_key = 'closebook')
  and (select string_agg(r.name, ',') from public.role_permissions rp join public.roles r on r.id = rp.role_id where rp.area_key = 'exports' and rp.level <> 'none') = 'Partner'
  and (select string_agg(r.name, ',') from public.roles r where private.role_is_admin(r.id)) = 'Partner');
select test.check('no function or policy checks is_owner any more',
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private') and p.prokind = 'f'
    and p.proname <> 'is_owner' and pg_get_functiondef(p.oid) ~ 'private\.is_owner\(')
  and not exists (select 1 from pg_policies where coalesce(qual, '') || coalesce(with_check, '') ~ 'is_owner'));
select test.check('is_owner() is a trap that refuses', not private.is_owner());

:as_a;
select public.add_staff('00000000-0000-0000-0000-00000000000b', 'Test Manager B', 'manager.b@example.test', (select id from public.roles where name = 'Manager'));
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Accountant C', 'accountant.c@example.test', (select id from public.roles where name = 'Accountant'));
select public.add_staff('00000000-0000-0000-0000-00000000000d', 'Test Senior D', 'senior.d@example.test', (select id from public.roles where name = 'Senior accountant'));
select test.check('my_access: the Partner is Admin with every switch and Final letters',
  (public.my_access() ->> 'admin')::boolean and (public.my_access() -> 'letters' ->> 'final')::boolean
  and public.my_access() -> 'closebook' = '{"lock": true, "review": true, "partner": true, "prepare": true, "remove_signoffs": true}');
-- A new role starts with Closebook Edit and Prepare (decision 12A).
select public.create_role('Front desk', 'Takes calls.') as fd \gset
select test.check('a new role starts with Closebook Edit and Prepare only',
  (select level from public.role_permissions where role_id = :'fd' and area_key = 'closebook') = 'edit'
  and (select cb_prepare and not cb_review and not cb_lock and not can_final_letters from public.roles where id = :'fd'));
select public.save_role(:'fd', 'Front desk', 'Takes calls.', '{}'::jsonb, '{}'::jsonb, '{"prepare": false}'::jsonb);
select public.add_staff('00000000-0000-0000-0000-00000000000f', 'Test Desk F', 'desk.f@example.test', :'fd');
-- An office admin: Admin, but no Lock, no Exports.
select public.create_role('Office admin', 'Runs the office.') as oa \gset
select public.save_role(:'oa', 'Office admin', 'Runs the office.', '{"staff_accounts": "edit", "settings": "edit", "clients": "edit"}'::jsonb, '{}'::jsonb, '{}'::jsonb);
select public.add_staff('00000000-0000-0000-0000-00000000000e', 'Test Office E', 'office.e@example.test', :'oa');
select test.check('History records a saved role', exists (select 1 from public.activity_log where action = 'role_saved' and entity_id::text = :'oa'));

-- 2. Nobody gives more than they hold, or raises their own role.
:as_e;
select test.check('an Admin cannot give a switch they do not hold', test.try(format($q$select public.save_role(%L, 'Front desk', '', '{}', '{}', '{"lock": true}')$q$, :'fd'))
  = 'You can only give a right you have yourself.');
select test.check('an Admin cannot give an area level they do not hold', test.try(format($q$select public.save_role(%L, 'Front desk', '', '{"exports": "edit"}', '{}', '{}')$q$, :'fd'))
  = 'You can only give a level you have yourself.');
select test.check('an Admin cannot raise their own role', test.try(format($q$select public.save_role(%L, 'Office admin', '', '{"pricing": "edit"}', '{}', '{}')$q$, :'oa'))
  = 'You can only give a level you have yourself.');
select test.check('an Admin cannot touch a role with more access than theirs', test.try(format($q$select public.update_role(%L, 'Partner', 'x')$q$, (select id from public.roles where name = 'Partner')))
  = 'You cannot change a role with more access than you.');
-- Security review, finding 1: the lesser Admin cannot strip the Partner role through any save path.
select test.check('a lesser Admin cannot save the Partner role (save_role)', test.try(format($q$select public.save_role(%L, 'Partner', 'x', '{"settings": "none"}', '{}', '{"lock": false}')$q$, (select id from public.roles where name = 'Partner')))
  = 'You cannot change a role with more access than you.');
select test.check('nor through set_role_permissions or set_role_letters',
  test.try(format($q$select public.set_role_permissions(%L, '{"settings": "none"}')$q$, (select id from public.roles where name = 'Partner'))) = 'You cannot change a role with more access than you.'
  and test.try(format($q$select public.set_role_letters(%L, false, false)$q$, (select id from public.roles where name = 'Partner'))) = 'You cannot change a role with more access than you.');
select test.check('the full export needs Admin and Exports Edit', test.try('select public.export_tables()') like 'Only an Admin%');
:as_b;
select test.check('someone without Admin cannot save a role', test.try(format($q$select public.save_role(%L, 'Front desk', '', '{}', '{}', '{}')$q$, :'fd')) = 'Only an Admin can change roles.');
select test.check('a Manager cannot issue a Final letter',
  test.try($q$select public.create_letter_quote('00000000-0000-0000-0000-0000000000c1', 'X', 'Dummy Dental PC', '{}', '[]')$q$) like 'You need "Can issue Final and send for signing"%');

-- 3. The safety rule: at least one active person keeps Admin.
:out;
select test.check('the last Admin cannot be switched off, even from the SQL editor', test.try($q$
  update public.staff set is_active = false where id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000e');
  set constraints all immediate$q$) like 'Not saved. At least one active person must keep Edit on Staff accounts and Settings%');
:as_a;
select test.check('with another Admin active, lowering the Partner role is allowed', test.try(format($q$select public.save_role(%L, 'Partner', 'x', '{"exports": "view"}', '{}', '{}'); set constraints all immediate$q$,
  (select id from public.roles where name = 'Partner'))) = 'OK');
select test.check('...and once lowered, one''s own role cannot be raised again', test.try(format($q$select public.save_role(%L, 'Partner', 'x', '{"exports": "edit"}', '{}', '{}')$q$,
  (select id from public.roles where name = 'Partner'))) = 'You can only give a level you have yourself.');
:out;
update public.role_permissions set level = 'edit' where area_key = 'exports' and role_id = (select id from public.roles where name = 'Partner');
:as_e;
select test.check('one Admin may lower another Admin role while an Admin remains', test.try(format($q$select public.save_role(%L, 'Office admin', '', '{"settings": "view"}', '{}', '{}'); set constraints all immediate$q$, :'oa')) = 'OK');
:as_a;
select test.check('the last Admin role cannot lose Staff accounts', test.try(format($q$select public.save_role(%L, 'Partner', '', '{"staff_accounts": "view"}', '{}', '{}'); set constraints all immediate$q$,
  (select id from public.roles where name = 'Partner'))) like 'Not saved. At least one active person must keep%');

-- 4. Closebook switches.
:out;
insert into public.clients (kind, legal_name, province) values ('corporation', 'Spruce Dummy Realty Inc.', 'ON') returning id as client \gset
:as_a;
select test.check('the reviewer needs the Review right', test.try(format($q$select public.cb_create_file(%L, '2026-12-31', '2026-01-01', '', 'full', 'client_software', %L, %L)$q$, :'client', :C, :C))
  = 'The reviewer needs the Review right (Settings, Team and roles).');
select test.check('the preparer needs the Prepare right', test.try(format($q$select public.cb_create_file(%L, '2026-12-31', '2026-01-01', '', 'full', 'client_software', %L, %L)$q$,
  :'client', '00000000-0000-0000-0000-00000000000f', :D)) = 'The preparer needs Closebook Edit and the Prepare right (Settings, Team and roles).');
select public.cb_create_file(:'client', '2026-12-31', '2026-01-01', '', 'full', 'client_software', :C, :D) as f \gset
:as_c;
select public.cb_save_setup(:'f', '{"realtor":true,"owner_paid":false,"dividends":false,"payroll":false,"holdco":false,"gst_registered":false}');
select public.cb_save_acceptance(:'f', '{"q1":"yes","q2":"yes","q3":"yes","q4":"yes","q5":"yes","q5_note":"","q9":"yes"}'::jsonb);
select public.cb_acceptance_confirm_client(:'f');
:as_f;
select test.check('without Prepare, no preparer sign-off', test.try(format($q$select public.cb_sign_step(%L, 'setup', 'prepared')$q$, :'f')) = 'You need the Prepare right to sign as preparer.');
:as_c;
select public.cb_sign_step(:'f', 'setup', 'prepared');
select test.check('an Accountant cannot sign as reviewer', test.try(format($q$select public.cb_sign_step(%L, 'setup', 'reviewed')$q$, :'f')) = 'You need the Review right to sign as reviewer.');
select test.check('an Accountant reads file History (CB2-0 v7: everyone who can open the file)', (select count(*) from public.cb_file_history where file_id = :'f') > 0);
:as_d;
select test.check('a Senior accountant reads file History (Review)', (select count(*) from public.cb_file_history where file_id = :'f') > 0);
:as_b;
select test.check('a Manager cannot take back someone else''s sign-off', test.try(format($q$select public.cb_unsign_step(%L, 'setup', 'prepared')$q$, :'f'))
  = 'There is no preparer sign-off of yours to take back.');
select test.check('a Manager cannot lock a file', test.try(format($q$select public.cb_lock_file(%L)$q$, :'f')) = 'You need the Lock and unlock right to lock a file.');
:as_a;
select public.cb_unsign_step(:'f', 'setup', 'prepared');
select test.check('Remove others'' sign-offs takes back a preparer sign-off, logged with the name (6B)',
  not exists (select 1 from public.cb_step_signoffs where file_id = :'f' and step = 'setup')
  and exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'unsigned_prepared' and detail = 'Removed the preparer sign-off of Test Accountant C'));

-- 5. An engagement changed straight through the Data API needs Admin and Documents Edit (15A).
:out;
insert into public.engagements (client_id, type, title, status) values (:'client', 'T2 only', 'Spruce FYE 2026', 'EL sent') returning id as eng \gset
:as_c;
select test.check('an Accountant cannot change an engagement directly', test.try(format($q$update public.engagements set status = 'On hold' where id = %L$q$, :'eng'))
  = 'Only an Admin with Edit on Documents can update an engagement.');
:as_a;
select test.check('the Partner can', test.try(format($q$update public.engagements set status = 'On hold' where id = %L$q$, :'eng')) = 'OK');
:out;
:as_c;
select test.check('an Accountant cannot add an engagement directly (security review, finding 3)',
  test.try(format($q$insert into public.engagements (client_id, type, title, status) values (%L, 'T2 only', 'Spruce FYE 2027', 'EL signed')$q$, :'client'))
  = 'Only an Admin with Edit on Documents can add an engagement.');
:out;

-- 6. A Closebook switch works only on a role with Closebook Edit (security review, finding 2).
:as_a;
select public.create_role('Reader', 'Reads files.') as rd \gset
select public.save_role(:'rd', 'Reader', 'Reads files.', '{"closebook": "view"}'::jsonb, '{}'::jsonb, '{"review": true, "lock": true}'::jsonb);
:out;
select test.check('Review and Lock switched on without Closebook Edit do nothing',
  (select cb_review and cb_lock from public.roles where id = :'rd')
  and not private.role_switch(:'rd', 'review') and not private.role_switch(:'rd', 'lock'));

-- 7. Running the migration again changes nothing (security review, finding 5).
select count(*) as conv from public.activity_log where action = 'roles_converted' \gset
select string_agg(r.name || ':' || rp.area_key || '=' || rp.level, ',' order by r.name, rp.area_key) as lv
  from public.role_permissions rp join public.roles r on r.id = rp.role_id \gset
\i supabase/migrations/20261212380000_piece_r3a1_roles_rights.sql
select test.check('a second run adds no History row and changes no level',
  (select count(*) from public.activity_log where action = 'roles_converted') = :conv
  and (select string_agg(r.name || ':' || rp.area_key || '=' || rp.level, ',' order by r.name, rp.area_key)
         from public.role_permissions rp join public.roles r on r.id = rp.role_id) = :'lv');
