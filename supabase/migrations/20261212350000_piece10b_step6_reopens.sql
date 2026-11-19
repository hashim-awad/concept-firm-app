-- Piece 10b, version 1 (Hashim, Nov 19, 2026; benchmark CaseWare Cloud: a signed analytical review is marked changed when its
-- balances move): step 6 "Compare to last year" reopens on late changes.
--   * A change that moves balances clears step 6: an AJE or RJE added or deleted, its lines changed, or its type or date
--     changed; a step 4 coding change; a trial balance import; an opening balance change; on bank and card files, statement
--     lines or statements added or removed and an account's opening balance changed, even when step 3 is not fully signed.
--     Steps 7 and 8 clear through the chain as before; step 5's own rules are unchanged.
--   * Unchanged: a TJE clears step 8 only; explanations, ticks and answers clear steps 6 and 7; GIFI line, tax code and type
--     changes clear steps 6, 7 and 8 (and step 4 on trial balance files); the owner's decision on an account sent to the
--     reviewer clears nothing; a revenue check or an entry's note, reason, W/P ref or attachments leave step 6 signed.
--   * An entry edited without changing its lines (a note, reason, W/P ref or attachments) leaves step 6 signed.
--   * A posted line split again clears steps 4, 6, 7 and 8 (a coding change); a bank account's chart account changed reopens step 6.
--   * Step 6's refusal: "N flagged change(s) to explain in Flagged changes."
-- Functions only (each as on main, with the piece 10b lines). No table or column is dropped. No data is changed: nothing is
-- cleared when this runs; a sign-off is cleared only by a later change, with its reason in History. Safe to run twice.

CREATE OR REPLACE FUNCTION private.cb_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_file uuid;
  v_step text := tg_argv[0];
  v_why text := tg_argv[1];
  v_bank boolean;
  v_row record;
  v_txt text;
  v_verb text := case tg_op when 'INSERT' then 'added' when 'DELETE' then 'removed' else 'changed' end;
  v_tje boolean := false;   -- piece 6
  v_moved boolean := false;   -- piece 10b
