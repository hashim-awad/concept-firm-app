-- Local tests: piece R2 (Hashim, Nov 19, 2026, version 4): step 4 "Assign mapping" on trial balance files, the group from the
-- master account, Clearing by master account, Opening Balance Equity (option A), entries on every trial balance file,
-- "Booked in QuickBooks", step 8 on trial balance files. Dummy data only.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'), ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test', (select id from public.roles where name = 'Accountant'));
reset role; reset request.jwt.claims;
update public.role_permissions set level = 'edit' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Accountant');
insert into public.clients (kind, legal_name, province) values ('corporation', 'Aspen Dummy Realty Team Inc.', 'ON') returning id as client \gset
\set C '\'00000000-0000-0000-0000-00000000000c\''
\set A '\'00000000-0000-0000-0000-00000000000a\''
-- CB2-0: runs a statement and rolls it back: 'OK' when it would succeed, or the error. Used where a call that used to be
-- refused now succeeds, so the rest of the file still runs on the same data.
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
\set prep 'set role authenticated; set request.jwt.claims = \'{"sub":"00000000-0000-0000-0000-00000000000c"}\''
\set rev 'set role authenticated; set request.jwt.claims = \'{"sub":"00000000-0000-0000-0000-00000000000a"}\''
\set out 'reset role; reset request.jwt.claims'

-- T1: a dummy trial balance file: 30 parents each with sub-accounts ("Parent:Sub" as QuickBooks writes it; the first has 8),
-- 21 other numbered accounts, 5 with no number: 150 accounts with a balance. The Account List adds 10 with no balance.
:prep;
select public.cb_create_file(:'client', '2026-12-31', '2026-01-01', '', 'full', 'client_software', :C::uuid, :A::uuid) as f \gset
select jsonb_agg(r) as tb from (
  select jsonb_build_object('number', format('%s.%s', 6000 + p * 10, lpad(c::text, 2, '0')), 'name', format('Sub %s-%s', p, c), 'amount', 100,
         'parent', (6000 + p * 10)::text, 'path', format('Parent %s:Sub %s-%s', p, p, c), 'full_name', format('%s Parent %s:%s.%s Sub %s-%s', 6000 + p * 10, p, 6000 + p * 10, lpad(c::text, 2, '0'), p, c)) r
    from generate_series(0, 29) p, generate_series(1, 8) c where c <= case when p = 0 then 8 else 4 end
  union all select jsonb_build_object('number', (7000 + n)::text, 'name', format('Other %s', n), 'amount', 10) from generate_series(1, 19) n
  union all select jsonb_build_object('number', '', 'name', x, 'amount', 1) from unnest(array['Payment app clearing (USD)', 'Undeposited Funds', 'Opening Balance Equity', 'Petty float', 'Misc']) x
  union all select jsonb_build_object('number', '1000', 'name', 'Chequing', 'amount', -(124 * 100 + 19 * 10 + 5) + 1)
  union all select jsonb_build_object('number', '3000', 'name', 'Retained earnings', 'amount', -1)
) q \gset
select public.cb_import_tb(:'f', 'this_year', 'client_software', 'tb.csv', :'tb');
select public.cb_import_account_list(:'f', 'list.xlsx', (select jsonb_agg(jsonb_build_object('number', (8000 + n)::text, 'name', format('Unused %s', n), 'type', 'Expenses', 'detail', 'Office/General Administrative Expenses')) from generate_series(1, 10) n)
  || '[{"number":"","name":"Opening Balance Equity","type":"Equity","detail":"Opening Balance Equity"}]'::jsonb);
:out;
select test.check('T1: 150 accounts with a balance and 10 with none from the Account List',
  (select count(*) from public.cb_accounts a where file_id = :'f' and private.cb_assign_counted(a)) = 150
  and (select count(*) from public.cb_accounts where file_id = :'f' and in_list and this_year = 0 and last_year = 0) = 10);
select test.check('T1: sub-accounts stay apart, each under its parent', (select count(*) from public.cb_accounts where file_id = :'f' and parent_key = '6000') = 8);
select test.check('T1: the detail type is kept (D11)', (select qbo_detail_type from public.cb_accounts where file_id = :'f' and number = '8001') = 'Office/General Administrative Expenses');
select test.check('T1: no automatic match after the import (D5)', not exists (select 1 from public.cb_accounts where file_id = :'f' and (line_no is not null or chart_account is not null)));
:prep;
select public.cb_sign_step(:'f', 'records', 'prepared');
select test.check('T1: step 4 signs with accounts unassigned (CB2-0: a warning, not a stop)',
  test.try(format('select public.cb_sign_step(%L, %L, %L)', :'f', 'code', 'prepared')) = 'OK');
:out;
select test.check('T1: the sign-off''s History row lists the 150 accounts to assign', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'prepared' and step = 'code'
  and detail like 'Signed with open items: %150 accounts with a balance to assign to a master account.%'));
:prep;
select public.cb_unsign_step(:'f', 'code', 'prepared');   -- the preparer takes their own sign-off back
-- One Assign for a parent's 8 children: one call, one action.
select (public.cb_assign(:'f', (select jsonb_agg(jsonb_build_object('account', id, 'chart', '60000')) from public.cb_accounts where file_id = :'f' and parent_key = '6000'),
  'Assigned 8 accounts to 60000 Advertising')) ->> 'action' as act1 \gset
:out;
select test.check('T1c: one Assign assigns all 8, in one action', (select count(*) from public.cb_accounts where file_id = :'f' and chart_account = '60000') = 8
  and (select jsonb_array_length(items) from public.cb_assign_actions where id = :'act1') = 8);
select test.check('T1: the group follows the master account (D6)', not exists (select 1 from public.cb_accounts where file_id = :'f' and chart_account = '60000' and line_no is distinct from '8521.00'));
select test.check('T1c: History lists the action', exists (select 1 from public.cb_file_history where file_id = :'f' and detail like 'Assigned 8 accounts to 60000 Advertising: 6000.01 Sub 0-1 (none to 60000); %'));   -- security review: History names each account
-- Undo: one call returns all 8.
:prep;
select public.cb_undo_assign(:'act1');
:out;
select test.check('T1c: Undo returns all 8 to Unassigned', not exists (select 1 from public.cb_accounts where file_id = :'f' and chart_account = '60000')
  and (select undone_at is not null from public.cb_assign_actions where id = :'act1'));
