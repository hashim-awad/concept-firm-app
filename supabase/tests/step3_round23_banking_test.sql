-- Local tests: round 23 (Hashim, Nov 16, 2026), step 3 "Banking" with sub-steps 3.1, 3.2 and 3.3, each signed on
-- its own; step 3 follows them. Cases from Hashim's list: H2 (the same statement twice), H3 (a month missing),
-- H6 and H7 (rounding against the T2), H9 (one CSV for the year), H10 (an outstanding cheque at the start), H11
-- (delete a statement whose lines are coded). Dummy data only.
\set ON_ERROR_STOP 1
create function test.sp(p uuid, s text) returns text language sql security definer set search_path = '' as $$ select private.cb_banking_problems(p, s)::text $$;
grant execute on function test.sp(uuid, text) to authenticated;
-- A statement straight to the books, as the import does once its checks pass. rows: [[date, amount], ...]
create function test.add(p_file uuid, p_acc uuid, p_from date, p_to date, p_open numeric, p_rows jsonb, p_name text default null) returns text language plpgsql as $$
declare v_close numeric; v_start numeric; v_end numeric;
begin
  select p_open + coalesce(sum((r ->> 1)::numeric), 0) into v_close from jsonb_array_elements(p_rows) r;
  if p_from < '2025-09-01' then select p_open + coalesce(sum((r ->> 1)::numeric), 0) into v_start from jsonb_array_elements(p_rows) r where (r ->> 0)::date < '2025-09-01'; end if;
  if p_to > '2026-08-31' then select p_open + coalesce(sum((r ->> 1)::numeric), 0) into v_end from jsonb_array_elements(p_rows) r where (r ->> 0)::date <= '2026-08-31'; end if;
  if p_from = '2025-09-01' then v_start := p_open; end if;
  if p_to = '2026-08-31' then v_end := v_close; end if;
  perform private.cb_add_statement(p_file, p_acc, coalesce(p_name, format('rbc-%s.pdf', p_from)), p_open, v_close,
    (select jsonb_agg(jsonb_build_object('line', o, 'date', r ->> 0, 'description', 'DUMMY LINE ' || o, 'amount', (r ->> 1)::numeric)) from jsonb_array_elements(p_rows) with ordinality x(r, o)),
    p_from, p_to, v_start, v_end, null);
  return 'added';
exception when others then return sqlerrm;
end;
$$;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
insert into public.clients (kind, legal_name, province) values ('corporation', 'Maple Dummy Realty Inc.', 'ON') returning id as client \gset
\set A '''00000000-0000-0000-0000-00000000000a'''
select public.cb_create_file(:'client', '2026-08-31', '2025-09-01', '', 'full', 'statements', :A::uuid, :A::uuid) as f \gset
reset role;
insert into public.cb_opening_balances (file_id, code, amount) values (:'f', '1002', 512.00);
update public.cb_files set opening_source = 'manual' where id = :'f';
set role authenticated;

-- ---------- 3.1 Bank accounts & T2 tie-out
select test.check('3.1 with no account: add the accounts', test.sp(:'f', '3.1') = array['Add the bank and card accounts.']::text);
select public.cb_save_bank_account(:'f', null, 'chequing', 'RBC', '2468', 514.40, false, false) as chq \gset
select test.check('H7: 514.40 against the T2''s 512: too much is listed on 3.1',
  test.sp(:'f', '3.1') = array['GIFI 1002: the accounts total 514.40, last year''s T2 has 512.00 (2.40 too much).']::text);
select test.check('H7: 3.1 can still be signed (CB2-0: a warning, not a stop)',
  test.try(format($q$select public.cb_sign_substep(%L, '3.1', 'prepared')$q$, :'f')) = 'OK');
select public.cb_unsign_substep(:'f', '3.1', 'prepared');   -- the preparer takes their own sign-off back to fix the balance
select public.cb_save_bank_account(:'f', :'chq', 'chequing', 'RBC', '2468', 511.00, false, false);
select test.check('below the T2 by 1.00 or more: to add', test.sp(:'f', '3.1') like '%(1.00 to add)%');
select public.cb_save_bank_account(:'f', :'chq', 'chequing', 'RBC', '2468', 512.40, false, false);
select test.check('H6: 512.40 against 512: rounding, nothing to do', test.sp(:'f', '3.1') = '{}');
select public.cb_sign_substep(:'f', '3.1', 'prepared');
select test.check('3.1 signed as prepared; step 3 not yet', exists (select 1 from public.cb_substep_signoffs where file_id = :'f' and substep = '3.1' and prepared_by = :A::uuid)
  and not exists (select 1 from public.cb_step_signoffs where file_id = :'f' and step = 'records'));
select test.check('step 3 itself is signed in its sub-steps', test.try(format($q$select public.cb_sign_step(%L, 'records', 'prepared')$q$, :'f')) = 'Step 3 is signed in its sub-steps: 3.1, 3.2 and 3.3.');

