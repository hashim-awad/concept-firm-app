-- Round 22 (Hashim, Nov 16, 2026; mock approved): Closebook step 3 "Bank statements" rework.
-- Benchmarks: QuickBooks Online Banking (one card per account, "Add an account", "Upload from file" in a
-- window, "Verify details"); CaseWare Cloud for structure (each account under its GIFI line, tied to last year).
--
-- 1. Accounts are added in step 3 ("+ Add account"), not on import. Type: Chequing, Savings, Credit card,
--    Line of credit or Loan. Placement (decisions 2 and 3):
--      Chequing 10000, then +10 (GIFI 1002; moves to 2600 when negative at year end)
--      Savings 10100, then +10 (1002)
--      Credit card 22000, then +10 (2707)
--      Line of credit 22100, then +10 (2701); long-term: file account from 25300 on GIFI 3149
--      Loan: file account from 22110 on GIFI 2701; long-term: 25000 Bank loan, then +10 (3143)
--    Named "<type> · <bank> ••• <last digits>", shown after the number: "10000 Chequing · MDB ••• 2201".
--    File accounts only: the standard chart does not change.
-- 2. Each account carries its balance in the books at the start of the year (books_opening, in the
--    account's own terms: a bank account's money, or what is owed on a card, line of credit or loan). The
--    trial balance opens each account at that balance; step 2 keeps last year's T2 lines as the check.
-- 3. A statement that crosses the year start or end is checked whole; only its lines inside the year are
--    imported (cards by purchase date). The balance at each year edge worked out from the statement is
--    kept (at_start, at_end), to sit beside the books balance. A difference is explained by outstanding
--    items (cb_bank_outstanding); an item at the start can name the line that cleared it, which then posts
--    nothing (the books already hold it).
-- 4. A fingerprint (SHA-256) of each uploaded file, so the same statement is not imported twice.
-- 5. "Possible account not set up": "Not ours" is recorded with who and when (cb_bank_not_ours).
-- 6. Coverage: when an account opened or closed during the year, or has no statements for a reason, the
--    reason is recorded; months outside it are not asked for.
-- 7. Step 3's sign-off waits for: every account's months covered (or a reason), nothing waiting to check,
--    the tie to step 2 on every GIFI line, and the year-edge differences explained.
-- Safe to run twice.

