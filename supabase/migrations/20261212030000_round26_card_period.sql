-- Round 26 (Hashim, Nov 17, 2026): a card statement was refused on Live with a raw database error
-- ("violates check constraint cb_bank_statements_period"). A card line's date is the purchase date, and a
-- purchase can come a day or two before the statement period starts (bought on the 16th, posted on the 18th,
-- statement from the 18th). The period check now uses the posting date when the statement prints one, so the
-- statement is judged by the days it covers. The purchase date stays the line's date (the year cut-off and the
-- bank feed use it, as round 22 decided). A line still outside the period is refused in plain words, before the
-- insert, naming the date. Nothing else changes. Safe to run twice: the patch checks for its own text.
do $$
declare
  d text;
  k_loop text := $k$    v_first := least(v_first, v_d); v_last := greatest(v_last, v_d);$k$;
  r_loop text := $k$    -- Round 26: the period is checked on the posting date when printed (a card's purchase can come first).
    v_first := least(v_first, coalesce(nullif(v_row ->> 'posted', '')::date, v_d)); v_last := greatest(v_last, coalesce(nullif(v_row ->> 'posted', '')::date, v_d));$k$;
  k_bal text := $k$  -- The whole statement must balance, to the cent.$k$;
  r_bal text := $k$  -- Round 26: every line inside the statement period, said in plain words.
  perform private.require(v_first >= p_period_start and v_last <= p_period_end, format(
    'A line is dated outside the statement period (%s to %s): the lines run from %s to %s. Check the dates in Fix it.',
    to_char(p_period_start, 'Mon FMDD, YYYY'), to_char(p_period_end, 'Mon FMDD, YYYY'), to_char(v_first, 'Mon FMDD, YYYY'), to_char(v_last, 'Mon FMDD, YYYY')));
$k$;
begin
  d := pg_get_functiondef('private.cb_add_statement(uuid, uuid, text, numeric, numeric, jsonb, date, date, numeric, numeric, text)'::regprocedure);
  if position('Round 26' in d) > 0 then return; end if;
  if position(k_loop in d) = 0 or position(k_bal in d) = 0 then
    raise exception 'cb_add_statement: the text to patch was not found.';
  end if;
  d := replace(d, k_loop, r_loop);
  d := replace(d, k_bal, r_bal || k_bal);
  execute d;
end $$;

-- ---------- The cardholder's last digits on each line, as information only (a business card lists each cardholder
-- in its own section; all belong to the statement's account).
alter table public.cb_bank_lines add column if not exists card_last4 text;
do $$
declare
  d text;
  k_cols text := $k$  insert into public.cb_bank_lines (statement_id, file_id, account_id, row_no, txn_date, posted_date, description, amount)
  select v_stmt, p_file, v_acc.id, coalesce((r ->> 'line')::int, 0), (r ->> 'date')::date, nullif(r ->> 'posted', '')::date, btrim(r ->> 'description'), (r ->> 'amount')::numeric$k$;
  r_cols text := $k$  insert into public.cb_bank_lines (statement_id, file_id, account_id, row_no, txn_date, posted_date, description, amount, card_last4)
  select v_stmt, p_file, v_acc.id, coalesce((r ->> 'line')::int, 0), (r ->> 'date')::date, nullif(r ->> 'posted', '')::date, btrim(r ->> 'description'), (r ->> 'amount')::numeric,
         nullif(left(regexp_replace(coalesce(r ->> 'holder', ''), '\D', '', 'g'), 8), '')$k$;
begin
  d := pg_get_functiondef('private.cb_add_statement(uuid, uuid, text, numeric, numeric, jsonb, date, date, numeric, numeric, text)'::regprocedure);
  if position('card_last4' in d) > 0 then return; end if;
  if position(k_cols in d) = 0 then raise exception 'cb_add_statement: the insert to patch was not found.'; end if;
  execute replace(d, k_cols, r_cols);
end $$;

-- ---------- Before import, in the fix screen: what the person adds, removes or has read again is logged with who
-- and the values ("Added before import"). Only for a statement of a file that is not imported yet.
create or replace function public.cb_statement_note(p_import uuid, p_action text, p_detail text, p_ref text, p_reason text, p_old text, p_new text) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.cb_statement_imports := private.statement_job_for_change(p_import);
begin
  perform private.require(v.file_id is not null, 'This statement does not belong to a file.');
  perform private.require(p_action in ('line_added_before_import', 'line_removed_before_import', 'line_changed_before_import'), 'Unknown change.');
  perform private.require(v.status in ('ready', 'needs_look'), 'This statement is already imported: its lines can no longer change here.');
  perform private.cb_log_event(v.file_id, p_action, 'records', p_detail, null, null, p_ref, coalesce(p_reason, ''), coalesce(p_old, ''), coalesce(p_new, ''), v.id);
end;
$$;
revoke all on function public.cb_statement_note(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.cb_statement_note(uuid, text, text, text, text, text, text) to authenticated;

-- ---------- "Read again": the same stored file goes back to the reader; the lines read and any changes made before
-- import are replaced when it finishes. Not for an imported statement (round 24: after import nothing changes).
create or replace function public.statement_read_again(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.cb_statement_imports := private.statement_job_for_change(p_id);
begin
  perform private.require(v.file_id is not null, 'This statement does not belong to a file.');
  perform private.require(v.status in ('ready', 'needs_look', 'failed'), case when v.status = 'imported' then 'This statement is imported: it is not read again.'
    else 'This statement is still being read.' end);
  perform private.require(v.replaces_statement is null, 'This file replaces a statement''s file: it is not read for lines.');
  update public.cb_statement_imports set status = 'queued', attempts = 0, error = null, started_at = null, finished_at = null, edited = null where id = p_id;
  perform private.cb_log_event(v.file_id, 'statement_read_again', 'records', 'Statement read again: the lines read and any changes before import are replaced.', null, null,
    v.file_name, '', coalesce(v.summary ->> 'lines', '') || ' lines read', '', v.id);
end;
$$;
revoke all on function public.statement_read_again(uuid) from public, anon;
grant execute on function public.statement_read_again(uuid) to authenticated;
