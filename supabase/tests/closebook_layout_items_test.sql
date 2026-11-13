-- Local tests: layout clean-up items 3, 4 and 6 (Hashim, Nov 15, 2026): the direction rule in coding,
-- firm vendor rules, and standard entries added in step 5 with the amount only.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test', (select id from public.roles where name = 'Staff'));
reset role;
reset request.jwt.claims;
update public.role_permissions set level = 'edit' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Staff');
\set A '''00000000-0000-0000-0000-00000000000a'''
\set C '''00000000-0000-0000-0000-00000000000c'''
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
insert into public.clients (kind, legal_name, province) values ('corporation', 'Birch Test Realty Inc.', 'ON') returning id as client \gset
insert into public.clients (kind, legal_name, province) values ('corporation', 'Cedar Test Realty Inc.', 'ON') returning id as client2 \gset
select public.cb_create_file(:'client', '2026-12-31', '2026-01-01', '', 'full', 'statements', :C::uuid, :A::uuid) as f \gset

-- Item 3: direction. Card: charges positive, payments and refunds negative. Bank: deposits positive.
select (public.cb_upload_bank(:'f', null, 'Visa 1234', 'card', 'v.csv', 0, 113,
  '[{"line":2,"date":"2026-01-02","description":"SAMPLE SOFTWARE","amount":226},{"line":3,"date":"2026-01-05","description":"SAMPLE REFUND","amount":-113}]',
  '2026-01-01', '2026-01-31')) ->> 'account_id' as card \gset
select (public.cb_upload_bank(:'f', null, 'Chequing', 'bank', 'b.csv', 0, 900,
  '[{"line":2,"date":"2026-01-03","description":"SAMPLE COMMISSION","amount":1000},{"line":3,"date":"2026-01-04","description":"SAMPLE CHARGEBACK","amount":-100}]',
  '2026-01-01', '2026-01-31')) ->> 'account_id' as bank \gset
select id as soft from public.cb_bank_lines where description = 'SAMPLE SOFTWARE' \gset
select id as refund from public.cb_bank_lines where description = 'SAMPLE REFUND' \gset
select id as comm from public.cb_bank_lines where description = 'SAMPLE COMMISSION' \gset
select id as back from public.cb_bank_lines where description = 'SAMPLE CHARGEBACK' \gset
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_code_lines(:'f', format('[{"id":"%s","account":"65200","tax":"HST_ON"},{"id":"%s","account":"65200","tax":"HST_ON"},{"id":"%s","account":"40000","tax":"HST_ON"},{"id":"%s","account":"40000","tax":"HST_ON"}]',
  :'soft', :'refund', :'comm', :'back')::jsonb);
select test.check('an expense on a card charge is done', (select status from public.cb_bank_lines where id = :'soft') = 'done');
select test.check('an expense on a card payment (money in) goes to the reviewer with the reason', (select status || '|' || reviewer_reason from public.cb_bank_lines where id = :'refund')
  = 'reviewer|An expense coded to money in: check it is a refund, or choose another account.');
select test.check('revenue on a deposit is done', (select status from public.cb_bank_lines where id = :'comm') = 'done');
select test.check('revenue on money out goes to the reviewer with the reason', (select status || '|' || reviewer_reason from public.cb_bank_lines where id = :'back')
  = 'reviewer|Revenue coded to money out: check it is a refund to a customer, or choose another account.');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_code_lines(:'f', format('[{"id":"%s","account":"65200","tax":"HST_ON"}]', :'refund')::jsonb);
select test.check('the reviewer''s call on a flagged line is final', (select status from public.cb_bank_lines where id = :'refund') = 'done');
reset role;
select test.check('the source can be history or firm, not anything else', test.try(format($f$update public.cb_bank_lines set source = 'firm' where id = %L$f$, :'soft')) = 'OK'
  and test.try(format($f$update public.cb_bank_lines set source = 'guess' where id = %L$f$, :'soft')) like '%source_check%');
set role authenticated;

