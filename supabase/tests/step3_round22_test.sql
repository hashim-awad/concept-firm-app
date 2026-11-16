-- Local tests: round 22 (Hashim, Nov 16, 2026), Closebook step 3 rework. Accounts added in step 3 with
-- their placement and numbers; the balance in the books at the start of the year; a statement crossing the
-- year checked whole with only its lines inside the year imported; the year-edge balances; outstanding
-- items; the file fingerprint; Undo import; Skip; "Not ours"; coverage reasons; step 3's sign-off rules.
-- Dummy data only.
\set ON_ERROR_STOP 1
grant usage on schema test to service_role;
grant execute on all functions in schema test to service_role;
-- Step 3's problems as text, for the checks (the function itself is not for signed-in people).
create function test.rp(p uuid) returns text language sql security definer set search_path = '' as $$ select private.cb_records_problems(p)::text $$;
grant execute on function test.rp(uuid) to authenticated;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'viewer.b@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.create_role('Viewer', 'Closebook view') as vr \gset
select public.set_role_permissions(:'vr', '{"closebook":"view","clients":"view"}');
select public.add_staff('00000000-0000-0000-0000-00000000000b', 'Test Viewer B', 'viewer.b@example.test', :'vr'::uuid);
insert into public.clients (kind, legal_name, province) values ('corporation', 'Willow Dummy Realty Inc.', 'ON') returning id as client \gset
\set A '''00000000-0000-0000-0000-00000000000a'''
select public.cb_create_file(:'client', '2026-08-31', '2025-09-01', '', 'full', 'statements', :A::uuid, :A::uuid) as f \gset

-- ---------- Accounts: placement, numbers and names (decisions 2 and 3)
select test.check('no accounts: step 3 asks for them', test.rp(:'f') = array['Add the bank and card accounts and upload their statements.']::text);
select public.cb_save_bank_account(:'f', null, 'chequing', 'MDB', '2201', 1957.62, false, false) as chq1 \gset
select public.cb_save_bank_account(:'f', null, 'chequing', 'NDB', '3302', 5110.00, false, false) as chq2 \gset
select public.cb_save_bank_account(:'f', null, 'savings', 'MDB', '7001', 0, false, false) as sav1 \gset
select public.cb_save_bank_account(:'f', null, 'savings', 'NDB', '7002', 0, false, false) as sav2 \gset
select public.cb_save_bank_account(:'f', null, 'card', 'MDB', '4405', 1322.08, false, false) as card1 \gset
select public.cb_save_bank_account(:'f', null, 'card', 'NDB', '5506', 790.00, false, false) as card2 \gset
select public.cb_save_bank_account(:'f', null, 'loc', 'MDB', '6601', 0, false, false) as loc1 \gset
select public.cb_save_bank_account(:'f', null, 'loc', 'MDB', '6602', 0, false, true) as loc2 \gset
select public.cb_save_bank_account(:'f', null, 'loan', 'NDB', '8801', 0, false, false) as loan1 \gset
select public.cb_save_bank_account(:'f', null, 'loan', 'NDB', '8802', 0, false, true) as loan2 \gset
select test.check('chequing: 10000, then 10010', (select array_agg(number || ' ' || name order by number) from public.cb_bank_accounts where account_type = 'chequing')
  = array['10000 Chequing · MDB ••• 2201', '10010 Chequing · NDB ••• 3302']);
select test.check('savings: 10100, then 10110', (select array_agg(number order by number) from public.cb_bank_accounts where account_type = 'savings') = array['10100', '10110']);
select test.check('cards: 22000, then 22010, on 2707', (select array_agg(number || ' ' || chart_account order by number) from public.cb_bank_accounts where account_type = 'card') = array['22000 22000', '22010 22000']);
select test.check('line of credit 22100 on 2701; long-term a file account from 25300 on 3149',
  (select number = '22100' and gifi_line is null and kind = 'card' from public.cb_bank_accounts where id = :'loc1')
  and (select number = '25300' and gifi_line = '3149.00' and long_term from public.cb_bank_accounts where id = :'loc2'));
select test.check('loan: a file account from 22110 on 2701; long-term 25000 Bank loan on 3143',
  (select number = '22110' and chart_account = '22100' and name = 'Loan · NDB ••• 8801' from public.cb_bank_accounts where id = :'loan1')
  and (select number = '25000' and chart_account = '25000' and name = 'Bank loan · NDB ••• 8802' from public.cb_bank_accounts where id = :'loan2'));
