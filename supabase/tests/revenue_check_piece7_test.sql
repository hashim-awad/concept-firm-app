-- Local tests: piece 7 (Hashim, Nov 18, 2026, version 2): the revenue check is a schedule the preparer adds in step 5;
-- the comparison with the GST/HST returns is step 8's. Dummy data only.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'), ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test', (select id from public.roles where name = 'Accountant'));
reset role;
update public.role_permissions set level = 'edit' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Accountant');
insert into public.clients (kind, legal_name, province) values ('corporation', 'Birch Dummy Revenue Inc.', 'ON') returning id as client \gset
insert into public.clients (kind, legal_name, province) values ('corporation', 'Cedar Dummy Legacy Inc.', 'ON') returning id as client2 \gset
insert into public.clients (kind, legal_name, province) values ('corporation', 'Aspen Dummy Small Inc.', 'ON') returning id as client3 \gset

set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
\set setup_reg '{"realtor":false,"owner_paid":false,"dividends":false,"payroll":false,"holdco":false,"gst_registered":true,"gst_frequency":"annual","quick_method":false}'
\set setup_not '{"realtor":false,"owner_paid":false,"dividends":false,"payroll":false,"holdco":false,"gst_registered":false}'
\set tb '[{"number":"10100","name":"Chequing","amount":112000},{"number":"41000","name":"Sales","amount":-120000},{"number":"64250","name":"Accounting fees","amount":8000}]'
select public.cb_create_file(:'client', '2026-12-31', '2026-01-01', '', 'full', 'client_software', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a') as f \gset
select public.cb_create_file(:'client2', '2026-12-31', '2026-01-01', '', 'full', 'client_software', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a') as g \gset
select public.cb_create_file(:'client3', '2026-12-31', '2026-01-01', '', 'full', 'client_software', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a') as n \gset
select public.cb_save_setup(:'f', :'setup_reg'), public.cb_save_setup(:'g', :'setup_reg'), public.cb_save_setup(:'n', :'setup_not');
select public.cb_import_tb(x, 'this_year', 'client_software', 'tb.csv', :'tb') from unnest(array[:'f', :'g', :'n']::uuid[]) x;
select public.cb_map_account(id, case number when '10100' then '1002.00' when '41000' then '8000.00' else '8862.00' end) from public.cb_accounts where file_id in (:'f', :'g', :'n');
reset role; reset request.jwt.claims;

\set signed 'insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at) select :''f'', s, ''00000000-0000-0000-0000-00000000000c'', now() from unnest(array[''entries'', ''t2'']) s on conflict (file_id, step) do update set prepared_at = excluded.prepared_at, prepared_by = excluded.prepared_by'
\set state 'select coalesce(string_agg(step, \',\' order by step), \'none\') from public.cb_step_signoffs where file_id = :''f'' and step in (''entries'', ''t2'') and prepared_at is not null'
\set rev5 'select coalesce(nullif(array_to_string(array(select p from unnest(private.cb_step5_problems(:''f'')) p where p like ''Revenue check%''), '' | ''), ''''), ''none'')'
\set gst8 'select coalesce(nullif(array_to_string(array(select p from unnest(private.cb_step8_problems(:''f'')) p where p like ''GST/HST revenue%''), '' | ''), ''''), ''none'')'

-- T1: a new full file: no revenue check, step 5 does not ask for one.
select test.check('T1: a new file has no revenue check', not (private.cb_revenue_added(:'f')));
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('T1: cb_revenue_status says not added', (public.cb_revenue_status(:'f') ->> 'added')::boolean = false);
reset role; reset request.jwt.claims;
select test.check('T1: step 5 has no revenue check item', (:rev5) = 'none');
select test.check('T1: nothing of it waits for the reviewer in step 5', private.cb_step5_waiting(:'f') = '{}');

-- T6: step 8 asks a registrant for the GST/HST revenue; a non-registrant is not asked.
select test.check('T6: step 8 asks a registrant for the returns', (:gst8) = 'GST/HST revenue: enter the revenue on the year''s GST/HST returns and attach them.');
select test.check('T6: a non-registrant is not asked', private.cb_gst_revenue_problems(:'n') = '{}');

-- T4/T5: the returns' revenue entered on step 8: 120,000.00 in the books against 118,500.00, a difference of 1,500.00.
:signed;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_add_revenue_source(:'f', 'gst_returns', '', 'Annual return', 118500, 'files/gst.pdf') as gsrc \gset
reset role; reset request.jwt.claims;
select test.check('T4: books 120,000.00, returns 118,500.00, difference 1,500.00',
  (private.cb_revenue_state(:'f') ->> 'tb')::numeric = 120000 and (private.cb_revenue_state(:'f') ->> 'gst')::numeric = 118500 and (private.cb_revenue_state(:'f') ->> 'gst_diff')::numeric = 1500);
select test.check('T5: the returns figure clears step 8, not step 5', (:state) = 'entries');
select test.check('T5: History says why step 8 was cleared', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'signoff_cleared' and step = 't2' and detail like 'The revenue on the GST/HST returns changed%'));
select test.check('GST/HST data alone does not add the revenue check', not private.cb_revenue_added(:'f') and (:rev5) = 'none');
select test.check('T6: step 8 asks for the difference to be explained', (:gst8) = 'GST/HST revenue: explain the difference between the books and the returns.');

:signed;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_save_gst_revenue_note(:'f', 'Deposit received in December, reported on the next return.');
reset role; reset request.jwt.claims;
select test.check('T5: the note clears step 8, not step 5', (:state) = 'entries');
select test.check('T6: 1,500.00 explained, under the review threshold (5,000.00): step 8 has no GST/HST revenue item', (:gst8) = 'none');
-- An amended return (dummy): 112,000.00, a difference of 8,000.00, over the threshold.
:signed;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_remove_revenue_source(:'gsrc');
select public.cb_add_revenue_source(:'f', 'gst_returns', '', 'Annual return, amended', 112000, 'files/gst.pdf');
reset role; reset request.jwt.claims;
select test.check('T5: replacing the returns figure clears step 8, not step 5', (:state) = 'entries');
select test.check('T6: the note was written for 1,500.00: explain again', (:gst8) = 'GST/HST revenue: explain the difference between the books and the returns.');
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_save_gst_revenue_note(:'f', 'Amended return: a sale moved to next year.');
reset role; reset request.jwt.claims;
select test.check('T6: over the review threshold, the reviewer accepts it', (:gst8) = 'GST/HST revenue: the difference of 8,000.00 is over the review threshold: the reviewer accepts it.');
select test.check('step 7: the difference still waits for the reviewer', private.cb_review_problems(:'f') @> array['Items still wait for the reviewer: see the list above.']);
select test.check('step 5 does not wait on it', private.cb_step5_waiting(:'f') = '{}');
:signed;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_accept_revenue_difference(:'f', 'gst');
reset role; reset request.jwt.claims;
select test.check('T6: accepted: step 8 has no GST/HST revenue item left', (:gst8) = 'none');
select test.check('step 7: nothing of it waits any more', not (private.cb_review_problems(:'f') @> array['Items still wait for the reviewer: see the list above.']));
select test.check('History logs the acceptance under step 8', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'revenue_accepted' and step = 't2'));
select test.check('T5: the acceptance did not clear step 5', (:state) like 'entries%');

-- T2: "+ Add revenue check": step 5 now needs it done.
:signed;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_add_revenue_check(:'f');
select test.check('T2: added', (public.cb_revenue_status(:'f') ->> 'added')::boolean);
select public.cb_add_revenue_check(:'f');
reset role; reset request.jwt.claims;
select test.check('T2: adding it clears step 5 (and step 8 through the existing chain)', (:state) = 'none');
select test.check('T2: History records it once', (select count(*) from public.cb_file_history where file_id = :'f' and action = 'revenue_added') = 1);
select test.check('T2: step 5 now needs a source', (:rev5) like 'Revenue check: %');
select test.check('T2: step 5 no longer carries the GST/HST comparison', (:rev5) not like '%GST/HST%');
:signed;
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_add_revenue_source(:'f', 'sales_report', '', 'Sales report', 110000, 'files/sales.pdf');
reset role; reset request.jwt.claims;
select test.check('T2: a source clears step 5 as today (step 8 through the chain)', (:state) = 'none');
select test.check('T2: a difference of 10,000.00: explain it, or fix it with an entry, as today', (:rev5) = 'Revenue check: explain the difference, or fix it with an entry.');
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_save_revenue_check(:'f', 'Cash sales not in the report.', 'Amended return: a sale moved to next year.', '', false);
reset role; reset request.jwt.claims;
select test.check('T2: over the threshold it waits for the reviewer in step 5', array_length(private.cb_step5_waiting(:'f'), 1) = 1);
select test.check('T2: the GST/HST note kept by step 5''s save', (private.cb_revenue_state(:'f') ->> 'gst_explanation') = 'Amended return: a sale moved to next year.');

-- T3: a file with revenue check data saved before piece 7 (dummy fixture: written as the old screens did) counts as added.
insert into public.cb_revenue_sources (file_id, kind, payer, label, amount, attachment) values (:'g', 'sales_report', '', 'Sales report', 120000, 'files/sales.pdf');
select test.check('T3: a saved source counts as added', private.cb_revenue_added(:'g'));
select test.check('T3: same figures as before', (private.cb_revenue_state(:'g') ->> 'sources')::numeric = 120000 and (private.cb_revenue_state(:'g') ->> 'diff')::numeric = 0);
select test.check('T3: nothing was written to the file', not exists (select 1 from public.cb_revenue_checks where file_id = :'g'));

-- Monthly files and locked files: no revenue check.
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_create_file(:'client3', '2025-12-31', '2025-01-01', '', 'monthly', 'concept_qbo', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a') as mo \gset
select test.check('a monthly file has no revenue check', test.try(format('select public.cb_add_revenue_check(%L)', :'mo')) = 'Monthly files have no revenue check.');
reset role; reset request.jwt.claims;
