-- Round 20 (Hashim, Nov 15, 2026): Bank statement PDF to CSV. Benchmark: QuickBooks Online "Import bank
-- transactions" then "Verify details", plus a running-balance check.
--   1. One upload is one statement job (public.cb_statement_imports). A job belongs to a Closebook file
--      (step 3, "Upload PDF statements") or to nobody (the standalone tool "Bank statement PDF to CSV").
--   2. The reader runs in the background (route /api/statements/run, with the secret key): at most 3 jobs
--      read at once across the firm. A job left "reading" for 10 minutes goes back in the queue; after 3
--      tries it fails. The person can Retry a failed job.
--   3. The file itself is kept in the private bucket 'statement-uploads'.
--   4. Import into a file goes through cb_upload_bank, the same path as the CSV upload, one statement per
--      account found. The statement keeps a conversion record: the import, model, pages, tokens, cost, the
--      check result, the lines edited, added and deleted, and the PDF as its attachment.
--   5. The standalone tool keeps nothing: the job is deleted after the download (or when discarded, or
--      after 24 hours). Only a log row stays (public.statement_tool_log): who, when, pages, cost.
-- Safe to run twice.

-- ---------- 1. The jobs
create table if not exists public.cb_statement_imports (
  id            uuid primary key default gen_random_uuid(),
  file_id       uuid references public.cb_files (id) on delete cascade,   -- null: the standalone tool
  created_by    uuid not null default auth.uid() references public.staff (id),
  created_at    timestamptz not null default now(),
  file_name     text not null check (length(btrim(file_name)) between 1 and 200),
  media_type    text not null check (media_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif')),
  storage_path  text not null,
  pages         int,
  status        text not null default 'queued' check (status in ('queued', 'reading', 'ready', 'needs_look', 'failed', 'imported', 'discarded')),
  attempts      int not null default 0,
  started_at    timestamptz,
  finished_at   timestamptz,
  error         text,
  model         text,
  input_tokens  int,
  output_tokens int,
  cost_usd      numeric(10, 4),
  result        jsonb,       -- as read (ReadResult)
  edited        jsonb,       -- the person's working copy; null until edited
  summary       jsonb,       -- {accounts, lines, difference_cents, review} of edited ?? result, for the lists
  imported_at   timestamptz,
  imported_by   uuid references public.staff (id)
);
-- 'uploading': the browser is sending the file straight to storage (signed upload URL; Vercel takes request
-- bodies up to about 4.5 MB). Not read until the upload is confirmed; left over 24 hours, it is removed.
alter table public.cb_statement_imports drop constraint if exists cb_statement_imports_status_check;
alter table public.cb_statement_imports add constraint cb_statement_imports_status_check
  check (status in ('uploading', 'queued', 'reading', 'ready', 'needs_look', 'failed', 'imported', 'discarded'));
create index if not exists cb_statement_imports_queue on public.cb_statement_imports (status, created_at);
create index if not exists cb_statement_imports_file on public.cb_statement_imports (file_id, created_at);
create index if not exists cb_statement_imports_creator on public.cb_statement_imports (created_by, created_at);

alter table public.cb_statement_imports enable row level security;
alter table public.cb_statement_imports force row level security;
-- File rows: anyone with Closebook. Standalone rows: only the person who uploaded them.
-- Changes go through the functions below, which check Closebook Edit on file rows.
drop policy if exists "Closebook viewers read statement imports" on public.cb_statement_imports;
create policy "Closebook viewers read statement imports" on public.cb_statement_imports for select to authenticated
  using ((select private.can_view('closebook')) and (file_id is not null or created_by = (select auth.uid())));
revoke all on public.cb_statement_imports from anon;
grant select on public.cb_statement_imports to authenticated;
-- The runner (secret key) reads jobs; it changes them only through the functions in section 6.
grant select on public.cb_statement_imports to service_role;

-- ---------- 2. The log of the standalone tool. Holds no client details.
create table if not exists public.statement_tool_log (
  id         bigint generated always as identity primary key,
  staff_id   uuid references public.staff (id),
  created_at timestamptz not null default now(),
  pages      int,
  cost_usd   numeric(10, 4),
  outcome    text not null default 'downloaded' check (outcome in ('downloaded', 'discarded', 'expired'))
);
create index if not exists statement_tool_log_at on public.statement_tool_log (created_at desc);
alter table public.statement_tool_log enable row level security;
alter table public.statement_tool_log force row level security;
drop policy if exists "Owners read the statement tool log" on public.statement_tool_log;
create policy "Owners read the statement tool log" on public.statement_tool_log for select to authenticated using ((select private.is_owner()));
revoke all on public.statement_tool_log from anon;
grant select on public.statement_tool_log to authenticated;

-- ---------- 3. The private bucket. The server reads and writes it with the secret key; these policies
-- give the same rule to a signed-in person: file/<file id>/... for Closebook, tool/<staff id>/... for the
-- person's own standalone uploads.
insert into storage.buckets (id, name, public) values ('statement-uploads', 'statement-uploads', false) on conflict (id) do nothing;
-- On Supabase the bucket also refuses files over 30 MB and anything but PDFs and photos (the stand-in has no such columns).
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    update storage.buckets set file_size_limit = 30 * 1024 * 1024,
           allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif']
     where id = 'statement-uploads';
  end if;
end $$;
drop policy if exists "Closebook reads statement uploads" on storage.objects;
create policy "Closebook reads statement uploads" on storage.objects for select to authenticated
  using (bucket_id = 'statement-uploads' and (select private.can_view('closebook'))
         and (split_part(name, '/', 1) = 'file' or (split_part(name, '/', 1) = 'tool' and split_part(name, '/', 2) = (select auth.uid())::text)));
drop policy if exists "Closebook adds statement uploads" on storage.objects;
create policy "Closebook adds statement uploads" on storage.objects for insert to authenticated
  with check (bucket_id = 'statement-uploads'
         and ((split_part(name, '/', 1) = 'file' and (select private.can_edit('closebook')))
           or (split_part(name, '/', 1) = 'tool' and split_part(name, '/', 2) = (select auth.uid())::text and (select private.can_view('closebook')))));

-- ---------- 4. The conversion record on the statement, and the last digits on the file's bank account
alter table public.cb_bank_statements
  add column if not exists statement_import_id uuid references public.cb_statement_imports (id) on delete set null,
  add column if not exists source text not null default 'csv' check (source in ('csv', 'pdf')),
  add column if not exists converted_by uuid references public.staff (id),
  add column if not exists converted_at timestamptz,
  add column if not exists model text,
  add column if not exists pages int,
  add column if not exists input_tokens int,
  add column if not exists output_tokens int,
  add column if not exists cost_usd numeric(10, 4),
  add column if not exists check_result jsonb,
  add column if not exists edits jsonb,            -- {"edited": n, "added": n, "deleted": n} before import
  add column if not exists attachment_path text;   -- in the private 'documents' bucket
alter table public.cb_bank_accounts add column if not exists last4 text check (last4 ~ '^[0-9]{1,8}$');

-- ---------- 5. Functions for the signed-in person

-- A new job: 'queued' when the server stored the file first (statement_create_job), 'uploading' when the
-- browser sends it straight to storage next (statement_begin_upload, then statement_confirm_upload).
create or replace function private.statement_new_job(p_id uuid, p_file uuid, p_file_name text, p_media_type text, p_storage_path text, p_status text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files;
begin
  if p_file is null then
    perform private.require(private.can_view('closebook'), 'You need Closebook to use this tool.');
    perform private.require(p_storage_path like 'tool/' || (select auth.uid())::text || '/%', 'The file was not stored in the right place.');
  else
    perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook to upload.');
    select * into v_file from public.cb_files where id = p_file;
    perform private.require(v_file.id is not null, 'File not found.');
    perform private.require(v_file.phase <> 'locked', 'This file is locked.');
    perform private.require(v_file.file_type = 'full', 'Monthly files confirm bank and cards in QuickBooks; there is nothing to upload.');
    perform private.require(p_storage_path like 'file/' || p_file::text || '/%', 'The file was not stored in the right place.');
  end if;
  perform private.require(p_media_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif'), 'Upload a PDF, or a photo (JPG, PNG or HEIC).');
  perform private.require(length(btrim(coalesce(p_file_name, ''))) between 1 and 200, 'The file needs a name.');
  perform private.require(p_status in ('queued', 'uploading'), 'Unknown status.');
  insert into public.cb_statement_imports (id, file_id, created_by, file_name, media_type, storage_path, status)
  values (coalesce(p_id, gen_random_uuid()), p_file, (select auth.uid()), btrim(p_file_name), p_media_type, p_storage_path, p_status)
  returning id into p_id;
  if p_file is not null and p_status = 'queued' then
    perform private.cb_log(p_file, 'statement_uploaded', 'records', 'PDF statement uploaded: ' || btrim(p_file_name));
  end if;
  return p_id;
end;
$$;

create or replace function public.statement_create_job(p_id uuid, p_file uuid, p_file_name text, p_media_type text, p_storage_path text)
returns uuid language sql security definer set search_path = '' as $$
  select private.statement_new_job(p_id, p_file, p_file_name, p_media_type, p_storage_path, 'queued')
$$;

create or replace function public.statement_begin_upload(p_id uuid, p_file uuid, p_file_name text, p_media_type text, p_storage_path text)
returns uuid language sql security definer set search_path = '' as $$
  select private.statement_new_job(p_id, p_file, p_file_name, p_media_type, p_storage_path, 'uploading')
$$;

-- The job, if the signed-in person may change it: Closebook Edit for a file's job, the uploader for a
-- standalone one.
create or replace function private.statement_job_for_change(p_id uuid) returns public.cb_statement_imports
language plpgsql security definer set search_path = '' as $$
declare v public.cb_statement_imports;
begin
  select * into v from public.cb_statement_imports where id = p_id for update;
  perform private.require(v.id is not null and private.can_view('closebook') and (v.file_id is not null or v.created_by = (select auth.uid())), 'Statement not found.');
  if v.file_id is not null then
    perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
    perform private.require((select phase from public.cb_files where id = v.file_id) <> 'locked', 'This file is locked.');
  end if;
  return v;
end;
$$;

-- Retry a failed job: back in the queue with 3 new tries.
create or replace function public.statement_retry(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.cb_statement_imports := private.statement_job_for_change(p_id);
begin
  perform private.require(v.status = 'failed', 'Only a statement that failed can be tried again.');
  update public.cb_statement_imports set status = 'queued', attempts = 0, error = null, started_at = null, finished_at = null where id = p_id;
end;
$$;

-- The browser's upload is in storage (the server checked): the job joins the queue.
create or replace function public.statement_confirm_upload(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.cb_statement_imports := private.statement_job_for_change(p_id);
begin
  perform private.require(v.status = 'uploading', 'This statement is already uploaded.');
  update public.cb_statement_imports set status = 'queued' where id = p_id;
  if v.file_id is not null then
    perform private.cb_log(v.file_id, 'statement_uploaded', 'records', 'PDF statement uploaded: ' || v.file_name);
  end if;
end;
$$;

-- The person's working copy (edited lines and statement details), with its summary and status.
create or replace function public.statement_save_edits(p_id uuid, p_edited jsonb, p_summary jsonb, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.cb_statement_imports := private.statement_job_for_change(p_id);
begin
  perform private.require(v.status in ('ready', 'needs_look'), 'This statement cannot be changed now.');
  perform private.require(p_status in ('ready', 'needs_look'), 'Unknown status.');
  perform private.require(jsonb_typeof(p_edited -> 'accounts') = 'array', 'The statement has no accounts.');
  update public.cb_statement_imports set edited = p_edited, summary = p_summary, status = p_status where id = p_id;
end;
$$;

-- Discard a job. A file's job stays as discarded (its cost stays on record); a standalone job is deleted,
-- with a log row. Returns the stored file's path, for the server to remove.
create or replace function public.statement_discard(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v public.cb_statement_imports := private.statement_job_for_change(p_id);
begin
  perform private.require(v.status <> 'imported', 'This statement is imported. Remove it in step 3 instead.');
  if v.file_id is null then
    perform private.statement_tool_logged(v, 'discarded');
    delete from public.cb_statement_imports where id = p_id;
  else
    update public.cb_statement_imports set status = 'discarded', result = null, edited = null, summary = null, finished_at = coalesce(finished_at, now()) where id = p_id;
    perform private.cb_log(v.file_id, 'statement_discarded', 'records', 'PDF statement discarded: ' || v.file_name);
  end if;
  return v.storage_path;
end;
$$;

-- The standalone log row and its activity log line.
create or replace function private.statement_tool_logged(v public.cb_statement_imports, p_outcome text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_log bigint;
begin
  insert into public.statement_tool_log (staff_id, pages, cost_usd, outcome) values (v.created_by, v.pages, v.cost_usd, p_outcome) returning id into v_log;
  insert into public.activity_log (actor_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), 'statement_tool_' || p_outcome, 'statement_tool_log', v_log::text,
          jsonb_build_object('pages', v.pages, 'cost_usd', v.cost_usd, 'staff_id', v.created_by));
end;
$$;

-- Standalone: the download is done. The job and its lines are deleted; a log row stays.
-- Returns the stored file's path, for the server to remove.
create or replace function public.statement_finish_standalone(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v public.cb_statement_imports := private.statement_job_for_change(p_id);
begin
  perform private.require(v.file_id is null, 'This statement belongs to a file.');
  perform private.statement_tool_logged(v, 'downloaded');
  delete from public.cb_statement_imports where id = p_id;
  return v.storage_path;
end;
$$;

-- Import into the file: one statement per account, through cb_upload_bank (the CSV path), all or nothing.
-- p_accounts: [{"key": "a1", "account": uuid or null, "name": "...", "kind": "bank"|"card", "last4": "1234",
--   "opening": 1000.00, "closing": 352.73, "period_start": "2026-01-01", "period_end": "2026-01-31",
--   "rows": [{"line": 1, "date": "2026-01-02", "description": "...", "amount": -12.50}], "check": {...},
--   "edits": {"edited": 0, "added": 0, "deleted": 0}}]
-- p_confirm_dups: the preparer confirmed lines already in the file are real; they go to the reviewer.
create or replace function public.cb_import_statement(p_import uuid, p_accounts jsonb, p_confirm_dups boolean, p_attachment text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.cb_statement_imports := private.statement_job_for_change(p_import);
  a jsonb;
  r jsonb;
  v_out jsonb := '[]'::jsonb;
  v_lines int := 0;
  v_acc uuid;
begin
  perform private.require(v.file_id is not null, 'This statement does not belong to a file.');
  perform private.require(v.status in ('ready', 'needs_look'), 'This statement is not ready to import.');
  perform private.require(jsonb_typeof(p_accounts) = 'array' and jsonb_array_length(p_accounts) >= 1, 'Choose an account for at least one statement.');
  for a in select * from jsonb_array_elements(p_accounts) loop
    r := public.cb_upload_bank(v.file_id, nullif(a ->> 'account', '')::uuid, a ->> 'name', a ->> 'kind', v.file_name,
      (a ->> 'opening')::numeric, (a ->> 'closing')::numeric, a -> 'rows', (a ->> 'period_start')::date, (a ->> 'period_end')::date);
    update public.cb_bank_statements set statement_import_id = v.id, source = 'pdf', converted_by = v.created_by, converted_at = coalesce(v.finished_at, v.created_at),
           model = v.model, pages = v.pages,
           check_result = a -> 'check', edits = a -> 'edits', attachment_path = nullif(p_attachment, '')
     where id = (r ->> 'statement')::uuid;
    v_acc := (r ->> 'account_id')::uuid;
    if coalesce(a ->> 'last4', '') ~ '^[0-9]{1,8}$' then
      update public.cb_bank_accounts set last4 = a ->> 'last4' where id = v_acc and last4 is null;
    end if;
    if coalesce(p_confirm_dups, false) then
      perform public.cb_flag_uploaded_duplicates(v.file_id, (r ->> 'statement')::uuid);
    end if;
    v_lines := v_lines + (r ->> 'lines')::int;
    v_out := v_out || jsonb_build_array(r || jsonb_build_object('key', a ->> 'key'));
  end loop;
  -- Tokens and cost: split across the statements by line count (cost to 4 decimals), any remainder on the
  -- first, so they add up to the job's figures. The job keeps the full figures.
  with s as (select (e ->> 'statement')::uuid as id, (e ->> 'lines')::int as n, o from jsonb_array_elements(v_out) with ordinality x(e, o)),
  sh as (select id, o, floor(coalesce(v.input_tokens, 0)::numeric * n / v_lines)::int as it, floor(coalesce(v.output_tokens, 0)::numeric * n / v_lines)::int as ot,
                round(coalesce(v.cost_usd, 0) * n / v_lines, 4) as c from s),
  tot as (select sum(it) as it, sum(ot) as ot, sum(c) as c from sh)
  update public.cb_bank_statements b set
         input_tokens = case when v.input_tokens is null then null else sh.it + case when sh.o = 1 then v.input_tokens - tot.it else 0 end end,
         output_tokens = case when v.output_tokens is null then null else sh.ot + case when sh.o = 1 then v.output_tokens - tot.ot else 0 end end,
         cost_usd = case when v.cost_usd is null then null else sh.c + case when sh.o = 1 then v.cost_usd - tot.c else 0 end end
    from sh, tot where b.id = sh.id;
  update public.cb_statement_imports set status = 'imported', imported_at = now(), imported_by = (select auth.uid()) where id = v.id;
  perform private.cb_log(v.file_id, 'statement_imported', 'records',
    format('PDF statement imported: %s, %s account%s, %s line%s.', v.file_name, jsonb_array_length(p_accounts),
           case when jsonb_array_length(p_accounts) = 1 then '' else 's' end, v_lines, case when v_lines = 1 then '' else 's' end));
  return v_out;
end;
$$;

-- My day: statements I uploaded that are ready to check or need a look, with the file and client.
create or replace function public.statement_ready_counts() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when not private.can_view('closebook') then jsonb_build_object('ready', 0, 'needs_look', 0, 'files', '[]'::jsonb) else jsonb_build_object(
    'ready', (select count(*) from public.cb_statement_imports where created_by = (select auth.uid()) and status = 'ready'),
    'needs_look', (select count(*) from public.cb_statement_imports where created_by = (select auth.uid()) and status = 'needs_look'),
    'files', coalesce((select jsonb_agg(jsonb_build_object('fileId', x.file_id, 'client', x.client, 'n', x.n) order by x.client)
       from (select i.file_id, c.legal_name as client, count(*) as n
               from public.cb_statement_imports i join public.cb_files f on f.id = i.file_id join public.clients c on c.id = f.client_id
              where i.created_by = (select auth.uid()) and i.status in ('ready', 'needs_look')
              group by i.file_id, c.legal_name) x), '[]'::jsonb)) end
$$;

-- ---------- 6. The runner (secret key only)

-- Claim up to p_limit queued jobs, keeping at most 3 reading across the firm. A job reading for more than
-- 10 minutes counts as queued again (its runner stopped); after 3 tries it fails.
create or replace function public.statement_claim_jobs(p_limit int default 3)
returns setof public.cb_statement_imports language plpgsql security definer set search_path = '' as $$
declare v_slots int;
begin
  perform pg_advisory_xact_lock(hashtext('statement_claim_jobs'));
  update public.cb_statement_imports set status = 'failed', finished_at = now(),
         error = 'The statement could not be read after 3 tries. Try again, or upload a CSV instead.'
   where status = 'reading' and started_at < now() - interval '10 minutes' and attempts >= 3;
  update public.cb_statement_imports set status = 'queued', started_at = null
   where status = 'reading' and started_at < now() - interval '10 minutes';
  v_slots := least(greatest(coalesce(p_limit, 3), 0), 3 - (select count(*) from public.cb_statement_imports where status = 'reading')::int);
  if v_slots <= 0 then return; end if;
  return query
    with c as (select id from public.cb_statement_imports where status = 'queued' order by created_at, id limit v_slots for update skip locked)
    update public.cb_statement_imports i set status = 'reading', attempts = i.attempts + 1, started_at = now(), finished_at = null
      from c where i.id = c.id returning i.*;
end;
$$;

-- The read is done: the result, its summary and status ('ready' or 'needs_look'), and what it cost.
-- Tokens and cost add up over the tries. p_storage_path / p_media_type: the photo converted to JPEG.
create or replace function public.statement_finish_job(p_id uuid, p_status text, p_result jsonb, p_summary jsonb, p_pages int, p_model text,
  p_input int, p_output int, p_cost numeric, p_storage_path text, p_media_type text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v public.cb_statement_imports;
begin
  perform private.require(p_status in ('ready', 'needs_look'), 'Unknown status.');
  update public.cb_statement_imports set status = p_status, result = p_result, summary = p_summary, pages = coalesce(p_pages, pages), model = p_model,
         input_tokens = coalesce(input_tokens, 0) + coalesce(p_input, 0), output_tokens = coalesce(output_tokens, 0) + coalesce(p_output, 0),
         cost_usd = coalesce(cost_usd, 0) + coalesce(p_cost, 0), finished_at = now(), error = null,
         storage_path = coalesce(p_storage_path, storage_path), media_type = coalesce(p_media_type, media_type)
   where id = p_id and status = 'reading' returning * into v;
  if v.id is not null and v.file_id is not null then
    perform private.cb_log(v.file_id, 'statement_read', 'records', format('PDF statement read: %s (%s).', v.file_name, case p_status when 'ready' then 'ready to check' else 'needs a look' end));
  end if;
  return v.id is not null;
end;
$$;

-- The read failed. p_retry: back in the queue while it has tries left (a passing problem). Any cost is kept.
create or replace function public.statement_fail_job(p_id uuid, p_error text, p_retry boolean, p_pages int, p_model text, p_input int, p_output int, p_cost numeric)
returns text language plpgsql security definer set search_path = '' as $$
declare v public.cb_statement_imports;
begin
  update public.cb_statement_imports set
         status = case when coalesce(p_retry, false) and attempts < 3 then 'queued' else 'failed' end,
         started_at = case when coalesce(p_retry, false) and attempts < 3 then null else started_at end,
         finished_at = case when coalesce(p_retry, false) and attempts < 3 then null else now() end,
         error = left(coalesce(p_error, 'The statement could not be read.'), 500),
         pages = coalesce(p_pages, pages), model = coalesce(p_model, model),
         input_tokens = case when p_input is null then input_tokens else coalesce(input_tokens, 0) + p_input end,
         output_tokens = case when p_output is null then output_tokens else coalesce(output_tokens, 0) + p_output end,
         cost_usd = case when p_cost is null then cost_usd else coalesce(cost_usd, 0) + p_cost end
   where id = p_id and status = 'reading' returning * into v;
  return v.status;
end;
$$;

-- Standalone jobs left over 24 hours are deleted, with a log row; so are uploads never confirmed (no log
-- row: nothing was read). Returns the stored files' paths.
create or replace function public.statement_purge_standalone() returns setof text
language plpgsql security definer set search_path = '' as $$
declare v public.cb_statement_imports;
begin
  for v in select * from public.cb_statement_imports where file_id is null and status <> 'uploading' and created_at < now() - interval '24 hours' for update skip locked loop
    perform private.statement_tool_logged(v, 'expired');
    delete from public.cb_statement_imports where id = v.id;
    return next v.storage_path;
  end loop;
  for v in select * from public.cb_statement_imports where status = 'uploading' and created_at < now() - interval '24 hours' for update skip locked loop
    delete from public.cb_statement_imports where id = v.id;
    return next v.storage_path;
  end loop;
end;
$$;

revoke all on function private.statement_job_for_change(uuid), private.statement_tool_logged(public.cb_statement_imports, text),
  private.statement_new_job(uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.statement_begin_upload(uuid, uuid, text, text, text), public.statement_confirm_upload(uuid) from public, anon;
grant execute on function public.statement_begin_upload(uuid, uuid, text, text, text), public.statement_confirm_upload(uuid) to authenticated;
revoke all on function public.statement_create_job(uuid, uuid, text, text, text), public.statement_retry(uuid), public.statement_save_edits(uuid, jsonb, jsonb, text),
  public.statement_discard(uuid), public.statement_finish_standalone(uuid), public.cb_import_statement(uuid, jsonb, boolean, text), public.statement_ready_counts() from public, anon;
grant execute on function public.statement_create_job(uuid, uuid, text, text, text), public.statement_retry(uuid), public.statement_save_edits(uuid, jsonb, jsonb, text),
  public.statement_discard(uuid), public.statement_finish_standalone(uuid), public.cb_import_statement(uuid, jsonb, boolean, text), public.statement_ready_counts() to authenticated;
revoke all on function public.statement_claim_jobs(int), public.statement_finish_job(uuid, text, jsonb, jsonb, int, text, int, int, numeric, text, text),
  public.statement_fail_job(uuid, text, boolean, int, text, int, int, numeric), public.statement_purge_standalone() from public, anon, authenticated;
grant execute on function public.statement_claim_jobs(int), public.statement_finish_job(uuid, text, jsonb, jsonb, int, text, int, int, numeric, text, text),
  public.statement_fail_job(uuid, text, boolean, int, text, int, int, numeric), public.statement_purge_standalone() to service_role;
