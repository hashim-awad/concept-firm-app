-- Local tests: round 20 (Hashim, Nov 15, 2026), transfers between the file's own accounts in step 4, as the
-- QuickBooks Online bank feed records a transfer. Accept codes the money-out line to the other account and
-- marks the money-in line matched (it posts nothing); Undo removes both; one line in one transfer; card
-- payments from the bank; edit permission, the locked file, removing a statement, and a second run.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'viewer.b@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.create_role('Closebook viewer', 'Reads Closebook only') as viewer \gset
select public.set_role_permissions(:'viewer', '{"documents":"none","leads":"none","pricing":"none","clients":"view","closebook":"view"}');
select public.add_staff('00000000-0000-0000-0000-00000000000b', 'Test Viewer B', 'viewer.b@example.test', :'viewer'::uuid);
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test', (select id from public.roles where name = 'Staff'));
reset role;
reset request.jwt.claims;
update public.role_permissions set level = 'edit' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Staff');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
insert into public.clients (kind, legal_name, province) values ('corporation', 'Birch Dummy Realty Inc.', 'ON') returning id as client \gset
\set A '''00000000-0000-0000-0000-00000000000a'''
\set C '''00000000-0000-0000-0000-00000000000c'''
select public.cb_create_file(:'client', '2026-12-31', '2026-01-01', '', 'full', 'statements', :C::uuid, :A::uuid) as f \gset
-- Chequing 4521: 5,000.00 less a transfer to savings, a card payment and a coffee.
select (public.cb_upload_bank(:'f', null, 'Chequing 4521', 'bank', 'chq.csv', 5000, 3224.75,
  '[{"line":2,"date":"2026-03-13","description":"TFR TO SAV 7788","amount":-500},{"line":3,"date":"2026-03-20","description":"VISA PAYMENT","amount":-1200},{"line":4,"date":"2026-03-25","description":"DUMMY COFFEE","amount":-75.25}]',
  '2026-03-01', '2026-03-31')) ->> 'account_id' as chq \gset
select (public.cb_upload_bank(:'f', null, 'Savings 7788', 'bank', 'sav.csv', 0, 1000,
  '[{"line":2,"date":"2026-03-14","description":"TFR FROM CHQ 4521","amount":500},{"line":3,"date":"2026-03-30","description":"TFR FROM CHQ 4521","amount":500}]',
  '2026-03-01', '2026-03-31')) ->> 'account_id' as sav \gset
-- Visa 1234: 1,200.00 owing, paid from chequing; one new charge.
select (public.cb_upload_bank(:'f', null, 'Visa 1234', 'card', 'visa.csv', 1200, 113,
  '[{"line":2,"date":"2026-03-21","description":"PAYMENT THANK YOU","amount":-1200},{"line":3,"date":"2026-03-22","description":"DUMMY SOFTWARE","amount":113}]',
  '2026-03-01', '2026-03-31')) ->> 'account_id' as visa \gset
select public.cb_set_bank_chart_account(:'sav', '10100');
select public.cb_save_setup(:'f', '{"gst_registered": true, "gst_frequency": "quarterly", "quick_method": false}');
select id as c_tfr from public.cb_bank_lines where description = 'TFR TO SAV 7788' \gset
select id as c_visa from public.cb_bank_lines where description = 'VISA PAYMENT' \gset
select id as c_coffee from public.cb_bank_lines where description = 'DUMMY COFFEE' \gset
select id as s_in from public.cb_bank_lines where account_id = :'sav' and txn_date = '2026-03-14' \gset
select id as s_late from public.cb_bank_lines where account_id = :'sav' and txn_date = '2026-03-30' \gset
select id as v_pay from public.cb_bank_lines where description = 'PAYMENT THANK YOU' \gset
select id as v_soft from public.cb_bank_lines where description = 'DUMMY SOFTWARE' \gset

-- ---------- Permission
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b"}';
select test.check('a viewer cannot accept a transfer', test.try(format($q$select public.cb_accept_transfer(%L, %L, %L)$q$, :'f', :'c_tfr', :'s_in')) like 'You need Edit on Closebook%');
select test.check('a viewer reads transfers (none yet)', (select count(*) from public.cb_bank_transfers) = 0);

-- ---------- What is a transfer
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('amounts must be the same to the cent', test.try(format($q$select public.cb_accept_transfer(%L, %L, %L)$q$, :'f', :'c_coffee', :'s_in')) like '%same to the cent%');
select test.check('dates within 5 days', test.try(format($q$select public.cb_accept_transfer(%L, %L, %L)$q$, :'f', :'c_tfr', :'s_late')) like '%within 5 days%');
select test.check('one out and one in', test.try(format($q$select public.cb_accept_transfer(%L, %L, %L)$q$, :'f', :'s_in', :'s_late')) like '%two different accounts%'
  and test.try(format($q$select public.cb_accept_transfer(%L, %L, %L)$q$, :'f', :'c_visa', :'s_in')) like '%same to the cent%');
