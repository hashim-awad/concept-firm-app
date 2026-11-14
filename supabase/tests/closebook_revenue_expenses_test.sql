-- Local tests: round 9 (Hashim, Nov 27, 2026), the revenue check and expenses paid personally, on step 5.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'prep.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Preparer C', 'prep.c@example.test', (select id from public.roles where name = 'Staff'));
reset role;
reset request.jwt.claims;
update public.role_permissions set level = 'edit' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Staff');
insert into public.clients (kind, legal_name, province) values ('corporation', 'Spruce Test Realty Inc.', 'ON') returning id as client \gset

set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_create_file(:'client', '2026-12-31', '2026-01-01', '', 'full', 'client_software', '00000000-0000-0000-0000-00000000000c'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid) as f \gset
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_save_setup(:'f', '{"realtor":true,"owner_paid":true,"dividends":false,"payroll":false,"holdco":false,"gst_registered":true,"gst_frequency":"annual","quick_method":false}');
select public.cb_import_tb(:'f', 'this_year', 'client_software', 'tb.csv', '[
  {"number":"10100","name":"Chequing","amount":12000},{"number":"41000","name":"Commission income","amount":-20000},
  {"number":"64250","name":"Accounting fees","amount":8000},{"number":"23000","name":"Due to shareholder","amount":-1000},
  {"number":"60200","name":"Meals","amount":500},{"number":"70600","name":"Vehicle expenses","amount":500}]');
select public.cb_map_account(id, case number when '10100' then '1002.00' when '41000' then '8000.00' when '64250' then '8862.00'
  when '23000' then '2781.10' when '60200' then '8523.00' else '9281.00' end) from public.cb_accounts where file_id = :'f';
reset role;
reset request.jwt.claims;

-- A. The revenue check.
select test.check('A1: TB revenue is every revenue account, as a positive amount', (private.cb_revenue_state(:'f') ->> 'tb')::numeric = 20000);
select test.check('A1: a realtor starts with the brokerage''s commission statement',
  private.cb_step5_problems(:'f') @> array['Revenue check: enter the brokerage''s commission statement.']);
select test.check('A2: a registrant also enters the GST/HST returns', private.cb_step5_problems(:'f') @> array['Revenue check: enter the revenue on the year''s GST/HST returns.']);
select test.check('A6: a realtor enters the brokerage''s T4A, or says there is none', private.cb_step5_problems(:'f') @> array['Revenue check: enter the brokerage''s T4A, or say there is none.']);
select test.check('a check with no source is open work for the preparer, not a difference: nothing waits for the reviewer',
  private.cb_step5_waiting(:'f') = '{}' and not (private.cb_revenue_state(:'f') ->> 'waiting')::boolean);

set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('step 5 cannot be signed as prepared before the revenue check',
  test.try(format($q$select public.cb_sign_step(%L, 'entries', 'prepared')$q$, :'f')) like 'Not yet: %Revenue check%');
select test.check('A1: a source needs its report attached', test.try(format($q$select public.cb_add_revenue_source(%L, 'commission_statement', '', 'Brokerage', 19000, '')$q$, :'f')) = 'Attach the report.');
select test.check('A1: a T4A says who paid it', test.try(format($q$select public.cb_add_revenue_source(%L, 't4a', '', 'Slip', 19000, 'x.pdf')$q$, :'f')) = 'Say who paid the T4A: the brokerage or another payer.');
select public.cb_add_revenue_source(:'f', 'commission_statement', '', 'Brokerage tax worksheet', 19000, 'files/statement.pdf') as src \gset
select public.cb_add_revenue_source(:'f', 'gst_returns', '', 'Annual return', 20000, 'files/gst.pdf') as gst \gset
select public.cb_add_revenue_source(:'f', 't4a', 'brokerage', 'T4A box 048', 18500, 'files/t4a.pdf') as t4a \gset
reset role;
reset request.jwt.claims;
select test.check('A3: the difference to the cent', (private.cb_revenue_state(:'f') ->> 'diff')::numeric = 1000.00);
select test.check('A6: the T4A is compared with the commission statement, not added to revenue',
  (private.cb_revenue_state(:'f') ->> 'sources')::numeric = 19000 and (private.cb_revenue_state(:'f') ->> 't4a_diff')::numeric = 500);