select test.check('the standard chart does not change', (select count(*) from public.cb_chart_accounts where number in ('10010', '10110', '22010', '22110', '25300')) = 0);
select test.check('the same account twice is refused', test.try(format($q$select public.cb_save_bank_account(%L, null, 'chequing', 'MDB', '2201', 0, false, false)$q$, :'f')) like '%already on this file%');
select test.check('the type, bank and digits are needed', test.try(format($q$select public.cb_save_bank_account(%L, null, 'cash', 'MDB', '1', 0, false, false)$q$, :'f')) like 'Choose the type%'
  and test.try(format($q$select public.cb_save_bank_account(%L, null, 'card', '', '1234', 0, false, false)$q$, :'f')) like 'Enter the bank%'
  and test.try(format($q$select public.cb_save_bank_account(%L, null, 'card', 'MDB', '1', 0, false, false)$q$, :'f')) like 'Enter the last digits%'
  and test.try(format($q$select public.cb_save_bank_account(%L, null, 'card', 'MDB', '1234', -5, false, false)$q$, :'f')) like '%positive number%');
select public.cb_save_bank_account(:'f', null, 'chequing', 'MDB', '9909', 25.50, true, false) as od \gset
select test.check('overdrawn is kept negative; the add is in the history', (select books_opening from public.cb_bank_accounts where id = :'od') = -25.50
  and exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'bank_account_added' and detail like 'Account added: Chequing · MDB ••• 9909, balance in the books -25.50.'));
select public.cb_remove_bank_account(:'od');
select public.cb_remove_bank_account(:'sav2'); select public.cb_remove_bank_account(:'loc1'); select public.cb_remove_bank_account(:'loc2');
select public.cb_remove_bank_account(:'loan1'); select public.cb_remove_bank_account(:'loan2'); select public.cb_remove_bank_account(:'sav1');
select test.check('an account with no statements can be removed', (select count(*) from public.cb_bank_accounts where file_id = :'f') = 4);

-- A viewer cannot add or change accounts.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b"}';
select test.check('a viewer cannot add an account', test.try(format($q$select public.cb_save_bank_account(%L, null, 'card', 'MDB', '1111', 0, false, false)$q$, :'f')) like '%Edit on Closebook%');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';

-- ---------- A statement crossing the year start: checked whole, one line imported
reset role;
insert into public.cb_statement_imports (id, file_id, created_by, file_name, media_type, storage_path, status, file_sha256, summary, result, finished_at)
values ('00000000-0000-0000-0000-0000000022a1', :'f', :A::uuid, 'mdb-chq-2025-08.pdf', 'application/pdf', 'file/x/a1.pdf', 'ready', 'sha-a1',
        '{"period_start":"2025-08-03","period_end":"2025-09-02"}', '{"bank":"","pages":1,"accounts":[]}', now()),
       ('00000000-0000-0000-0000-0000000022a2', :'f', :A::uuid, 'copy.pdf', 'application/pdf', 'file/x/a2.pdf', 'ready', 'sha-a1',
        '{"period_start":"2025-08-03","period_end":"2025-09-02"}', '{"bank":"","pages":1,"accounts":[]}', now()),
       ('00000000-0000-0000-0000-0000000022a3', :'f', :A::uuid, 'old.pdf', 'application/pdf', 'file/x/a3.pdf', 'ready', 'sha-a3',
        '{"period_start":"2025-07-03","period_end":"2025-08-02"}', '{"bank":"","pages":1,"accounts":[]}', now()),
       ('00000000-0000-0000-0000-0000000022a4', :'f', :A::uuid, 'mdb-visa-2026-09.pdf', 'application/pdf', 'file/x/a4.pdf', 'ready', 'sha-a4',
        '{"period_start":"2026-08-16","period_end":"2026-09-15"}', '{"bank":"","pages":1,"accounts":[]}', now());
