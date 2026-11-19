-- Local tests: round 28 (Hashim, Nov 17, 2026). No account checks (the digits read are kept as information); a
-- line with no effect on the balance is kept apart, in no total; a loan line's Effective Date is the bank date and
-- its Transaction Date is kept; Exclude and Restore keep the information lines. Safe to run twice. Dummy data only.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
\set A '''00000000-0000-0000-0000-00000000000a'''
insert into public.clients (kind, legal_name, province) values ('corporation', 'Maple Dummy Loan Inc.', 'ON') returning id as client \gset
select public.cb_create_file(:'client', '2026-08-31', '2025-09-01', '', 'full', 'statements', :A::uuid, :A::uuid) as f \gset
-- The loan account is set up with last digits 1111; the statement prints 2468.
select public.cb_save_bank_account(:'f', null, 'loc', 'Dummy LOC', '1111', 4000.00, false, false) as loc \gset
reset role;
insert into public.cb_statement_imports (id, file_id, created_by, file_name, media_type, storage_path, status, summary, result, finished_at) values
  ('00000000-0000-0000-0000-0000000028a1', :'f', :A::uuid, 'loan-2025-10-02.pdf', 'application/pdf', 'f/a1.pdf', 'ready', '{"lines": 5}', '{"accounts": []}', now());
set role authenticated;

-- ---------- Import: Sep 3 to Oct 2, 2025. The first line's Effective Date (Sep 2) is the day before the period.
select public.cb_import_statement('00000000-0000-0000-0000-0000000028a1', format('[{"key": "a1", "account": "%s", "last4": "2468", "opening": 4000.00, "closing": 4300.00,
  "period_start": "2025-09-03", "period_end": "2025-10-02", "at_start": null, "at_end": null, "check": {"loan": "Principal paid 800.00"}, "edits": {},
  "rows": [
    {"line": 1, "date": "2025-09-02", "printed": "2025-09-03", "description": "Payment", "amount": -800.00, "no_effect": false},
    {"line": 2, "date": "2025-09-09", "printed": "2025-09-10", "description": "Withdrawal", "amount": 600.00, "no_effect": false},
    {"line": 3, "date": "2025-09-21", "printed": null, "description": "Interest Payment", "amount": -27.35, "no_effect": true},
    {"line": 4, "date": "2025-09-23", "printed": "2025-09-24", "description": "Withdrawal", "amount": 300.00, "no_effect": false},
    {"line": 5, "date": "2025-09-29", "printed": "2025-09-30", "description": "Withdrawal", "amount": 200.00, "no_effect": false}]}]', :'loc')::jsonb, false, '');
select id as s1 from public.cb_bank_statements where account_id = :'loc' and period_start = '2025-09-03' \gset
select test.check('imported into the account picked, though it prints other digits', (select count(*) = 1 from public.cb_bank_statements where account_id = :'loc'));
select test.check('the digits read are kept as information', (select statement_last4 = '2468' from public.cb_bank_statements where id = :'s1'));
select test.check('4 principal lines; 4,000.00 - 800.00 + 1,100.00 = 4,300.00', (select count(*) = 4 and sum(amount) = 300.00 from public.cb_bank_lines where statement_id = :'s1')
  and (select lines = 4 and outside_lines = 0 and plus_total = 1100.00 and minus_total = -800.00 from public.cb_bank_statements where id = :'s1'));
select test.check('the Interest Payment is information only, apart from the lines', (select count(*) = 1 and min(description) = 'Interest Payment' and min(amount) = -27.35
  from public.cb_bank_info_lines where statement_id = :'s1') and not exists (select 1 from public.cb_bank_lines where statement_id = :'s1' and description = 'Interest Payment'));
select test.check('the bank date is the Effective Date; the Transaction Date is kept', exists (select 1 from public.cb_bank_lines where statement_id = :'s1'
  and description = 'Payment' and txn_date = '2025-09-02' and printed_date = '2025-09-03'));

-- ---------- A month with only an information line still imports (the statement is needed for the months).
reset role;
insert into public.cb_statement_imports (id, file_id, created_by, file_name, media_type, storage_path, status, summary, result, finished_at) values
  ('00000000-0000-0000-0000-0000000028a2', :'f', :A::uuid, 'loan-2025-11-03.pdf', 'application/pdf', 'f/a2.pdf', 'ready', '{"lines": 1}', '{"accounts": []}', now());
set role authenticated;
select public.cb_import_statement('00000000-0000-0000-0000-0000000028a2', format('[{"key": "a1", "account": "%s", "last4": "2468", "opening": 4300.00, "closing": 4300.00,
  "period_start": "2025-10-03", "period_end": "2025-11-03", "at_start": null, "at_end": null, "check": {}, "edits": {},
  "rows": [{"line": 1, "date": "2025-10-21", "printed": null, "description": "Interest Payment", "amount": -29.10, "no_effect": true}]}]', :'loc')::jsonb, false, '');
select test.check('a statement with only an information line imports, with no lines', (select lines = 0 and outside_lines = 0 from public.cb_bank_statements
  where account_id = :'loc' and period_start = '2025-10-03') and (select count(*) = 1 from public.cb_bank_info_lines i join public.cb_bank_statements s on s.id = i.statement_id where s.period_start = '2025-10-03'));

-- ---------- Exclude and Restore keep the information lines.
select public.cb_exclude_statement(:'s1', 'other', 'dummy test');
select test.check('excluded: the information line leaves with its statement', not exists (select 1 from public.cb_bank_info_lines where statement_id = :'s1')
  and (select jsonb_array_length(info_rows) = 1 from public.cb_excluded_statements where id = :'s1'));
select public.cb_restore_statement(:'s1');
select test.check('restored: the information line is back', (select count(*) = 1 from public.cb_bank_info_lines where statement_id = :'s1')
  and (select count(*) = 4 from public.cb_bank_lines where statement_id = :'s1'));

-- ---------- Replace file never compares the account's digits.
select test.check('Replace file no longer checks digits', position('v_digits) >= 2' in pg_get_functiondef('public.cb_replace_statement_file(uuid, uuid, text, date, date, numeric, numeric, jsonb, text, boolean)'::regprocedure)) = 0);

-- ---------- Safe to run twice
reset role;
\i supabase/migrations/20261212040000_round28_statement_rules.sql
\i supabase/migrations/20261212380000_piece_r3a1_roles_rights.sql   -- piece R3a-1: the replay above restores owner checks; put the rights back
select test.check('safe to run twice: each patch placed once', (select (length(d) - length(replace(d, 'Round 28: a line with no effect', ''))) / length('Round 28: a line with no effect') = 1
  and (length(d) - length(replace(d, 'cb_bank_info_lines', ''))) / length('cb_bank_info_lines') = 1
  from (select pg_get_functiondef('private.cb_add_statement(uuid, uuid, text, numeric, numeric, jsonb, date, date, numeric, numeric, text)'::regprocedure) d) x)
  and (select (length(d) - length(replace(d, 'statement_last4', ''))) / length('statement_last4') = 1 from (select pg_get_functiondef('public.cb_import_statement(uuid, jsonb, boolean, text, boolean)'::regprocedure) d) x));