-- ---------- 3.2 Bank feeds. The bank had 1,262.40 on Aug 31, 2025: cheque #121 of 750.00 was outstanding (cleared Sep 9).
reset role;
select test.check('3.2: not uploaded', test.sp(:'f', '3.2') = array['10000 Chequing · RBC ••• 2468: not uploaded.']::text);
select test.add(:'f', :'chq', '2025-09-01', '2025-09-30', 1262.40, '[["2025-09-09", -750.00], ["2025-09-15", 850.00]]');
select test.add(:'f', :'chq', m::date, (m + interval '1 month - 1 day')::date, 1262.40 + 100 * k, ('[["' || (m::date + 10) || '", 100.00]]')::jsonb)
  from generate_series(1, 11) k, lateral (select ('2025-09-01'::date + make_interval(months => k))::timestamp m) x where k <> 4;
select test.check('H3: one month missing: 1 missing, the period named in 3.2', test.sp(:'f', '3.2') = array['10000 Chequing · RBC ••• 2468: 1 missing.']::text);
select test.check('H3: 3.3 waits for it (no DIFFERENCE yet)', test.sp(:'f', '3.3') not like '%DIFFERENCE%');
select test.check('H3: the missing period is January', (select count(*) from public.cb_bank_statements where account_id = :'chq' and period_start = '2026-01-01') = 0);
select test.add(:'f', :'chq', '2026-01-01', '2026-01-31', 1662.40, '[["2026-01-11", 100.00]]');
select test.check('H3: uploading it makes the account Complete', test.sp(:'f', '3.2') = '{}');
select test.check('H2: the same statement again is refused, no line twice', test.add(:'f', :'chq', '2026-01-01', '2026-01-31', 1662.40, '[["2026-01-11", 100.00]]') like '%overlaps%'
  and (select count(*) from public.cb_bank_lines where account_id = :'chq' and txn_date = '2026-01-11') = 1);
set role authenticated;
select public.cb_sign_substep(:'f', '3.2', 'prepared');

-- ---------- 3.3 Reconcile
select test.check('H10: the start of the year differs from the bank by 750.00: explain it', test.sp(:'f', '3.3') = array['10000 Chequing · RBC ••• 2468: the start of the year differs from the bank by (750.00). Explain it.']::text);
select test.check('3.3 can be signed with the difference open (CB2-0: a warning, not a stop)', test.try(format($q$select public.cb_sign_substep(%L, '3.3', 'prepared')$q$, :'f')) = 'OK');
select public.cb_unsign_substep(:'f', '3.3', 'prepared');   -- the preparer takes their own sign-off back to explain it
select id as l121 from public.cb_bank_lines where account_id = :'chq' and txn_date = '2025-09-09' \gset
select public.cb_add_outstanding(:'chq', 'start', '2025-08-28', 'Cheque #121', 'out', 750, :'l121') as item \gset
select test.check('H10: the Sep 9 line posts nothing; DIFFERENCE 0.00; 3.3 has nothing to do', (select status = 'matched' and source = 'outstanding' from public.cb_bank_lines where id = :'l121')
  and test.sp(:'f', '3.3') = '{}');
select test.check('adding the item did not clear 3.1 or 3.2', (select count(*) from public.cb_substep_signoffs where file_id = :'f' and prepared_at is not null) = 2);
select public.cb_sign_substep(:'f', '3.3', 'prepared');
select test.check('all three prepared: step 3 is prepared', exists (select 1 from public.cb_step_signoffs where file_id = :'f' and step = 'records' and prepared_at is not null and reviewed_at is null));
select public.cb_sign_substep(:'f', '3.1', 'reviewed'); select public.cb_sign_substep(:'f', '3.2', 'reviewed');
select test.check('two of three reviewed: step 3 not reviewed', (select reviewed_at is null from public.cb_step_signoffs where file_id = :'f' and step = 'records'));
select public.cb_sign_substep(:'f', '3.3', 'reviewed');
select test.check('all three reviewed: step 3 is reviewed', (select reviewed_at is not null from public.cb_step_signoffs where file_id = :'f' and step = 'records'));
select test.check('cb_substep_status shows each sub-step', (public.cb_substep_status(:'f') -> '3.2' ->> 'reviewed_by') = '00000000-0000-0000-0000-00000000000a');

-- CB2-0 step 2: a change saved after sign-off keeps every sign-off; History has it.
select public.cb_remove_outstanding(:'item');
select test.check('an outstanding item changed: 3.1, 3.2, 3.3 and step 3 all kept',
  (select array_agg(substep order by substep) from public.cb_substep_signoffs where file_id = :'f') = array['3.1', '3.2', '3.3']
  and exists (select 1 from public.cb_step_signoffs where file_id = :'f' and step = 'records' and reviewed_at is not null));
select public.cb_add_outstanding(:'chq', 'start', '2025-08-28', 'Cheque #121', 'out', 750, :'l121') as item \gset