select test.check('A4: a difference is explained or fixed', private.cb_step5_problems(:'f') @> array['Revenue check: explain the difference, or fix it with an entry.']);
select test.check('A6: a T4A difference is explained', private.cb_step5_problems(:'f') @> array['Revenue check: explain the difference between the T4A and the commission statement.']);
select test.check('A5: a difference under the threshold does not wait for the reviewer', private.cb_step5_waiting(:'f') = '{}');

-- A4: fixed with an entry made from the check, linked back to it.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_add_revenue_entry(:'f', 'Commission booked twice in December.', jsonb_build_array(
  jsonb_build_object('account', (select id from public.cb_accounts where file_id = :'f' and number = '41000'), 'amount', 1000, 'memo', 'Duplicate'),
  jsonb_build_object('account', (select id from public.cb_accounts where file_id = :'f' and number = '10100'), 'amount', -1000, 'memo', 'Duplicate')), false) as fix \gset
select public.cb_save_revenue_check(:'f', '', '', 'Brokerage slip left out a December deal of 500.00.', false);
reset role;
reset request.jwt.claims;
select test.check('A4: the fix entry says it came from the revenue check', (select origin || '|' || wp_ref || '|' || entry_date from public.cb_entries where id = :'fix') = 'revenue_check|Revenue check|2026-12-31');
select test.check('A4: the fix clears the difference', (private.cb_revenue_state(:'f') ->> 'diff')::numeric = 0);
select test.check('A2: the GST/HST difference opens after the fix', private.cb_step5_problems(:'f') = array['Revenue check: explain the difference with the GST/HST returns.']);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('A4: one line only', test.try(format($q$select public.cb_save_revenue_check(%L, repeat('x', 201), '', '', false)$q$, :'f')) = 'Keep each explanation to one line (200 characters).');
select public.cb_save_revenue_check(:'f', '', 'The return was filed before the duplicate was found.', 'Brokerage slip left out a December deal of 500.00.', false);
reset role;
reset request.jwt.claims;
select test.check('the revenue check is done', private.cb_step5_problems(:'f') = '{}');

-- A5: a difference over the threshold goes to the reviewer and waits on the step 6 list.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_remove_revenue_source(:'src');
select public.cb_add_revenue_source(:'f', 'commission_statement', '', 'Brokerage tax worksheet', 10000, 'files/statement.pdf');
reset role;
reset request.jwt.claims;
select test.check('A5: over the threshold, each check waits for the reviewer (revenue and T4A here)', private.cb_step5_waiting(:'f')
  = array['Revenue difference of 9,000.00, over the review threshold.', 'T4A difference of (8,500.00), over the review threshold.']);
select test.check('A5: and step 6 waits for them', private.cb_step_waiting(:'f', 'entries') @> array['T4A difference of (8,500.00), over the review threshold.']);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('A5: the preparer cannot accept it', test.try(format($q$select public.cb_accept_revenue_difference(%L, 'revenue')$q$, :'f')) like 'Only the reviewer accepts%');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('A5: an explanation written for another difference does not count', test.try(format($q$select public.cb_accept_revenue_difference(%L, 't4a')$q$, :'f')) = 'The preparer explains this difference first.');
select test.check('A5: nothing to accept on a check within the threshold', test.try(format($q$select public.cb_accept_revenue_difference(%L, 'gst')$q$, :'f')) like 'Nothing to accept%');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_save_revenue_check(:'f', 'Second statement from the old brokerage still to come.', 'The return was filed before the duplicate was found.', 'The slip covers both brokerages.', false);
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_accept_revenue_difference(:'f', 'revenue');
select public.cb_accept_revenue_difference(:'f', 't4a');
reset role;
reset request.jwt.claims;
select test.check('A5: accepted, nothing waits', private.cb_step5_waiting(:'f') = '{}');
select test.check('A5: the history has each acceptance, signed', (select string_agg(detail, ' | ' order by id) from public.cb_file_history where file_id = :'f' and action = 'revenue_accepted')
  = 'Revenue difference 9,000.00 accepted | T4A difference (8,500.00) accepted');