select test.check('T1c: History lists the Undo', exists (select 1 from public.cb_file_history where file_id = :'f' and detail like 'Undo: Assigned 8 accounts to 60000 Advertising: % (60000 to none)%'));
:prep;
select test.check('T1c: an action is undone once', test.try(format('select public.cb_undo_assign(%L)', :'act1')) = 'This action is already undone.');
select (public.cb_assign(:'f', (select jsonb_agg(jsonb_build_object('account', id, 'chart', '60000')) from public.cb_accounts where file_id = :'f' and parent_key = '6000'), 'Assigned 8 accounts to 60000 Advertising')) ->> 'action' as act2 \gset
select public.cb_assign(:'f', (select jsonb_agg(jsonb_build_object('account', id, 'chart', '60100')) from public.cb_accounts where file_id = :'f' and number = '6000.01'), 'Assigned 1 account to 60100 Promotion and client gifts');
select test.check('D17: Undo is refused when an account changed since, naming it',
  test.try(format('select public.cb_undo_assign(%L)', :'act2')) = 'Cannot undo: changed since by another action: 6000.01 Sub 0-1.');
-- Unassign all keeps the import and the history of matches.
select public.cb_unassign_all(:'f');
:out;
select test.check('T1c: Unassign all keeps the imported figures', not exists (select 1 from public.cb_accounts where file_id = :'f' and chart_account is not null)
  and (select count(*) from public.cb_accounts a where file_id = :'f' and private.cb_assign_counted(a)) = 150
  and (select sum(this_year) from public.cb_accounts where file_id = :'f') = 0);
select test.check('T1c: last year''s matches stay with the client (they return as suggestions)', (select chart_account from public.cb_client_mappings where client_id = :'client' and account_key = '6000.01') = '60100');
-- Assign everything: subs to 60000, others to 66000, Chequing to 10000, retained earnings to 31000, the clearing kind to 10900.
:prep;
select public.cb_assign(:'f', (select jsonb_agg(jsonb_build_object('account', id, 'chart',
  case when parent_key is not null then '60000' when number = '1000' then '10000' when number = '3000' then '31000'
       when name in ('Payment app clearing (USD)', 'Undeposited Funds', 'Opening Balance Equity') then '10900' else '66000' end))
  from public.cb_accounts a where file_id = :'f' and (this_year <> 0 or last_year <> 0)), 'Assigned 150 accounts');
select public.cb_sign_step(:'f', 'code', 'prepared');
-- CB2-0 step 4: mapping does not lock when step 4 is signed. Each call is rolled back so the rest of the file runs on the same data.
select test.check('T1c: once step 4 is signed, Assign still works', test.try_rollback(format('select public.cb_assign(%L, %L, %L)', :'f',
  (select jsonb_agg(jsonb_build_object('account', id, 'chart', '66000')) from public.cb_accounts where file_id = :'f' and number = '7001'), 'x accounts')) = 'OK');
select test.check('T1c: Unassign all works too', test.try_rollback(format('select public.cb_unassign_all(%L)', :'f')) = 'OK');
select test.check('T1c: and Undo', test.try_rollback(format('select public.cb_undo_assign(%L)', (select id from public.cb_assign_actions where file_id = :'f' and undone_at is null order by done_at desc limit 1)))
  = 'OK');
:out;

-- D2: Clearing by master account holds step 6 while it has a balance; Opening Balance Equity says how to clear it.
select test.check('D2: client accounts on 10900 have no group and hold step 6',
  private.cb_step_problems(:'f', 'compare') @> array['Opening Balance Equity (Clearing) has a balance: clear it to retained earnings with one RJE.',
    'Payment app clearing (USD) (Clearing) has a balance: clear it with an entry to cash or receivables.']
  and not exists (select 1 from unnest(private.cb_step_problems(:'f', 'compare')) p where p like '%with no group%'));
select test.check('D2: they are in step 8''s box as Clearing', (select count(*) from private.cb_match_items(:'f') where reason = 'clearing') = 3);
select id as pay from public.cb_accounts where file_id = :'f' and name = 'Payment app clearing (USD)' \gset
select id as chq from public.cb_accounts where file_id = :'f' and number = '1000' \gset
select id as obe from public.cb_accounts where file_id = :'f' and name = 'Opening Balance Equity' \gset
select id as re from public.cb_accounts where file_id = :'f' and number = '3000' \gset
:prep;
select public.cb_add_entry(:'f', 'RJE', 'reclassification', 'Deposit in transit at year end', false,
  format('[{"account":"%s","amount":1},{"account":"%s","amount":-1}]', :'chq', :'pay')::jsonb, 'Bank reconciliation');
:out;
select test.check('D2: an entry to cash clears it', not exists (select 1 from unnest(private.cb_step_problems(:'f', 'compare')) p where p like 'Payment app%'));

-- Opening Balance Equity (Hashim, option A): one RJE to retained earnings, only against step 2's typed figure, and it must tie.
:prep;
select test.check('OBE: refused while step 2 has no closing retained earnings', test.try(format($q$select public.cb_add_entry(%L, 'RJE', 'correction', 'Clear Opening Balance Equity', false, '[{"account":"%s","amount":-1},{"account":"%s","amount":1}]', 'Step 2')$q$,
  :'f', :'obe', :'re')) = 'Enter last year''s closing retained earnings in step 2 first.');
select public.cb_save_tb_opening_re(:'f', 5);   -- decision 1A: step 2's field on a trial balance file
select test.check('OBE: refused when retained earnings would not tie to step 2', test.try(format($q$select public.cb_add_entry(%L, 'RJE', 'correction', 'Clear Opening Balance Equity', false, '[{"account":"%s","amount":-1},{"account":"%s","amount":1}]', 'Step 2')$q$,
  :'f', :'obe', :'re')) like 'After this entry, retained earnings at the start must equal last year''s closing retained earnings in step 2: 0.00 and 5.00.');
select public.cb_save_tb_opening_re(:'f', 0);
select test.check('OBE: one RJE clears it to retained earnings when it ties', test.try(format($q$select public.cb_add_entry(%L, 'RJE', 'correction', 'Clear Opening Balance Equity', false, '[{"account":"%s","amount":-1},{"account":"%s","amount":1}]', 'Step 2')$q$,
  :'f', :'obe', :'re')) = 'OK');
