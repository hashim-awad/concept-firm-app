-- Round 30 (Hashim, Nov 17, 2026): card statements refused because a second cardholder's purchases were dated
-- before the statement period. The period is the one printed in the statement's header; the posting date decides
-- that a line sits inside it; the purchase date stays the line's date and decides the year. A card line read
-- without its posting date is still printed on this statement, so it posted inside the period: a purchase date up
-- to 31 days before the period start is accepted (more is a misread and is refused in plain words, as before).
-- And an import that does not go through is never silent: the statement becomes "To fix" with its reason
-- (cb_statement_imports.error), logged in History; a change in Fix it clears the reason. Safe to run twice.
do $$
declare d text;
  k text := $k$coalesce(nullif(v_row ->> 'posted', '')::date, nullif(v_row ->> 'printed', '')::date, v_d)$k$;
  r text := $k$coalesce(nullif(v_row ->> 'posted', '')::date, nullif(v_row ->> 'printed', '')::date,
      /* Round 30: a card purchase read without its posting date */ case when v_acc.kind = 'card' and v_d < p_period_start and v_d >= p_period_start - 31 then p_period_start else v_d end)$k$;
begin
  d := pg_get_functiondef('private.cb_add_statement(uuid, uuid, text, numeric, numeric, jsonb, date, date, numeric, numeric, text)'::regprocedure);
  if position('Round 30' in d) > 0 then return; end if;
  if position(k in d) = 0 then raise exception 'cb_add_statement: the text to patch was not found.'; end if;
  execute replace(d, k, r);
end $$;

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
  -- Round 30: read but not imported: "To fix", with the reason, until the person changes it or reads it again.
  update public.cb_statement_imports set status = 'needs_look', error = left(btrim(coalesce(p_reason, '')), 300) where id = p_id and status in ('ready', 'needs_look');
  return null;
end;
$$;
revoke all on function public.statement_refuse(uuid, text, boolean) from public, anon;
grant execute on function public.statement_refuse(uuid, text, boolean) to authenticated;

do $$
declare d text;
  k text := $k$update public.cb_statement_imports set edited = p_edited, summary = p_summary, status = p_status where id = p_id;$k$;
  r text := $k$update public.cb_statement_imports set edited = p_edited, summary = p_summary, status = p_status, error = null where id = p_id;$k$;
begin
  d := pg_get_functiondef('public.statement_save_edits(uuid, jsonb, jsonb, text)'::regprocedure);
  if position('error = null' in d) > 0 then return; end if;
  if position(k in d) = 0 then raise exception 'statement_save_edits: the text to patch was not found.'; end if;
  execute replace(d, k, r);
end $$;
