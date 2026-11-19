-- Local tests: piece R2 (Hashim, Nov 19, 2026, version 4): step 4 "Assign mapping" on trial balance files, the group from the
-- master account, Clearing by master account, Opening Balance Equity (option A), entries on every trial balance file,
-- "Booked in QuickBooks", step 8 on trial balance files. Dummy data only.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'), ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test', (select id from public.roles where name = 'Staff'));
reset role; reset request.jwt.claims;
update public.role_permissions set level = 'edit' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Staff');
insert into public.clients (kind, legal_name, province) values ('corporation', 'Aspen Dummy Realty Team Inc.', 'ON') returning id as client \gset
\set C '\'00000000-0000-0000-0000-00000000000c\''
\set A '\'00000000-0000-0000-0000-00000000000a\''
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
select test.check('T1: step 4 cannot be signed until every account with a balance is assigned',
  test.try(format('select public.cb_sign_step(%L, %L, %L)', :'f', 'code', 'prepared')) = 'Not yet: 150 accounts with a balance to assign to a master account.');
-- One Assign for a parent's 8 children: one call, one action.
select (public.cb_assign(:'f', (select jsonb_agg(jsonb_build_object('account', id, 'chart', '60000')) from public.cb_accounts where file_id = :'f' and parent_key = '6000'),
  'Assigned 8 accounts to 60000 Advertising')) ->> 'action' as act1 \gset
:out;
select test.check('T1c: one Assign assigns all 8, in one action', (select count(*) from public.cb_accounts where file_id = :'f' and chart_account = '60000') = 8
  and (select jsonb_array_length(items) from public.cb_assign_actions where id = :'act1') = 8);
select test.check('T1: the group follows the master account (D6)', not exists (select 1 from public.cb_accounts where file_id = :'f' and chart_account = '60000' and line_no is distinct from '8521.00'));
select test.check('T1c: History lists the action', exists (select 1 from public.cb_file_history where file_id = :'f' and detail = 'Assigned 8 accounts to 60000 Advertising'));
-- Undo: one call returns all 8.
:prep;
select public.cb_undo_assign(:'act1');
:out;
select test.check('T1c: Undo returns all 8 to Unassigned', not exists (select 1 from public.cb_accounts where file_id = :'f' and chart_account = '60000')
  and (select undone_at is not null from public.cb_assign_actions where id = :'act1'));
select test.check('T1c: History lists the Undo', exists (select 1 from public.cb_file_history where file_id = :'f' and detail = 'Undo: Assigned 8 accounts to 60000 Advertising'));
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
select test.check('T1c: once step 4 is signed, Assign is refused', test.try(format('select public.cb_assign(%L, %L, %L)', :'f',
  (select jsonb_agg(jsonb_build_object('account', id, 'chart', '66000')) from public.cb_accounts where file_id = :'f' and number = '7001'), 'x accounts')) = 'Step 4 is signed. Take back the sign-off first.');
select test.check('T1c: Unassign all is refused too', test.try(format('select public.cb_unassign_all(%L)', :'f')) = 'Step 4 is signed. Take back the sign-off first.');
select test.check('T1c: and Undo', test.try(format('select public.cb_undo_assign(%L)', (select id from public.cb_assign_actions where file_id = :'f' and undone_at is null order by done_at desc limit 1)))
  = 'Step 4 is signed. Take back the sign-off first.');
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
:out;
update public.cb_files set opening_re_stated = 5 where id = :'f';
:prep;
select test.check('OBE: refused when retained earnings would not tie to step 2', test.try(format($q$select public.cb_add_entry(%L, 'RJE', 'correction', 'Clear Opening Balance Equity', false, '[{"account":"%s","amount":-1},{"account":"%s","amount":1}]', 'Step 2')$q$,
  :'f', :'obe', :'re')) like 'After this entry, retained earnings at the start (0.00) must equal last year''s closing retained earnings in step 2 (5.00).');
:out;
update public.cb_files set opening_re_stated = 0 where id = :'f';
:prep;
select test.check('OBE: one RJE clears it to retained earnings when it ties', test.try(format($q$select public.cb_add_entry(%L, 'RJE', 'correction', 'Clear Opening Balance Equity', false, '[{"account":"%s","amount":-1},{"account":"%s","amount":1}]', 'Step 2')$q$,
  :'f', :'obe', :'re')) = 'OK');
select test.check('OBE: only from that account: retained earnings otherwise still needs a prior period adjustment',
  test.try(format($q$select public.cb_add_entry(%L, 'RJE', 'correction', 'Move', false, '[{"account":"%s","amount":-1},{"account":"%s","amount":1}]', 'x schedule')$q$,
  :'f', :'chq', :'re')) = 'A line on retained earnings needs the reason "Prior period adjustment".');
:out;
select test.check('OBE: History records it', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'entry_obe'));
select test.check('OBE: it no longer holds step 6', not exists (select 1 from unnest(private.cb_step_problems(:'f', 'compare')) p where p like 'Opening Balance Equity%'));

-- D7: a new master account on the same line clears step 4 only; one on another line also clears steps 6, 7 and 8.
\set signed 'insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at) select :''f'', s, ''00000000-0000-0000-0000-00000000000c'', now() from unnest(array[''code'', ''entries'', ''compare'', ''review'', ''t2'']) s on conflict (file_id, step) do update set prepared_at = excluded.prepared_at'
\set state 'select coalesce(string_agg(step, \',\' order by step), \'none\') from public.cb_step_signoffs where file_id = :''f'' and step in (''code'', ''entries'', ''compare'', ''review'', ''t2'') and (prepared_at is not null or reviewed_at is not null)'
:signed;
update public.cb_accounts set chart_account = '10100' where id = :'chq';
select test.check('D7: a master account on the same line clears step 4 only', (:state) = 'compare,entries,review,t2');
select test.check('D7: History names the old and new master account', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'signoff_cleared' and step = 'code'
  and detail = '1000 Chequing: master account 10000 to 10100'));