select test.check('OBE: retained earnings may move from another account with any reason (CB2-0: no prior period reason rule; rolled back here)',
  test.try_rollback(format($q$select public.cb_add_entry(%L, 'RJE', 'correction', 'Move', false, '[{"account":"%s","amount":-1},{"account":"%s","amount":1}]', 'x schedule')$q$,
  :'f', :'chq', :'re')) = 'OK');
:out;
select test.check('OBE: History records it', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'entry_obe'));
select test.check('decision 1A: the OBE entry is dated the first day of the year', (select entry_date from public.cb_entries where file_id = :'f' and note = 'Clear Opening Balance Equity') = '2026-01-01');
select test.check('decision 1A: step 2''s figure is in History', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'opening_re'
  and detail = 'Last year''s closing retained earnings (T2 line 3849): 5.00 to 0.00'));
select test.check('decision 1A: retained earnings tie, so step 6 says nothing of them', not exists (select 1 from unnest(private.cb_step_problems(:'f', 'compare')) p where p like 'Retained earnings at the start%'));
:prep;
select public.cb_save_tb_opening_re(:'f', 250);
:out;
select test.check('decision 1A: a different step 2 figure holds step 6, with both figures', private.cb_step_problems(:'f', 'compare')
  @> array['Retained earnings at the start do not tie to step 2. At the start: 0.00. Step 2 (T2 line 3849): 250.00. Difference: (250.00).']);
:prep;
select public.cb_save_tb_opening_re(:'f', 0);
:out;
select test.check('OBE: it no longer holds step 6', not exists (select 1 from unnest(private.cb_step_problems(:'f', 'compare')) p where p like 'Opening Balance Equity%'));

-- D7, CB2-0 step 2: a new master account, on the same line or another, clears nothing; History has the change.
\set signed 'insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at) select :''f'', s, ''00000000-0000-0000-0000-00000000000c'', now() from unnest(array[''code'', ''entries'', ''compare'', ''review'', ''t2'']) s on conflict (file_id, step) do update set prepared_at = excluded.prepared_at'
\set state 'select coalesce(string_agg(step, \',\' order by step), \'none\') from public.cb_step_signoffs where file_id = :''f'' and step in (''code'', ''entries'', ''compare'', ''review'', ''t2'') and (prepared_at is not null or reviewed_at is not null)'
:signed;
update public.cb_accounts set chart_account = '10100' where id = :'chq';
select test.check('D7: a master account on the same line clears nothing', (:state) = 'code,compare,entries,review,t2');
select test.check('D7: History names the old and new master account', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'mapping_changed' and step = 'code'
  and detail = '1000 Chequing: master account 10000 to 10100'));
:signed;
update public.cb_accounts set chart_account = '66000', line_no = '8862.00' where number = '7001' and file_id = :'f';
update public.cb_accounts set chart_account = '65100', line_no = '8810.00' where number = '7001' and file_id = :'f';
select test.check('D7: a master account on another line clears nothing', (:state) = 'code,compare,entries,review,t2');
select test.check('item 6: History names the groups, not GIFI codes', exists (select 1 from public.cb_file_history where file_id = :'f' and detail like '7001 Other 1: % to Office expenses' and detail not like '%GIFI%'));

-- D6: a line written directly takes the master account on it; a line with none is refused.
select test.check('D6: a line with no master account is refused', test.try(format('update public.cb_accounts set line_no = %L where id = %L', '8860.00', :'chq'))
  = 'On a trial balance file the group follows the master account: assign a master account in step 4.');
update public.cb_accounts set line_no = '8862.00' where number = '7002' and file_id = :'f';
select test.check('D6: a line with one master account takes it', (select chart_account from public.cb_accounts where number = '7002' and file_id = :'f') = '66000');

-- T4: step 8 on a trial balance file: the Match paper's box and ties, and an override clears nothing (CB2-0 step 2).
select test.check('T4: step 8 on a trial balance file has the Match box', private.cb_match_problems(:'f') @> array['1 account needs a decision in Match accounts to GIFI.']);
:signed;
:prep;
select public.cb_set_gifi_override((select id from public.cb_accounts where number = '7003' and file_id = :'f'), '8860.00');
:out;
select test.check('T4: an override on a trial balance file clears nothing; History has it', (:state) = 'code,compare,entries,review,t2'
  and exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'gifi_override' and detail = '7003 Other 3: GIFI 8862 to 8860'));

-- T3: a monthly QuickBooks file: an AJE on client accounts; a new client account carries its master account; with two client
-- accounts on one master account the preparer picks; a parent with sub-accounts is refused.
:prep;
select public.cb_create_file(:'client', '2025-12-31', '2025-01-01', '', 'monthly', 'concept_qbo', :C::uuid, :A::uuid) as m \gset
select public.cb_import_tb(:'m', 'this_year', 'quickbooks', 'tb.csv', '[{"number":"1000","name":"Chequing","amount":500},{"number":"4000","name":"Commission income","amount":-500},
  {"number":"2200","name":"GST/HST Payable","amount":0.5},{"number":"2210","name":"GST/HST Suspense","amount":-0.5},
  {"number":"6000.01","name":"Paid search","amount":1,"parent":"6000","path":"Marketing:Paid search"},{"number":"6000","name":"Marketing","amount":-1}]');
select public.cb_assign(:'m', format('[{"account":"%s","chart":"10000"},{"account":"%s","chart":"40100"},{"account":"%s","chart":"21500"},{"account":"%s","chart":"21500"},{"account":"%s","chart":"60000"},{"account":"%s","chart":"60000"}]',
  (select id from public.cb_accounts where file_id = :'m' and number = '1000'), (select id from public.cb_accounts where file_id = :'m' and number = '4000'),
  (select id from public.cb_accounts where file_id = :'m' and number = '2200'), (select id from public.cb_accounts where file_id = :'m' and number = '2210'),
  (select id from public.cb_accounts where file_id = :'m' and number = '6000.01'), (select id from public.cb_accounts where file_id = :'m' and number = '6000'))::jsonb, 'Assigned 6 accounts');
select test.check('T3: an AJE on a monthly file', test.try(format($q$select public.cb_add_entry(%L, 'AJE', 'accrual', 'Accrue the year-end fee', false, '[{"chart":"66000","new_name":"Year-end accounting fee","new_type":"Expenses","amount":100},{"account":"%s","amount":-100}]', 'Fee letter')$q$,
  :'m', (select id from public.cb_accounts where file_id = :'m' and number = '1000'))) = 'OK');
