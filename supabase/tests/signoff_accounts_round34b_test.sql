-- Local tests: round 34b (Hashim, Nov 17, 2026), updated for CB2-0 step 2 (rule 14): an account change removes no 3.x
-- sign-off and asks nothing (opening balance, GIFI line, chart account, last four digits). History records each change. Dummy data only.
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

-- ---------- The opening balance (CB2-0 rule 14): no question, no sign-off removed; History has the change.
select test.check('opening balance: saved without asking (CB2-0: no confirm prompts)', test.try(format($q$select public.cb_save_bank_account(%L, %L, 'chequing', 'Dummy Chq', '1357', 5100.00, false, false)$q$, :'f', :'chq'))
  = 'OK');
select public.cb_save_bank_account(:'f', :'chq', 'chequing', 'Dummy Chq', '1357', 5100.00, false, false, true);
select test.check('opening balance changed: 3.1, 3.2 and 3.3 all kept', test.signed() = '3.1,3.2,3.3');
reset role;
select test.check('History: the balance, old and new, in one row', (select count(*) from public.cb_file_history where file_id = :'f'
  and action = 'bank_account_changed' and detail = 'Balance at last year end changed' and old_value = '5,000.00' and new_value = '5,100.00') = 1);
select test.check('step 3 stays signed', exists (select 1 from public.cb_step_signoffs where file_id = :'f' and step = 'records' and prepared_at is not null));

-- ---------- The GIFI line (a line of credit made long-term: GIFI line and chart account): no sign-off removed.
select test.sign_all(:'f');
set role authenticated;
select test.check('GIFI line: saved without asking (CB2-0: no confirm prompts)', test.try(format($q$select public.cb_save_bank_account(%L, %L, 'loc', 'Dummy LOC', '1111', 4000.00, false, true)$q$, :'f', :'loc'))
  = 'OK');
select public.cb_save_bank_account(:'f', :'loc', 'loc', 'Dummy LOC', '1111', 4000.00, false, true, true);
reset role;
select test.check('GIFI line changed: 3.1, 3.2 and 3.3 all kept', test.signed() = '3.1,3.2,3.3'
  and (select gifi_line = '3149.00' and chart_account = '25200' from public.cb_bank_accounts where id = :'loc'));
select test.check('History: the T2 line, old and new', exists (select 1 from public.cb_file_history where file_id = :'f'
  and action = 'bank_account_changed' and detail = 'Last year''s T2 line changed' and old_value = 'GIFI 2701' and new_value = 'GIFI 3149'));

-- ---------- The last four digits: no sign-off removed.
select test.sign_all(:'f');
set role authenticated;
select public.cb_save_bank_account(:'f', :'chq', 'chequing', 'Dummy Chq', '2468', 5100.00, false, false, true);
reset role;
select test.check('last four digits changed: 3.1, 3.2 and 3.3 all kept', test.signed() = '3.1,3.2,3.3');
select test.check('History: the last digits, old and new', exists (select 1 from public.cb_file_history where file_id = :'f'
  and action = 'bank_account_changed' and detail = 'Last digits changed' and old_value = '1357' and new_value = '2468'));

-- ---------- Behind the screens (the trigger), the same: nothing removed.
select test.sign_all(:'f');
update public.cb_bank_accounts set chart_account = '10200' where id = :'chq';
select test.check('a chart account changed directly: 3.1, 3.2 and 3.3 all kept', test.signed() = '3.1,3.2,3.3');
select test.sign_all(:'f');
update public.cb_bank_accounts set books_opening = 5200.00 where id = :'chq';
select test.check('an opening balance changed directly: 3.1, 3.2 and 3.3 all kept', test.signed() = '3.1,3.2,3.3');
select test.check('no History row says a sign-off was removed', not exists (select 1 from public.cb_file_history where file_id = :'f' and action in ('signoff_removed', 'signoff_cleared')));
