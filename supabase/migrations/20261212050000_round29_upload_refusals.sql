-- Round 29 (Hashim, Nov 17, 2026): the upload window shows the result of the upload just done, only; it opens
-- clean. A refusal is kept in the file's History, with who, when, the file and the reason ("Upload refused"),
-- and nothing else is kept from it. statement_refuse logs the refusal and, by default, removes the upload as
-- statement_discard does (one History line, not two). Safe to run twice.
create or replace function public.statement_refuse(p_id uuid, p_reason text, p_discard boolean default true) returns text
language plpgsql security definer set search_path = '' as $$
declare v public.cb_statement_imports := private.statement_job_for_change(p_id);
begin
  perform private.require(v.file_id is not null, 'This statement does not belong to a file.');
  perform private.require(v.status <> 'imported', 'This statement is imported. Exclude it in View statements instead.');
  perform private.cb_log_event(v.file_id, 'upload_refused', 'records', 'Upload refused', null, null, v.file_name,
    left(btrim(coalesce(p_reason, '')), 300), '', '', v.id);
  if coalesce(p_discard, true) then
    update public.cb_statement_imports set status = 'discarded', result = null, edited = null, summary = null, finished_at = coalesce(finished_at, now()) where id = p_id;
    return v.storage_path;
  end if;
  return null;
end;
$$;
revoke all on function public.statement_refuse(uuid, text, boolean) from public, anon;
grant execute on function public.statement_refuse(uuid, text, boolean) to authenticated;
