-- Local tests: round 22 fixes from the first Live use (Hashim, Nov 16, 2026). A bank whose statements share a
-- day (one ends Sep 2, the next starts Sep 2); "Already imported" only for a statement in the books; one copy of
-- each statement in the upload list; rounding against last year's T2 (whole dollars); sign-off counts gaps as
-- the page shows them. Dummy data only.
\set ON_ERROR_STOP 1
create function test.try_rollback(p_sql text) returns text language plpgsql as $$
begin
  begin
    execute p_sql;
    raise exception 'ROLLBACK_OK';
  exception when others then
    if sqlerrm = 'ROLLBACK_OK' then return 'OK'; end if;
    return sqlerrm;
  end;
end $$;
grant execute on function test.try_rollback(text) to authenticated;
create function test.rp(p uuid) returns text language sql security definer set search_path = '' as $$ select private.cb_records_problems(p)::text $$;
grant execute on function test.rp(uuid) to authenticated;
-- Adds a statement straight to the books (as the import does once the checks pass): one line in the middle.
create function test.add(p_file uuid, p_acc uuid, p_from date, p_to date, p_open numeric, p_close numeric) returns text language plpgsql as $$
begin
  perform private.cb_add_statement(p_file, p_acc, format('rbc-%s.pdf', p_from), p_open, p_close,
    jsonb_build_array(jsonb_build_object('line', 1, 'date', least(greatest(p_from + (p_to - p_from) / 2, date '2025-09-01'), date '2026-08-31'), 'description', 'DUMMY DEPOSIT', 'amount', p_close - p_open)),
    p_from, p_to, case when p_from < '2025-09-01' then p_open end, case when p_to > '2026-08-31' then p_close end, null);
  return 'added';
exception when others then return sqlerrm;
end;
$$;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
insert into public.clients (kind, legal_name, province) values ('corporation', 'Juniper Dummy Design Inc.', 'ON') returning id as client \gset
\set A '''00000000-0000-0000-0000-00000000000a'''
select public.cb_create_file(:'client', '2026-08-31', '2025-09-01', '', 'full', 'statements', :A::uuid, :A::uuid) as f \gset
select public.cb_save_bank_account(:'f', null, 'chequing', 'RBC', '4321', 100.52, false, false) as chq \gset
reset role;

