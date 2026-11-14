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
-- Round 3 item 5: nothing is confirmed before the GST/HST questions are answered.
select test.check('no coding before the GST/HST answers', test.try(format($f$select public.cb_code_lines(%L, '[{"id":"%s","account":"65200","tax":"HST_ON"}]')$f$, :'f', :'soft')) like '%GST/HST questions in step 1%');
select public.cb_save_setup(:'f', '{"gst_registered": true, "quick_method": false}');
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

-- Item 4, round 2 item 3: firm vendor rules, owners only, never a provincial code.
select public.cb_save_firm_vendor_rule('SAMPLE PRINT SHOP', '65100', 'taxable');
select public.cb_save_firm_vendor_rule('SAMPLE PRINT SHOP', '65200', 'none');
select test.check('one firm rule per vendor, the last save wins', (select count(*) || '|' || max(chart_account) || '|' || max(tax_mode) from public.cb_firm_vendor_rules where vendor_key = 'SAMPLE PRINT SHOP') = '1|65200|none');
select test.check('a firm rule takes no provincial code', test.try($$select public.cb_save_firm_vendor_rule('SAMPLE X', '65100', 'HST_ON')$$) like '%taxable at the client%'
  and test.try($$insert into public.cb_firm_vendor_rules (vendor_key, chart_account, tax_code) values ('SAMPLE Y', '65100', 'HST_ON')$$) <> 'OK');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('staff read firm rules', (select count(*) from public.cb_firm_vendor_rules) = 1);
select test.check('staff cannot save a firm rule', test.try($$select public.cb_save_firm_vendor_rule('SAMPLE X', '65100', 'taxable')$$) like '%owner%');
select test.check('staff cannot delete a firm rule', test.try(format($f$select public.cb_delete_firm_vendor_rule(%L)$f$, (select id from public.cb_firm_vendor_rules limit 1))) like '%owner%');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_delete_firm_vendor_rule((select id from public.cb_firm_vendor_rules limit 1));
select test.check('owners delete a firm rule', (select count(*) from public.cb_firm_vendor_rules) = 0);

-- Round 2 item 5: the same lines uploaded again are found, on any account.
select test.check('an upload''s lines already in the file are listed, with the account they are on',
  (select count(*) || '|' || max(account_name) from public.cb_duplicate_lines(:'f', '[{"line":2,"date":"2026-01-02","description":"sample software","amount":226},{"line":3,"date":"2026-01-03","description":"NEW LINE","amount":5}]')) = '1|Visa 1234');

-- Round 3 items 3 and 4: duplicates already in the file, and lines uploaded although already in it.
select (public.cb_upload_bank(:'f', null, 'Visa again', 'card', 'v2.csv', 0, 113,
  '[{"line":2,"date":"2026-01-02","description":"SAMPLE SOFTWARE","amount":226},{"line":3,"date":"2026-01-05","description":"SAMPLE REFUND","amount":-113}]',
  '2026-01-01', '2026-01-31')) ->> 'statement' as st2 \gset
select test.check('the file lists lines that are in it twice', (select count(*) || '|' || min(times) from public.cb_file_duplicates(:'f')) = '2|2');
select public.cb_flag_uploaded_duplicates(:'f', :'st2');
select test.check('confirmed as real: the new copies go to the reviewer with the reason, and leave the list',
  (select count(*) from public.cb_bank_lines where statement_id = :'st2' and status = 'reviewer' and reviewer_reason = 'Uploaded although already in the file.') = 2
  and not exists (select 1 from public.cb_file_duplicates(:'f')));
-- Round 3 item 5: a change to the GST/HST answers sends taxed lines back to the reviewer.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_save_setup(:'f', '{"quick_method": true}');
select test.check('quick method switched on: confirmed lines with tax go back to the reviewer', (select status || '|' || reviewer_reason from public.cb_bank_lines where id = :'soft') like 'reviewer|The GST/HST answers changed%');
select public.cb_save_setup(:'f', '{"realtor": true}');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';

