-- Local tests: round 24 (Hashim, Nov 16, 2026), the control rules for statements and lines. Nothing that reached the
-- feed is deleted (Exclude, Restore, Purge); the bank's data is read-only; the accounting date and memo; Replace
-- file; the sign-off locks on 3.2 and 3.3; the append-only log; the step 4 check. Dummy data only.
\set ON_ERROR_STOP 1
create function test.add(p_file uuid, p_acc uuid, p_from date, p_to date, p_open numeric, p_rows jsonb, p_name text default null) returns uuid language plpgsql security definer as $$

declare v_close numeric; v jsonb;
begin
  select p_open + coalesce(sum((r ->> 1)::numeric), 0) into v_close from jsonb_array_elements(p_rows) r;
  v := private.cb_add_statement(p_file, p_acc, coalesce(p_name, format('rbc-%s.pdf', p_from)), p_open, v_close,
    (select jsonb_agg(jsonb_build_object('line', o, 'date', r ->> 0, 'description', coalesce(r ->> 2, 'DUMMY LINE ' || o), 'amount', (r ->> 1)::numeric)) from jsonb_array_elements(p_rows) with ordinality x(r, o)),
    p_from, p_to, case when p_from = '2025-09-01' then p_open end, case when p_to = '2026-08-31' then v_close end, null);
  return (v ->> 'statement')::uuid;
end;
$$;
-- The file history, read past its owners-only policy (the tests check what is written, as any role).
create function test.h() returns setof public.cb_file_history language sql security definer set search_path = '' as $$ select * from public.cb_file_history $$;
grant execute on function test.h() to authenticated;
create function test.sp(p uuid, s text) returns text language sql security definer set search_path = '' as $$ select private.cb_banking_problems(p, s)::text $$;
create function test.tie(p uuid) returns text[] language sql security definer set search_path = '' as $$ select private.cb_code_tie_problems(p) $$;
create function test.code(p uuid) returns text language sql security definer set search_path = '' as $$ select private.cb_step_problems(p, 'code')::text $$;
grant execute on function test.sp(uuid, text), test.tie(uuid), test.code(uuid), test.add(uuid, uuid, date, date, numeric, jsonb, text) to authenticated;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test', (select id from public.roles where name = 'Accountant'));
reset role;
update public.role_permissions set level = 'edit' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Accountant');
set role authenticated;
insert into public.clients (kind, legal_name, province) values ('corporation', 'Maple Dummy Realty Inc.', 'ON') returning id as client \gset
\set A '''00000000-0000-0000-0000-00000000000a'''
\set C '''00000000-0000-0000-0000-00000000000c'''
-- Staff C prepares, owner A reviews.
select public.cb_create_file(:'client', '2026-08-31', '2025-09-01', '', 'full', 'statements', :C::uuid, :A::uuid) as f \gset
select public.cb_save_setup(:'f', '{"gst_registered": true, "gst_frequency": "quarterly", "quick_method": false}');
select public.cb_save_bank_account(:'f', null, 'chequing', 'RBC', '2468', 512.40, false, false) as chq \gset
select public.cb_save_bank_account(:'f', null, 'savings', 'RBC', '5678', 1000.00, false, false) as sav \gset
reset role;
select test.add(:'f', :'chq', '2025-09-01', '2025-09-30', 1262.40,
  '[["2025-09-03", -40.00, "COFFEE SHOP"], ["2025-09-09", -750.00, "CHEQUE #121"], ["2025-09-12", -200.00, "TFR TO SAV 5678"], ["2025-09-20", 900.00, "DEPOSIT"]]') as sep \gset
select test.add(:'f', :'sav', '2025-09-01', '2025-09-30', 1000.00, '[["2025-09-13", 200.00, "TFR FROM CHQ 2468"]]') as savsep \gset
set role authenticated;
select id as l_coffee from public.cb_bank_lines where statement_id = :'sep' and description = 'COFFEE SHOP' \gset
select id as l_121 from public.cb_bank_lines where statement_id = :'sep' and description = 'CHEQUE #121' \gset
select id as l_tfr from public.cb_bank_lines where statement_id = :'sep' and description = 'TFR TO SAV 5678' \gset
select id as l_dep from public.cb_bank_lines where statement_id = :'sep' and description = 'DEPOSIT' \gset
select id as s_in from public.cb_bank_lines where statement_id = :'savsep' \gset

