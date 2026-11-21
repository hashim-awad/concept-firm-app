-- CloseBook2 piece CB2-0, step 5 (Hashim, Nov 21, 2026; docs/CLOSEBOOK2.md rule 7: no thresholds anywhere).
-- Removed: the $5,000 and 20% year-over-year flag (step 6), the $5,000 entry review amount (standard entries and expenses
-- paid personally), the $5,000 receipts rule on expenses paid personally, the revenue, T4A and GST/HST review threshold
-- (every difference is explained in one line; the reviewer may accept any difference, nothing waits), the transfer date
-- windows on pairing (5 and 7 days; the bank feed still suggests pairs within 7 days, as QBO suggests matches).
-- The cb_settings columns stay (no drops); nothing reads them. Settings no longer shows them.

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
      -- Piece R2: every account with a balance this year or last year, or an entry, assigned to a master account (D9).
      select count(*) into v_n from public.cb_accounts a where a.file_id = p_file and a.chart_account is null
         and (a.line_no is null or not a.client_new) and private.cb_assign_counted(a);
      if v_n > 0 then v_out := v_out || format('%s account%s with a balance to assign to a master account.', v_n, case when v_n = 1 then '' else 's' end); end if;
    end if;
  elsif p_step = 'entries' then
    -- Piece 10: the flagged changes are explained in step 6 now.
    -- Round 9: the revenue check, and expenses paid personally when the setup says so.
    v_out := v_out || private.cb_step5_problems(p_file);
  elsif p_step = 'compare' then
    -- CB2-0 step 5 (rule 7, no thresholds): no flagged changes. Compare to last year lists every line.
    -- Every used account in a group, and Clearing at zero (moved from the old step 6).
    select count(*) into v_n from public.cb_accounts a where a.file_id = p_file and a.line_no is null and not a.needs_reviewer
       and a.account_key not in ('opening', 'uncoded') and not private.cb_clearing(a.account_key, a.chart_account) and private.cb_account_used(a.id);
    if v_n > 0 then v_out := v_out || format('%s account%s with no group: %s.', v_n, case when v_n = 1 then '' else 's' end,
      case when v_bank then 'choose a group' else 'assign a master account in step 4' end); end if;
    if exists (select 1 from public.cb_accounts a where a.file_id = p_file and a.account_key = 'chart:10900' and private.cb_account_final(a.id) <> 0) then
      v_out := v_out || 'Clearing (10900) has a balance: move it to the right account.'::text;
    end if;
    -- Piece R2 (D2, Hashim): client accounts on 10900 Clearing hold step 6 while they have a balance. Opening Balance Equity is
    -- cleared by one RJE to retained earnings; the others by an entry to cash (deposit in transit) or receivables.
    -- Decision 1A: on a trial balance file, retained earnings at the start tie to step 2's closing figure, on every change.
    if not v_bank and v_file.opening_re_stated is not null then
      select -coalesce(sum(private.cb_account_final(a.id)), 0) into v_flag_amount from public.cb_accounts a where a.file_id = p_file and a.line_no like '3600.%';
      if v_flag_amount <> v_file.opening_re_stated then
        v_out := v_out || format('Retained earnings at the start do not tie to step 2. At the start: %s. Step 2 (T2 line 3849): %s. Difference: %s.',
          private.cb_money(v_flag_amount), private.cb_money(v_file.opening_re_stated), private.cb_money(v_flag_amount - v_file.opening_re_stated));
        -- Dividends option A (Hashim, Nov 19): name each dividends or prior period account still carrying last year's balance.
        v_out := v_out || coalesce((select array_agg(format('%s carries %s from last year: if QuickBooks did not close it, move that balance to retained earnings with one RJE dated the first day of the year.',
                 btrim(coalesce(nullif(a.number, '') || ' ', '') || a.name), private.cb_money(a.last_year)) order by a.number, a.name)
          from public.cb_accounts a join public.cb_chart_accounts c on c.number = a.chart_account
         where a.file_id = p_file and c.line_no >= '3700' and c.line_no < '3750' and a.last_year <> 0
           and not private.cb_div_moved(a.id)), '{}'::text[]);
      end if;
    end if;
    v_out := v_out || coalesce((select array_agg(format('%s (Clearing) has a balance: %s.', btrim(coalesce(nullif(a.number, '') || ' ', '') || a.name),
             case when private.cb_obe(a) then 'clear it to retained earnings with one RJE' else 'clear it with an entry to cash or receivables' end) order by a.number, a.name)
      from public.cb_accounts a where a.file_id = p_file and a.chart_account = '10900' and private.cb_account_final(a.id) <> 0), '{}'::text[]);
    -- b) Every new account confirmed, in the group it has now.
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

