-- Local tests: round 35 (Hashim, Nov 17, 2026): step 7's working list. Another account in place (the line stays
-- with the reviewer), Mark reviewed and Undo (the reviewer or an owner only; step 4's sign-off stays), a split in
-- place, and an account marked reviewed with a required note that stands while the balance stays the same.
-- Dummy data only.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test', (select id from public.roles where name = 'Staff'));
reset role;
update public.role_permissions set level = 'edit' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Staff');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
\set A '''00000000-0000-0000-0000-00000000000a'''
\set C '''00000000-0000-0000-0000-00000000000c'''
insert into public.clients (kind, legal_name, province) values ('corporation', 'Maple Dummy Review Inc.', 'ON') returning id as client \gset
select public.cb_create_file(:'client', '2026-08-31', '2025-09-01', '', 'full', 'statements', :C::uuid, :A::uuid) as f \gset
select public.cb_save_setup(:'f', '{"gst_registered": true, "gst_frequency": "quarterly", "quick_method": false}');
select public.cb_save_bank_account(:'f', null, 'chequing', 'Dummy Chq', '7509', 5000.00, false, false) as chq \gset
reset role;
select private.cb_add_statement(:'f', :'chq', 'chq.pdf', 5000.00, 5306.93, '[
  {"line": 1, "date": "2025-10-02", "description": "REFUND DUMMY 1", "amount": 173.93},
  {"line": 2, "date": "2025-11-03", "description": "REFUND DUMMY 2", "amount": 100.00},
  {"line": 3, "date": "2025-12-04", "description": "REFUND DUMMY 3", "amount": 50.00},
  {"line": 4, "date": "2026-01-05", "description": "OFFICE SUPPLY DUMMY", "amount": -17.00}]', '2025-09-01', '2026-08-31', 5000.00, 5306.93, null);
create function test.l(p_desc text) returns uuid language sql security definer set search_path = '' as $$ select id from public.cb_bank_lines where description = p_desc $$;
grant execute on function test.l(text) to authenticated;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';

-- ---------- Money in coded to an expense: with the reviewer.
select public.cb_post_lines(:'f', jsonb_build_array(
  jsonb_build_object('id', test.l('REFUND DUMMY 1'), 'kind', 'code', 'account', '64000', 'tax', 'EXEMPT'),
  jsonb_build_object('id', test.l('REFUND DUMMY 2'), 'kind', 'code', 'account', '64000', 'tax', 'EXEMPT'),
  jsonb_build_object('id', test.l('REFUND DUMMY 3'), 'kind', 'code', 'account', '64000', 'tax', 'EXEMPT'),
  jsonb_build_object('id', test.l('OFFICE SUPPLY DUMMY'), 'kind', 'code', 'account', '60000', 'tax', 'EXEMPT')));
select test.check('three lines with the reviewer', (select count(*) = 3 from public.cb_bank_lines where file_id = :'f' and status = 'reviewer'));

-- ---------- Another account in place: the line stays with the reviewer; History logs old and new.
select public.cb_recode_lines(:'f', jsonb_build_array(jsonb_build_object('id', test.l('REFUND DUMMY 1'), 'account', '40100', 'tax', 'EXEMPT')));
select test.check('changed in place: 40100, still with the reviewer, same reason', (select chart_account = '40100' and status = 'reviewer' and reviewer_reason like 'An expense coded to money in%'
  from public.cb_bank_lines where id = test.l('REFUND DUMMY 1')));
reset role;
select test.check('History: the old and new coding, by the preparer', exists (select 1 from public.cb_file_history where line_id = test.l('REFUND DUMMY 1') and action = 'line_recoded'
  and old_value like '64000%' and new_value like '40100%' and actor_id = :C::uuid));
set role authenticated;
select test.check('a pending line does not change here', test.try(format($q$select public.cb_recode_lines(%L, '[{"id": "%s", "account": "40100", "tax": "EXEMPT"}]')$q$, :'f', test.l('OFFICE SUPPLY DUMMY'))) is not null);

-- ---------- Mark reviewed: the reviewer or an owner only.
select test.check('the preparer cannot mark reviewed', test.try(format('select public.cb_review_lines(%L, array[%L]::uuid[])', :'f', test.l('REFUND DUMMY 1'))) like 'Only the file''s reviewer%');
-- Step 4 signed by the preparer, to see that the reviewer's decision keeps it.
reset role;
insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at) values (:'f', 'code', :C::uuid, now());
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
set role authenticated;
select public.cb_review_lines(:'f', array[test.l('REFUND DUMMY 1')]);
reset role;
select test.check('marked reviewed: posting unchanged, flag cleared, who and when kept', (select status = 'done' and chart_account = '40100' and reviewer_reason = ''
  and reviewed_reason like 'An expense coded to money in%' and reviewed_by = :A::uuid and reviewed_at is not null from public.cb_bank_lines where id = test.l('REFUND DUMMY 1')));