-- ---------- The accounting date (rule 5)
select test.check('every line starts with its accounting date equal to the bank date', not exists (select 1 from public.cb_bank_lines where file_id = :'f' and acct_date <> txn_date));
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('T13: a date outside the year is refused', test.try(format($q$select public.cb_set_line_date(%L, '2025-08-28')$q$, :'l_coffee')) = 'Outside the year. Use an entry to move it to another year.');
select public.cb_set_line_date(:'l_coffee', '2025-09-01');
select test.check('T13: a date inside the year is kept; the bank date does not change', (select acct_date = '2025-09-01' and txn_date = '2025-09-03' from public.cb_bank_lines where id = :'l_coffee'));
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('T13: the change is logged with the old and new date and who', exists (select 1 from test.h() where file_id = :'f' and action = 'line_date'
  and old_value = 'Sep 3, 2025' and new_value = 'Sep 1, 2025' and line_id = :'l_coffee'::uuid and actor_id = :C::uuid));
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';

-- ---------- The bank's own data is read-only; the memo (rules 3, 5, 6; T8)
reset role;
select test.check('T8: the description cannot change, even by the database owner', test.try(format($q$update public.cb_bank_lines set description = 'X' where id = %L$q$, :'l_coffee')) like '%cannot change after import%');
select test.check('T8: nor the amount', test.try(format($q$update public.cb_bank_lines set amount = -41 where id = %L$q$, :'l_coffee')) like '%cannot change after import%');
select test.check('T8: nor the bank date', test.try(format($q$update public.cb_bank_lines set txn_date = '2025-09-04' where id = %L$q$, :'l_coffee')) like '%cannot change after import%');
select test.check('a statement''s balances cannot change', test.try(format($q$update public.cb_bank_statements set closing = 1 where id = %L$q$, :'sep')) like '%cannot change%');
set role authenticated;
select public.cb_set_line_memo(:'l_coffee', 'Client meeting with the broker');
select test.check('T8: the memo is kept beside the bank''s description; it is logged', (select memo = 'Client meeting with the broker' and description = 'COFFEE SHOP' from public.cb_bank_lines where id = :'l_coffee')
  and exists (select 1 from test.h() where file_id = :'f' and action = 'line_memo' and new_value = 'Client meeting with the broker'));

-- ---------- Coding, transfers, outstanding items (rule 7; T4, T5)
select public.cb_code_lines(:'f', ('[{"id":"' || :'l_coffee' || '","account":"60200","tax":"MEALS_HST_50"}]')::jsonb) is not null as ok \gset
select public.cb_code_lines(:'f', ('[{"id":"' || :'l_121' || '","account":"65100","tax":"OUT_OF_SCOPE"}]')::jsonb);
select public.cb_accept_transfer(:'f', :'l_tfr', :'s_in') as t1 \gset
select test.check('coding and the transfer are logged with the line and the account', (select count(*) from test.h() where file_id = :'f' and action = 'line_coded' and line_id in (:'l_coffee'::uuid, :'l_121'::uuid)) = 2
  and exists (select 1 from test.h() where file_id = :'f' and action = 'transfer_matched' and line_id = :'l_tfr'::uuid and new_value like 'Chequing · RBC ••• 2468 (%) to Savings · RBC ••• 5678 (%)'));
select public.cb_add_outstanding(:'chq', 'start', '2025-08-28', 'Cheque #121', 'out', 750, :'l_121') as item \gset
select test.check('T4: a coded line that clears last year''s cheque posts nothing while the item is there; its coding is kept aside',
  (select status = 'matched' and source = 'outstanding' and chart_account is null from public.cb_bank_lines where id = :'l_121')
  and (select prior_status = 'done' and prior_chart = '65100' from public.cb_bank_outstanding where id = :'item'));
