-- Local tests: round 38 (Hashim, Nov 18, 2026): Reclassify transactions. Posted bank lines and entry lines move to
-- another account in one step; History logs the batch and each line; sign-offs fall as if each line changed in its
-- own step; Undo puts every line back. Transfers, splits, sales tax lines and bank accounts are refused. Dummy data only.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'), ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test', (select id from public.roles where name = 'Accountant'));
reset role;
update public.role_permissions set level = 'edit' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Accountant');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
\set A '''00000000-0000-0000-0000-00000000000a'''
\set C '''00000000-0000-0000-0000-00000000000c'''
insert into public.clients (kind, legal_name, province) values ('corporation', 'Maple Dummy Reclass Inc.', 'ON') returning id as client \gset
select public.cb_create_file(:'client', '2026-08-31', '2025-09-01', '', 'full', 'statements', :C::uuid, :A::uuid) as f \gset
select public.cb_save_setup(:'f', '{"gst_registered": true, "gst_frequency": "quarterly", "quick_method": false}');
select public.cb_save_bank_account(:'f', null, 'chequing', 'Dummy Chq', '7509', 1000.00, false, false) as chq \gset
select public.cb_save_bank_account(:'f', null, 'savings', 'Dummy Sav', '2468', 0.00, false, false) as sav \gset
reset role;
select private.cb_add_statement(:'f', :'chq', 'chq.pdf', 1000.00, 1355.00, '[
  {"line": 1, "date": "2025-10-02", "description": "CLIENT DEPOSIT DUMMY 1", "amount": 226.00},
  {"line": 2, "date": "2025-11-03", "description": "CLIENT DEPOSIT DUMMY 2", "amount": 113.00},
  {"line": 3, "date": "2025-12-04", "description": "CLIENT DEPOSIT DUMMY 3", "amount": 56.00},
  {"line": 4, "date": "2026-01-05", "description": "SPLIT DUMMY", "amount": -20.00},
  {"line": 5, "date": "2026-02-02", "description": "TRANSFER OUT DUMMY", "amount": -20.00}]', '2025-09-01', '2026-08-31', 1000.00, 1355.00, null);
select private.cb_add_statement(:'f', :'sav', 'sav.pdf', 0.00, 20.00, '[{"line": 1, "date": "2026-02-02", "description": "TRANSFER IN DUMMY", "amount": 20.00}]', '2025-09-01', '2026-08-31', 0.00, 20.00, null);
create function test.l(p text) returns uuid language sql security definer set search_path = '' as $$ select id from public.cb_bank_lines where description = p $$;
grant execute on function test.l(text) to authenticated;
set role authenticated;
select public.cb_post_lines(:'f', jsonb_build_array(
  jsonb_build_object('id', test.l('CLIENT DEPOSIT DUMMY 1'), 'kind', 'code', 'account', '40100', 'tax', 'HST_ON'),
  jsonb_build_object('id', test.l('CLIENT DEPOSIT DUMMY 2'), 'kind', 'code', 'account', '40100', 'tax', 'HST_ON'),
  jsonb_build_object('id', test.l('CLIENT DEPOSIT DUMMY 3'), 'kind', 'code', 'account', '40100', 'tax', 'EXEMPT'),
  jsonb_build_object('id', test.l('TRANSFER OUT DUMMY'), 'kind', 'pair', 'other', test.l('TRANSFER IN DUMMY'))));
select public.cb_save_splits(test.l('SPLIT DUMMY'), '[{"account": "60000", "tax": "EXEMPT", "amount": 10.00}, {"account": "64000", "tax": "EXEMPT", "amount": 10.00}]');
select public.cb_post_lines(:'f', jsonb_build_array(jsonb_build_object('id', test.l('SPLIT DUMMY'), 'kind', 'split')));
select test.check('setup: three deposits in 40100, posted', (select count(*) = 3 from public.cb_bank_lines where file_id = :'f' and chart_account = '40100' and status = 'done'));
-- An AJE: 64000 / 10900.
select public.cb_add_entry(:'f', 'AJE', 'correction', 'Dummy reclass test', false, '[{"chart":"64000","amount":50},{"chart":"10900","amount":-50}]', 'Test') as e1 \gset
reset role;
select id as el64 from public.cb_entry_lines where entry_id = :'e1' and amount = 50 \gset
-- Steps 4 and 5 signed.
insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at) values (:'f', 'code', :C::uuid, now()), (:'f', 'entries', :C::uuid, now());
set role authenticated;