-- Item 4: firm vendor rules, owners only.
select public.cb_save_firm_vendor_rule('SAMPLE PRINT SHOP', '65100', 'HST_ON');
select public.cb_save_firm_vendor_rule('SAMPLE PRINT SHOP', '65200', 'HST_ON');
select test.check('one firm rule per vendor, the last save wins', (select count(*) || '|' || max(chart_account) from public.cb_firm_vendor_rules where vendor_key = 'SAMPLE PRINT SHOP') = '1|65200');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('staff read firm rules', (select count(*) from public.cb_firm_vendor_rules) = 1);
select test.check('staff cannot save a firm rule', test.try($$select public.cb_save_firm_vendor_rule('SAMPLE X', '65100', 'HST_ON')$$) like '%owner%');
select test.check('staff cannot delete a firm rule', test.try(format($f$select public.cb_delete_firm_vendor_rule(%L)$f$, (select id from public.cb_firm_vendor_rules limit 1))) like '%owner%');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_delete_firm_vendor_rule((select id from public.cb_firm_vendor_rules limit 1));
select test.check('owners delete a firm rule', (select count(*) from public.cb_firm_vendor_rules) = 0);

-- Item 6: standard entries.
select test.check('four standard entries to start', (select string_agg(name, ',' order by sort_order) from public.cb_standard_entries) = 'Home office,Auto expenses,Accounting fee accrual,Tax provision');
select id as accrual from public.cb_standard_entries where name = 'Accounting fee accrual' \gset
select id as taxp from public.cb_standard_entries where name = 'Tax provision' \gset
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('staff cannot change a standard entry', test.try(format($f$select public.cb_save_standard_entry(%L, 'X', 'AJE', 'accrual', '66000', '21100', '', '', false)$f$, :'accrual')) like '%owner%');
select test.check('the amount must be over 0.00', test.try(format($f$select public.cb_add_standard_entry(%L, %L, 0)$f$, :'f', :'accrual')) like '%more than 0.00%');
select public.cb_add_standard_entry(:'f', :'accrual', 2500) as e1 \gset
select test.check('everything but the amount comes from the setting', (select kind || '|' || reason || '|' || wp_ref || '|' || reverse_next_year || '|' || (standard_id = :'accrual') from public.cb_entries where id = :'e1')
  = 'AJE|accrual|Standard entry: accounting fee accrual|true|true');
select test.check('debit 66000, credit 21100, 2,500.00 each', (select string_agg(a.account_key || '=' || l.amount, ',' order by l.amount desc) from public.cb_entry_lines l join public.cb_accounts a on a.id = l.account_id where l.entry_id = :'e1')
  = 'chart:66000=2500.00,chart:21100=-2500.00');
select test.check('under the review threshold: no review needed', (select not needs_review from public.cb_entries where id = :'e1'));
select public.cb_add_standard_entry(:'f', :'taxp', 6000) as e2 \gset
select test.check('over the threshold: it goes to the reviewer, as a TJE', (select needs_review and kind = 'TJE' from public.cb_entries where id = :'e2'));

-- A client who keeps their own books: the client's account on the same GIFI line, else a new account.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_create_file(:'client2', '2026-12-31', '2026-01-01', '', 'full', 'client_software', :A::uuid, :A::uuid) as g \gset
select public.cb_import_tb(:'g', 'this_year', 'client_software', 'tb.csv', '[{"number":"5400","name":"Professional fees","amount":1000},{"number":"1000","name":"Bank","amount":-1000}]');
select public.cb_map_account(id, case number when '5400' then (select line_no from public.cb_chart_accounts where number = '66000') else '1002.00' end) from public.cb_accounts where file_id = :'g';
-- A bare GIFI-line account on the credit's line is not the client's account.
reset role;
insert into public.cb_accounts (file_id, account_key, number, name, line_no) select :'g', 'line:' || line_no, '', 'Old line account', line_no from public.cb_chart_accounts where number = '21100';
set role authenticated;
select public.cb_add_standard_entry(:'g', :'accrual', 1500) as e3 \gset
select test.check('own books: the debit goes to the client''s own account on that line', exists (select 1 from public.cb_entry_lines l join public.cb_accounts a on a.id = l.account_id where l.entry_id = :'e3' and a.number = '5400' and l.amount = 1500));
select test.check('own books: the credit goes to a new account in plain words', exists (select 1 from public.cb_entry_lines l join public.cb_accounts a on a.id = l.account_id
  where l.entry_id = :'e3' and a.client_new and a.name = (select name from public.cb_chart_accounts where number = '21100') and l.amount = -1500));
select public.cb_delete_standard_entry(:'accrual');
select test.check('deleting a standard entry keeps the entries made from it', (select count(*) from public.cb_entries where id in (:'e1', :'e3') and standard_id is null) = 2);
reset role;
reset request.jwt.claims;