select public.cb_remove_outstanding(:'item');
select test.check('T4: removing the item gives the line its coding back (the posting returns)', (select status = 'done' and chart_account = '65100' and source <> 'outstanding' from public.cb_bank_lines where id = :'l_121')
  and (select count(*) from test.h() where file_id = :'f' and action = 'bank_outstanding' and line_id = :'l_121'::uuid) = 2);
select public.cb_add_outstanding(:'chq', 'start', '2025-08-28', 'Cheque #121', 'out', 750, :'l_121') as item \gset

-- ---------- Exclude statement (rule 9; T5)
select test.check('a reason is required', test.try(format($q$select public.cb_exclude_statement(%L, '', '')$q$, :'sep')) = 'Choose the reason.');
select test.check('Other needs words', test.try(format($q$select public.cb_exclude_statement(%L, 'other', ' ')$q$, :'sep')) = 'Say why (Other).');
select public.cb_exclude_statement(:'sep', 'wrong_account', '') as ex \gset
select test.check('T5: refused while lines are coded, a transfer or clear an item; each is listed',
  (:'ex'::jsonb ->> 'ok') = 'false' and (select string_agg(b ->> 'kind', ',' order by b ->> 'date') from jsonb_array_elements(:'ex'::jsonb -> 'blockers') b) = 'coded,outstanding,transfer');
select public.cb_uncode_lines(:'f', array[:'l_coffee']::uuid[]);
select public.cb_remove_outstanding(:'item');
select public.cb_uncode_lines(:'f', array[:'l_121']::uuid[]);
select public.cb_undo_transfer(:'f', :'l_tfr');
select public.cb_ask_client(:'f', array[:'l_dep']::uuid[]);
select public.cb_exclude_statement(:'sep', 'wrong_account', '') as ex \gset
select test.check('T5: after the undos it is excluded; its lines leave the feed', (:'ex'::jsonb ->> 'ok') = 'true' and (:'ex'::jsonb ->> 'lines')::int = 4
  and not exists (select 1 from public.cb_bank_lines where statement_id = :'sep') and not exists (select 1 from public.cb_bank_statements where id = :'sep'));
select test.check('T5: it stays visible under Excluded with the reason, who and when; the lines as they were (memo, date, client question)',
  (select reason = 'wrong_account' and excluded_by = :C::uuid and lines = 4 from public.cb_excluded_statements where id = :'sep')
  and (select count(*) from public.cb_excluded_statements x, jsonb_array_elements(x.line_rows) e where x.id = :'sep'
       and ((e ->> 'id') = :'l_coffee' and (e ->> 'memo') = 'Client meeting with the broker' and (e ->> 'acct_date') = '2025-09-01'
         or (e ->> 'id') = :'l_dep' and (e ->> 'status') = 'ask_client')) = 2);
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('T5: the log has the uncodes, the unmatch and the exclusion with its reason and line count',
  (select count(*) from test.h() where file_id = :'f' and action = 'line_uncoded') = 2
  and exists (select 1 from test.h() where file_id = :'f' and action = 'transfer_unmatched' and line_id = :'l_tfr'::uuid)
  and exists (select 1 from test.h() where file_id = :'f' and action = 'statement_excluded' and reason = 'Wrong account' and detail like '%4 lines left the feed%'));
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('T5: September shows missing again in 3.2', test.sp(:'f', '3.2') like '%Chequing%missing%');

-- ---------- Upload again, Restore (rules 10, 14; T6)
select test.add(:'f', :'chq', '2025-09-01', '2025-09-30', 1262.40,
  '[["2025-09-03", -40.00, "COFFEE SHOP"], ["2025-09-09", -750.00, "CHEQUE #121"], ["2025-09-12", -200.00, "TFR TO SAV 5678"], ["2025-09-20", 900.00, "DEPOSIT"]]', 'again.pdf') as sep2 \gset
select test.check('T6: the same statement uploads again after it was excluded', :'sep2' is not null and exists (select 1 from public.cb_bank_statements where id = :'sep2'));
select test.check('T6: restoring the excluded one is refused, naming the new one',
  test.try(format($q$select public.cb_restore_statement(%L)$q$, :'sep')) = 'Not restored: again.pdf (Sep 1, 2025 to Sep 30, 2025) is now imported for this period. Exclude it first if this one is right.');
