-- Local tests: round 21 (agent P). "Clear this step" per step, its refusals (signed step, locked file,
-- no Edit), and the repair of acceptance questions 6 and 8 confirmed by a key press. Dummy data only.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test'),
  ('00000000-0000-0000-0000-00000000000d', 'viewer.d@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test', (select id from public.roles where name = 'Staff'));
reset role;
-- A role that only views Closebook, for the refusal without Edit.
insert into public.roles (name) values ('Viewer R21') returning id as viewer_role \gset
insert into public.role_permissions (role_id, area_key, level) select :'viewer_role', area_key, 'view' from public.role_permissions where role_id = (select id from public.roles where name = 'Staff') and area_key = 'closebook';
set role authenticated;
select public.add_staff('00000000-0000-0000-0000-00000000000d', 'Test Viewer D', 'viewer.d@example.test', :'viewer_role');
reset role;
reset request.jwt.claims;
update public.role_permissions set level = 'edit' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Staff');
update public.role_permissions set level = 'view' where area_key = 'closebook' and role_id = :'viewer_role';
\set A '''00000000-0000-0000-0000-00000000000a'''
\set C '''00000000-0000-0000-0000-00000000000c'''
insert into public.clients (kind, legal_name, province) values ('corporation', 'Spruce Dummy Realty Inc.', 'ON') returning id as client \gset
insert into public.clients (kind, legal_name, province) values ('corporation', 'Larch Dummy Realty Inc.', 'ON') returning id as client2 \gset
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_create_file(:'client', '2026-12-31', '2026-01-01', '', 'full', 'statements', :C::uuid, :A::uuid) as f \gset
select public.cb_create_file(:'client2', '2026-12-31', '2026-01-01', '', 'full', 'client_software', :C::uuid, :A::uuid) as tb \gset
reset role;

-- ---------- 1. Refusals ----------
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000d"}';
select test.check('no Edit: refused', test.try(format($q$select public.cb_clear_typed_step(%L, 'setup')$q$, :'f')) = 'You need Edit on Closebook.');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('records: nothing typed, refused', test.try(format($q$select public.cb_clear_typed_step(%L, 'records')$q$, :'f')) like 'Nothing is typed on step 3%');
select test.check('review: nothing typed, refused', test.try(format($q$select public.cb_clear_typed_step(%L, 'review')$q$, :'f')) like 'Nothing is typed on step 7%');
select test.check('an unknown step is refused', test.try(format($q$select public.cb_clear_typed_step(%L, 'other')$q$, :'f')) = 'Unknown step.');

-- ---------- 2. Step 1: setup answers and the acceptance record ----------
select public.cb_save_setup(:'f', '{"realtor": true, "payroll": false, "gst_registered": true}'::jsonb);
select public.cb_save_acceptance(:'f', '{"q1":"yes","q2":"yes","q3":"yes","q4":"yes","q5":"yes","q9":"yes"}'::jsonb);
reset role;
-- A signed step is refused until the sign-off is taken back.
insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at) values (:'f', 'setup', :C, now());
set role authenticated;
select test.check('a signed step is refused', test.try(format($q$select public.cb_clear_typed_step(%L, 'setup')$q$, :'f')) = 'Step 1 is signed. Take back the sign-off first.');
reset role;
select test.check('the refused clear changed nothing', (select setup ? 'realtor' from public.cb_files where id = :'f') and exists (select 1 from public.cb_acceptance where file_id = :'f'));
delete from public.cb_step_signoffs where file_id = :'f' and step = 'setup';
-- A locked file: never.
update public.cb_files set phase = 'locked' where id = :'f';
set role authenticated;
select test.check('a locked file is refused', test.try(format($q$select public.cb_clear_typed_step(%L, 'setup')$q$, :'f')) = 'This file is locked. Nothing was cleared.');
reset role;
set session_replication_role = replica;
update public.cb_files set phase = 'planning' where id = :'f';
set session_replication_role = origin;
set role authenticated;
select public.cb_clear_typed_step(:'f', 'setup');
reset role;
select test.check('step 1: the setup answers are empty', (select setup = '{}'::jsonb from public.cb_files where id = :'f'));
select test.check('step 1: the acceptance record is gone', not exists (select 1 from public.cb_acceptance where file_id = :'f'));
select test.check('step 1: the file history says so', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'step_cleared' and step = 'setup' and detail = 'Everything typed in step 1 cleared'));

