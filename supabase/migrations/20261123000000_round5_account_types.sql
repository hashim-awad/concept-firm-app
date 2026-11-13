-- Round 5 (Hashim, Nov 21, 2026): the step 7 type check works from each account's type.
--
-- Before, step 7 read the type from the first digit of a 4-digit account number only, so it never ran on
-- the 5-digit standard chart or on most client charts. Now every account carries its type, as CaseWare
-- carries an account's class next to its map number and checks one against the other:
--   1. a standard chart account (or a bank account on one): the chart's type ("chart");
--   2. a client account: the type in the client's trial balance import, when the export has a Type column
--      (QuickBooks Online "Account type", Xero "Account Type") ("import");
--   3. an account added in Closebook: the QuickBooks Online type chosen for it ("client");
--   4. otherwise, the account number's first digit, on a 4- or 5-digit number: 1 asset, 2 liability,
--      3 equity, 4 revenue, 5 to 9 expense ("number");
--   5. otherwise no type, and no check.
-- An account whose type differs from its GIFI line's type is flagged for the reviewer until the reviewer
-- matches it (their match confirms it). private.cb_open_type_flags counts the open flags, for the step 7
-- sign-off.
-- Safe to run twice (round 4d rule).

alter table public.cb_accounts add column if not exists tb_type text;
alter table public.cb_accounts add column if not exists account_type text;
alter table public.cb_accounts add column if not exists type_source text;
alter table public.cb_accounts drop constraint if exists cb_accounts_account_type_check;
alter table public.cb_accounts add constraint cb_accounts_account_type_check check (account_type in ('Asset', 'Liability', 'Equity', 'Revenue', 'Expense'));
alter table public.cb_accounts drop constraint if exists cb_accounts_type_source_check;
alter table public.cb_accounts add constraint cb_accounts_type_source_check check (type_source in ('chart', 'import', 'client', 'number'));
alter table public.cb_accounts drop constraint if exists cb_accounts_tb_type_check;
alter table public.cb_accounts add constraint cb_accounts_tb_type_check check (length(tb_type) <= 60);

-- An account type as words (QuickBooks Online, Xero, Sage and most bookkeeper exports) as one of the five.
create or replace function private.cb_type_from_text(p text) returns text language sql immutable set search_path = '' as $$
  select case
    when t is null or t = '' then null
    when t ~ '(cost of goods|cost of sales|direct cost|expense|overhead|depreciation|amortization)' then 'Expense'
    when t ~ '(income|revenue|sales)' then 'Revenue'
    when t ~ '(payable|a/p|credit card|liabilit)' then 'Liability'
    when t ~ '(equity|capital|retained)' then 'Equity'
    when t ~ '(bank|receivable|a/r|asset|inventory|prepayment|current)' then 'Asset'
  end
  from (select lower(btrim(p)) as t) x;
$$;

-- The type from an account number: a 4- or 5-digit number (decimals allowed), by its first digit.
create or replace function private.cb_type_from_number(p text) returns text language sql immutable set search_path = '' as $$
  select case when coalesce(p, '') !~ '^\d{4,5}(\.\d+)?$' then null
    else case left(p, 1) when '1' then 'Asset' when '2' then 'Liability' when '3' then 'Equity' when '4' then 'Revenue'
      when '0' then null else 'Expense' end end;
$$;

create or replace function private.cb_account_type() returns trigger language plpgsql set search_path = '' as $$
declare v text;
begin
  new.account_type := null; new.type_source := null;
  if new.account_key in ('opening', 'uncoded') or new.account_key like 'line:%' or new.account_key like 'gifi:%' then
    return new;  -- a GIFI line's own account, or a system row: no separate type to check
  end if;
  if new.account_key like 'chart:%' then
    select account_type into v from public.cb_chart_accounts where number = substr(new.account_key, 7);
    new.account_type := v; new.type_source := case when v is null then null else 'chart' end;
  elsif new.account_key like 'bank:%' then
    select c.account_type into v from public.cb_bank_accounts b join public.cb_chart_accounts c on c.number = b.chart_account
     where b.id::text = substr(new.account_key, 6);
    new.account_type := v; new.type_source := case when v is null then null else 'chart' end;
  elsif private.cb_type_from_text(new.tb_type) is not null then
    new.account_type := private.cb_type_from_text(new.tb_type); new.type_source := 'import';
  elsif private.cb_type_from_text(new.qbo_type) is not null then
    new.account_type := private.cb_type_from_text(new.qbo_type); new.type_source := 'client';
  elsif private.cb_type_from_number(new.number) is not null then
    new.account_type := private.cb_type_from_number(new.number); new.type_source := 'number';
  end if;
  return new;
