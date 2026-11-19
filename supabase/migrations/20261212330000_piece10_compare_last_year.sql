-- Piece 10, version 2 (Hashim, Nov 19, 2026; benchmark CaseWare Cloud's analytical review): step 6 becomes "Compare to last year".
--   * Step 6 has a new key, 'compare'. The key 'mapping' retires and is never reused; the key rules still accept it so old rows
--     fit, and nothing reads them. The new step 6 starts unsigned on every file: no sign-off is copied.
--   * Step 6, the preparer's: every flagged change explained (moved from step 5), every used account on a GIFI line and Clearing
--     (10900) at zero (moved from the old step 6), every new account confirmed, the accounts not used this year seen, the six
--     "What changed this year" questions answered (a "yes" needs a short note).
--   * Step 7 gains: no account waiting for the reviewer, no open type or wrong-side flag (moved from the old step 6), every new
--     account marked reviewed, every "yes" answer marked reviewed. It keeps pieces 7 and 8.
--   * Clearing: an explanation, a tick or an answer clears step 6 (and step 7 through the chain), not step 5 or step 8. A GIFI
--     line, tax code or type change clears steps 6, 7 and 8 (and step 4 on a trial balance file), as 'mapping' did. The owner's
--     decision on an account sent to the reviewer still clears nothing. A TJE still clears step 8 only (piece 6).
-- No table or column is dropped. No data is changed. Safe to run twice.

-- 1. The key rules: 'compare' added, 'mapping' kept so old rows still fit.
alter table public.cb_step_signoffs drop constraint if exists cb_step_signoffs_step_check;
alter table public.cb_step_signoffs add constraint cb_step_signoffs_step_check
  check (step in ('setup', 'opening', 'records', 'code', 'entries', 'compare', 'review', 'mapping', 't2', 'statements', 'lock'));
alter table public.cb_review_notes drop constraint if exists cb_review_notes_step_check;
alter table public.cb_review_notes add constraint cb_review_notes_step_check
  check (step in ('setup', 'opening', 'records', 'code', 'entries', 'compare', 'review', 'mapping', 't2', 'statements', 'lock'));

-- 2. Step 6's three new records.
-- New accounts this year: the preparer's "Confirmed" (with the GIFI line it was confirmed on) and the reviewer's "Mark reviewed"
-- in step 7 (with its line). A changed GIFI line needs both again.
create table if not exists public.cb_new_accounts (
  file_id        uuid not null references public.cb_files (id) on delete cascade,
  account_key    text not null,
  confirmed_line text,
  confirmed_by   uuid references public.staff (id),
  confirmed_at   timestamptz not null default now(),
  reviewed_line  text,
  reviewed_by    uuid references public.staff (id),
  reviewed_at    timestamptz,
  primary key (file_id, account_key)
);
-- Accounts not used this year: one "Seen" tick for the section, kept for the list it was ticked on.
create table if not exists public.cb_compare_seen (
  file_id  uuid primary key references public.cb_files (id) on delete cascade,
  seen_key text not null,
  seen_by  uuid references public.staff (id),
  seen_at  timestamptz not null default now()
);
-- What changed this year: six yes/no questions; a "yes" needs a short note and is marked reviewed in step 7.
create table if not exists public.cb_year_changes (
  file_id     uuid not null references public.cb_files (id) on delete cascade,
  question    text not null check (question in ('assets', 'loans', 'shareholders', 'related', 'revenue', 'equity')),
  answer      boolean not null,
  note        text not null default '' check (length(note) <= 300),
  answered_by uuid references public.staff (id),
  answered_at timestamptz not null default now(),
  reviewed_by uuid references public.staff (id),
  reviewed_at timestamptz,
  primary key (file_id, question),
  check (not answer or length(btrim(note)) >= 3)
);
do $$ declare t text;
begin
  foreach t in array array['cb_new_accounts', 'cb_compare_seen', 'cb_year_changes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists "Closebook viewers read" on public.%I', t);
    execute format('create policy "Closebook viewers read" on public.%I for select to authenticated using ((select private.can_view(''closebook'')))', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop trigger if exists cb_locked_guard on public.%I', t);
    execute format('create trigger cb_locked_guard before insert or update or delete on public.%I for each row execute function private.cb_locked_guard()', t);
  end loop;
end $$;

-- The six questions, as the page words them.
create or replace function private.cb_year_question(p_key text) returns text
language sql immutable set search_path = '' as $$
  select case p_key when 'assets' then 'Assets bought or sold' when 'loans' then 'Loans taken or repaid'
    when 'shareholders' then 'Shareholders or share capital changed' when 'related' then 'Related-party transactions (rent, management fees, loans)'
    when 'revenue' then 'Revenue from a new source, or a source that stopped' when 'equity' then 'Negative equity at year-end' else p_key end;
$$;

-- New accounts (a balance this year, none last year) and accounts not used this year (a balance last year, none this year).
-- "This year" is the final balance, after entries. System rows and Clearing (10900) are left out.
create or replace function private.cb_compare_accounts(p_file uuid)
returns table (kind text, account_id uuid, account_key text, line_no text, last_year numeric, final numeric)
language sql stable security definer set search_path = '' as $$
  select case when x.last_year = 0 then 'new' else 'unused' end, x.id, x.account_key, x.line_no, x.last_year, x.fin
    from (select a.id, a.account_key, a.line_no, a.last_year, private.cb_account_final(a.id) fin from public.cb_accounts a
           where a.file_id = p_file and a.account_key not in ('opening', 'uncoded', 'chart:10900')) x
   where (x.last_year = 0 and x.fin <> 0) or (x.last_year <> 0 and x.fin = 0);
$$;
create or replace function private.cb_unused_key(p_file uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(string_agg(c.account_key, ',' order by c.account_key), '') from private.cb_compare_accounts(p_file) c where c.kind = 'unused';
$$;

-- The reviewer's GIFI checks (they waited in the old step 6; step 7's gate from piece 10).
create or replace function private.cb_gifi_review_waiting(p_file uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v_out text[] := '{}'; v_n int;
begin
  select count(*) into v_n from public.cb_accounts where file_id = p_file and needs_reviewer and account_key not in ('opening', 'uncoded');
  if v_n > 0 then v_out := v_out || format('%s account%s waiting for the reviewer''s decision.', v_n, case when v_n = 1 then '' else 's' end); end if;
  v_n := private.cb_open_type_flags(p_file);
  if v_n > 0 then v_out := v_out || format('%s account%s on a GIFI line of another type.', v_n, case when v_n = 1 then '' else 's' end); end if;
  v_n := private.cb_open_side_flags(p_file);
  if v_n > 0 then v_out := v_out || format('%s account%s with a balance on the wrong side of its GIFI line.', v_n, case when v_n = 1 then '' else 's' end); end if;
  return v_out;
end;
$$;

-- Step 7's new items: the new accounts marked reviewed, the "yes" answers marked reviewed.
create or replace function private.cb_compare_review_problems(p_file uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v_out text[] := '{}'; v_n int;
begin
  select count(*) into v_n from private.cb_compare_accounts(p_file) c where c.kind = 'new'
     and not exists (select 1 from public.cb_new_accounts n where n.file_id = p_file and n.account_key = c.account_key
                       and n.reviewed_at is not null and n.reviewed_line is not distinct from c.line_no);
  if v_n > 0 then v_out := v_out || format('New accounts this year: %s to mark reviewed.', v_n); end if;
  select count(*) into v_n from public.cb_year_changes where file_id = p_file and answer and reviewed_at is null;
  if v_n > 0 then v_out := v_out || format('What changed this year: %s "yes" answer%s to mark reviewed.', v_n, case when v_n = 1 then '' else 's' end); end if;
  return v_out;
end;
$$;

-- 3. Step 6's actions.
-- "Confirmed": the preparer confirms a new account and its GIFI line. Off removes the tick (and the reviewer's mark with it).
create or replace function public.cb_confirm_new_account(p_file uuid, p_account text, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files; c record;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  if not p_on then
    delete from public.cb_new_accounts where file_id = p_file and account_key = p_account;
    if found then perform private.cb_log(p_file, 'new_account_unconfirmed', 'compare', p_account); end if;
    return;
  end if;
  select * into c from private.cb_compare_accounts(p_file) x where x.kind = 'new' and x.account_key = p_account;
  perform private.require(c.account_key is not null, 'This account is not new this year.');
  perform private.require(c.line_no is not null, 'Match the account to a GIFI line first.');
  insert into public.cb_new_accounts (file_id, account_key, confirmed_line, confirmed_by) values (p_file, p_account, c.line_no, (select auth.uid()))
  on conflict (file_id, account_key) do update set confirmed_line = excluded.confirmed_line, confirmed_by = excluded.confirmed_by, confirmed_at = now(),
    reviewed_line = null, reviewed_by = null, reviewed_at = null
   where public.cb_new_accounts.confirmed_line is distinct from excluded.confirmed_line;
  if found then perform private.cb_log(p_file, 'new_account_confirmed', 'compare', format('%s on GIFI %s', p_account, replace(c.line_no, '.00', ''))); end if;
end;
$$;

-- "Mark reviewed" in step 7: the reviewer's, after the preparer's tick.
create or replace function public.cb_review_new_account(p_file uuid, p_account text, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files; c record;
begin
  perform private.require(private.can_edit('closebook') and private.is_owner(), 'Only the reviewer marks it reviewed. Reviewers are owners.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  select * into c from private.cb_compare_accounts(p_file) x where x.kind = 'new' and x.account_key = p_account;
  perform private.require(c.account_key is not null, 'This account is not new this year.');
  perform private.require(exists (select 1 from public.cb_new_accounts n where n.file_id = p_file and n.account_key = p_account and n.confirmed_line is not distinct from c.line_no),
    'The preparer confirms it in step 6 first.');
  update public.cb_new_accounts set reviewed_line = case when p_on then c.line_no end, reviewed_by = case when p_on then (select auth.uid()) end,
    reviewed_at = case when p_on then now() end
   where file_id = p_file and account_key = p_account
     and (reviewed_at is null) = p_on;
  if found then perform private.cb_log(p_file, case when p_on then 'new_account_reviewed' else 'new_account_unreviewed' end, 'review', p_account); end if;
end;
$$;

-- "Seen": one tick for the accounts not used this year. A changed list needs it again.
create or replace function public.cb_seen_unused(p_file uuid, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files; v_key text;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  if not p_on then
    delete from public.cb_compare_seen where file_id = p_file;
    if found then perform private.cb_log(p_file, 'unused_unseen', 'compare', ''); end if;
    return;
  end if;
  v_key := private.cb_unused_key(p_file);
  perform private.require(v_key <> '', 'No account is unused this year.');
  insert into public.cb_compare_seen (file_id, seen_key, seen_by) values (p_file, v_key, (select auth.uid()))
  on conflict (file_id) do update set seen_key = excluded.seen_key, seen_by = excluded.seen_by, seen_at = now()
   where public.cb_compare_seen.seen_key is distinct from excluded.seen_key;
  if found then perform private.cb_log(p_file, 'unused_seen', 'compare', 'Accounts not used this year: ' || replace(v_key, ',', ', ')); end if;
end;
$$;

-- "What changed this year": Yes or No; a "yes" needs a short note. A null answer clears the question.
create or replace function public.cb_answer_year_change(p_file uuid, p_question text, p_answer boolean, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files; v_note text := btrim(coalesce(p_note, ''));
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(p_question in ('assets', 'loans', 'shareholders', 'related', 'revenue', 'equity'), 'Unknown question.');
  if p_answer is null then
    delete from public.cb_year_changes where file_id = p_file and question = p_question;
    if found then perform private.cb_log(p_file, 'year_change', 'compare', private.cb_year_question(p_question) || ': answer removed'); end if;
    return;
  end if;
  if not p_answer then v_note := ''; end if;
  perform private.require(not p_answer or length(v_note) >= 3, 'A "yes" needs a short note.');
  perform private.require(length(v_note) <= 300, 'Keep the note to 300 characters.');
  insert into public.cb_year_changes (file_id, question, answer, note, answered_by) values (p_file, p_question, p_answer, v_note, (select auth.uid()))
  on conflict (file_id, question) do update set answer = excluded.answer, note = excluded.note, answered_by = excluded.answered_by, answered_at = now(),
    reviewed_by = null, reviewed_at = null
   where public.cb_year_changes.answer is distinct from excluded.answer or public.cb_year_changes.note is distinct from excluded.note;
  if found then perform private.cb_log(p_file, 'year_change', 'compare', private.cb_year_question(p_question) || ': '
    || case when p_answer then 'Yes. ' || v_note else 'No' end); end if;
end;
$$;

-- A "yes" marked reviewed in step 7 (the reviewer's).
create or replace function public.cb_review_year_change(p_file uuid, p_question text, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files;
begin
  perform private.require(private.can_edit('closebook') and private.is_owner(), 'Only the reviewer marks it reviewed. Reviewers are owners.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(exists (select 1 from public.cb_year_changes where file_id = p_file and question = p_question and answer), 'Only a "yes" answer is marked reviewed.');
  update public.cb_year_changes set reviewed_by = case when p_on then (select auth.uid()) end, reviewed_at = case when p_on then now() end
   where file_id = p_file and question = p_question and (reviewed_at is null) = p_on;
  if found then perform private.cb_log(p_file, case when p_on then 'year_change_reviewed' else 'year_change_unreviewed' end, 'review', private.cb_year_question(p_question)); end if;
end;
$$;

revoke all on function private.cb_year_question(text), private.cb_compare_accounts(uuid), private.cb_unused_key(uuid),
  private.cb_gifi_review_waiting(uuid), private.cb_compare_review_problems(uuid) from public, anon, authenticated;
revoke all on function public.cb_confirm_new_account(uuid, text, boolean), public.cb_review_new_account(uuid, text, boolean),
  public.cb_seen_unused(uuid, boolean), public.cb_answer_year_change(uuid, text, boolean, text), public.cb_review_year_change(uuid, text, boolean) from public, anon;
grant execute on function public.cb_confirm_new_account(uuid, text, boolean), public.cb_review_new_account(uuid, text, boolean),
  public.cb_seen_unused(uuid, boolean), public.cb_answer_year_change(uuid, text, boolean, text), public.cb_review_year_change(uuid, text, boolean) to authenticated;

-- 4. The functions that name the step keys (each as on main, with 'compare' for step 6).

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
  else
    perform private.cb_clear_step(v_file, v_step, coalesce(nullif(v_txt, ''), v_why));
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
    if v_n > 0 then v_out := v_out || format('%s flagged change%s to explain on the lead sheets.', v_n, case when v_n = 1 then '' else 's' end); end if;
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

CREATE OR REPLACE FUNCTION private.cb_step_waiting(p_file uuid, p_step text)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_out text[] := '{}';
  v_n int;
begin
  if p_step = 'opening' then
    if exists (select 1 from public.cb_accounts where file_id = p_file and account_key = 'opening' and needs_reviewer) then
      v_out := v_out || 'A difference with last year''s closing balances.'::text;
    end if;
  elsif p_step = 'code' then
    select count(*) into v_n from public.cb_bank_lines where file_id = p_file and status = 'reviewer';
    if v_n > 0 then v_out := v_out || format('%s line%s for the reviewer.', v_n, case when v_n = 1 then '' else 's' end); end if;
  elsif p_step = 'entries' then
    select count(*) into v_n from public.cb_entries where file_id = p_file and needs_review and reviewed_at is null;
    if v_n > 0 then v_out := v_out || format('%s entr%s to approve.', v_n, case when v_n = 1 then 'y' else 'ies' end); end if;
    v_out := v_out || private.cb_step5_waiting(p_file);
  elsif p_step = 'mapping' then
    -- Piece 10: the key retired; the reviewer's GIFI checks wait in step 7 (private.cb_review_problems). Kept for old callers.
    v_out := v_out || private.cb_gifi_review_waiting(p_file);
  end if;
  select count(*) into v_n from public.cb_review_notes where file_id = p_file and step = p_step and status <> 'cleared';
  if v_n > 0 then v_out := v_out || format('%s review note%s to clear.', v_n, case when v_n = 1 then '' else 's' end); end if;
  return v_out;
end;
$function$;

CREATE OR REPLACE FUNCTION private.cb_review_problems(p_file uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_out text[] := '{}';
  v_n int;
  v_names text;
begin
  select string_agg(n.label, ', ' order by n.ord) into v_names from (values
    ('setup', 'step 1', 1), ('opening', 'step 2', 2), ('records', 'step 3', 3), ('code', 'step 4', 4), ('entries', 'step 5', 5), ('compare', 'step 6', 6)) n(step, label, ord)
   where not exists (select 1 from public.cb_step_signoffs s where s.file_id = p_file and s.step = n.step and s.reviewed_at is not null);
  if v_names is not null then v_out := v_out || format('Review %s first.', v_names); end if;
  select count(*) into v_n from public.cb_review_notes where file_id = p_file and status <> 'cleared';
  if v_n > 0 then v_out := v_out || format('%s review note%s still open.', v_n, case when v_n = 1 then '' else 's' end); end if;
  select count(*) into v_n from (select unnest(private.cb_step_waiting(p_file, s)) w from unnest(array['opening', 'code', 'entries']) s) x
   where w not like '%review note%';
  -- Piece 7: the GST/HST returns difference (now in step 8) still waits for the reviewer here, as it did from step 5.
  if coalesce((private.cb_revenue_state(p_file) ->> 'gst_waiting')::boolean, false) then v_n := v_n + 1; end if;
  if v_n > 0 then v_out := v_out || 'Items still wait for the reviewer: see the list above.'::text; end if;
  -- Piece 10: the reviewer's GIFI checks (moved from the old step 6), the new accounts and the "yes" answers of step 6.
  v_out := v_out || private.cb_gifi_review_waiting(p_file) || private.cb_compare_review_problems(p_file);
  -- Piece 8: the shareholder loans, answered by the reviewer here.
  return v_out || private.cb_sh_review_problems(p_file);
end;
$function$;

CREATE OR REPLACE FUNCTION private.cb_lock_problems(p_file uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_out text[] := '{}'; v_file public.cb_files; c public.cb_file_close; s record; st record; v_bank boolean; g public.cb_gst_returns;
begin
  select * into v_file from public.cb_files where id = p_file;
  v_bank := v_file.books in ('statements', 'paper');
  for st in select * from (values (1, 'setup', 'Set up the file'), (2, 'opening', 'Opening balances'),
                                  (3, 'records', case when v_bank then 'Bank statements' else 'Get the records' end),
                                  (4, 'code', case when v_bank then 'Code the transactions' else 'Match accounts to GIFI' end),
                                  (5, 'entries', 'Adjusting entries'), (6, 'compare', 'Compare to last year'), (7, 'review', 'Review'),
                                  (8, 't2', 'T2 tie-out'), (9, 'statements', 'Statements')) as x(n, k, name) order by n loop
    if not exists (select 1 from public.cb_step_signoffs where file_id = p_file and step = st.k and reviewed_at is not null) then
      v_out := v_out || format('Step %s, %s: not signed by the reviewer.', st.n, st.name);
    end if;
  end loop;
  select * into s from private.cb_mal_signed_row(p_file) as (signed_at timestamptz, signed_name text, signed_title text);
  if s.signed_at is null then v_out := v_out || 'The MAL is not signed.'::text;
  else v_out := v_out || (select coalesce(array_agg('Checklist: ' || x), '{}') from unnest(private.cb_checklist_problems(p_file)) x); end if;
  if not exists (select 1 from public.cb_step_signoffs where file_id = p_file and step = 'lock' and reviewed_at is not null) then
    v_out := v_out || 'Step 10: not signed by the reviewer (the email is still a draft).'::text;
  end if;
  select * into c from public.cb_file_close where file_id = p_file;
  if c.delivered_at is null then v_out := v_out || 'The documents are not delivered: tick "Uploaded to TaxDome and email sent".'::text; end if;
  if coalesce(c.efile_number, '') = '' then v_out := v_out || 'The EFILE confirmation number is not recorded.'::text; end if;
  -- Round 13: each GST/HST return of the year, its filing date and CRA confirmation number.
  if private.cb_gst_applies(p_file) then
    for g in select * from public.cb_gst_returns where file_id = p_file order by period_no loop
      if g.filed_on is null or coalesce(g.confirmation, '') = '' then
        v_out := v_out || format('GST/HST return %s: the filing date and CRA confirmation number are not recorded.', g.label);
      end if;
    end loop;
  end if;
  return v_out;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_sign_step(p_file uuid, p_step text, p_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file public.cb_files; r public.cb_step_signoffs; v_list text[];
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(p_step in ('setup', 'opening', 'records', 'code', 'entries', 'compare', 'review', 't2', 'statements', 'lock'), 'Unknown step.');
  perform private.require(p_role in ('prepared', 'reviewed'), 'Unknown sign-off.');
  perform private.require(not (p_step = 'records' and v_file.books in ('statements', 'paper')), 'Step 3 is signed in its sub-steps: 3.1, 3.2 and 3.3.');
  select * into r from public.cb_step_signoffs where file_id = p_file and step = p_step;
  if p_role = 'prepared' then
    perform private.require(p_step <> 'review', 'Step 7 is the reviewer''s: it has no preparer sign-off.');
    perform private.require(r.prepared_at is null, 'This step is already signed as prepared.');
    v_list := case when p_step = 't2' then private.cb_step8_problems(p_file) when p_step = 'statements' then private.cb_step9_problems(p_file)
      when p_step = 'lock' then private.cb_step10_problems(p_file) else private.cb_prepare_blockers(p_file, p_step) end;
    perform private.require(cardinality(v_list) = 0, 'Not yet: ' || array_to_string(v_list, ' '));
    if p_step = 'opening' and v_file.books in ('statements', 'paper') then
      perform public.cb_sign_opening(p_file);
      return;
    end if;
    insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at) values (p_file, p_step, (select auth.uid()), now())
    on conflict (file_id, step) do update set prepared_by = excluded.prepared_by, prepared_at = excluded.prepared_at;
    perform private.cb_log(p_file, 'prepared', p_step, '');
  else
    perform private.require(private.is_owner(), 'Only the reviewer signs as reviewer. Reviewers are owners.');
    perform private.require(r.reviewed_at is null, 'This step is already reviewed.');
    if p_step = 'review' then
      v_list := private.cb_review_problems(p_file);
      perform private.require(cardinality(v_list) = 0, 'Not yet: ' || array_to_string(v_list, ' '));
      insert into public.cb_step_signoffs (file_id, step, reviewed_by, reviewed_at) values (p_file, 'review', (select auth.uid()), now())
      on conflict (file_id, step) do update set reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at;
    else
      perform private.require(r.prepared_at is not null, 'The preparer signs first.');
      v_list := case when p_step = 't2' then coalesce((select array_agg(x) from unnest(private.cb_step8_problems(p_file)) x where x not like '%review note%'), '{}')
        when p_step = 'statements' then coalesce((select array_agg(x) from unnest(private.cb_step9_problems(p_file)) x where x not like '%review note%'), '{}')
        when p_step = 'lock' then coalesce((select array_agg(x) from unnest(private.cb_step10_problems(p_file)) x where x not like '%review note%'), '{}')
        else private.cb_step_waiting(p_file, p_step)
          || coalesce((select array_agg(x) from unnest(private.cb_step_problems(p_file, p_step)) x where x not like '%review note%'), '{}') end;
      perform private.require(cardinality(v_list) = 0, 'Not yet: ' || array_to_string(v_list, ' '));
      update public.cb_step_signoffs set reviewed_by = (select auth.uid()), reviewed_at = now() where file_id = p_file and step = p_step;
    end if;
    perform private.cb_log(p_file, 'reviewed', p_step, case when r.prepared_by = (select auth.uid()) then 'Prepared and reviewed by the same person' else '' end);
  end if;
  update public.cb_files set updated_at = now() where id = p_file;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_step_status(p_file uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v jsonb := '{}'::jsonb; s text; r public.cb_step_signoffs;
begin
  perform private.require(private.can_view('closebook'), 'You need Closebook access.');
  foreach s in array array['setup', 'opening', 'records', 'code', 'entries', 'compare', 'review', 't2', 'statements', 'lock'] loop
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

CREATE OR REPLACE FUNCTION public.cb_add_note(p_file uuid, p_step text, p_target_type text, p_target uuid, p_body text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_file public.cb_files;
  v_label text := '';
  v_id uuid;
begin
  perform private.require(private.can_edit('closebook') and private.is_owner(), 'Only the reviewer adds review notes. Reviewers are owners.');
  select * into v_file from public.cb_files where id = p_file;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(p_step in ('setup', 'opening', 'records', 'code', 'entries', 'compare', 'review'), 'Choose a step.');
  perform private.require(length(btrim(coalesce(p_body, ''))) between 1 and 2000, 'Type the note (up to 2,000 characters).');
  if p_target_type = 'account' then
    select btrim(coalesce(nullif(number, '') || ' ', '') || name) into v_label from public.cb_accounts where id = p_target and file_id = p_file;
  elsif p_target_type = 'entry' then
    select format('Entry %s-%s', to_char(v_file.year_end, 'YYYY'), lpad(seq::text, 3, '0')) into v_label from public.cb_entries where id = p_target and file_id = p_file;
  elsif p_target_type = 'bank_line' then
    select format('%s %s %s', to_char(txn_date, 'Mon FMDD'), left(description, 80), to_char(amount, 'FM999,999,990.00')) into v_label from public.cb_bank_lines where id = p_target and file_id = p_file;
  else
    perform private.require(p_target_type = 'step' and p_target is null, 'Unknown note target.');
  end if;
  perform private.require(p_target_type = 'step' or v_label is not null, 'That item is not in this file.');
  insert into public.cb_review_notes (file_id, step, target_type, target_id, target_label, body, created_by)
  values (p_file, p_step, p_target_type, case when p_target_type = 'step' then null else p_target end, coalesce(v_label, ''), btrim(p_body), (select auth.uid()))
  returning id into v_id;
  perform private.cb_log(p_file, 'note_added', p_step, left(btrim(p_body), 200));
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_clear_typed_step(p_file uuid, p_step text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_file public.cb_files;
  v_n int;
  v_bank boolean;
  v_new jsonb;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null, 'File not found.');
  perform private.require(v_file.phase <> 'locked', 'This file is locked. Nothing was cleared.');
  v_n := array_position(array['setup', 'opening', 'records', 'code', 'entries', 'compare', 'review', 't2', 'statements', 'lock'], p_step);
  perform private.require(v_n is not null, 'Unknown step.');
  perform private.require(not exists (select 1 from public.cb_step_signoffs s where s.file_id = p_file and s.step = p_step
                                       and (s.prepared_at is not null or s.reviewed_at is not null)),
    format('Step %s is signed. Take back the sign-off first.', v_n));
  perform private.require(p_step not in ('records', 'review'), format('Nothing is typed on step %s. Imports and uploads are removed where they are listed.', v_n));
  v_bank := v_file.books in ('statements', 'paper');

  if p_step = 'setup' then
    v_new := '{}'::jsonb;
    update public.cb_files set setup = v_new, updated_at = now() where id = p_file;
    -- As cb_save_setup: GST/HST answers that change how tax is worked out send the taxed work back to the reviewer.
    if coalesce((v_file.setup ->> 'gst_registered')::boolean, true) is distinct from true
       or coalesce((v_file.setup ->> 'quick_method')::boolean, false) is distinct from false then
      update public.cb_bank_lines l set status = 'reviewer', reviewer_reason = 'The GST/HST answers changed: the sales tax was worked out again. Check it.'
       where l.file_id = p_file and l.status = 'done'
         and exists (select 1 from public.cb_sales_tax_parts p where p.code = l.tax_code and p.rate > 0);
      update public.cb_entries e set needs_review = true, reviewed_at = null, reviewed_by = null
       where e.file_id = p_file and exists (select 1 from public.cb_entry_lines x where x.entry_id = e.id and x.tax_code is not null);
    end if;
    delete from public.cb_acceptance where file_id = p_file;
  elsif p_step = 'opening' then
    delete from public.cb_opening_balances where file_id = p_file;
    delete from public.cb_opening_s125 where file_id = p_file;
    update public.cb_files set opening_source = null, opening_re_stated = null, opening_ni_typed = null, opening_note = '',
      opening_set_by = null, opening_set_at = null, first_year = false, updated_at = now() where id = p_file;
  elsif p_step = 'code' then
    if v_bank then
      delete from public.cb_bank_transfers where file_id = p_file;
      update public.cb_bank_lines set status = 'new', chart_account = null, tax_code = null, reviewer_reason = '', source = '', coded_by = null, coded_at = null
       where file_id = p_file and status in ('done', 'ask_client', 'reviewer');
    else
      update public.cb_accounts set line_no = null, mapping_source = null, mapped_by = null, mapped_at = null
       where file_id = p_file and mapping_source = 'preparer';
    end if;
  elsif p_step = 'entries' then
    delete from public.cb_revenue_sources where file_id = p_file;
    delete from public.cb_revenue_checks where file_id = p_file;
    update public.cb_sh_flags set note = '', noted_by = null, noted_at = null where file_id = p_file and (note <> '' or noted_at is not null);
    delete from public.cb_sh_repaid where file_id = p_file;
  elsif p_step = 'compare' then
    -- Piece 10: what the preparer types in step 6: the explanations, the ticks and the answers.
    delete from public.cb_flag_notes where file_id = p_file;
    delete from public.cb_new_accounts where file_id = p_file;
    delete from public.cb_compare_seen where file_id = p_file;
    delete from public.cb_year_changes where file_id = p_file;
  elsif p_step = 't2' then
    delete from public.cb_t2_tieouts where file_id = p_file;
  elsif p_step = 'statements' then
    perform private.require(not exists (select 1 from public.cb_file_fs where file_id = p_file and mal_quote_id is not null),
      'The MAL is out for signature. Withdraw it first.');
    update public.cb_file_fs set dividends = '[]'::jsonb, updated_by = null, updated_at = now() where file_id = p_file;
  elsif p_step = 'lock' then
    delete from public.cb_checklist_answers where file_id = p_file;
    update public.cb_file_close set tax_balance = null, tax_due = null, noa_issued = null, noa_penalty = 0, noa_interest = 0,
      hst_filed = false, hst_balance = null, hst_due = null, fed_tax = null, prov_tax = null, fed_tax_prior = null, prov_tax_prior = null,
      instalments = '[]'::jsonb, updated_at = now()
     where file_id = p_file;
  end if;

  perform private.cb_log(p_file, 'step_cleared', p_step, format('Everything typed in step %s cleared', v_n));
  -- The review rests on every step.
  perform private.cb_clear_step(p_file, 'review', format('Step %s was cleared', v_n));
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_confirm_side(p_account uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.cb_accounts;
begin
  perform private.require(private.can_edit('closebook') and private.is_owner(), 'Only the reviewer keeps a balance on this side. Reviewers are owners.');
  select * into a from public.cb_accounts where id = p_account;
  perform private.require(a.id is not null and (select phase from public.cb_files where id = a.file_id) <> 'locked', 'This file is locked or the account is gone.');
  perform private.require(private.cb_side_open(p_account), 'This balance is not on the wrong side of its line.');
  perform private.require(length(btrim(coalesce(p_reason, ''))) between 3 and 300, 'Type the reason for keeping it on this line.');
  update public.cb_accounts set side_confirm_reason = btrim(p_reason), side_confirmed_line = line_no, side_confirmed_by = (select auth.uid()), side_confirmed_at = now() where id = p_account;
  perform private.cb_log(a.file_id, 'side_confirmed', 'review', format('%s kept on GIFI %s: %s', btrim(coalesce(nullif(a.number, '') || ' ', '') || a.name), replace(a.line_no, '.00', ''), btrim(p_reason)));
end;
$function$;

-- 5. The triggers. A GIFI line, tax code or type change names step 6 (cb_changed also clears step 8, and step 4 on a trial
-- balance file); an explanation names step 6, not step 5.
drop trigger if exists cb_changed_mapping on public.cb_accounts;
create trigger cb_changed_mapping after update of line_no, tax_code, type_confirm_reason, type_confirmed_line on public.cb_accounts for each row
  when (old.line_no is distinct from new.line_no or old.tax_code is distinct from new.tax_code
        or old.type_confirm_reason is distinct from new.type_confirm_reason or old.type_confirmed_line is distinct from new.type_confirmed_line)
  execute function private.cb_changed('compare', 'An account''s GIFI line or tax code changed');
drop trigger if exists cb_changed_flag_notes on public.cb_flag_notes;
create trigger cb_changed_flag_notes after insert or update or delete on public.cb_flag_notes for each row
  execute function private.cb_changed('compare', 'A lead sheet explanation changed');
-- Step 6's ticks and answers clear step 6; the reviewer's "Mark reviewed" on them clears step 7 only.
drop trigger if exists cb_changed_new_accounts on public.cb_new_accounts;
create trigger cb_changed_new_accounts after insert or delete on public.cb_new_accounts for each row
  execute function private.cb_changed('compare', 'A new account''s tick changed');
drop trigger if exists cb_changed_new_accounts_line on public.cb_new_accounts;
create trigger cb_changed_new_accounts_line after update of confirmed_line on public.cb_new_accounts for each row
  when (old.confirmed_line is distinct from new.confirmed_line)
  execute function private.cb_changed('compare', 'A new account''s tick changed');
drop trigger if exists cb_changed_new_accounts_review on public.cb_new_accounts;
create trigger cb_changed_new_accounts_review after update of reviewed_at on public.cb_new_accounts for each row
  when ((old.reviewed_at is null) <> (new.reviewed_at is null) and old.confirmed_line is not distinct from new.confirmed_line)
  execute function private.cb_changed('review', 'A new account''s review mark changed');
drop trigger if exists cb_changed_compare_seen on public.cb_compare_seen;
create trigger cb_changed_compare_seen after insert or update or delete on public.cb_compare_seen for each row
  execute function private.cb_changed('compare', 'Accounts not used this year: the Seen tick changed');
drop trigger if exists cb_changed_year_changes on public.cb_year_changes;
create trigger cb_changed_year_changes after insert or delete on public.cb_year_changes for each row
  execute function private.cb_changed('compare', 'An answer changed');
drop trigger if exists cb_changed_year_changes_answer on public.cb_year_changes;
create trigger cb_changed_year_changes_answer after update of answer, note on public.cb_year_changes for each row
  when (old.answer is distinct from new.answer or old.note is distinct from new.note)
  execute function private.cb_changed('compare', 'An answer changed');
drop trigger if exists cb_changed_year_changes_review on public.cb_year_changes;
create trigger cb_changed_year_changes_review after update of reviewed_at on public.cb_year_changes for each row
  when ((old.reviewed_at is null) <> (new.reviewed_at is null) and old.answer is not distinct from new.answer and old.note is not distinct from new.note)
  execute function private.cb_changed('review', 'A "yes" answer''s review mark changed');

