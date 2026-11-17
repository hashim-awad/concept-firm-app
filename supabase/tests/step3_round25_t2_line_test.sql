-- Local tests: round 25 (Hashim, Nov 17, 2026), "Last year's T2 line" on each bank or card account. The prior
-- accountant put the line of credit on 2707 with the cards. Dummy data only.
\set ON_ERROR_STOP 1
create function test.sp(p uuid) returns text language sql security definer set search_path = '' as $$ select private.cb_banking31_problems(p)::text $$;
create function test.h() returns setof public.cb_file_history language sql security definer set search_path = '' as $$ select * from public.cb_file_history $$;
grant execute on function test.sp(uuid), test.h() to authenticated;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
insert into public.clients (kind, legal_name, province) values ('corporation', 'Maple Dummy Realty Inc.', 'ON') returning id as client \gset
\set A '''00000000-0000-0000-0000-00000000000a'''
select public.cb_create_file(:'client', '2026-08-31', '2025-09-01', '', 'full', 'statements', :A::uuid, :A::uuid) as f \gset
reset role;
insert into public.cb_opening_balances (file_id, code, amount) values (:'f', '1002', 512.00), (:'f', '2707', 7112.00), (:'f', '3660', -6600.00), (:'f', '3849', -6600.00);
update public.cb_files set opening_source = 'manual' where id = :'f';
set role authenticated;
select public.cb_save_bank_account(:'f', null, 'chequing', 'RBC', '2468', 512.40, false, false) as chq \gset
select public.cb_save_bank_account(:'f', null, 'card', 'RBC', '4405', 2112.00, false, false) as card \gset
select public.cb_save_bank_account(:'f', null, 'loc', 'RBC', '9012', 5000.00, false, false) as loc \gset

select test.check('before: the cards 5,000.00 to add, the line of credit 5,000.00 too much (the screenshot)',
  test.sp(:'f') = array['GIFI 2701: the accounts total 5,000.00, last year''s T2 has 0.00 (5,000.00 too much).', 'GIFI 2707: the accounts total 2,112.00, last year''s T2 has 7,112.00 (5,000.00 to add).']::text);
select test.check('a line not in step 2 with an amount is refused',
  test.try(format($q$select public.cb_save_bank_account(%L, %L, 'loc', 'RBC', '9012', 5000, false, false, false, '2600')$q$, :'f', :'loc')) = 'Choose last year''s T2 line from the balance sheet lines in step 2.');
reset role;
insert into public.cb_substep_signoffs (file_id, substep, prepared_by, prepared_at) values (:'f', '3.1', :A::uuid, now());
set role authenticated;
select public.cb_save_bank_account(:'f', :'loc', 'loc', 'RBC', '9012', 5000.00, false, false, false, '2707');
select test.check('after: the line of credit on 2707 with the card: 7,112.00 against 7,112.00, nothing to fix; no 2701 line', test.sp(:'f') = '{}');
select test.check('this year''s GIFI line does not follow (2701 stays on the account)', (select t2_line = '2707' and gifi_line is null and chart_account = '22100' from public.cb_bank_accounts where id = :'loc')
  and (select left(line_no, 4) from public.cb_chart_accounts where number = '22100') = '2701');
select test.check('the change is in the history, old and new', exists (select 1 from test.h() where file_id = :'f' and action = 'bank_account_changed'
  and detail = 'Last year''s T2 line changed' and old_value = 'GIFI 2701' and new_value = 'GIFI 2707'));
select test.check('the 3.1 sign-off clears, as for other account edits', not exists (select 1 from public.cb_substep_signoffs where file_id = :'f' and substep = '3.1'));
select public.cb_save_bank_account(:'f', :'loc', 'loc', 'RBC', '9012', 5000.00, false, false, false, '2701');
select test.check('choosing the usual line stores nothing: back to the type''s line, and the two differences return', (select t2_line is null from public.cb_bank_accounts where id = :'loc')
  and test.sp(:'f') like '%GIFI 2701%too much%GIFI 2707%to add%');
reset role;
delete from public.cb_bank_accounts where id = :'loc';
insert into public.cb_opening_balances (file_id, code, amount) values (:'f', '2701', 300.00);
set role authenticated;
select test.check('a usual line with a T2 amount and no account shows (an account to add)', test.sp(:'f') like '%GIFI 2701: the accounts total 0.00, last year''s T2 has 300.00 (300.00 to add).%');
reset role;
\i supabase/migrations/20261212020000_round25_t2_line.sql
select test.check('safe to run twice', (select count(*) from public.cb_bank_accounts where file_id = :'f') = 2);
