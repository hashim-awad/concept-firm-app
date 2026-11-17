-- Round 34 (Hashim, Nov 17, 2026): a sign-off is removed only when what it signed changes.
--   * 3.2 Bank feeds and 3.3 Reconcile are removed only by a change to an account's statements or bank lines
--     (a statement imported, excluded, restored or replaced; a line added or removed with its statement) or an
--     outstanding item (3.3). Never by step 4 work: a memo (internal note), the accounting date, a client
--     question or answer, coding, posting, Undo, a transfer pair, a rule or an exclusion.
--     Cause on Live: step 4 saved the internal note with cb_set_line_memo(..., p_confirm => true), and that
--     function guarded 3.2 and 3.3, so the save removed both without asking. The accounting date did the same.
--   * Step 3 on a bank file follows its sub-steps only: a statement change clears 3.2 and 3.3, and step 3 with
--     them, never step 3 alone while 3.1, 3.2 and 3.3 stay signed.
--   * History says which sub-steps and why: "3.2 and 3.3 sign-offs removed: statement excluded".
-- No data is changed: sign-offs already removed stay removed (Hashim signs them again). Never drops a table or
-- column. Safe to run twice.

-- ---------- 1. Step 4 work never touches 3.2 or 3.3. p_confirm stays in the signature; it is no longer needed.
create or replace function public.cb_set_line_memo(p_line uuid, p_memo text, p_confirm boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare v_line public.cb_bank_lines; v_file public.cb_files;
  v_memo text := btrim(regexp_replace(regexp_replace(coalesce(p_memo, ''), E'\r\n?', E'\n', 'g'), '[ \t]+', ' ', 'g'));
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_line from public.cb_bank_lines where id = p_line;
  perform private.require(v_line.id is not null, 'Line not found.');
  select * into v_file from public.cb_files where id = v_line.file_id for update;
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(length(v_memo) <= 2000, 'Keep the internal note under 2,000 characters.');
  if v_memo = v_line.memo then return; end if;
  update public.cb_bank_lines set memo = v_memo where id = p_line;
end;
$$;
revoke all on function public.cb_set_line_memo(uuid, text, boolean) from public, anon;
grant execute on function public.cb_set_line_memo(uuid, text, boolean) to authenticated;

-- The accounting date (📅) is step 4's: the bank's own date never changes, so 3.2 and 3.3 stay. A coded line's
-- new date still clears step 4 (trigger cb_changed_line_date), as before.
create or replace function public.cb_set_line_date(p_line uuid, p_date date, p_confirm boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare v_line public.cb_bank_lines; v_file public.cb_files;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_line from public.cb_bank_lines where id = p_line;
  perform private.require(v_line.id is not null, 'Line not found.');
  select * into v_file from public.cb_files where id = v_line.file_id for update;
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(p_date is not null and p_date between v_file.year_start and v_file.year_end, 'Outside the year. Use an entry to move it to another year.');
  if p_date = v_line.acct_date then return; end if;
  update public.cb_bank_lines set acct_date = p_date where id = p_line;
end;
$$;
revoke all on function public.cb_set_line_date(uuid, date, boolean) from public, anon;
grant execute on function public.cb_set_line_date(uuid, date, boolean) to authenticated;

-- ---------- 2. History names the sub-steps and the reason.
create or replace function private.cb_substep_label(p_subs text[]) returns text
language sql immutable set search_path = '' as $$
  select case cardinality(p_subs) when 0 then '' when 1 then p_subs[1] || ' sign-off'
    when 2 then p_subs[1] || ' and ' || p_subs[2] || ' sign-offs'
    else p_subs[1] || ', ' || p_subs[2] || ' and ' || p_subs[3] || ' sign-offs' end;
$$;
revoke all on function private.cb_substep_label(text[]) from public, anon, authenticated;

create or replace function private.cb_clear_substeps(p_file uuid, p_subs text[], p_why text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_gone text[]; v_why text := btrim(coalesce(p_why, ''));
begin
  with d as (delete from public.cb_substep_signoffs where file_id = p_file and substep = any (p_subs) returning substep)
  select array_agg(substep order by substep) into v_gone from d;
  if v_gone is not null then
    v_why := lower(left(v_why, 1)) || substr(v_why, 2);
    perform private.cb_log_event(p_file, 'signoff_cleared', 'records', format('%s removed: %s', private.cb_substep_label(v_gone), v_why),
      null, null, '', v_why, array_to_string(v_gone, ', ') || ' signed', 'not signed');
    perform private.cb_records_follow(p_file);
  end if;
end;
$$;
revoke all on function private.cb_clear_substeps(uuid, text[], text) from public, anon, authenticated;

create or replace function private.cb_substep_guard(p_file uuid, p_subs text[], p_confirm boolean, p_what text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_subs text[]; v_rev boolean; v_label text; v_file public.cb_files; v_me uuid := (select auth.uid());
begin
  select array_agg(substep order by substep), bool_or(reviewed_at is not null) into v_subs, v_rev
    from public.cb_substep_signoffs where file_id = p_file and substep = any (p_subs) and prepared_at is not null;
  if v_subs is null then return; end if;
  v_label := case array_length(v_subs, 1) when 1 then v_subs[1] when 2 then v_subs[1] || ' and ' || v_subs[2] else v_subs[1] || ', ' || v_subs[2] || ' and ' || v_subs[3] end;
  select * into v_file from public.cb_files where id = p_file;
  if v_rev and not (private.is_owner() or v_me = v_file.reviewer_id
      or exists (select 1 from public.cb_substep_signoffs where file_id = p_file and substep = any (v_subs) and reviewed_by = v_me)) then
    raise exception 'Ask the reviewer to remove the % sign-off.', v_label using errcode = '42501';
  end if;
  if not coalesce(p_confirm, false) then
    raise exception 'This removes the sign-off on %. Continue?', v_label using errcode = '42501';
  end if;
  delete from public.cb_substep_signoffs where file_id = p_file and substep = any (v_subs);
  perform private.cb_log_event(p_file, 'signoff_removed', 'records', format('%s removed: %s', private.cb_substep_label(v_subs), p_what),
    null, null, '', p_what, v_label || ' signed', 'not signed');
  perform private.cb_records_follow(p_file);
end;
$$;
revoke all on function private.cb_substep_guard(uuid, text[], boolean, text) from public, anon, authenticated;

-- ---------- 3. On a bank file, a statement change clears 3.2 and 3.3 (and step 3 follows), never step 3 alone.
do $$
declare d text;
  k text := 'perform private.cb_clear_step(v_file, v_step, coalesce(nullif(v_txt, ''''), v_why));';
  r text := 'if v_step = ''records'' and exists (select 1 from public.cb_files where id = v_file and books in (''statements'', ''paper'')) then
    perform private.cb_clear_substeps(v_file, array[''3.2'', ''3.3''], coalesce(nullif(v_txt, ''''), v_why));   -- round 34
  else
    perform private.cb_clear_step(v_file, v_step, coalesce(nullif(v_txt, ''''), v_why));
  end if;';
begin
  d := pg_get_functiondef('private.cb_changed()'::regprocedure);
  if position('-- round 34' in d) > 0 then return; end if;
  if position(k in d) = 0 then raise exception 'round 34: cb_changed has changed; update this migration.'; end if;
  execute replace(d, k, r);
end $$;
revoke all on function private.cb_changed() from public, anon, authenticated;
