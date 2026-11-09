-- Local tests for Phase 1 tables: clients, vault versions, tax rates, signer settings.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test',
  (select id from public.roles where name = 'Staff'));
reset role;
select test.check('RLS on for every public table',
  not exists (select 1 from pg_tables where schemaname = 'public' and not rowsecurity));

-- Staff (clients edit, documents edit, vault view, tax view)
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('staff adds a client', test.try($$insert into public.clients (kind, legal_name, entity_type) values ('corporation', 'Example Holdings Inc.', 'Holdco')$$) = 'OK');
select test.check('created_by stamped', (select created_by from public.clients) = '00000000-0000-0000-0000-00000000000c');
select test.check('staff adds a document', test.try($$insert into public.documents (kind, title, client_id) select 'corporate_letter', 'EL test', id from public.clients$$) = 'OK');
select test.check('version 1 accepted', test.try($$insert into public.document_versions (document_id, version, mode, inputs, file_path, file_name, file_sha256, file_size)
  select id, 1, 'draft', '{}', 'x/1.pdf', 'a.pdf', repeat('a', 64), 10 from public.documents$$) = 'OK');
select test.check('document current_version follows', (select current_version from public.documents) = 1);
select test.check('version numbers cannot skip', test.try($$insert into public.document_versions (document_id, version, mode, inputs, file_path, file_name, file_sha256, file_size)
  select id, 3, 'draft', '{}', 'x/3.pdf', 'a.pdf', repeat('a', 64), 10 from public.documents$$) like 'Version must be 2%');
select test.check('versions cannot be changed', test.try($$update public.document_versions set label = 'x'$$) like '%permission denied%'
  or test.try($$update public.document_versions set label = 'x'$$) like '%permanent%');
select test.check('staff cannot add a tax rate (view only)', test.try($$insert into public.tax_rates (province, tax, rate_percent, effective_from, source_url, checked_on, checked_by)
  values ('ON', 'HST', 13, '2026-01-01', 'https://www.canada.ca/x', '2026-11-08', '00000000-0000-0000-0000-00000000000c')$$) like '%row-level security%');
select test.check('staff cannot change signer names', test.try($$select public.update_setting('signer_proposal', '{"name":"X Y","title":"Boss"}')$$) like 'You do not have permission%');
select test.check('staff can read signer names', (public.signer_settings() -> 'signer_engagement_letter' ->> 'name') = 'Hashim Abouelfetouh, CPA');
select test.check('staff cannot read import runs', (select count(*) from public.import_runs) = 0);

-- Owner
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('owner adds a pending rate', test.try($$insert into public.tax_rates (province, tax, rate_percent, effective_from, source_url, checked_on, checked_by)
  values ('ON', 'HST', 13, '2026-01-01', 'https://www.canada.ca/en/revenue-agency/test', '2026-11-08', '00000000-0000-0000-0000-00000000000a')$$) = 'OK');
select test.check('rate must cite canada.ca', test.try($$insert into public.tax_rates (province, tax, rate_percent, effective_from, source_url, checked_on, checked_by)
  values ('AB', 'GST', 5, '2026-01-01', 'https://example.com', '2026-11-08', '00000000-0000-0000-0000-00000000000a')$$) like '%tax_rates_source_url_check%');
select test.check('pending rate is not used', not exists (select 1 from public.approved_tax_rate('ON')));
select test.check('new rates cannot start approved', test.try($$insert into public.tax_rates (province, tax, rate_percent, effective_from, source_url, checked_on, checked_by, status)
  values ('BC', 'GST', 5, '2026-01-01', 'https://www.canada.ca/x', '2026-11-08', '00000000-0000-0000-0000-00000000000a', 'approved')$$) like 'New rates start as pending%');
select test.check('owner approves', test.try($$update public.tax_rates set status = 'approved' where province = 'ON'$$) = 'OK');
select test.check('approval stamped', (select approved_by from public.tax_rates where province = 'ON') = '00000000-0000-0000-0000-00000000000a');
select test.check('approved rate is used', (select rate_percent from public.approved_tax_rate('ON')) = 13);
select test.check('no rate for a province without one', not exists (select 1 from public.approved_tax_rate('QC')));
select test.check('approved rate cannot be edited', test.try($$update public.tax_rates set rate_percent = 15 where province = 'ON'$$) like 'An approved rate cannot be changed%');
select test.check('rates cannot be deleted', test.try($$delete from public.tax_rates$$) like '%permission denied%' or test.try($$delete from public.tax_rates$$) like '%Retire a rate%');
select test.check('owner changes signer name', test.try($$select public.update_setting('signer_proposal', '{"name":"Hashim Awad","title":"Director"}')$$) = 'OK');
select test.check('owner reads import runs', test.try($$insert into public.import_runs (source, file_name, dry_run) values ('clients', 'x.csv', true)$$) = 'OK');

-- Staff cannot approve
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
reset role;
update public.role_permissions set level = 'edit' where area_key = 'tax_rates' and role_id = (select id from public.roles where name = 'Staff');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('staff with tax edit adds a rate', test.try($$insert into public.tax_rates (province, tax, rate_percent, effective_from, source_url, checked_on, checked_by)
  values ('AB', 'GST', 5, '2026-01-01', 'https://www.canada.ca/x', '2026-11-08', '00000000-0000-0000-0000-00000000000c')$$) = 'OK');
select test.check('staff cannot approve a rate', test.try($$update public.tax_rates set status = 'approved' where province = 'AB'$$) like 'Only an owner can approve%');
select test.check('staff cannot record another checker', test.try($$insert into public.tax_rates (province, tax, rate_percent, effective_from, source_url, checked_on, checked_by)
  values ('MB', 'GST', 5, '2026-01-01', 'https://www.canada.ca/x', '2026-11-08', '00000000-0000-0000-0000-00000000000a')$$) like '%row-level security%');
reset role;
select test.check('changes logged', (select count(*) from public.activity_log where entity_type in ('clients', 'documents', 'document_versions', 'tax_rates')) >= 5);
