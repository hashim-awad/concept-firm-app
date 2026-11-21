-- Local tests: round 10 (Hashim, Nov 27, 2026), step 8: GIFI exports, the stale rule, the tie-out to
-- ProFile, the reviewer's acceptances and step 8's sign-offs.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'prep.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
-- CB2-0: runs a statement and rolls it back: 'OK' when it would succeed, or the error. Used where a call that used to be
-- refused now succeeds, so the rest of the file still runs on the same data.
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
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Preparer C', 'prep.c@example.test', (select id from public.roles where name = 'Accountant'));
reset role;
reset request.jwt.claims;
update public.role_permissions set level = 'edit' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Accountant');
insert into public.clients (kind, legal_name, province) values ('corporation', 'Pine Test Realty Inc.', 'ON') returning id as client \gset
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_create_file(:'client', '2026-12-31', '2026-01-01', '', 'full', 'client_software', '00000000-0000-0000-0000-00000000000c'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid) as f \gset
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_import_tb(:'f', 'this_year', 'client_software', 'tb.csv', '[
  {"number":"10100","name":"Chequing","amount":12000},{"number":"41000","name":"Commission income","amount":-20000},
  {"number":"64250","name":"Accounting fees","amount":8000}]');
select public.cb_map_account(id, case number when '10100' then '1002.00' when '41000' then '8000.00' else '8862.00' end) from public.cb_accounts where file_id = :'f';
\set checks '[{"key":"tb","title":"TB","ok":true},{"key":"bs","title":"BS","ok":true},{"key":"ni","title":"NI","ok":true},{"key":"re","title":"RE","ok":true},{"key":"opening","title":"Opening","ok":true}]'
\set bad '[{"key":"tb","title":"TB","ok":true},{"key":"bs","title":"BS","ok":true},{"key":"ni","title":"NI","ok":true},{"key":"re","title":"RE","ok":true},{"key":"opening","title":"Retained earnings start = last year","ok":false}]'
\set totals '{"9999":12000,"2599":12000,"amort":0,"inctax":0}'
select test.check('a failed check does not refuse the export (CB2-0: only an unbalanced trial balance does; rolled back here)',
  test.try_rollback(format($q$select public.cb_record_gifi_export(%L, 'final', 'x.gfi', '"GIFI01",""', %L, %L)$q$, :'f', :'totals', :'bad')) = 'OK');
reset role;
reset request.jwt.claims;
select test.check('step 8: nothing exported yet', private.cb_step8_problems(:'f') = array['Export the final GIFI file, after the tax entries are booked.']);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('the preparer can sign step 8 before the export (CB2-0: a warning; rolled back here)', test.try_rollback(format($q$select public.cb_sign_step(%L, 't2', 'prepared')$q$, :'f')) = 'OK');
select test.check('ProFile figures save before the final export (CB2-0 step 3: no gate; rolled back here)', test.try_rollback(format($q$select public.cb_save_t2_tieout(%L, 1, 1, 0, 0, 't2.pdf')$q$, :'f')) = 'OK');
select public.cb_record_gifi_export(:'f', 'before_tax', 'Pine GIFI 2026-12-31 before tax entries.gfi', '"GIFI01",""', :'totals', :'checks');
select public.cb_record_gifi_export(:'f', 'final', 'Pine GIFI 2026-12-31 final.gfi', '"GIFI01",""', :'totals', :'checks') as ex \gset
reset role;
reset request.jwt.claims;
select test.check('both exports are kept with who and when', (select count(*) from public.cb_gifi_exports where file_id = :'f' and created_by = '00000000-0000-0000-0000-00000000000c') = 2);
select test.check('step 8: the ProFile figures come next', private.cb_step8_problems(:'f') = array['Enter the figures from ProFile and attach the T2 PDF.']);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('the figures save without the T2 PDF (CB2-0 step 3: whatever is filled in; rolled back here)', test.try_rollback(format($q$select public.cb_save_t2_tieout(%L, 12000, 12000, 0, 0, '')$q$, :'f')) = 'OK');
select public.cb_save_t2_tieout(:'f', 11987.50, 12000, 0, 0, 'files/t2.pdf');
reset role;
reset request.jwt.claims;
select test.check('a difference over the rounding allowed blocks the preparer, Closebook less ProFile',
  private.cb_step8_problems(:'f') = array['Net income: Closebook less ProFile is 12.50, more than the rounding allowed (5.00). Only the reviewer can accept it.']);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('the preparer cannot accept it', test.try(format($q$select public.cb_accept_t2_difference(%L, 'ni', 'Rounding')$q$, :'f')) like 'Only the reviewer accepts%');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('the reviewer gives a reason', test.try(format($q$select public.cb_accept_t2_difference(%L, 'ni', '')$q$, :'f')) = 'Say why the difference is accepted.');