select public.cb_exclude_statement(:'sep2', 'twice', '');
select public.cb_restore_statement(:'sep');
select test.check('restore puts it back exactly as it was', (select acct_date = '2025-09-01' and memo = 'Client meeting with the broker' from public.cb_bank_lines where id = :'l_coffee')
  and (select status from public.cb_bank_lines where id = :'l_dep') = 'ask_client' and not exists (select 1 from public.cb_excluded_statements where id = :'sep'));

-- ---------- Replace file (rule 8; T7)
reset role;
insert into public.cb_statement_imports (id, file_id, created_by, file_name, media_type, storage_path, status, file_sha256, summary, finished_at)
values ('00000000-0000-0000-0000-0000000024a1', :'f', :C::uuid, 'clearer.pdf', 'application/pdf', 'f/a1.pdf', 'ready', 'sha-clear', '{}', now()),
       ('00000000-0000-0000-0000-0000000024a2', :'f', :C::uuid, 'other.pdf', 'application/pdf', 'f/a2.pdf', 'ready', 'sha-other', '{}', now()),
       ('00000000-0000-0000-0000-0000000024a3', :'f', :C::uuid, 'clearest.pdf', 'application/pdf', 'f/a3.pdf', 'ready', 'sha-clearest', '{}', now());
set role authenticated;
select public.cb_mark_replacement(array['00000000-0000-0000-0000-0000000024a1', '00000000-0000-0000-0000-0000000024a2', '00000000-0000-0000-0000-0000000024a3']::uuid[], :'sep');
\set same '''[{"line":1,"date":"2025-09-03","amount":-40.00},{"line":2,"date":"2025-09-09","amount":-750.00},{"line":3,"date":"2025-09-12","amount":-200.00},{"line":4,"date":"2025-09-20","amount":900.00}]'''
\set diff '''[{"line":1,"date":"2025-09-03","amount":-40.00},{"line":2,"date":"2025-09-09","amount":-705.00},{"line":3,"date":"2025-09-12","amount":-200.00},{"line":4,"date":"2025-09-20","amount":945.00}]'''
select test.check('T7: a file with one different amount is refused',
  test.try(format($q$select public.cb_replace_statement_file(%L, '00000000-0000-0000-0000-0000000024a2', '2468', '2025-09-01', '2025-09-30', 1262.40, 1172.40, %L, 'x.pdf')$q$, :'sep', :diff))
  = 'This file doesn''t match the imported statement. To change its lines, exclude it and upload the right one.');
select public.cb_replace_statement_file(:'sep', '00000000-0000-0000-0000-0000000024a1', '2468', '2025-09-01', '2025-09-30', 1262.40, 1172.40, :same, 'closebook/x/clearer.pdf');
select test.check('T7: a clearer copy replaces the file; the lines and the accounting date are unchanged; the old file is in the history',
  (select file_name = 'clearer.pdf' and statement_import_id = '00000000-0000-0000-0000-0000000024a1' from public.cb_bank_statements where id = :'sep')
  and (select acct_date = '2025-09-01' from public.cb_bank_lines where id = :'l_coffee') and (select count(*) from public.cb_bank_lines where statement_id = :'sep') = 4
  and exists (select 1 from public.cb_statement_files where statement_id = :'sep' and file_name = 'rbc-2025-09-01.pdf'));

-- ---------- The sign-off locks (rule 17; T9)
reset role;
insert into public.cb_substep_signoffs (file_id, substep, prepared_by, prepared_at, reviewed_by, reviewed_at) values (:'f', '3.3', :C::uuid, now(), :A::uuid, now());
set role authenticated;
select test.check('T9: the preparer cannot exclude', test.try(format($q$select public.cb_exclude_statement(%L, 'wrong_period', '', true)$q$, :'sep')) = 'Ask the reviewer to remove the 3.3 sign-off.');
select test.check('T9: nor replace the file', test.try(format($q$select public.cb_replace_statement_file(%L, '00000000-0000-0000-0000-0000000024a3', '2468', '2025-09-01', '2025-09-30', 1262.40, 1172.40, %L, 'y.pdf', true)$q$, :'sep', :same))
  like 'Ask the reviewer to remove the 3.3 sign-off.');
