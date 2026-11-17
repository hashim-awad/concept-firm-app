-- Local tests: round 30 (Hashim, Nov 17, 2026). A card line read without its posting date and dated up to 31 days
-- before the period imports (it is printed on the statement, so it posted inside it); more is refused in plain
-- words. An import that does not go through becomes "To fix" with its reason; a change clears it. Safe to run twice.
\set ON_ERROR_STOP 1
create function test.add(p_file uuid, p_acc uuid, p_from date, p_to date, p_open numeric, p_rows jsonb) returns jsonb language plpgsql security definer as $$
declare v_close numeric;
begin
  select p_open + coalesce(sum((r ->> 'amount')::numeric), 0) into v_close from jsonb_array_elements(p_rows) r;
  return private.cb_add_statement(p_file, p_acc, format('card-%s.pdf', p_from), p_open, v_close, p_rows, p_from, p_to, null, null, null);
end;
$$;
grant execute on function test.add(uuid, uuid, date, date, numeric, jsonb) to authenticated;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
\set A '''00000000-0000-0000-0000-00000000000a'''
insert into public.clients (kind, legal_name, province) values ('corporation', 'Maple Dummy Card Inc.', 'ON') returning id as client \gset
select public.cb_create_file(:'client', '2026-08-31', '2025-09-01', '', 'full', 'statements', :A::uuid, :A::uuid) as f \gset
select public.cb_save_bank_account(:'f', null, 'card', 'Dummy MC', '4417', 2500.00, false, false) as card \gset
select public.cb_save_bank_account(:'f', null, 'chequing', 'Dummy Chq', '1357', 1000.00, false, false) as chq \gset

select test.add(:'f', :'card', '2026-07-18', '2026-08-17', 2500.00, '[
  {"line": 1, "date": "2026-07-19", "posted": "2026-07-20", "description": "OFFICE DUMMY", "amount": 10.00, "holder": "4417"},
  {"line": 2, "date": "2026-07-16", "description": "FUEL DUMMY A", "amount": 64.20, "holder": "9032"},
  {"line": 3, "date": "2026-07-17", "description": "HOTEL DUMMY D", "amount": 189.00, "holder": "9032"}]') ->> 'statement' as s1 \gset
select test.check('second cardholder''s purchases two days before the period, no posting date read: imported', (select count(*) = 3 from public.cb_bank_lines where statement_id = :'s1'));
select test.check('the purchase date stays the line''s date', exists (select 1 from public.cb_bank_lines where statement_id = :'s1' and txn_date = '2026-07-16' and card_last4 = '9032'));
select test.check('the statement keeps the period printed in its header', (select period_start = '2026-07-18' and period_end = '2026-08-17' and first_date = '2026-07-18' from public.cb_bank_statements where id = :'s1'));
select test.check('a card purchase 40 days before the period is refused in plain words', test.try(format($q$select test.add(%L, %L, '2026-05-18', '2026-06-17', 100.00,
  '[{"line": 1, "date": "2026-04-08", "description": "TOO EARLY DUMMY", "amount": 5.00}]')$q$, :'f', :'card')) like 'A line is dated outside the statement period%');
select test.check('a bank line before the period is still refused (the rule is for cards)', test.try(format($q$select test.add(%L, %L, '2026-07-01', '2026-07-31', 100.00,
  '[{"line": 1, "date": "2026-06-29", "description": "EARLY DUMMY", "amount": 5.00}]')$q$, :'f', :'chq')) like 'A line is dated outside the statement period%');

-- An import that does not go through: "To fix" with its reason; a change in Fix it clears the reason.
reset role;
insert into public.cb_statement_imports (id, file_id, created_by, file_name, media_type, storage_path, status, summary, result, finished_at) values
  ('00000000-0000-0000-0000-0000000030a1', :'f', :A::uuid, 'card-dummy.pdf', 'application/pdf', 'f/a1.pdf', 'ready', '{}', '{"accounts": []}', now());
set role authenticated;
select public.statement_refuse('00000000-0000-0000-0000-0000000030a1', 'This period overlaps a statement already imported.', false);
select test.check('not imported: To fix, with the reason', (select status = 'needs_look' and error = 'This period overlaps a statement already imported.' from public.cb_statement_imports where id = '00000000-0000-0000-0000-0000000030a1'));
select public.statement_save_edits('00000000-0000-0000-0000-0000000030a1', '{"accounts": []}', '{}', 'ready');
select test.check('a change in Fix it clears the reason', (select error is null from public.cb_statement_imports where id = '00000000-0000-0000-0000-0000000030a1'));

reset role;
\i supabase/migrations/20261212060000_round30_card_dates.sql
select test.check('safe to run twice', (select (length(d) - length(replace(d, 'Round 30', ''))) / length('Round 30') = 2
  from (select pg_get_functiondef('private.cb_add_statement(uuid, uuid, text, numeric, numeric, jsonb, date, date, numeric, numeric, text)'::regprocedure) d) x));