CREATE OR REPLACE FUNCTION private.cb_revenue_state(p_file uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_file public.cb_files;
  v_tb numeric; v_src numeric; v_gst numeric; v_comm numeric; v_t4a numeric;
  v_n_src int; v_n_gst int; v_n_comm int; v_n_t4a int;
  r public.cb_revenue_checks;
  v_limit numeric;
  v_from_return boolean; v_tb_gst numeric;
begin
  select * into v_file from public.cb_files where id = p_file;
  select -coalesce(sum(private.cb_account_final(a.id)), 0) into v_tb
    from public.cb_accounts a join public.cb_master_lines m on m.line_no = a.line_no where a.file_id = p_file and m.line_type = 'Revenue';
  select coalesce(sum(amount) filter (where kind in ('commission_statement', 'sales_report', 'processor_report', 'slips') or (kind = 't4a' and payer = 'other')), 0),
         count(*) filter (where kind in ('commission_statement', 'sales_report', 'processor_report', 'slips') or (kind = 't4a' and payer = 'other')),
         coalesce(sum(amount) filter (where kind = 'gst_returns'), 0), count(*) filter (where kind = 'gst_returns'),
         coalesce(sum(amount) filter (where kind = 'commission_statement'), 0), count(*) filter (where kind = 'commission_statement'),
         coalesce(sum(amount) filter (where kind = 't4a' and payer = 'brokerage'), 0), count(*) filter (where kind = 't4a' and payer = 'brokerage')
    into v_src, v_n_src, v_gst, v_n_gst, v_comm, v_n_comm, v_t4a, v_n_t4a
    from public.cb_revenue_sources where file_id = p_file;
  -- Round 13: a file whose GST/HST return is built in Closebook takes the return's sales before tax (quick
  -- method: the eligible sales without the tax) instead of a typed figure. The quick method gain (42400) is
  -- not a sale and stays out of the comparison.
  v_from_return := private.cb_gst_applies(p_file);
  v_tb_gst := v_tb;
  if v_from_return then
    select coalesce(sum(coalesce((lines ->> 'sales')::numeric, (lines ->> '101')::numeric)) / 100, 0), count(*) into v_gst, v_n_gst from public.cb_gst_returns where file_id = p_file;
    v_tb_gst := v_tb + coalesce((select sum(private.cb_account_final(a.id)) from public.cb_accounts a where a.file_id = p_file and a.account_key = 'chart:42400'), 0);
  end if;
  select * into r from public.cb_revenue_checks where file_id = p_file;
  return jsonb_build_object('tb', v_tb, 'sources', v_src, 'n_sources', v_n_src, 'diff', v_tb - v_src,
    'gst', v_gst, 'n_gst', v_n_gst, 'gst_diff', v_tb_gst - v_gst, 'gst_from_return', v_from_return, 'tb_gst', v_tb_gst, 'commission', v_comm, 'n_commission', v_n_comm,
    't4a', v_t4a, 'n_t4a', v_n_t4a, 't4a_diff', v_comm - v_t4a, 'threshold', 0,
    'realtor', coalesce((v_file.setup ->> 'realtor')::boolean, false), 'registrant', coalesce((v_file.setup ->> 'gst_registered')::boolean, false),
    'explanation', coalesce(r.explanation, ''), 'gst_explanation', coalesce(r.gst_explanation, ''), 't4a_explanation', coalesce(r.t4a_explanation, ''),
    't4a_none', coalesce(r.t4a_none, false), 'accepted_diff', r.accepted_diff, 'accepted_by', r.accepted_by, 'accepted_at', r.accepted_at,
    'explained_diff', r.explained_diff, 'gst_explained_diff', r.gst_explained_diff, 't4a_explained_diff', r.t4a_explained_diff,
    -- An explanation counts only for the difference it was written for.
    'explained', coalesce(r.explanation, '') <> '' and r.explained_diff = v_tb - v_src,
    'gst_explained', coalesce(r.gst_explanation, '') <> '' and r.gst_explained_diff = v_tb_gst - v_gst,
    't4a_explained', coalesce(r.t4a_explanation, '') <> '' and r.t4a_explained_diff = v_comm - v_t4a,
    'gst_accepted_diff', r.gst_accepted_diff, 'gst_accepted_by', r.gst_accepted_by, 'gst_accepted_at', r.gst_accepted_at,
    't4a_accepted_diff', r.t4a_accepted_diff, 't4a_accepted_by', r.t4a_accepted_by, 't4a_accepted_at', r.t4a_accepted_at,
    -- CB2-0 step 5 (rule 7): no review threshold. Every difference is explained in one line; nothing waits for the reviewer.
    'waiting', false, 'gst_waiting', false, 't4a_waiting', false);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_add_personal_expenses(p_file uuid, p_lines jsonb, p_check jsonb, p_attachments text[], p_to_reviewer boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_file public.cb_files; v_entry uuid; v_sum numeric; v_n int; v_std uuid; v_limit numeric; v_review boolean; v_credit numeric;
  x jsonb; c public.cb_standard_entry_lines;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(coalesce(array_length(p_attachments, 1), 0) >= 1, 'Attach the client''s sheet as the source.');
  select id into v_std from public.cb_standard_entries where name = 'Expenses paid personally' and style = 'lines';
  perform private.require(v_std is not null, 'The "Expenses paid personally" standard entry is missing.');
  perform private.require(jsonb_typeof(p_check -> 'lines') = 'array' and jsonb_array_length(p_check -> 'lines') > 0, 'Type the amounts from the Summary.');
  select coalesce(sum((e ->> 'total')::numeric), 0) into v_sum from jsonb_array_elements(p_check -> 'lines') e;
  perform private.require(round(v_sum, 2) = round((p_check ->> 'summary_total')::numeric, 2),
    format('The lines add up to %s, not the Summary total of %s. Check the amounts typed.', to_char(v_sum, 'FM999,999,990.00'), to_char((p_check ->> 'summary_total')::numeric, 'FM999,999,990.00')));
  v_review := coalesce(p_to_reviewer, false);
  for x in select * from jsonb_array_elements(p_check -> 'lines') loop
    select * into c from public.cb_standard_entry_lines where standard_id = v_std and key = x ->> 'key';
    perform private.require(c.key is not null, 'A line is not on the standard entry.');
    continue when coalesce((x ->> 'total')::numeric, 0) = 0;
    perform private.require(c.share <> 'km' or (coalesce((p_check ->> 'km_total')::numeric, 0) > 0 and coalesce((p_check ->> 'km_business')::numeric, -1) between 0 and (p_check ->> 'km_total')::numeric),
      'Vehicle lines need the total km and the business km for the year.');
    perform private.require(not c.pick or nullif(x ->> 'account', '') is not null, format('%s: choose the account.', c.name));
    perform private.require(cardinality(c.choices) = 0 or x ->> 'account' = any (c.choices), format('%s: choose one of %s.', c.name, array_to_string(c.choices, ', ')));
    perform private.require(not c.note_required or length(btrim(coalesce(x ->> 'note', ''))) >= 3, format('%s: add a note saying what it is.', c.name));
    v_review := v_review or c.to_reviewer or (c.capital and coalesce((v_file.setup ->> 'quick_method')::boolean, false));
  end loop;
  v_entry := public.cb_add_entry(p_file, 'AJE', 'correction', 'Business costs the shareholder paid personally during the year.', false, p_lines,
    'Expenses paid personally summary', v_file.year_end, null, p_attachments);
  select coalesce(sum(amount), 0) into v_credit from public.cb_entry_lines where entry_id = v_entry and amount > 0;
  update public.cb_entries set origin = 'expenses_personal', standard_id = v_std, needs_review = v_review where id = v_entry;
  return v_entry;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_add_entry(p_file uuid, p_kind text, p_reason text, p_note text, p_reverse boolean, p_lines jsonb, p_wp_ref text, p_date date DEFAULT NULL::date, p_standard uuid DEFAULT NULL::uuid, p_attachments text[] DEFAULT '{}'::text[], p_seq integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_file public.cb_files;
  v_id uuid;
  v_std public.cb_standard_entries;
  v_limit numeric;
  v_plain jsonb;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook to add entries.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.cb_entry_head_check(v_file, p_kind, p_reason, p_note, p_reverse, p_lines, p_wp_ref, p_date, p_attachments);
  -- Round 15b: the entry number can be typed (CaseWare's adjustment number); blank takes the next one.
  perform private.require(p_seq is null or (p_seq between 1 and 999 and not exists (select 1 from public.cb_entries where file_id = p_file and seq = p_seq)),
    format('Entry number %s-%s is taken. Choose another.', to_char(v_file.year_end, 'YYYY'), lpad(coalesce(p_seq, 0)::text, 3, '0')));
  insert into public.cb_entries (file_id, kind, number, seq, reason, note, reverse_next_year, wp_ref, created_by, entry_date, attachments)
  values (p_file, p_kind, coalesce((select max(number) from public.cb_entries where file_id = p_file and kind = p_kind), 0) + 1,
          coalesce(p_seq, coalesce((select max(seq) from public.cb_entries where file_id = p_file), 0) + 1),
          p_reason, btrim(p_note), coalesce(p_reverse, false), btrim(p_wp_ref), (select auth.uid()), coalesce(p_date, v_file.year_end), coalesce(p_attachments, '{}'))
  returning id into v_id;
  v_plain := private.cb_entry_write_lines(v_id, v_file, p_kind, p_reason, p_reverse, p_lines);
  -- CB2-0 step 5 (rule 7): a standard entry needs no review if it is still the standard entry, at any amount:
  -- two lines, one amount, on the setting's GIFI lines, with the setting's type and reason.
  if p_standard is not null then
    select * into v_std from public.cb_standard_entries where id = p_standard;
    perform private.require(v_std.id is not null, 'That standard entry is gone. Choose another.');
    update public.cb_entries set standard_id = v_std.id,
      needs_review = not (jsonb_array_length(v_plain) = 2 and v_std.kind = p_kind and v_std.reason = p_reason
        and (v_plain -> 0 ->> 'amount')::numeric = -(v_plain -> 1 ->> 'amount')::numeric
        and exists (select 1 from jsonb_array_elements(v_plain) x where (x ->> 'amount')::numeric > 0 and x ->> 'line' = (select line_no from public.cb_chart_accounts where number = v_std.debit_account))
        and exists (select 1 from jsonb_array_elements(v_plain) x where (x ->> 'amount')::numeric < 0 and x ->> 'line' = (select line_no from public.cb_chart_accounts where number = v_std.credit_account)))
     where id = v_id;
  end if;
  update public.cb_files set updated_at = now() where id = p_file;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION private.cb_gst_problems(p_file uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_out text[] := '{}'; v_n int; v_fp text; c public.cb_gst_check; v_limit numeric;
begin
  if not private.cb_gst_applies(p_file) then return v_out; end if;
  v_fp := private.cb_tb_fingerprint(p_file);
  select count(*) into v_n from public.cb_gst_returns where file_id = p_file;
  if v_n < private.cb_gst_period_count(p_file) then
    v_out := v_out || format('Prepare the GST/HST return%s for the year (%s of %s prepared).', case when private.cb_gst_period_count(p_file) = 1 then '' else 's' end, v_n, private.cb_gst_period_count(p_file));
  elsif exists (select 1 from public.cb_gst_returns where file_id = p_file and fingerprint <> v_fp) then
    v_out := v_out || 'The books changed after the GST/HST returns were prepared. Prepare them again.'::text;
  end if;
  select * into c from public.cb_gst_check where file_id = p_file;
  if c.file_id is null or c.fingerprint <> v_fp then return v_out; end if;
  if c.diff <> 0 then
    -- CB2-0 step 5 (rule 7): no review threshold. Any difference is explained in one line, accepted by the reviewer, or fixed.
    if c.accepted_at is null and coalesce(c.note, '') = '' then
      v_out := v_out || format('GST/HST payable (21500) differs from the balances owing on the returns by %s: explain it in one line, or fix it with an entry.', private.cb_money(c.diff));
    end if;
  end if;
  return v_out;
end;
$function$;

CREATE OR REPLACE FUNCTION private.cb_step5_waiting(p_file uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v jsonb := private.cb_revenue_state(p_file);
  v_out text[] := '{}';
begin
  if (v ->> 'waiting')::boolean then v_out := v_out || format('Revenue difference of %s, waiting for the reviewer.', private.cb_money((v ->> 'diff')::numeric)); end if;
  -- Piece 7: the GST/HST returns difference waits in step 8 (private.cb_gst_revenue_problems).
  if (v ->> 't4a_waiting')::boolean then v_out := v_out || format('T4A difference of %s, waiting for the reviewer.', private.cb_money((v ->> 't4a_diff')::numeric)); end if;
  -- Piece 8: the shareholder loan flags wait in step 7 (private.cb_sh_review_problems).
  return v_out;
end;
$function$;

CREATE OR REPLACE FUNCTION private.cb_gst_revenue_problems(p_file uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v jsonb := private.cb_revenue_state(p_file); v_out text[] := '{}'; v_full boolean;
begin
  select file_type = 'full' into v_full from public.cb_files where id = p_file;
  if not coalesce(v_full, false) or not (v ->> 'registrant')::boolean then return v_out; end if;
  if (v ->> 'n_gst')::int = 0 then
    -- A return built in Closebook is asked for by private.cb_gst_problems.
    if not (v ->> 'gst_from_return')::boolean then v_out := v_out || 'GST/HST revenue: enter the revenue on the year''s GST/HST returns and attach them.'::text; end if;
  elsif (v ->> 'gst_diff')::numeric <> 0 and not (v ->> 'gst_explained')::boolean then
    v_out := v_out || 'GST/HST revenue: explain the difference between the books and the returns.'::text;
  elsif (v ->> 'gst_waiting')::boolean then
    v_out := v_out || format('GST/HST revenue: the difference of %s waits for the reviewer.', private.cb_money((v ->> 'gst_diff')::numeric));
  end if;
  return v_out;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_accept_revenue_difference(p_file uuid, p_check text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v jsonb; v_diff numeric; v_name text;
begin
  perform private.require(private.can_edit('closebook') and private.cb_can('review'), 'Only the reviewer accepts a revenue difference. Reviewers need the Review right.');
  perform private.require(p_check in ('revenue', 'gst', 't4a'), 'Unknown check.');
  v := private.cb_revenue_state(p_file);
  v_diff := (v ->> case p_check when 'revenue' then 'diff' when 'gst' then 'gst_diff' else 't4a_diff' end)::numeric;
  v_name := case p_check when 'revenue' then 'Revenue difference' when 'gst' then 'GST/HST returns difference' else 'T4A difference' end;
  -- CB2-0 step 5 (rule 7): the reviewer may accept any difference; nothing waits for it.
  perform private.require(coalesce(v_diff, 0) <> 0, 'Nothing to accept: there is no difference.');
  insert into public.cb_revenue_checks (file_id) values (p_file) on conflict (file_id) do nothing;
  if p_check = 'revenue' then update public.cb_revenue_checks set accepted_by = (select auth.uid()), accepted_at = now(), accepted_diff = v_diff where file_id = p_file;
  elsif p_check = 'gst' then update public.cb_revenue_checks set gst_accepted_by = (select auth.uid()), gst_accepted_at = now(), gst_accepted_diff = v_diff where file_id = p_file;
  else update public.cb_revenue_checks set t4a_accepted_by = (select auth.uid()), t4a_accepted_at = now(), t4a_accepted_diff = v_diff where file_id = p_file;
  end if;
  perform private.cb_log(p_file, 'revenue_accepted', case when p_check = 'gst' then 't2' else 'entries' end, format('%s %s accepted', v_name, private.cb_money(v_diff)));
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_post_lines(p_file uuid, p_items jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_file public.cb_files := private.cb_file_open(p_file);
  v_item jsonb; l public.cb_bank_lines; o public.cb_bank_lines; v_out public.cb_bank_lines; v_in public.cb_bank_lines;
  v_kind text; v_acc text; v_tax text; v_reason text; v_src text; v_reviewer boolean; v_tr public.cb_bank_accounts; v_sum numeric; v_n int := 0; v_rule uuid;
begin
  perform private.cb_require_gst_answers(p_file);
  v_reviewer := (select auth.uid()) = v_file.reviewer_id or private.cb_can('review');
  perform private.require(jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) between 1 and 5000, 'Nothing to post.');
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into l from public.cb_bank_lines where id = (v_item ->> 'id')::uuid and file_id = p_file for update;
    perform private.require(l.id is not null, 'Line not found.');
    if not private.cb_line_pending(l) then continue; end if;   -- posted already (the other side of a pair in the same batch)
    v_kind := coalesce(v_item ->> 'kind', 'code');
    v_src := coalesce(nullif(v_item ->> 'source', ''), 'manual');
    perform private.require(v_src in ('manual', 'rule', 'auto', 'history', 'firm'), 'Unknown source.');
    v_rule := nullif(v_item ->> 'rule_id', '')::uuid;
    if v_kind = 'code' then
      v_acc := v_item ->> 'account'; v_tax := nullif(v_item ->> 'tax', '');
      perform private.require(exists (select 1 from public.cb_chart_accounts where number = v_acc), 'Choose an account for every line. Nothing was posted.');
      perform private.require(v_tax is not null and exists (select 1 from public.cb_sales_tax_codes where code = v_tax), 'Choose a sales tax code for every line. Nothing was posted.');
      v_reason := private.cb_reviewer_reason(l, v_acc, v_tax, v_reviewer);
      delete from public.cb_line_splits where line_id = l.id;
      update public.cb_bank_lines set chart_account = v_acc, tax_code = v_tax, transfer_account = null, is_split = false,
             status = case when v_reason = '' then 'done' else 'reviewer' end, reviewer_reason = v_reason, source = v_src, rule_id = v_rule,
             coded_by = (select auth.uid()), coded_at = now()
       where id = l.id;
    elsif v_kind = 'split' then
      perform private.require(l.is_split, 'Split the line first.');
      select coalesce(sum(amount), 0) into v_sum from public.cb_line_splits where line_id = l.id;
      perform private.require(v_sum = abs(l.amount), 'The split rows must add up to the line. Nothing was posted.');
      select coalesce(max(r), '') into v_reason from (select private.cb_reviewer_reason(l, s.chart_account, s.tax_code, v_reviewer) r from public.cb_line_splits s where s.line_id = l.id) x;
      update public.cb_bank_lines set chart_account = null, tax_code = null, transfer_account = null,
             status = case when v_reason = '' then 'done' else 'reviewer' end, reviewer_reason = v_reason, source = v_src, rule_id = v_rule,
             coded_by = (select auth.uid()), coded_at = now()
       where id = l.id;
    elsif v_kind = 'transfer' then
      select * into v_tr from public.cb_bank_accounts where id = nullif(v_item ->> 'transfer_account', '')::uuid and file_id = p_file;
      perform private.require(v_tr.id is not null and v_tr.id <> l.account_id, 'Choose another of this file''s accounts.');
      delete from public.cb_line_splits where line_id = l.id;
      update public.cb_bank_lines set chart_account = v_tr.chart_account, tax_code = null, transfer_account = v_tr.id, is_split = false,
             status = 'done', reviewer_reason = '', source = v_src, rule_id = v_rule, coded_by = (select auth.uid()), coded_at = now()
       where id = l.id;
    elsif v_kind in ('pair', 'already') then
      select * into o from public.cb_bank_lines where id = nullif(v_item ->> 'other', '')::uuid and file_id = p_file for update;
      perform private.require(o.id is not null and o.account_id <> l.account_id, 'The other line was not found.');
      perform private.require(l.amount <> 0 and abs(l.amount) = abs(o.amount), 'The two amounts must be the same to the cent.');
      perform private.require(private.cb_line_out(l) <> private.cb_line_out(o), 'One line must be money out and the other money in.');
      perform private.require(not exists (select 1 from public.cb_bank_transfers t where t.out_line in (l.id, o.id) or t.in_line in (l.id, o.id)), 'This line is already in a transfer.');
      perform set_config('cb.transfer', 'on', true);
      if v_kind = 'pair' then
        perform private.require(private.cb_line_pending(o), 'The other line is posted or excluded.');
        perform private.require(not exists (select 1 from public.cb_bank_pair_choices c where c.kind = 'rejected' and c.line_a = least(l.id, o.id) and c.line_b = greatest(l.id, o.id)),
          'These two lines were unpaired.');
        if private.cb_line_out(l) then v_out := l; v_in := o; else v_out := o; v_in := l; end if;
        delete from public.cb_line_splits where line_id in (l.id, o.id);
        -- One entry, from the money-out line: debit the other account, credit this one (tb-build.ts).
        update public.cb_bank_lines set status = 'done', chart_account = (select chart_account from public.cb_bank_accounts where id = v_in.account_id), tax_code = null,
               transfer_account = null, is_split = false, reviewer_reason = '', source = 'transfer', rule_id = null, coded_by = (select auth.uid()), coded_at = now()
         where id = v_out.id;
        update public.cb_bank_lines set status = 'matched', chart_account = null, tax_code = null, transfer_account = null, is_split = false, reviewer_reason = '',
               source = 'transfer', rule_id = null, coded_by = (select auth.uid()), coded_at = now()
         where id = v_in.id;
        insert into public.cb_bank_transfers (file_id, out_line, in_line, created_by) values (p_file, v_out.id, v_in.id, (select auth.uid()));
      else
        -- The other side was posted to this line's account before this line came in: this one posts nothing.
        perform private.require(o.status in ('done', 'reviewer') and o.transfer_account = l.account_id, 'The other line is not a transfer posted to this account.');
        update public.cb_bank_lines set status = 'matched', chart_account = null, tax_code = null, transfer_account = null, is_split = false, reviewer_reason = '',
               source = 'transfer', rule_id = null, coded_by = (select auth.uid()), coded_at = now()
         where id = l.id;
        insert into public.cb_bank_transfers (file_id, out_line, in_line, created_by) values (p_file, o.id, l.id, (select auth.uid()));
      end if;
      perform set_config('cb.transfer', '', true);
    else
      perform private.require(false, 'Unknown action.');
    end if;
    v_n := v_n + 1;
  end loop;
  update public.cb_files set updated_at = now() where id = p_file;
  return v_n;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_accept_transfer(p_file uuid, p_line uuid, p_other uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_file public.cb_files;
  a public.cb_bank_lines;
  b public.cb_bank_lines;
  v_out public.cb_bank_lines;
  v_in public.cb_bank_lines;
  v_acc_a public.cb_bank_accounts;
  v_acc_b public.cb_bank_accounts;
  v_from public.cb_bank_accounts;
  v_to public.cb_bank_accounts;
  v_a_out boolean;
  v_b_out boolean;
  v_id uuid;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook to code transactions.');
  select * into v_file from public.cb_files where id = p_file;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(p_line is not null and p_other is not null and p_line <> p_other, 'Choose two lines.');
  -- Both rows locked in one order, so two people matching at once cannot both win.
  perform 1 from public.cb_bank_lines where id in (p_line, p_other) and file_id = p_file order by id for update;
  select * into a from public.cb_bank_lines where id = p_line and file_id = p_file;
  select * into b from public.cb_bank_lines where id = p_other and file_id = p_file;
  perform private.require(a.id is not null and b.id is not null, 'Line not found.');
  perform private.require(a.status = 'new' and b.status = 'new', 'Both lines must still be to code. Undo the other line first.');
  perform private.require(a.account_id <> b.account_id, 'A transfer is between two different accounts.');
  select * into v_acc_a from public.cb_bank_accounts where id = a.account_id;
  select * into v_acc_b from public.cb_bank_accounts where id = b.account_id;
  -- Money out: a payment from a bank account, a charge on a card. Money in: a deposit, a card payment.
  v_a_out := case when v_acc_a.kind = 'card' then a.amount > 0 else a.amount < 0 end;
  v_b_out := case when v_acc_b.kind = 'card' then b.amount > 0 else b.amount < 0 end;
  perform private.require(a.amount <> 0 and abs(a.amount) = abs(b.amount), 'The two amounts must be the same to the cent.');
  perform private.require(v_a_out <> v_b_out, 'One line must be money out and the other money in.');
  if v_a_out then v_out := a; v_in := b; v_from := v_acc_a; v_to := v_acc_b;
  else v_out := b; v_in := a; v_from := v_acc_b; v_to := v_acc_a; end if;

  perform set_config('cb.transfer', 'on', true);
  update public.cb_bank_lines set status = 'done', chart_account = v_to.chart_account, tax_code = null, reviewer_reason = '',
         source = 'transfer', coded_by = (select auth.uid()), coded_at = now()
   where id = v_out.id;
  update public.cb_bank_lines set status = 'matched', chart_account = null, tax_code = null, reviewer_reason = '',
         source = 'transfer', coded_by = (select auth.uid()), coded_at = now()
   where id = v_in.id;
  perform set_config('cb.transfer', '', true);
  insert into public.cb_bank_transfers (file_id, out_line, in_line, created_by)
  values (p_file, v_out.id, v_in.id, (select auth.uid())) returning id into v_id;
  perform private.cb_log_skip(p_file, 'transfer_matched', 'code', format('Transfer of %s from %s on %s to %s on %s',
    private.cb_money(abs(v_out.amount)), v_from.name, to_char(v_out.txn_date, 'Mon FMDD'), v_to.name, to_char(v_in.txn_date, 'Mon FMDD')));
  update public.cb_files set updated_at = now() where id = p_file;
  return v_id;
end;
$function$;

-- CB2-0 review round: accepting a difference is refused on a locked file (security review).
CREATE OR REPLACE FUNCTION public.cb_accept_revenue_difference(p_file uuid, p_check text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v jsonb; v_diff numeric; v_name text;
begin
  perform private.require(private.can_edit('closebook') and private.cb_can('review'), 'Only the reviewer accepts a revenue difference. Reviewers need the Review right.');
  perform private.require(p_check in ('revenue', 'gst', 't4a'), 'Unknown check.');
  perform private.require(exists (select 1 from public.cb_files where id = p_file and phase <> 'locked'), 'This file is locked or missing.');
  v := private.cb_revenue_state(p_file);
  v_diff := (v ->> case p_check when 'revenue' then 'diff' when 'gst' then 'gst_diff' else 't4a_diff' end)::numeric;
  v_name := case p_check when 'revenue' then 'Revenue difference' when 'gst' then 'GST/HST returns difference' else 'T4A difference' end;
  -- CB2-0 step 5 (rule 7): the reviewer may accept any difference; nothing waits for it.
  perform private.require(coalesce(v_diff, 0) <> 0, 'Nothing to accept: there is no difference.');
  insert into public.cb_revenue_checks (file_id) values (p_file) on conflict (file_id) do nothing;
  if p_check = 'revenue' then update public.cb_revenue_checks set accepted_by = (select auth.uid()), accepted_at = now(), accepted_diff = v_diff where file_id = p_file;
  elsif p_check = 'gst' then update public.cb_revenue_checks set gst_accepted_by = (select auth.uid()), gst_accepted_at = now(), gst_accepted_diff = v_diff where file_id = p_file;
  else update public.cb_revenue_checks set t4a_accepted_by = (select auth.uid()), t4a_accepted_at = now(), t4a_accepted_diff = v_diff where file_id = p_file;
  end if;
  perform private.cb_log(p_file, 'revenue_accepted', case when p_check = 'gst' then 't2' else 'entries' end, format('%s %s accepted', v_name, private.cb_money(v_diff)));
end;
$function$;
