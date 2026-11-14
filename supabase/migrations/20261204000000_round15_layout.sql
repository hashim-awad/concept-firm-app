-- Round 15 (Hashim, Nov 14, 2026): the Closebook layout clean-up, as CaseWare Cloud. Nothing about how
-- anything works changes, except two things Hashim asked for with it. Safe to run twice.
-- 1. The two shareholder lead sheets are named for their side, as the trial balance groups them.
update public.cb_lead_sheets set name = 'Due from shareholder and related parties' where code = 'H' and name <> 'Due from shareholder and related parties';
update public.cb_lead_sheets set name = 'Due to shareholder and related parties' where code = 'CC' and name <> 'Due to shareholder and related parties';

-- 2. No year-over-year flag on retained earnings at the start of the year (GIFI 3600 and 3660): its
-- change is last year's net income, not something to explain. Step 5's rules as round 9 left them,
-- with that one line added to the flagged-change count.
create or replace function private.cb_step_problems(p_file uuid, p_step text) returns text[]
language plpgsql stable security definer set search_path = '' as $$
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
  elsif p_step = 'opening' then
    if v_bank then
      v_txt := private.cb_opening_problem(p_file);
      if v_txt is not null then v_out := v_out || v_txt; end if;
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
$$;

revoke all on function private.cb_step_problems(uuid, text) from public, anon, authenticated;