select test.check('T3: the new client account carries its master account', (select chart_account || '|' || line_no from public.cb_accounts where file_id = :'m' and client_new) = '66000|8862.00');
select test.check('T3: a new account with no master account is accepted (CB2-0 review round: step 4 lists it to assign; rolled back here)', test.try_rollback(format($q$select public.cb_add_entry(%L, 'AJE', 'accrual', 'Accrue', false, '[{"line":"8860.00","new_name":"Fees","new_type":"Expenses","amount":1},{"chart":"66000","amount":-1}]', 'Fee letter')$q$, :'m'))
  = 'OK');
select test.check('D12b: two client accounts on one master account: the preparer picks', test.try(format($q$select public.cb_add_entry(%L, 'AJE', 'accrual', 'Sales tax', false, '[{"chart":"21500","amount":1},{"chart":"66000","amount":-1}]', 'Fee letter')$q$, :'m'))
  = 'Several of the client''s accounts are on master account 21500 GST/HST payable: choose the one entries take (step 4, open the master account).');
select public.cb_pick_chart_account(:'m', '21500', (select id from public.cb_accounts where file_id = :'m' and number = '2200'));
select test.check('D12b: then entries take the picked account', test.try(format($q$select public.cb_add_entry(%L, 'AJE', 'accrual', 'Sales tax', false, '[{"chart":"21500","amount":1},{"chart":"66000","amount":-1}]', 'Fee letter')$q$, :'m')) = 'OK');
select test.check('D12b: a parent with sub-accounts is refused', test.try(format($q$select public.cb_add_entry(%L, 'AJE', 'accrual', 'Accrue marketing', false, '[{"account":"%s","amount":1},{"chart":"66000","amount":-1}]', 'Fee letter')$q$,
  :'m', (select id from public.cb_accounts where file_id = :'m' and number = '6000'))) = 'Post to a sub-account, not to its parent.');
:out;
select test.check('D12b: the pick rolls forward with the client', (select account_key from public.cb_client_chart_picks where client_id = :'client' and chart_account = '21500') = '2200');

-- D12c: "Booked in QuickBooks": a new trial balance is refused until it is unmarked. CB2-0 step 4: booking does not wait for
-- step 5, and a booked entry can still change (History records it).
select id as e1 from public.cb_entries where file_id = :'m' order by seq limit 1 \gset
update public.cb_entries set needs_review = true, reviewed_at = null where id = :'e1';
:prep;
select test.check('D12c: an entry can be marked booked before step 5 is reviewed (CB2-0: a warning, not a stop)', test.try(format('select public.cb_mark_booked(%L, true)', :'e1')) = 'OK');
:out;
insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at, reviewed_by, reviewed_at)
values (:'m', 'entries', '00000000-0000-0000-0000-00000000000c', now(), '00000000-0000-0000-0000-00000000000a', now())
on conflict (file_id, step) do update set prepared_at = now(), reviewed_at = now(), reviewed_by = excluded.reviewed_by;
:prep;
select public.cb_mark_booked(:'e1', true);
:out;
select test.check('D12c: a booked entry''s lines can change (CB2-0)', test.try(format('update public.cb_entry_lines set memo = memo || %L where entry_id = %L', 'x', :'e1')) = 'OK');
:prep;
select test.check('D12c: a new trial balance is refused while an entry is booked', test.try(format($q$select public.cb_import_tb(%L, 'this_year', 'quickbooks', 'tb2.csv', '[{"number":"1000","name":"Chequing","amount":1},{"number":"4000","name":"Commission income","amount":-1}]')$q$, :'m'))
  = 'Some entries are marked Booked in QuickBooks: a new trial balance already holds them, so they would count twice. Unmark and delete those entries first, then import.');
select public.cb_mark_booked(:'e1', false);
select test.check('D12c: unmarked, the trial balance imports again', test.try(format($q$select public.cb_import_tb(%L, 'this_year', 'quickbooks', 'tb2.csv', '[{"number":"1000","name":"Chequing","amount":1},{"number":"4000","name":"Commission income","amount":-1}]')$q$, :'m')) = 'OK');
:out;
select test.check('D12c: History records the marks (booked before review, booked again, unmarked)', (select string_agg(detail, ' | ' order by id) from public.cb_file_history where file_id = :'m' and action = 'entry_booked')
  like 'AJE % marked Booked in QuickBooks; step 5 not reviewed yet | AJE % marked Booked in QuickBooks, under step 5 Reviewed by Test Owner A, % | AJE % no longer marked Booked in QuickBooks');

-- T5 and T1b (database part): next year's file finds last year's matches with the client, by number and by name.
select test.check('T1b: last year''s match for an account with no number is kept by its name', (select chart_account || '|' || name from public.cb_client_mappings where client_id = :'client' and account_key = 'undeposited funds') = '10900|Undeposited Funds');

-- T6: bank-statement files: assigning is refused (they use the master chart already).
:prep;
select public.cb_create_file(:'client', '2024-12-31', '2024-01-01', '', 'full', 'statements', :C::uuid, :A::uuid) as b \gset
select test.check('T6: a bank-statement file is unchanged: no Assign', test.try(format('select public.cb_assign(%L, %L, %L)', :'b', '[{"account":"00000000-0000-0000-0000-000000000000","chart":"10000"}]', 'x accounts'))
  = 'Bank-statement files use the master chart already.');
:out;

-- T2: when each master account sits on the account's previous line, the figures do not move: every line total, net income,
-- total assets and the shareholder account stay as they were.
:prep;
select public.cb_create_file(:'client', '2023-12-31', '2023-01-01', '', 'full', 'client_software', :C::uuid, :A::uuid) as t2 \gset
select public.cb_import_tb(:'t2', 'this_year', 'client_software', 'tb.csv', '[{"number":"1000","name":"Chequing","amount":5000},{"number":"1010","name":"Savings","amount":2000},
  {"number":"4000","name":"Commissions","amount":-20000},{"number":"6000","name":"Ads","amount":3000},{"number":"6100","name":"Fees","amount":1000},
  {"number":"2300","name":"Due to shareholder","amount":-1000},{"number":"3000","name":"Retained earnings","amount":10000}]');