select test.check('History: "Marked reviewed", once; no "Coding changed"', (select count(*) = 1 from public.cb_file_history where line_id = test.l('REFUND DUMMY 1') and action = 'line_reviewed')
  and not exists (select 1 from public.cb_file_history where line_id = test.l('REFUND DUMMY 1') and action = 'line_recoded' and actor_id = :A::uuid));
select test.check('step 4''s sign-off stays', exists (select 1 from public.cb_step_signoffs where file_id = :'f' and step = 'code' and prepared_at is not null));
set role authenticated;
select public.cb_unreview_lines(:'f', array[test.l('REFUND DUMMY 1')]);
reset role;
select test.check('Undo: the flag and its reason are back; step 4''s sign-off stays', (select status = 'reviewer' and reviewer_reason like 'An expense coded to money in%' and reviewed_at is null
  from public.cb_bank_lines where id = test.l('REFUND DUMMY 1')) and exists (select 1 from public.cb_step_signoffs where file_id = :'f' and step = 'code'));
set role authenticated;
select public.cb_review_lines(:'f', array[test.l('REFUND DUMMY 2'), test.l('REFUND DUMMY 3')]);
select test.check('two marked reviewed at once', (select count(*) = 2 from public.cb_bank_lines where file_id = :'f' and status = 'done' and reviewed_at is not null));

-- ---------- A posted line split in place.
select public.cb_resplit_line(test.l('REFUND DUMMY 1'), '[{"account": "40100", "tax": "EXEMPT", "amount": 100.00}, {"account": "64000", "tax": "EXEMPT", "amount": 73.93}]');
select test.check('split in place: still with the reviewer, two rows', (select is_split and status = 'reviewer' and chart_account is null from public.cb_bank_lines where id = test.l('REFUND DUMMY 1'))
  and (select count(*) = 2 from public.cb_line_splits where line_id = test.l('REFUND DUMMY 1')));
select test.check('a split that does not add up is refused', test.try(format($q$select public.cb_resplit_line(%L, '[{"account": "40100", "tax": "EXEMPT", "amount": 100.00}, {"account": "64000", "tax": "EXEMPT", "amount": 1.00}]')$q$, test.l('REFUND DUMMY 1'))) like 'Left to split%');

-- ---------- An account for the reviewer's decision: a note is required; the decision stands while the balance does.
reset role;
insert into public.cb_accounts (file_id, account_key, number, name, this_year, last_year, line_no, needs_reviewer, reviewer_reason)
values (:'f', 'chart:10900', '10900', 'Clearing', 1110.13, 0, '1060.00', true, 'Clearing should be nil at year-end.') returning id as clr \gset
set role authenticated;
select test.check('the preparer cannot mark an account reviewed', (set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c"}', true) is not null)
  and test.try(format('select public.cb_review_account(%L, %L)', :'clr', 'Agreed with the client')) like 'Only the file''s reviewer%');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('Mark reviewed without a note is refused', test.try(format('select public.cb_review_account(%L, %L)', :'clr', '')) like 'Write the decision%');
select public.cb_review_account(:'clr', 'Timing: the other side posts in September (dummy).');
reset role;
select test.check('marked reviewed with its note, who and when', (select not needs_reviewer and review_note like 'Timing:%' and review_by = :A::uuid and review_cents = 111013 from public.cb_accounts where id = :'clr'));
update public.cb_accounts set needs_reviewer = true where id = :'clr';
select test.check('a rebuild at the same balance keeps the decision', (select not needs_reviewer and review_at is not null from public.cb_accounts where id = :'clr'));
update public.cb_accounts set this_year = 1200.00, needs_reviewer = true where id = :'clr';
select test.check('a new balance brings it back to the reviewer', (select needs_reviewer and review_at is null and review_note = '' from public.cb_accounts where id = :'clr'));
select test.check('History logs the account decision', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'account_reviewed' and reason like 'Timing:%'));
