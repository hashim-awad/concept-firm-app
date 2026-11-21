-- CloseBook2 piece CB2-1 version 4, PR A (Hashim, Nov 21, 2026): Books per client, continuous like a QBO company.
-- 1. cb_clients: Closebook's own client list per firm. For Concept each links to Studio's client record; a firm without
--    Studio adds a client by hand. Every year file belongs to one (cb_files.cb_client_id, filled for files made the old way).
-- 2. cb_client_accounts: the client's chart of accounts. Each year's accounts link to it by number (by name when the
--    account has no number); the latest year's name wins until someone renames it in Closebook. Unique number per client.
--    A merge (QBO: give an account another account's number) points the account at the other; nothing posted is rewritten.
-- 3. cb_books_history: History for client accounts (one row per action). Entries keep theirs in cb_file_history.
-- 4. Entries: no type for new entries (the old "Type" list is gone; existing types are kept and nothing new depends on
--    them); memo, W/P reference and reason are optional; an entry may be dated the day before the year (opening balances);
--    a typed journal number; the origins "opening_balances", "opening_difference" and "tb_import" for the entries Books
--    makes from stored opening balances and imported trial balances when someone first saves a change to them.
-- 5. The three opening checks (retained earnings tie to the T2, Opening Balance Equity clears, dividends move once) are
--    warnings shown on the entry, never refusals.
-- 6. RPCs for Books: add a client, keep the client chart in step with the year files, save and merge accounts, make an
--    account inactive, and save an entry by date (the year file that covers the date takes it).

-- ---------- 1. Clients
create table if not exists public.cb_clients (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null default private.cb_default_firm() references public.firms (id),
  studio_client_id uuid references public.clients (id) on delete set null,
  name text not null check (length(btrim(name)) between 1 and 200),
  province text not null default 'ON',
  created_by uuid references public.staff (id),
  created_at timestamptz not null default now()
);
create unique index if not exists cb_clients_studio on public.cb_clients (firm_id, studio_client_id) where studio_client_id is not null;
alter table public.cb_files add column if not exists cb_client_id uuid references public.cb_clients (id);
create index if not exists cb_files_cb_client on public.cb_files (cb_client_id);

insert into public.cb_clients (firm_id, studio_client_id, name, province)
select distinct on (f.firm_id, f.client_id) f.firm_id, f.client_id, c.legal_name, coalesce(nullif(c.province, ''), 'ON')
  from public.cb_files f join public.clients c on c.id = f.client_id
 where not exists (select 1 from public.cb_clients x where x.firm_id = f.firm_id and x.studio_client_id = f.client_id)
 order by f.firm_id, f.client_id;
-- Locked files take their client too (a new column only; nothing in the file changes), with no History row.
do $$
begin
  perform set_config('cb.unlock', 'on', true);
  perform set_config('cb.one_action', 'on', true);
  update public.cb_files f set cb_client_id = x.id from public.cb_clients x
   where f.cb_client_id is null and x.firm_id = f.firm_id and x.studio_client_id = f.client_id;
  perform set_config('cb.unlock', '', true);
  perform set_config('cb.one_action', '', true);
end $$;

-- A file made the old way (Studio client) gets its Closebook client.
create or replace function private.cb_file_books_client() returns trigger
 language plpgsql security definer set search_path to ''
as $function$
begin
  if new.cb_client_id is null and new.client_id is not null then
    select id into new.cb_client_id from public.cb_clients where firm_id = new.firm_id and studio_client_id = new.client_id;
    if new.cb_client_id is null then
      insert into public.cb_clients (firm_id, studio_client_id, name, province)
      select new.firm_id, c.id, c.legal_name, coalesce(nullif(c.province, ''), 'ON') from public.clients c where c.id = new.client_id
      returning id into new.cb_client_id;
    end if;
  end if;
  return new;
end;
$function$;
revoke all on function private.cb_file_books_client() from public, anon, authenticated;
drop trigger if exists cb_file_books_client on public.cb_files;
create trigger cb_file_books_client before insert on public.cb_files for each row execute function private.cb_file_books_client();

-- ---------- 2. The client's chart of accounts
create table if not exists public.cb_client_accounts (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null default private.cb_default_firm() references public.firms (id),
  cb_client_id uuid not null references public.cb_clients (id) on delete cascade,
  number text not null default '' check (length(number) <= 20),
  name text not null check (length(btrim(name)) between 1 and 120),
  account_type text not null check (account_type in ('Asset', 'Liability', 'Equity', 'Revenue', 'Expense')),
  line_no text references public.cb_master_lines (line_no),
  tax_code text,
  active boolean not null default true,
  source text not null default 'books' check (source in ('books', 'user')),   -- books: kept in step with the year files
  merged_into uuid references public.cb_client_accounts (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff (id)
);
create unique index if not exists cb_client_accounts_number on public.cb_client_accounts (cb_client_id, number) where number <> '' and merged_into is null;
create unique index if not exists cb_client_accounts_name on public.cb_client_accounts (cb_client_id, lower(name)) where number = '' and merged_into is null;
create index if not exists cb_client_accounts_client on public.cb_client_accounts (cb_client_id);

-- ---------- 3. History for client accounts
create table if not exists public.cb_books_history (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null default private.cb_default_firm() references public.firms (id),
  cb_client_id uuid not null references public.cb_clients (id) on delete cascade,
  account_id uuid references public.cb_client_accounts (id) on delete cascade,
  actor_id uuid references public.staff (id),
  action text not null,
  detail text not null default '',
  old_value text,
  new_value text,
  created_at timestamptz not null default now()
);
create index if not exists cb_books_history_account on public.cb_books_history (account_id, created_at);

-- Row-level security as on every cb_ table (CB2-0 v7 item 5): own firm only, Closebook viewers read, writes through RPCs.
do $$
declare t text;
begin
  foreach t in array array['cb_clients', 'cb_client_accounts', 'cb_books_history'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create index if not exists %I on public.%I (firm_id)', t || '_firm_idx', t);
    execute format('drop policy if exists "Own firm only" on public.%I', t);
    execute format('create policy "Own firm only" on public.%I as restrictive for all to authenticated using (firm_id = (select private.my_firm())) with check (firm_id = (select private.my_firm()))', t);
    execute format('drop policy if exists "Closebook viewers read" on public.%I', t);
    execute format('create policy "Closebook viewers read" on public.%I for select to authenticated using ((select private.can_view(''closebook'')))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop trigger if exists cb_0_firm_guard on public.%I', t);
    execute format('create trigger cb_0_firm_guard before insert or update or delete on public.%I for each row execute function private.cb_firm_guard()', t);
  end loop;
end $$;

-- ---------- 4. Entries
alter table public.cb_entries alter column kind drop not null;
alter table public.cb_entries drop constraint if exists cb_entries_kind_check;
alter table public.cb_entries add constraint cb_entries_kind_check check (kind is null or kind in ('AJE', 'RJE', 'TJE'));
alter table public.cb_entries drop constraint if exists cb_entries_note_check;
alter table public.cb_entries add constraint cb_entries_note_check check (length(btrim(note)) <= 500);
alter table public.cb_entries drop constraint if exists cb_entries_origin_check;
alter table public.cb_entries add constraint cb_entries_origin_check check (origin in ('revenue_check', 'expenses_personal', 'schedule', 'opening_balances', 'opening_difference', 'tb_import'));
alter table public.cb_entries add column if not exists journal_no text check (journal_no is null or length(journal_no) between 1 and 21);

create or replace function private.cb_entry_head_check(p_file public.cb_files, p_kind text, p_reason text, p_note text, p_reverse boolean, p_lines jsonb,
  p_wp_ref text, p_date date, p_attachments text[]) returns void
 language plpgsql security definer set search_path to ''
as $function$
begin
  perform private.require(p_file.id is not null and p_file.phase <> 'locked', 'This file is locked.');
  -- CB2-1: no type on a new entry; memo, W/P reference and reason are optional (rule 13: only four hard stops).
  perform private.require(p_kind is null or p_kind in ('AJE', 'RJE', 'TJE'), 'Unknown entry type.');
  perform private.require(p_reason is null or p_reason in ('accrual', 'reclassification', 'correction', 'tax', 'prior_period'), 'Choose a reason.');
  perform private.require(length(btrim(coalesce(p_wp_ref, ''))) <= 120, 'The W/P reference is too long.');
  perform private.require(length(btrim(coalesce(p_note, ''))) <= 500, 'The memo is too long (500 characters).');
  perform private.require(not coalesce(p_reverse, false) or p_reason = 'accrual', 'Only an accrual reverses next year.');
  -- The day before the year: the opening balances entry.
  perform private.require(p_date is null or p_date between p_file.year_start - 1 and p_file.year_end, 'The entry date must fall in the file''s year.');
  perform private.require(jsonb_typeof(p_lines) = 'array' and jsonb_array_length(p_lines) >= 2, 'An entry needs at least two lines.');
  perform private.require(coalesce(array_length(p_attachments, 1), 0) <= 10, 'Up to 10 attachments.');
end;
$function$;

create or replace function private.cb_entry_label(p_entry uuid) returns text
 language sql stable security definer set search_path to ''
as $function$
  select coalesce(e.journal_no, format('%s-%s', to_char(f.year_end, 'YYYY'), lpad(e.seq::text, 3, '0'))) || coalesce(' ' || e.kind, '')
    from public.cb_entries e join public.cb_files f on f.id = e.file_id where e.id = p_entry;
$function$;

-- ---------- 5. The opening checks are warnings (the entry's lines, as before, less the three refusals)
CREATE OR REPLACE FUNCTION private.cb_entry_write_lines(p_entry uuid, p_file cb_files, p_kind text, p_reason text, p_reverse boolean, p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_fid uuid := p_file.id;
  -- Piece R2 (D12a): every trial balance file posts to the client's own accounts (monthly QuickBooks files included).
  v_own boolean := p_file.books not in ('statements', 'paper');
  v_cn text;
  v_cnt int;
  v_obe boolean := false;
  v_obe_acc uuid;
  v_div boolean := false;
  v_div_acc uuid;
  v_div_amt numeric;
  v_div_last numeric;
  v_div_name text;
  v_pend numeric;
  v_re_now numeric;
  v jsonb;
  v_acc uuid;
  v_line text;
  v_key text;
  v_name text;
  v_type text;
  v_chart public.cb_chart_accounts;
  v_sum numeric := 0;
  v_income numeric := 0;
  v_re boolean;
  v_ppa_line boolean := false;
  v_plain jsonb := '[]'::jsonb;
  v_n_re int;
begin
  -- Hashim (Nov 19, 2026): QuickBooks Opening Balance Equity is cleared by one RJE to retained earnings at the start of the
  -- year, the only exception to "retained earnings only through prior period adjustments": two lines, one on that account
  -- and one on retained earnings.
  if v_own and p_kind = 'RJE' and jsonb_array_length(p_lines) = 2 then
    select max(a.id::text) filter (where private.cb_obe(a))::uuid, count(*) filter (where private.cb_obe(a)), count(*) filter (where a.line_no like '3600.%')
      into v_obe_acc, v_cnt, v_n_re from jsonb_array_elements(p_lines) l join public.cb_accounts a on a.id = nullif(l ->> 'account', '')::uuid and a.file_id = v_fid;
    v_obe := v_cnt = 1 and v_n_re = 1;
    -- Hashim (Nov 19, 2026, dividends option A): QuickBooks never closes a dividends account (or one assigned to 31500 Prior
    -- period adjustments), so it carries last year's balance into this year. One RJE per such account, at the start of the
    -- year, moves exactly last year's balance to retained earnings: two lines, that account and retained earnings.
    if not v_obe then
      select max(a.id::text) filter (where c.line_no >= '3700' and c.line_no < '3750' and a.last_year <> 0)::uuid,
             count(*) filter (where c.line_no >= '3700' and c.line_no < '3750' and a.last_year <> 0)
        into v_div_acc, v_cnt from jsonb_array_elements(p_lines) l join public.cb_accounts a on a.id = nullif(l ->> 'account', '')::uuid and a.file_id = v_fid
        left join public.cb_chart_accounts c on c.number = a.chart_account;
      v_div := v_cnt = 1 and v_n_re = 1;
    end if;
  end if;
  for v in select * from jsonb_array_elements(p_lines) loop
    v_chart := null; v_cn := null;
    perform private.require(round((v ->> 'amount')::numeric, 2) <> 0, 'Every line needs an amount.');
    perform private.require(nullif(v ->> 'tax_code', '') is null or exists (select 1 from public.cb_sales_tax_codes where code = v ->> 'tax_code'), 'Unknown sales tax code.');
    v_name := nullif(btrim(coalesce(v ->> 'new_name', '')), '');
    v_type := nullif(v ->> 'new_type', '');
    v_acc := null; v_key := '';
    if nullif(v ->> 'account', '') is not null then
      select a.id, a.line_no, a.account_key, a.chart_account into v_acc, v_line, v_key, v_cn from public.cb_accounts a where a.id = (v ->> 'account')::uuid and a.file_id = v_fid;
      perform private.require(v_acc is not null, 'An account is not in this file.');
      -- Clearing (10900) has no group by design; the reviewer clears it with an entry (round 4 item 3; piece R2 D2).
      -- CB2-0 v7: an account with no GIFI line or master account yet takes entries; it shows as unassigned.
      -- Piece R2 (D12b): never a QuickBooks parent that has sub-accounts.
      perform private.require(not v_own or not exists (select 1 from public.cb_accounts c where c.file_id = v_fid and c.parent_key = v_key),
        'Post to a sub-account, not to its parent.');
    elsif nullif(v ->> 'chart', '') is not null then
      select * into v_chart from public.cb_chart_accounts where number = v ->> 'chart';
      perform private.require(v_chart.number is not null, 'Choose an account from the standard chart.');
      v_line := v_chart.line_no;
      if v_own and v_name is null then
        -- Piece R2 (D12b): the client's account assigned to that master account; with several, the one the preparer picked
        -- (cb_client_chart_picks, rolled forward); never a parent with sub-accounts. For the sales tax line only, a new
        -- "GST/HST payable" when the client has none.
        select count(*) into v_cnt from public.cb_accounts a where a.file_id = v_fid and a.chart_account = v_chart.number
           and a.account_key not like 'line:%' and a.account_key not like 'gifi:%' and a.account_key not like 'chart:%'
           and not exists (select 1 from public.cb_accounts c where c.file_id = v_fid and c.parent_key = a.account_key);
        if v_cnt = 1 then
          select a.id into v_acc from public.cb_accounts a where a.file_id = v_fid and a.chart_account = v_chart.number
             and a.account_key not like 'line:%' and a.account_key not like 'gifi:%' and a.account_key not like 'chart:%'
             and not exists (select 1 from public.cb_accounts c where c.file_id = v_fid and c.parent_key = a.account_key);
        elsif v_cnt > 1 then
          select a.id into v_acc from public.cb_accounts a join public.cb_client_chart_picks p on p.client_id = p_file.client_id
             and p.chart_account = v_chart.number and p.account_key = a.account_key where a.file_id = v_fid and a.chart_account = v_chart.number
             and not exists (select 1 from public.cb_accounts c where c.file_id = v_fid and c.parent_key = a.account_key);
          perform private.require(v_acc is not null, format('Several of the client''s accounts are on master account %s %s: choose the one entries take (step 4, open the master account).', v_chart.number, v_chart.name));
        end if;
        if v_acc is null and coalesce((v ->> 'is_tax')::boolean, false) and v_chart.number = '21500' and v_cnt = 0 then
          -- The client's GST/HST account may sit on 12250 GST/HST receivable (a debit balance): the tax line takes it.
          select min(a.id::text)::uuid into v_acc from public.cb_accounts a where a.file_id = v_fid and a.chart_account = '12250'
             and (select count(*) from public.cb_accounts b where b.file_id = v_fid and b.chart_account = '12250') = 1;
        end if;
        if v_acc is null then
          perform private.require(coalesce((v ->> 'is_tax')::boolean, false), 'Choose one of the client''s accounts, or name a new account for their books.');
          v_name := v_chart.name; v_type := 'Other Current Liabilities';
        end if;
      elsif v_own then
        null;   -- a new client account named on this master account (created below, with the master account)
      else
        insert into public.cb_accounts (file_id, account_key, number, name, this_year, line_no, mapping_source, mapped_at)
        values (v_fid, 'chart:' || v_chart.number, v_chart.number, v_chart.name, 0, v_chart.line_no, 'chart', now())
        on conflict (file_id, account_key) do nothing;
        select id, account_key into v_acc, v_key from public.cb_accounts where file_id = v_fid and account_key = 'chart:' || v_chart.number;
      end if;
    else
      v_line := v ->> 'line';
      perform private.require(not v_own or v_name is not null, 'Choose one of the client''s accounts, or name a new account for their books.');
    end if;
    -- CB2-0 review round (spec step 4): a line on retained earnings posts where it was coded; it is no longer moved to 3720.
    if v_line like '3720.%' then
      -- Dividends option A: the opening RJE that moves a 31500 account's balance from last year closes that figure; it is not
      -- a prior period adjustment, so it may take the reason "correction".
      v_ppa_line := true;
    end if;
    if v_acc is null then
      perform private.require(exists (select 1 from public.cb_master_lines where line_no = v_line and mappable), 'Entries cannot post to a total line.');
      perform private.require(not private.cb_line_locked(v_line), 'This line is locked because it has sub-lines. Choose one of its sub-lines.');
      if v_own then
        perform private.require(length(v_name) between 3 and 80, 'Name the new account in plain words, for example "Amortization expense".');
        perform private.require(v_type is not null, 'Choose the new account''s QuickBooks account type.');
        -- Piece R2 (item 5): a new client account is created with a master account.
        -- CB2-0 review round (spec step 4): a new account needs no master account first; step 4 lists it to assign.
        insert into public.cb_accounts (file_id, account_key, number, name, line_no, chart_account, mapping_source, mapped_by, mapped_at, client_new, qbo_type)
        values (v_fid, 'new:' || lower(v_name), '', v_name, v_line, case when v_line like '3720.%' then '31500' else coalesce(v_chart.number, private.cb_chart_for_line(v_line)) end,
                'preparer', (select auth.uid()), now(), true, v_type)
        on conflict (file_id, account_key) do nothing;
        select id into v_acc from public.cb_accounts where file_id = v_fid and account_key = 'new:' || lower(v_name);
      else
        -- A standard chart account on that line comes first (31500 for 3720); a bare line only when none.
        select * into v_chart from public.cb_chart_accounts where line_no = v_line order by sort_order limit 1;
        if v_chart.number is not null then
          insert into public.cb_accounts (file_id, account_key, number, name, this_year, line_no, mapping_source, mapped_at)
          values (v_fid, 'chart:' || v_chart.number, v_chart.number, v_chart.name, 0, v_chart.line_no, 'chart', now())
          on conflict (file_id, account_key) do nothing;
          select id into v_acc from public.cb_accounts where file_id = v_fid and account_key = 'chart:' || v_chart.number;
        else
          insert into public.cb_accounts (file_id, account_key, number, name, line_no, mapping_source, mapped_by, mapped_at)
          select v_fid, 'line:' || v_line, '', m.name, v_line, 'preparer', (select auth.uid()), now() from public.cb_master_lines m where m.line_no = v_line
          on conflict (file_id, account_key) do nothing;
          select id into v_acc from public.cb_accounts where file_id = v_fid and account_key = 'line:' || v_line;
        end if;
      end if;
    end if;
    -- Piece 3: a line from a schedule keeps its part (the Schedule tag). Only the schedule writes a new one; an edit of a
    -- schedule entry may keep them, after cb_edit_entry checked the amounts are the schedule's.
    perform private.require(nullif(v ->> 'schedule_part', '') is null or coalesce(current_setting('cb.schedule_save', true), '') = 'on'
      or (select origin from public.cb_entries where id = p_entry) = 'schedule', 'Change this amount in its schedule: click the Schedule tag.');
    insert into public.cb_entry_lines (entry_id, account_id, amount, memo, tax_code, is_tax, schedule_part)
    values (p_entry, v_acc, round((v ->> 'amount')::numeric, 2), left(coalesce(v ->> 'memo', ''), 200), nullif(v ->> 'tax_code', ''), coalesce((v ->> 'is_tax')::boolean, false),
            nullif(v ->> 'schedule_part', ''));
    if not coalesce((v ->> 'is_tax')::boolean, false) then v_plain := v_plain || jsonb_build_array(jsonb_build_object('line', v_line, 'amount', round((v ->> 'amount')::numeric, 2), 'tax', v ->> 'tax_code')); end if;
    v_sum := v_sum + round((v ->> 'amount')::numeric, 2);
    if (select line_type from public.cb_master_lines where line_no = v_line) in ('Revenue', 'Expense') then v_income := v_income + round((v ->> 'amount')::numeric, 2); end if;
  end loop;
  perform private.require(v_sum = 0, format('The entry does not balance: it is out by %s.', v_sum));
  -- CB2-1 (Hashim, Nov 21, 2026): the three opening checks are warnings shown on the entry, never refusals.
  if v_obe then
    select -coalesce(sum(private.cb_account_final(a.id)), 0) into v_re_now from public.cb_accounts a where a.file_id = v_fid and a.line_no like '3600.%';
    v_pend := private.cb_opening_pending(v_fid);
    -- Decision 1A: the entry is dated the first day of the year.
    update public.cb_entries set entry_date = p_file.year_start where id = p_entry and entry_date is distinct from p_file.year_start;
    perform private.cb_log_event(v_fid, 'entry_obe', 'entries', 'Opening Balance Equity cleared to retained earnings (RJE)',
      null, null, null, null, null, null, null);
    perform private.cb_one_action(true);   -- CB2-0 v7 item 8: the OBE entry's row is its one History row
  end if;
  if v_div then
    select a.last_year, btrim(coalesce(nullif(a.number, '') || ' ', '') || a.name) into v_div_last, v_div_name from public.cb_accounts a where a.id = v_div_acc;
    select coalesce(sum(amount), 0) into v_div_amt from public.cb_entry_lines where entry_id = p_entry and account_id = v_div_acc;
    select -coalesce(sum(private.cb_account_final(a.id)), 0) into v_re_now from public.cb_accounts a where a.file_id = v_fid and a.line_no like '3600.%';
    v_pend := private.cb_opening_pending(v_fid);
    update public.cb_entries set entry_date = p_file.year_start where id = p_entry and entry_date is distinct from p_file.year_start;
    perform private.cb_log_event(v_fid, 'entry_dividends', 'entries', format('%s: last year''s balance %s moved to retained earnings (RJE)',
      v_div_name, private.cb_money(v_div_last)), null, null, null, null, null, null, null);
  end if;
  -- CB2-0 v7 item 3 (rule 5): no rule depends on the Reclass checkbox or the entry type; a reclass may change the result.
  return v_plain;
end;
$function$;

-- A new entry with no type starts unticked.
create or replace function public.cb_save_entry(p_file uuid, p_entry uuid, p_reclass boolean, p_kind text, p_reason text, p_note text,
  p_reverse boolean, p_lines jsonb, p_wp_ref text, p_date date default null, p_standard uuid default null,
  p_attachments text[] default '{}'::text[], p_seq integer default null)
 returns uuid language plpgsql security definer set search_path to ''
as $function$
declare v_on boolean := coalesce(p_reclass, p_kind = 'RJE'); v_was boolean; v_id uuid; v_note text := '';
begin
  if p_entry is not null then
    select is_reclass into v_was from public.cb_entries where id = p_entry and file_id = p_file;
    perform private.require(v_was is not null, 'Entry not found.');
  else
    v_was := coalesce(p_kind = 'RJE', false);   -- what a new entry starts as (private.cb_entry_reclass_default)
  end if;
  if v_was <> v_on then
    v_note := format('; Reclass entry %s', case when v_on then 'ticked' else 'unticked' end);
  end if;
  perform set_config('cb.reclass_note', v_note, true);
  if p_entry is not null then
    v_id := public.cb_edit_entry(p_entry, p_kind, p_reason, p_note, p_reverse, p_lines, p_wp_ref, p_date, p_standard, p_attachments, p_seq);
  else
    v_id := public.cb_add_entry(p_file, p_kind, p_reason, p_note, p_reverse, p_lines, p_wp_ref, p_date, p_standard, p_attachments, p_seq);
  end if;
  if v_note <> '' then
    v_note := coalesce(current_setting('cb.reclass_note', true), '');   -- still set: the save wrote no row of its own
    perform set_config('cb.reclass_note', '', true);
    perform set_config('cb.one_action', 'on', true);
    update public.cb_entries set is_reclass = v_on where id = v_id;
    perform set_config('cb.one_action', '', true);
    if v_note <> '' then
      insert into public.cb_file_history (file_id, actor_id, action, step, detail, entry_id, ref_label, old_value, new_value)
      values (p_file, (select auth.uid()), 'entry_reclass', 'entries',
              format('Entry %s: Reclass entry %s', private.cb_entry_label(v_id), case when v_on then 'ticked' else 'unticked' end),
              v_id, private.cb_entry_label(v_id), case when v_on then 'No' else 'Yes' end, case when v_on then 'Yes' else 'No' end);
    end if;
    perform set_config('cb.one_action', 'on', true);
  end if;
  return v_id;
end;
$function$;

-- ---------- 6. Books RPCs
-- The client, in the caller's firm.
create or replace function private.cb_books_client(p_client uuid) returns public.cb_clients
 language plpgsql stable security definer set search_path to ''
as $function$
declare c public.cb_clients;
begin
  select * into c from public.cb_clients where id = p_client and firm_id = private.cb_default_firm();
  perform private.require(c.id is not null, 'Client not found.');
  return c;
end;
$function$;

-- Add a client by hand (a firm without Studio), or for a Studio client that has no Closebook file yet.
create or replace function public.cb_books_add_client(p_name text, p_province text default 'ON', p_studio uuid default null) returns uuid
 language plpgsql security definer set search_path to ''
as $function$
declare v uuid; v_name text := btrim(coalesce(p_name, ''));
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  if p_studio is not null then
    select id into v from public.cb_clients where firm_id = private.cb_default_firm() and studio_client_id = p_studio;
    if v is not null then return v; end if;
    select legal_name, coalesce(nullif(province, ''), p_province) into v_name, p_province from public.clients where id = p_studio;
    perform private.require(v_name is not null, 'Client not found.');
  end if;
  perform private.require(length(v_name) between 1 and 200, 'Enter the client''s name.');
  insert into public.cb_clients (studio_client_id, name, province, created_by)
  values (p_studio, v_name, coalesce(nullif(btrim(p_province), ''), 'ON'), (select auth.uid())) returning id into v;
  return v;
end;
$function$;

-- Keeps the client chart in step with the year files: an account a year uses and the chart lacks is added; an account
-- never renamed in Closebook takes the latest year's name, type and GIFI line. Rows: [{number, name, type, line_no}],
-- oldest year first, so the latest wins.
create or replace function public.cb_books_sync_accounts(p_client uuid, p_rows jsonb) returns void
 language plpgsql security definer set search_path to ''
as $function$
declare v jsonb; a public.cb_client_accounts; v_num text; v_name text; v_type text; v_line text; v_merged boolean;
begin
  perform private.require(private.can_view('closebook'), 'You need Closebook.');
  perform private.cb_books_client(p_client);
  for v in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_num := left(btrim(coalesce(v ->> 'number', '')), 20);
    v_name := left(btrim(coalesce(v ->> 'name', '')), 120);
    continue when v_name = '';
    v_type := case when v ->> 'type' in ('Asset', 'Liability', 'Equity', 'Revenue', 'Expense') then v ->> 'type' else 'Asset' end;
    v_line := nullif(v ->> 'line_no', '');
    if v_line is not null and not exists (select 1 from public.cb_master_lines where line_no = v_line) then v_line := null; end if;
    a := null;
    select * into a from public.cb_client_accounts x where x.cb_client_id = p_client and x.merged_into is null
       and (case when v_num <> '' then x.number = v_num else x.number = '' and lower(x.name) = lower(v_name) end);
    if a.id is null then
      select exists (select 1 from public.cb_client_accounts x where x.cb_client_id = p_client and x.merged_into is not null
         and (case when v_num <> '' then x.number = v_num else x.number = '' and lower(x.name) = lower(v_name) end)) into v_merged;
      continue when v_merged;
      insert into public.cb_client_accounts (cb_client_id, number, name, account_type, line_no)
      values (p_client, v_num, v_name, v_type, v_line) on conflict do nothing;
    elsif a.source = 'books' and (a.name, a.account_type, a.line_no) is distinct from (v_name, v_type, v_line) then
      update public.cb_client_accounts set name = v_name, account_type = v_type, line_no = v_line, updated_at = now() where id = a.id;
    end if;
  end loop;
end;
$function$;

create or replace function private.cb_books_account_text(a public.cb_client_accounts) returns text
 language sql immutable set search_path to ''
as $function$
  select concat_ws(E'\n', 'Number: ' || coalesce(nullif(a.number, ''), 'none'), 'Name: ' || a.name, 'Type: ' || a.account_type,
    'GIFI line: ' || coalesce(a.line_no, 'Unmatched'), 'Default tax code: ' || coalesce(a.tax_code, 'none'), 'Active: ' || case when a.active then 'Yes' else 'No' end);
$function$;

-- New account or edit (QBO Chart of accounts). Giving an account another account's number merges it into that account
-- (QBO): the caller asks once, then sends p_merge.
create or replace function public.cb_books_save_account(p_client uuid, p_id uuid, p_number text, p_name text, p_type text, p_line text,
  p_tax text, p_merge boolean default false) returns uuid
 language plpgsql security definer set search_path to ''
as $function$
declare v_old public.cb_client_accounts; v_new public.cb_client_accounts; v_other public.cb_client_accounts;
  v_num text := btrim(coalesce(p_number, '')); v_name text := btrim(coalesce(p_name, '')); v_line text := nullif(btrim(coalesce(p_line, '')), '');
  v_tax text := nullif(btrim(coalesce(p_tax, '')), '');
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  perform private.cb_books_client(p_client);
  perform private.require(length(v_name) between 1 and 120, 'Enter the account name.');
  perform private.require(length(v_num) <= 20, 'The account number is too long.');
  perform private.require(p_type in ('Asset', 'Liability', 'Equity', 'Revenue', 'Expense'), 'Choose the account type.');
  perform private.require(v_line is null or exists (select 1 from public.cb_master_lines where line_no = v_line and mappable), 'Choose a GIFI line from the list.');
  perform private.require(v_tax is null or exists (select 1 from public.cb_sales_tax_codes where code = v_tax), 'Choose a tax code from the list.');
  if p_id is not null then
    select * into v_old from public.cb_client_accounts where id = p_id and cb_client_id = p_client and merged_into is null;
    perform private.require(v_old.id is not null, 'Account not found.');
  end if;
  select * into v_other from public.cb_client_accounts x where x.cb_client_id = p_client and x.merged_into is null and x.id is distinct from p_id
     and (case when v_num <> '' then x.number = v_num else x.number = '' and lower(x.name) = lower(v_name) end);
  if v_other.id is not null then
    perform private.require(p_id is not null, case when v_num <> '' then format('Account number %s is already used by %s.', v_num, v_other.name)
      else format('There is already an account named %s.', v_other.name) end);
    if not coalesce(p_merge, false) then
      raise exception 'MERGE|%|%', v_other.id, btrim(coalesce(nullif(v_other.number, '') || ' ', '') || v_other.name);
    end if;
    update public.cb_client_accounts set merged_into = v_other.id, active = false, updated_at = now(), updated_by = (select auth.uid()) where id = p_id;
    insert into public.cb_books_history (cb_client_id, account_id, actor_id, action, detail, old_value, new_value)
    values (p_client, p_id, (select auth.uid()), 'account_merged',
            format('%s merged into %s', btrim(coalesce(nullif(v_old.number, '') || ' ', '') || v_old.name), btrim(coalesce(nullif(v_other.number, '') || ' ', '') || v_other.name)),
            private.cb_books_account_text(v_old), null);
    insert into public.cb_books_history (cb_client_id, account_id, actor_id, action, detail)
    values (p_client, v_other.id, (select auth.uid()), 'account_merged_in',
            format('%s merged into this account', btrim(coalesce(nullif(v_old.number, '') || ' ', '') || v_old.name)));
    return v_other.id;
  end if;
  if p_id is null then
    insert into public.cb_client_accounts (cb_client_id, number, name, account_type, line_no, tax_code, source, updated_by)
    values (p_client, v_num, v_name, p_type, v_line, v_tax, 'user', (select auth.uid())) returning * into v_new;
    insert into public.cb_books_history (cb_client_id, account_id, actor_id, action, detail, new_value)
    values (p_client, v_new.id, (select auth.uid()), 'account_added', format('Account %s added', btrim(coalesce(nullif(v_num, '') || ' ', '') || v_name)),
            private.cb_books_account_text(v_new));
  else
    update public.cb_client_accounts set number = v_num, name = v_name, account_type = p_type, line_no = v_line, tax_code = v_tax, source = 'user',
      updated_at = now(), updated_by = (select auth.uid()) where id = p_id returning * into v_new;
    if private.cb_books_account_text(v_new) is distinct from private.cb_books_account_text(v_old) then
      insert into public.cb_books_history (cb_client_id, account_id, actor_id, action, detail, old_value, new_value)
      values (p_client, p_id, (select auth.uid()), 'account_changed', format('Account %s changed', btrim(coalesce(nullif(v_num, '') || ' ', '') || v_name)),
              private.cb_books_account_text(v_old), private.cb_books_account_text(v_new));
    end if;
  end if;
  return v_new.id;
end;
$function$;

create or replace function public.cb_books_set_active(p_account uuid, p_active boolean) returns void
 language plpgsql security definer set search_path to ''
as $function$
declare a public.cb_client_accounts;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into a from public.cb_client_accounts where id = p_account and firm_id = private.cb_default_firm() and merged_into is null;
  perform private.require(a.id is not null, 'Account not found.');
  if a.active = coalesce(p_active, true) then return; end if;
  update public.cb_client_accounts set active = coalesce(p_active, true), updated_at = now(), updated_by = (select auth.uid()) where id = p_account;
  insert into public.cb_books_history (cb_client_id, account_id, actor_id, action, detail, old_value, new_value)
  values (a.cb_client_id, p_account, (select auth.uid()), case when p_active then 'account_active' else 'account_inactive' end,
          format('Account %s made %s', btrim(coalesce(nullif(a.number, '') || ' ', '') || a.name), case when p_active then 'active' else 'inactive' end),
          case when a.active then 'Active' else 'Inactive' end, case when p_active then 'Active' else 'Inactive' end);
end;
$function$;

-- The year file that takes an entry on a date: the year that covers the date; the day before a year's first day is that
-- year's opening balances; an opening difference is dated the year's first day; a trial balance import the year end.
create or replace function private.cb_books_file_for(p_client uuid, p_date date, p_origin text) returns public.cb_files
 language plpgsql stable security definer set search_path to ''
as $function$
declare f public.cb_files;
begin
  if p_origin = 'opening_balances' then
    select * into f from public.cb_files where cb_client_id = p_client and year_start - 1 = p_date order by year_end limit 1;
  elsif p_origin = 'opening_difference' then
    select * into f from public.cb_files where cb_client_id = p_client and year_start = p_date order by year_end limit 1;
  elsif p_origin = 'tb_import' then
    select * into f from public.cb_files where cb_client_id = p_client and year_end = p_date order by year_end limit 1;
  else
    select * into f from public.cb_files where cb_client_id = p_client and p_date between year_start and year_end order by year_end limit 1;
    if f.id is null then
      select * into f from public.cb_files where cb_client_id = p_client and year_start - 1 = p_date order by year_end limit 1;
    end if;
  end if;
  perform private.require(f.id is not null, format('No year in Closebook covers %s. Add the year first.', to_char(p_date, 'Mon FMDD, YYYY')));
  return f;
end;
$function$;

-- The year file's own account for a client account: found by number (by name when it has none), else added to the file.
create or replace function private.cb_books_file_account(p_file public.cb_files, p_acct uuid) returns uuid
 language plpgsql security definer set search_path to ''
as $function$
declare a public.cb_client_accounts; v uuid; v_key text; v_bank boolean := p_file.books in ('statements', 'paper'); n int := 0;
  v_chart boolean;
begin
  select * into a from public.cb_client_accounts where id = p_acct and cb_client_id = p_file.cb_client_id;
  perform private.require(a.id is not null, 'An account is not in this client''s chart of accounts.');
  while a.merged_into is not null and n < 10 loop
    select * into a from public.cb_client_accounts where id = a.merged_into; n := n + 1;
  end loop;
  v_chart := a.number <> '' and exists (select 1 from public.cb_chart_accounts where number = a.number);
  if a.number <> '' then
    select id into v from public.cb_accounts x where x.file_id = p_file.id and x.number = a.number
       and not exists (select 1 from public.cb_accounts c where c.file_id = p_file.id and c.parent_key = x.account_key)
     order by (x.account_key = 'chart:' || a.number) desc, x.account_key limit 1;
    v_key := case when not v_bank then a.number when v_chart then 'chart:' || a.number else 'acct:' || a.number end;
  else
    if v_bank and lower(a.name) = 'opening balances to enter' then v_key := 'opening';
    elsif v_bank and lower(a.name) = 'transactions not yet coded' then v_key := 'uncoded';
    else v_key := case when v_bank then 'acct:' else 'new:' end || lower(a.name);
    end if;
    select id into v from public.cb_accounts x where x.file_id = p_file.id
       and (x.account_key = v_key or (x.number = '' and lower(x.name) = lower(a.name))) order by (x.account_key = v_key) desc limit 1;
  end if;
  if v is null then
    insert into public.cb_accounts (file_id, account_key, number, name, this_year, line_no, mapping_source, mapped_by, mapped_at, chart_account, client_new)
    values (p_file.id, v_key, a.number, a.name, 0, a.line_no, 'preparer', (select auth.uid()), now(), case when v_chart then a.number end, not v_bank)
    on conflict (file_id, account_key) do nothing;
    select id into v from public.cb_accounts where file_id = p_file.id and account_key = v_key;
  end if;
  return v;
end;
$function$;

-- Save a journal entry from Books (QBO's Journal Entry window): lines on the client's accounts; the year that covers the
-- date takes a new entry. One History row (the entry's own).
create or replace function public.cb_books_save_entry(p_client uuid, p_entry uuid, p_date date, p_journal_no text, p_reclass boolean, p_memo text,
  p_lines jsonb, p_attachments text[] default '{}'::text[], p_origin text default null) returns uuid
 language plpgsql security definer set search_path to ''
as $function$
declare v_file public.cb_files; e public.cb_entries; v_lines jsonb := '[]'::jsonb; l jsonb; v_id uuid; v_no text := nullif(btrim(coalesce(p_journal_no, '')), '');
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  perform private.cb_books_client(p_client);
  perform private.require(p_date is not null, 'Enter the journal date.');
  perform private.require(p_origin is null or p_origin in ('opening_balances', 'opening_difference', 'tb_import'), 'Unknown entry origin.');
  perform private.require(jsonb_typeof(p_lines) = 'array', 'Add the lines.');
  if p_entry is not null then
    select * into e from public.cb_entries where id = p_entry;
    perform private.require(e.id is not null, 'Entry not found.');
    select * into v_file from public.cb_files where id = e.file_id;
    perform private.require(v_file.cb_client_id = p_client, 'Entry not found.');
    perform private.require(p_date between v_file.year_start - 1 and v_file.year_end,
      format('This entry belongs to the year %s to %s. To move it to another year, delete it and enter it again.', to_char(v_file.year_start, 'Mon FMDD, YYYY'), to_char(v_file.year_end, 'Mon FMDD, YYYY')));
  else
    v_file := private.cb_books_file_for(p_client, p_date, p_origin);
  end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account', private.cb_books_file_account(v_file, nullif(l ->> 'account', '')::uuid),
      'amount', (l ->> 'amount')::numeric, 'memo', coalesce(l ->> 'memo', ''), 'tax_code', nullif(l ->> 'tax_code', ''), 'is_tax', coalesce((l ->> 'is_tax')::boolean, false)));
  end loop;
  if p_entry is not null then
    v_id := public.cb_save_entry(v_file.id, p_entry, coalesce(p_reclass, false), e.kind, e.reason, coalesce(p_memo, ''), e.reverse_next_year, v_lines, e.wp_ref,
      p_date, e.standard_id, coalesce(p_attachments, '{}'), null);
  else
    v_id := public.cb_save_entry(v_file.id, null, coalesce(p_reclass, false), null, 'correction', coalesce(p_memo, ''), false, v_lines, '',
      p_date, null, coalesce(p_attachments, '{}'), null);
  end if;
  perform private.cb_one_action(true);   -- the save's own History row is the one row
  update public.cb_entries x set journal_no = case when v_no = format('%s-%s', to_char(v_file.year_end, 'YYYY'), lpad(x.seq::text, 3, '0')) then null else v_no end,
         origin = coalesce(x.origin, p_origin)
   where x.id = v_id;
  return v_id;
end;
$function$;

revoke all on function private.cb_books_client(uuid), private.cb_books_account_text(public.cb_client_accounts), private.cb_books_file_for(uuid, date, text),
  private.cb_books_file_account(public.cb_files, uuid) from public, anon, authenticated;
revoke all on function public.cb_books_add_client(text, text, uuid), public.cb_books_sync_accounts(uuid, jsonb),
  public.cb_books_save_account(uuid, uuid, text, text, text, text, text, boolean), public.cb_books_set_active(uuid, boolean),
  public.cb_books_save_entry(uuid, uuid, date, text, boolean, text, jsonb, text[], text) from public, anon;
grant execute on function public.cb_books_add_client(text, text, uuid), public.cb_books_sync_accounts(uuid, jsonb),
  public.cb_books_save_account(uuid, uuid, text, text, text, text, text, boolean), public.cb_books_set_active(uuid, boolean),
  public.cb_books_save_entry(uuid, uuid, date, text, boolean, text, jsonb, text[], text) to authenticated;