begin
  if tg_table_name = 'cb_bank_lines' and coalesce(current_setting('cb.review', true), '') = 'on' then return null; end if;   -- round 35
  v_row := case when tg_op = 'DELETE' then old else new end;
  if tg_table_name = 'cb_entry_lines' then
    select e.file_id, format('Entry %s-%s lines %s', to_char(f.year_end, 'YYYY'), lpad(e.seq::text, 3, '0'), v_verb), e.kind = 'TJE' into v_file, v_txt, v_tje
      from public.cb_entries e join public.cb_files f on f.id = e.file_id where e.id = v_row.entry_id;
  elsif tg_table_name = 'cb_files' then
    v_file := v_row.id;
    if v_step = 'setup' then v_txt := private.cb_setup_diff(old.setup, new.setup); end if;
  else
    v_file := v_row.file_id;
  end if;
  if v_file is null then return null; end if;

  if tg_table_name = 'cb_bank_lines' and tg_op = 'UPDATE' then
    -- The reviewer's decision on a line sent to the reviewer: the preparer's sign-off stays.
    if old.status = 'reviewer' and private.is_owner() then return null; end if;
    v_txt := format('%s %s: %s', to_char(new.txn_date, 'Mon FMDD'), left(new.description, 40),
      concat_ws(', ',
        case when old.chart_account is distinct from new.chart_account then format('account %s to %s', coalesce(old.chart_account, 'none'), coalesce(new.chart_account, 'none')) end,
        case when old.acct_date is distinct from new.acct_date then format('date %s to %s', to_char(old.acct_date, 'Mon FMDD'), to_char(new.acct_date, 'Mon FMDD')) end,
        case when old.tax_code is distinct from new.tax_code then format('tax %s to %s', coalesce(old.tax_code, 'none'), coalesce(new.tax_code, 'none')) end,
        case when old.status is distinct from new.status then format('%s to %s',
          case old.status when 'new' then 'to code' when 'done' then 'coded' when 'ask_client' then 'with the client' when 'matched' then 'matched to a transfer' when 'excluded' then 'excluded' else 'for the reviewer' end,
          case new.status when 'new' then 'to code' when 'done' then 'coded' when 'ask_client' then 'with the client' when 'matched' then 'matched to a transfer' when 'excluded' then 'excluded' else 'for the reviewer' end) end));
  elsif tg_table_name = 'cb_bank_lines' then
    v_txt := format('Statement line %s: %s %s', v_verb, to_char(v_row.txn_date, 'Mon FMDD'), left(v_row.description, 40));
  elsif tg_table_name = 'cb_accounts' then
    -- The reviewer's decision on an account waiting for it, or on a line of another type: the sign-off stays.
    if private.is_owner() and (old.needs_reviewer or private.cb_flag_open(old.account_type, old.line_no, old.type_confirm_reason, old.type_confirmed_line)) then
      return null;
    end if;
    v_txt := format('%s: %s', btrim(coalesce(nullif(new.number, '') || ' ', '') || new.name),
      concat_ws(', ',
        case when old.line_no is distinct from new.line_no then format('GIFI %s to %s', coalesce(replace(old.line_no, '.00', ''), 'none'), coalesce(replace(new.line_no, '.00', ''), 'none')) end,
        case when old.tax_code is distinct from new.tax_code then format('tax code %s to %s', coalesce(old.tax_code, 'the line''s default'), coalesce(new.tax_code, 'the line''s default')) end,
        case when old.type_confirm_reason is distinct from new.type_confirm_reason then 'kept on a line of another type' end));
    select books in ('statements', 'paper') into v_bank from public.cb_files where id = v_file;
    -- A trial balance file matches in step 4 and maps in step 7: a line change touches both.
    if not v_bank then perform private.cb_clear_step(v_file, 'code', v_txt); end if;
    -- Piece 10: step 6 no longer chains to step 8, so a GIFI line, tax code or type change clears step 8 here, as before.
    perform private.cb_clear_step(v_file, 't2', v_txt);
  elsif tg_table_name = 'cb_imports' then
    v_step := case v_row.target when 'account_list' then 'compare' when 'last_year' then 'opening' else 'records' end;
    v_txt := format('%s %s (%s)', case v_row.target when 'account_list' then 'QuickBooks Account List' when 'last_year' then 'Last year''s trial balance' else 'Trial balance' end,
      case tg_op when 'INSERT' then 'imported' else 'removed' end, v_row.file_name);
    if v_row.target = 'account_list' then
      perform private.cb_clear_step(v_file, 'code', v_txt);
      perform private.cb_clear_step(v_file, 't2', v_txt);   -- piece 10, as above
    end if;
  elsif tg_table_name = 'cb_bank_statements' then
    select format('Statement %s: %s, %s to %s', v_verb, b.name, to_char(v_row.period_start, 'Mon FMDD, YYYY'), to_char(v_row.period_end, 'Mon FMDD, YYYY')) into v_txt
      from public.cb_bank_accounts b where b.id = v_row.account_id;
  elsif tg_table_name = 'cb_opening_balances' then
    v_txt := format('Last year''s balance sheet: GIFI %s %s', v_row.code, v_verb);
  elsif tg_table_name = 'cb_entries' then
    v_txt := format('Entry %s-%s %s', (select to_char(year_end, 'YYYY') from public.cb_files where id = v_file), lpad(v_row.seq::text, 3, '0'), v_verb);
    -- Piece 6: a TJE added, deleted or changed while it stays a TJE. A change of type to or from TJE is an AJE change.
    v_tje := case when tg_op = 'UPDATE' then old.kind = 'TJE' and new.kind = 'TJE' else v_row.kind = 'TJE' end;
  elsif tg_table_name = 'cb_flag_notes' then
    select format('Lead sheet explanation %s: %s', v_verb, btrim(coalesce(nullif(a.number, '') || ' ', '') || a.name)) into v_txt
      from public.cb_accounts a where a.id = v_row.account_id;
  -- Piece 10: step 6's ticks and answers (step 6), and the reviewer's "Mark reviewed" on them (step 7, by the trigger's step).
  elsif tg_table_name = 'cb_new_accounts' then
    select btrim(coalesce(nullif(a.number, '') || ' ', '') || a.name) into v_txt
      from public.cb_accounts a where a.file_id = v_file and a.account_key = v_row.account_key limit 1;
    v_txt := coalesce(v_txt, v_row.account_key) || case when tg_op = 'INSERT' then ': confirmed as a new account'
      when tg_op = 'DELETE' then ': new account tick removed' when v_step = 'review' then ': review mark changed' else ': confirmed again' end;
  elsif tg_table_name = 'cb_year_changes' then
    v_txt := private.cb_year_question(v_row.question) || case when tg_op = 'DELETE' then ': answer removed' when v_step = 'review' then ': review mark changed' else ': answered' end;
  elsif tg_table_name = 'cb_compare_seen' then
    v_txt := case when tg_op = 'DELETE' then 'Accounts not used this year: Seen removed' else 'Accounts not used this year: Seen ticked' end;
  end if;
  -- Piece 7 (Hashim, Nov 18, 2026): the GST/HST returns figure and its note belong to step 8. A change to them clears step 8,
  -- not step 5. The revenue check itself (step 5) clears step 5 as before.
  -- (Nested: v_row is another table's row on other triggers, so its kind is read only here.)
  if tg_table_name = 'cb_revenue_sources' then
    if v_row.kind = 'gst_returns' then
      perform private.cb_clear_step(v_file, 't2', 'The revenue on the GST/HST returns changed');
      return null;
    end if;
  end if;
  if tg_table_name = 'cb_revenue_checks' then
    if tg_op = 'UPDATE' then
      if old.gst_explanation is distinct from new.gst_explanation then
        perform private.cb_clear_step(v_file, 't2', 'The GST/HST revenue note changed');
      end if;
      if old.explanation is not distinct from new.explanation and old.t4a_explanation is not distinct from new.t4a_explanation
         and old.t4a_none is not distinct from new.t4a_none then
        return null;
      end if;
    elsif tg_op = 'INSERT' then
      if new.gst_explanation <> '' then
        perform private.cb_clear_step(v_file, 't2', 'The GST/HST revenue note changed');
      end if;
      if new.explanation = '' and new.t4a_explanation = '' and not new.t4a_none and new.added_at is null then
        return null;
      end if;
    end if;
  end if;
  -- Piece 6 (Hashim, Nov 18, 2026): a tax entry leaves steps 5, 6 and 7 signed. The final GIFI export is stale, so
  -- step 8 is cleared (and steps 9 and 10 follow), as when step 5's chain cleared it.
  if v_tje and v_step = 'entries' then
    perform private.cb_clear_step(v_file, 't2', coalesce(nullif(v_txt, ''), v_why));
    return null;
  end if;
  if v_step = 'records' and exists (select 1 from public.cb_files where id = v_file and books in ('statements', 'paper')) then
    perform private.cb_clear_substeps(v_file, array['3.2', '3.3'], coalesce(nullif(v_txt, ''), v_why));   -- round 34
    -- Piece 10b: statement lines or statements added or removed move the balances: step 6 reopens even when step 3 is not
    -- fully signed. A statement changed in place (its file replaced, its source) moves nothing.
    if tg_op <> 'UPDATE' then
      perform private.cb_clear_step(v_file, 'compare', coalesce(nullif(v_txt, ''), v_why));
    end if;
  else
    perform private.cb_clear_step(v_file, v_step, coalesce(nullif(v_txt, ''), v_why));
  end if;
  -- Piece 10b (Hashim, Nov 19, 2026): an AJE or RJE that moves a balance reopens step 6: added or deleted, its lines changed,
  -- or its type or date changed. Its note, reason, W/P ref or attachments, and the revenue check, leave step 6 signed.
  -- (Nested: old and new are read only for cb_entries.)
  if v_step = 'entries' then
    if tg_table_name = 'cb_entry_lines' then
      -- cb_edit_entry writes every line again; it clears step 6 itself, only when the lines differ.
      v_moved := coalesce(current_setting('cb.lines_rewrite', true), '') <> 'on';
    elsif tg_table_name = 'cb_entries' then
      if tg_op <> 'UPDATE' then
        v_moved := true;
      elsif old.kind is distinct from new.kind or old.entry_date is distinct from new.entry_date then
        v_moved := true;
      end if;
    end if;
    if v_moved then
      perform private.cb_clear_step(v_file, 'compare', coalesce(nullif(v_txt, ''), v_why));
    end if;
  end if;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION private.cb_clear_step(p_file uuid, p_step text, p_why text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.cb_step_signoffs;
begin
  if not exists (select 1 from public.cb_files where id = p_file) then return; end if;
  delete from public.cb_step_signoffs where file_id = p_file and step = p_step returning * into r;
  if r.file_id is not null then
    perform private.cb_log(p_file, 'signoff_cleared', p_step, p_why);
    if p_step = 'opening' then
      update public.cb_files set opening_signed_by = null, opening_signed_at = null where id = p_file and opening_signed_at is not null;
    end if;
  end if;
  if p_step not in ('review', 't2', 'statements', 'lock') then
    perform private.cb_clear_step(p_file, 'review', 'A step it rests on changed');
  end if;
  -- Piece 10: step 6 (compare) clears step 7 only; a GIFI change clears step 8 in cb_changed.
  -- Piece 10b: a change that moves balances in steps 2, 3 or 4 reopens step 6, with the same reason in History.
  -- (Step 5's balance-moving changes are picked out in cb_changed.)
  if p_step in ('opening', 'records', 'code') then
    perform private.cb_clear_step(p_file, 'compare', p_why);
  end if;
  if p_step in ('opening', 'records', 'code', 'entries') then
    perform private.cb_clear_step(p_file, 't2', 'The trial balance changed after the final export');
  end if;
  if p_step = 't2' then
    perform private.cb_clear_step(p_file, 'statements', 'The trial balance or step 8 changed');
  end if;
  -- Step 10 rests on the package (round 12): a reopened step 9 reopens it, and takes back the MAL.
  if p_step = 'statements' then
    perform private.cb_clear_step(p_file, 'lock', 'Step 9 reopened');
    perform private.cb_withdraw_mal(p_file, coalesce(nullif(p_why, ''), 'Step 9 changed'));
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION private.cb_step_problems(p_file uuid, p_step text)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_file public.cb_files;
  v_bank boolean;
  v_out text[] := '{}';
  v_n int;
  v_txt text;
  v_set jsonb;
  v_flag_amount numeric; v_flag_percent numeric;
begin
  select * into v_file from public.cb_files where id = p_file;
  v_bank := v_file.books in ('statements', 'paper');
  v_set := coalesce(v_file.setup, '{}'::jsonb);
  if p_step = 'setup' then
    select count(*) into v_n from unnest(array['realtor', 'owner_paid', 'dividends', 'payroll', 'holdco', 'gst_registered']) k where not (v_set ? k);
    if (v_set ->> 'gst_registered') = 'true' then
      v_n := v_n + (case when v_set ? 'gst_frequency' then 0 else 1 end) + (case when v_set ? 'quick_method' then 0 else 1 end);
    end if;
    if v_n > 0 then v_out := v_out || format('%s setup question%s to answer.', v_n, case when v_n = 1 then '' else 's' end); end if;
    -- Round 16: the acceptance and continuance record is signed with step 1.
    v_out := v_out || private.cb_acceptance_problems(p_file);
  elsif p_step = 'opening' then
    if v_bank then
      v_out := v_out || private.cb_opening_problems(p_file);
    elsif not exists (select 1 from public.cb_imports where file_id = p_file and target = 'this_year') then
      v_out := v_out || 'Import the trial balance: last year''s column comes with it.'::text;
    end if;
  elsif p_step = 'records' then
    if v_bank then
      -- Round 22: accounts, coverage, waiting statements, the tie to step 2 and the year edges.
      v_out := v_out || private.cb_records_problems(p_file);
    else
      if not exists (select 1 from public.cb_imports where file_id = p_file and target = 'this_year') then
        v_out := v_out || 'Import the trial balance.'::text;
      elsif (select coalesce(sum(this_year), 0) from public.cb_accounts where file_id = p_file) <> 0 then
        v_out := v_out || 'The trial balance does not balance: import it again.'::text;
      end if;
    end if;
  elsif p_step = 'code' then
    if v_bank then
      -- Round 31: Pending lines (some asked of the client), then the excluded lines until the reviewer ticks them.
      select count(*) into v_n from public.cb_bank_lines l where l.file_id = p_file and private.cb_line_pending(l);
      if v_n > 0 then v_out := v_out || format('%s line%s pending.', v_n, case when v_n = 1 then '' else 's' end); end if;
      select count(*) into v_n from public.cb_bank_lines l where l.file_id = p_file and l.status = 'excluded';
      if v_n > 0 and (select excluded_reviewed_key from public.cb_files where id = p_file) is distinct from private.cb_excluded_key(p_file) then
        v_out := v_out || format('Excluded: %s line%s · %s. The reviewer ticks "Excluded lines reviewed".', v_n, case when v_n = 1 then '' else 's' end,
          private.cb_money((select sum(abs(amount)) from public.cb_bank_lines where file_id = p_file and status = 'excluded')));
      end if;
      v_out := v_out || private.cb_code_tie_problems(p_file);
    else
      select count(*) into v_n from public.cb_accounts a where a.file_id = p_file and a.line_no is null and not a.needs_reviewer
         and a.account_key not in ('chart:10900', 'opening', 'uncoded') and private.cb_account_used(a.id);
      if v_n > 0 then v_out := v_out || format('%s account%s to match to a GIFI line.', v_n, case when v_n = 1 then '' else 's' end); end if;
    end if;
  elsif p_step = 'entries' then
    -- Piece 10: the flagged changes are explained in step 6 now.
    -- Round 9: the revenue check, and expenses paid personally when the setup says so.
    v_out := v_out || private.cb_step5_problems(p_file);
  elsif p_step = 'compare' then
    -- Piece 10, step 6 "Compare to last year". a) Every flagged change explained (moved from step 5; the rule is unchanged).
    select flag_amount, flag_percent into v_flag_amount, v_flag_percent from public.cb_settings limit 1;
    v_flag_amount := coalesce(v_flag_amount, 5000); v_flag_percent := coalesce(v_flag_percent, 20);
    select count(*) into v_n from (
      select a.id, private.cb_account_final(a.id) - coalesce((select sum(l.amount) from public.cb_entry_lines l join public.cb_entries e on e.id = l.entry_id
           where l.account_id = a.id and e.kind = 'TJE'), 0) fin, a.last_year from public.cb_accounts a join public.cb_master_lines m on m.line_no = a.line_no
       where a.file_id = p_file and m.lead_sheet is not null and left(coalesce(a.line_no, ''), 4) not in ('3600', '3660')
         and coalesce(a.tax_code, m.default_tax_code, '') not in ('INCTAX', 'AMORT')) x   -- piece 6
     where abs(fin - last_year) > v_flag_amount and (last_year = 0 or abs(fin - last_year) / abs(last_year) * 100 > v_flag_percent)
       and not exists (select 1 from public.cb_flag_notes n where n.account_id = x.id);
    if v_n > 0 then v_out := v_out || format('%s flagged change%s to explain in Flagged changes.', v_n, case when v_n = 1 then '' else 's' end); end if;
    -- The preparer's GIFI checks (moved from the old step 6).
    select count(*) into v_n from public.cb_accounts a where a.file_id = p_file and a.line_no is null and not a.needs_reviewer
       and a.account_key not in ('chart:10900', 'opening', 'uncoded') and private.cb_account_used(a.id);
    if v_n > 0 then v_out := v_out || format('%s account%s with no GIFI line.', v_n, case when v_n = 1 then '' else 's' end); end if;
    if exists (select 1 from public.cb_accounts a where a.file_id = p_file and a.account_key = 'chart:10900' and private.cb_account_final(a.id) <> 0) then
      v_out := v_out || 'Clearing (10900) has a balance: move it to the right account.'::text;
    end if;
    -- b) Every new account confirmed, on the GIFI line it has now.
    select count(*) into v_n from private.cb_compare_accounts(p_file) x where x.kind = 'new'
       and not exists (select 1 from public.cb_new_accounts n where n.file_id = p_file and n.account_key = x.account_key and n.confirmed_line is not distinct from x.line_no);
    if v_n > 0 then v_out := v_out || format('%s new account%s to confirm.', v_n, case when v_n = 1 then '' else 's' end); end if;
    -- c) The accounts not used this year seen.
    v_txt := private.cb_unused_key(p_file);
    if v_txt <> '' and not exists (select 1 from public.cb_compare_seen where file_id = p_file and seen_key = v_txt) then
      v_out := v_out || 'Accounts not used this year: tick Seen.'::text;
    end if;
    -- d) Every question answered.
    select 6 - count(*) into v_n from public.cb_year_changes where file_id = p_file;
    if v_n > 0 then v_out := v_out || format('What changed this year: %s question%s to answer.', v_n, case when v_n = 1 then '' else 's' end); end if;
  end if;
  -- A review note not yet fixed is open work on its step.
  select count(*) into v_n from public.cb_review_notes where file_id = p_file and step = p_step and status = 'open';
  if v_n > 0 then v_out := v_out || format('%s review note%s to fix.', v_n, case when v_n = 1 then '' else 's' end); end if;
  return v_out;
