-- Local tests: round 31, step 4 (Hashim, Nov 17, 2026): QuickBooks Online's Bank transactions page. A Pending line can
-- hold an account and posts nothing; Post posts; a pair posts one entry and moves both lines; a line posted to another
-- account first is matched later with no second entry; Undo; Exclude with the reviewer's tick; Ask client is a flag;
-- splits add up; rules (vendor rules copied in). Safe to run twice. Dummy data only.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
\set A '''00000000-0000-0000-0000-00000000000a'''
insert into public.clients (kind, legal_name, province) values ('corporation', 'Maple Dummy Feed Inc.', 'ON') returning id as client \gset
select public.cb_create_file(:'client', '2026-08-31', '2025-09-01', '', 'full', 'statements', :A::uuid, :A::uuid) as f \gset
select public.cb_save_setup(:'f', '{"gst_registered": true, "gst_frequency": "quarterly", "quick_method": false}');
select public.cb_save_bank_account(:'f', null, 'chequing', 'Dummy Chq', '1357', 5000.00, false, false) as chq \gset
select public.cb_save_bank_account(:'f', null, 'card', 'Dummy MC', '4417', 1250.00, false, false) as card \gset
select public.cb_save_bank_account(:'f', null, 'loc', 'Dummy LOC', '1111', 4000.00, false, false) as loc \gset
reset role;
select private.cb_add_statement(:'f', :'chq', 'chq.pdf', 5000.00, 2994.00, '[
  {"line": 1, "date": "2025-09-02", "description": "LOAN PAYMENT", "amount": -800.00},
  {"line": 2, "date": "2025-09-30", "description": "Monthly fee", "amount": -6.00},
  {"line": 3, "date": "2025-10-06", "description": "TRANSFER TO MC", "amount": -250.00},
  {"line": 4, "date": "2025-11-12", "description": "OFFICE SUPPLY DUMMY", "amount": -113.00},
  {"line": 5, "date": "2025-12-19", "description": "MC PAYMENT", "amount": -500.00},
  {"line": 6, "date": "2026-01-21", "description": "DUPLICATE CHARGE DUMMY", "amount": -45.00},
  {"line": 7, "date": "2026-02-10", "description": "SOFTWARE DUMMY", "amount": -292.00}]', '2025-09-01', '2026-08-31', 5000.00, 2994.00, null);
select private.cb_add_statement(:'f', :'card', 'card.pdf', 1250.00, 750.00, '[
  {"line": 1, "date": "2025-12-20", "posted": "2025-12-22", "description": "PAYMENT - THANK YOU", "amount": -500.00}]', '2025-09-01', '2026-08-31', 1250.00, 750.00, null);
select private.cb_add_statement(:'f', :'loc', 'loc.pdf', 4000.00, 3200.00, '[
  {"line": 1, "date": "2025-09-02", "description": "PAYMENT", "amount": -800.00}]', '2025-09-01', '2026-08-31', 4000.00, 3200.00, null);
create function test.l(p_desc text) returns uuid language sql security definer set search_path = '' as $$ select id from public.cb_bank_lines where description = p_desc $$;
grant execute on function test.l(text) to authenticated;
set role authenticated;

-- ---------- A Pending line keeps its account and posts nothing; Post posts.
select public.cb_fill_lines(:'f', jsonb_build_array(jsonb_build_object('id', test.l('Monthly fee'), 'account', '63000', 'tax', 'EXEMPT')));
select test.check('a Pending line with an account stays Pending', (select status = 'new' and chart_account = '63000' from public.cb_bank_lines where id = test.l('Monthly fee')));
select public.cb_post_lines(:'f', jsonb_build_array(jsonb_build_object('id', test.l('Monthly fee'), 'kind', 'code', 'account', '63000', 'tax', 'EXEMPT')));
select test.check('Post posts it', (select status = 'done' from public.cb_bank_lines where id = test.l('Monthly fee')));
select test.check('Post needs a sales tax code', test.try(format($q$select public.cb_post_lines(%L, '[{"id": "%s", "kind": "code", "account": "63000"}]')$q$, :'f', test.l('SOFTWARE DUMMY')))
  = 'Choose a sales tax code for every line. Nothing was posted.');

-- ---------- A pair: one entry from the money-out line, both lines move; Undo returns both.
select public.cb_post_lines(:'f', jsonb_build_array(jsonb_build_object('id', test.l('PAYMENT'), 'kind', 'pair', 'other', test.l('LOAN PAYMENT'))));
select test.check('pair posted from either side: one transfer, chequing posts, the line of credit is matched',
  (select count(*) = 1 from public.cb_bank_transfers where out_line = test.l('LOAN PAYMENT') and in_line = test.l('PAYMENT'))
  and (select status = 'done' and chart_account = '22100' from public.cb_bank_lines where id = test.l('LOAN PAYMENT'))
  and (select status = 'matched' from public.cb_bank_lines where id = test.l('PAYMENT')));