-- Round 2 item 1: memo, W/P reference, prior period adjustments.
\set L '[{"chart":"66000","amount":100},{"chart":"21100","amount":-100}]'
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('a memo is required', test.try(format($f$select public.cb_add_entry(%L, 'AJE', 'accrual', '', false, %L, 'Payables listing')$f$, :'f', :'L')) like '%memo%');
select test.check('a W/P reference is required', test.try(format($f$select public.cb_add_entry(%L, 'AJE', 'accrual', 'Accrue a fee', false, %L, '')$f$, :'f', :'L')) like '%W/P reference%');
select test.check('only an accrual reverses next year', test.try(format($f$select public.cb_add_entry(%L, 'AJE', 'correction', 'Fix a fee', true, %L, 'Payables listing')$f$, :'f', :'L')) like '%Only an accrual%');
select test.check('a line on 31500 needs the reason "Prior period adjustment"',
  test.try(format($f$select public.cb_add_entry(%L, 'AJE', 'accrual', 'Missed accrual', false, '[{"chart":"31500","amount":100},{"chart":"21100","amount":-100}]', 'Prior year file')$f$, :'f')) like '%needs the reason%');
select test.check('that reason needs a 31500 line',
  test.try(format($f$select public.cb_add_entry(%L, 'AJE', 'prior_period', 'Missed accrual', false, %L, 'Prior year file')$f$, :'f', :'L')) like '%needs a line on 31500%');
select public.cb_add_entry(:'f', 'AJE', 'prior_period', 'Missed accrual last year', false, '[{"chart":"31500","amount":100},{"chart":"21100","amount":-100}]', 'Prior year file') as ppa \gset
select test.check('a prior period adjustment posts to 31500', exists (select 1 from public.cb_entry_lines l join public.cb_accounts a on a.id = l.account_id where l.entry_id = :'ppa' and a.account_key = 'chart:31500'));

-- Round 2 item 11: the date, the sales tax line, attachments.
select public.cb_add_entry(:'f', 'AJE', 'correction', 'Home office, business share', false,
  '[{"chart":"65100","amount":1000,"tax_code":"HST_ON"},{"chart":"21500","amount":130,"is_tax":true},{"chart":"23000","amount":-1130}]', 'Home office schedule', '2026-06-30', null, '{closebook/x/a.pdf}') as hom \gset
select test.check('the tax posts as its own line to 21500, the date and attachment are kept', (select e.entry_date || '|' || array_length(e.attachments, 1) || '|' ||
  (select string_agg(a.number || ':' || l.amount || ':' || l.is_tax, ',' order by l.amount desc) from public.cb_entry_lines l join public.cb_accounts a on a.id = l.account_id where l.entry_id = e.id)
  from public.cb_entries e where e.id = :'hom') = '2026-06-30|1|65100:1000.00:false,21500:130.00:true,23000:-1130.00:false');
select test.check('the date must fall in the year', test.try(format($f$select public.cb_add_entry(%L, 'AJE', 'correction', 'Out of year', false, %L, 'Payables listing', '2027-01-01')$f$, :'f', :'L')) like '%year%');

-- Round 4 item 3: Clearing (10900) has no GIFI line, and an entry may post to it to clear a balance.
select test.check('Clearing is in the standard chart, an asset with no GIFI line', (select account_type || '|' || coalesce(line_no, 'none') from public.cb_chart_accounts where number = '10900') = 'Asset|none');
select public.cb_add_entry(:'f', 'AJE', 'correction', 'Clear the card payment', false, '[{"chart":"22000","amount":500},{"chart":"10900","amount":-500}]', 'Bank statements') as clr \gset
select public.cb_add_entry(:'f', 'AJE', 'correction', 'Clear it again from the file account', false,
  format('[{"account":"%s","amount":10},{"chart":"22000","amount":-10}]', (select id from public.cb_accounts where file_id = :'f' and account_key = 'chart:10900'))::jsonb, 'Bank statements') is not null;
select test.check('entries post to Clearing', (select count(*) from public.cb_entry_lines l join public.cb_accounts a on a.id = l.account_id where a.account_key = 'chart:10900') = 2);

