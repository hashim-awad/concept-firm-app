-- Local tests: round 26 (Hashim, Nov 17, 2026). A card statement whose purchase comes before the period (bought on
-- the 16th, posted on the 18th) is accepted; a line outside the period is refused in plain words, never with a
-- database error; the cardholder's digits are kept on each line; changes before import and "Read again" are
-- logged; an imported statement is never read again. Safe to run twice. Dummy data only.
\set ON_ERROR_STOP 1
create function test.h() returns setof public.cb_file_history language sql security definer set search_path = '' as $$ select * from public.cb_file_history $$;
grant execute on function test.h() to authenticated;
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
select public.cb_save_bank_account(:'f', null, 'card', 'Dummy MC', '4417', 1250.00, false, false) as card \gset

-- ---------- The period is checked on the posting date
select test.add(:'f', :'card', '2025-09-18', '2025-10-17', 1250.00, '[
  {"line": 1, "date": "2025-09-16", "posted": "2025-09-18", "description": "OFFICE SUPPLY DUMMY", "amount": 86.40, "holder": "4417"},
  {"line": 2, "date": "2025-09-25", "posted": "2025-09-25", "description": "PAYMENT - THANK YOU", "amount": -600.00, "holder": "4417"},
  {"line": 3, "date": "2025-09-20", "posted": "2025-09-22", "description": "COFFEE DUMMY", "amount": 12.75, "holder": "9032"}]') ->> 'statement' as s1 \gset
select test.check('a purchase before the period, posted inside it, is accepted', (select count(*) = 3 from public.cb_bank_lines where statement_id = :'s1'));
select test.check('the purchase keeps its own date (the year cut-off uses it)', exists (select 1 from public.cb_bank_lines where statement_id = :'s1' and txn_date = '2025-09-16' and posted_date = '2025-09-18'));
select test.check('each line keeps its cardholder''s digits', (select array_agg(card_last4 order by row_no) = array['4417', '4417', '9032'] from public.cb_bank_lines where statement_id = :'s1'));
select test.add(:'f', :'card', '2025-12-18', '2026-01-19', 980.00, '[
  {"line": 1, "date": "2025-12-16", "posted": "2025-12-18", "description": "HOLIDAY CARDS DUMMY", "amount": 44.25},
  {"line": 2, "date": "2026-01-08", "posted": "2026-01-09", "description": "SUBSCRIPTION DUMMY", "amount": 29.99}]') ->> 'statement' as s3 \gset
select test.check('Dec 18 to Jan 19 is accepted', (select count(*) = 2 from public.cb_bank_lines where statement_id = :'s3'));
select test.check('a line outside the period is refused in plain words, naming the dates',
  test.try(format($q$select test.add(%L, %L, '2026-02-18', '2026-03-17', 500.00, '[{"line": 1, "date": "2026-02-10", "posted": "2026-02-11", "description": "EARLY DUMMY", "amount": 10.00}]')$q$, :'f', :'card'))
  = 'A line is dated outside the statement period (Feb 18, 2026 to Mar 17, 2026): the lines run from Feb 11, 2026 to Feb 11, 2026. Check the dates in Fix it.');

-- ---------- The year cut-off still uses the purchase date (round 22): bought Aug 30, posted Sep 2, is last year.
select test.add(:'f', :'card', '2025-08-18', '2025-09-17', 100.00, '[
  {"line": 1, "date": "2025-08-30", "posted": "2025-09-02", "description": "BOUGHT AUG 30 DUMMY", "amount": 50.00},
  {"line": 2, "date": "2025-09-05", "posted": "2025-09-06", "description": "BOUGHT SEP 5 DUMMY", "amount": 20.00}]') ->> 'statement' as s0 \gset