set role authenticated;
\set rows_a '[{"line":1,"date":"2025-08-05","description":"PAD DUMMY TELECOM","amount":-412.30},{"line":2,"date":"2025-08-08","description":"COMMISSION DEPOSIT","amount":1200.00},{"line":3,"date":"2025-08-14","description":"ONLINE PAYMENT MDB VISA","amount":-1050.00},{"line":4,"date":"2025-08-20","description":"PAD DUMMY MLS BOARD","amount":-389.68},{"line":5,"date":"2025-08-27","description":"CHEQUE #118","amount":-325.50},{"line":6,"date":"2025-09-02","description":"MOBILE CHEQUE DEPOSIT","amount":1250.00}]'
select '[{"key":"a1","account":"' || :'chq1' || '","opening":2935.10,"closing":3207.62,"period_start":"2025-08-03","period_end":"2025-09-02","at_start":1957.62,"at_end":null,"rows":' || :'rows_a' || ',"check":{"ok":true},"edits":{}}]' as pay_a \gset
select test.check('the whole statement must balance', test.try(format($q$select public.cb_import_statement(%L, %L, false, '')$q$, '00000000-0000-0000-0000-0000000022a1', replace(:'pay_a', '3207.62', '3207.61'))) like '%does not balance%');
select public.cb_import_statement('00000000-0000-0000-0000-0000000022a1', :'pay_a'::jsonb, false, '') as imp_a \gset
select test.check('only the line inside the year is imported: Sep 2, 1,250.00', (:'imp_a'::jsonb -> 0 ->> 'lines') = '1' and (:'imp_a'::jsonb -> 0 ->> 'outside') = '5'
  and (select array_agg(txn_date || ' ' || amount) from public.cb_bank_lines where account_id = :'chq1') = array['2025-09-02 1250.00']);
select test.check('the statement keeps its own figures and the balance at the year start', (select opening = 2935.10 and closing = 3207.62 and lines = 1 and outside_lines = 5
  and at_start = 1957.62 and at_end is null and file_sha256 = 'sha-a1' from public.cb_bank_statements where account_id = :'chq1'));
select test.check('the same file again is refused', test.try(format($q$select public.cb_import_statement(%L, %L, false, '')$q$, '00000000-0000-0000-0000-0000000022a2', :'pay_a')) like '%already imported%');
select test.check('a statement wholly before the year is refused', test.try(format($q$select public.cb_import_statement(%L, %L, false, '')$q$, '00000000-0000-0000-0000-0000000022a3',
  replace(replace(replace(:'pay_a', '2025-09-02', '2025-08-02'), '"period_start":"2025-08-03"', '"period_start":"2025-07-03"'), '"line":6,"date":"2025-08-02"', '"line":6,"date":"2025-08-01"'))) like '%outside the year%');

-- ---------- A card statement crossing the year end: purchase dates decide
\set rows_c '[{"line":1,"date":"2026-08-18","posted":"2026-08-19","description":"DUMMY GAS","amount":86.40},{"line":2,"date":"2026-08-22","posted":"2026-08-23","description":"PAYMENT","amount":-1846.20},{"line":3,"date":"2026-08-25","posted":"2026-08-26","description":"DUMMY OFFICE","amount":412.75},{"line":4,"date":"2026-08-30","posted":"2026-09-02","description":"DUMMY RESTAURANT","amount":129.90},{"line":5,"date":"2026-09-03","posted":"2026-09-04","description":"DUMMY STAGING","amount":301.15},{"line":6,"date":"2026-09-10","posted":"2026-09-11","description":"DUMMY PRINT","amount":173.25}]'
select public.cb_import_statement('00000000-0000-0000-0000-0000000022a4', ('[{"key":"a1","account":"' || :'card1' || '","opening":1846.20,"closing":1103.45,"period_start":"2026-08-16","period_end":"2026-09-15","at_start":null,"at_end":629.05,"rows":' || :'rows_c' || ',"check":{},"edits":{}}]')::jsonb, false, '') as imp_c \gset
select test.check('4 lines by purchase date; the posting date is kept', (:'imp_c'::jsonb -> 0 ->> 'lines') = '4'
  and (select posted_date from public.cb_bank_lines where account_id = :'card1' and description = 'DUMMY RESTAURANT') = '2026-09-02'
  and (select at_end from public.cb_bank_statements where account_id = :'card1') = 629.05);

-- ---------- Step 3's problems
select test.rp(:'f') as probs \gset
select test.check('months not covered are listed per account; the year-end edge waits for them', :'probs' like '%10010 Chequing · NDB ••• 3302: 12 months not covered by statements%'
  and :'probs' like '%22010 Credit card · NDB ••• 5506: 12 months not covered%' and :'probs' like '%22000 Credit card · MDB ••• 4405: 12 months not covered%'
  and :'probs' not like '%22000 Credit card · MDB ••• 4405: the statements show%');