-- ---------- 3. Step 2: last year's balance sheet ----------
insert into public.cb_opening_balances (file_id, code, amount) values (:'f', '1001', 500), (:'f', '3600', 500);
insert into public.cb_opening_s125 (file_id, code, amount) values (:'f', '8000', 1200);
update public.cb_files set opening_source = 'manual', opening_re_stated = 500, opening_ni_typed = 100, opening_note = 'From the prior T2', opening_set_by = :C, opening_set_at = now() where id = :'f';
set role authenticated;
select public.cb_clear_typed_step(:'f', 'opening');
reset role;
select test.check('step 2: balance sheet and Schedule 125 lines gone', not exists (select 1 from public.cb_opening_balances where file_id = :'f') and not exists (select 1 from public.cb_opening_s125 where file_id = :'f'));
select test.check('step 2: 3849, 9999, source and note blank', (select opening_source is null and opening_re_stated is null and opening_ni_typed is null and opening_note = '' and not first_year from public.cb_files where id = :'f'));

-- ---------- 4. Step 4 on a trial balance file: the preparer's matches only ----------
insert into public.cb_accounts (file_id, account_key, number, name, this_year, line_no, mapping_source, mapped_by, mapped_at)
values (:'tb', 'tb:1', '1000', 'Chequing', 100, (select line_no from public.cb_master_lines where line_no like '1001%' limit 1), 'preparer', :C, now()),
       (:'tb', 'tb:2', '4000', 'Commissions', -100, (select line_no from public.cb_master_lines where line_no like '8000%' limit 1), 'history', null, null);
set role authenticated;
select public.cb_clear_typed_step(:'tb', 'code');
reset role;
select test.check('step 4: the preparer''s match is cleared', (select line_no is null and mapping_source is null and mapped_by is null from public.cb_accounts where file_id = :'tb' and account_key = 'tb:1'));
select test.check('step 4: a match from the client''s history stays', (select line_no is not null and mapping_source = 'history' from public.cb_accounts where file_id = :'tb' and account_key = 'tb:2'));

-- ---------- 4b. Step 4 on a bank file: every line's coding ----------
set role authenticated;
select public.cb_save_setup(:'f', '{"gst_registered": true, "quick_method": false}'::jsonb);
select (public.cb_upload_bank(:'f', null, 'Visa 1234', 'card', 'v.csv', 1000, 352.73,
  '[{"line":2,"date":"2026-01-02","description":"SAMPLE PIZZA","amount":294.83},{"line":3,"date":"2026-01-05","description":"PAYMENT FROM","amount":-1000},{"line":4,"date":"2026-01-09","description":"SAMPLE PRINT SHOP","amount":57.9}]',
  '2026-01-01', '2026-01-31')) ->> 'statement' as s1 \gset
select public.cb_code_lines(:'f', format('[{"id":"%s","account":"60200","tax":"HST_ON"}]', (select id from public.cb_bank_lines where file_id = :'f' and description = 'SAMPLE PIZZA'))::jsonb);
select test.check('a line is coded', (select count(*) = 1 from public.cb_bank_lines where file_id = :'f' and status <> 'new'));
select public.cb_clear_typed_step(:'f', 'code');
reset role;
select test.check('step 4: every line is back to "to code"; the statement stays', (select count(*) = 3 from public.cb_bank_lines where file_id = :'f' and status = 'new' and chart_account is null and tax_code is null)
  and exists (select 1 from public.cb_bank_statements where id = :'s1'));

-- ---------- 5. Step 5: the revenue check ----------
insert into public.cb_revenue_checks (file_id, explanation) values (:'f', 'Commission received after year end');
set role authenticated;
select public.cb_clear_typed_step(:'f', 'entries');
reset role;
select test.check('step 5: the revenue check explanation is gone', not exists (select 1 from public.cb_revenue_checks where file_id = :'f'));

-- ---------- 6. Step 6: the reviewer's decisions ----------
update public.cb_accounts set type_confirm_reason = 'Kept: a dummy reason', type_confirmed_by = :A, type_confirmed_at = now() where file_id = :'tb' and account_key = 'tb:2';
set role authenticated;
select public.cb_clear_typed_step(:'tb', 'mapping');
reset role;
select test.check('step 6: the type decision is cleared', (select type_confirm_reason is null and type_confirmed_by is null from public.cb_accounts where file_id = :'tb' and account_key = 'tb:2'));

-- ---------- 7. Step 8: the T2 tie-out figures ----------
insert into public.cb_t2_tieouts (file_id, net_income, total_assets, entered_by) values (:'f', 1000, 5000, :C);
set role authenticated;
select public.cb_clear_typed_step(:'f', 't2');
reset role;
select test.check('step 8: the tie-out figures are gone', not exists (select 1 from public.cb_t2_tieouts where file_id = :'f'));