-- Before R2 these files carried lines only (here set by the old matching function, which now finds the master account).
select public.cb_map_account(id, case number when '1000' then '1002.00' when '1010' then '1002.00' when '4000' then '8000.00' when '6000' then '8521.00'
  when '6100' then '8862.00' when '2300' then '2781.10' else '3600.00' end) from public.cb_accounts where file_id = :'t2';
:out;
create temp table t2_before as select line_no, sum(this_year) s from public.cb_accounts where file_id = :'t2' group by line_no;
select private.cb_match_ties(:'t2') as ties_before \gset
:prep;
-- Step 4 assigns each account to a master account on its previous line (10100 Savings on 1002, 40100 Service revenue on 8000).
select public.cb_assign(:'t2', (select jsonb_agg(jsonb_build_object('account', id, 'chart', case number when '1010' then '10100' when '4000' then '40100' else chart_account end))
  from public.cb_accounts where file_id = :'t2'), 'Assigned 7 accounts');
:out;
select test.check('T2: every line total is as before', not exists (
  select 1 from (select line_no, sum(this_year) s from public.cb_accounts where file_id = :'t2' group by line_no) a full join t2_before b using (line_no) where a.s is distinct from b.s));
select test.check('T2: net income and total assets tie as before', private.cb_match_ties(:'t2') = :'ties_before'::jsonb);
select test.check('T2: the shareholder account stays on its line, as shareholder 1', (select line_no || '|' || chart_account from public.cb_accounts where file_id = :'t2' and number = '2300') = '2781.10|23000');
select test.check('T2: no account is left without a master account', not exists (select 1 from public.cb_accounts where file_id = :'t2' and chart_account is null and this_year <> 0));

-- Accounting review fixes: the tax line takes the client's GST/HST account on 12250 when none is on 21500; system rows take
-- no master account.
:prep;
select public.cb_create_file(:'client', '2022-12-31', '2022-01-01', '', 'full', 'client_software', :C::uuid, :A::uuid) as tx \gset
select public.cb_import_tb(:'tx', 'this_year', 'client_software', 'tb.csv', '[{"number":"1000","name":"Chequing","amount":500},{"number":"1250","name":"HST refund owing","amount":100},{"number":"4000","name":"Commissions","amount":-600}]');
select public.cb_assign(:'tx', format('[{"account":"%s","chart":"10000"},{"account":"%s","chart":"12250"},{"account":"%s","chart":"40100"}]',
  (select id from public.cb_accounts where file_id = :'tx' and number = '1000'), (select id from public.cb_accounts where file_id = :'tx' and number = '1250'),
  (select id from public.cb_accounts where file_id = :'tx' and number = '4000'))::jsonb, 'Assigned 3 accounts');
select public.cb_add_entry(:'tx', 'AJE', 'accrual', 'Accrue the fee with HST', false, ('[{"chart":"66000","new_name":"Year-end accounting fee","new_type":"Expenses","amount":100},{"chart":"21500","amount":13,"is_tax":true},{"account":"' || (select id from public.cb_accounts where file_id = :'tx' and number = '1000') || '","amount":-113}]')::jsonb, 'Fee letter');
:out;
select test.check('the tax line takes the client''s GST/HST account on 12250, no new account', (select a.number from public.cb_entry_lines l join public.cb_accounts a on a.id = l.account_id
  join public.cb_entries e on e.id = l.entry_id where e.file_id = :'tx' and l.is_tax) = '1250'
  and not exists (select 1 from public.cb_accounts where file_id = :'tx' and client_new and name ilike 'GST/HST%'));

-- Test-runner finding: a pick is refused on a bank-statement file and on a locked file.
:prep;
select test.check('the pick is refused on a bank-statement file', test.try(format('select public.cb_pick_chart_account(%L, %L, %L)', :'b', '21500', (select id from public.cb_accounts where file_id = :'m' limit 1)))
  = 'Only trial balance files pick a client account.');
:out;
update public.cb_files set phase = 'locked' where id = :'tx';
:prep;
select test.check('the pick is refused on a locked file', test.try(format('select public.cb_pick_chart_account(%L, %L, %L)', :'tx', '12250', (select id from public.cb_accounts where file_id = :'tx' and number = '1250')))
  = 'This file is locked.');
:out;

-- Security review: Undo puts back the step 8 override and the reviewer flag; an account sent to the reviewer is the reviewer's;
-- a user without Edit, an account from another file, and Unassign all on a locked file are refused.
:prep;
select public.cb_create_file(:'client', '2021-12-31', '2021-01-01', '', 'full', 'client_software', :C::uuid, :A::uuid) as sr \gset
select public.cb_import_tb(:'sr', 'this_year', 'client_software', 'tb.csv', '[{"number":"1000","name":"Chequing","amount":500},{"number":"6000","name":"Ads","amount":100},{"number":"4000","name":"Commissions","amount":-600}]');
select public.cb_assign(:'sr', (select jsonb_agg(jsonb_build_object('account', id, 'chart', case number when '1000' then '10000' when '6000' then '60000' else '40100' end)) from public.cb_accounts where file_id = :'sr'), 'Assigned 3 accounts');
select public.cb_set_gifi_override((select id from public.cb_accounts where file_id = :'sr' and number = '6000'), '8524.00');
select (public.cb_unassign_all(:'sr')) ->> 'action' as ua \gset
:out;
select test.check('security: unassigning drops the override with a History line', exists (select 1 from public.cb_file_history where file_id = :'sr' and detail like '6000 Ads: GIFI override 8524 dropped%'));
:prep;
select public.cb_undo_assign(:'ua');
:out;
select test.check('security: Undo puts the override back', (select gifi_override from public.cb_accounts where file_id = :'sr' and number = '6000') = '8524.00');
select test.check('security: History records the override put back', exists (select 1 from public.cb_file_history where file_id = :'sr' and detail = '6000 Ads: GIFI override 8524 restored (Undo)'));
update public.cb_accounts set needs_reviewer = true, reviewer_reason = 'Which line?' where file_id = :'sr' and number = '6000';
:prep;
select test.check('security: the preparer can assign an account sent to the reviewer (CB2-0: anyone with Edit; rolled back here)', test.try_rollback(format('select public.cb_assign(%L, %L, %L)', :'sr',
  json_build_array(json_build_object('account', (select id from public.cb_accounts where file_id = :'sr' and number = '6000'), 'chart', '60100')), 'Assigned 1 account')) = 'OK');