:signed;
update public.cb_accounts set chart_account = '66000', line_no = '8862.00' where number = '7001' and file_id = :'f';
update public.cb_accounts set chart_account = '65100', line_no = '8810.00' where number = '7001' and file_id = :'f';
select test.check('D7: a master account on another line clears steps 4, 6, 7 and 8', (:state) = 'entries');
select test.check('item 6: History names the groups, not GIFI codes', exists (select 1 from public.cb_file_history where file_id = :'f' and detail like '7001 Other 1: % to Office expenses' and detail not like '%GIFI%'));

-- D6: a line written directly takes the master account on it; a line with none is refused.
select test.check('D6: a line with no master account is refused', test.try(format('update public.cb_accounts set line_no = %L where id = %L', '8860.00', :'chq'))
  = 'On a trial balance file the group follows the master account: assign a master account in step 4.');
update public.cb_accounts set line_no = '8862.00' where number = '7002' and file_id = :'f';
select test.check('D6: a line with one master account takes it', (select chart_account from public.cb_accounts where number = '7002' and file_id = :'f') = '66000');

-- T4: step 8 on a trial balance file: the Match paper's box and ties, and an override clears step 8 only.
select test.check('T4: step 8 on a trial balance file has the Match box', private.cb_match_problems(:'f') @> array['1 account needs a decision in Match accounts to GIFI.']);
:signed;
:prep;
select public.cb_set_gifi_override((select id from public.cb_accounts where number = '7003' and file_id = :'f'), '8860.00');
:out;
select test.check('T4: an override on a trial balance file clears step 8 only', (:state) = 'code,compare,entries,review');

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
select test.check('T3: a new account with no master account is refused', test.try(format($q$select public.cb_add_entry(%L, 'AJE', 'accrual', 'Accrue', false, '[{"line":"8860.00","new_name":"Fees","new_type":"Expenses","amount":1},{"chart":"66000","amount":-1}]', 'Fee letter')$q$, :'m'))
  = 'Choose the master account for the new account.');
select test.check('D12b: two client accounts on one master account: the preparer picks', test.try(format($q$select public.cb_add_entry(%L, 'AJE', 'accrual', 'Sales tax', false, '[{"chart":"21500","amount":1},{"chart":"66000","amount":-1}]', 'Fee letter')$q$, :'m'))
  = 'Several of the client''s accounts are on master account 21500 GST/HST payable: choose the one entries take (step 4, open the master account).');
select public.cb_pick_chart_account(:'m', '21500', (select id from public.cb_accounts where file_id = :'m' and number = '2200'));
select test.check('D12b: then entries take the picked account', test.try(format($q$select public.cb_add_entry(%L, 'AJE', 'accrual', 'Sales tax', false, '[{"chart":"21500","amount":1},{"chart":"66000","amount":-1}]', 'Fee letter')$q$, :'m')) = 'OK');
select test.check('D12b: a parent with sub-accounts is refused', test.try(format($q$select public.cb_add_entry(%L, 'AJE', 'accrual', 'Accrue marketing', false, '[{"account":"%s","amount":1},{"chart":"66000","amount":-1}]', 'Fee letter')$q$,
  :'m', (select id from public.cb_accounts where file_id = :'m' and number = '6000'))) = 'Post to a sub-account, not to its parent.');
:out;
select test.check('D12b: the pick rolls forward with the client', (select account_key from public.cb_client_chart_picks where client_id = :'client' and chart_account = '21500') = '2200');

-- D12c: "Booked in QuickBooks": the entry is fixed and a new trial balance is refused until it is unmarked.
select id as e1 from public.cb_entries where file_id = :'m' order by seq limit 1 \gset
update public.cb_entries set needs_review = true, reviewed_at = null where id = :'e1';
:prep;
select test.check('D12c: an entry is marked booked only once reviewed', test.try(format('select public.cb_mark_booked(%L, true)', :'e1')) = 'Only a reviewed entry can be marked Booked in QuickBooks.');
:out;
update public.cb_entries set reviewed_at = now(), reviewed_by = '00000000-0000-0000-0000-00000000000a' where id = :'e1';
:prep;
select public.cb_mark_booked(:'e1', true);
:out;
select test.check('D12c: a booked entry''s lines cannot change', test.try(format('update public.cb_entry_lines set memo = memo || %L where entry_id = %L', 'x', :'e1')) = 'This entry is marked Booked in QuickBooks. Unmark it first.');
:prep;
select test.check('D12c: a new trial balance is refused while an entry is booked', test.try(format($q$select public.cb_import_tb(%L, 'this_year', 'quickbooks', 'tb2.csv', '[{"number":"1000","name":"Chequing","amount":1},{"number":"4000","name":"Commission income","amount":-1}]')$q$, :'m'))
  = 'Some entries are marked Booked in QuickBooks: a new trial balance already holds them, so they would count twice. Unmark and delete those entries first, then import.');
select public.cb_mark_booked(:'e1', false);
select test.check('D12c: unmarked, the trial balance imports again', test.try(format($q$select public.cb_import_tb(%L, 'this_year', 'quickbooks', 'tb2.csv', '[{"number":"1000","name":"Chequing","amount":1},{"number":"4000","name":"Commission income","amount":-1}]')$q$, :'m')) = 'OK');
:out;
select test.check('D12c: History records the marks', (select count(*) from public.cb_file_history where file_id = :'m' and action = 'entry_booked') = 2);

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