-- ---------- 1. Accounts
alter table public.cb_bank_accounts add column if not exists account_type text;
alter table public.cb_bank_accounts add column if not exists bank text;
alter table public.cb_bank_accounts add column if not exists long_term boolean not null default false;
alter table public.cb_bank_accounts add column if not exists books_opening numeric(14,2);
alter table public.cb_bank_accounts add column if not exists number_base text;
alter table public.cb_bank_accounts add column if not exists gifi_line text;
alter table public.cb_bank_accounts add column if not exists opened_on date;
alter table public.cb_bank_accounts add column if not exists closed_on date;
alter table public.cb_bank_accounts add column if not exists coverage_note text not null default '';
alter table public.cb_bank_accounts add column if not exists coverage_by uuid references public.staff (id);
alter table public.cb_bank_accounts add column if not exists coverage_at timestamptz;
alter table public.cb_bank_accounts add column if not exists origin text not null default 'import';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cb_bank_accounts_type_check') then
    alter table public.cb_bank_accounts add constraint cb_bank_accounts_type_check check (account_type is null or account_type in ('chequing', 'savings', 'card', 'loc', 'loan'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cb_bank_accounts_origin_check') then
    alter table public.cb_bank_accounts add constraint cb_bank_accounts_origin_check check (origin in ('import', 'added'));
  end if;
end $$;

-- The number: from number_base when set (file accounts with no standard account of their own), else
-- from the standard chart account, then +10 past every number taken (cb_bank_number, round 4b).
create or replace function private.cb_bank_account_number() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.chart_account is distinct from old.chart_account or new.number_base is distinct from old.number_base then
    new.number := private.cb_bank_number(new.file_id, coalesce(new.number_base, new.chart_account), new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists cb_bank_account_number on public.cb_bank_accounts;
create trigger cb_bank_account_number before insert or update of chart_account, number_base on public.cb_bank_accounts
  for each row execute function private.cb_bank_account_number();

-- Placement by type (decisions 2 and 3, Nov 16, 2026).
create or replace function private.cb_bank_placement(p_type text, p_long boolean)
returns table (std_name text, chart_account text, number_base text, gifi_line text, kind text)
language sql immutable set search_path = '' as $$
  select v.std_name, v.chart_account, v.number_base, v.gifi_line, v.kind from (values
    ('chequing', false, 'Chequing', '10000', null::text, null::text, 'bank'),
    ('savings', false, 'Savings', '10100', null, null, 'bank'),
    ('card', false, 'Credit card', '22000', null, null, 'card'),
    ('loc', false, 'Line of credit', '22100', null, null, 'card'),
    ('loc', true, 'Line of credit', '25200', '25300', '3149.00', 'card'),
    ('loan', false, 'Loan', '22100', '22110', null, 'card'),
    ('loan', true, 'Bank loan', '25000', null, null, 'card')
  ) v(t, l, std_name, chart_account, number_base, gifi_line, kind)
  where v.t = p_type and v.l = (coalesce(p_long, false) and p_type in ('loc', 'loan'));
$$;

-- Add or change an account. p_balance is typed positive; p_negative turns it round (a bank account
-- overdrawn, or a card, line of credit or loan in credit). The type cannot change once statements are in.
create or replace function public.cb_save_bank_account(p_file uuid, p_id uuid, p_type text, p_bank text, p_last4 text,
  p_balance numeric, p_negative boolean, p_long_term boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_acc public.cb_bank_accounts;
  p record;
  v_bank text := btrim(regexp_replace(coalesce(p_bank, ''), '\s+', ' ', 'g'));
  v_last text := regexp_replace(coalesce(p_last4, ''), '\D', '', 'g');
  v_name text;
  v_id uuid;
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
            case when p_negative then -p_balance else p_balance end, 'added', (select auth.uid()))
    returning id into v_id;
    perform private.cb_log(p_file, 'bank_account_added', 'records', format('Account added: %s, balance in the books %s.', v_name, to_char(case when p_negative then -p_balance else p_balance end, 'FM999,999,999,990.00')));
  else
    select * into v_acc from public.cb_bank_accounts where id = p_id and file_id = p_file for update;
    perform private.require(v_acc.id is not null, 'Account not found.');
    perform private.require(v_acc.kind = p.kind or not exists (select 1 from public.cb_bank_statements where account_id = p_id),
      'This account has statements. Undo its imports before changing it between a bank account and a card, line of credit or loan.');
    update public.cb_bank_accounts set name = v_name, name_key = lower(v_name), kind = p.kind, chart_account = p.chart_account, number_base = p.number_base,
           gifi_line = p.gifi_line, account_type = p_type, bank = v_bank, last4 = v_last, long_term = coalesce(p_long_term, false) and p_type in ('loc', 'loan'),
           books_opening = case when p_negative then -p_balance else p_balance end
     where id = p_id;
    v_id := p_id;
    perform private.cb_log(p_file, 'bank_account_changed', 'records', format('Account changed: %s, balance in the books %s.', v_name, to_char(case when p_negative then -p_balance else p_balance end, 'FM999,999,999,990.00')));
  end if;
  update public.cb_files set updated_at = now() where id = p_file;
  return v_id;
end;
$$;

-- Remove an account that has no statements (added by mistake).
create or replace function public.cb_remove_bank_account(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_acc public.cb_bank_accounts;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_acc from public.cb_bank_accounts where id = p_id;
  perform private.require(v_acc.id is not null, 'Account not found.');
  perform private.require((select phase from public.cb_files where id = v_acc.file_id) <> 'locked', 'This file is locked.');
  perform private.require(not exists (select 1 from public.cb_bank_statements where account_id = p_id), 'This account has statements. Undo its imports first.');
  delete from public.cb_bank_accounts where id = p_id;
  perform private.cb_log(v_acc.file_id, 'bank_account_removed', 'records', format('Account removed: %s.', v_acc.name));
end;
$$;

-- Coverage reason: the account opened or closed during the year, or a note on why there are no statements.
create or replace function public.cb_set_bank_coverage(p_id uuid, p_opened date, p_closed date, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_acc public.cb_bank_accounts; v_file public.cb_files;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_acc from public.cb_bank_accounts where id = p_id;
  perform private.require(v_acc.id is not null, 'Account not found.');
  select * into v_file from public.cb_files where id = v_acc.file_id;
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(p_opened is null or p_opened between v_file.year_start and v_file.year_end, 'The opening date must be inside the year.');
  perform private.require(p_closed is null or p_closed between v_file.year_start and v_file.year_end, 'The closing date must be inside the year.');
  perform private.require(p_opened is null or p_closed is null or p_closed >= p_opened, 'The account cannot close before it opened.');
  perform private.require(length(coalesce(p_note, '')) <= 300, 'Keep the note to 300 characters.');
  update public.cb_bank_accounts set opened_on = p_opened, closed_on = p_closed, coverage_note = btrim(coalesce(p_note, '')),
         coverage_by = case when p_opened is null and p_closed is null and btrim(coalesce(p_note, '')) = '' then null else (select auth.uid()) end,
         coverage_at = case when p_opened is null and p_closed is null and btrim(coalesce(p_note, '')) = '' then null else now() end
   where id = p_id;
  perform private.cb_log(v_acc.file_id, 'bank_coverage', 'records', format('%s: %s.', v_acc.name,
    concat_ws('; ', case when p_opened is not null then 'opened ' || to_char(p_opened, 'Mon FMDD, YYYY') end,
                     case when p_closed is not null then 'closed ' || to_char(p_closed, 'Mon FMDD, YYYY') end,
                     nullif(btrim(coalesce(p_note, '')), ''), case when p_opened is null and p_closed is null and btrim(coalesce(p_note, '')) = '' then 'reason cleared' end)));
end;
$$;

-- ---------- 3. Statements, lines and the year edges
alter table public.cb_bank_statements add column if not exists at_start numeric(14,2);
alter table public.cb_bank_statements add column if not exists at_end numeric(14,2);
alter table public.cb_bank_statements add column if not exists file_sha256 text;
alter table public.cb_bank_statements add column if not exists outside_lines integer not null default 0;
alter table public.cb_bank_lines add column if not exists posted_date date;

-- Lines that cleared an outstanding item at the start of the year: matched to it, posting nothing.
do $$
declare d text;
begin
  select pg_get_constraintdef(oid) into d from pg_constraint where conname = 'cb_bank_lines_source_check';
  if d is not null and d not like '%outstanding%' then
    execute 'alter table public.cb_bank_lines drop constraint cb_bank_lines_source_check';
    execute 'alter table public.cb_bank_lines add constraint cb_bank_lines_source_check ' || replace(d, '''transfer''::text', '''transfer''::text, ''outstanding''::text');
  end if;
end $$;

create table if not exists public.cb_bank_outstanding (
  id           uuid primary key default gen_random_uuid(),
  file_id      uuid not null references public.cb_files (id) on delete cascade,
  account_id   uuid not null references public.cb_bank_accounts (id) on delete cascade,
  edge         text not null check (edge in ('start', 'end')),
  item_date    date not null,
  description  text not null check (length(btrim(description)) between 1 and 200),
  dir          text not null check (dir in ('in', 'out')),   -- 'in' raises the statement balance (a deposit, or a card charge)
  amount       numeric(14,2) not null check (amount > 0),
  cleared_line uuid unique references public.cb_bank_lines (id) on delete set null,
  created_by   uuid references public.staff (id),
  created_at   timestamptz not null default now()
);
create index if not exists cb_bank_outstanding_account on public.cb_bank_outstanding (account_id);
alter table public.cb_bank_outstanding enable row level security;
alter table public.cb_bank_outstanding force row level security;
drop policy if exists "Closebook viewers read outstanding items" on public.cb_bank_outstanding;
create policy "Closebook viewers read outstanding items" on public.cb_bank_outstanding for select to authenticated using ((select private.can_view('closebook')));
grant select on public.cb_bank_outstanding to authenticated;

-- A line freed from an outstanding item goes back to "to code".
create or replace function private.cb_outstanding_release() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.cleared_line is not null and (tg_op = 'DELETE' or new.cleared_line is distinct from old.cleared_line) then
    -- The transfer guard (round 20) lets only its own matches set or clear "matched"; this is one of them.
    perform set_config('cb.transfer', 'on', true);
    update public.cb_bank_lines set status = 'new', source = '', chart_account = null, tax_code = null, coded_by = null, coded_at = null where id = old.cleared_line and source = 'outstanding';
    perform set_config('cb.transfer', '', true);
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function private.cb_outstanding_release() from public, anon, authenticated;
drop trigger if exists cb_outstanding_release on public.cb_bank_outstanding;
create trigger cb_outstanding_release after update or delete on public.cb_bank_outstanding for each row execute function private.cb_outstanding_release();

create or replace function public.cb_add_outstanding(p_account uuid, p_edge text, p_date date, p_description text, p_dir text, p_amount numeric, p_cleared_line uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_acc public.cb_bank_accounts; v_file public.cb_files; v_line public.cb_bank_lines; v_id uuid;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_acc from public.cb_bank_accounts where id = p_account;
  perform private.require(v_acc.id is not null, 'Account not found.');
  select * into v_file from public.cb_files where id = v_acc.file_id;
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(p_edge in ('start', 'end'), 'Choose the start or the end of the year.');
  perform private.require(p_dir in ('in', 'out'), 'Choose what kind of item it is.');
  perform private.require(p_date is not null, 'Enter the date of the item.');
  perform private.require(length(btrim(coalesce(p_description, ''))) between 1 and 200, 'Describe the item, for example "Cheque #204".');
  perform private.require(p_amount is not null and p_amount > 0 and round(p_amount, 2) = p_amount, 'Enter the amount as a positive number with up to 2 decimals.');
  if p_cleared_line is not null then
    select * into v_line from public.cb_bank_lines where id = p_cleared_line and account_id = p_account;
    perform private.require(v_line.id is not null, 'The line that cleared it must be on this account.');
    perform private.require(p_edge = 'start', 'Only an item at the start of the year is cleared by a line in the year.');
    perform private.require(abs(v_line.amount) = p_amount, 'The line that cleared it must be for the same amount.');
    perform private.require(not exists (select 1 from public.cb_bank_transfers where out_line = p_cleared_line or in_line = p_cleared_line), 'That line is matched as a transfer.');
  end if;
  insert into public.cb_bank_outstanding (file_id, account_id, edge, item_date, description, dir, amount, cleared_line, created_by)
  values (v_acc.file_id, p_account, p_edge, p_date, btrim(p_description), p_dir, p_amount, p_cleared_line, (select auth.uid())) returning id into v_id;
  if p_cleared_line is not null then
    -- The books already hold it (last year): the line posts nothing.
    perform set_config('cb.transfer', 'on', true);
    update public.cb_bank_lines set status = 'matched', source = 'outstanding', chart_account = null, tax_code = null, coded_by = (select auth.uid()), coded_at = now() where id = p_cleared_line;
    perform set_config('cb.transfer', '', true);
  end if;
  perform private.cb_log(v_acc.file_id, 'bank_outstanding', 'records', format('%s: outstanding item at the %s of the year, %s %s.', v_acc.name,
    case when p_edge = 'start' then 'start' else 'end' end, btrim(p_description), to_char(p_amount, 'FM999,999,999,990.00')));
  return v_id;
end;
$$;

create or replace function public.cb_remove_outstanding(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.cb_bank_outstanding;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v from public.cb_bank_outstanding where id = p_id;
  perform private.require(v.id is not null, 'Item not found.');
  perform private.require((select phase from public.cb_files where id = v.file_id) <> 'locked', 'This file is locked.');
  delete from public.cb_bank_outstanding where id = p_id;
end;
$$;

-- ---------- 4. Uploads: fingerprint, the account it was uploaded to, Skip
alter table public.cb_statement_imports add column if not exists file_sha256 text;
alter table public.cb_statement_imports add column if not exists target_account uuid references public.cb_bank_accounts (id) on delete set null;
do $$
declare d text;
begin
  select pg_get_constraintdef(oid) into d from pg_constraint where conname = 'cb_statement_imports_status_check';
  if d is not null and d not like '%skipped%' then
    execute 'alter table public.cb_statement_imports drop constraint cb_statement_imports_status_check';
    execute 'alter table public.cb_statement_imports add constraint cb_statement_imports_status_check ' || replace(d, '''discarded''::text', '''discarded''::text, ''skipped''::text');
  end if;
end $$;
create index if not exists cb_statement_imports_sha on public.cb_statement_imports (file_id, file_sha256);

-- The account the statements were uploaded to (the card's "Upload statements"), or moved to.
create or replace function public.cb_statement_target(p_ids uuid[], p_account uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  perform private.require(p_account is null or exists (select 1 from public.cb_bank_accounts a join public.cb_statement_imports i on i.file_id = a.file_id
                                                        where a.id = p_account and i.id = any(p_ids)), 'Choose an account on this file.');
  update public.cb_statement_imports set target_account = p_account
   where id = any(coalesce(p_ids, '{}')) and file_id is not null and status not in ('imported', 'discarded')
     and (select phase from public.cb_files f where f.id = file_id) <> 'locked';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Skip: a statement outside the year is not needed. It stays listed, greyed; "Bring back" returns it with
-- the status the screen works out from its checks (ready or needs a look).
create or replace function public.cb_skip_statement(p_id uuid, p_skip boolean, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.cb_statement_imports;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v from public.cb_statement_imports where id = p_id for update;
  perform private.require(v.id is not null and v.file_id is not null, 'Statement not found.');
  perform private.require((select phase from public.cb_files where id = v.file_id) <> 'locked', 'This file is locked.');
  if p_skip then
    perform private.require(v.status in ('ready', 'needs_look'), 'Only a statement that was read can be skipped.');
    update public.cb_statement_imports set status = 'skipped' where id = p_id;
  else
    perform private.require(v.status = 'skipped', 'This statement is not skipped.');
    perform private.require(p_status in ('ready', 'needs_look'), 'The status is missing.');
    update public.cb_statement_imports set status = p_status where id = p_id;
  end if;
end;
$$;


-- ---------- 5. "Not ours"
create table if not exists public.cb_bank_not_ours (
  file_id    uuid not null references public.cb_files (id) on delete cascade,
  last4      text not null check (last4 ~ '^[0-9]{2,8}$'),
  label      text not null default '',
  decided_by uuid references public.staff (id),
  decided_at timestamptz not null default now(),
  primary key (file_id, last4)
);
alter table public.cb_bank_not_ours enable row level security;
alter table public.cb_bank_not_ours force row level security;
drop policy if exists "Closebook viewers read not ours" on public.cb_bank_not_ours;
create policy "Closebook viewers read not ours" on public.cb_bank_not_ours for select to authenticated using ((select private.can_view('closebook')));
grant select on public.cb_bank_not_ours to authenticated;

create or replace function public.cb_set_not_ours(p_file uuid, p_last4 text, p_label text, p_not_ours boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  perform private.require((select phase from public.cb_files where id = p_file) <> 'locked', 'This file is locked.');
  perform private.require(coalesce(p_last4, '') ~ '^[0-9]{2,8}$', 'The last digits are missing.');
  if p_not_ours then
    insert into public.cb_bank_not_ours (file_id, last4, label, decided_by) values (p_file, p_last4, left(btrim(coalesce(p_label, '')), 60), (select auth.uid()))
    on conflict (file_id, last4) do update set label = excluded.label, decided_by = excluded.decided_by, decided_at = now();
    perform private.cb_log(p_file, 'bank_not_ours', 'records', format('Not ours: %s.', coalesce(nullif(btrim(p_label), ''), '••• ' || p_last4)));
  else
    delete from public.cb_bank_not_ours where file_id = p_file and last4 = p_last4;
  end if;
end;
$$;

-- ---------- 3 (continued). Import: whole statement checked, only lines inside the year imported.
-- p_accounts: [{ key, account, last4, opening, closing, period_start, period_end, at_start, at_end,
--   rows: [{ line, date, posted, description, amount }], check, edits }]. Every account must be one the
-- file already has (accounts are added in step 3, not on import).
create or replace function private.cb_add_statement(p_file uuid, p_account uuid, p_file_name text, p_opening numeric, p_closing numeric, p_rows jsonb,
  p_period_start date, p_period_end date, p_at_start numeric, p_at_end numeric, p_sha text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_acc public.cb_bank_accounts;
  v_row jsonb;
  v_sum numeric := 0; v_plus numeric := 0; v_minus numeric := 0; v_amt numeric;
  v_first date; v_last date; v_d date;
  v_clash public.cb_bank_statements;
  v_stmt uuid;
  v_in int := 0;
begin
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null, 'File not found.');
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  select * into v_acc from public.cb_bank_accounts where id = p_account and file_id = p_file;
  perform private.require(v_acc.id is not null, 'Choose an account on this file.');
  perform private.require(p_opening is not null and p_closing is not null and round(p_opening, 2) = p_opening and round(p_closing, 2) = p_closing, 'Enter the statement''s opening and closing balances.');
  perform private.require(p_period_start is not null and p_period_end is not null and p_period_end >= p_period_start and p_period_end - p_period_start <= 400,
    'Enter the statement period: the first and last day the statement covers.');
  perform private.require(p_period_end >= v_file.year_start and p_period_start <= v_file.year_end, 'This statement is outside the year: it is not needed.');
  perform private.require(jsonb_typeof(p_rows) = 'array' and jsonb_array_length(p_rows) between 1 and 20000, 'The statement has no lines, or too many.');
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_amt := (v_row ->> 'amount')::numeric;
    perform private.require(v_amt is not null and round(v_amt, 2) = v_amt, 'Every amount has at most 2 decimals.');
    perform private.require((v_row ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$' and length(btrim(coalesce(v_row ->> 'description', ''))) between 1 and 500, 'Every line needs a date and a description.');
    v_d := (v_row ->> 'date')::date;
    v_sum := v_sum + v_amt;
    if v_amt > 0 then v_plus := v_plus + v_amt; else v_minus := v_minus + v_amt; end if;
    v_first := least(v_first, v_d); v_last := greatest(v_last, v_d);
    if v_d between v_file.year_start and v_file.year_end then v_in := v_in + 1; end if;
  end loop;
  -- The whole statement must balance, to the cent.
  perform private.require(p_opening + v_sum = p_closing, format('The statement does not balance. Opening %s + lines %s = %s, but the closing balance is %s.',
    to_char(p_opening, 'FM999,999,999,990.00'), to_char(v_sum, 'FM999,999,999,990.00'), to_char(p_opening + v_sum, 'FM999,999,999,990.00'), to_char(p_closing, 'FM999,999,999,990.00')));
  -- The same statement twice: the same file, or a period already in.
  perform private.require(p_sha is null or not exists (select 1 from public.cb_bank_statements where file_id = p_file and file_sha256 = p_sha),
    'This statement is already imported: the same file is in this file.');
  select * into v_clash from public.cb_bank_statements
   where account_id = v_acc.id and period_start <= p_period_end and period_end >= p_period_start order by period_start limit 1;
  perform private.require(v_clash.id is null, format('This period (%s to %s) overlaps a statement already imported for %s (%s to %s). Undo that import first if this replaces it.',
    to_char(p_period_start, 'Mon FMDD, YYYY'), to_char(p_period_end, 'Mon FMDD, YYYY'), v_acc.name, to_char(v_clash.period_start, 'Mon FMDD, YYYY'), to_char(v_clash.period_end, 'Mon FMDD, YYYY')));
  perform private.require(v_in > 0, 'No line of this statement is inside the year: it is not needed. Skip it.');

  insert into public.cb_bank_statements (file_id, account_id, file_name, first_date, last_date, period_start, period_end, opening, closing, lines, plus_total, minus_total,
                                         uploaded_by, at_start, at_end, file_sha256, outside_lines)
  values (p_file, v_acc.id, left(coalesce(p_file_name, ''), 200), coalesce(v_first, p_period_start), coalesce(v_last, p_period_end), p_period_start, p_period_end, p_opening, p_closing,
          v_in, v_plus, v_minus, (select auth.uid()),
          case when v_file.year_start between p_period_start and p_period_end then p_at_start end,
          case when v_file.year_end between p_period_start and p_period_end then p_at_end end, p_sha, jsonb_array_length(p_rows) - v_in)
  returning id into v_stmt;
  insert into public.cb_bank_lines (statement_id, file_id, account_id, row_no, txn_date, posted_date, description, amount)
  select v_stmt, p_file, v_acc.id, coalesce((r ->> 'line')::int, 0), (r ->> 'date')::date, nullif(r ->> 'posted', '')::date, btrim(r ->> 'description'), (r ->> 'amount')::numeric
    from jsonb_array_elements(p_rows) r
   where (r ->> 'date')::date between v_file.year_start and v_file.year_end;
  update public.cb_files set updated_at = now() where id = p_file;
  return jsonb_build_object('statement', v_stmt, 'account', v_acc.name, 'account_id', v_acc.id, 'lines', v_in, 'outside', jsonb_array_length(p_rows) - v_in);
end;
$$;
revoke all on function private.cb_add_statement(uuid, uuid, text, numeric, numeric, jsonb, date, date, numeric, numeric, text) from public, anon, authenticated;

create or replace function public.cb_import_statement(p_import uuid, p_accounts jsonb, p_confirm_dups boolean, p_attachment text)
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
  perform private.require(jsonb_typeof(p_accounts) = 'array' and jsonb_array_length(p_accounts) >= 1, 'Choose an account for at least one statement.');
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
  end loop;
  -- Tokens and cost split across the statements by line count (round 20).
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
  perform private.cb_log(v.file_id, 'statement_imported', 'records',
    format('PDF statement imported: %s, %s account%s, %s line%s.', v.file_name, jsonb_array_length(p_accounts),
           case when jsonb_array_length(p_accounts) = 1 then '' else 's' end, v_lines, case when v_lines = 1 then '' else 's' end));
  return v_out;
end;
$$;

-- Undo import: the statement and its lines go (with their codes, transfers and cleared items); an account
-- added in step 3 stays. The statement read from a PDF goes back to "ready to check".
create or replace function public.cb_delete_bank_statement(p_statement uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_st public.cb_bank_statements;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_st from public.cb_bank_statements where id = p_statement;
  perform private.require(v_st.id is not null, 'Statement not found.');
  perform private.require((select phase from public.cb_files where id = v_st.file_id) <> 'locked', 'This file is locked.');
  delete from public.cb_bank_statements where id = p_statement;
  delete from public.cb_bank_accounts a where a.id = v_st.account_id and a.origin = 'import' and not exists (select 1 from public.cb_bank_statements s where s.account_id = a.id);
  if v_st.statement_import_id is not null and not exists (select 1 from public.cb_bank_statements where statement_import_id = v_st.statement_import_id) then
    update public.cb_statement_imports set status = 'needs_look', imported_at = null, imported_by = null where id = v_st.statement_import_id and status = 'imported';
  end if;
  perform private.cb_log(v_st.file_id, 'statement_undone', 'records', format('Import undone: %s, %s to %s.', v_st.file_name,
    to_char(v_st.period_start, 'Mon FMDD, YYYY'), to_char(v_st.period_end, 'Mon FMDD, YYYY')));
  update public.cb_files set updated_at = now() where id = v_st.file_id;
end;
$$;

-- ---------- 7. Step 3's problems (the sign-off waits for these)
create or replace function private.cb_records_problems(p_file uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_out text[] := '{}';
  a record;
  v_n int;
  v_gap int;
  v_from date; v_to date;
  v_bal numeric; v_items numeric; v_books numeric;
  g record;
begin
  select * into v_file from public.cb_files where id = p_file;
  if not exists (select 1 from public.cb_bank_accounts where file_id = p_file) then
    return array['Add the bank and card accounts and upload their statements.'];
  end if;
  for a in select * from public.cb_bank_accounts where file_id = p_file order by number loop
    if a.books_opening is null then
      v_out := v_out || format('%s %s: enter its balance in the books on %s.', a.number, a.name, to_char(v_file.year_start - 1, 'Mon FMDD, YYYY'));
    end if;
    -- Months covered, between the dates it opened and closed; a note with no dates waives them.
    if not (a.opened_on is null and a.closed_on is null and a.coverage_note <> '') then
      v_from := greatest(v_file.year_start, coalesce(a.opened_on, v_file.year_start));
      v_to := least(v_file.year_end, coalesce(a.closed_on, v_file.year_end));
      select count(*) into v_n from (
        select distinct date_trunc('month', d) from generate_series(v_from::timestamp, v_to::timestamp, interval '1 day') d
         where not exists (select 1 from public.cb_bank_statements s where s.account_id = a.id and d::date between s.period_start and s.period_end)) x;
      if v_n > 0 then
        v_out := v_out || format('%s %s: %s month%s not covered by statements. Upload them, or record why (opened or closed in the year).', a.number, a.name, v_n, case when v_n = 1 then '' else 's' end);
      end if;
      v_gap := v_n;
    else
      v_gap := 0;
    end if;
    select count(*) into v_n from (
      select opening, lag(closing) over (order by period_start) prev from public.cb_bank_statements where account_id = a.id) x
     where prev is not null and opening <> prev;
    if v_n > 0 then v_out := v_out || format('%s %s: %s statement%s whose opening balance does not follow the one before.', a.number, a.name, v_n, case when v_n = 1 then '' else 's' end); end if;
    -- The year edges: the balance from the statements, against the books, explained by outstanding items.
    if a.books_opening is not null then
      select at_start into v_bal from public.cb_bank_statements where account_id = a.id and at_start is not null order by period_start limit 1;
      if v_bal is not null then
        select coalesce(sum(case when dir = 'in' then amount else -amount end), 0) into v_items from public.cb_bank_outstanding where account_id = a.id and edge = 'start';
        if v_bal + v_items <> a.books_opening then
          v_out := v_out || format('%s %s: the statements show %s on %s and the books %s. Explain the difference of %s with outstanding items.', a.number, a.name,
            private.cb_bracket(v_bal), to_char(v_file.year_start - 1, 'Mon FMDD, YYYY'), private.cb_bracket(a.books_opening), private.cb_bracket(a.books_opening - v_bal - v_items));
        end if;
      end if;
      -- The end edge once every month is in (before that the books are missing lines).
      select at_end into v_bal from public.cb_bank_statements where account_id = a.id and at_end is not null order by period_start desc limit 1;
      if v_bal is not null and v_gap = 0 then
        select a.books_opening + coalesce(sum(l.amount), 0) into v_books from public.cb_bank_lines l where l.account_id = a.id and not (l.status = 'matched' and l.source = 'outstanding');
        select coalesce(sum(case when dir = 'in' then amount else -amount end), 0) into v_items from public.cb_bank_outstanding where account_id = a.id and edge = 'end';
        if v_bal + v_items <> v_books then
          v_out := v_out || format('%s %s: the statements show %s on %s and the books %s. Explain the difference of %s with outstanding items.', a.number, a.name,
            private.cb_bracket(v_bal), to_char(v_file.year_end, 'Mon FMDD, YYYY'), private.cb_bracket(v_books), private.cb_bracket(v_books - v_bal - v_items));
        end if;
      end if;
    end if;
  end loop;
  -- Nothing waiting to check: statements read or reading, not outside the year and not already imported.
  select count(*) into v_n from public.cb_statement_imports i
   where i.file_id = p_file and i.status in ('queued', 'reading', 'ready', 'needs_look', 'failed')
     and not (coalesce(i.summary ->> 'period_end', '9999-12-31') < v_file.year_start::text or coalesce(i.summary ->> 'period_start', '0000-01-01') > v_file.year_end::text)
     and not (i.file_sha256 is not null and exists (select 1 from public.cb_bank_statements s where s.file_id = p_file and s.file_sha256 = i.file_sha256));
  if v_n > 0 then v_out := v_out || format('%s statement%s waiting to check.', v_n, case when v_n = 1 then '' else 's' end); end if;
  -- The tie to step 2: each GIFI line's accounts against last year's T2 (none on a first-year file).
  if v_file.opening_source is not null or v_file.first_year then
    for g in select coalesce(left(a2.gifi_line, 4), left(c.line_no, 4)) as code, sum(coalesce(a2.books_opening, 0)) as books
               from public.cb_bank_accounts a2 left join public.cb_chart_accounts c on c.number = a2.chart_account
              where a2.file_id = p_file group by 1 loop
      if g.code is not null and coalesce((select amount from public.cb_opening_balances where file_id = p_file and code = g.code), 0) <> g.books then
        v_out := v_out || format('GIFI %s: the accounts open at %s, last year''s T2 has %s.', g.code, private.cb_bracket(g.books),
          private.cb_bracket(coalesce((select amount from public.cb_opening_balances where file_id = p_file and code = g.code), 0)));
      end if;
    end loop;
  end if;
  return v_out;
end;
$$;
revoke all on function private.cb_records_problems(uuid) from public, anon, authenticated;

-- Step 3 in the step list and its sign-off use cb_records_problems (the rest of the function as round 21).
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

-- ---------- Grants
revoke all on function public.cb_save_bank_account(uuid, uuid, text, text, text, numeric, boolean, boolean), public.cb_remove_bank_account(uuid),
  public.cb_set_bank_coverage(uuid, date, date, text), public.cb_add_outstanding(uuid, text, date, text, text, numeric, uuid), public.cb_remove_outstanding(uuid),
  public.cb_statement_target(uuid[], uuid), public.cb_skip_statement(uuid, boolean, text), public.cb_set_not_ours(uuid, text, text, boolean),
  public.cb_import_statement(uuid, jsonb, boolean, text), public.cb_delete_bank_statement(uuid) from public, anon;
grant execute on function public.cb_save_bank_account(uuid, uuid, text, text, text, numeric, boolean, boolean), public.cb_remove_bank_account(uuid),
  public.cb_set_bank_coverage(uuid, date, date, text), public.cb_add_outstanding(uuid, text, date, text, text, numeric, uuid), public.cb_remove_outstanding(uuid),
  public.cb_statement_target(uuid[], uuid), public.cb_skip_statement(uuid, boolean, text), public.cb_set_not_ours(uuid, text, text, boolean),
  public.cb_import_statement(uuid, jsonb, boolean, text), public.cb_delete_bank_statement(uuid) to authenticated;
revoke all on function private.cb_bank_placement(text, boolean), private.cb_bank_account_number() from public, anon, authenticated;