select test.check('security: an account from another file is refused', test.try(format('select public.cb_assign(%L, %L, %L)', :'sr',
  json_build_array(json_build_object('account', (select id from public.cb_accounts where file_id = :'m' limit 1), 'chart', '60100')), 'Assigned 1 account')) = 'An account is not in this file.');
:out;
update public.role_permissions set level = 'view' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Accountant');
:prep;
select test.check('security: without Edit, every new action is refused',
  test.try(format('select public.cb_unassign_all(%L)', :'sr')) like 'You need Edit on Closebook%'
  and test.try(format('select public.cb_undo_assign(%L)', :'ua')) like 'You need Edit on Closebook%'
  and test.try(format('select public.cb_pick_chart_account(%L, %L, %L)', :'sr', '60000', (select id from public.cb_accounts where file_id = :'sr' and number = '6000'))) like 'You need Edit on Closebook%'
  and test.try(format('select public.cb_mark_booked(%L, true)', :'e1')) like 'You need Edit on Closebook%'
  and test.try(format('select public.cb_keep_line_move(%L)', (select id from public.cb_accounts where file_id = :'sr' and number = '6000'))) like 'You need Edit on Closebook%'
  and test.try(format('select public.cb_save_tb_opening_re(%L, 1)', :'sr')) like 'You need Edit on Closebook%');
:out;
update public.role_permissions set level = 'edit' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Accountant');
update public.cb_files set phase = 'locked' where id = :'sr';
:prep;
select test.check('security: Unassign all on a locked file is refused', test.try(format('select public.cb_unassign_all(%L)', :'sr')) = 'This file is locked.');
select test.check('security: step 2''s figure on a locked file is refused', test.try(format('select public.cb_save_tb_opening_re(%L, 1)', :'sr')) = 'This file is locked.');
:out;

:prep;
select test.check('decision 1A: bank-statement files enter step 2 as before', test.try(format('select public.cb_save_tb_opening_re(%L, 1)', :'b')) like 'On a bank-statement file%');
:out;

-- Final reviews: a deficit typed as negative ties; a figure that does not tie holds step 6 with the difference; step 6
-- reopens when step 2's figure changes and when the trial balance is imported again; a figure that is not a number is refused.
:prep;
select public.cb_create_file(:'client', '2020-12-31', '2020-01-01', '', 'full', 'client_software', :C::uuid, :A::uuid) as dt \gset
select public.cb_import_tb(:'dt', 'this_year', 'client_software', 'tb.csv', '[{"number":"1000","name":"Chequing","amount":-1000},{"number":"3000","name":"Retained earnings","amount":1000}]');
select public.cb_assign(:'dt', format('[{"account":"%s","chart":"10000"},{"account":"%s","chart":"31000"}]',
  (select id from public.cb_accounts where file_id = :'dt' and number = '1000'), (select id from public.cb_accounts where file_id = :'dt' and number = '3000'))::jsonb, 'Assigned 2 accounts');
select public.cb_save_tb_opening_re(:'dt', -1000);
:out;
select test.check('1A: a deficit typed as negative ties', not exists (select 1 from unnest(private.cb_step_problems(:'dt', 'compare')) p where p like 'Retained earnings at the start%'));
:prep;
select public.cb_save_tb_opening_re(:'dt', 1000);
:out;
select test.check('1A: the same figure typed positive holds step 6, with the difference', private.cb_step_problems(:'dt', 'compare')
  @> array['Retained earnings at the start do not tie to step 2. At the start: (1,000.00). Step 2 (T2 line 3849): 1,000.00. Difference: (2,000.00).']);
\set signdt 'insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at) values (:''dt'', ''compare'', ''00000000-0000-0000-0000-00000000000c'', now()) on conflict (file_id, step) do update set prepared_at = now(), prepared_by = excluded.prepared_by'
:signdt;
:prep;
select public.cb_save_tb_opening_re(:'dt', -1000);
:out;
select test.check('1A: a new step 2 figure keeps step 6 signed (CB2-0 step 2); History has it', exists (select 1 from public.cb_step_signoffs where file_id = :'dt' and step = 'compare' and prepared_at is not null)
  and exists (select 1 from public.cb_file_history where file_id = :'dt' and action = 'opening_re' and detail = 'Last year''s closing retained earnings (T2 line 3849): 1,000.00 to (1,000.00)'));
:signdt;
:prep;
select public.cb_import_tb(:'dt', 'this_year', 'client_software', 'tb2.csv', '[{"number":"1000","name":"Chequing","amount":-900},{"number":"3000","name":"Retained earnings","amount":900}]');
:out;
select test.check('1A: a new trial balance keeps step 6 signed (CB2-0 step 2); History has it', exists (select 1 from public.cb_step_signoffs where file_id = :'dt' and step = 'compare' and prepared_at is not null)
  and exists (select 1 from public.cb_file_history where file_id = :'dt' and detail like 'Trial balance%tb2.csv%'));
:prep;
select test.check('security: a figure that is not a number is refused', test.try(format('select public.cb_save_tb_opening_re(%L, %L)', :'dt', 'NaN')) = 'Type the amount as printed on the T2.');
select test.check('security: a figure too large is refused', test.try(format('select public.cb_save_tb_opening_re(%L, %L)', :'dt', '1e13')) = 'Type the amount as printed on the T2.');
:out;

-- Dividends carried in QuickBooks (Hashim, Nov 19, option A): one RJE per dividends account, dated the first day of the year,
-- moving exactly last year's balance to retained earnings; it must make the step 6 tie.
:prep;
select public.cb_create_file(:'client', '2019-12-31', '2019-01-01', '', 'full', 'client_software', :C::uuid, :A::uuid) as dv \gset
-- QuickBooks: dividends 25,000.00 (20,000.00 from last year never closed, 5,000.00 this year); retained earnings 100,000.00
-- credit, of which 20,000.00 is last year's dividends never closed. Last year's T2 line 3849: 80,000.00.
select public.cb_import_tb(:'dv', 'this_year', 'client_software', 'tb.csv', '[{"number":"1000","name":"Chequing","amount":75000},{"number":"3400","name":"Dividends","amount":25000},{"number":"3000","name":"Retained earnings","amount":-100000}]');
select public.cb_import_tb(:'dv', 'last_year', 'client_software', 'tb-ly.csv', '[{"number":"1000","name":"Chequing","amount":80000},{"number":"3400","name":"Dividends","amount":20000},{"number":"3000","name":"Retained earnings","amount":-100000}]');
select public.cb_assign(:'dv', format('[{"account":"%s","chart":"10000"},{"account":"%s","chart":"32200"},{"account":"%s","chart":"31000"}]',
  (select id from public.cb_accounts where file_id = :'dv' and number = '1000'), (select id from public.cb_accounts where file_id = :'dv' and number = '3400'),
  (select id from public.cb_accounts where file_id = :'dv' and number = '3000'))::jsonb, 'Assigned 3 accounts');
