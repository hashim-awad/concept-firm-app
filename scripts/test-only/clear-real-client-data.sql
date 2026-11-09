-- TEST PROJECT ONLY ("Concept Firm App - Test", wtivdpwyoarpcbgohgnr). Never run on Live.
-- Removes the real client records the Studio import put into Test (decision 35, Phase 2 batch:
-- Test holds dummy data only). Run once, by an owner, in the Supabase SQL editor of the Test project.
--
-- Removes: clients and their links, engagements, proposals, documents and their versions, import
-- runs, and the activity log entries about those rows (the log copies each changed row, so it holds
-- client names too). Keeps: the price book, packages and floors, GST/HST rates, templates and
-- wording, settings, staff, roles. The PDF files themselves are deleted separately in Storage
-- (bucket "documents"), because Supabase does not allow deleting stored files from SQL.
--
-- All or nothing: if any step fails, nothing is removed. Leaves one activity log entry with the
-- date and counts only, no client details.

begin;

create temporary table cleared on commit drop as
select
  (select count(*) from public.clients) as clients,
  (select count(*) from public.client_links) as client_links,
  (select count(*) from public.engagements) as engagements,
  (select count(*) from public.proposals) as proposals,
  (select count(*) from public.documents) as documents,
  (select count(*) from public.document_versions) as document_versions,
  (select count(*) from public.import_runs) as import_runs,
  (select count(*) from public.activity_log where entity_type in
     ('clients', 'client_links', 'engagements', 'proposals', 'documents', 'document_versions', 'import_runs')) as log_entries;

-- The permanence and logging triggers stop deletes on purpose; switch them off for this run only.
alter table public.document_versions disable trigger user;
alter table public.documents disable trigger user;
alter table public.engagements disable trigger user;
alter table public.proposals disable trigger user;
alter table public.client_links disable trigger user;
alter table public.clients disable trigger user;
alter table public.import_runs disable trigger user;
alter table public.activity_log disable trigger user;

delete from public.document_versions;
delete from public.documents;
delete from public.engagements;
delete from public.proposals;
delete from public.client_links;
delete from public.clients;
delete from public.import_runs;
delete from public.activity_log where entity_type in
  ('clients', 'client_links', 'engagements', 'proposals', 'documents', 'document_versions', 'import_runs');

alter table public.document_versions enable trigger user;
alter table public.documents enable trigger user;
alter table public.engagements enable trigger user;
alter table public.proposals enable trigger user;
alter table public.client_links enable trigger user;
alter table public.clients enable trigger user;
alter table public.import_runs enable trigger user;
alter table public.activity_log enable trigger user;

insert into public.activity_log (action, entity_type, details)
select 'test_data_cleared', 'test_cleanup', jsonb_build_object('counts', to_jsonb(c)) from cleared c;

select * from cleared;
commit;

-- Check: every count below must be 0.
select
  (select count(*) from public.clients) as clients_left,
  (select count(*) from public.engagements) as engagements_left,
  (select count(*) from public.proposals) as proposals_left,
  (select count(*) from public.documents) as documents_left,
  (select count(*) from public.document_versions) as versions_left,
  (select count(*) from public.import_runs) as import_runs_left;