-- A sign flip is a different difference: the explanation and the acceptance open again.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_remove_revenue_source(:'t4a');
select public.cb_add_revenue_source(:'f', 't4a', 'brokerage', 'T4A corrected', 1500, 'files/t4a.pdf');
select public.cb_remove_revenue_source(:'gst');
select public.cb_add_revenue_source(:'f', 'gst_returns', '', 'Annual return, amended', 18000, 'files/gst.pdf');
reset role;
reset request.jwt.claims;
select test.check('A4: T4A (8,500.00) became 8,500.00: its explanation is open again',
  (private.cb_revenue_state(:'f') ->> 't4a_diff')::numeric = 8500 and private.cb_step5_problems(:'f') @> array['Revenue check: explain the difference between the T4A and the commission statement.']);
select test.check('A5: and its acceptance too: it waits again', private.cb_step5_waiting(:'f') = array['T4A difference of 8,500.00, over the review threshold.']);
select test.check('A4: GST/HST (1,000.00) became 1,000.00: its explanation is open again',
  (private.cb_revenue_state(:'f') ->> 'gst_diff')::numeric = 1000 and private.cb_step5_problems(:'f') @> array['Revenue check: explain the difference with the GST/HST returns.']);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_remove_revenue_source(id) from public.cb_revenue_sources where file_id = :'f' and kind = 'gst_returns';
select public.cb_add_revenue_source(:'f', 'gst_returns', '', 'Annual return, amended', 12000, 'files/gst.pdf');
select public.cb_add_revenue_source(:'f', 'slips', '', 'T5018', 100, 'files/t5018.pdf');
reset role;
reset request.jwt.claims;
select test.check('A5: the GST/HST check over the threshold waits for the reviewer', private.cb_step5_waiting(:'f') @> array['GST/HST returns difference of 7,000.00, over the review threshold.']);
select test.check('A4: an explanation written for another difference is open again',
  private.cb_step5_problems(:'f') @> array['Revenue check: the difference changed since it was explained. Check the explanation and save it again.']);
select test.check('A5: a new revenue difference waits again', private.cb_step5_waiting(:'f') @> array['Revenue difference of 8,900.00, over the review threshold.']);

-- B. Expenses paid personally: the standard entry.
select (select id from public.cb_standard_entries where name = 'Expenses paid personally') as std \gset
select test.check('B7: 31 lines, in the sheet''s order', (select count(*) from public.cb_standard_entry_lines where standard_id = :'std') = 31
  and (select string_agg(key, ',' order by sort_order) from public.cb_standard_entry_lines where standard_id = :'std' and sort_order in (1, 2, 29, 31)) = 'advertising,meals,cra,not_sure');
select test.check('B7: no home office lines', not exists (select 1 from public.cb_standard_entry_lines where standard_id = :'std' and name ilike '%home%'));
select test.check('B7: vehicle lease and loan interest go to 70600 and the reviewer',
  (select bool_and(account = '70600' and to_reviewer) from public.cb_standard_entry_lines where standard_id = :'std' and key in ('vehicle_lease', 'vehicle_loan_interest')));
select test.check('B7: vehicle and equipment purchases are capital, for the reviewer',
  (select string_agg(account || ':' || capital || ':' || to_reviewer, ',' order by sort_order) from public.cb_standard_entry_lines where standard_id = :'std' and key in ('vehicle_purchase', 'equipment')) = '15300:true:true,15200:true:true');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('B7: staff cannot change the lines', test.try(format($q$select public.cb_save_standard_entry_line(%L, 'meals', '60200', 'taxable', false)$q$, :'std')) = 'Only owners change standard entries.');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('B7: CRA payments only to 21400, 21500 or 21300', test.try(format($q$select public.cb_save_standard_entry_line(%L, 'cra', '60000', 'none', false)$q$, :'std')) = 'Choose one of 21400, 21500, 21300.');
select test.check('B7: the entry itself cannot be deleted', test.try(format($q$select public.cb_delete_standard_entry(%L)$q$, :'std')) like 'The "Expenses paid personally" entry is set by its lines%');
select public.cb_save_standard_entry_line(:'std', 'advertising', '60000', 'taxable', true);
select test.check('B7: an owner changes a line''s default', (select to_reviewer from public.cb_standard_entry_lines where standard_id = :'std' and key = 'advertising'));
select public.cb_save_standard_entry_line(:'std', 'advertising', '60000', 'taxable', false);
reset role;
reset request.jwt.claims;