select test.check('the start edge ties for 10000 (statements 1,957.62, books 1,957.62)', :'probs' not like '%10000 Chequing · MDB ••• 2201: the statements show%');
select test.check('statements waiting: the copy and the old one are not counted', :'probs' not like '%waiting to check%');
select test.check('no tie yet: step 2 is not entered', :'probs' not like '%GIFI 1002%');
-- Coverage reasons
select public.cb_set_bank_coverage(:'card2', null, null, 'No statements: the card was cancelled before the year.');
select public.cb_set_bank_coverage(:'chq2', '2026-08-01', null, '');
select test.rp(:'f') as probs \gset
select test.check('a note with no dates waives the months; an opening date limits them', :'probs' not like '%22010%' and :'probs' like '%10010 Chequing · NDB ••• 3302: 1 month not covered%');
select test.check('a reason outside the year is refused', test.try(format($q$select public.cb_set_bank_coverage(%L, '2024-01-01', null, '')$q$, :'chq2')) like '%inside the year%');
select test.check('the reason is recorded with who and when', (select coverage_by = :A::uuid and coverage_at is not null from public.cb_bank_accounts where id = :'card2'));

-- The tie to step 2
reset role;
insert into public.cb_opening_balances (file_id, code, amount) values (:'f', '1002', 7367.62), (:'f', '2707', 2112.08);
update public.cb_files set opening_source = 'manual' where id = :'f';
set role authenticated;
select test.rp(:'f') as probs \gset
select test.check('GIFI 1002 off by 300.00 shows; 2707 ties', :'probs' like '%GIFI 1002: the accounts open at 7,067.62, last year''s T2 has 7,367.62%' and :'probs' not like '%GIFI 2707%');
select public.cb_save_bank_account(:'f', :'chq2', 'chequing', 'NDB', '3302', 5410.00, false, false);
select test.check('fixing the balance ties 1002', test.rp(:'f') not like '%GIFI 1002%');

-- Outstanding items at the start: 10010's statements show 5,860.00, the books 5,410.00
reset role;
insert into public.cb_statement_imports (id, file_id, created_by, file_name, media_type, storage_path, status, file_sha256, summary, result, finished_at)
values ('00000000-0000-0000-0000-0000000022b1', :'f', :A::uuid, 'ndb-2025-09.pdf', 'application/pdf', 'file/x/b1.pdf', 'ready', 'sha-b1', '{"period_start":"2025-09-01","period_end":"2025-09-30","review":0,"difference_cents":0}', '{"bank":"","pages":1,"accounts":[]}', now());
set role authenticated;
select public.cb_set_bank_coverage(:'chq2', null, null, '');
select public.cb_import_statement('00000000-0000-0000-0000-0000000022b1', ('[{"key":"a1","account":"' || :'chq2' || '","opening":5860.00,"closing":5410.00,"period_start":"2025-09-01","period_end":"2025-09-30","at_start":5860.00,"at_end":null,"rows":[{"line":1,"date":"2025-09-04","description":"CHEQUE #204","amount":-450.00}],"check":{},"edits":{}}]')::jsonb, false, '');
select test.check('an unexplained difference at the start blocks', test.rp(:'f') like '%10010 Chequing · NDB ••• 3302: the statements show 5,860.00 on Aug 31, 2025 and the books 5,410.00. Explain the difference of (450.00)%');
select id as l204 from public.cb_bank_lines where account_id = :'chq2' \gset
select test.check('the clearing line must be for the same amount', test.try(format($q$select public.cb_add_outstanding(%L, 'start', '2025-08-28', 'Cheque #204', 'out', 45, %L)$q$, :'chq2', :'l204')) like '%same amount%');
select public.cb_add_outstanding(:'chq2', 'start', '2025-08-28', 'Cheque #204', 'out', 450, :'l204') as item \gset
select test.check('explained: the difference is gone', test.rp(:'f') not like '%10010 Chequing · NDB ••• 3302: the statements show%');
select test.check('the line that cleared it posts nothing', (select status = 'matched' and source = 'outstanding' from public.cb_bank_lines where id = :'l204'));
select public.cb_remove_outstanding(:'item');
select test.check('removing the item frees the line to code', (select status = 'new' and source = '' from public.cb_bank_lines where id = :'l204'));
select public.cb_add_outstanding(:'chq2', 'start', '2025-08-28', 'Cheque #204', 'out', 450, :'l204') as item \gset

