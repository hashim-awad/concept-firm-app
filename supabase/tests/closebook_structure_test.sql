-- Local tests: Closebook structure (Phase 3 batch, build step 1, part 1).
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

-- The appendices are loaded in full.
select test.check('404 GIFI codes, one current version', (select count(*) from public.cb_gifi_codes) = 404 and (select count(*) from public.cb_gifi_versions where is_current) = 1);
select test.check('the required GIFI codes', (select string_agg(code, ',' order by code) from public.cb_gifi_codes where required) = '2599,3499,3620,3849,8299,9368,9999');
select test.check('419 master lines, 23 calculated totals, 15 sub-lines', (select count(*) from public.cb_master_lines) = 419
  and (select count(*) from public.cb_master_lines where not mappable) = 23 and (select count(*) from public.cb_master_lines where line_no not like '%.00') = 15);
select test.check('every GIFI code has its line', not exists (select 1 from public.cb_gifi_codes g where not exists (select 1 from public.cb_master_lines m where m.line_no = g.code || '.00')));
select test.check('11 tax codes and 20 lead sheets', (select count(*) from public.cb_tax_codes) = 11 and (select count(*) from public.cb_lead_sheets) = 20);
select test.check('paired lines: bank and overdraft', (select pair_line from public.cb_master_lines where line_no = '1002.00') = '2600.00');
select test.check('today''s package captions on the statement lines', (select statement_line from public.cb_master_lines where line_no = '1002.00') = 'Cash and cash equivalents'
  and (select statement_line from public.cb_master_lines where line_no = '9225.00') = 'Telecommunications'
  and (select statement_line from public.cb_master_lines where line_no = '8910.00') = 'Rent');
select test.check('defaults: 5,000 and 20%, amortization equal to CCA', (select flag_amount = 5000 and flag_percent = 20 and recon_outstanding_max = 5000 and note1_policy = 'amortization_equals_cca' from public.cb_settings));

-- Staff without Closebook see nothing and change nothing.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('staff without Closebook see no master lines', (select count(*) from public.cb_master_lines) = 0);
select test.check('staff cannot change a line', test.try($$select public.cb_update_master_line('8810.00', 'X', 'Office expenses', 'FULL', '30', '', 'because')$$) like '%Only an owner%');
select test.check('staff cannot change thresholds', test.try($$select public.cb_update_settings(1, 1, 1, 1, 1, 'amortization_equals_cca')$$) like '%Only an owner%');
reset role;
reset request.jwt.claims;
update public.role_permissions set level = 'view' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Staff');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('with Closebook view, staff read the lines', (select count(*) from public.cb_master_lines) = 419);
select test.check('but still cannot change them', test.try($$select public.cb_add_sub_line('8810.00', 'Software', null, null, '', 'needed')$$) like '%Only an owner%');
select test.check('and cannot write to the table directly', test.try($$update public.cb_master_lines set name = 'X' where line_no = '8810.00'$$) <> 'OK');
reset role;
reset request.jwt.claims;

-- Owners change lines only with a reason, and every change is logged.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('a reason is required', test.try($$select public.cb_update_master_line('8810.00', 'Office expenses', 'Office expenses', 'FULL', '30', '', '')$$) like '%reason%');
select public.cb_update_master_line('8810.00', (select name from public.cb_master_lines where line_no = '8810.00'), 'Office and general', 'FULL', '30', 'Firm wording', 'Clearer caption');
select test.check('the change is saved and logged with its reason', (select statement_line from public.cb_master_lines where line_no = '8810.00') = 'Office and general'
  and (select reason from public.cb_master_line_log where line_no = '8810.00') = 'Clearer caption'
  and (select changes -> 'statement_line' ->> 1 from public.cb_master_line_log where line_no = '8810.00') = 'Office and general');
select test.check('a total line keeps its calculation', test.try($$select public.cb_update_master_line('2599.00', 'Total assets', 'Assets', null, null, '', 'test')$$) like '%total line%');
select public.cb_add_sub_line('8523.00', 'Client gifts', null, 'NONDED', '', 'Common at real estate clients') as sub \gset
select test.check('a sub-line takes the next number and its parent''s structure', :'sub' = '8523.30'
  and (select gifi_code || '|' || lead_sheet || '|' || default_tax_code || '|' || mappable from public.cb_master_lines where line_no = '8523.30') = '8523|30|NONDED|true');
select test.check('the new line is logged', exists (select 1 from public.cb_master_line_log where line_no = '8523.30' and action = 'add'));
select test.check('sub-lines only under a line staff can map to', test.try($$select public.cb_add_sub_line('2599.00', 'Other assets', null, null, '', 'test')$$) like '%map to%');
select public.cb_update_settings(5000, 7500, 25, 5000, 5000, 'amortization_equals_cca');
select test.check('owners change the thresholds', (select flag_amount = 7500 and flag_percent = 25 from public.cb_settings));
select test.check('the activity log has the changes', exists (select 1 from public.activity_log where entity_type = 'cb_settings') and exists (select 1 from public.activity_log where entity_type = 'cb_master_lines'));
reset role;
reset request.jwt.claims;