select test.check('T9: nor upload', test.try(format($q$select public.cb_feed_unlock(%L)$q$, :'f')) = 'Ask the reviewer to remove the 3.3 sign-off.');
select test.check('T9: nor change the opening', test.try(format($q$select public.cb_save_bank_account(%L, %L, 'chequing', 'RBC', '2468', 600.00, false, false, true)$q$, :'f', :'chq')) = 'Ask the reviewer to remove the 3.3 sign-off.');
select test.check('T9: nothing changed', (select acct_date = '2025-09-01' from public.cb_bank_lines where id = :'l_coffee') and (select books_opening from public.cb_bank_accounts where id = :'chq') = 512.40
  and exists (select 1 from public.cb_substep_signoffs where file_id = :'f' and substep = '3.3'));
-- Round 34 (Hashim): the accounting date and the memo are step 4's; they never touch 3.2 or 3.3.
select public.cb_set_line_date(:'l_coffee', '2025-09-02', false);
select public.cb_set_line_memo(:'l_coffee', 'x', false);
select test.check('T9 (round 34): the accounting date and the memo change; 3.3 stays signed', (select acct_date = '2025-09-02' and memo = 'x' from public.cb_bank_lines where id = :'l_coffee')
  and exists (select 1 from public.cb_substep_signoffs where file_id = :'f' and substep = '3.3' and reviewed_at is not null));
reset role;
update public.cb_substep_signoffs set reviewed_by = null, reviewed_at = null where file_id = :'f' and substep = '3.3';
set role authenticated;
-- Round 34: a statement change (here, Upload statements after Continue) removes the preparer's sign-off, logged.
select public.cb_feed_unlock(:'f');
select test.check('with Continue the preparer''s sign-off goes (logged)', not exists (select 1 from public.cb_substep_signoffs where file_id = :'f' and substep = '3.3'));
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('the removal is in the history, with the reason', exists (select 1 from test.h() where file_id = :'f' and action = 'signoff_removed' and reason = 'statements to upload'
  and detail = '3.3 sign-off removed: statements to upload'));

-- ---------- Purge (rule 11; T10) and accounts (rule 16; T11)
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('T11: an account with an excluded statement cannot be deleted', test.try(format($q$select public.cb_remove_bank_account(%L)$q$, :'chq')) like '%imported or excluded%');
select test.check('purge is for a statement excluded as Wrong client only', test.try(format($q$select public.cb_purge_statement(%L)$q$, :'sep2')) = 'Only an Admin can purge.');
select public.cb_exclude_statement(:'sep', 'wrong_client', '');
select test.check('T10: a preparer cannot purge', test.try(format($q$select public.cb_purge_statement(%L)$q$, :'sep')) = 'Only an Admin can purge.');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('an owner cannot purge a statement excluded for another reason', test.try(format($q$select public.cb_purge_statement(%L)$q$, :'sep2')) = 'Only a statement excluded as Wrong client can be purged.');
reset role;
insert into public.cb_file_history (file_id, action, step, detail) values (:'f', 'statement_read', 'records', 'PDF statement read: clearer.pdf (ready to check).');
set role authenticated;
select public.cb_purge_statement(:'sep') as purged \gset
select test.check('T10: the statement and its lines are gone; the stored files are returned for removal', not exists (select 1 from public.cb_excluded_statements where id = :'sep')
  and not exists (select 1 from public.cb_statement_files where statement_id = :'sep')
  and not exists (select 1 from public.cb_statement_imports where id = '00000000-0000-0000-0000-0000000024a1')
  and (:'purged'::jsonb -> 'documents') ? 'closebook/x/clearer.pdf');