select test.check('the same line twice is refused', test.try(format($q$select public.cb_accept_transfer(%L, %L, %L)$q$, :'f', :'c_tfr', :'c_tfr')) like 'Choose two lines%');

-- ---------- Accept: chequing to savings. Passed money-in first: the money-out line is still the one coded.
select public.cb_accept_transfer(:'f', :'s_in', :'c_tfr') as t1 \gset
select test.check('the money-out line is coded to the other account, no sales tax',
  (select status || '|' || chart_account || '|' || coalesce(tax_code, '-') || '|' || source from public.cb_bank_lines where id = :'c_tfr') = 'done|10100|-|transfer');
select test.check('the money-in line is matched and carries no account',
  (select status || '|' || coalesce(chart_account, '-') || '|' || coalesce(tax_code, '-') || '|' || source from public.cb_bank_lines where id = :'s_in') = 'matched|-|-|transfer');
select test.check('one transfer row, out and in', (select out_line::text || in_line::text from public.cb_bank_transfers where id = :'t1') = :'c_tfr' || :'s_in');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('the activity log names both accounts and lines, once (owners read it)',
  (select count(*) from public.cb_file_history where file_id = :'f' and action = 'transfer_matched' and step = 'code'
           and new_value like 'Chequing 4521 (Mar 13, 2026 · % · -500.00) to Savings 7788 (Mar 14, 2026 · % · 500.00)' and line_id = :'c_tfr'::uuid) = 1);
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';

-- ---------- One line in one transfer
select test.check('a matched line cannot be matched again', test.try(format($q$select public.cb_accept_transfer(%L, %L, %L)$q$, :'f', :'s_in', :'c_visa')) like '%must still be to code%');
select test.check('a coded transfer line cannot be matched again', test.try(format($q$select public.cb_accept_transfer(%L, %L, %L)$q$, :'f', :'c_tfr', :'s_late')) like '%must still be to code%');
select test.check('a line in a transfer cannot be recoded', test.try(format($q$select public.cb_code_lines(%L, '[{"id":"%s","account":"65100","tax":"HST_ON"}]')$q$, :'f', :'s_in')) like '%part of a transfer%');
select test.check('the other line cannot be recoded either', test.try(format($q$select public.cb_code_lines(%L, '[{"id":"%s","account":"65100","tax":"HST_ON"}]')$q$, :'f', :'c_tfr')) like '%part of a transfer%');
select test.check('a line in a transfer cannot go to the client', test.try(format($q$select public.cb_ask_client(%L, array[%L]::uuid[])$q$, :'f', :'s_in')) like '%part of a transfer%');
reset role;
select test.check('only a transfer marks a line matched', test.try(format($q$update public.cb_bank_lines set status = 'matched' where id = %L$q$, :'s_late')) like 'Only a transfer%');
select test.check('a second transfer row on a line already in one is refused',
  test.try(format($q$insert into public.cb_bank_transfers (file_id, out_line, in_line) values (%L, %L, %L)$q$, :'f', :'s_late', :'s_in')) <> 'OK');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';

-- ---------- Paying the card from the bank
select public.cb_accept_transfer(:'f', :'c_visa', :'v_pay') as t2 \gset
select test.check('card payment: the bank line is coded to the card, the card''s payment line is matched',
  (select status || '|' || chart_account from public.cb_bank_lines where id = :'c_visa') = 'done|22000'
  and (select status from public.cb_bank_lines where id = :'v_pay') = 'matched');

-- ---------- The step gate: a matched line is done
select public.cb_code_lines(:'f', format('[{"id":"%s","account":"65100","tax":"HST_ON"},{"id":"%s","account":"65200","tax":"HST_ON"},{"id":"%s","account":"10900","tax":"OUT_OF_SCOPE"}]',
  :'c_coffee', :'v_soft', :'s_late')::jsonb) as coded \gset
reset role;
select test.check('every line coded or matched: nothing left to code on step 4',
  not exists (select 1 from unnest(private.cb_step_problems(:'f', 'code')) p where p like '%to code%'));
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';

