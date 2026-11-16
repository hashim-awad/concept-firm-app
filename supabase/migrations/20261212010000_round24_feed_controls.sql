-- Round 24 (Hashim, Nov 16, 2026): the bank feed as QuickBooks Online keeps it, and the control rules for
-- statements and lines. Safe to run twice. It changes rules and adds the log columns, the Excluded state and the
-- accounting date (set equal to the bank date on every existing line). No existing statement or line changes otherwise.
--
-- P1 A statement is a source document; once imported it is support only. Its lines are the record.
-- P2 Nothing that reached the feed is deleted: a statement is excluded, with a reason, and stays visible.
-- P3 The bank's own data on a line (bank date, description, amount, direction) never changes after import.
-- P4 Every change is logged (who, when, what, why, old and new). The log is append-only, owners included.
-- P5 A signed 3.2 or 3.3 is locked: a change asks first and removes the sign-off, or waits for the reviewer.
--
-- Posting (round 24 plan): a line posts only when it has an account (coded); the trial balance is built in the app
-- (tb-build.ts). The database adds the step 4 check: with every line coded, each account in the trial balance equals
-- its 3.3 closing.

-- ---------- 1. The log: structured columns, append-only
alter table public.cb_file_history add column if not exists statement_id uuid;
alter table public.cb_file_history add column if not exists line_id uuid;
alter table public.cb_file_history add column if not exists import_id uuid;
alter table public.cb_file_history add column if not exists ref_label text not null default '';
alter table public.cb_file_history add column if not exists reason text not null default '';
alter table public.cb_file_history add column if not exists old_value text not null default '';
alter table public.cb_file_history add column if not exists new_value text not null default '';
alter table public.cb_file_history add column if not exists erased_at timestamptz;
create index if not exists cb_file_history_statement on public.cb_file_history (statement_id) where statement_id is not null;
create index if not exists cb_file_history_line on public.cb_file_history (line_id) where line_id is not null;

create or replace function private.cb_log_event(p_file uuid, p_action text, p_step text, p_detail text, p_statement uuid, p_line uuid, p_ref text,
  p_reason text, p_old text, p_new text, p_import uuid default null) returns void
language sql security definer set search_path = '' as $$
  insert into public.cb_file_history (file_id, actor_id, action, step, detail, statement_id, line_id, import_id, ref_label, reason, old_value, new_value)
  values (p_file, (select auth.uid()), p_action, p_step, left(coalesce(p_detail, ''), 500), p_statement, p_line, p_import, left(coalesce(p_ref, ''), 300),
          left(coalesce(p_reason, ''), 300), left(coalesce(p_old, ''), 300), left(coalesce(p_new, ''), 300));
$$;
revoke all on function private.cb_log_event(uuid, text, text, text, uuid, uuid, text, text, text, text, uuid) from public, anon, authenticated;

-- Nobody edits or deletes an entry. Two exceptions, both by the database itself: the file is being deleted (its
-- history goes with it), and a purge (owners, "Wrong client") erases the other client's details from the entries
-- about that statement, keeping who, when and the event.
create or replace function private.cb_history_append_only() returns trigger language plpgsql set search_path = '' as $$
declare v_purge text := coalesce(current_setting('cb.purging', true), '');
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.cb_files where id = old.file_id) then return old; end if;
    raise exception 'The file history cannot be changed or deleted.' using errcode = '42501';
  end if;
  if v_purge <> '' and old.erased_at is null and new.erased_at is not null
     and new.id = old.id and new.file_id = old.file_id and new.at = old.at and new.actor_id is not distinct from old.actor_id and new.action = old.action
     and new.step is not distinct from old.step and new.statement_id is not distinct from old.statement_id and new.line_id is not distinct from old.line_id
     and new.import_id is not distinct from old.import_id
     and new.detail = 'Erased: the statement was purged (Wrong client).' and new.ref_label = '' and new.old_value = '' and new.new_value = '' then
    return new;
  end if;
  raise exception 'The file history cannot be changed or deleted.' using errcode = '42501';
end;
$$;
revoke all on function private.cb_history_append_only() from public, anon, authenticated;
drop trigger if exists cb_history_append_only on public.cb_file_history;
create trigger cb_history_append_only before update or delete on public.cb_file_history for each row execute function private.cb_history_append_only();

-- The old one-line log, kept for every other event. A no-op twin replaces the transfer logs below: the transfer
-- table logs each match and unmatch itself, with the lines.
create or replace function private.cb_log_skip(p_file uuid, p_action text, p_step text, p_detail text) returns void
language plpgsql security definer set search_path = '' as $$ begin return; end; $$;
revoke all on function private.cb_log_skip(uuid, text, text, text) from public, anon, authenticated;

-- ---------- 2. Lines: the accounting date and the memo; the bank's own data is read-only
alter table public.cb_bank_lines add column if not exists acct_date date;
alter table public.cb_bank_lines add column if not exists memo text not null default '';
-- Every existing line, locked files included (the locked-file guard steps aside for this one fill).
select set_config('cb.unlock', 'on', true);
update public.cb_bank_lines set acct_date = txn_date where acct_date is null;
select set_config('cb.unlock', '', true);
alter table public.cb_bank_lines alter column acct_date set not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cb_bank_lines_memo_check') then
    alter table public.cb_bank_lines add constraint cb_bank_lines_memo_check check (length(memo) <= 300);
  end if;
end $$;

create or replace function private.cb_line_defaults() returns trigger language plpgsql set search_path = '' as $$
begin
  new.acct_date := coalesce(new.acct_date, new.txn_date);
  return new;
end;
$$;
revoke all on function private.cb_line_defaults() from public, anon, authenticated;
drop trigger if exists cb_line_defaults on public.cb_bank_lines;
create trigger cb_line_defaults before insert on public.cb_bank_lines for each row execute function private.cb_line_defaults();

create or replace function private.cb_line_readonly() returns trigger language plpgsql set search_path = '' as $$
declare v_file public.cb_files;
begin
  if new.txn_date is distinct from old.txn_date or new.description is distinct from old.description or new.amount is distinct from old.amount
     or new.posted_date is distinct from old.posted_date or new.statement_id is distinct from old.statement_id or new.account_id is distinct from old.account_id
     or new.file_id is distinct from old.file_id or new.row_no is distinct from old.row_no then
    raise exception 'The bank''s own data on a line (date, description, amount) cannot change after import.' using errcode = '42501';
  end if;
  if new.acct_date is distinct from old.acct_date then
    select * into v_file from public.cb_files where id = new.file_id;
    if new.acct_date is null or new.acct_date < v_file.year_start or new.acct_date > v_file.year_end then
      raise exception 'Outside the year. Use an entry to move it to another year.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.cb_line_readonly() from public, anon, authenticated;
drop trigger if exists cb_line_readonly on public.cb_bank_lines;
create trigger cb_line_readonly before update on public.cb_bank_lines for each row execute function private.cb_line_readonly();

-- Statements and lines are not deleted. Three ways out, all by the database: a statement excluded (moved to the
-- Excluded list, cb.moving), a purge of an excluded statement (it is no longer here), the file itself deleted.
create or replace function private.cb_feed_no_delete() returns trigger language plpgsql set search_path = '' as $$
declare v_st uuid;
begin
  if tg_table_name = 'cb_bank_lines' then v_st := old.statement_id; else v_st := old.id; end if;
  if not exists (select 1 from public.cb_files where id = old.file_id) then return old; end if;
  if coalesce(current_setting('cb.moving', true), '') = v_st::text then return old; end if;
  raise exception 'Statements and their lines are not deleted. Exclude the statement instead (View statements).' using errcode = '42501';
