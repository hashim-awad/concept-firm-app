-- Local tests: TaxDome import (decision 43). Owner only, all or nothing; TaxDome fields locked outside
-- the import; staff set the balance-due period and the exclude switch; deadlines marked done.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test',
  (select id from public.roles where name = 'Staff'));
insert into public.clients (id, kind, legal_name) values ('00000000-0000-0000-0000-0000000000c1', 'corporation', 'Alpha Realty Inc');

select test.check('an all-or-nothing import: a bad row stops everything',
  test.try($$select public.apply_taxdome_import('[{"op":"insert","taxdome_id":"201","legal_name":"Beta Holdings Ltd.","bn":"736174566","fye":"03-31","tags":["T2"],"province":"ON"},
    {"op":"insert","taxdome_id":"202","legal_name":"Bad","bn":"12","fye":"","tags":["T2"]}]')$$) like '%9 digits%'
  and not exists (select 1 from public.clients where legal_name = 'Beta Holdings Ltd.'));
select test.check('owner imports: one update, one insert', (select public.apply_taxdome_import('[
  {"op":"update","client_id":"00000000-0000-0000-0000-0000000000c1","taxdome_id":"101","legal_name":"Alpha Realty Inc.","bn":"725603690","fye":"12-31","tags":["T2","BK"]},
  {"op":"insert","taxdome_id":"201","legal_name":"Beta Holdings Ltd.","bn":"736174566","fye":"","tags":["T2"],"province":""}]')) = '{"added": 1, "updated": 1}');
select test.check('matched client updated from TaxDome', (select legal_name || '|' || business_number || '|' || year_end_md || '|' || taxdome_account_id from public.clients where id = '00000000-0000-0000-0000-0000000000c1') = 'Alpha Realty Inc.|725603690|12-31|101');
select test.check('new client is a corporation, no province guessed as Ontario', (select kind || '|' || province || '|' || year_end_md from public.clients where taxdome_account_id = '201') = 'corporation|OTHER|');
select test.check('import logged with counts only', (select details from public.activity_log where action = 'taxdome_import') = '{"added": 1, "updated": 1}');
select test.check('no duplicate Business Numbers', test.try($$select public.apply_taxdome_import('[{"op":"insert","taxdome_id":"301","legal_name":"Copy Inc.","bn":"725603690","fye":"","tags":["T2"]}]')$$) <> 'OK');
select test.check('no duplicate TaxDome ids', test.try($$select public.apply_taxdome_import('[{"op":"insert","taxdome_id":"101","legal_name":"Copy Inc.","bn":"","fye":"","tags":["T2"]}]')$$) <> 'OK');
select test.check('the owner cannot edit TaxDome fields by hand', test.try($$update public.clients set year_end_md = '06-30' where taxdome_account_id = '101'$$) like '%come from TaxDome%'
  and test.try($$update public.clients set legal_name = 'Other' where taxdome_account_id = '101'$$) like '%come from TaxDome%'
  and test.try($$update public.clients set business_number = '111111111' where id = '00000000-0000-0000-0000-0000000000c1'$$) like '%come from TaxDome%');
select test.check('a new client cannot be given a Business Number by hand', test.try($$insert into public.clients (kind, legal_name, business_number) values ('corporation', 'Hand Inc.', '222333444')$$) like '%TaxDome import%');

set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('staff cannot import', test.try($$select public.apply_taxdome_import('[]')$$) like 'Only an owner%');
select test.check('staff sets the balance-due period and the exclude switch', test.try($$update public.clients set t2_balance_due_months = 3, t2_exclude_deadlines = true where taxdome_account_id = '201'$$) = 'OK');
select test.check('saved', (select t2_balance_due_months = 3 and t2_exclude_deadlines from public.clients where taxdome_account_id = '201'));
select test.check('only 2 or 3 months', test.try($$update public.clients set t2_balance_due_months = 4 where taxdome_account_id = '201'$$) <> 'OK');
select test.check('staff can still edit other client fields', test.try($$update public.clients set notes = 'Call in March' where taxdome_account_id = '101'$$) = 'OK');
select test.check('staff marks a deadline done', test.try($$insert into public.t2_deadline_done (client_id, year_end, kind) values ('00000000-0000-0000-0000-0000000000c1', '2025-12-31', 'filing')$$) = 'OK');
select test.check('done_by stamped', (select done_by from public.t2_deadline_done) = '00000000-0000-0000-0000-00000000000c');
select test.check('staff can undo it', test.try($$delete from public.t2_deadline_done where kind = 'filing'$$) = 'OK');
select test.check('staff cannot set the TaxDome link', test.try($$select public.update_setting('taxdome_account_url', '"https://x.taxdome.com/accounts/{id}"')$$) not like 'OK');

set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('the TaxDome link must contain {id}', test.try($$select public.update_setting('taxdome_account_url', '"https://example.taxdome.com/accounts"')$$) like '%{id}%');
select test.check('owner sets the TaxDome link', test.try($$select public.update_setting('taxdome_account_url', '"https://example.taxdome.com/accounts/{id}"')$$) = 'OK');
select test.check('all staff read it', public.taxdome_account_url() = 'https://example.taxdome.com/accounts/{id}');
reset role;