-- ---------- H11: delete a statement after its lines are coded
reset role;
update public.cb_bank_lines set status = 'done', chart_account = '65100', coded_by = :A::uuid, coded_at = now() where account_id = :'chq' and txn_date = '2026-03-11';
set role authenticated;
select id as mar from public.cb_bank_statements where account_id = :'chq' and period_start = '2026-03-01' \gset
select test.check('H11: the statement has 1 coded line (the screen says so first)', (select count(*) from public.cb_bank_lines where statement_id = :'mar' and status <> 'new') = 1);
-- Round 24: a statement is not deleted; with a coded line it is not excluded either, until the line is uncoded.
select public.cb_exclude_statement(:'mar', 'wrong_period', '') as ex \gset
select test.check('H11 (round 24): excluding it is refused while its line is coded; the line is listed', (:'ex'::jsonb ->> 'ok') = 'false'
  and jsonb_array_length(:'ex'::jsonb -> 'blockers') = 1 and (:'ex'::jsonb -> 'blockers' -> 0 ->> 'kind') = 'coded');
select public.cb_uncode_lines(:'f', array(select id from public.cb_bank_lines where statement_id = :'mar' and status <> 'new'));
select (public.cb_exclude_statement(:'mar', 'wrong_period', '', true) ->> 'ok') as ok \gset
select test.check('H11: after the uncode it is excluded; its lines leave the feed; 3.2 shows March missing and keeps its sign-off (CB2-0)', :'ok' = 'true'
  and not exists (select 1 from public.cb_bank_lines where statement_id = :'mar') and test.sp(:'f', '3.2') = array['10000 Chequing · RBC ••• 2468: 1 missing.']::text
  and exists (select 1 from public.cb_substep_signoffs where file_id = :'f' and substep = '3.2'));

-- ---------- H9: one CSV for the whole year, on a second account
-- Round 25: 3.1 is signed: adding an account asks first; Continue.
select public.cb_save_bank_account(:'f', null, 'savings', 'RBC', '1357', 2000.00, false, false, true) as sav \gset
select test.check('a CSV that does not add up is refused', test.try(format($q$select public.cb_import_csv(%L, %L, 'year.csv', 2000, 9999, '[{"line":1,"date":"2025-09-05","description":"X","amount":10}]')$q$, :'f', :'sav')) like '%does not balance%');
select public.cb_import_csv(:'f', :'sav', 'year.csv', 1990.00, 2340.00, ('[{"line":1,"date":"2025-08-28","description":"BEFORE THE YEAR","amount":10.00},'
  || '{"line":2,"date":"2025-09-03","description":"DEPOSIT","amount":300.00},{"line":3,"date":"2026-02-14","description":"FEE","amount":-5.00},'
  || '{"line":4,"date":"2026-08-25","description":"DEPOSIT","amount":40.00},{"line":5,"date":"2026-09-02","description":"AFTER THE YEAR","amount":5.00}]')::jsonb) as csv \gset
select test.check('H9: the CSV keeps the 3 lines in the year, leaves 2 out, and gives the bank at each edge',
  (:'csv'::jsonb ->> 'lines')::int = 3 and (:'csv'::jsonb ->> 'outside')::int = 2
  and (select source = 'csv' and at_start = 2000.00 and at_end = 2335.00 and period_start = '2025-08-28' and period_end = '2026-09-02' from public.cb_bank_statements where account_id = :'sav'));
select test.check('H9: the CSV account is Complete and adds up (3.2, 3.3)', test.sp(:'f', '3.2') not like '%Savings%' and test.sp(:'f', '3.3') not like '%Savings%');
select test.check('the same CSV again is refused', test.try(format($q$select public.cb_import_csv(%L, %L, 'year.csv', 1990, 2000, '[{"line":1,"date":"2025-09-05","description":"X","amount":10}]')$q$, :'f', :'sav')) like '%overlaps%');

-- ---------- An existing file: a step 3 signed before round 23 carries to its three sub-steps, nothing else moves.
reset role;
insert into public.clients (kind, legal_name, province) values ('corporation', 'Old Dummy Realty Inc.', 'ON') returning id as client2 \gset
set role authenticated;
select public.cb_create_file(:'client2', '2026-08-31', '2025-09-01', '', 'full', 'statements', :A::uuid, :A::uuid) as g \gset
reset role;
insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at) values (:'g', 'records', :A::uuid, now());
select count(*) as before_f from public.cb_substep_signoffs where file_id = :'f' \gset
\ir ../migrations/20261211040000_round23_banking.sql
select test.check('the migration runs twice; a signed step 3 carries to 3.1, 3.2 and 3.3',
  (select array_agg(substep order by substep) from public.cb_substep_signoffs where file_id = :'g' and prepared_at is not null) = array['3.1', '3.2', '3.3']
  and (select count(*) from public.cb_substep_signoffs where file_id = :'f') = :'before_f'::int);