-- Item 6: standard entries, now picked in the entry form.
select test.check('four simple standard entries to start (round 9 adds one with lines)', (select string_agg(name, ',' order by sort_order) from public.cb_standard_entries where style = 'simple') = 'Home office,Auto expenses,Accounting fee accrual,Tax provision');
select id as accrual from public.cb_standard_entries where name = 'Accounting fee accrual' \gset
select id as taxp from public.cb_standard_entries where name = 'Tax provision' \gset
select test.check('staff cannot change a standard entry', test.try(format($f$select public.cb_save_standard_entry(%L, 'X', 'AJE', 'accrual', '66000', '21100', '', '', false, 'none')$f$, :'accrual')) like '%owner%');
select test.check('standard entries carry a tax choice, never a code: home office no tax, the accounting fee taxable', (select string_agg(name || '=' || tax_mode, ',' order by sort_order) from public.cb_standard_entries where style = 'simple')
  = 'Home office=none,Auto expenses=line,Accounting fee accrual=taxable,Tax provision=none');
select public.cb_add_entry(:'f', 'AJE', 'accrual', 'To accrue the year-end accounting fee.', true, '[{"chart":"66000","amount":2500},{"chart":"21100","amount":-2500}]', 'Standard entry: accounting fee accrual', null, :'accrual') as e1 \gset
select test.check('a standard entry as set, under the threshold: no review needed', (select not needs_review and standard_id = :'accrual' from public.cb_entries where id = :'e1'));
select public.cb_add_entry(:'f', 'AJE', 'accrual', 'To accrue the year-end accounting fee.', true, '[{"chart":"65100","amount":2500},{"chart":"21100","amount":-2500}]', 'Standard entry: accounting fee accrual', null, :'accrual') as e1b \gset
select test.check('a standard entry with its accounts changed goes to the reviewer', (select needs_review from public.cb_entries where id = :'e1b'));
select public.cb_add_entry(:'f', 'TJE', 'tax', 'Income tax provision.', false, '[{"chart":"72000","amount":6000},{"chart":"21400","amount":-6000}]', 'Income tax schedule', null, :'taxp') as e2 \gset
select test.check('over the threshold: it goes to the reviewer', (select needs_review and kind = 'TJE' from public.cb_entries where id = :'e2'));

-- Round 2 item 2: a client who keeps their own books. The preparer picks the client's account or names a
-- new one; a standard chart account with no client account on its line is refused, except the tax line.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_create_file(:'client2', '2026-12-31', '2026-01-01', '', 'full', 'client_software', :A::uuid, :A::uuid) as g \gset
select public.cb_import_tb(:'g', 'this_year', 'client_software', 'tb.csv', '[{"number":"5400","name":"Professional fees","amount":1000},{"number":"1000","name":"Bank","amount":-1000}]');
select public.cb_map_account(id, case number when '5400' then (select line_no from public.cb_chart_accounts where number = '66000') else '1002.00' end) from public.cb_accounts where file_id = :'g';
reset role;
insert into public.cb_accounts (file_id, account_key, number, name, line_no) select :'g', 'line:' || line_no, '', 'Old line account', line_no from public.cb_chart_accounts where number = '21100';
set role authenticated;
select id as fees from public.cb_accounts where file_id = :'g' and number = '5400' \gset
select test.check('own books: a standard chart account with no client account on its line is refused',
  test.try(format($f$select public.cb_add_entry(%L, 'AJE', 'accrual', 'Accrue the fee', false, '[{"account":"%s","amount":1500},{"chart":"21100","amount":-1500}]', 'Payables listing')$f$, :'g', :'fees')) like '%client''s accounts%');
select public.cb_add_entry(:'g', 'AJE', 'accrual', 'To accrue the year-end accounting fee.', true,
  format('[{"account":"%s","amount":1500,"tax_code":"HST_ON"},{"chart":"21500","amount":195,"is_tax":true},{"line":"%s","new_name":"Accrued liabilities","new_type":"Other Current Liabilities","amount":-1695}]',
    :'fees', (select line_no from public.cb_chart_accounts where number = '21100'))::jsonb, 'Payables listing', null, :'accrual') as e3 \gset
select test.check('own books: the client''s account, a named new account, and GST/HST payable as a new account', (select string_agg(a.name || ':' || a.client_new, ',' order by l.amount desc)
  from public.cb_entry_lines l join public.cb_accounts a on a.id = l.account_id where l.entry_id = :'e3') = 'Professional fees:false,GST/HST payable:true,Accrued liabilities:true');
select public.cb_delete_standard_entry(:'accrual');
select test.check('deleting a standard entry keeps the entries made from it', (select count(*) from public.cb_entries where id in (:'e1', :'e3') and standard_id is null) = 2);
reset role;
reset request.jwt.claims;
