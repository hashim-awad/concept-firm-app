-- Local tests for staff, roles and permissions. Run on a plain Postgres after local_shim.sql
-- and all migrations. Every check prints PASS or raises an error.
\set ON_ERROR_STOP 1
create schema test;
grant usage on schema test to authenticated, anon;

-- Runs a statement as the current role and returns the error message, or 'OK'.
create function test.try(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlerrm;
end $$;
grant execute on function test.try(text) to authenticated, anon;

create function test.check(p_label text, p_ok boolean) returns text language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL: %', p_label; end if;
  return 'PASS: ' || p_label;
end $$;
grant execute on function test.check(text, boolean) to authenticated, anon;

-- Dummy logins (not real people).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'reviewer.b@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test'),
  ('00000000-0000-0000-0000-00000000000d', 'owner.d@example.test'),
  ('00000000-0000-0000-0000-00000000000e', 'new.e@example.test');

select test.check('RLS on for every public table',
  not exists (select 1 from pg_tables where schemaname = 'public' and not rowsecurity));

-- Bootstrap
select private.bootstrap_owner('Owner.A@example.test', 'Test Owner A');
select test.check('second bootstrap refused',
  test.try($$select private.bootstrap_owner('owner.d@example.test', 'D')$$) like 'An owner already exists%');

-- Anonymous visitor sees nothing and cannot call actions
set role anon;
select test.check('anon cannot read staff', test.try('select * from public.staff') like 'permission denied%');
select test.check('anon cannot call my_access', test.try('select public.my_access()') like 'permission denied%');
reset role;

-- Owner A
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('owner sees edit on everything',
  (select bool_and(value = '"edit"') from jsonb_each(public.my_access() -> 'permissions')));
select test.check('owner creates role', test.try($$select public.create_role('Reviewer', 'Test role')$$) = 'OK');
select test.check('owner sets permissions', test.try($$select public.set_role_permissions(
  (select id from public.roles where name = 'Reviewer'),
  '{"leads":"edit","staff_accounts":"edit","settings":"view"}')$$) = 'OK');
select test.check('owner cannot change Owner role permissions', test.try($$select public.set_role_permissions(
  (select id from public.roles where is_owner), '{"leads":"none"}')$$) like '%locked%');
select test.check('owner cannot rename Owner role', test.try($$select public.update_role(
  (select id from public.roles where is_owner), 'Boss', '')$$) like '%locked%');
select test.check('owner cannot delete Owner role', test.try($$select public.delete_role(
  (select id from public.roles where is_owner))$$) like '%still assigned%' );
select test.check('add B as Reviewer', test.try($$select public.add_staff('00000000-0000-0000-0000-00000000000b',
  'Test Reviewer B', 'reviewer.b@example.test', (select id from public.roles where name = 'Reviewer'))$$) = 'OK');
select test.check('add C as Staff', test.try($$select public.add_staff('00000000-0000-0000-0000-00000000000c',
  'Test Staff C', 'staff.c@example.test', (select id from public.roles where name = 'Staff'))$$) = 'OK');
select test.check('add D as Owner', test.try($$select public.add_staff('00000000-0000-0000-0000-00000000000d',
  'Test Owner D', 'owner.d@example.test', (select id from public.roles where is_owner))$$) = 'OK');
select test.check('add_staff refuses wrong email', test.try($$select public.add_staff('00000000-0000-0000-0000-00000000000e',
  'E', 'someone.else@example.test', (select id from public.roles where name = 'Staff'))$$) like 'Login not found%');
select test.check('owner cannot change own role', test.try($$select public.set_staff_role(
  '00000000-0000-0000-0000-00000000000a', (select id from public.roles where name = 'Staff'))$$) like '%your own role%');
select test.check('owner cannot switch self off', test.try($$select public.set_staff_active(
  '00000000-0000-0000-0000-00000000000a', false)$$) like '%your own account%');
select test.check('rotate needs 2 people', test.try($$select public.update_setting('lead_assignment',
  '{"mode":"rotate","staff_ids":["00000000-0000-0000-0000-00000000000b"]}')$$) like 'Choose one person%');
select test.check('rotate with 2 people', test.try($$select public.update_setting('lead_assignment',
  '{"mode":"rotate","staff_ids":["00000000-0000-0000-0000-00000000000b","00000000-0000-0000-0000-00000000000c"]}')$$) = 'OK');