select public.cb_accept_t2_difference(:'f', 'ni', 'Late ProFile change, booked next year.');
reset role;
reset request.jwt.claims;
select test.check('accepted: nothing open', private.cb_step8_problems(:'f') = '{}');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_save_t2_tieout(:'f', 12012.50, 12000, 0, 0, null);
reset role;
reset request.jwt.claims;
select test.check('the acceptance reopens when the signed difference changes', private.cb_step8_problems(:'f') = array['Net income: Closebook less ProFile is (12.50), more than the rounding allowed (5.00). Only the reviewer can accept it.']);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
-- ProFile rounds each line to whole dollars: 11,999 against 12,000.00 is rounding, not a difference.
select public.cb_save_t2_tieout(:'f', 11999, 12000, 0, 0, null);
reset role;
reset request.jwt.claims;
select test.check('a difference within the rounding allowed ($5) does not block', private.cb_step8_problems(:'f') = '{}'
  and (select (x ->> 'rounding')::boolean from jsonb_array_elements(private.cb_t2_state(:'f') -> 'items') x where x ->> 'key' = 'ni'));
update public.cb_settings set t2_rounding = 0;
select test.check('the rounding allowed is a setting', private.cb_step8_problems(:'f') @> array['Net income: Closebook less ProFile is 1.00, more than the rounding allowed (0.00). Only the reviewer can accept it.']);
update public.cb_settings set t2_rounding = 5;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_save_t2_tieout(:'f', 12000, 12000, 0, 3, null);
reset role;
reset request.jwt.claims;
select test.check('income tax and CCA tie to the cent: 3.00 on income tax blocks', private.cb_step8_problems(:'f') = array['Income tax: Closebook less ProFile is (3.00). It must tie to the cent. Only the reviewer can accept it.']);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_save_t2_tieout(:'f', 12000, 12000, 0, 0, null);
reset role;
reset request.jwt.claims;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_save_t2_tieout(:'f', 12000, 12000, 0, 0, null);
select public.cb_sign_step(:'f', 't2', 'prepared');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_sign_step(:'f', 't2', 'reviewed');
reset role;
reset request.jwt.claims;
select test.check('step 8 signed by both', exists (select 1 from public.cb_step_signoffs where file_id = :'f' and step = 't2' and prepared_at is not null and reviewed_at is not null));
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('step 8 is in the step status', (public.cb_step_status(:'f') -> 't2' ->> 'problems') = '[]');
reset role;
reset request.jwt.claims;

-- A change to the trial balance after the final export: stale, step 8 lists it again; its sign-offs stay (CB2-0 step 2).
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_add_entry(:'f', 'TJE', 'tax', 'To record the income tax provision.', false, jsonb_build_array(
  jsonb_build_object('account', (select id from public.cb_accounts where file_id = :'f' and number = '64250'), 'amount', 100),
  jsonb_build_object('account', (select id from public.cb_accounts where file_id = :'f' and number = '10100'), 'amount', -100)), 'Income tax schedule');
reset role;
reset request.jwt.claims;
select test.check('the final export is stale', (private.cb_t2_state(:'f') ->> 'stale')::boolean);
select test.check('step 8 reopens with the message', private.cb_step8_problems(:'f') = array['The trial balance changed after the final export. Export again and import it into ProFile.']);
select test.check('and its sign-offs stay; History has the entry, no sign-off cleared', exists (select 1 from public.cb_step_signoffs where file_id = :'f' and step = 't2' and prepared_at is not null)
  and exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'entry_created' and step = 'entries')
  and not exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'signoff_cleared'));