-- ---------- Refusals
select test.check('a bank account is not a target', test.try(format($q$select public.cb_reclassify(%L, %L, '10000', null)$q$, :'f', jsonb_build_array(jsonb_build_object('kind', 'bank', 'id', test.l('CLIENT DEPOSIT DUMMY 1'))))) like 'Bank, card and loan accounts%');
select test.check('a transfer is refused', test.try(format($q$select public.cb_reclassify(%L, %L, '40000', null)$q$, :'f', jsonb_build_array(jsonb_build_object('kind', 'bank', 'id', test.l('TRANSFER OUT DUMMY'))))) like '%is a transfer: change it in step 4%');
select test.check('a split line is refused', test.try(format($q$select public.cb_reclassify(%L, %L, '40000', null)$q$, :'f', jsonb_build_array(jsonb_build_object('kind', 'bank', 'id', test.l('SPLIT DUMMY'))))) like '%is split%');
select test.check('nothing chosen is refused', test.try(format($q$select public.cb_reclassify(%L, %L, null, null)$q$, :'f', jsonb_build_array(jsonb_build_object('kind', 'bank', 'id', test.l('CLIENT DEPOSIT DUMMY 1'))))) like 'Choose an account, a sales tax code, or both.');
reset role;
select test.check('the refusals changed nothing: steps 4 and 5 still signed', (select count(*) = 2 from public.cb_step_signoffs where file_id = :'f' and step in ('code', 'entries')));
set role authenticated;

-- ---------- Three bank lines from 40100 to 40000: one batch.
select public.cb_reclassify(:'f', (select jsonb_agg(jsonb_build_object('kind', 'bank', 'id', id)) from public.cb_bank_lines where file_id = :'f' and chart_account = '40100'), '40000', null, 350.00) as b1 \gset
reset role;
select test.check('moved: 40000, same tax, same dates and amounts, still posted', (select bool_and(chart_account = '40000' and status = 'done') from public.cb_bank_lines where description like 'CLIENT DEPOSIT DUMMY%')
  and (select string_agg(coalesce(tax_code, '-'), ',' order by description) = 'HST_ON,HST_ON,EXEMPT' from public.cb_bank_lines where description like 'CLIENT DEPOSIT DUMMY%')
  and (select sum(amount) = 395.00 from public.cb_bank_lines where description like 'CLIENT DEPOSIT DUMMY%'));
select test.check('History: the batch (3 lines, 350.00, from 40100 to 40000) and each line', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'reclassified'
  and detail = 'Reclassified 3 lines' and ref_label = '3 lines, 350.00' and old_value = '40100' and new_value like '40000 %' and actor_id = :C::uuid)
  and (select count(*) = 3 from public.cb_file_history where file_id = :'f' and action = 'line_recoded' and old_value like '40100%' and new_value like '40000%'));
select test.check('steps 4 and 5 keep their sign-offs (CB2-0 step 2); no History row says a sign-off was cleared', exists (select 1 from public.cb_step_signoffs where file_id = :'f' and step = 'code' and prepared_by = :C::uuid)
  and exists (select 1 from public.cb_step_signoffs where file_id = :'f' and step = 'entries')
  and not exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'signoff_cleared'));
set role authenticated;
select public.cb_reclassify_undo(:'b1');
reset role;
select test.check('Undo: all three back in 40100, with the same tax', (select count(*) = 3 from public.cb_bank_lines where description like 'CLIENT DEPOSIT DUMMY%' and chart_account = '40100')
  and (select string_agg(coalesce(tax_code, '-'), ',' order by description) = 'HST_ON,HST_ON,EXEMPT' from public.cb_bank_lines where description like 'CLIENT DEPOSIT DUMMY%'));
select test.check('History logs the undo', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'reclass_undone' and detail = 'Reclassify undone: 3 lines back'));
set role authenticated;
select test.check('a second undo is refused', test.try(format('select public.cb_reclassify_undo(%L)', :'b1')) = 'This was already undone.');
-- Tax only.
select public.cb_reclassify(:'f', jsonb_build_array(jsonb_build_object('kind', 'bank', 'id', test.l('CLIENT DEPOSIT DUMMY 3'))), null, 'HST_ON', 56.00);
reset role;
select test.check('tax only: account kept, tax changed', (select chart_account = '40100' and tax_code = 'HST_ON' from public.cb_bank_lines where id = test.l('CLIENT DEPOSIT DUMMY 3')));

-- ---------- An AJE line from 64000 to 63000: step 5's sign-off stays (CB2-0 step 2); History has the change.
set role authenticated;
select public.cb_reclassify(:'f', jsonb_build_array(jsonb_build_object('kind', 'entry', 'id', :'el64')), '63000', null, 50.00);
reset role;
select test.check('the entry line moved to 63000; the other line and the amount did not change', (select a.number = '63000' and l.amount = 50 from public.cb_entry_lines l join public.cb_accounts a on a.id = l.account_id where l.id = :'el64')
  and (select count(*) = 2 from public.cb_entry_lines where entry_id = :'e1'));
select test.check('step 5''s sign-off kept; History logs the entry line', exists (select 1 from public.cb_step_signoffs where file_id = :'f' and step = 'entries' and prepared_by = :C::uuid)
  and not exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'signoff_cleared')
  and exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'entry_line_reclassified' and old_value like '64000%' and new_value like '63000%'));
