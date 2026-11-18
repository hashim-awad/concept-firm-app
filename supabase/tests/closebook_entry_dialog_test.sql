-- Local tests: round 15b, the journal entry dialog (entry number, Edit) and the new step numbers.
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
-- Staff C prepares; owner A reviews.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
reset role;
insert into public.clients (kind, legal_name, province) values ('corporation', 'Maple Test Realty Inc.', 'ON') returning id as client \gset
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_create_file(:'client', '2026-12-31', '2026-01-01', '', 'full', 'statements', :C::uuid, :A::uuid) as f \gset
select public.cb_import_tb(:'f', 'this_year', 'client_software', 'tb.csv', '[{"number":"1000","name":"Chequing","amount":500},{"number":"2100","name":"Due to shareholder","amount":-300},{"number":"4000","name":"Commission income","amount":-1000},{"number":"5300","name":"Office expenses","amount":700},{"number":"5900","name":"Johnson advance","amount":100}]');
select id as chq from public.cb_accounts where file_id = :'f' and account_key = '1000' \gset
select id as sh from public.cb_accounts where file_id = :'f' and account_key = '2100' \gset
select id as rev from public.cb_accounts where file_id = :'f' and account_key = '4000' \gset
select id as off from public.cb_accounts where file_id = :'f' and account_key = '5300' \gset
select id as adv from public.cb_accounts where file_id = :'f' and account_key = '5900' \gset

select public.cb_apply_matching(:'f', format('[{"account":"%s","line":"1002.00"},{"account":"%s","line":"2781.10"},{"account":"%s","line":"8121.00"},{"account":"%s","line":"8810.00"},{"account":"%s","line":null,"reason":"No clear match"}]', :'chq', :'sh', :'rev', :'off', :'adv')::jsonb) as r \gset
select test.check('suggestions applied; no match goes to the reviewer', :'r'::jsonb = '{"history": 0, "suggested": 4, "reviewer": 1}'
  and (select needs_reviewer from public.cb_accounts where id = :'adv'));
select test.check('no total lines', test.try(format($f$select public.cb_map_account(%L, '2599.00')$f$, :'off')) like '%totals are calculated%');
select test.check('the preparer cannot decide the reviewer''s list', test.try(format($f$select public.cb_map_account(%L, '1301.10')$f$, :'adv')) like '%waits for the reviewer%');
select test.check('the preparer cannot change a tax code', test.try(format($f$select public.cb_set_tax_code(%L, 'NONDED')$f$, :'off')) like '%reviewer changes a tax code%');
select public.cb_map_account(:'off', '8811.00');
select test.check('the preparer can change a suggestion', (select line_no || '|' || mapping_source from public.cb_accounts where id = :'off') = '8811.00|preparer');

-- The entry number can be typed; blank takes the next one; a number in use is refused.
select public.cb_add_entry(:'f', 'AJE', 'correction', 'Typed number', false, '[{"line":"8860.00","amount":100},{"line":"2620.00","amount":-100}]', 'Payables listing', null, null, '{}', 7) as e7 \gset
select test.check('a typed entry number is kept', (select seq from public.cb_entries where id = :'e7') = 7);
select test.check('a number in use is refused', test.try(format($f$select public.cb_add_entry(%L, 'AJE', 'correction', 'Again', false, '[{"line":"8860.00","amount":5},{"line":"2620.00","amount":-5}]', 'Payables listing', null, null, '{}', 7)$f$, :'f')) like '%2026-007 is taken%');
select public.cb_add_entry(:'f', 'AJE', 'correction', 'Next number', false, '[{"line":"8860.00","amount":10},{"line":"2620.00","amount":-10}]', 'Payables listing') as e8 \gset
select test.check('a blank number takes the next one', (select seq from public.cb_entries where id = :'e8') = 8);

-- Edit changes the entry in place, keeping its number, its id and where it came from (piece 2; before it, Edit
-- replaced the entry with a new one).
select public.cb_add_revenue_entry(:'f', 'Commission booked twice.', format('[{"account":"%s","amount":40},{"account":"%s","amount":-40}]', :'rev', :'chq')::jsonb, false, 20) as rv \gset
select test.check('the revenue fix takes a typed number too', (select seq || ':' || origin || ':' || wp_ref from public.cb_entries where id = :'rv') = '20:revenue_check:Revenue check');
select public.cb_edit_entry(:'rv', 'AJE', 'correction', 'Commission booked twice in December.', false, format('[{"account":"%s","amount":45},{"account":"%s","amount":-45}]', :'rev', :'chq')::jsonb, 'Revenue check') as rv2 \gset
select test.check('an edited entry keeps its number and origin, with the new lines',
  (select seq || ':' || origin || ':' || note from public.cb_entries where id = :'rv2') = '20:revenue_check:Commission booked twice in December.'
  and :'rv2' = :'rv'
  and (select sum(amount) filter (where amount > 0) from public.cb_entry_lines where entry_id = :'rv2') = 45);
select test.check('the edit still checks every rule', test.try(format($f$select public.cb_edit_entry(%L, 'AJE', 'correction', 'Bad', false, '[{"line":"8860.00","amount":5},{"line":"2620.00","amount":-4}]', 'Payables listing')$f$, :'rv2')) like '%does not balance%');
-- An approved entry cannot change (the delete rule).
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_review_entry(:'e7');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('an approved entry cannot be edited', test.try(format($f$select public.cb_edit_entry(%L, 'AJE', 'correction', 'Changed', false, '[{"line":"8860.00","amount":100},{"line":"2620.00","amount":-100}]', 'Payables listing')$f$, :'e7')) like '%approved entry cannot be deleted%');

-- The step numbers in the messages follow the new order: GIFI mapping is step 6, Review step 7.
select test.check('review is step 7', test.try(format($f$select public.cb_sign_step(%L, 'review', 'prepared')$f$, :'f')) like 'Step 7 is the reviewer%');
