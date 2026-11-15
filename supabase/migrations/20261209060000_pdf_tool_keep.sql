-- Bank statement PDF to CSV, fix (Hashim, Nov 15, 2026): a download no longer deletes the statement.
-- Each statement can be downloaded as CSV and Excel any number of times; "Done" deletes every statement
-- on the person's page at once; anything not cleared is deleted 24 hours after it was converted.
-- Still no client file, and the record keeps only who, when, pages and cost (statement_tool_log).
-- Safe to run twice.

-- When a standalone statement was first downloaded (so "Done" logs it as downloaded, not discarded).
alter table public.cb_statement_imports add column if not exists downloaded_at timestamptz;

-- A download happened: the statement stays. Only the person's own standalone statements.
create or replace function public.statement_mark_downloaded(p_ids uuid[]) returns int
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  perform private.require(private.can_view('closebook'), 'You need Closebook to download statements.');
  update public.cb_statement_imports set downloaded_at = coalesce(downloaded_at, now())
   where id = any(coalesce(p_ids, '{}')) and file_id is null and created_by = (select auth.uid());
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- "Done": every standalone statement of the person is deleted, each with its log row (downloaded or
-- discarded). Uploads never confirmed go too, with no log row. Returns the stored files' paths, for the
-- server to remove.
create or replace function public.statement_done_standalone() returns setof text
language plpgsql security definer set search_path = '' as $$
declare v public.cb_statement_imports;
begin
  perform private.require(private.can_view('closebook'), 'You need Closebook to use the statement tool.');
  for v in select * from public.cb_statement_imports where file_id is null and created_by = (select auth.uid()) for update loop
    if v.status <> 'uploading' then
      perform private.statement_tool_logged(v, case when v.downloaded_at is not null then 'downloaded' else 'discarded' end);
    end if;
    delete from public.cb_statement_imports where id = v.id;
    return next v.storage_path;
  end loop;
end;
$$;

-- 24 hours after it was converted (read), or after it was uploaded when it was never read.
create or replace function public.statement_purge_standalone() returns setof text
language plpgsql security definer set search_path = '' as $$
declare v public.cb_statement_imports;
begin
  for v in select * from public.cb_statement_imports where file_id is null and status <> 'uploading'
             and coalesce(finished_at, created_at) < now() - interval '24 hours' for update skip locked loop
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

-- The log's outcome can now be 'discarded' from Done as well (it already allowed it from Discard).
revoke all on function public.statement_mark_downloaded(uuid[]), public.statement_done_standalone() from public, anon;
grant execute on function public.statement_mark_downloaded(uuid[]), public.statement_done_standalone() to authenticated;
revoke all on function public.statement_purge_standalone() from public, anon, authenticated;
grant execute on function public.statement_purge_standalone() to service_role;