end;
$function$;

CREATE OR REPLACE FUNCTION private.cb_banking_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file uuid := coalesce(new.file_id, old.file_id); v_what text[];
begin
  -- Piece 10b: an account's opening balance, or its chart account, moves the trial balance: step 6 reopens even when no
-- sub-step is signed.
  -- (Nested: books_opening is read only for cb_bank_accounts.)
  if tg_table_name = 'cb_bank_accounts' then
    if tg_op = 'UPDATE' then
      if new.books_opening is distinct from old.books_opening then
        perform private.cb_clear_step(v_file, 'compare', format('%s: opening balance changed', new.name));
      elsif new.chart_account is distinct from old.chart_account or new.number is distinct from old.number then
        -- The account's balance moves to another trial balance row.
        perform private.cb_clear_step(v_file, 'compare', format('%s: chart account changed', new.name));
      end if;
    elsif tg_op = 'INSERT' then
      if coalesce(new.books_opening, 0) <> 0 then perform private.cb_clear_step(v_file, 'compare', format('%s: account added', new.name)); end if;
    else
      if coalesce(old.books_opening, 0) <> 0 then perform private.cb_clear_step(v_file, 'compare', format('%s: account removed', old.name)); end if;
    end if;
  end if;
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
$function$;

-- Piece 10b: cb_edit_entry (as on main) reopens step 6 only when an entry's lines change.
CREATE OR REPLACE FUNCTION public.cb_edit_entry(p_entry uuid, p_kind text, p_reason text, p_note text, p_reverse boolean, p_lines jsonb, p_wp_ref text, p_date date DEFAULT NULL::date, p_standard uuid DEFAULT NULL::uuid, p_attachments text[] DEFAULT '{}'::text[], p_seq integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_e public.cb_entries;
  v_file public.cb_files;
  v_new public.cb_entries;
  v_label text;
  v_old_lines text;
  v_new_lines text;
  v_old_all text; v_new_all text;   -- piece 10b
  v_seq int;
  r record;
begin
  select * into v_e from public.cb_entries where id = p_entry;
  perform private.require(v_e.id is not null, 'Entry not found.');
  perform private.require(coalesce(v_e.origin, '') <> 'expenses_personal', 'Change this entry on the Expenses paid personally paper.');
  -- Piece 3: an amount from a schedule changes only in its schedule (the account may change).
  perform private.require(coalesce(v_e.origin, '') <> 'schedule' or coalesce(current_setting('cb.schedule_save', true), '') = 'on'
    or private.cb_schedule_amounts(p_entry) = private.cb_schedule_amounts_of(p_lines), 'Change this amount in its schedule: click the Schedule tag.');
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  perform private.require(v_e.reviewed_at is null, 'An approved entry cannot be deleted. Add a correcting entry instead.');
  select * into v_file from public.cb_files where id = v_e.file_id for update;
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  perform private.cb_entry_head_check(v_file, p_kind, p_reason, p_note, p_reverse, p_lines, p_wp_ref, p_date, p_attachments);
  v_seq := coalesce(p_seq, v_e.seq);
  perform private.require(v_seq between 1 and 999 and not exists (select 1 from public.cb_entries where file_id = v_e.file_id and seq = v_seq and id <> p_entry),
    format('Entry number %s-%s is taken. Choose another.', to_char(v_file.year_end, 'YYYY'), lpad(v_seq::text, 3, '0')));
  v_label := private.cb_entry_label(p_entry);
  v_old_lines := private.cb_entry_lines_text(p_entry);

  -- The header, in place. The per-type number changes only when the type does (it is unique per type).
  update public.cb_entries set kind = p_kind, reason = p_reason, note = btrim(p_note), reverse_next_year = coalesce(p_reverse, false),
      wp_ref = btrim(p_wp_ref), entry_date = coalesce(p_date, v_file.year_end), attachments = coalesce(p_attachments, '{}'), seq = v_seq,
      number = case when p_kind = v_e.kind then v_e.number else coalesce((select max(number) from public.cb_entries where file_id = v_e.file_id and kind = p_kind), 0) + 1 end,
      needs_review = true, reviewed_by = null, reviewed_at = null
   where id = p_entry
  returning * into v_new;
  -- The lines, written again by the same rules as a new entry.
  -- Piece 10b: the lines' own triggers leave step 6 alone here; step 6 reopens below only when the lines differ
  -- (every line, sales tax lines included: account and amount).
  select coalesce(string_agg(l.account_id::text || ':' || l.amount::text, ',' order by l.account_id, l.amount), '') into v_old_all
    from public.cb_entry_lines l where l.entry_id = p_entry;
  perform set_config('cb.lines_rewrite', 'on', true);
  delete from public.cb_entry_lines where entry_id = p_entry;
  perform private.cb_entry_write_lines(p_entry, v_file, p_kind, p_reason, p_reverse, p_lines);
  perform set_config('cb.lines_rewrite', '', true);
  v_new_lines := private.cb_entry_lines_text(p_entry);
  -- A TJE that stays a TJE clears step 8 only (piece 6); a change of type reopens step 6 through cb_changed.
  select coalesce(string_agg(l.account_id::text || ':' || l.amount::text, ',' order by l.account_id, l.amount), '') into v_new_all
    from public.cb_entry_lines l where l.entry_id = p_entry;
  if v_new_all is distinct from v_old_all and not (v_e.kind = 'TJE' and p_kind = 'TJE') then
    perform private.cb_clear_step(v_e.file_id, 'compare', format('Entry %s changed: lines', private.cb_entry_label(p_entry)));
  end if;

  -- History: one row per thing that changed, with the old and new value.
  for r in select * from (values
      ('Number', v_new.seq = v_e.seq, v_label, private.cb_entry_label(p_entry)),
      ('Type', p_kind = v_e.kind, v_e.kind, p_kind),
      ('Date', v_new.entry_date = v_e.entry_date, to_char(v_e.entry_date, 'Mon FMDD, YYYY'), to_char(v_new.entry_date, 'Mon FMDD, YYYY')),
      ('Description', v_new.note = v_e.note, v_e.note, v_new.note),
      ('W/P ref', v_new.wp_ref = v_e.wp_ref, v_e.wp_ref, v_new.wp_ref),
      ('Reverses next year', v_new.reverse_next_year = v_e.reverse_next_year, case when v_e.reverse_next_year then 'Yes' else 'No' end, case when v_new.reverse_next_year then 'Yes' else 'No' end),
      ('Attachments', v_new.attachments = v_e.attachments,
         coalesce(nullif(array_to_string(array(select regexp_replace(x, '^.*/(\d+-)?', '') from unnest(v_e.attachments) x), ', '), ''), 'None'),
         coalesce(nullif(array_to_string(array(select regexp_replace(x, '^.*/(\d+-)?', '') from unnest(v_new.attachments) x), ', '), ''), 'None')),
      ('Lines', v_new_lines = v_old_lines, v_old_lines, v_new_lines)) as x(what, same, was, now)
    where not same loop
    perform private.cb_log_event(v_e.file_id, 'entry_edited', 'entries', format('Entry %s changed: %s', private.cb_entry_label(p_entry), lower(r.what)),
      null, null, private.cb_entry_label(p_entry), r.what, r.was, r.now);
  end loop;
  update public.cb_files set updated_at = now() where id = v_e.file_id;
  return p_entry;
end;
$function$;

-- Piece 10b: a posted line split again is a coding change, as recoding a line: steps 4, 6, 7 and 8 clear, with the line in
-- History. The reviewer's decision on a line clears nothing, as before.
create or replace function private.cb_split_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_row public.cb_line_splits := case when tg_op = 'DELETE' then old else new end; l public.cb_bank_lines; v_txt text;
begin
  if coalesce(current_setting('cb.review', true), '') = 'on' then return null; end if;
  select * into l from public.cb_bank_lines where id = v_row.line_id;
  if l.id is null or l.status in ('new', 'excluded') then return null; end if;
  v_txt := format('%s %s: split changed', to_char(l.txn_date, 'Mon FMDD'), left(l.description, 40));
  -- Hashim's decision (Nov 19, 2026, option A): a coding change, as recoding a line: step 4 clears, and steps 6, 7 and 8
  -- through the chain.
  perform private.cb_clear_step(v_row.file_id, 'code', v_txt);
  return null;
end;
$$;
revoke all on function private.cb_split_changed() from public, anon, authenticated;
drop trigger if exists cb_changed_splits on public.cb_line_splits;
create trigger cb_changed_splits after insert or delete on public.cb_line_splits for each row execute function private.cb_split_changed();
drop trigger if exists cb_changed_splits_edit on public.cb_line_splits;
create trigger cb_changed_splits_edit after update of chart_account, tax_code, amount on public.cb_line_splits for each row
  when (old.chart_account is distinct from new.chart_account or old.tax_code is distinct from new.tax_code or old.amount is distinct from new.amount)
  execute function private.cb_split_changed();
