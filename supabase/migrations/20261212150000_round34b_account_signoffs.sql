-- Round 34b (Hashim, Nov 17, 2026): which 3.x sign-offs an account change removes.
--   * An account's opening balance (balance at last year end) feeds the reconcile: it removes 3.1 and 3.3, never 3.2.
--   * Its GIFI line, T2 line, chart account or last four digits remove 3.1 only, never 3.2 or 3.3.
--   * Unchanged: an account added or removed removes 3.1 and 3.3; its months remove 3.2 and 3.3; an outstanding item 3.3.
--   History and the pill name the reason ("3.1 sign-off removed: GIFI line changed").
-- No data is changed. Never drops a table or column. Safe to run twice.

-- ---------- 0. History's reason starts lower case, except a word in capitals ("GIFI line changed", "T2 line changed").
create or replace function private.cb_clear_substeps(p_file uuid, p_subs text[], p_why text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_gone text[]; v_why text := btrim(coalesce(p_why, ''));
begin
  with d as (delete from public.cb_substep_signoffs where file_id = p_file and substep = any (p_subs) returning substep)
  select array_agg(substep order by substep) into v_gone from d;
  if v_gone is not null then
    if substr(v_why, 2, 1) ~ '[a-z]' then v_why := lower(left(v_why, 1)) || substr(v_why, 2); end if;
    perform private.cb_log_event(p_file, 'signoff_cleared', 'records', format('%s removed: %s', private.cb_substep_label(v_gone), v_why),
      null, null, '', v_why, array_to_string(v_gone, ', ') || ' signed', 'not signed');
    perform private.cb_records_follow(p_file);
  end if;
end;
$$;
revoke all on function private.cb_clear_substeps(uuid, text[], text) from public, anon, authenticated;

-- "a", "a and b", "a, b and c".
create or replace function private.cb_list_words(p text[]) returns text
language sql immutable set search_path = '' as $$
  select case when cardinality(p) = 0 then '' when cardinality(p) = 1 then p[1]
    else array_to_string(p[1:cardinality(p) - 1], ', ') || ' and ' || p[cardinality(p)] end;
$$;
revoke all on function private.cb_list_words(text[]) from public, anon, authenticated;

-- ---------- 1. The trigger behind every account change follows the same split.
create or replace function private.cb_banking_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_file uuid := coalesce(new.file_id, old.file_id); v_what text[];
begin
  if not exists (select 1 from public.cb_substep_signoffs where file_id = v_file) then return coalesce(new, old); end if;
  if tg_table_name = 'cb_bank_accounts' then
    if tg_op = 'INSERT' then
      perform private.cb_clear_substeps(v_file, array['3.1', '3.3'], 'Account added');
    elsif tg_op = 'DELETE' then
      perform private.cb_clear_substeps(v_file, array['3.1', '3.3'], 'Account removed');
    else
      if new.books_opening is distinct from old.books_opening then
        perform private.cb_clear_substeps(v_file, array['3.1', '3.3'], 'Opening balance changed');
      end if;
      v_what := array_remove(array[
        case when new.gifi_line is distinct from old.gifi_line then 'GIFI line' end,
        case when new.t2_line is distinct from old.t2_line then 'T2 line' end,
        case when new.chart_account is distinct from old.chart_account then 'chart account' end,
        case when new.last4 is distinct from old.last4 then 'last four digits' end], null);
      if cardinality(v_what) > 0 then
        perform private.cb_clear_substeps(v_file, array['3.1'], private.cb_list_words(v_what) || ' changed');
      end if;
      if new.opened_on is distinct from old.opened_on or new.closed_on is distinct from old.closed_on or new.coverage_note is distinct from old.coverage_note then
        perform private.cb_clear_substeps(v_file, array['3.2', '3.3'], 'Account''s months changed');
      end if;
    end if;
  elsif tg_table_name = 'cb_bank_statements' then
    perform private.cb_clear_substeps(v_file, array['3.2', '3.3'], case when tg_op = 'DELETE' then 'A statement was deleted' else 'A statement was added' end);
  elsif tg_table_name = 'cb_bank_outstanding' then
    perform private.cb_clear_substeps(v_file, array['3.3'], 'An outstanding item changed');
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function private.cb_banking_changed() from public, anon, authenticated;

-- ---------- 2. Saving an account asks first for exactly those sign-offs, with the reason.
do $$
declare d text;
  k1 text := 'perform private.cb_substep_guard(p_file, array[''3.1'', ''3.2'', ''3.3''], p_confirm, ''balance at last year end changed'');';
  r1 text := 'perform private.cb_substep_guard(p_file, array[''3.1'', ''3.3''], p_confirm, ''opening balance changed'');   -- round 34b';
  k2 text := 'perform private.cb_substep_guard(p_file, array[''3.1'', ''3.3''], p_confirm, case when v_acc.t2_line is distinct from v_t2 then ''last year''''s T2 line changed'' else ''account changed'' end);';
  r2 text := 'perform private.cb_substep_guard(p_file, array[''3.1''], p_confirm, private.cb_list_words(array_remove(array[
        case when v_acc.gifi_line is distinct from p.gifi_line then ''GIFI line'' end,
        case when v_acc.t2_line is distinct from v_t2 then ''T2 line'' end,
        case when v_acc.chart_account is distinct from p.chart_account then ''chart account'' end,
        case when v_acc.last4 is distinct from v_last then ''last four digits'' end], null)) || '' changed'');';
begin
  d := pg_get_functiondef('public.cb_save_bank_account(uuid, uuid, text, text, text, numeric, boolean, boolean, boolean, text)'::regprocedure);
  if position('-- round 34b' in d) > 0 then return; end if;
  if position(k1 in d) = 0 or position(k2 in d) = 0 then raise exception 'round 34b: cb_save_bank_account has changed; update this migration.'; end if;
  execute replace(replace(d, k1, r1), k2, r2);
end $$;