select public.cb_unpost_lines(:'f', array[test.l('LOAN PAYMENT')]);
select test.check('Undo on one side: both back in Pending', (select bool_and(status = 'new' and chart_account is null) from public.cb_bank_lines where id in (test.l('LOAN PAYMENT'), test.l('PAYMENT')))
  and not exists (select 1 from public.cb_bank_transfers where file_id = :'f'));
select test.check('a card payment pairs on its posting date (Dec 19 and Dec 20 posted Dec 22: 1 day)',
  private.cb_pair_days((select l from public.cb_bank_lines l where id = test.l('MC PAYMENT')), (select l from public.cb_bank_lines l where id = test.l('PAYMENT - THANK YOU'))) = 1);

-- ---------- Unpair: never again.
select public.cb_pair_choice(:'f', test.l('MC PAYMENT'), test.l('PAYMENT - THANK YOU'), 'rejected');
select test.check('an unpaired pair cannot be posted as a pair', test.try(format($q$select public.cb_post_lines(%L, '[{"id": "%s", "kind": "pair", "other": "%s"}]')$q$,
  :'f', test.l('MC PAYMENT'), test.l('PAYMENT - THANK YOU'))) = 'These two lines were unpaired.');

-- ---------- Posted to the card before the card's line came in; then matched with no second entry.
select public.cb_post_lines(:'f', jsonb_build_array(jsonb_build_object('id', test.l('TRANSFER TO MC'), 'kind', 'transfer', 'transfer_account', :'card')));
reset role;
insert into public.cb_bank_lines (statement_id, file_id, account_id, row_no, txn_date, description, amount)
  values ((select id from public.cb_bank_statements where account_id = :'card'), :'f', :'card', 9, '2025-10-08', 'PAYMENT RECEIVED DUMMY', -250.00);
set role authenticated;
select public.cb_post_lines(:'f', jsonb_build_array(jsonb_build_object('id', test.l('PAYMENT RECEIVED DUMMY'), 'kind', 'already', 'other', test.l('TRANSFER TO MC'))));
select test.check('already posted from chequing: the card line is matched, the chequing line still posts once',
  (select status = 'matched' from public.cb_bank_lines where id = test.l('PAYMENT RECEIVED DUMMY'))
  and (select status = 'done' and transfer_account = :'card' from public.cb_bank_lines where id = test.l('TRANSFER TO MC')));
select public.cb_unpost_lines(:'f', array[test.l('PAYMENT RECEIVED DUMMY')]);
select test.check('Undo on the later line returns it and leaves the first entry alone',
  (select status = 'new' from public.cb_bank_lines where id = test.l('PAYMENT RECEIVED DUMMY'))
  and (select status = 'done' and transfer_account = :'card' from public.cb_bank_lines where id = test.l('TRANSFER TO MC')));

-- ---------- Split: the rows must add up.
select test.check('a split that does not add up is refused', test.try(format($q$select public.cb_save_splits(%L, '[{"account": "60000", "tax": "HST_ON", "amount": 60}, {"account": "63000", "tax": "EXEMPT", "amount": 50}]')$q$,
  test.l('OFFICE SUPPLY DUMMY'))) = 'Left to split: 3.00. Nothing was saved.');
select public.cb_save_splits(test.l('OFFICE SUPPLY DUMMY'), '[{"account": "60000", "tax": "HST_ON", "amount": 60}, {"account": "63000", "tax": "EXEMPT", "amount": 53}]');
select public.cb_post_lines(:'f', jsonb_build_array(jsonb_build_object('id', test.l('OFFICE SUPPLY DUMMY'), 'kind', 'split')));
select test.check('split 60.00 and 53.00, posted', (select status = 'done' and is_split from public.cb_bank_lines where id = test.l('OFFICE SUPPLY DUMMY'))
  and (select count(*) = 2 and sum(amount) = 113 from public.cb_line_splits where line_id = test.l('OFFICE SUPPLY DUMMY')));

-- ---------- Ask client is a flag; Exclude; the sign-off lists excluded lines until the reviewer ticks them.
select public.cb_ask_client_lines(:'f', array[test.l('SOFTWARE DUMMY')], 'What was this payment for?');
select test.check('asked the client: still Pending, with the question', (select status = 'new' and asked_at is not null and client_question = 'What was this payment for?'
  from public.cb_bank_lines where id = test.l('SOFTWARE DUMMY')));