end;
$$;
revoke all on function private.cb_feed_no_delete() from public, anon, authenticated;
drop trigger if exists cb_feed_no_delete on public.cb_bank_lines;
create trigger cb_feed_no_delete before delete on public.cb_bank_lines for each row execute function private.cb_feed_no_delete();
drop trigger if exists cb_feed_no_delete on public.cb_bank_statements;
create trigger cb_feed_no_delete before delete on public.cb_bank_statements for each row execute function private.cb_feed_no_delete();

-- A statement's own figures (period, opening, closing, account, line count) never change after import.
create or replace function private.cb_statement_readonly() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.period_start is distinct from old.period_start or new.period_end is distinct from old.period_end or new.opening is distinct from old.opening
     or new.closing is distinct from old.closing or new.account_id is distinct from old.account_id or new.file_id is distinct from old.file_id
     or new.lines is distinct from old.lines or new.outside_lines is distinct from old.outside_lines then
    raise exception 'An imported statement''s period, balances and lines cannot change.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.cb_statement_readonly() from public, anon, authenticated;
drop trigger if exists cb_statement_readonly on public.cb_bank_statements;
create trigger cb_statement_readonly before update on public.cb_bank_statements for each row execute function private.cb_statement_readonly();

-- ---------- 3. Excluded statements: the statement and its lines as they were, out of the feed
create table if not exists public.cb_excluded_statements (
  id           uuid primary key,                      -- the statement's own id, kept for Restore
  file_id      uuid not null references public.cb_files (id) on delete cascade,
  account_id   uuid not null references public.cb_bank_accounts (id) on delete cascade,
  period_start date not null,
  period_end   date not null,
  file_name    text not null default '',
  lines        int not null default 0,
  reason       text not null check (reason in ('wrong_account', 'wrong_client', 'wrong_period', 'twice', 'other')),
  note         text not null default '' check (length(note) <= 300),
  excluded_by  uuid,
  excluded_at  timestamptz not null default now(),
  statement    jsonb not null,                        -- the statement row
  line_rows    jsonb not null default '[]'::jsonb     -- its lines, each as it was (accounting date, memo, flags)
);
create index if not exists cb_excluded_statements_file on public.cb_excluded_statements (file_id);
alter table public.cb_excluded_statements enable row level security;
alter table public.cb_excluded_statements force row level security;
drop policy if exists "Closebook viewers read excluded statements" on public.cb_excluded_statements;
create policy "Closebook viewers read excluded statements" on public.cb_excluded_statements for select to authenticated using ((select private.can_view('closebook')));
revoke all on public.cb_excluded_statements from public, anon, authenticated;
grant select on public.cb_excluded_statements to authenticated;

-- ---------- 4. Replace file: each earlier file of a statement stays in its history
create table if not exists public.cb_statement_files (
  id                  uuid primary key default gen_random_uuid(),
  statement_id        uuid not null,                  -- no foreign key: the history stays while the statement is excluded
  file_id             uuid not null references public.cb_files (id) on delete cascade,
  file_name           text not null default '',
  attachment_path     text,
  statement_import_id uuid,
  file_sha256         text,
  replaced_by         uuid,
  replaced_at         timestamptz not null default now()
);
create index if not exists cb_statement_files_statement on public.cb_statement_files (statement_id);
alter table public.cb_statement_files enable row level security;
alter table public.cb_statement_files force row level security;
drop policy if exists "Closebook viewers read statement files" on public.cb_statement_files;
create policy "Closebook viewers read statement files" on public.cb_statement_files for select to authenticated using ((select private.can_view('closebook')));
revoke all on public.cb_statement_files from public, anon, authenticated;
grant select on public.cb_statement_files to authenticated;
alter table public.cb_statement_imports add column if not exists replaces_statement uuid;

