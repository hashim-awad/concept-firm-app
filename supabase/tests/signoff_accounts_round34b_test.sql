-- Local tests: round 34b (Hashim, Nov 17, 2026): which 3.x sign-offs an account change removes.
-- An opening balance removes 3.1 and 3.3 (3.2 stays); a GIFI line, chart account or last four digits remove 3.1 only.
-- History names the reason. Dummy data only.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
\set A '''00000000-0000-0000-0000-00000000000a'''
insert into public.clients (kind, legal_name, province) values ('corporation', 'Maple Dummy Accounts Inc.', 'ON') returning id as client \gset
select public.cb_create_file(:'client', '2026-08-31', '2025-09-01', '', 'full', 'statements', :A::uuid, :A::uuid) as f \gset
select public.cb_save_bank_account(:'f', null, 'chequing', 'Dummy Chq', '1357', 5000.00, false, false) as chq \gset
select public.cb_save_bank_account(:'f', null, 'loc', 'Dummy LOC', '1111', 4000.00, false, false) as loc \gset
reset role;
select private.cb_add_statement(:'f', :'chq', 'chq.pdf', 5000.00, 4994.00, '[
  {"line": 1, "date": "2025-09-30", "description": "Monthly fee", "amount": -6.00}]', '2025-09-01', '2026-08-31', 5000.00, 4994.00, null);
create function test.signed() returns text language sql security definer set search_path = '' as $$
  select coalesce(string_agg(substep, ',' order by substep), '') from public.cb_substep_signoffs where prepared_at is not null $$;
grant execute on function test.signed() to authenticated;
create function test.sign_all(p_file uuid) returns void language sql security definer set search_path = '' as $$
  insert into public.cb_substep_signoffs (file_id, substep, prepared_by, prepared_at)
  select p_file, s, '00000000-0000-0000-0000-00000000000a', now() from unnest(array['3.1', '3.2', '3.3']) s
  on conflict (file_id, substep) do nothing;
  select private.cb_records_follow(p_file);
$$;
select test.sign_all(:'f');
select test.check('signed: 3.1, 3.2 and 3.3', test.signed() = '3.1,3.2,3.3');
set role authenticated;

-- ---------- The opening balance: 3.1 and 3.3, never 3.2.
select test.check('opening balance: asks to remove 3.1 and 3.3 only', test.try(format($q$select public.cb_save_bank_account(%L, %L, 'chequing', 'Dummy Chq', '1357', 5100.00, false, false)$q$, :'f', :'chq'))
  = 'This removes the sign-off on 3.1 and 3.3. Continue?');
select public.cb_save_bank_account(:'f', :'chq', 'chequing', 'Dummy Chq', '1357', 5100.00, false, false, true);
select test.check('opening balance changed: 3.1 and 3.3 removed, 3.2 kept', test.signed() = '3.2');
reset role;
select test.check('History: "3.1 and 3.3 sign-offs removed: opening balance changed"', exists (select 1 from public.cb_file_history where file_id = :'f'
  and detail = '3.1 and 3.3 sign-offs removed: opening balance changed' and reason = 'opening balance changed'));
select test.check('step 3 follows: not signed', not exists (select 1 from public.cb_step_signoffs where file_id = :'f' and step = 'records'));

-- ---------- The GIFI line (a line of credit made long-term: GIFI line and chart account): 3.1 only.
select test.sign_all(:'f');
set role authenticated;
select test.check('GIFI line: asks to remove 3.1 only', test.try(format($q$select public.cb_save_bank_account(%L, %L, 'loc', 'Dummy LOC', '1111', 4000.00, false, true)$q$, :'f', :'loc'))
  = 'This removes the sign-off on 3.1. Continue?');
select public.cb_save_bank_account(:'f', :'loc', 'loc', 'Dummy LOC', '1111', 4000.00, false, true, true);
reset role;
select test.check('GIFI line changed: only 3.1 removed, 3.2 and 3.3 kept', test.signed() = '3.2,3.3'
  and (select gifi_line = '3149.00' and chart_account = '25200' from public.cb_bank_accounts where id = :'loc'));
select test.check('History: "3.1 sign-off removed: GIFI line and chart account changed"', exists (select 1 from public.cb_file_history where file_id = :'f'
  and detail = '3.1 sign-off removed: GIFI line and chart account changed'));

-- ---------- The last four digits: 3.1 only.
select test.sign_all(:'f');
set role authenticated;
select public.cb_save_bank_account(:'f', :'chq', 'chequing', 'Dummy Chq', '2468', 5100.00, false, false, true);
reset role;
select test.check('last four digits changed: only 3.1 removed', test.signed() = '3.2,3.3');
select test.check('History: "3.1 sign-off removed: last four digits changed"', exists (select 1 from public.cb_file_history where file_id = :'f'
  and detail = '3.1 sign-off removed: last four digits changed'));

-- ---------- Behind the screens (the trigger), the same split.
select test.sign_all(:'f');
update public.cb_bank_accounts set chart_account = '10200' where id = :'chq';
select test.check('a chart account changed directly: only 3.1 removed', test.signed() = '3.2,3.3');
select test.sign_all(:'f');
update public.cb_bank_accounts set books_opening = 5200.00 where id = :'chq';
select test.check('an opening balance changed directly: 3.1 and 3.3 removed', test.signed() = '3.2');