-- ---------- Waiting, Skip, the target account, Not ours
reset role;
insert into public.cb_statement_imports (id, file_id, created_by, file_name, media_type, storage_path, status, summary, result, finished_at)
values ('00000000-0000-0000-0000-0000000022c1', :'f', :A::uuid, 'ndb-2025-10.pdf', 'application/pdf', 'file/x/c1.pdf', 'needs_look', '{"period_start":"2025-10-01","period_end":"2025-10-31"}', '{"bank":"","pages":1,"accounts":[]}', now());
set role authenticated;
select test.check('a statement in the year waiting to check blocks', test.rp(:'f') like '%1 statement waiting to check%');
select public.cb_skip_statement('00000000-0000-0000-0000-0000000022a3', true, null);
select test.check('Skip keeps it listed, as skipped', (select status from public.cb_statement_imports where id = '00000000-0000-0000-0000-0000000022a3') = 'skipped');
select public.cb_skip_statement('00000000-0000-0000-0000-0000000022a3', false, 'ready');
select test.check('and brings it back', (select status from public.cb_statement_imports where id = '00000000-0000-0000-0000-0000000022a3') = 'ready');
select public.cb_statement_target(array['00000000-0000-0000-0000-0000000022c1']::uuid[], :'chq2') as moved \gset
select test.check('statements are moved to an account on the file', :'moved' = '1'
  and (select target_account from public.cb_statement_imports where id = '00000000-0000-0000-0000-0000000022c1') = :'chq2'::uuid);
select public.cb_set_not_ours(:'f', '4455', 'MC ••• 4455', true);
select test.check('Not ours is recorded with who and when', (select decided_by = :A::uuid and label = 'MC ••• 4455' from public.cb_bank_not_ours where file_id = :'f' and last4 = '4455')
  and exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'bank_not_ours'));

-- ---------- Undo import
select test.check('the type cannot change between bank and card once statements are in', test.try(format($q$select public.cb_save_bank_account(%L, %L, 'card', 'MDB', '2201', 0, false, false)$q$, :'f', :'chq1')) like '%Undo its imports%');
select test.check('an account with statements cannot be removed', test.try(format($q$select public.cb_remove_bank_account(%L)$q$, :'chq1')) like '%Undo its imports first%');
select public.cb_delete_bank_statement((select id from public.cb_bank_statements where account_id = :'chq2'));
select test.check('undo: the lines go with their cleared item link; the added account stays', not exists (select 1 from public.cb_bank_lines where account_id = :'chq2')
  and (select cleared_line is null from public.cb_bank_outstanding where id = :'item') and exists (select 1 from public.cb_bank_accounts where id = :'chq2'));
select test.check('the PDF goes back to "Ready to check" (its checks passed when read); the undo is in the history', (select status from public.cb_statement_imports where id = '00000000-0000-0000-0000-0000000022b1') = 'ready'
  and exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'statement_undone'));

-- ---------- Step status uses the new rules
select test.check('cb_step_status shows step 3''s problems', (public.cb_step_status(:'f') -> 'records' -> 'problems')::text like '%waiting to check%');

-- An undone statement whose checks did not pass goes back to "Needs a look".
reset role;
update public.cb_statement_imports set status = 'ready' where id = '00000000-0000-0000-0000-0000000022b1';
set role authenticated;
select public.cb_import_statement('00000000-0000-0000-0000-0000000022b1', ('[{"key":"a1","account":"' || :'chq2' || '","opening":5860.00,"closing":5410.00,"period_start":"2025-09-01","period_end":"2025-09-30","at_start":5860.00,"at_end":null,"rows":[{"line":1,"date":"2025-09-04","description":"CHEQUE #204","amount":-450.00}],"check":{},"edits":{}}]')::jsonb, false, '');
reset role;
update public.cb_statement_imports set summary = summary || '{"review":2}' where id = '00000000-0000-0000-0000-0000000022b1';
set role authenticated;
select public.cb_delete_bank_statement((select id from public.cb_bank_statements where account_id = :'chq2'));
select test.check('an undone statement with lines for review goes back to "Needs a look"', (select status from public.cb_statement_imports where id = '00000000-0000-0000-0000-0000000022b1') = 'needs_look');

-- ---------- Safe to run twice
reset role;
\i supabase/migrations/20261211010000_round22_step3_accounts.sql
\i supabase/migrations/20261211020000_round22_undo_status.sql
select test.check('a second run keeps the accounts and their numbers', (select count(*) from public.cb_bank_accounts where file_id = :'f') = 4
  and (select number from public.cb_bank_accounts where id = :'chq2') = '10010');