-- ---------- 5. Sign-off locks (rule 17). A change covered by a signed 3.2 or 3.3 asks first. The preparer's
-- sign-off goes when they continue; a reviewer's sign-off only the reviewer (or an owner) removes.
create or replace function private.cb_feed_guard(p_file uuid, p_confirm boolean, p_what text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_subs text[]; v_rev boolean; v_label text; v_file public.cb_files; v_me uuid := (select auth.uid());
begin
  select array_agg(substep order by substep), bool_or(reviewed_at is not null) into v_subs, v_rev
    from public.cb_substep_signoffs where file_id = p_file and substep in ('3.2', '3.3') and prepared_at is not null;
  if v_subs is null then return; end if;
  v_label := array_to_string(v_subs, ' and ');
  select * into v_file from public.cb_files where id = p_file;
  if v_rev and not (private.is_owner() or v_me = v_file.reviewer_id
      or exists (select 1 from public.cb_substep_signoffs where file_id = p_file and reviewed_by = v_me)) then
    raise exception 'Ask the reviewer to remove the % sign-off.', v_label using errcode = '42501';
  end if;
  if not coalesce(p_confirm, false) then
    raise exception 'This removes the sign-off on %. Continue?', v_label using errcode = '42501';
  end if;
  delete from public.cb_substep_signoffs where file_id = p_file and substep = any (v_subs);
  perform private.cb_log_event(p_file, 'signoff_removed', 'records', format('Sign-off on %s removed to make a change.', v_label), null, null, '', p_what, v_label || ' signed', 'not signed');
  perform private.cb_records_follow(p_file);
end;
$$;
revoke all on function private.cb_feed_guard(uuid, boolean, text) from public, anon, authenticated;

-- ---------- 6. Labels for the log
create or replace function private.cb_line_label(l public.cb_bank_lines) returns text language sql stable set search_path = '' as $$
  select format('%s · %s · %s', to_char(l.txn_date, 'Mon FMDD, YYYY'), left(l.description, 60), to_char(l.amount, 'FM999,999,999,990.00'));
$$;
create or replace function private.cb_statement_label(p_account uuid, p_start date, p_end date) returns text language sql stable security definer set search_path = '' as $$
  select format('%s · %s to %s', coalesce((select name from public.cb_bank_accounts where id = p_account), ''), to_char(p_start, 'Mon FMDD, YYYY'), to_char(p_end, 'Mon FMDD, YYYY'));
$$;
create or replace function private.cb_coding_text(p_status text, p_chart text, p_tax text) returns text language sql stable security definer set search_path = '' as $$
  select case when p_chart is null then case p_status when 'ask_client' then 'Not coded, on the client question list' when 'reviewer' then 'Not coded, with the reviewer'
                                                       when 'matched' then 'Matched' else 'Not coded' end
              else concat_ws(', ', p_chart || coalesce(' ' || (select name from public.cb_chart_accounts where number = p_chart), ''), nullif(p_tax, ''),
                             case p_status when 'ask_client' then 'on the client question list' when 'reviewer' then 'with the reviewer' end) end;
$$;
revoke all on function private.cb_line_label(public.cb_bank_lines), private.cb_statement_label(uuid, date, date), private.cb_coding_text(text, text, text) from public, anon, authenticated;

-- ---------- 7. Logging (rules 6, 7, 16, 20)
-- A line: coded, uncoded, client list, reviewer, accounting date, memo. Transfers and outstanding items log on
-- their own tables (below), so a line that goes in or out of one is not logged twice.
create or replace function private.cb_line_log() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_label text := private.cb_line_label(new);
begin
  if new.acct_date is distinct from old.acct_date then
    perform private.cb_log_event(new.file_id, 'line_date', 'code', 'Accounting date changed', new.statement_id, new.id, v_label, '',
      to_char(old.acct_date, 'Mon FMDD, YYYY'), to_char(new.acct_date, 'Mon FMDD, YYYY'));
  end if;
  if new.memo is distinct from old.memo then
    perform private.cb_log_event(new.file_id, 'line_memo', 'code', case when old.memo = '' then 'Memo added' when new.memo = '' then 'Memo removed' else 'Memo changed' end,
      new.statement_id, new.id, v_label, '', old.memo, new.memo);
  end if;
  if (new.status is distinct from old.status or new.chart_account is distinct from old.chart_account or new.tax_code is distinct from old.tax_code)
     and coalesce(old.source, '') not in ('transfer', 'outstanding') and coalesce(new.source, '') not in ('transfer', 'outstanding') then
    perform private.cb_log_event(new.file_id,
      case when new.chart_account is null and old.chart_account is not null then 'line_uncoded' when new.chart_account is not null and old.chart_account is null then 'line_coded'
           when new.status = 'ask_client' then 'line_client' when new.status = 'reviewer' then 'line_reviewer' else 'line_recoded' end, 'code',
      case when new.chart_account is null and old.chart_account is not null then 'Uncoded' when new.chart_account is not null and old.chart_account is null then 'Coded'
           when new.status = 'ask_client' and old.status <> 'ask_client' then 'Put on the client question list'
           when new.status = 'reviewer' and old.status <> 'reviewer' then 'Sent to the reviewer' else 'Coding changed' end,
      new.statement_id, new.id, v_label, '', private.cb_coding_text(old.status, old.chart_account, old.tax_code), private.cb_coding_text(new.status, new.chart_account, new.tax_code));
  end if;
  return null;
end;
$$;
revoke all on function private.cb_line_log() from public, anon, authenticated;
drop trigger if exists cb_line_log on public.cb_bank_lines;
create trigger cb_line_log after update on public.cb_bank_lines for each row execute function private.cb_line_log();

create or replace function private.cb_transfer_log() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_t public.cb_bank_transfers; o public.cb_bank_lines; i public.cb_bank_lines; v_txt text;
begin
  if tg_op = 'DELETE' then v_t := old; else v_t := new; end if;
  select * into o from public.cb_bank_lines where id = v_t.out_line;
  select * into i from public.cb_bank_lines where id = v_t.in_line;
  if o.id is null or i.id is null then return null; end if;   -- a statement excluded or the file deleted
  v_txt := format('%s (%s) to %s (%s)', (select name from public.cb_bank_accounts where id = o.account_id), private.cb_line_label(o),
                  (select name from public.cb_bank_accounts where id = i.account_id), private.cb_line_label(i));
  perform private.cb_log_event(v_t.file_id, case when tg_op = 'DELETE' then 'transfer_unmatched' else 'transfer_matched' end, 'code',
    case when tg_op = 'DELETE' then 'Transfer unmatched' else 'Transfer matched' end, o.statement_id, o.id, private.cb_line_label(o), '',
    case when tg_op = 'DELETE' then v_txt else '' end, case when tg_op = 'DELETE' then '' else v_txt end);
  return null;
end;
$$;
revoke all on function private.cb_transfer_log() from public, anon, authenticated;
drop trigger if exists cb_transfer_log on public.cb_bank_transfers;
create trigger cb_transfer_log after insert or delete on public.cb_bank_transfers for each row execute function private.cb_transfer_log();

-- The transfer functions logged one line each without the lines: the trigger above now logs them.
do $$
declare f text; d text;
begin
  foreach f in array array['public.cb_accept_transfer(uuid, uuid, uuid)', 'public.cb_undo_transfer(uuid, uuid)', 'public.cb_uncode_lines(uuid, uuid[])'] loop
    if to_regprocedure(f) is null then continue; end if;
    d := pg_get_functiondef(to_regprocedure(f));
    if position('private.cb_log(p_file, ''transfer_' in d) > 0 then
      execute replace(d, 'private.cb_log(p_file, ''transfer_', 'private.cb_log_skip(p_file, ''transfer_');
    end if;
  end loop;
end $$;

-- An account's type, bank, last digits and opening balance: each change with old and new (rule 16).
create or replace function private.cb_account_log() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.account_type is distinct from old.account_type then
    perform private.cb_log_event(new.file_id, 'bank_account_changed', 'records', 'Account type changed', null, null, new.name, '', coalesce(old.account_type, ''), coalesce(new.account_type, ''));
  end if;
  if new.bank is distinct from old.bank then
    perform private.cb_log_event(new.file_id, 'bank_account_changed', 'records', 'Bank changed', null, null, new.name, '', coalesce(old.bank, ''), coalesce(new.bank, ''));
  end if;
  if new.last4 is distinct from old.last4 then
    perform private.cb_log_event(new.file_id, 'bank_account_changed', 'records', 'Last digits changed', null, null, new.name, '', coalesce(old.last4, ''), coalesce(new.last4, ''));
  end if;
  if new.books_opening is distinct from old.books_opening then
    perform private.cb_log_event(new.file_id, 'bank_account_changed', 'records', 'Balance at last year end changed', null, null, new.name, '',
      coalesce(to_char(old.books_opening, 'FM999,999,999,990.00'), 'not entered'), coalesce(to_char(new.books_opening, 'FM999,999,999,990.00'), 'not entered'));
  end if;
  return null;
end;
$$;
revoke all on function private.cb_account_log() from public, anon, authenticated;
drop trigger if exists cb_account_log on public.cb_bank_accounts;
create trigger cb_account_log after update on public.cb_bank_accounts for each row execute function private.cb_account_log();

-- Corrections on the fix screen, before import (rule 4): amount, date or direction of a line, with old and new.
create or replace function private.cb_import_corrections() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_before jsonb := coalesce(old.edited, old.result); a jsonb; b jsonb; l jsonb; o jsonb; v_ref text;
  amt constant text := 'FM999,999,999,990.00';
begin
  if new.file_id is null or new.edited is not distinct from old.edited or new.edited is null or v_before is null then return null; end if;
  for a in select * from jsonb_array_elements(coalesce(new.edited -> 'accounts', '[]')) loop
    select x into b from jsonb_array_elements(coalesce(v_before -> 'accounts', '[]')) x where x ->> 'key' = a ->> 'key' limit 1;
    for l in select * from jsonb_array_elements(coalesce(a -> 'lines', '[]')) loop
      o := null;
      if b is not null then select x into o from jsonb_array_elements(coalesce(b -> 'lines', '[]')) x where x ->> 'id' = l ->> 'id' limit 1; end if;
      v_ref := format('%s · %s · %s', new.file_name, coalesce(l ->> 'date', ''), left(coalesce(l ->> 'description', ''), 60));
      if o is null then
        perform private.cb_log_event(new.file_id, 'corrected_before_import', 'records', 'Corrected before import: line added', null, null, v_ref, '', '',
          to_char(coalesce((l ->> 'amountCents')::numeric, 0) / 100, amt), new.id);
        continue;
      end if;
      if (l ->> 'amountCents') is distinct from (o ->> 'amountCents') then
        perform private.cb_log_event(new.file_id, 'corrected_before_import', 'records', 'Corrected before import: amount', null, null, v_ref, '',
          to_char(coalesce((o ->> 'amountCents')::numeric, 0) / 100, amt), to_char(coalesce((l ->> 'amountCents')::numeric, 0) / 100, amt), new.id);
      end if;
      if (l ->> 'date') is distinct from (o ->> 'date') then
        perform private.cb_log_event(new.file_id, 'corrected_before_import', 'records', 'Corrected before import: date', null, null, v_ref, '', coalesce(o ->> 'date', ''), coalesce(l ->> 'date', ''), new.id);
      end if;
      if (l ->> 'dir') is distinct from (o ->> 'dir') then
        perform private.cb_log_event(new.file_id, 'corrected_before_import', 'records', 'Corrected before import: direction', null, null, v_ref, '', coalesce(o ->> 'dir', ''), coalesce(l ->> 'dir', ''), new.id);
      end if;
    end loop;
    if b is not null then
      for o in select x from jsonb_array_elements(coalesce(b -> 'lines', '[]')) x
                where not exists (select 1 from jsonb_array_elements(coalesce(a -> 'lines', '[]')) y where y ->> 'id' = x ->> 'id') loop
        perform private.cb_log_event(new.file_id, 'corrected_before_import', 'records', 'Corrected before import: line removed', null, null,
          format('%s · %s · %s', new.file_name, coalesce(o ->> 'date', ''), left(coalesce(o ->> 'description', ''), 60)), '',
          to_char(coalesce((o ->> 'amountCents')::numeric, 0) / 100, amt), '', new.id);
      end loop;
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function private.cb_import_corrections() from public, anon, authenticated;
drop trigger if exists cb_import_corrections on public.cb_statement_imports;
create trigger cb_import_corrections after update of edited on public.cb_statement_imports for each row execute function private.cb_import_corrections();

-- A change of a coded line's accounting date changes the trial balance (rule 18): the coding trigger's rule
-- (clear what it affects) applies, and its log line names the date.
do $$
declare d text; k text := $k$case when old.tax_code is distinct from new.tax_code then format('tax %s to %s'$k$;
begin
  d := pg_get_functiondef('private.cb_changed()'::regprocedure);
  if position('old.acct_date' in d) = 0 and position(k in d) > 0 then
    execute replace(d, k, $r$case when old.acct_date is distinct from new.acct_date then format('date %s to %s', to_char(old.acct_date, 'Mon FMDD'), to_char(new.acct_date, 'Mon FMDD')) end,
        $r$ || k);
  end if;
end $$;
drop trigger if exists cb_changed_line_date on public.cb_bank_lines;
create trigger cb_changed_line_date after update of acct_date on public.cb_bank_lines for each row
  when (old.acct_date is distinct from new.acct_date and new.chart_account is not null and new.status in ('done', 'reviewer', 'ask_client'))
  execute function private.cb_changed('code', 'A coded line''s date changed');

-- ---------- 8. Outstanding items: a coded line keeps its coding while it clears an item, and gets it back when
-- the item goes (round 24 addition: the trial balance drops the posting, then it returns).
alter table public.cb_bank_outstanding add column if not exists prior_status text;
alter table public.cb_bank_outstanding add column if not exists prior_chart text;
alter table public.cb_bank_outstanding add column if not exists prior_tax text;
alter table public.cb_bank_outstanding add column if not exists prior_source text;
alter table public.cb_bank_outstanding add column if not exists prior_reason text;
alter table public.cb_bank_outstanding add column if not exists prior_by uuid;
alter table public.cb_bank_outstanding add column if not exists prior_at timestamptz;

create or replace function private.cb_outstanding_release() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.cleared_line is not null and (tg_op = 'DELETE' or new.cleared_line is distinct from old.cleared_line) then
    perform set_config('cb.transfer', 'on', true);
    update public.cb_bank_lines set status = coalesce(old.prior_status, 'new'), source = coalesce(old.prior_source, ''), chart_account = old.prior_chart, tax_code = old.prior_tax,
           reviewer_reason = coalesce(old.prior_reason, ''), coded_by = old.prior_by, coded_at = old.prior_at
     where id = old.cleared_line and source = 'outstanding';
    perform set_config('cb.transfer', '', true);
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function private.cb_outstanding_release() from public, anon, authenticated;

create or replace function public.cb_add_outstanding(p_account uuid, p_edge text, p_date date, p_description text, p_dir text, p_amount numeric, p_cleared_line uuid,
  p_kind text default 'item')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_acc public.cb_bank_accounts; v_file public.cb_files; v_line public.cb_bank_lines; v_id uuid; v_left numeric;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_acc from public.cb_bank_accounts where id = p_account;
  perform private.require(v_acc.id is not null, 'Account not found.');
  select * into v_file from public.cb_files where id = v_acc.file_id;
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(p_edge in ('start', 'end'), 'Choose the start or the end of the year.');
  perform private.require(coalesce(p_kind, 'item') in ('item', 'rounding'), 'Choose what kind of item it is.');
  if p_kind = 'rounding' then
    v_left := private.cb_edge_left(p_account, p_edge);
    perform private.require(v_left is not null and v_left <> 0 and abs(v_left) < 1, 'Rounding is only for a difference left under 1.00.');
    insert into public.cb_bank_outstanding (file_id, account_id, edge, item_date, description, dir, amount, cleared_line, created_by, kind)
    values (v_acc.file_id, p_account, p_edge, case when p_edge = 'start' then v_file.year_start - 1 else v_file.year_end end,
            'Rounding (the T2 is in whole dollars)', case when v_left > 0 then 'in' else 'out' end, abs(v_left), null, (select auth.uid()), 'rounding')
    returning id into v_id;
    perform private.cb_log_event(v_acc.file_id, 'bank_outstanding', 'records', 'Rounding added', null, null, v_acc.name, '', '', to_char(abs(v_left), 'FM999,999,999,990.00'));
    return v_id;
  end if;
  perform private.require(p_dir in ('in', 'out'), 'Choose what kind of item it is.');
  perform private.require(p_date is not null, 'Enter the date of the item.');
  perform private.require(length(btrim(coalesce(p_description, ''))) between 1 and 200, 'Describe the item, for example "Cheque #204".');
  perform private.require(p_amount is not null and p_amount > 0 and round(p_amount, 2) = p_amount, 'Enter the amount as a positive number with up to 2 decimals.');
  if p_cleared_line is not null then
    select * into v_line from public.cb_bank_lines where id = p_cleared_line and account_id = p_account;
    perform private.require(v_line.id is not null, 'The line that cleared it must be on this account.');
    perform private.require(p_edge = 'start', 'Only an item at the start of the year is cleared by a line in the year.');
    perform private.require(abs(v_line.amount) = p_amount, 'The line that cleared it must be for the same amount.');
    perform private.require(not exists (select 1 from public.cb_bank_transfers where out_line = p_cleared_line or in_line = p_cleared_line), 'That line is matched as a transfer. Unmatch it first.');
    perform private.require(v_line.source <> 'outstanding', 'That line already clears an outstanding item.');
  end if;
  insert into public.cb_bank_outstanding (file_id, account_id, edge, item_date, description, dir, amount, cleared_line, created_by,
                                          prior_status, prior_chart, prior_tax, prior_source, prior_reason, prior_by, prior_at)
  values (v_acc.file_id, p_account, p_edge, p_date, btrim(p_description), p_dir, p_amount, p_cleared_line, (select auth.uid()),
          v_line.status, v_line.chart_account, v_line.tax_code, v_line.source, v_line.reviewer_reason, v_line.coded_by, v_line.coded_at) returning id into v_id;
  if p_cleared_line is not null then
    -- The books already hold it (last year): the line posts nothing while the item is there.
    perform set_config('cb.transfer', 'on', true);
    update public.cb_bank_lines set status = 'matched', source = 'outstanding', chart_account = null, tax_code = null, coded_by = (select auth.uid()), coded_at = now() where id = p_cleared_line;
    perform set_config('cb.transfer', '', true);
  end if;
  perform private.cb_log_event(v_acc.file_id, 'bank_outstanding', 'records',
    case when p_cleared_line is null then format('Outstanding item added at the %s of the year', p_edge) else 'Outstanding item added; its line in the year now posts nothing' end,
    v_line.statement_id, v_line.id, format('%s · %s %s', v_acc.name, btrim(p_description), to_char(p_amount, 'FM999,999,999,990.00')), '',
    case when v_line.id is null then '' else private.cb_coding_text(v_line.status, v_line.chart_account, v_line.tax_code) end,
    case when v_line.id is null then '' else 'Clears an outstanding item' end);
  return v_id;
end;
$$;
revoke all on function public.cb_add_outstanding(uuid, text, date, text, text, numeric, uuid, text) from public, anon;
grant execute on function public.cb_add_outstanding(uuid, text, date, text, text, numeric, uuid, text) to authenticated;

create or replace function public.cb_remove_outstanding(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.cb_bank_outstanding; v_line public.cb_bank_lines;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v from public.cb_bank_outstanding where id = p_id;
  perform private.require(v.id is not null, 'Item not found.');
  perform private.require((select phase from public.cb_files where id = v.file_id) <> 'locked', 'This file is locked.');
  select * into v_line from public.cb_bank_lines where id = v.cleared_line;
  delete from public.cb_bank_outstanding where id = p_id;
  perform private.cb_log_event(v.file_id, 'bank_outstanding', 'records',
    case when v_line.id is null then 'Outstanding item removed' else 'Outstanding item removed; its line is back as it was' end, v_line.statement_id, v_line.id,
    format('%s · %s %s', (select name from public.cb_bank_accounts where id = v.account_id), v.description, to_char(v.amount, 'FM999,999,999,990.00')), '',
    case when v_line.id is null then '' else 'Clears an outstanding item' end,
    case when v_line.id is null then '' else private.cb_coding_text(coalesce(v.prior_status, 'new'), v.prior_chart, v.prior_tax) end);
end;
$$;

-- ---------- 9. Uploads (rules 14, 15, 17): through the lock. Excluded statements are not in the feed, so the
-- duplicate checks (same file, same period) never see them.
drop function if exists public.cb_import_statement(uuid, jsonb, boolean, text);
create or replace function public.cb_import_statement(p_import uuid, p_accounts jsonb, p_confirm_dups boolean, p_attachment text, p_confirm boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.cb_statement_imports := private.statement_job_for_change(p_import);
  a jsonb;
  r jsonb;
  v_out jsonb := '[]'::jsonb;
  v_lines int := 0;
begin
  perform private.require(v.file_id is not null, 'This statement does not belong to a file.');
  perform private.require(v.status in ('ready', 'needs_look'), 'This statement is not ready to import.');
  perform private.require(v.replaces_statement is null, 'This file was uploaded to replace a statement''s file, not to import.');
  perform private.require(jsonb_typeof(p_accounts) = 'array' and jsonb_array_length(p_accounts) >= 1, 'Choose an account for at least one statement.');
  perform private.cb_feed_guard(v.file_id, p_confirm, 'statement uploaded');
  for a in select * from jsonb_array_elements(p_accounts) loop
    perform private.require(nullif(a ->> 'account', '') is not null, 'Choose an account on this file. Add the account in step 3 first.');
    r := private.cb_add_statement(v.file_id, (a ->> 'account')::uuid, v.file_name, (a ->> 'opening')::numeric, (a ->> 'closing')::numeric, a -> 'rows',
      (a ->> 'period_start')::date, (a ->> 'period_end')::date, nullif(a ->> 'at_start', '')::numeric, nullif(a ->> 'at_end', '')::numeric, v.file_sha256);
    update public.cb_bank_statements set statement_import_id = v.id, source = 'pdf', converted_by = v.created_by, converted_at = coalesce(v.finished_at, v.created_at),
           model = v.model, pages = v.pages, check_result = a -> 'check', edits = a -> 'edits', attachment_path = nullif(p_attachment, '')
     where id = (r ->> 'statement')::uuid;
    if coalesce(p_confirm_dups, false) then
      perform public.cb_flag_uploaded_duplicates(v.file_id, (r ->> 'statement')::uuid);
    end if;
    v_lines := v_lines + (r ->> 'lines')::int;
    v_out := v_out || jsonb_build_array(r || jsonb_build_object('key', a ->> 'key'));
    perform private.cb_log_event(v.file_id, 'statement_imported', 'records', format('Statement imported: %s lines in the year.', r ->> 'lines'), (r ->> 'statement')::uuid, null,
      private.cb_statement_label((r ->> 'account_id')::uuid, (a ->> 'period_start')::date, (a ->> 'period_end')::date), '', '', v.file_name, v.id);
  end loop;
  with s as (select (e ->> 'statement')::uuid as id, greatest((e ->> 'lines')::int, 0) as n, o from jsonb_array_elements(v_out) with ordinality x(e, o)),
  sh as (select id, o, floor(coalesce(v.input_tokens, 0)::numeric * n / greatest(v_lines, 1))::int as it, floor(coalesce(v.output_tokens, 0)::numeric * n / greatest(v_lines, 1))::int as ot,
                round(coalesce(v.cost_usd, 0) * n / greatest(v_lines, 1), 4) as c from s),
  tot as (select sum(it) as it, sum(ot) as ot, sum(c) as c from sh)
  update public.cb_bank_statements b set
         input_tokens = case when v.input_tokens is null then null else sh.it + case when sh.o = 1 then v.input_tokens - tot.it else 0 end end,
         output_tokens = case when v.output_tokens is null then null else sh.ot + case when sh.o = 1 then v.output_tokens - tot.ot else 0 end end,
         cost_usd = case when v.cost_usd is null then null else sh.c + case when sh.o = 1 then v.cost_usd - tot.c else 0 end end
    from sh, tot where b.id = sh.id;
  update public.cb_statement_imports set status = 'imported', imported_at = now(), imported_by = (select auth.uid()) where id = v.id;
  return v_out;
end;
$$;
revoke all on function public.cb_import_statement(uuid, jsonb, boolean, text, boolean) from public, anon;
grant execute on function public.cb_import_statement(uuid, jsonb, boolean, text, boolean) to authenticated;

drop function if exists public.cb_import_csv(uuid, uuid, text, numeric, numeric, jsonb);
create or replace function public.cb_import_csv(p_file uuid, p_account uuid, p_file_name text, p_opening numeric, p_closing numeric, p_rows jsonb, p_confirm boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files; v_first date; v_last date; v_ps date; v_pe date; v_start numeric; v_end numeric; v jsonb;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file;
  perform private.require(v_file.id is not null, 'File not found.');
  perform private.require(jsonb_typeof(p_rows) = 'array' and jsonb_array_length(p_rows) > 0, 'The CSV has no lines.');
  perform private.cb_feed_guard(p_file, p_confirm, 'CSV uploaded');
  select min((r ->> 'date')::date), max((r ->> 'date')::date) into v_first, v_last from jsonb_array_elements(p_rows) r;
  v_ps := case when v_first between v_file.year_start and v_file.year_start + 31 then v_file.year_start else v_first end;
  v_pe := case when v_last between v_file.year_end - 31 and v_file.year_end then v_file.year_end else v_last end;
  if v_file.year_start between v_ps and v_pe then
    v_start := p_opening + coalesce((select sum((r ->> 'amount')::numeric) from jsonb_array_elements(p_rows) r where (r ->> 'date')::date < v_file.year_start), 0);
  end if;
  if v_file.year_end between v_ps and v_pe then
    v_end := p_opening + coalesce((select sum((r ->> 'amount')::numeric) from jsonb_array_elements(p_rows) r where (r ->> 'date')::date <= v_file.year_end), 0);
  end if;
  v := private.cb_add_statement(p_file, p_account, p_file_name, p_opening, p_closing, p_rows, v_ps, v_pe, v_start, v_end, null);
  update public.cb_bank_statements set source = 'csv' where id = (v ->> 'statement')::uuid;
  perform private.cb_log_event(p_file, 'bank_csv', 'records', format('CSV imported: %s lines in the year.', v ->> 'lines'), (v ->> 'statement')::uuid, null,
    private.cb_statement_label(p_account, v_ps, v_pe), '', '', left(coalesce(p_file_name, ''), 120));
  return v;
end;
$$;
revoke all on function public.cb_import_csv(uuid, uuid, text, numeric, numeric, jsonb, boolean) from public, anon;
grant execute on function public.cb_import_csv(uuid, uuid, text, numeric, numeric, jsonb, boolean) to authenticated;

-- The older paths that deleted or bypassed the feed rules: refused (rule 12).
create or replace function public.cb_delete_bank_statement(p_statement uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(false, 'Statements are not deleted. Exclude it instead, in View statements.');
end;
$$;
-- ---------- 10. Exclude, Restore, Purge (rules 9 to 11)
create or replace function public.cb_exclude_statement(p_statement uuid, p_reason text, p_note text, p_confirm boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_st public.cb_bank_statements; v_file public.cb_files; v_block jsonb; v_rows jsonb; v_n int; v_word text;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_st from public.cb_bank_statements where id = p_statement;
  perform private.require(v_st.id is not null, 'Statement not found, or already excluded.');
  select * into v_file from public.cb_files where id = v_st.file_id for update;
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(p_reason in ('wrong_account', 'wrong_client', 'wrong_period', 'twice', 'other'), 'Choose the reason.');
  perform private.require(p_reason <> 'other' or length(btrim(coalesce(p_note, ''))) between 1 and 300, 'Say why (Other).');
  -- Refused while a line posts or is matched: each is listed, to undo first.
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'date', l.txn_date, 'description', l.description, 'amount', l.amount,
           'kind', case when exists (select 1 from public.cb_bank_transfers t where t.out_line = l.id or t.in_line = l.id) then 'transfer'
                        when l.source = 'outstanding' or exists (select 1 from public.cb_bank_outstanding o where o.cleared_line = l.id) then 'outstanding'
                        else 'coded' end) order by l.txn_date, l.row_no), '[]'::jsonb)
    into v_block
    from public.cb_bank_lines l
   where l.statement_id = p_statement
     and (exists (select 1 from public.cb_bank_transfers t where t.out_line = l.id or t.in_line = l.id)
          or l.source = 'outstanding' or exists (select 1 from public.cb_bank_outstanding o where o.cleared_line = l.id)
          or (l.chart_account is not null and l.status in ('done', 'reviewer', 'ask_client')));
  if jsonb_array_length(v_block) > 0 then return jsonb_build_object('ok', false, 'blockers', v_block); end if;
  perform private.cb_feed_guard(v_st.file_id, p_confirm, 'statement excluded');
  select coalesce(jsonb_agg(to_jsonb(l) order by l.row_no), '[]'::jsonb), count(*) into v_rows, v_n from public.cb_bank_lines l where l.statement_id = p_statement;
  insert into public.cb_excluded_statements (id, file_id, account_id, period_start, period_end, file_name, lines, reason, note, excluded_by, statement, line_rows)
  values (v_st.id, v_st.file_id, v_st.account_id, v_st.period_start, v_st.period_end, v_st.file_name, v_n, p_reason, case when p_reason = 'other' then btrim(p_note) else coalesce(btrim(p_note), '') end,
          (select auth.uid()), to_jsonb(v_st), v_rows);
  perform set_config('cb.moving', p_statement::text, true);
  delete from public.cb_bank_statements where id = p_statement;
  perform set_config('cb.moving', '', true);
  v_word := case p_reason when 'wrong_account' then 'Wrong account' when 'wrong_client' then 'Wrong client' when 'wrong_period' then 'Wrong period'
                          when 'twice' then 'Imported twice' else 'Other: ' || btrim(p_note) end;
  perform private.cb_log_event(v_st.file_id, 'statement_excluded', 'records', format('Statement excluded: %s line%s left the feed.', v_n, case when v_n = 1 then '' else 's' end),
    v_st.id, null, private.cb_statement_label(v_st.account_id, v_st.period_start, v_st.period_end), v_word, 'Imported', 'Excluded');
  update public.cb_files set updated_at = now() where id = v_st.file_id;
  return jsonb_build_object('ok', true, 'lines', v_n);
end;
$$;
revoke all on function public.cb_exclude_statement(uuid, text, text, boolean) from public, anon;
grant execute on function public.cb_exclude_statement(uuid, text, text, boolean) to authenticated;

create or replace function public.cb_restore_statement(p_statement uuid, p_confirm boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare x public.cb_excluded_statements; v_file public.cb_files; v_clash public.cb_bank_statements;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into x from public.cb_excluded_statements where id = p_statement;
  perform private.require(x.id is not null, 'Excluded statement not found.');
  select * into v_file from public.cb_files where id = x.file_id for update;
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  select * into v_clash from public.cb_bank_statements s
   where s.account_id = x.account_id and ((s.period_start < x.period_end and s.period_end > x.period_start)
         or (s.file_sha256 is not null and s.file_sha256 = x.statement ->> 'file_sha256'))
   order by s.period_start limit 1;
  perform private.require(v_clash.id is null, format('Not restored: %s (%s to %s) is now imported for this period. Exclude it first if this one is right.',
    coalesce(nullif(v_clash.file_name, ''), 'a statement'), to_char(v_clash.period_start, 'Mon FMDD, YYYY'), to_char(v_clash.period_end, 'Mon FMDD, YYYY')));
  perform private.cb_feed_guard(x.file_id, p_confirm, 'statement restored');
  insert into public.cb_bank_statements select * from jsonb_populate_record(null::public.cb_bank_statements, x.statement);
  insert into public.cb_bank_lines select * from jsonb_populate_recordset(null::public.cb_bank_lines, x.line_rows);
  delete from public.cb_excluded_statements where id = p_statement;
  perform private.cb_log_event(x.file_id, 'statement_restored', 'records', format('Statement restored: %s line%s back in the feed.', x.lines, case when x.lines = 1 then '' else 's' end),
    x.id, null, private.cb_statement_label(x.account_id, x.period_start, x.period_end), '', 'Excluded', 'Imported');
  update public.cb_files set updated_at = now() where id = x.file_id;
end;
$$;
revoke all on function public.cb_restore_statement(uuid, boolean) from public, anon;
grant execute on function public.cb_restore_statement(uuid, boolean) to authenticated;

-- Purge (owners only, only a statement excluded as Wrong client): the file and its lines are erased. Returns the
-- stored files for the app to remove from storage. The log keeps who, when, the reason and the line count.
create or replace function public.cb_purge_statement(p_statement uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare x public.cb_excluded_statements; v_file public.cb_files; v_imports uuid[]; v_docs text[]; v_reads text[]; v_lines uuid[];
begin
  perform private.require(private.is_owner(), 'Only an owner can purge.');
  select * into x from public.cb_excluded_statements where id = p_statement;
  perform private.require(x.id is not null, 'Excluded statement not found.');
  perform private.require(x.reason = 'wrong_client', 'Only a statement excluded as Wrong client can be purged.');
  select * into v_file from public.cb_files where id = x.file_id for update;
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  select array_agg(distinct i) into v_imports from (
    select nullif(x.statement ->> 'statement_import_id', '')::uuid as i
    union select statement_import_id from public.cb_statement_files where statement_id = p_statement
    union select id from public.cb_statement_imports where replaces_statement = p_statement) z where i is not null;
  select array_agg(p) into v_docs from (select nullif(x.statement ->> 'attachment_path', '') as p union select attachment_path from public.cb_statement_files where statement_id = p_statement) z where p is not null;
  select array_agg(storage_path) into v_reads from public.cb_statement_imports where id = any (coalesce(v_imports, '{}')) and storage_path is not null;
  select array_agg((e ->> 'id')::uuid) into v_lines from jsonb_array_elements(x.line_rows) e;
  -- Earlier entries about this statement keep who, when and the event; the other client's details are erased.
  perform set_config('cb.purging', p_statement::text, true);
  update public.cb_file_history set detail = 'Erased: the statement was purged (Wrong client).', ref_label = '', old_value = '', new_value = '', erased_at = now()
   where file_id = x.file_id and erased_at is null
     and (statement_id = p_statement or line_id = any (coalesce(v_lines, '{}')) or import_id = any (coalesce(v_imports, '{}'))
          -- The reader's own entries (uploaded, read) name the file only: its name can hold the period.
          or exists (select 1 from (select x.file_name as n union select file_name from public.cb_statement_files where statement_id = p_statement
                                    union select file_name from public.cb_statement_imports where id = any (coalesce(v_imports, '{}'))) names
                      where length(names.n) >= 5 and position(names.n in detail) > 0));
  perform set_config('cb.purging', '', true);
  delete from public.cb_statement_files where statement_id = p_statement;
  delete from public.cb_statement_imports where id = any (coalesce(v_imports, '{}'));
  delete from public.cb_excluded_statements where id = p_statement;
  perform private.cb_log_event(x.file_id, 'statement_purged', 'records', format('Statement purged: %s line%s erased.', x.lines, case when x.lines = 1 then '' else 's' end),
    p_statement, null, '', 'Wrong client', '', '');
  return jsonb_build_object('documents', to_jsonb(coalesce(v_docs, '{}')), 'reads', to_jsonb(coalesce(v_reads, '{}')));
end;
$$;
revoke all on function public.cb_purge_statement(uuid) from public, anon;
grant execute on function public.cb_purge_statement(uuid) to authenticated;

-- ---------- 11. Replace file (rule 8): a clearer copy of the same statement. Same last digits, period, opening and
-- closing, and the same lines (count; bank date and signed amount on every line). The lines do not change.
create or replace function public.cb_mark_replacement(p_imports uuid[], p_statement uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_st public.cb_bank_statements;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_st from public.cb_bank_statements where id = p_statement;
  perform private.require(v_st.id is not null, 'Statement not found.');
  update public.cb_statement_imports set replaces_statement = p_statement, target_account = v_st.account_id
   where id = any (p_imports) and file_id = v_st.file_id and status in ('uploading', 'queued', 'reading', 'ready', 'needs_look', 'failed');
end;
$$;
revoke all on function public.cb_mark_replacement(uuid[], uuid) from public, anon;
grant execute on function public.cb_mark_replacement(uuid[], uuid) to authenticated;

create or replace function public.cb_replace_statement_file(p_statement uuid, p_import uuid, p_last4 text, p_period_start date, p_period_end date,
  p_opening numeric, p_closing numeric, p_rows jsonb, p_attachment text, p_confirm boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare v_st public.cb_bank_statements; v_acc public.cb_bank_accounts; v_imp public.cb_statement_imports; v_file public.cb_files; v_ok boolean;
  v_digits text := regexp_replace(coalesce(p_last4, ''), '\D', '', 'g');
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_st from public.cb_bank_statements where id = p_statement;
  perform private.require(v_st.id is not null, 'Statement not found.');
  select * into v_file from public.cb_files where id = v_st.file_id for update;
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  select * into v_acc from public.cb_bank_accounts where id = v_st.account_id;
  select * into v_imp from public.cb_statement_imports where id = p_import;
  perform private.require(v_imp.id is not null and v_imp.file_id = v_st.file_id and v_imp.replaces_statement = p_statement and v_imp.status in ('ready', 'needs_look'),
    'The new file is not read yet.');
  perform private.require(jsonb_typeof(p_rows) = 'array', 'The new file has no lines.');
  v_ok := length(v_digits) >= 2 and right(regexp_replace(coalesce(v_acc.last4, ''), '\D', '', 'g'), least(4, length(v_digits))) = right(v_digits, least(4, length(v_digits)))
      and p_period_start = v_st.period_start and p_period_end = v_st.period_end and p_opening = v_st.opening and p_closing = v_st.closing
      and jsonb_array_length(p_rows) = v_st.lines + v_st.outside_lines
      and not exists (
        (select (r ->> 'date')::date, (r ->> 'amount')::numeric from jsonb_array_elements(p_rows) r
          where (r ->> 'date')::date between v_file.year_start and v_file.year_end)
        except all
        (select txn_date, amount from public.cb_bank_lines where statement_id = p_statement))
      and not exists (
        (select txn_date, amount from public.cb_bank_lines where statement_id = p_statement)
        except all
        (select (r ->> 'date')::date, (r ->> 'amount')::numeric from jsonb_array_elements(p_rows) r
          where (r ->> 'date')::date between v_file.year_start and v_file.year_end));
  perform private.require(coalesce(v_ok, false), 'This file doesn''t match the imported statement. To change its lines, exclude it and upload the right one.');
  perform private.cb_feed_guard(v_st.file_id, p_confirm, 'statement file replaced');
  insert into public.cb_statement_files (statement_id, file_id, file_name, attachment_path, statement_import_id, file_sha256, replaced_by)
  values (v_st.id, v_st.file_id, v_st.file_name, v_st.attachment_path, v_st.statement_import_id, v_st.file_sha256, (select auth.uid()));
  update public.cb_bank_statements set file_name = left(v_imp.file_name, 200), attachment_path = nullif(p_attachment, ''), statement_import_id = v_imp.id, file_sha256 = v_imp.file_sha256
   where id = p_statement;
  update public.cb_statement_imports set status = 'imported', imported_at = now(), imported_by = (select auth.uid()) where id = v_imp.id;
  perform private.cb_log_event(v_st.file_id, 'statement_file_replaced', 'records', 'Statement file replaced; its lines are unchanged.', v_st.id, null,
    private.cb_statement_label(v_st.account_id, v_st.period_start, v_st.period_end), '', v_st.file_name, v_imp.file_name, v_imp.id);
end;
$$;
revoke all on function public.cb_replace_statement_file(uuid, uuid, text, date, date, numeric, numeric, jsonb, text, boolean) from public, anon;
grant execute on function public.cb_replace_statement_file(uuid, uuid, text, date, date, numeric, numeric, jsonb, text, boolean) to authenticated;

-- ---------- 12. A line's accounting date and memo (rules 5, 6)
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
  perform private.cb_feed_guard(v_line.file_id, p_confirm, 'accounting date changed');
  update public.cb_bank_lines set acct_date = p_date where id = p_line;
end;
$$;
revoke all on function public.cb_set_line_date(uuid, date, boolean) from public, anon;
grant execute on function public.cb_set_line_date(uuid, date, boolean) to authenticated;

create or replace function public.cb_set_line_memo(p_line uuid, p_memo text, p_confirm boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare v_line public.cb_bank_lines; v_file public.cb_files; v_memo text := btrim(regexp_replace(coalesce(p_memo, ''), '\s+', ' ', 'g'));
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_line from public.cb_bank_lines where id = p_line;
  perform private.require(v_line.id is not null, 'Line not found.');
  select * into v_file from public.cb_files where id = v_line.file_id for update;
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(length(v_memo) <= 300, 'Keep the memo under 300 characters.');
  if v_memo = v_line.memo then return; end if;
  perform private.cb_feed_guard(v_line.file_id, p_confirm, 'memo changed');
  update public.cb_bank_lines set memo = v_memo where id = p_line;
end;
$$;
revoke all on function public.cb_set_line_memo(uuid, text, boolean) from public, anon;
grant execute on function public.cb_set_line_memo(uuid, text, boolean) to authenticated;

-- ---------- 13. Accounts (rules 16, 17): the opening change goes through the lock; an account with any statement,
-- imported or excluded, is not deleted. Field changes are logged by the trigger above.
drop function if exists public.cb_save_bank_account(uuid, uuid, text, text, text, numeric, boolean, boolean);
create or replace function public.cb_save_bank_account(p_file uuid, p_id uuid, p_type text, p_bank text, p_last4 text,
  p_balance numeric, p_negative boolean, p_long_term boolean, p_confirm boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_acc public.cb_bank_accounts;
  p record;
  v_bank text := btrim(regexp_replace(coalesce(p_bank, ''), '\s+', ' ', 'g'));
  v_last text := regexp_replace(coalesce(p_last4, ''), '\D', '', 'g');
  v_name text;
  v_id uuid;
  v_bal numeric := case when p_negative then -p_balance else p_balance end;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null, 'File not found.');
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  select * into p from private.cb_bank_placement(p_type, p_long_term);
  perform private.require(p.std_name is not null, 'Choose the type: chequing, savings, credit card, line of credit or loan.');
  perform private.require(length(v_bank) between 1 and 40, 'Enter the bank, for example RBC.');
  perform private.require(length(v_last) between 2 and 8, 'Enter the last digits of the account or card, as printed on the statement.');
  perform private.require(p_balance is not null and p_balance >= 0 and round(p_balance, 2) = p_balance, 'Enter the balance as a positive number with up to 2 decimals.');
  v_name := p.std_name || ' · ' || v_bank || ' ••• ' || v_last;
  perform private.require(not exists (select 1 from public.cb_bank_accounts where file_id = p_file and name_key = lower(v_name) and id is distinct from p_id),
    format('%s is already on this file.', v_name));
  if p_id is null then
    insert into public.cb_bank_accounts (file_id, name, name_key, kind, chart_account, number_base, gifi_line, account_type, bank, last4, long_term, books_opening, origin, created_by)
    values (p_file, v_name, lower(v_name), p.kind, p.chart_account, p.number_base, p.gifi_line, p_type, v_bank, v_last, coalesce(p_long_term, false) and p_type in ('loc', 'loan'),
            v_bal, 'added', (select auth.uid()))
    returning id into v_id;
    perform private.cb_log_event(p_file, 'bank_account_added', 'records', format('Account added: %s, balance in the books %s.', v_name, to_char(v_bal, 'FM999,999,999,990.00')),
      null, null, v_name, '', '', to_char(v_bal, 'FM999,999,999,990.00'));
  else
    select * into v_acc from public.cb_bank_accounts where id = p_id and file_id = p_file for update;
    perform private.require(v_acc.id is not null, 'Account not found.');
    perform private.require(v_acc.kind = p.kind or not (exists (select 1 from public.cb_bank_statements where account_id = p_id) or exists (select 1 from public.cb_excluded_statements where account_id = p_id)),
      'This account has statements. It can''t change between a bank account and a card, line of credit or loan.');
    if v_acc.books_opening is distinct from v_bal then
      perform private.cb_feed_guard(p_file, p_confirm, 'balance at last year end changed');
    end if;
    update public.cb_bank_accounts set name = v_name, name_key = lower(v_name), kind = p.kind, chart_account = p.chart_account, number_base = p.number_base,
           gifi_line = p.gifi_line, account_type = p_type, bank = v_bank, last4 = v_last, long_term = coalesce(p_long_term, false) and p_type in ('loc', 'loan'),
           books_opening = v_bal
     where id = p_id;
    v_id := p_id;
  end if;
  update public.cb_files set updated_at = now() where id = p_file;
  return v_id;
end;
$$;
revoke all on function public.cb_save_bank_account(uuid, uuid, text, text, text, numeric, boolean, boolean, boolean) from public, anon;
grant execute on function public.cb_save_bank_account(uuid, uuid, text, text, text, numeric, boolean, boolean, boolean) to authenticated;

create or replace function public.cb_remove_bank_account(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_acc public.cb_bank_accounts;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_acc from public.cb_bank_accounts where id = p_id;
  perform private.require(v_acc.id is not null, 'Account not found.');
  perform private.require((select phase from public.cb_files where id = v_acc.file_id) <> 'locked', 'This file is locked.');
  perform private.require(not exists (select 1 from public.cb_bank_statements where account_id = p_id) and not exists (select 1 from public.cb_excluded_statements where account_id = p_id),
    'This account has statements (imported or excluded). It can''t be deleted.');
  delete from public.cb_bank_accounts where id = p_id;
  perform private.cb_log_event(v_acc.file_id, 'bank_account_removed', 'records', 'Account removed', null, null, v_acc.name, '', '', '');
end;
$$;

-- ---------- 14. The step 4 check (round 24 plan): with every line coded, each account in the trial balance equals
-- its 3.3 closing (last year end balance + every line, less the lines that cleared an outstanding item).
create or replace function private.cb_code_tie_problems(p_file uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v_out text[] := '{}'; a record; v_tb numeric; v_close numeric; v_tb_terms numeric;
begin
  -- Lines with no account yet: step 4 lists them; the check waits.
  if exists (select 1 from public.cb_bank_lines where file_id = p_file and (status = 'new' or (status in ('ask_client', 'reviewer') and chart_account is null))) then
    return v_out;
  end if;
  for a in select * from public.cb_bank_accounts where file_id = p_file and books_opening is not null order by number loop
    v_close := a.books_opening + coalesce((select sum(l.amount) from public.cb_bank_lines l where l.account_id = a.id and not (l.status = 'matched' and l.source = 'outstanding')), 0);
    select coalesce(sum(this_year), 0) into v_tb from public.cb_accounts
     where file_id = p_file and account_key = case when a.number = a.chart_account then 'chart:' || a.chart_account else 'bank:' || a.id::text end;
    v_tb_terms := case when a.kind = 'bank' then v_tb else -v_tb end;
    if v_tb_terms <> v_close then
      v_out := v_out || format('%s %s: the trial balance shows %s, but 3.3 closes at %s (%s off).', a.number, a.name, private.cb_bracket(v_tb_terms), private.cb_bracket(v_close),
        private.cb_bracket(abs(v_tb_terms - v_close)));
    end if;
  end loop;
  return v_out;
end;
$$;
revoke all on function private.cb_code_tie_problems(uuid) from public, anon, authenticated;

do $$
declare d text; k text := $k$on the client''s question list.', v_n, case when v_n = 1 then '' else 's' end); end if;$k$; i int; j int;
begin
  d := pg_get_functiondef('private.cb_step_problems(uuid, text)'::regprocedure);
  if position('cb_code_tie_problems' in d) > 0 then return; end if;
  i := position($c$elsif p_step = 'code' then$c$ in d);
  j := position(k in substr(d, i));
  if i = 0 or j = 0 then raise exception 'cb_step_problems: the step 4 branch was not found.'; end if;
  d := substr(d, 1, i + j - 2 + length(k)) || E'\n      v_out := v_out || private.cb_code_tie_problems(p_file);' || substr(d, i + j - 1 + length(k));
  execute d;
end $$;

-- ---------- 15. "Upload statements" while 3.2 or 3.3 is signed: the window asks first, then removes the sign-off.
create or replace function public.cb_feed_unlock(p_file uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  perform private.require((select phase from public.cb_files where id = p_file) <> 'locked', 'This file is locked.');
  perform private.cb_feed_guard(p_file, true, 'statements to upload');
end;
$$;
revoke all on function public.cb_feed_unlock(uuid) from public, anon;
grant execute on function public.cb_feed_unlock(uuid) to authenticated;