select test.check('T10: the log keeps who, when, the reason and the line count, and no amounts, dates or descriptions',
  exists (select 1 from test.h() where file_id = :'f' and action = 'statement_purged' and actor_id = :A::uuid and reason = 'Wrong client' and detail = 'Statement purged: 4 lines erased.' and ref_label = '')
  and not exists (select 1 from test.h() where file_id = :'f' and (statement_id = :'sep'::uuid or line_id in (:'l_coffee'::uuid, :'l_121'::uuid, :'l_tfr'::uuid, :'l_dep'::uuid))
       and erased_at is null and action <> 'statement_purged')
  and not exists (select 1 from test.h() where file_id = :'f' and (detail || ref_label || old_value || new_value) ~ '(COFFEE|CHEQUE #121|Client meeting|-750.00|Sep 3, 2025|clearer.pdf)'));

-- ---------- The log is append-only (rule 20)
reset role;
select test.check('nobody edits the log, not even the database owner', test.try(format($q$update public.cb_file_history set detail = 'x' where file_id = %L$q$, :'f')) like '%cannot be changed%');
select test.check('nor deletes from it', test.try(format($q$delete from public.cb_file_history where file_id = %L$q$, :'f')) like '%cannot be changed%');
select test.check('a statement is never deleted directly', test.try(format($q$delete from public.cb_bank_statements where id = %L$q$, :'savsep')) like '%not deleted%');
set role authenticated;

-- ---------- Corrected before import (rule 4; T12)
reset role;
insert into public.cb_statement_imports (id, file_id, created_by, file_name, media_type, storage_path, status, summary, result, finished_at)
values ('00000000-0000-0000-0000-0000000024b1', :'f', :C::uuid, 'oct.pdf', 'application/pdf', 'f/b1.pdf', 'needs_look', '{}',
  '{"accounts":[{"key":"a1","last4":"2468","lines":[{"id":"x1","date":"2025-10-05","description":"PAD TELECOM","amountCents":32750,"dir":"out"}]}]}', now());
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.statement_save_edits('00000000-0000-0000-0000-0000000024b1',
  '{"accounts":[{"key":"a1","last4":"2468","lines":[{"id":"x1","date":"2025-10-05","description":"PAD TELECOM","amountCents":32550,"dir":"out"}]}]}'::jsonb, '{}'::jsonb, 'ready');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('T12: the correction is logged as "Corrected before import" with 327.50 and 325.50 and who',
  exists (select 1 from test.h() where file_id = :'f' and action = 'corrected_before_import' and old_value = '327.50' and new_value = '325.50' and actor_id = :C::uuid
          and import_id = '00000000-0000-0000-0000-0000000024b1'));

-- ---------- The step 4 check: every line coded, the trial balance equals 3.3's closing
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('with lines to code, the check waits', test.tie(:'f') = '{}');
reset role;
-- All lines coded (the trial balance itself is built by the app: here the stored rows are written as it would).
update public.cb_bank_lines set status = 'done', chart_account = '65100', tax_code = 'OUT_OF_SCOPE' where file_id = :'f' and status in ('new', 'ask_client');
insert into public.cb_accounts (file_id, account_key, number, name, this_year) values (:'f', 'chart:10000', '10000', 'Chequing', 600.00), (:'f', 'chart:10100', '10100', 'Savings', 1200.00);
set role authenticated;
select test.check('a difference is named, with both figures', test.tie(:'f') = array['10000 Chequing · RBC ••• 2468: the trial balance shows 600.00, but 3.3 closes at 512.40 (87.60 off).']::text[]);
select test.check('it blocks step 4', test.code(:'f') like '%3.3 closes at 512.40%');
reset role;
update public.cb_accounts set this_year = 512.40 where file_id = :'f' and account_key = 'chart:10000';
set role authenticated;
select test.check('equal: no problem', test.tie(:'f') = '{}');

-- ---------- Safe to run twice
reset role;
\i supabase/migrations/20261212010000_round24_feed_controls.sql
\i supabase/migrations/20261212380000_piece_r3a1_roles_rights.sql   -- piece R3a-1: the replay above restores owner checks; put the rights back
select test.check('a second run changes no line', (select count(*) from public.cb_bank_lines where file_id = :'f' and acct_date is null) = 0
  and (select count(*) from public.cb_excluded_statements where file_id = :'f') = 1);