select test.check('retention 0 refused', test.try($$select public.update_setting('retention_months', '0')$$) like 'Retention must%');
select test.check('retention 2.5 refused', test.try($$select public.update_setting('retention_months', '2.5')$$) like 'Retention must%');
select test.check('retention 36 ok', test.try($$select public.update_setting('retention_months', '36')$$) = 'OK');
select test.check('owner reads activity log', (select count(*) from public.activity_log) > 0);
select test.check('activity log cannot be deleted', test.try('delete from public.activity_log') like 'permission denied%');
select test.check('tables are read-only to the app', test.try($$update public.staff set full_name = 'x'$$) like 'permission denied%');

-- Non-owner B with Staff accounts: edit
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b"}';
select test.check('B sees staff list', (select count(*) from public.staff) = 4);
select test.check('B cannot read activity log', (select count(*) from public.activity_log) = 0);
select test.check('B reads settings (view)', (select count(*) from public.settings) = 2);
select test.check('B cannot change settings', test.try($$select public.update_setting('retention_months', '12')$$) like 'You do not have permission%');
select test.check('B cannot create roles', test.try($$select public.create_role('Sneaky')$$) like 'Only an owner%');
select test.check('B cannot change permissions', test.try($$select public.set_role_permissions(
  (select id from public.roles where name = 'Reviewer'), '{"price_book":"edit"}')$$) like 'Only an owner%');
select test.check('B cannot add an owner', test.try($$select public.add_staff('00000000-0000-0000-0000-00000000000e',
  'E', 'new.e@example.test', (select id from public.roles where is_owner))$$) like '%beyond your own access%');
select test.check('B cannot give a role beyond own access', test.try($$select public.add_staff('00000000-0000-0000-0000-00000000000e',
  'E', 'new.e@example.test', (select id from public.roles where name = 'Staff'))$$) like '%beyond your own access%');
select test.check('B can add E as Reviewer', test.try($$select public.add_staff('00000000-0000-0000-0000-00000000000e',
  'Test New E', 'new.e@example.test', (select id from public.roles where name = 'Reviewer'))$$) = 'OK');
select test.check('B cannot change an owner', test.try($$select public.set_staff_role(
  '00000000-0000-0000-0000-00000000000a', (select id from public.roles where name = 'Reviewer'))$$) like '%more access than you%');
select test.check('B cannot switch off an owner', test.try($$select public.set_staff_active(
  '00000000-0000-0000-0000-00000000000d', false)$$) like '%more access than you%');
select test.check('B cannot change own role', test.try($$select public.set_staff_role(
  '00000000-0000-0000-0000-00000000000b', (select id from public.roles where name = 'Staff'))$$) like '%your own role%');
select test.check('B can switch off E', test.try($$select public.set_staff_active('00000000-0000-0000-0000-00000000000e', false)$$) = 'OK');
select test.check('B can rename self', test.try($$select public.update_staff_name('00000000-0000-0000-0000-00000000000b', 'Test Reviewer Bee')$$) = 'OK');

-- Switched-off E sees nothing
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000e"}';
select test.check('inactive staff: no access', public.my_access() is null);
select test.check('inactive staff: sees only own row', (select count(*) from public.staff) = 1);
select test.check('inactive staff: no roles', (select count(*) from public.roles) = 0);

-- Owner D demotes A, then nobody can remove the last owner
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000d"}';
select test.check('owner D demotes A', test.try($$select public.set_staff_role(
  '00000000-0000-0000-0000-00000000000a', (select id from public.roles where name = 'Staff'))$$) = 'OK');
reset role;
reset request.jwt.claims;
select test.check('last owner cannot be removed even from the SQL editor', test.try($$
  update public.staff set role_id = (select id from public.roles where name = 'Staff')
  where id = '00000000-0000-0000-0000-00000000000d'; set constraints all immediate$$) like '%at least one active owner%');
select test.check('last owner cannot be switched off', test.try($$
  update public.staff set is_active = false where id = '00000000-0000-0000-0000-00000000000d';
  set constraints all immediate$$) like '%at least one active owner%');
select test.check('activity log records actor', exists (
  select 1 from public.activity_log where actor_id = '00000000-0000-0000-0000-00000000000d' and entity_type = 'staff'));
create table public.zz_probe (id int);
select test.check('new tables get RLS automatically', (select rowsecurity from pg_tables where tablename = 'zz_probe'));
select test.check('new tables not readable by app roles', not has_table_privilege('authenticated', 'public.zz_probe', 'select')
  and not has_table_privilege('anon', 'public.zz_probe', 'select'));
drop table public.zz_probe;