end;
$$;
revoke all on function private.cb_account_type() from public, anon, authenticated;
drop trigger if exists cb_account_type on public.cb_accounts;
create trigger cb_account_type before insert or update of account_key, number, tb_type, qbo_type on public.cb_accounts
  for each row execute function private.cb_account_type();

-- Every existing account gets its type.
update public.cb_accounts set account_key = account_key;

-- Open type flags in a file: an account whose type differs from its GIFI line's, not yet confirmed by the
-- reviewer. Step 7 cannot be signed off while this is above 0.
create or replace function private.cb_open_type_flags(p_file uuid) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.cb_accounts a join public.cb_master_lines m on m.line_no = a.line_no
   where a.file_id = p_file and a.account_type is not null and m.line_type <> a.account_type
     and a.mapping_source is distinct from 'reviewer';
$$;
revoke all on function private.cb_open_type_flags(uuid) from public, anon, authenticated;

-- The import keeps the Type column of the client's trial balance, when the export has one.
create or replace function public.cb_import_tb(p_file uuid, p_target text, p_source text, p_file_name text, p_rows jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_row jsonb;
  v_key text;
  v_amt numeric;
  v_dr numeric := 0;
  v_cr numeric := 0;
  v_n int := 0;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook to import.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null, 'File not found.');
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(p_target in ('this_year', 'last_year'), 'Unknown column.');
  perform private.require(jsonb_typeof(p_rows) = 'array' and jsonb_array_length(p_rows) between 1 and 5000, 'The file has no accounts, or too many.');
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_amt := round((v_row ->> 'amount')::numeric, 2);
    if v_amt > 0 then v_dr := v_dr + v_amt; else v_cr := v_cr - v_amt; end if;
  end loop;
  perform private.require(v_dr = v_cr, format('The trial balance does not balance: debits %s, credits %s, difference %s.', v_dr, v_cr, v_dr - v_cr));

  if p_target = 'this_year' then update public.cb_accounts set this_year = 0 where file_id = p_file;
  else update public.cb_accounts set last_year = 0 where file_id = p_file; end if;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    perform private.require(length(btrim(coalesce(v_row ->> 'name', ''))) between 1 and 200, 'Every account needs a name.');
    v_key := coalesce(nullif(btrim(v_row ->> 'number'), ''), lower(regexp_replace(btrim(v_row ->> 'name'), '\s+', ' ', 'g')));
    v_amt := round((v_row ->> 'amount')::numeric, 2);
    insert into public.cb_accounts (file_id, account_key, number, name, this_year, last_year, tb_type)
    values (p_file, v_key, btrim(coalesce(v_row ->> 'number', '')), btrim(v_row ->> 'name'),
            case when p_target = 'this_year' then v_amt else 0 end, case when p_target = 'last_year' then v_amt else 0 end,
            left(nullif(btrim(coalesce(v_row ->> 'type', '')), ''), 60))
    on conflict (file_id, account_key) do update
      set name = excluded.name,
          tb_type = coalesce(excluded.tb_type, public.cb_accounts.tb_type),
          this_year = case when p_target = 'this_year' then public.cb_accounts.this_year + excluded.this_year else public.cb_accounts.this_year end,
          last_year = case when p_target = 'last_year' then public.cb_accounts.last_year + excluded.last_year else public.cb_accounts.last_year end;
    v_n := v_n + 1;
  end loop;
  perform private.cb_prune_accounts(p_file);
  insert into public.cb_imports (file_id, target, source, file_name, rows, debit_total, credit_total, imported_by)
  values (p_file, p_target, p_source, left(coalesce(p_file_name, ''), 200), v_n, v_dr, v_cr, (select auth.uid()));
  update public.cb_files set updated_at = now() where id = p_file;
  return v_n;
end;
$$;
