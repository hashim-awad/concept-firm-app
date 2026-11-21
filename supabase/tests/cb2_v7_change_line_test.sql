-- Local tests: CloseBook2 piece CB2-0 version 7, Part 4 items 2 and 8 (Hashim, Nov 21, 2026). A coded bank line changes
-- in place (account, sales tax, split, memo), from a transfer and from an outstanding item too, with one History row.
-- Bulk coding writes one History row per bank line. Dummy data only.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'viewer.b@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
-- Runs a statement and rolls it back: 'OK' when it would succeed, or the error.
create function test.try_rollback(p_sql text) returns text language plpgsql as $$
begin
  begin
    execute p_sql;
    raise exception 'ROLLBACK_OK';
  exception when others then
    if sqlerrm = 'ROLLBACK_OK' then return 'OK'; end if;
    return sqlerrm;
  end;
end $$;
grant execute on function test.try_rollback(text) to authenticated;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.create_role('Closebook viewer', 'Reads Closebook only') as viewer \gset
select public.set_role_permissions(:'viewer', '{"documents":"none","leads":"none","pricing":"none","clients":"view","closebook":"view"}');
select public.add_staff('00000000-0000-0000-0000-00000000000b', 'Test Viewer B', 'viewer.b@example.test', :'viewer'::uuid);
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test', (select id from public.roles where name = 'Accountant'));
reset role;
reset request.jwt.claims;
update public.role_permissions set level = 'edit' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Accountant');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
insert into public.clients (kind, legal_name, province) values ('corporation', 'Birch Dummy Realty Inc.', 'ON') returning id as client \gset
\set A '''00000000-0000-0000-0000-00000000000a'''
\set C '''00000000-0000-0000-0000-00000000000c'''
select public.cb_create_file(:'client', '2026-12-31', '2026-01-01', '', 'full', 'statements', :C::uuid, :A::uuid) as f \gset
-- Chequing 4521: 5,000.00 less a transfer to savings, a card payment and a coffee.
select (public.cb_upload_bank(:'f', null, 'Chequing 4521', 'bank', 'chq.csv', 5000, 3224.75,
  '[{"line":2,"date":"2026-03-13","description":"TFR TO SAV 7788","amount":-500},{"line":3,"date":"2026-03-20","description":"VISA PAYMENT","amount":-1200},{"line":4,"date":"2026-03-25","description":"DUMMY COFFEE","amount":-75.25}]',
  '2026-03-01', '2026-03-31')) ->> 'account_id' as chq \gset
select (public.cb_upload_bank(:'f', null, 'Savings 7788', 'bank', 'sav.csv', 0, 1000,
  '[{"line":2,"date":"2026-03-14","description":"TFR FROM CHQ 4521","amount":500},{"line":3,"date":"2026-03-30","description":"TFR FROM CHQ 4521","amount":500}]',
  '2026-03-01', '2026-03-31')) ->> 'account_id' as sav \gset
-- Visa 1234: 1,200.00 owing, paid from chequing; one new charge.
select (public.cb_upload_bank(:'f', null, 'Visa 1234', 'card', 'visa.csv', 1200, 113,
  '[{"line":2,"date":"2026-03-21","description":"PAYMENT THANK YOU","amount":-1200},{"line":3,"date":"2026-03-22","description":"DUMMY SOFTWARE","amount":113}]',
  '2026-03-01', '2026-03-31')) ->> 'account_id' as visa \gset
select public.cb_set_bank_chart_account(:'sav', '10100');
select public.cb_save_setup(:'f', '{"gst_registered": true, "gst_frequency": "quarterly", "quick_method": false}');
select id as c_tfr from public.cb_bank_lines where description = 'TFR TO SAV 7788' \gset
select id as c_visa from public.cb_bank_lines where description = 'VISA PAYMENT' \gset
select id as c_coffee from public.cb_bank_lines where description = 'DUMMY COFFEE' \gset
select id as s_in from public.cb_bank_lines where account_id = :'sav' and txn_date = '2026-03-14' \gset
select id as s_late from public.cb_bank_lines where account_id = :'sav' and txn_date = '2026-03-30' \gset
select id as v_pay from public.cb_bank_lines where description = 'PAYMENT THANK YOU' \gset
select id as v_soft from public.cb_bank_lines where description = 'DUMMY SOFTWARE' \gset