-- ---------- 1. The shared day: every second statement in, as the first upload left it
select test.check('Aug 1 to Sep 2 goes in', test.add(:'f', :'chq', '2025-08-01', '2025-09-02', 100.52, 150.00) = 'added');
select test.check('Oct 2 to Nov 3 goes in', test.add(:'f', :'chq', '2025-10-02', '2025-11-03', 200.00, 300.00) = 'added');
select test.check('Dec 2 to Jan 2 goes in', test.add(:'f', :'chq', '2025-12-02', '2026-01-02', 400.00, 500.00) = 'added');
select test.check('Feb 2 to Mar 2 goes in', test.add(:'f', :'chq', '2026-02-02', '2026-03-02', 600.00, 700.00) = 'added');
select test.check('Apr 2 to May 1 goes in', test.add(:'f', :'chq', '2026-04-02', '2026-05-01', 800.00, 900.00) = 'added');
select test.check('Jun 2 to Jul 2 goes in', test.add(:'f', :'chq', '2026-06-02', '2026-07-02', 1000.00, 1100.00) = 'added');
select test.check('Aug 3 to Sep 2 goes in', test.add(:'f', :'chq', '2026-08-03', '2026-09-02', 1200.00, 1300.00) = 'added');
select test.check('six gaps, counted as the page counts them', test.rp(:'f') like '%10000 Chequing · RBC ••• 4321: 6 missing.%');
select test.check('Sep 2 to Oct 2 shares one day with each neighbour: it goes in', test.add(:'f', :'chq', '2025-09-02', '2025-10-02', 150.00, 200.00) = 'added');
select test.check('two shared days are an overlap', test.add(:'f', :'chq', '2025-11-02', '2025-12-02', 300.00, 400.00) like 'This period (Nov 2, 2025 to Dec 2, 2025) overlaps%');
select test.check('the same period again is an overlap', test.add(:'f', :'chq', '2025-10-02', '2025-11-03', 200.00, 300.00) like '%overlaps%');
select test.check('five gaps now', test.rp(:'f') like '%: 5 missing.%');
select test.add(:'f', :'chq', '2025-11-03', '2025-12-02', 300.00, 400.00);
select test.add(:'f', :'chq', '2026-01-02', '2026-02-02', 500.00, 600.00);
select test.add(:'f', :'chq', '2026-03-02', '2026-04-02', 700.00, 800.00);
select test.add(:'f', :'chq', '2026-05-01', '2026-06-02', 900.00, 1000.00);
select test.add(:'f', :'chq', '2026-07-02', '2026-08-03', 1100.00, 1200.00);
select test.check('all thirteen in: no gap', (select count(*) from public.cb_bank_statements where account_id = :'chq') = 13 and test.rp(:'f') not like '%missing%');
-- A break with nothing missing is one gap.
-- (Round 24: a statement's figures are read-only; the fixture turns the guard off to make the break.)
alter table public.cb_bank_statements disable trigger cb_statement_readonly;
update public.cb_bank_statements set opening = 1199.00, plus_total = plus_total + 1 where account_id = :'chq' and period_start = '2026-08-03';
select test.check('a statement that does not follow the one before is one gap', test.rp(:'f') like '%: 1 missing.%');
update public.cb_bank_statements set opening = 1200.00, plus_total = plus_total - 1 where account_id = :'chq' and period_start = '2026-08-03';
alter table public.cb_bank_statements enable trigger cb_statement_readonly;

-- The CSV path follows the same rule.
select test.check('the CSV path: a shared day is not an overlap',
  position('period_start < p_period_end and period_end > p_period_start' in pg_get_functiondef('public.cb_upload_bank(uuid, uuid, text, text, text, numeric, numeric, jsonb, date, date)'::regprocedure)) > 0);

-- ---------- 2. One copy of each statement
insert into public.cb_statement_imports (id, file_id, created_by, file_name, media_type, storage_path, status, file_sha256, summary, created_at, target_account) values
  ('00000000-0000-0000-0000-0000000033c1', :'f', :A::uuid, 'first.pdf', 'application/pdf', 'f/c1.pdf', 'ready', null,
   '{"period_start":"2026-09-02","period_end":"2026-10-02","found":[{"name":"RBC","last4":"4321","kind":"bank"}]}', now() - interval '2 days', null),
  ('00000000-0000-0000-0000-0000000033c2', :'f', :A::uuid, 'again.pdf', 'application/pdf', 'f/c2.pdf', 'ready', 'sha-c2',
   '{"period_start":"2026-09-02","period_end":"2026-10-02","found":[{"name":"RBC","last4":"••4321","kind":"bank"}]}', now() - interval '1 day', :'chq'),
  ('00000000-0000-0000-0000-0000000033c3', :'f', :A::uuid, 'other.pdf', 'application/pdf', 'f/c3.pdf', 'ready', 'sha-c3',
   '{"period_start":"2026-09-02","period_end":"2026-10-02","found":[{"name":"TD","last4":"9999","kind":"bank"}]}', now() - interval '1 day', null),
  ('00000000-0000-0000-0000-0000000033c4', :'f', :A::uuid, 'same-file.pdf', 'application/pdf', 'f/c4.pdf', 'reading', 'sha-c3',
   null, now(), null),
  ('00000000-0000-0000-0000-0000000033c5', :'f', :A::uuid, 'gone.pdf', 'application/pdf', 'f/c5.pdf', 'discarded', 'sha-c5', null, now() - interval '3 days', null),
  ('00000000-0000-0000-0000-0000000033c6', :'f', :A::uuid, 'gone-again.pdf', 'application/pdf', 'f/c6.pdf', 'reading', 'sha-c5', null, now(), null);
select public.statement_keep_one('00000000-0000-0000-0000-0000000033c2') as kept \gset
select test.check('the same account and period as a copy already in the list: the new one goes, the first stays',
  :'kept' = '00000000-0000-0000-0000-0000000033c1'
  and (select status from public.cb_statement_imports where id = '00000000-0000-0000-0000-0000000033c2') = 'discarded'
  and (select status = 'ready' and target_account = :'chq' from public.cb_statement_imports where id = '00000000-0000-0000-0000-0000000033c1'));
select test.check('another account for the same dates is not a copy', public.statement_keep_one('00000000-0000-0000-0000-0000000033c3') is null);
select public.statement_keep_one('00000000-0000-0000-0000-0000000033c4') as kept \gset
select test.check('the same file (fingerprint) while still reading: the new one goes',
  :'kept' = '00000000-0000-0000-0000-0000000033c3'
  and (select status from public.cb_statement_imports where id = '00000000-0000-0000-0000-0000000033c4') = 'discarded');
select test.check('a copy already removed does not count', public.statement_keep_one('00000000-0000-0000-0000-0000000033c6') is null);
select test.check('the oldest copy is never removed for a newer one', public.statement_keep_one('00000000-0000-0000-0000-0000000033c1') is null);
set role authenticated;
select test.check('not for signed-in people', test.try($q$select public.statement_keep_one('00000000-0000-0000-0000-0000000033c1')$q$) like '%permission denied%');
reset role;
delete from public.cb_statement_imports where file_id = :'f';

-- ---------- 3. Rounding: the T2 is in whole dollars
insert into public.cb_opening_balances (file_id, code, amount) values (:'f', '1002', 100.00);
update public.cb_files set opening_source = 'manual' where id = :'f';
select test.check('books 100.52 against the T2''s 100: within 1.00, it ties', test.rp(:'f') not like '%GIFI 1002%');
update public.cb_opening_balances set amount = 99.00 where file_id = :'f' and code = '1002';
select test.check('1.52 off does not tie', test.rp(:'f') like '%GIFI 1002: the accounts total 100.52, last year''s T2 has 99.00 (1.52 too much).%');
update public.cb_opening_balances set amount = 100.00 where file_id = :'f' and code = '1002';
-- The books take the T2's whole dollars: the statements show 100.52 on Aug 31, 2025.
set role authenticated;
select public.cb_save_bank_account(:'f', :'chq', 'chequing', 'RBC', '4321', 100.00, false, false);
-- Round 23: under 1.00 at the start of the year is rounding: no start band, and the year's DIFFERENCE leaves it out.
select test.check('the start edge 0.52 off is rounding: nothing to explain', test.rp(:'f') not like '%start of the year%' and test.rp(:'f') not like '%DIFFERENCE%');
select public.cb_add_outstanding(:'chq', 'start', null, null, null, null, null, 'rounding') as r1 \gset
select test.check('rounding takes the whole difference left, posts nothing, and explains the start',
  (select kind = 'rounding' and dir = 'out' and amount = 0.52 and item_date = '2025-08-31' and description = 'Rounding (the T2 is in whole dollars)' and cleared_line is null
     from public.cb_bank_outstanding where id = :'r1')
  and test.rp(:'f') not like '%start of the year%');
select public.cb_add_outstanding(:'chq', 'end', null, null, null, null, null, 'rounding');
select test.check('rounding at the year end too: nothing left', test.rp(:'f') not like '%DIFFERENCE%');
select test.check('rounding with nothing left is refused', test.try(format($q$select public.cb_add_outstanding(%L, 'end', null, null, null, null, null, 'rounding')$q$, :'chq')) like 'There is no difference left to round.');
select public.cb_remove_outstanding(:'r1');
select public.cb_save_bank_account(:'f', :'chq', 'chequing', 'RBC', '4321', 98.00, false, false);
select test.check('a difference of 1.00 or more may be rounded too (CB2-0 v7, rule 7)', test.try_rollback(format($q$select public.cb_add_outstanding(%L, 'start', null, null, null, null, null, 'rounding')$q$, :'chq')) = 'OK');
select test.check('an unknown kind is refused', test.try(format($q$select public.cb_add_outstanding(%L, 'start', '2025-08-30', 'x', 'out', 1, null, 'other')$q$, :'chq')) like 'Choose what kind%');
select public.cb_add_outstanding(:'chq', 'start', '2025-08-30', 'Cheque #9', 'in', 2.52, null) as item \gset
select test.check('an ordinary item still works with seven arguments', (select kind from public.cb_bank_outstanding where id = :'item') = 'item');

-- Safe to run twice.
reset role;
\ir ../migrations/20261211030000_round22_live_fixes.sql
select test.check('the migration runs twice', to_regprocedure('public.statement_keep_one(uuid)') is not null
  and position('period_start < p_period_end' in pg_get_functiondef('private.cb_add_statement(uuid, uuid, text, numeric, numeric, jsonb, date, date, numeric, numeric, text)'::regprocedure)) > 0);