select test.check('Aug 30 posted Sep 2: the statement is accepted, the line is last year''s and is not imported', (select lines = 1 and outside_lines = 1 from public.cb_bank_statements where id = :'s0')
  and not exists (select 1 from public.cb_bank_lines where statement_id = :'s0' and description = 'BOUGHT AUG 30 DUMMY')
  and exists (select 1 from public.cb_bank_lines where statement_id = :'s0' and description = 'BOUGHT SEP 5 DUMMY' and txn_date = '2025-09-05'));

-- ---------- Before import: changes and "Read again" are logged; an imported statement is not read again
reset role;
insert into public.cb_statement_imports (id, file_id, created_by, file_name, media_type, storage_path, status, summary, result, edited, finished_at) values
  ('00000000-0000-0000-0000-0000000026a1', :'f', :A::uuid, 'card-2025-10-18.pdf', 'application/pdf', 'f/a1.pdf', 'needs_look', '{"lines": 4}', '{"accounts": []}', '{"accounts": []}', now()),
  ('00000000-0000-0000-0000-0000000026a2', :'f', :A::uuid, 'card-2025-09-18.pdf', 'application/pdf', 'f/a2.pdf', 'imported', '{"lines": 8}', '{"accounts": []}', null, now());
set role authenticated;
select public.cb_statement_note('00000000-0000-0000-0000-0000000026a1', 'line_added_before_import', 'Added before import', 'Card ••• 4417 · 2025-10-18 to 2025-11-17', '', '',
  '2025-10-21 · PARKING DUMMY · Charge · 24.50');
select test.check('an added line is logged with who and the values', exists (select 1 from test.h() where file_id = :'f' and action = 'line_added_before_import'
  and actor_id = :A::uuid and new_value = '2025-10-21 · PARKING DUMMY · Charge · 24.50' and import_id = '00000000-0000-0000-0000-0000000026a1'));
select public.cb_statement_note('00000000-0000-0000-0000-0000000026a1', 'line_removed_before_import', 'Removed before import', 'Card ••• 4417', 'Read twice', '2025-10-30 · SOFTWARE DUMMY · Charge · 49.99', '');
select test.check('a removed line is logged with its reason and values', exists (select 1 from test.h() where file_id = :'f' and action = 'line_removed_before_import'
  and reason = 'Read twice' and old_value like '%SOFTWARE DUMMY%'));
select test.check('nothing is logged as a change on an imported statement',
  test.try($q$select public.cb_statement_note('00000000-0000-0000-0000-0000000026a2', 'line_added_before_import', 'x', 'x', '', '', 'x')$q$)
  = 'This statement is already imported: its lines can no longer change here.');
select test.check('only the fix screen''s changes are logged this way',
  test.try($q$select public.cb_statement_note('00000000-0000-0000-0000-0000000026a1', 'statement_purged', 'x', 'x', '', '', 'x')$q$) = 'Unknown change.');
select public.statement_read_again('00000000-0000-0000-0000-0000000026a1');
select test.check('read again: back to the reader, changes before import cleared', (select status = 'queued' and edited is null and attempts = 0 from public.cb_statement_imports
  where id = '00000000-0000-0000-0000-0000000026a1'));
select test.check('read again is logged', exists (select 1 from test.h() where file_id = :'f' and action = 'statement_read_again' and ref_label = 'card-2025-10-18.pdf'
  and old_value = '4 lines read'));
select test.check('an imported statement is never read again',
  test.try($q$select public.statement_read_again('00000000-0000-0000-0000-0000000026a2')$q$) = 'This statement is imported: it is not read again.');

-- ---------- Safe to run twice
reset role;
\i supabase/migrations/20261212030000_round26_card_period.sql
select test.check('safe to run twice: each patch placed once', (select (length(d) - length(replace(d, 'Round 26: the period', ''))) / length('Round 26: the period') = 1
  and (length(d) - length(replace(d, 'card_last4', ''))) / length('card_last4') = 1
  from (select pg_get_functiondef('private.cb_add_statement(uuid, uuid, text, numeric, numeric, jsonb, date, date, numeric, numeric, text)'::regprocedure) d) x));