-- ---------- Item 8: bulk coding, one History row per bank line
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
reset role;
select count(*) as h0 from public.cb_file_history where file_id = :'f' \gset
set role authenticated;
select public.cb_post_lines(:'f', format('[{"id":"%s","kind":"code","account":"63000","tax":"HST_ON"},{"id":"%s","kind":"code","account":"63000","tax":"HST_ON"}]', :'c_coffee', :'v_soft')::jsonb);
reset role;
select test.check('bulk coding two lines writes two History rows, one per line',
  (select count(*) from public.cb_file_history where file_id = :'f') = :h0 + 2
  and (select count(distinct line_id) from public.cb_file_history where file_id = :'f' and line_id in (:'c_coffee', :'v_soft')) = 2);

-- ---------- Item 2: change a coded line in place
set role authenticated;
select count(*) as h1 from public.cb_file_history where file_id = :'f' \gset
select public.cb_change_line(:'f', :'c_coffee', '{"account":"60200","tax":"HST_ON"}');
reset role;
select test.check('account changed in place, one History row with before and after',
  (select chart_account = '60200' and status = 'done' from public.cb_bank_lines where id = :'c_coffee')
  and (select count(*) from public.cb_file_history where file_id = :'f') = :h1 + 1
  and exists (select 1 from public.cb_file_history where line_id = :'c_coffee' and action = 'line_changed' and old_value like '63000%' and new_value like '60200%'));
set role authenticated;
select count(*) as h2 from public.cb_file_history where file_id = :'f' \gset
select public.cb_change_line(:'f', :'c_coffee', '{"memo":"Client meeting"}');
reset role;
select test.check('memo changed, one row', (select memo = 'Client meeting' from public.cb_bank_lines where id = :'c_coffee')
  and (select count(*) from public.cb_file_history where file_id = :'f') = :h2 + 1);
set role authenticated;
select test.check('a split must add up to the bank line (kept as an unbalanced entry)',
  test.try(format($q$select public.cb_change_line(%L, %L, '{"splits":[{"account":"63000","tax":"HST_ON","amount":100},{"account":"60200","tax":"HST_ON","amount":10}]}')$q$, :'f', :'v_soft')) like 'Left to split%');
select count(*) as h3 from public.cb_file_history where file_id = :'f' \gset
select public.cb_change_line(:'f', :'v_soft', '{"splits":[{"account":"63000","tax":"HST_ON","amount":100},{"account":"60200","tax":"HST_ON","amount":13}]}');
reset role;
select test.check('a coded line becomes a split, one row',
  (select is_split from public.cb_bank_lines where id = :'v_soft') and (select count(*) from public.cb_line_splits where line_id = :'v_soft') = 2
  and (select count(*) from public.cb_file_history where file_id = :'f') = :h3 + 1);
set role authenticated;
select count(*) as h4 from public.cb_file_history where file_id = :'f' \gset
select public.cb_change_line(:'f', :'v_soft', '{"account":"63000","tax":"HST_ON"}');
reset role;
select test.check('a split line goes back to one account, one row',
  (select not is_split and chart_account = '63000' from public.cb_bank_lines where id = :'v_soft') and (select count(*) from public.cb_line_splits where line_id = :'v_soft') = 0
  and (select count(*) from public.cb_file_history where file_id = :'f') = :h4 + 1);