-- B9 to B13: the entry. Meals 100.00 + 13.00 HST; fuel 1,000.00 + 130.00 at 75% business.
\set lines '[{"chart":"60200","amount":106.50,"memo":"Meals and entertainment","tax_code":"MEALS_HST_50"},{"chart":"70600","amount":750,"memo":"Vehicle - fuel"},{"chart":"21500","amount":104.00,"memo":"ITCs","is_tax":true},{"chart":"23000","amount":-960.50,"memo":"Paid personally"}]'
\set check '{"summary_total":1243,"km_total":20000,"km_business":15000,"lines":[{"key":"meals","total":113},{"key":"vehicle_fuel","total":1130}]}'
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('B8: the client''s sheet is attached', test.try(format($q$select public.cb_add_personal_expenses(%L, %L, %L, '{}', false)$q$, :'f', :'lines', :'check')) = 'Attach the client''s sheet as the source.');
select test.check('B10: the typed lines must add up to the Summary total',
  test.try(format($q$select public.cb_add_personal_expenses(%L, %L, %L, '{sheet.xlsx}', false)$q$, :'f', :'lines', jsonb_set(:'check'::jsonb, '{summary_total}', '1250'))) = 'The lines add up to 1,243.00, not the Summary total of 1,250.00. Check the amounts typed.');
select test.check('B12: a vehicle amount needs the km', test.try(format($q$select public.cb_add_personal_expenses(%L, %L, %L, '{sheet.xlsx}', false)$q$, :'f', :'lines', :'check'::jsonb - 'km_total')) = 'Vehicle lines need the total km and the business km for the year.');
select test.check('B12: CRA payments never go to an expense',
  test.try(format($q$select public.cb_add_personal_expenses(%L, %L, '{"summary_total":10,"lines":[{"key":"cra","total":10,"account":"60000"}]}', '{sheet.xlsx}', false)$q$, :'f', :'lines')) = 'Payments to CRA for the company: choose one of 21400, 21500, 21300.');
select test.check('B12: "Not sure" says what it is',
  test.try(format($q$select public.cb_add_personal_expenses(%L, %L, '{"summary_total":10,"lines":[{"key":"not_sure","total":10,"account":"65000"}]}', '{sheet.xlsx}', false)$q$, :'f', :'lines')) = 'Not sure: add a note saying what it is.');
select test.check('B13: a line over $5,000 needs its receipts',
  test.try(format($q$select public.cb_add_personal_expenses(%L, %L, '{"summary_total":6000,"lines":[{"key":"rent","total":6000}]}', '{sheet.xlsx}', false)$q$, :'f', :'lines')) = 'Rent for business space is over $5,000: attach the receipts.');
select public.cb_add_personal_expenses(:'f', :'lines', :'check', '{files/sheet.xlsx}', false) as ent \gset
reset role;
reset request.jwt.claims;
select test.check('B9: one AJE at the year end, with the W/P ref and memo',
  (select kind || '|' || entry_date || '|' || wp_ref || '|' || note || '|' || origin from public.cb_entries where id = :'ent')
  = 'AJE|2026-12-31|Expenses paid personally summary|Business costs the shareholder paid personally during the year.|expenses_personal');
select test.check('B9: the shareholder credit is the sum of the debits',
  (select sum(amount) filter (where amount > 0) = -sum(amount) filter (where amount < 0) and -sum(amount) filter (where amount < 0) = 960.50 from public.cb_entry_lines where entry_id = :'ent'));
select test.check('B9: on an own-books file the lines go to the client''s accounts',
  (select string_agg(a.number || ':' || l.amount, ',' order by l.amount desc) from public.cb_entry_lines l join public.cb_accounts a on a.id = l.account_id where l.entry_id = :'ent' and not l.is_tax)
  = '70600:750.00,60200:106.50,23000:-960.50');
select test.check('B8: the sheet is attached as the source', (select attachments from public.cb_entries where id = :'ent') = '{files/sheet.xlsx}');
select test.check('B14: under the threshold with no reviewer line, no review', not (select needs_review from public.cb_entries where id = :'ent'));
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_add_personal_expenses(:'f', '[{"chart":"70600","amount":300,"memo":"Lease"},{"chart":"23000","amount":-300,"memo":"Paid personally"}]',
  '{"summary_total":400,"km_total":100,"km_business":75,"lines":[{"key":"vehicle_lease","total":400}]}', '{files/sheet.xlsx}', false) as ent2 \gset
reset role;
reset request.jwt.claims;
select test.check('B7: a lease goes to the reviewer at any amount', (select needs_review from public.cb_entries where id = :'ent2'));