select public.cb_save_tb_opening_re(:'dv', 80000);
:out;
select id as dvd from public.cb_accounts where file_id = :'dv' and number = '3400' \gset
select id as dvre from public.cb_accounts where file_id = :'dv' and number = '3000' \gset
select test.check('dividends: step 6 names the account carrying last year''s balance', private.cb_step_problems(:'dv', 'compare')
  @> array['3400 Dividends carries 20,000.00 from last year: if QuickBooks did not close it, move that balance to retained earnings with one RJE dated the first day of the year.']);
:prep;
select test.check('dividends: refused when the amount differs from last year''s balance, naming both', test.try(format($q$select public.cb_add_entry(%L, 'RJE', 'correction', 'Close last year''s dividends', false, '[{"account":"%s","amount":-15000},{"account":"%s","amount":15000}]', 'QuickBooks trial balance')$q$,
  :'dv', :'dvd', :'dvre')) = 'The entry must move 3400 Dividends''s balance from last year exactly: last year 20,000.00, this entry 15,000.00.');
select test.check('dividends: one RJE of last year''s balance is accepted', test.try(format($q$select public.cb_add_entry(%L, 'RJE', 'correction', 'Close last year''s dividends', false, '[{"account":"%s","amount":-20000},{"account":"%s","amount":20000}]', 'QuickBooks trial balance')$q$,
  :'dv', :'dvd', :'dvre')) = 'OK');
select test.check('dividends: a second RJE on the same account is refused', test.try(format($q$select public.cb_add_entry(%L, 'RJE', 'correction', 'Again', false, '[{"account":"%s","amount":-20000},{"account":"%s","amount":20000}]', 'QuickBooks trial balance')$q$,
  :'dv', :'dvd', :'dvre')) = '3400 Dividends: last year''s balance is already moved to retained earnings by another entry.');
:out;
select test.check('dividends: this year''s dividends show 5,000.00, not 25,000.00', private.cb_account_final(:'dvd') = 5000);
select test.check('dividends: retained earnings at the start tie to step 2 (80,000.00)', not exists (select 1 from unnest(private.cb_step_problems(:'dv', 'compare')) p where p like 'Retained earnings at the start%' or p like '%carries%from last year%'));
select test.check('dividends: the entry is dated the first day of the year', (select entry_date from public.cb_entries where file_id = :'dv' and kind = 'RJE') = '2019-01-01');
select test.check('dividends: History records it', exists (select 1 from public.cb_file_history where file_id = :'dv' and action = 'entry_dividends'
  and detail = '3400 Dividends: last year''s balance 20,000.00 moved to retained earnings (RJE), checked against step 2'));
:prep;
select test.check('dividends: any other entry to retained earnings is accepted with any reason (CB2-0; rolled back here)', test.try_rollback(format($q$select public.cb_add_entry(%L, 'RJE', 'correction', 'Move', false, '[{"account":"%s","amount":-1},{"account":"%s","amount":1}]', 'x schedule')$q$,
  :'dv', (select id from public.cb_accounts where file_id = :'dv' and number = '1000'), :'dvre')) = 'OK');
:out;