-- A transfer line: the transfer is undone and its other line goes back to To code; one row.
set role authenticated;
select public.cb_accept_transfer(:'f', :'c_tfr', :'s_in');
select count(*) as h5 from public.cb_file_history where file_id = :'f' \gset
select public.cb_change_line(:'f', :'c_tfr', '{"account":"23000","tax":"EXEMPT"}');
reset role;
select test.check('a transfer line changes in place: transfer undone, the other line To code, one row',
  (select chart_account = '23000' from public.cb_bank_lines where id = :'c_tfr') and not exists (select 1 from public.cb_bank_transfers where out_line = :'c_tfr' or in_line = :'c_tfr')
  and (select status = 'new' from public.cb_bank_lines where id = :'s_in')
  and (select count(*) from public.cb_file_history where file_id = :'f') = :h5 + 1
  and exists (select 1 from public.cb_file_history where line_id = :'c_tfr' and action = 'line_changed' and old_value like 'Transfer with%'));
set role authenticated;
select test.check('a line still to code is not changed here', test.try(format($q$select public.cb_change_line(%L, %L, '{"account":"60200"}')$q$, :'f', :'s_in')) = 'Only a coded line changes here.');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b"}';
select test.check('a viewer cannot change a line', test.try(format($q$select public.cb_change_line(%L, %L, '{"account":"60200"}')$q$, :'f', :'c_coffee')) like 'You need Edit on Closebook%');

-- ---------- Spec-checker fixes (rule 16)
-- Item 1: the line that cleared an outstanding item may be in another account of the file.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
set role authenticated;
select test.check('an outstanding item on the card is cleared by a line in chequing (any account in the file)',
  test.try(format($q$select public.cb_add_outstanding(%L, 'start', '2025-12-30', 'Card payment in transit', 'out', 1200, %L)$q$, :'visa', :'c_visa')) = 'OK');
select test.check('a line from another file is still refused',
  test.try(format($q$select public.cb_add_outstanding(%L, 'start', '2025-12-30', 'Other file', 'out', 10, gen_random_uuid())$q$, :'visa')) = 'That line is not in this file.');
-- Item 8: the Reclass entry box is saved inside the entry's save: one History row.
reset role;
select count(*) as h6 from public.cb_file_history where file_id = :'f' \gset
set role authenticated;
select public.cb_save_entry(:'f', null, true, 'AJE', 'correction', 'Reclass dummy', false, '[{"chart":"65100","amount":550},{"chart":"60200","amount":-550}]', 'Lead sheet') as re1 \gset
reset role;
select test.check('a new entry saved with Reclass entry ticked: ticked, one History row that says so',
  (select is_reclass from public.cb_entries where id = :'re1')
  and (select count(*) from public.cb_file_history where file_id = :'f') = :h6 + 1
  and (select count(*) from public.cb_file_history where file_id = :'f' and entry_id = :'re1' and detail like '%Reclass entry ticked%') = 1);
select count(*) as h7 from public.cb_file_history where file_id = :'f' \gset
set role authenticated;
select public.cb_save_entry(:'f', :'re1', false, 'AJE', 'correction', 'Reclass dummy', false, '[{"chart":"65100","amount":550},{"chart":"60200","amount":-550}]', 'Lead sheet');
reset role;
select test.check('only the box changes: unticked, one History row',
  (select not is_reclass from public.cb_entries where id = :'re1')
  and (select count(*) from public.cb_file_history where file_id = :'f') = :h7 + 1
  and (select count(*) from public.cb_file_history where file_id = :'f' and entry_id = :'re1' and detail like '%Reclass entry unticked%') = 1);
select count(*) as h8 from public.cb_file_history where file_id = :'f' \gset
set role authenticated;
select public.cb_save_entry(:'f', :'re1', true, 'AJE', 'correction', 'Reclass dummy, amount changed', false, '[{"chart":"65100","amount":600},{"chart":"60200","amount":-600}]', 'Lead sheet');
reset role;
select test.check('the amount and the box change together: one History row',
  (select is_reclass from public.cb_entries where id = :'re1')
  and (select count(*) from public.cb_file_history where file_id = :'f') = :h8 + 1);
