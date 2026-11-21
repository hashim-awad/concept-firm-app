-- Local tests: CloseBook2 piece CB2-1 version 4, PR B (Hashim, Nov 21, 2026). Upload from file, Confirm (categorize, split,
-- transfer, match), Exclude and Undo, Rules, Reconcile, and firm isolation on the new tables. Dummy data only.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'), ('00000000-0000-0000-0000-00000000000b', 'other.b@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000b', 'Other Firm B', 'other.b@example.test', (select id from public.roles where name = 'Accountant'));
reset role;
update public.role_permissions set level = 'edit' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Accountant');
insert into public.firms (id, name) values ('00000000-0000-4000-8000-0000000000bb', 'Dummy Firm B');
update public.firm_members set firm_id = '00000000-0000-4000-8000-0000000000bb' where user_id = '00000000-0000-0000-0000-00000000000b';

set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
insert into public.clients (kind, legal_name, province) values ('corporation', 'Birch Dummy Bank Inc.', 'ON') returning id as client \gset
select public.cb_create_file(:'client', '2025-12-31', '2025-01-01', '', 'full', 'statements', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a') as f1 \gset
select public.cb_create_file(:'client', '2026-12-31', '2026-01-01', '', 'full', 'statements', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a') as f2 \gset
select cb_client_id as c from public.cb_files where id = :'f2' \gset
-- The bank and card accounts exist in the 2026 year (made the old way).
select (public.cb_upload_bank(:'f2', null, 'Chequing 4521', 'bank', 'chq.csv', 0, 100, '[{"line":1,"date":"2026-01-05","description":"OPENING DEPOSIT","amount":100}]', '2026-01-01', '2026-01-31')) ->> 'account_id' as chq \gset
select (public.cb_upload_bank(:'f2', null, 'Visa 1234', 'card', 'visa.csv', 0, 0, '[{"line":1,"date":"2026-01-06","description":"DUMMY A","amount":10},{"line":2,"date":"2026-01-07","description":"DUMMY A REFUND","amount":-10}]', '2026-01-01', '2026-01-31')) ->> 'account_id' as visa \gset
select public.cb_set_bank_chart_account(:'chq', '10000');
select coalesce(nullif(number, ''), chart_account) as chq_no from public.cb_bank_accounts where id = :'chq' \gset
select coalesce(nullif(number, ''), chart_account) as visa_no from public.cb_bank_accounts where id = :'visa' \gset

-- Upload from file: no balances needed; rows land in the year that covers their date; the mapping is kept.
select public.cb_books_upload(:'c', :'chq_no', 'march.csv', '[{"date":"2025-12-30","description":"DUMMY LATE FEE","amount":-5},{"date":"2026-03-01","description":"DUMMY COFFEE","amount":-11.3},{"date":"2026-03-02","description":"DUMMY SOFTWARE","amount":-113},{"date":"2026-03-03","description":"TFR TO VISA","amount":-50},{"date":"2026-03-04","description":"DUMMY OFFICE","amount":-226}]',
  null, null, '{"date":0,"description":1,"amount":2,"header":true,"dateFormat":"YYYY-MM-DD"}') as up \gset
reset role;
select test.check('upload with no balances: 1 line in 2025, 4 in 2026; the 2025 year gets the account too',
  (select count(*) from public.cb_bank_lines where file_id = :'f1') = 1 and (select count(*) from public.cb_bank_lines where file_id = :'f2' and txn_date >= '2026-03-01') = 4
  and exists (select 1 from public.cb_bank_accounts where file_id = :'f1' and coalesce(nullif(number, ''), chart_account) = :'chq_no')
  and (select opening is null and closing is null from public.cb_bank_statements where file_id = :'f1'));
select test.check('the column mapping is kept for the account', (select mapping ->> 'dateFormat' from public.cb_books_csv_maps where cb_client_id = :'c' and ident = :'chq_no') = 'YYYY-MM-DD');
set role authenticated;
-- Balances are optional; a difference is a warning, never a refusal. Typed balances are kept as typed; the old engine's
-- opening and closing (which must tie) are filled only when the upload is one year and ties.
select public.cb_books_upload(:'c', :'chq_no', 'april-off.csv', '[{"date":"2026-04-01","description":"DUMMY APRIL A","amount":-10}]', 1000, 5000, null);
select public.cb_books_upload(:'c', :'chq_no', 'april-ties.csv', '[{"date":"2026-04-02","description":"DUMMY APRIL B","amount":-10}]', 1000, 990, null);
reset role;
select test.check('balances that do not tie upload with the balances kept as typed (the difference is only a warning)',
  (select stated_opening = 1000 and stated_closing = 5000 and opening is null and closing is null from public.cb_bank_statements where file_name = 'april-off.csv'));
select test.check('balances that tie fill the statement''s opening and closing too',
  (select opening = 1000 and closing = 990 and stated_closing = 990 from public.cb_bank_statements where file_name = 'april-ties.csv'));
set role authenticated;
select test.check('a date no year covers is refused',
  test.try(format($q$select public.cb_books_upload(%L, %L, 'x.csv', '[{"date":"2030-01-01","description":"X","amount":1}]')$q$, :'c', :'chq_no')) = 'No year in Closebook covers Jan 1, 2030. Add the year first.');

select id as l_coffee from public.cb_bank_lines where description = 'DUMMY COFFEE' \gset
select id as l_soft from public.cb_bank_lines where description = 'DUMMY SOFTWARE' \gset
select id as l_tfr from public.cb_bank_lines where description = 'TFR TO VISA' \gset
select id as l_office from public.cb_bank_lines where description = 'DUMMY OFFICE' \gset
select id as l_fee from public.cb_bank_lines where description = 'DUMMY LATE FEE' \gset

-- Confirm: categorize with a memo, split, transfer; one History row per line.
reset role;
select count(*) as h0 from public.cb_file_history where file_id = :'f2' \gset
set role authenticated;
select public.cb_books_confirm(:'c', format('[{"id":"%s","kind":"code","account":"60200","tax":"MEALS_HST_50","memo":"Client meeting"},{"id":"%s","kind":"split","rows":[{"account":"65100","tax":"HST_ON","amount":100},{"account":"65000","tax":"HST_ON","amount":13}]},{"id":"%s","kind":"transfer","transfer":"%s"}]',
  :'l_coffee', :'l_soft', :'l_tfr', :'visa_no')::jsonb);
reset role;
select test.check('confirm posts each line: categorized with its memo, split, transfer',
  (select status = 'done' and chart_account = '60200' and memo = 'Client meeting' from public.cb_bank_lines where id = :'l_coffee')
  and (select status = 'done' and is_split from public.cb_bank_lines where id = :'l_soft') and (select count(*) from public.cb_line_splits where line_id = :'l_soft') = 2
  and (select status = 'done' and transfer_account = :'visa'::uuid from public.cb_bank_lines where id = :'l_tfr'));
select test.check('confirming 3 lines (one with a memo) writes 3 History rows, one per line, the memo in its row',
  (select count(*) from public.cb_file_history where file_id = :'f2') - :h0 = 3
  and (select count(*) from public.cb_file_history where line_id = :'l_coffee' and new_value like '%Client meeting%') = 1);
set role authenticated;
select test.check('a split that does not add up is refused',
  test.try(format($q$select public.cb_books_confirm(%L, '[{"id":"%s","kind":"split","rows":[{"account":"65100","tax":"HST_ON","amount":100},{"account":"65000","tax":"HST_ON","amount":1}]}]')$q$, :'c', :'l_office')) like 'Left to split%');

-- Categorized: change in place; Undo returns it to For review.
select public.cb_change_line(:'f2', :'l_coffee', '{"account":"65100","tax":"HST_ON"}');
select public.cb_unpost_lines(:'f2', array[:'l_coffee']::uuid[]);
reset role;
select test.check('changed in place, then back to For review', (select status = 'new' from public.cb_bank_lines where id = :'l_coffee'));

-- Match to a journal entry already recorded: posts nothing; Undo.
set role authenticated;
select public.cb_books_save_account(:'c', null, '65100', 'Office expenses', 'Expense', null, 'HST_ON');
select public.cb_books_save_account(:'c', null, '10000', 'Chequing', 'Asset', null, null);
select public.cb_books_save_entry(:'c', null, '2026-03-04', '', false, 'Office supplies, cheque', format('[{"account":"%s","amount":226},{"account":"%s","amount":-226}]',
  (select id from public.cb_client_accounts where cb_client_id = :'c' and number = '65100'), (select id from public.cb_client_accounts where cb_client_id = :'c' and number = '10000'))::jsonb) as je \gset
select public.cb_books_confirm(:'c', format('[{"id":"%s","kind":"entry","entry":"%s"}]', :'l_office', :'je')::jsonb);
reset role;
select test.check('matched to the entry: posts nothing, the entry holds it', (select status = 'matched' and matched_entry = :'je'::uuid from public.cb_bank_lines where id = :'l_office'));
set role authenticated;
select public.cb_books_unmatch_entry(:'l_office');
reset role;
select test.check('Undo the match: back to For review', (select status = 'new' and matched_entry is null from public.cb_bank_lines where id = :'l_office'));
-- Confirm selected with a match first: the match leaves no switch on, so the next line still writes its own row.
select count(*) as h1 from public.cb_file_history where file_id = :'f2' \gset
set role authenticated;
select public.cb_books_confirm(:'c', format('[{"id":"%s","kind":"entry","entry":"%s","memo":"Cheque 101"},{"id":"%s","kind":"code","account":"60200","tax":"MEALS_HST_50"}]', :'l_office', :'je', :'l_coffee')::jsonb);
reset role;
select test.check('a match then a line in one Confirm selected: one History row each',
  (select count(*) from public.cb_file_history where file_id = :'f2') - :h1 = 2
  and (select count(*) from public.cb_file_history where file_id = :'f2' and line_id = :'l_coffee' and action <> 'line_unposted') >= 1);
set role authenticated;
select public.cb_books_unmatch_entry(:'l_office');
select public.cb_unpost_lines(:'f2', array[:'l_coffee']::uuid[]);
reset role;

-- Exclude with a reason; Undo.
set role authenticated;
select public.cb_exclude_lines(:'f1', array[:'l_fee']::uuid[], 'duplicate');
reset role;
select test.check('excluded with its reason', (select status = 'excluded' and excluded_reason = 'duplicate' from public.cb_bank_lines where id = :'l_fee'));
set role authenticated;
select public.cb_restore_lines(:'f1', array[:'l_fee']::uuid[]);

-- Rules: New, edit, Copy, Delete; one History row each; a split by percentage must add to 100.
select public.cb_books_save_rule(:'c', null, '{"name":"Coffee","direction":"out","conditions":[{"field":"description","op":"contains","value":"COFFEE"}],"chart_account":"60200","tax_code":"MEALS_HST_50","auto_confirm":true}') as r1 \gset
select test.check('a split rule must add up to 100 per cent',
  test.try(format($q$select public.cb_books_save_rule(%L, null, '{"name":"Split","conditions":[{"field":"amount","op":"eq","value":"113"}],"splits":[{"account":"65100","tax":"HST_ON","percent":60},{"account":"65000","tax":"HST_ON","percent":30}]}')$q$, :'c'))
  = 'The percentages add up to 90, not 100.');
select public.cb_books_save_rule(:'c', :'r1', '{"name":"Coffee shops","direction":"out","conditions":[{"field":"description","op":"contains","value":"COFFEE"}],"chart_account":"60200","tax_code":"MEALS_HST_50","auto_confirm":true}');
select public.cb_books_rule_action(:'r1', 'copy') as r2 \gset
select public.cb_books_rule_action(:'r2', 'delete');
reset role;
select test.check('rules: added, changed, copied, deleted, one History row each',
  (select string_agg(action, ',' order by created_at) from public.cb_books_history where cb_client_id = :'c' and action like 'rule%') = 'rule_added,rule_changed,rule_copied,rule_deleted'
  and (select count(*) from public.cb_books_rules where cb_client_id = :'c') = 1);

-- Reconcile: beginning nil, ending 50.00, the 100.00 deposit and the 50.00 transfer cleared: difference nil. A second with a
-- difference is recorded; Undo the later one first.
set role authenticated;
select id as l_open from public.cb_bank_lines where description = 'OPENING DEPOSIT' \gset
select public.cb_books_reconcile(:'c', :'chq_no', '2026-03-31', 50, array[:'l_open', :'l_tfr']::uuid[]) as rec1 \gset
select public.cb_books_reconcile(:'c', :'chq_no', '2026-04-30', 30, array[:'l_coffee']::uuid[]) as rec2 \gset
reset role;
select test.check('reconciled: difference nil, then a difference of 8.70 recorded on the second',
  (select difference = 0 and beginning = 0 from public.cb_books_reconciliations where id = :'rec1')
  and (select beginning = 50 and difference = -8.70 from public.cb_books_reconciliations where id = :'rec2'));
set role authenticated;
select test.check('a line already reconciled cannot be ticked again',
  test.try(format('select public.cb_books_reconcile(%L, %L, ''2026-05-31'', 0, array[%L]::uuid[])', :'c', :'chq_no', :'l_open')) like 'A line ticked%');
select public.cb_books_reconcile(:'c', :'visa_no', '2026-01-31', 25, '{}'::uuid[], 25) as rec_v1 \gset
select public.cb_books_reconcile(:'c', :'visa_no', '2026-02-28', 25, '{}'::uuid[], 999) as rec_v2 \gset
select test.check('the first reconciliation starts from the opening balance in Books; later ones from the last ending balance',
  (select beginning = 25 and difference = 0 from public.cb_books_reconciliations where id = :'rec_v1')
  and (select beginning = 25 and difference = 0 from public.cb_books_reconciliations where id = :'rec_v2'));
select test.check('Undo the later reconciliation first', test.try(format('select public.cb_books_undo_reconcile(%L)', :'rec1')) = 'Undo the later reconciliation first.');
select public.cb_books_undo_reconcile(:'rec2');

-- Part 4.4: firm B reads and changes nothing of firm A's rules, reconciliations and column mappings.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b"}';
select test.check('firm B reads no rule, reconciliation or column mapping of firm A',
  (select count(*) from public.cb_books_rules) = 0 and (select count(*) from public.cb_books_reconciliations) = 0 and (select count(*) from public.cb_books_csv_maps) = 0);
select test.check('firm B cannot change firm A''s rules, reconcile, confirm or upload',
  test.try(format('select public.cb_books_rule_action(%L, ''delete'')', :'r1')) = 'Rule not found.'
  and test.try(format($q$select public.cb_books_save_rule(%L, null, '{"name":"x","conditions":[{"field":"amount","op":"eq","value":"1"}],"chart_account":"60200"}')$q$, :'c')) = 'Client not found.'
  and test.try(format('select public.cb_books_undo_reconcile(%L)', :'rec1')) = 'Reconciliation not found.'
  and test.try(format($q$select public.cb_books_confirm(%L, '[{"id":"%s","kind":"code","account":"60200","tax":"HST_ON"}]')$q$, :'c', :'l_coffee')) = 'Client not found.'
  and test.try(format($q$select public.cb_books_upload(%L, %L, 'x.csv', '[{"date":"2026-03-09","description":"X","amount":1}]')$q$, :'c', :'chq_no')) = 'Client not found.');