-- The reviewer's treatment of a REVIEW line and book amortization, per client.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('only the reviewer sets a treatment', test.try(format($q$select public.cb_set_review_treatment(%L, '8231.00', 'deduct100')$q$, :'f')) like 'Only the reviewer sets the treatment%');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('only a REVIEW line', test.try(format($q$select public.cb_set_review_treatment(%L, '8862.00', 'deduct100')$q$, :'f')) = 'This line is not a REVIEW line.');
select public.cb_set_review_treatment(:'f', '8231.00', 'deduct100');
select test.check('"Set book amortization" is retired (CB2-0 step 4: amortization = CCA rule removed)', test.try(format($q$select public.cb_set_book_amortization(%L, true)$q$, :'f')) like 'Retired: %');
reset role;
reset request.jwt.claims;
select test.check('the treatment is kept for the client, so it rolls forward', exists (select 1 from public.cb_review_treatments where client_id = :'client' and line_no = '8231.00' and treatment = 'deduct100'));
select test.check('CCA is never compared with amortization', (select (x ->> 'compared')::boolean from jsonb_array_elements(private.cb_t2_state(:'f') -> 'items') x where x ->> 'key' = 'cca') = false);

-- A REVIEW line with no treatment blocks the preparer; the reviewer's treatment clears it.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_import_tb(:'f', 'this_year', 'client_software', 'tb2.csv', '[
  {"number":"10100","name":"Chequing","amount":12000},{"number":"41000","name":"Commission income","amount":-20000},
  {"number":"64250","name":"Accounting fees","amount":8000},{"number":"48000","name":"Foreign exchange gain","amount":-50},{"number":"10200","name":"US account","amount":50}]');
select public.cb_map_account(id, case number when '48000' then '8231.00' when '10200' then '1002.00' when '10100' then '1002.00' when '41000' then '8000.00' else '8862.00' end)
  from public.cb_accounts where file_id = :'f' and number in ('48000', '10200');
reset role;
reset request.jwt.claims;
delete from public.cb_review_treatments where client_id = :'client';
select test.check('a REVIEW line with no treatment blocks step 8', private.cb_step8_problems(:'f') @> array['1 REVIEW line waits for the reviewer''s Schedule 1 treatment (tax workpaper).']);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_set_review_treatment(:'f', '8231.00', 'none');
reset role;
reset request.jwt.claims;
select test.check('set by the reviewer: no longer blocks', not (private.cb_step8_problems(:'f') @> array['1 REVIEW line waits for the reviewer''s Schedule 1 treatment (tax workpaper).']));

-- A liability with a debit balance on a line with no paired line goes to the reviewer in step 7.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_import_tb(:'f', 'this_year', 'client_software', 'tb3.csv', '[
  {"number":"10100","name":"Chequing","amount":12000},{"number":"41000","name":"Commission income","amount":-20000},
  {"number":"64250","name":"Accounting fees","amount":8000},{"number":"21700","name":"Visa","amount":55.20},{"number":"10300","name":"Cash float","amount":-55.20}]');
select public.cb_map_account(id, case number when '21700' then '2707.00' else '1002.00' end) from public.cb_accounts where file_id = :'f' and number in ('21700', '10300');
reset role;
reset request.jwt.claims;
select test.check('a debit balance on 2707 waits for the reviewer in step 7', private.cb_step_waiting(:'f', 'mapping') @> array['1 account with a balance on the wrong side of its GIFI line.']);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('only the reviewer keeps it there', test.try(format($q$select public.cb_confirm_side(%L, 'Card in credit')$q$, (select id from public.cb_accounts where file_id = :'f' and number = '21700'))) like 'Only the reviewer keeps%');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_confirm_side((select id from public.cb_accounts where file_id = :'f' and number = '21700'), 'The card is in credit at the year end.');
reset role;
reset request.jwt.claims;
select test.check('kept with a reason: no longer waiting', private.cb_open_side_flags(:'f') = 0);
