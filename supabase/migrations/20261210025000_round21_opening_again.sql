-- Round 21 (Nov 16, 2026): runs 20261210010000_round21_opening.sql again, unchanged. The Test database
-- applied an early draft of that file from a work-in-progress push, so this brings Test to the final version.
-- On Live it runs right after the same file and changes nothing (the file is safe to run twice).

-- Round 21 (Hashim, Nov 15, 2026), step 2, Opening balances. Safe to run twice.
--  - Sign rule (item 12): amounts are typed as printed on the T2. Only dividends (3700 to 3719) are kept
--    negative whatever sign is typed (rule 3, Nov 14). Prior period adjustments (3720) and other items
--    (3740 to 3848) keep the sign typed, as gifi.ts, fs-model.ts and t2.ts already add them: before this
--    round step 2 forced them negative, so a positive adjustment was stored as a deduction.
--  - One place for last year's income statement (item 8): the Schedule 125 tab saves with the balance
--    sheet; its lines are copied to cb_opening_s125, which the statements read.
--  - Accounts (item 13): every Schedule 100 line with an amount needs a standard chart account (or one of
--    the file's bank accounts). A line with only one standard account takes it without a choice.
--  - Source and PDF (item 14) are required before "Sign as preparer".
--  - Retained earnings (items 9, 10): 3660 flagged when blank and 3849 is not; the plain message when
--    3660 + 3680 − 3700 + 3720 + 3740 does not equal 3849.
--  - One problem, one issue (item 11): "With the reviewer" no longer repeats open review notes, which
--    already show under "To fix". It lists fixed notes, which wait for the reviewer to clear.

-- Amounts in messages, as the screens show them: 1,234.00, a negative in brackets.
create or replace function private.cb_bracket(p numeric) returns text language sql immutable set search_path = '' as $$
  select case when p < 0 then '(' || to_char(abs(p), 'FM999,999,999,990.00') || ')' else to_char(p, 'FM999,999,999,990.00') end
$$;

-- Each problem on step 2 of a bank-statement file, one line each (one problem, one issue).
create or replace function private.cb_opening_problems(p_file uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_out text[] := '{}';
  v_assets numeric; v_liab numeric; v_equity numeric; v_rev numeric; v_exp numeric; v_re numeric; v_has125 boolean; v_has3660 boolean; v_ni numeric;
  r record;
begin
  select * into v_file from public.cb_files where id = p_file;
  -- Round 16: a first-year company has no opening balances.
  if v_file.id is null or v_file.first_year then return v_out; end if;
  if btrim(coalesce(v_file.opening_note, '')) = '' then v_out := v_out || 'Type the source: which T2 or CRA assessment the balances come from.'::text; end if;
  if v_file.opening_pdf is null then v_out := v_out || 'Attach the PDF of last year''s T2 or the CRA assessment.'::text; end if;
  if not exists (select 1 from public.cb_opening_balances where file_id = p_file and coalesce(private.cb_gifi_type(code), '') not in ('Revenue', 'Expense')) then
    return v_out || 'Enter last year''s balance sheet (Schedule 100).'::text;
  end if;
  select coalesce(sum(amount) filter (where t = 'Asset'), 0), coalesce(sum(amount) filter (where t = 'Liability'), 0),
         coalesce(sum(amount) filter (where t = 'Equity' and not (code = '3660' or code::int between 3700 and 3848)), 0),
         coalesce(sum(amount) filter (where t = 'Revenue'), 0), coalesce(sum(amount) filter (where t = 'Expense'), 0),
         coalesce(sum(case when code = '3660' or code::int between 3700 and 3848 then amount else 0 end), 0),
         coalesce(bool_or(t in ('Revenue', 'Expense')), false), coalesce(bool_or(code = '3660'), false)
    into v_assets, v_liab, v_equity, v_rev, v_exp, v_re, v_has125, v_has3660
    from (select code, amount, private.cb_gifi_type(code) t from public.cb_opening_balances where file_id = p_file) x;
  v_ni := case when v_has125 then v_rev - v_exp else v_file.opening_ni_typed end;
  if v_ni is null then v_out := v_out || 'Type last year''s net income (3680), or enter the Schedule 125 tab.'::text; end if;
  if v_file.opening_re_stated is null then
    v_out := v_out || 'Type last year''s 3849 from the T2.'::text;
  else
    if not v_has3660 then v_out := v_out || 'Line 3660 is blank. Type it from last year''s T2, or 0.00 if the T2 shows none.'::text; end if;
    if v_ni is not null and v_re + v_ni <> v_file.opening_re_stated then
      v_out := v_out || format('Retained earnings do not tie. Start (3660) + net income (3680) − dividends (3700) + adjustments (3720, 3740) should equal 3849. Difference: %s. Check line 3660 on last year''s T2.',
        private.cb_bracket(v_re + v_ni - v_file.opening_re_stated));
    end if;
    if v_liab + v_equity + v_file.opening_re_stated <> v_assets then
      v_out := v_out || format('Total liabilities and equity (3640, %s) does not equal total assets (2599, %s).',
        private.cb_bracket(v_liab + v_equity + v_file.opening_re_stated), private.cb_bracket(v_assets));
    end if;
  end if;
  -- Item 13: each Schedule 100 line with an amount sits on an account from the standard chart.
  for r in select code from public.cb_opening_balances
            where file_id = p_file and amount <> 0 and chart_account is null and bank_account is null
              and coalesce(private.cb_gifi_type(code), '') not in ('Revenue', 'Expense') order by code loop
    v_out := v_out || format('GIFI %s: pick an account.', r.code);
  end loop;
  return v_out;
end;
$$;

-- The first problem, for cb_sign_opening's refusal.
create or replace function private.cb_opening_problem(p_file uuid) returns text
language sql stable security definer set search_path = '' as $$
  select (private.cb_opening_problems(p_file))[1]
$$;

-- The standard chart accounts on a GIFI code (3660 takes those on 3600), in chart order.
create or replace function private.cb_chart_on_code(p_code text) returns text[]
language sql stable set search_path = '' as $$
  select coalesce(array_agg(c.number order by c.sort_order), '{}') from public.cb_chart_accounts c
   where c.line_no is not null and (left(c.line_no, 4) = p_code or (p_code = '3660' and left(c.line_no, 4) = '3600'))
$$;

create or replace function public.cb_save_opening(p_file uuid, p_codes jsonb, p_re_stated numeric, p_ni_typed numeric, p_note text)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_row jsonb;
  v_code text;
  v_acc text;
  v_bank uuid;
  v_on text[];
  v_n int := 0;
  v_before jsonb; v_after jsonb;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(jsonb_typeof(p_codes) = 'array' and jsonb_array_length(p_codes) <= 1000, 'Lines are missing.');
  delete from public.cb_opening_balances where file_id = p_file;
  for v_row in select * from jsonb_array_elements(p_codes) loop
    v_code := v_row ->> 'code';
    perform private.require(v_code ~ '^\d{4}$' and private.cb_gifi_type(v_code) is not null, format('GIFI %s is not a code Closebook can use.', v_code));
    perform private.require(v_code not in ('2599', '3499', '3600', '3620', '3640', '3680', '3849', '8299', '9368', '9999'), format('%s is a total: it calculates by itself.', v_code));
    v_acc := nullif(v_row ->> 'account', ''); v_bank := null;
    if v_acc like 'bank:%' then
      -- One of the file's bank or card accounts, on this GIFI line.
      select b.id into v_bank from public.cb_bank_accounts b join public.cb_chart_accounts c on c.number = b.chart_account
       where b.id = substr(v_acc, 6)::uuid and b.file_id = p_file and left(c.line_no, 4) = v_code;
      perform private.require(v_bank is not null, format('That bank account is not on GIFI line %s.', v_code));
      v_acc := null;
    end if;
    perform private.require(v_acc is null or v_acc = any(private.cb_chart_on_code(v_code)), format('Account %s is not on GIFI line %s.', v_acc, v_code));
    -- A Schedule 100 line with one standard account, and no bank account of the file on it, takes it.
    if v_acc is null and v_bank is null and private.cb_gifi_type(v_code) not in ('Revenue', 'Expense') then
      v_on := private.cb_chart_on_code(v_code);
      if cardinality(v_on) = 1 and not exists (select 1 from public.cb_bank_accounts b join public.cb_chart_accounts c on c.number = b.chart_account
                                                 where b.file_id = p_file and left(c.line_no, 4) = v_code) then
        v_acc := v_on[1];
      end if;
    end if;
    -- As printed on the T2; dividends (3700 to 3719) always negative (rule 3).
    insert into public.cb_opening_balances (file_id, code, amount, chart_account, bank_account)
    values (p_file, v_code, case when v_code::int between 3700 and 3719 then -abs(round((v_row ->> 'amount')::numeric, 2)) else round((v_row ->> 'amount')::numeric, 2) end, v_acc, v_bank)
    on conflict (file_id, code) do update set amount = public.cb_opening_balances.amount + excluded.amount;
    v_n := v_n + 1;
  end loop;
  update public.cb_files set opening_source = coalesce(opening_source, 'manual'), opening_re_stated = p_re_stated, opening_ni_typed = p_ni_typed,
         opening_note = left(coalesce(btrim(p_note), ''), 300), opening_set_by = (select auth.uid()), opening_set_at = now(),
         opening_signed_by = null, opening_signed_at = null, updated_at = now()
   where id = p_file;
  -- One place for last year's Schedule 125 (item 8): the tab's lines feed the statements' prior-year column.
  select coalesce(jsonb_agg(jsonb_build_array(code, amount) order by code), '[]'::jsonb) into v_before from public.cb_opening_s125 where file_id = p_file;
  delete from public.cb_opening_s125 where file_id = p_file;
  insert into public.cb_opening_s125 (file_id, code, amount)
  select p_file, code, amount from public.cb_opening_balances where file_id = p_file and amount <> 0 and private.cb_gifi_type(code) in ('Revenue', 'Expense');
  select coalesce(jsonb_agg(jsonb_build_array(code, amount) order by code), '[]'::jsonb) into v_after from public.cb_opening_s125 where file_id = p_file;
  if v_before <> v_after then perform private.cb_clear_step(p_file, 'statements', 'Last year''s Schedule 125 changed'); end if;
  return v_n;
end;
$$;
revoke all on function public.cb_save_opening(uuid, jsonb, numeric, numeric, text) from public, anon;
grant execute on function public.cb_save_opening(uuid, jsonb, numeric, numeric, text) to authenticated;

-- Step problems: step 2 lists each of its problems (was one line for the first only).
create or replace function private.cb_step_problems(p_file uuid, p_step text)
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
      if not exists (select 1 from public.cb_bank_accounts where file_id = p_file) then
        v_out := v_out || 'Add the bank and card accounts and upload their statements.'::text;
      else
        select count(*) into v_n from (
          select distinct a.id, date_trunc('month', d) from public.cb_bank_accounts a
           cross join generate_series(v_file.year_start::timestamp, v_file.year_end::timestamp, interval '1 day') d
           where a.file_id = p_file and not exists (select 1 from public.cb_bank_statements s where s.account_id = a.id and d::date between s.period_start and s.period_end)) x;
        if v_n > 0 then v_out := v_out || format('%s month%s of statements missing.', v_n, case when v_n = 1 then '' else 's' end); end if;
        select count(*) into v_n from (
          select opening, lag(closing) over (partition by account_id order by period_start) prev from public.cb_bank_statements where file_id = p_file) x
         where prev is not null and opening <> prev;
        if v_n > 0 then v_out := v_out || format('%s statement%s whose opening balance does not follow the one before.', v_n, case when v_n = 1 then '' else 's' end); end if;
        select count(*) into v_n from (
          select a.id, m from public.cb_bank_accounts a
           cross join generate_series(date_trunc('month', v_file.year_start::timestamp), v_file.year_end::timestamp, interval '1 month') m
           where a.file_id = p_file
             and exists (select 1 from public.cb_bank_statements s where s.account_id = a.id and s.period_start <= (m + interval '1 month - 1 day')::date and s.period_end >= m::date)
             and not exists (select 1 from public.cb_bank_lines l where l.file_id = p_file and l.account_id = a.id and date_trunc('month', l.txn_date::timestamp) = m)) x;
        if v_n > 0 then v_out := v_out || format('%s month%s with no transactions: check the statements are complete.', v_n, case when v_n = 1 then '' else 's' end); end if;
      end if;
    else
      if not exists (select 1 from public.cb_imports where file_id = p_file and target = 'this_year') then
        v_out := v_out || 'Import the trial balance.'::text;
      elsif (select coalesce(sum(this_year), 0) from public.cb_accounts where file_id = p_file) <> 0 then
        v_out := v_out || 'The trial balance does not balance: import it again.'::text;
      end if;
    end if;
  elsif p_step = 'code' then
    if v_bank then
      select count(*) into v_n from public.cb_bank_lines where file_id = p_file and status = 'new';
      if v_n > 0 then v_out := v_out || format('%s line%s to code.', v_n, case when v_n = 1 then '' else 's' end); end if;
      select count(*) into v_n from public.cb_bank_lines where file_id = p_file and status = 'ask_client';
      if v_n > 0 then v_out := v_out || format('%s line%s on the client''s question list.', v_n, case when v_n = 1 then '' else 's' end); end if;
    else
      select count(*) into v_n from public.cb_accounts a where a.file_id = p_file and a.line_no is null and not a.needs_reviewer
         and a.account_key not in ('chart:10900', 'opening', 'uncoded') and private.cb_account_used(a.id);
      if v_n > 0 then v_out := v_out || format('%s account%s to match to a GIFI line.', v_n, case when v_n = 1 then '' else 's' end); end if;
    end if;
  elsif p_step = 'entries' then
    select flag_amount, flag_percent into v_flag_amount, v_flag_percent from public.cb_settings limit 1;
    v_flag_amount := coalesce(v_flag_amount, 5000); v_flag_percent := coalesce(v_flag_percent, 20);
    select count(*) into v_n from (
      select a.id, private.cb_account_final(a.id) fin, a.last_year from public.cb_accounts a join public.cb_master_lines m on m.line_no = a.line_no
       where a.file_id = p_file and m.lead_sheet is not null and left(coalesce(a.line_no, ''), 4) not in ('3600', '3660')) x
     where abs(fin - last_year) > v_flag_amount and (last_year = 0 or abs(fin - last_year) / abs(last_year) * 100 > v_flag_percent)
       and not exists (select 1 from public.cb_flag_notes n where n.account_id = x.id);
    if v_n > 0 then v_out := v_out || format('%s flagged change%s to explain on the lead sheets.', v_n, case when v_n = 1 then '' else 's' end); end if;
    -- Round 9: the revenue check, and expenses paid personally when the setup says so.
    v_out := v_out || private.cb_step5_problems(p_file);
  elsif p_step = 'mapping' then
    select count(*) into v_n from public.cb_accounts a where a.file_id = p_file and a.line_no is null and not a.needs_reviewer
       and a.account_key not in ('chart:10900', 'opening', 'uncoded') and private.cb_account_used(a.id);
    if v_n > 0 then v_out := v_out || format('%s account%s with no GIFI line.', v_n, case when v_n = 1 then '' else 's' end); end if;
    if exists (select 1 from public.cb_accounts a where a.file_id = p_file and a.account_key = 'chart:10900' and private.cb_account_final(a.id) <> 0) then
      v_out := v_out || 'Clearing (10900) has a balance: move it to the right account.'::text;
    end if;
  end if;
  -- A review note not yet fixed is open work on its step.
  select count(*) into v_n from public.cb_review_notes where file_id = p_file and step = p_step and status = 'open';
  if v_n > 0 then v_out := v_out || format('%s review note%s to fix.', v_n, case when v_n = 1 then '' else 's' end); end if;
  return v_out;
end;
$function$;

-- Item 11: what the Issues panel lists under "With the reviewer". cb_step_waiting is the reviewer's own
-- sign-off list, so it counts every note not yet cleared (an open note stops the reviewer too); shown as
-- "With the reviewer" it repeated each open note already under "To fix" ("1 review note to fix" and
-- "1 review note to clear" for one note). Shown here: the same items, with only the notes the preparer
-- marked fixed, which are the ones waiting for the reviewer. The sign-off rules do not change.
create or replace function private.cb_step_waiting_shown(p_file uuid, p_step text) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v_out text[]; v_n int;
begin
  select coalesce(array_agg(w), '{}') into v_out from unnest(private.cb_step_waiting(p_file, p_step)) w where w not like '%review note%';
  select count(*) into v_n from public.cb_review_notes where file_id = p_file and step = p_step and status = 'fixed';
  if v_n > 0 then v_out := v_out || format('%s review note%s fixed, to clear.', v_n, case when v_n = 1 then '' else 's' end); end if;
  return v_out;
end;
$$;
revoke all on function private.cb_step_waiting_shown(uuid, text), private.cb_opening_problems(uuid), private.cb_chart_on_code(text), private.cb_bracket(numeric) from public, anon;

create or replace function public.cb_step_status(p_file uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v jsonb := '{}'::jsonb; s text; r public.cb_step_signoffs;
begin
  perform private.require(private.can_view('closebook'), 'You need Closebook access.');
  foreach s in array array['setup', 'opening', 'records', 'code', 'entries', 'review', 'mapping', 't2', 'statements', 'lock'] loop
    select * into r from public.cb_step_signoffs where file_id = p_file and step = s;
    v := v || jsonb_build_object(s, jsonb_build_object(
      'prepared_by', r.prepared_by, 'prepared_at', r.prepared_at, 'reviewed_by', r.reviewed_by, 'reviewed_at', r.reviewed_at,
      'problems', to_jsonb(case when s = 'review' then private.cb_review_problems(p_file) when s = 't2' then private.cb_step8_problems(p_file)
        when s = 'statements' then private.cb_step9_problems(p_file) when s = 'lock' then private.cb_step10_problems(p_file) else private.cb_step_problems(p_file, s) end),
      'waiting', to_jsonb(case when s in ('review', 't2', 'statements', 'lock') then '{}'::text[] else private.cb_step_waiting_shown(p_file, s) end),
      'notes', (select count(*) from public.cb_review_notes n where n.file_id = p_file and n.step = s and n.status <> 'cleared')));
  end loop;
  return v || jsonb_build_object('checklist', to_jsonb(private.cb_checklist_problems(p_file)));
end;
$function$;
revoke all on function public.cb_step_status(uuid) from public, anon;
grant execute on function public.cb_step_status(uuid) to authenticated;

-- Lines saved before this round on a GIFI code with a single standard account (only codes with a choice
-- were saved with one): put that account on them, as the save now does. The figures do not change, so
-- the sign-offs stay: the trigger that clears them is off for this update only.
alter table public.cb_opening_balances disable trigger cb_changed_opening;
update public.cb_opening_balances o set chart_account = (private.cb_chart_on_code(o.code))[1]
 where o.chart_account is null and o.bank_account is null and cardinality(private.cb_chart_on_code(o.code)) = 1
   and coalesce(private.cb_gifi_type(o.code), '') not in ('Revenue', 'Expense')
   and exists (select 1 from public.cb_files f where f.id = o.file_id and f.phase <> 'locked')   -- a locked file stays as delivered
   and not exists (select 1 from public.cb_bank_accounts b join public.cb_chart_accounts c on c.number = b.chart_account
                    where b.file_id = o.file_id and left(c.line_no, 4) = o.code);
alter table public.cb_opening_balances enable trigger cb_changed_opening;