-- ---------- Undo removes both
select test.check('undo from the matched line', public.cb_undo_transfer(:'f', :'s_in') = 2);
select test.check('both lines are back to code, cleared',
  (select string_agg(status || '|' || coalesce(chart_account, '-') || '|' || coalesce(tax_code, '-') || '|' || source, ',' order by txn_date) from public.cb_bank_lines where id in (:'c_tfr', :'s_in')) = 'new|-|-|,new|-|-|'
  and not exists (select 1 from public.cb_bank_transfers where id = :'t1'));
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('the undo is in the activity log (round 24: with both lines)', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'transfer_unmatched'
  and old_value like 'Chequing 4521 (Mar 13, 2026 · % · -500.00) to Savings 7788 (Mar 14, 2026 · % · 500.00)'));
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('undo on a line not in a transfer says so', test.try(format($q$select public.cb_undo_transfer(%L, %L)$q$, :'f', :'c_coffee')) like '%not part of a transfer%');
select public.cb_uncode_lines(:'f', array[:'c_visa']::uuid[]) as undone \gset
select test.check('Undo on a coded transfer line (the round 2 Undo) undoes the whole transfer',
  (select string_agg(status, ',') from public.cb_bank_lines where id in (:'c_visa', :'v_pay')) = 'new,new' and not exists (select 1 from public.cb_bank_transfers where file_id = :'f'));
select test.check('accept again after undo', public.cb_accept_transfer(:'f', :'c_tfr', :'s_in') is not null);

-- ---------- Round 24: a statement in a transfer is not excluded until the transfer is undone
select (public.cb_exclude_statement((select statement_id from public.cb_bank_lines where id = :'s_in'), 'wrong_account', '') -> 'blockers' -> 0 ->> 'kind') as kind \gset
select test.check('a statement with a matched transfer line is not excluded', :'kind' = 'transfer');
select public.cb_undo_transfer(:'f', :'s_in');
-- Its other line is coded to Clearing: uncoded first (each undo is logged).
select public.cb_uncode_lines(:'f', array(select id from public.cb_bank_lines where statement_id = (select statement_id from public.cb_bank_lines where id = :'s_in') and status = 'done'));
select (public.cb_exclude_statement((select statement_id from public.cb_bank_lines where id = :'s_in'), 'wrong_account', '') ->> 'ok') as ok \gset
select test.check('after the undo it is excluded; the chequing line is back to code', :'ok' = 'true'
  and (select status || '|' || coalesce(chart_account, '-') || '|' || source from public.cb_bank_lines where id = :'c_tfr') = 'new|-|'
  and not exists (select 1 from public.cb_bank_transfers where file_id = :'f'));

-- ---------- A locked file (round 24: the excluded statement's account stays, so the new one is another account)
select (public.cb_upload_bank(:'f', null, 'Savings 7799', 'bank', 'sav.csv', 0, 500,
  '[{"line":2,"date":"2026-03-14","description":"TFR FROM CHQ 4521","amount":500}]', '2026-03-01', '2026-03-31')) ->> 'account_id' as sav2 \gset
select id as s_in2 from public.cb_bank_lines where account_id = :'sav2' \gset
select public.cb_accept_transfer(:'f', :'c_tfr', :'s_in2') as t3 \gset
reset role;
update public.cb_files set phase = 'locked' where id = :'f';
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('a locked file: no undo', test.try(format($q$select public.cb_undo_transfer(%L, %L)$q$, :'f', :'s_in2')) like '%locked%'
  and test.try(format($q$select public.cb_uncode_lines(%L, array[%L]::uuid[])$q$, :'f', :'c_tfr')) like '%locked%');
select test.check('a locked file: no new transfer', test.try(format($q$select public.cb_accept_transfer(%L, %L, %L)$q$, :'f', :'c_visa', :'v_pay')) like '%locked%');
reset role;
reset request.jwt.claims;
select set_config('cb.unlock', 'on', false) as unlock \gset
update public.cb_files set phase = 'fieldwork' where id = :'f';
select set_config('cb.unlock', '', false) as unlock \gset

-- ---------- Safe to run twice; a file with transfers can still be deleted
\ir ../migrations/20261209040000_round20_transfers.sql
select test.check('a second run keeps one status and one source value each',
  (select count(*) from pg_constraint where conrelid = 'public.cb_bank_lines'::regclass and conname in ('cb_bank_lines_status_check', 'cb_bank_lines_source_check')) = 2
  and (select pg_get_constraintdef(oid) from pg_constraint where conname = 'cb_bank_lines_status_check') like '%''reviewer''::text, ''matched''::text%'  -- round 31 adds 'excluded' after it
  and (select length(pg_get_constraintdef(oid)) - length(replace(pg_get_constraintdef(oid), 'matched', '')) from pg_constraint where conname = 'cb_bank_lines_status_check') = 7
  and (select pg_get_constraintdef(oid) from pg_constraint where conname = 'cb_bank_lines_source_check') like '%''transfer''%'
  and exists (select 1 from public.cb_bank_transfers where id = :'t3'));
delete from public.cb_files where id = :'f';
select test.check('deleting the file removes its lines and transfers', not exists (select 1 from public.cb_bank_transfers) and not exists (select 1 from public.cb_bank_lines));