-- ---------- 8. Step 10: the completion checklist ----------
insert into public.cb_checklist_answers (file_id, question, answer, answered_by) select :'f', key, 'yes', :C from public.cb_checklist_questions limit 2;
set role authenticated;
select public.cb_clear_typed_step(:'f', 'lock');
reset role;
select test.check('step 10: the checklist answers are gone', not exists (select 1 from public.cb_checklist_answers where file_id = :'f'));
-- A step that was not signed clears the review sign-off resting on it.
insert into public.cb_step_signoffs (file_id, step, reviewed_by, reviewed_at) values (:'f', 'review', :A, now());
set role authenticated;
select public.cb_clear_typed_step(:'f', 't2');
reset role;
select test.check('clearing a step clears the review sign-off', not exists (select 1 from public.cb_step_signoffs where file_id = :'f' and step = 'review'));

-- ---------- 9. Repair: questions 6 and 8 confirmed by a key press ----------
-- Hit: no earlier file, step 1 not signed, confirmed before the fix.
insert into public.cb_acceptance (file_id, q1, users, q8, confirmed, answered, updated_by)
values (:'f', 'yes', '[{"kind":"lender","name":"Dummy Credit Union","basis_needed":"","agreed":"yes"}]', 'confirmed',
        '{"basis":"standard","custom_basis_wording":"","users":[],"by":"00000000-0000-0000-0000-00000000000c","at":"2026-11-15T01:40:00+00:00"}',
        '{"q1":{"by":"00000000-0000-0000-0000-00000000000c","at":"2026-11-15T01:40:00+00:00","same":false},"q6":{"by":"00000000-0000-0000-0000-00000000000c","at":"2026-11-15T01:40:00+00:00","same":false},"q8":{"by":"00000000-0000-0000-0000-00000000000c","at":"2026-11-15T01:40:00+00:00","same":false}}', :C);
-- Not hit: a file with an earlier file (the client's 2025 file).
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_create_file(:'client2', '2025-12-31', '2025-01-01', '', 'full', 'statements', :C::uuid, :A::uuid) as prior \gset
reset role;
insert into public.cb_acceptance (file_id, q8, confirmed, answered)
values (:'tb', 'confirmed', '{"basis":"standard","custom_basis_wording":"","users":[],"by":"00000000-0000-0000-0000-00000000000c","at":"2026-11-15T01:40:00+00:00"}', '{"q6":{"by":"x","at":"2026-11-15T01:40:00+00:00"}}');
-- Not hit: step 1 signed by the preparer (the 2025 file has no earlier file).
insert into public.cb_acceptance (file_id, q8, confirmed, answered)
values (:'prior', 'confirmed', '{"basis":"standard","custom_basis_wording":"","users":[],"by":"00000000-0000-0000-0000-00000000000c","at":"2026-11-15T01:40:00+00:00"}', '{"q6":{"by":"x","at":"2026-11-15T01:40:00+00:00"}}');
insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at) values (:'prior', 'setup', :C, now());
\i supabase/migrations/20261210000000_round21_save_state.sql
select test.check('repair: 6 and 8 back to not confirmed', (select confirmed is null and q8 is null and not answered ? 'q6' and not answered ? 'q8' from public.cb_acceptance where file_id = :'f'));
select test.check('repair: other answers and the users'' question 7 stay', (select q1 = 'yes' and answered ? 'q1' and users -> 0 ->> 'agreed' = 'yes' from public.cb_acceptance where file_id = :'f'));
select test.check('repair: logged in the file history', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'acceptance_reset'
  and detail = 'Questions 6 and 8 reset: confirmed by a key press, not by the preparer'));
select test.check('repair: a file with an earlier file is left alone', (select confirmed is not null from public.cb_acceptance where file_id = :'tb'));
select test.check('repair: a file whose step 1 is signed is left alone', (select confirmed is not null from public.cb_acceptance where file_id = :'prior'));
-- Confirmed again by the preparer, then the migration runs a second time: nothing changes.
update public.cb_acceptance set confirmed = '{"basis":"standard","custom_basis_wording":"","users":[],"by":"00000000-0000-0000-0000-00000000000c","at":"2026-11-15T20:00:00+00:00"}', q8 = 'confirmed' where file_id = :'f';
\i supabase/migrations/20261210000000_round21_save_state.sql
select test.check('run twice: a file reset once is not reset again', (select confirmed is not null from public.cb_acceptance where file_id = :'f')
  and (select count(*) = 1 from public.cb_file_history where file_id = :'f' and action = 'acceptance_reset'));