select public.cb_exclude_lines(:'f', array[test.l('DUPLICATE CHARGE DUMMY')], 'duplicate', '');
select test.check('excluded, with who and the reason', (select status = 'excluded' and excluded_reason = 'duplicate' and excluded_by = :A::uuid from public.cb_bank_lines where id = test.l('DUPLICATE CHARGE DUMMY')));
select test.check('Other needs a note', test.try(format($q$select public.cb_exclude_lines(%L, array['%s']::uuid[], 'other', '')$q$, :'f', test.l('SOFTWARE DUMMY'))) = 'Say why the line is excluded.');
reset role;
select test.check('the sign-off lists the excluded line', exists (select 1 from unnest(private.cb_step_problems(:'f', 'code')) x where x = 'Excluded: 1 line · 45.00. The reviewer ticks "Excluded lines reviewed".'));
set role authenticated;
select public.cb_excluded_reviewed(:'f', true);
reset role;
select test.check('ticked: no longer listed', not exists (select 1 from unnest(private.cb_step_problems(:'f', 'code')) x where x like 'Excluded:%'));
set role authenticated;
select public.cb_restore_lines(:'f', array[test.l('DUPLICATE CHARGE DUMMY')]);
select test.check('Undo: back in Pending', (select status = 'new' from public.cb_bank_lines where id = test.l('DUPLICATE CHARGE DUMMY')));
select test.check('History has Posted, Excluded and Back to Pending', (select count(distinct detail) = 3 from public.cb_file_history where file_id = :'f' and detail in ('Posted', 'Excluded', 'Back to Pending')));

-- ---------- Rules
select public.cb_save_rule(:'f', null, '{"name": "Monthly fee", "direction": "out", "accounts": [], "match_all": true, "conditions": [{"field": "description", "op": "contains", "value": "Monthly fee"}],
  "txn_type": "expense", "account": "63000", "tax": "EXEMPT", "memo": "", "auto_post": false}') as rule \gset
select test.check('a rule is the client''s, with its conditions', (select client_id = :'client' and priority = 1 and chart_account = '63000' from public.cb_bank_rules where id = :'rule'));
select test.check('a rule needs its sales tax', test.try(format($q$select public.cb_save_rule(%L, null, '{"name": "x", "direction": "out", "conditions": [{"field": "description", "op": "contains", "value": "x"}], "account": "63000"}')$q$, :'f'))
  = 'Choose the sales tax.');
select test.check('an amount condition needs an amount', test.try(format($q$select public.cb_save_rule(%L, null, '{"name": "x", "direction": "out", "conditions": [{"field": "amount", "op": "eq", "value": "six"}], "account": "63000", "tax": "EXEMPT"}')$q$, :'f'))
  = 'An amount condition needs an amount, for example 6.00.');

-- ---------- Safe to run twice; the old question list becomes a flag.
reset role;
update public.cb_bank_lines set status = 'ask_client', asked_at = null where id = test.l('SOFTWARE DUMMY');
insert into public.cb_vendor_rules (client_id, vendor_key, chart_account, tax_code) values (:'client', 'SAMPLE PRINT SHOP GUELPH ON', '60000', 'HST_ON');
\i supabase/migrations/20261212080000_round31_step4_bank_transactions.sql
\i supabase/migrations/20261212380000_piece_r3a1_roles_rights.sql   -- piece R3a-1: the replay above restores owner checks; put the rights back
select test.check('safe to run twice, and a line on the old question list becomes a Pending line with the flag',
  (select status = 'new' and asked_at is not null from public.cb_bank_lines where id = test.l('SOFTWARE DUMMY'))
  and (select (length(d) - length(replace(d, 'Round 31: Pending lines', ''))) / length('Round 31: Pending lines') = 1
       from (select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'cb_step_problems') x));
select test.check('a vendor rule moves into the rules list once: Description contains the vendor, money in or out',
  (select count(*) = 1 and min(direction) = 'any' and min(conditions -> 0 ->> 'value') = 'SAMPLE PRINT SHOP GUELPH ON' and min(priority) = 2
     from public.cb_bank_rules where client_id = :'client' and from_vendor_rule is not null));
\i supabase/migrations/20261212080000_round31_step4_bank_transactions.sql
\i supabase/migrations/20261212380000_piece_r3a1_roles_rights.sql   -- piece R3a-1: the replay above restores owner checks; put the rights back
select test.check('copied once only', (select count(*) = 1 from public.cb_bank_rules where client_id = :'client' and from_vendor_rule is not null));