-- Several opening RJEs (Hashim, Nov 19, option A, projected tie): each entry ties to step 2 once the other qualifying balances
-- not yet moved, and any Opening Balance Equity left, are counted. Dividends non-eligible 12,000.00 and eligible 8,000.00 carried
-- from last year, retained earnings 100,000.00 credit, step 2 80,000.00; entered in either order.
\set tb2 '[{"number":"1000","name":"Chequing","amount":80000},{"number":"3410","name":"Dividends non-eligible","amount":12000},{"number":"3420","name":"Dividends eligible","amount":8000},{"number":"3000","name":"Retained earnings","amount":-100000}]'
\set rje 'select test.try(format($q$select public.cb_add_entry(%L, ''RJE'', ''correction'', ''Close last year''''s dividends'', false, ''[{"account":"%s","amount":%s},{"account":"%s","amount":%s}]'', ''QuickBooks trial balance'')$q$, '
:prep;
select public.cb_create_file(:'client', '2018-12-31', '2018-01-01', '', 'full', 'client_software', :C::uuid, :A::uuid) as d2a \gset
select public.cb_create_file(:'client', '2017-12-31', '2017-01-01', '', 'full', 'client_software', :C::uuid, :A::uuid) as d2b \gset
select public.cb_import_tb(f, t, 'client_software', 'tb.csv', :'tb2') from unnest(array[:'d2a', :'d2b']::uuid[]) f, unnest(array['this_year', 'last_year']) t;
select public.cb_assign(f, (select jsonb_agg(jsonb_build_object('account', id, 'chart', case number when '1000' then '10000' when '3410' then '32000' when '3420' then '32100' else '31000' end))
  from public.cb_accounts where file_id = f), 'Assigned 4 accounts') from unnest(array[:'d2a', :'d2b']::uuid[]) f;
select public.cb_save_tb_opening_re(f, 80000) from unnest(array[:'d2a', :'d2b']::uuid[]) f;
:out;
select (select id from public.cb_accounts where file_id = :'d2a' and number = '3410') as a_ne, (select id from public.cb_accounts where file_id = :'d2a' and number = '3420') as a_el,
       (select id from public.cb_accounts where file_id = :'d2a' and number = '3000') as a_re, (select id from public.cb_accounts where file_id = :'d2b' and number = '3410') as b_ne,
       (select id from public.cb_accounts where file_id = :'d2b' and number = '3420') as b_el, (select id from public.cb_accounts where file_id = :'d2b' and number = '3000') as b_re \gset
:prep;
select test.check('two dividends accounts: the first RJE (12,000.00) is accepted, counting the 8,000.00 still to move', (:rje :'d2a', :'a_ne', -12000, :'a_re', 12000))) = 'OK');
select test.check('two dividends accounts: then the second (8,000.00)', (:rje :'d2a', :'a_el', -8000, :'a_re', 8000))) = 'OK');
select test.check('two dividends accounts, the other order: 8,000.00 first', (:rje :'d2b', :'b_el', -8000, :'b_re', 8000))) = 'OK');
select test.check('two dividends accounts, the other order: then 12,000.00', (:rje :'d2b', :'b_ne', -12000, :'b_re', 12000))) = 'OK');
:out;
select test.check('two dividends accounts: both files tie to step 2 and carry no dividends from last year',
  not exists (select 1 from unnest(private.cb_step_problems(:'d2a', 'compare') || private.cb_step_problems(:'d2b', 'compare')) p where p like 'Retained earnings at the start%' or p like '%from last year%')
  and private.cb_account_final(:'a_ne') = 0 and private.cb_account_final(:'a_el') = 0 and private.cb_account_final(:'b_ne') = 0 and private.cb_account_final(:'b_el') = 0);

-- Opening Balance Equity (5,000.00 debit) plus one dividends account (15,000.00 from last year): retained earnings 100,000.00,
-- step 2 80,000.00. The OBE RJE counts the dividends still to move; then the dividends RJE ties.
:prep;
select public.cb_create_file(:'client', '2016-12-31', '2016-01-01', '', 'full', 'client_software', :C::uuid, :A::uuid) as ob \gset
select public.cb_import_tb(:'ob', t, 'client_software', 'tb.csv', '[{"number":"1000","name":"Chequing","amount":80000},{"number":"","name":"Opening Balance Equity","amount":5000},{"number":"3400","name":"Dividends","amount":15000},{"number":"3000","name":"Retained earnings","amount":-100000}]')
  from unnest(array['this_year', 'last_year']) t;
select public.cb_assign(:'ob', (select jsonb_agg(jsonb_build_object('account', id, 'chart', case number when '1000' then '10000' when '3400' then '32200' when '3000' then '31000' else '10900' end))
  from public.cb_accounts where file_id = :'ob'), 'Assigned 4 accounts');
select public.cb_save_tb_opening_re(:'ob', 80000);
:out;
select (select id from public.cb_accounts where file_id = :'ob' and name = 'Opening Balance Equity') as o_obe, (select id from public.cb_accounts where file_id = :'ob' and number = '3400') as o_div,
       (select id from public.cb_accounts where file_id = :'ob' and number = '3000') as o_re \gset
:prep;
select test.check('OBE plus dividends: a wrong OBE amount is refused, naming what is still to move', test.try(format($q$select public.cb_add_entry(%L, 'RJE', 'correction', 'Clear Opening Balance Equity', false, '[{"account":"%s","amount":-4000},{"account":"%s","amount":4000}]', 'QuickBooks trial balance')$q$,
  :'ob', :'o_obe', :'o_re')) = 'The entry must clear Opening Balance Equity to nil.');
select test.check('OBE plus dividends: the OBE RJE is accepted, counting the 15,000.00 still to move', test.try(format($q$select public.cb_add_entry(%L, 'RJE', 'correction', 'Clear Opening Balance Equity', false, '[{"account":"%s","amount":-5000},{"account":"%s","amount":5000}]', 'QuickBooks trial balance')$q$,
  :'ob', :'o_obe', :'o_re')) = 'OK');
select test.check('OBE plus dividends: then the dividends RJE', (:rje :'ob', :'o_div', -15000, :'o_re', 15000))) = 'OK');
:out;
select test.check('OBE plus dividends: step 6 ties', not exists (select 1 from unnest(private.cb_step_problems(:'ob', 'compare')) p where p like 'Retained earnings at the start%' or p like 'Opening Balance Equity%' or p like '%from last year%'));

-- Low items: a 31500 account's opening RJE may take the reason "correction"; an unrelated RJE on it keeps the step 6 hint.
:prep;
select public.cb_create_file(:'client', '2015-12-31', '2015-01-01', '', 'full', 'client_software', :C::uuid, :A::uuid) as pp \gset
select public.cb_import_tb(:'pp', 'this_year', 'client_software', 'tb.csv', '[{"number":"1000","name":"Chequing","amount":89500},{"number":"3500","name":"Prior period adjustments","amount":10000},{"number":"3600","name":"Other equity items","amount":500},{"number":"3000","name":"Retained earnings","amount":-100000}]');
select public.cb_import_tb(:'pp', 'last_year', 'client_software', 'tb-ly.csv', '[{"number":"1000","name":"Chequing","amount":90000},{"number":"3500","name":"Prior period adjustments","amount":10000},{"number":"3000","name":"Retained earnings","amount":-100000}]');
select public.cb_assign(:'pp', (select jsonb_agg(jsonb_build_object('account', id, 'chart', case number when '1000' then '10000' when '3500' then '31500' when '3600' then '31600' else '31000' end))
  from public.cb_accounts where file_id = :'pp'), 'Assigned 4 accounts');
select public.cb_save_tb_opening_re(:'pp', 90000);
select public.cb_add_entry(:'pp', 'RJE', 'prior_period', 'Reclass', false, format('[{"account":"%s","amount":-1},{"account":"%s","amount":1}]',
  (select id from public.cb_accounts where file_id = :'pp' and number = '3500'), (select id from public.cb_accounts where file_id = :'pp' and number = '3600'))::jsonb, 'Schedule');
:out;
select test.check('an RJE that does not move the account to retained earnings keeps the step 6 hint', private.cb_step_problems(:'pp', 'compare')
  @> array['3500 Prior period adjustments carries 10,000.00 from last year: if QuickBooks did not close it, move that balance to retained earnings with one RJE dated the first day of the year.']);
:prep;
select test.check('a 31500 account''s opening RJE takes the reason "correction"', (:rje :'pp', (select id from public.cb_accounts where file_id = :'pp' and number = '3500'), -10000,
  (select id from public.cb_accounts where file_id = :'pp' and number = '3000'), 10000))) = 'OK');
:out;
select test.check('then the hint goes and step 6 ties', not exists (select 1 from unnest(private.cb_step_problems(:'pp', 'compare')) p where p like 'Retained earnings at the start%' or p like '%from last year%'));
