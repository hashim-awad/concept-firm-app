-- Local tests: Closebook bank and card upload (part 2b; Hashim, Nov 13, 2026).
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test', (select id from public.roles where name = 'Staff'));
insert into public.clients (kind, legal_name, province) values ('corporation', 'Maple Test Realty Inc.', 'ON') returning id as client \gset
\set A '''00000000-0000-0000-0000-00000000000a'''
\set C '''00000000-0000-0000-0000-00000000000c'''
select public.cb_create_file(:'client', '2026-12-31', '2026-01-01', '', 'full', 'statements', :A::uuid, :C::uuid) as f \gset
select public.cb_create_file(:'client', '2025-12-31', '2025-01-01', '', 'monthly', 'concept_qbo', :A::uuid, :C::uuid) as m \gset
\set rows '''[{"line":2,"date":"2026-01-02","description":"SAMPLE PIZZA","amount":294.83},{"line":3,"date":"2026-01-05","description":"PAYMENT FROM","amount":-1000},{"line":4,"date":"2026-01-09","description":"SAMPLE PRINT SHOP AMT 1 USD","amount":57.9}]'''

select test.check('monthly files have nothing to upload', test.try(format($f$select public.cb_upload_bank(%L, null, 'Visa', 'card', 'v.csv', 0, 0, %L, '2026-01-01', '2026-01-31')$f$, :'m', :rows)) like '%Monthly files%');
select test.check('opening + amounts must equal closing; the difference shows',
  test.try(format($f$select public.cb_upload_bank(%L, null, 'Visa 1234', 'card', 'v.csv', 1000, 352.74, %L, '2026-01-01', '2026-01-31')$f$, :'f', :rows)) like '%does not balance%1,000.00 + transactions -647.27 = 352.73%352.74%difference of 0.01%');
select test.check('a failed upload leaves no account behind', not exists (select 1 from public.cb_bank_accounts where file_id = :'f'));
select test.check('a new account needs a type', test.try(format($f$select public.cb_upload_bank(%L, null, 'Visa 1234', 'other', 'v.csv', 1000, 352.73, %L, '2026-01-01', '2026-01-31')$f$, :'f', :rows)) like '%account type%');
select test.check('transactions outside the period are refused', test.try(format($f$select public.cb_upload_bank(%L, null, 'Visa 1234', 'card', 'v.csv', 1000, 352.73, %L, '2026-01-03', '2026-01-31')$f$, :'f', :rows)) like '%outside the statement period%');
select (public.cb_upload_bank(:'f', null, 'Visa  1234', 'card', 'v.csv', 1000, 352.73, :rows, '2026-01-01', '2026-01-31')) ->> 'statement' as s1 \gset
select test.check('the statement, its account and lines are saved', (select name || '/' || kind from public.cb_bank_accounts where file_id = :'f') = 'Visa 1234/card'
  and (select lines || '/' || first_date || '/' || last_date || '/' || period_start || '/' || period_end || '/' || plus_total || '/' || minus_total from public.cb_bank_statements where id = :'s1') = '3/2026-01-02/2026-01-09/2026-01-01/2026-01-31/352.73/-1000.00'
  and (select count(*) from public.cb_bank_lines where statement_id = :'s1') = 3
  and (select row_no from public.cb_bank_lines where statement_id = :'s1' and amount = 57.9) = 4);
select id as acc from public.cb_bank_accounts where file_id = :'f' \gset
select test.check('the same name again is refused', test.try(format($f$select public.cb_upload_bank(%L, null, 'visa 1234', 'card', 'v.csv', 0, 0, '[{"date":"2026-03-01","description":"X","amount":1}]', '2026-03-01', '2026-03-31')$f$, :'f')) like '%already on this file%');
select test.check('overlapping dates for the account are refused', test.try(format($f$select public.cb_upload_bank(%L, %L, '', '', 'v2.csv', 352.73, 452.73, '[{"date":"2026-01-31","description":"X","amount":100}]', '2026-01-31', '2026-02-27')$f$, :'f', :'acc')) like '%overlap%2026-01-01 to 2026-01-31%');
select (public.cb_upload_bank(:'f', :'acc', '', '', 'v2.csv', 352.73, 452.73, '[{"date":"2026-02-01","description":"X","amount":100}]', '2026-02-01', '2026-02-28')) ->> 'outside_year' as outside \gset
select test.check('the next statement for the account', (select count(*) from public.cb_bank_statements where account_id = :'acc') = 2 and :'outside' = '0');

-- Staff without Closebook Edit cannot upload or remove; viewers read.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('staff without Closebook edit cannot upload', test.try(format($f$select public.cb_upload_bank(%L, null, 'TD', 'bank', 'b.csv', 0, 1, '[{"date":"2026-03-01","description":"X","amount":1}]', '2026-03-01', '2026-03-31')$f$, :'f')) like '%Edit on Closebook%');
select test.check('or remove', test.try(format($f$select public.cb_delete_bank_statement(%L)$f$, :'s1')) like '%Edit on Closebook%');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_delete_bank_statement(:'s1');
select test.check('removing a statement removes its lines; the account stays while it has one', (select count(*) from public.cb_bank_lines where file_id = :'f') = 1
  and exists (select 1 from public.cb_bank_accounts where id = :'acc'));
select public.cb_delete_bank_statement((select id from public.cb_bank_statements where account_id = :'acc'));
select test.check('the last statement takes the account with it', not exists (select 1 from public.cb_bank_accounts where file_id = :'f'));
reset role;
