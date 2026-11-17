-- Round 28 (Hashim, Nov 17, 2026): statement rules for every account type, and loan statements.
-- 1. No account checks, as QuickBooks Online: the statement goes to the account the person picked. The digits read
--    from the statement are kept as information (cb_bank_statements.statement_last4), shown in View statements.
--    Replace file no longer compares account digits (the period, balances and lines still decide).
-- 2. A line that does not move the printed running balance (a loan's interest payment taken from chequing, its
--    reversal, the payment that re-pays it) is information only: kept in cb_bank_info_lines, shown greyed "No effect
--    on balance", never posted, never coded, in no total or check. Rows carry "no_effect": true.
-- 3. A loan line's Transaction Date is kept beside its Effective Date (the bank date): cb_bank_lines.printed_date.
-- Safe to run twice: columns and tables "if not exists", each patch checks for its own text.

alter table public.cb_bank_statements add column if not exists statement_last4 text;
alter table public.cb_bank_lines add column if not exists printed_date date;
alter table public.cb_excluded_statements add column if not exists info_rows jsonb not null default '[]'::jsonb;

create table if not exists public.cb_bank_info_lines (
  id           uuid primary key default gen_random_uuid(),
  statement_id uuid not null references public.cb_bank_statements (id) on delete cascade,
  file_id      uuid not null references public.cb_files (id) on delete cascade,
  account_id   uuid not null references public.cb_bank_accounts (id) on delete cascade,
  row_no       int not null default 0,
  txn_date     date not null,
  printed_date date,
  description  text not null,
  amount       numeric(14, 2) not null,       -- as printed, signed as the statement's lines are
  created_at   timestamptz not null default now()
);
create index if not exists cb_bank_info_lines_statement on public.cb_bank_info_lines (statement_id);
create index if not exists cb_bank_info_lines_account on public.cb_bank_info_lines (account_id, txn_date);
alter table public.cb_bank_info_lines enable row level security;
drop policy if exists "Closebook viewers read information lines" on public.cb_bank_info_lines;
create policy "Closebook viewers read information lines" on public.cb_bank_info_lines for select to authenticated using ((select private.can_view('closebook')));
revoke all on public.cb_bank_info_lines from anon, authenticated;
grant select on public.cb_bank_info_lines to authenticated;

-- ---------- Import: information rows go to cb_bank_info_lines, in no total, count or period check.
do $$
declare
  d text;
  k_skip text := $k$    v_d := (v_row ->> 'date')::date;
$k$;
  r_skip text := $k$    v_d := (v_row ->> 'date')::date;
    -- Round 28: a line with no effect on the balance is information only: in no total, count or period check.
    if coalesce((v_row ->> 'no_effect')::boolean, false) then continue; end if;
$k$;
  -- A loan line is checked on its printed Transaction Date (its Effective Date can be the day before the period).
  k_dates text := $k$coalesce(nullif(v_row ->> 'posted', '')::date, v_d)$k$;
  r_dates text := $k$coalesce(nullif(v_row ->> 'posted', '')::date, nullif(v_row ->> 'printed', '')::date, v_d)$k$;
  k_period text := $k$v_first >= p_period_start and v_last <= p_period_end, format($k$;
  r_period text := $k$coalesce(v_first, p_period_start) >= p_period_start and coalesce(v_last, p_period_end) <= p_period_end, format($k$;
  k_out text := $k$jsonb_array_length(p_rows) - v_in$k$;
  r_out text := $k$(select count(*) from jsonb_array_elements(p_rows) r where not coalesce((r ->> 'no_effect')::boolean, false))::int - v_in$k$;
  k_ins text := $k$  insert into public.cb_bank_lines (statement_id, file_id, account_id, row_no, txn_date, posted_date, description, amount, card_last4)
  select v_stmt, p_file, v_acc.id, coalesce((r ->> 'line')::int, 0), (r ->> 'date')::date, nullif(r ->> 'posted', '')::date, btrim(r ->> 'description'), (r ->> 'amount')::numeric,
         nullif(left(regexp_replace(coalesce(r ->> 'holder', ''), '\D', '', 'g'), 8), '')
    from jsonb_array_elements(p_rows) r
   where (r ->> 'date')::date between v_file.year_start and v_file.year_end;$k$;
  r_ins text := $k$  insert into public.cb_bank_lines (statement_id, file_id, account_id, row_no, txn_date, posted_date, description, amount, card_last4, printed_date)
  select v_stmt, p_file, v_acc.id, coalesce((r ->> 'line')::int, 0), (r ->> 'date')::date, nullif(r ->> 'posted', '')::date, btrim(r ->> 'description'), (r ->> 'amount')::numeric,
         nullif(left(regexp_replace(coalesce(r ->> 'holder', ''), '\D', '', 'g'), 8), ''), nullif(r ->> 'printed', '')::date
    from jsonb_array_elements(p_rows) r
   where (r ->> 'date')::date between v_file.year_start and v_file.year_end and not coalesce((r ->> 'no_effect')::boolean, false);
  -- Round 28: the information lines inside the year.
  insert into public.cb_bank_info_lines (statement_id, file_id, account_id, row_no, txn_date, printed_date, description, amount)
  select v_stmt, p_file, v_acc.id, coalesce((r ->> 'line')::int, 0), (r ->> 'date')::date, nullif(r ->> 'printed', '')::date, btrim(r ->> 'description'), (r ->> 'amount')::numeric
    from jsonb_array_elements(p_rows) r
   where (r ->> 'date')::date between v_file.year_start and v_file.year_end and coalesce((r ->> 'no_effect')::boolean, false);$k$;
begin
  d := pg_get_functiondef('private.cb_add_statement(uuid, uuid, text, numeric, numeric, jsonb, date, date, numeric, numeric, text)'::regprocedure);
  if position('Round 28' in d) > 0 then return; end if;
  if position(k_skip in d) = 0 or position(k_dates in d) = 0 or position(k_period in d) = 0 or position(k_out in d) = 0 or position(k_ins in d) = 0 then
    raise exception 'cb_add_statement: the text to patch was not found.';
  end if;
  d := replace(d, k_skip, r_skip);
  d := replace(d, k_dates, r_dates);
  d := replace(d, k_period, r_period);
  d := replace(d, k_out, r_out);
  d := replace(d, k_ins, r_ins);
  execute d;
end $$;

-- ---------- The digits read from the statement, kept as information.
do $$
declare d text;
  k text := $k$update public.cb_bank_statements set statement_import_id = v.id, source = 'pdf',$k$;
  r text := $k$update public.cb_bank_statements set statement_import_id = v.id, source = 'pdf', statement_last4 = nullif(regexp_replace(coalesce(a ->> 'last4', ''), '\D', '', 'g'), ''),$k$;
begin
  d := pg_get_functiondef('public.cb_import_statement(uuid, jsonb, boolean, text, boolean)'::regprocedure);
  if position('statement_last4' in d) > 0 then return; end if;
  if position(k in d) = 0 then raise exception 'cb_import_statement: the text to patch was not found.'; end if;
  execute replace(d, k, r);
end $$;

-- ---------- Replace file: never by the account's digits.
do $$
declare d text;
  k text := $k$v_ok := length(v_digits) >= 2 and right(regexp_replace(coalesce(v_acc.last4, ''), '\D', '', 'g'), least(4, length(v_digits))) = right(v_digits, least(4, length(v_digits)))
      and p_period_start$k$;
  r text := $k$v_ok := p_period_start$k$;
begin
  d := pg_get_functiondef('public.cb_replace_statement_file(uuid, uuid, text, date, date, numeric, numeric, jsonb, text, boolean)'::regprocedure);
  if position(k in d) = 0 then return; end if;
  execute replace(d, k, r);
end $$;

-- ---------- Exclude and Restore keep the information lines with their statement.
create or replace function private.cb_info_lines_keep() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    update public.cb_excluded_statements set info_rows = coalesce((select jsonb_agg(to_jsonb(i) order by i.row_no) from public.cb_bank_info_lines i where i.statement_id = old.id), '[]'::jsonb)
     where id = old.id;
    return old;
  end if;
  insert into public.cb_bank_info_lines
  select * from jsonb_populate_recordset(null::public.cb_bank_info_lines, (select info_rows from public.cb_excluded_statements where id = new.id))
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function private.cb_info_lines_keep() from public, anon, authenticated;
drop trigger if exists cb_info_lines_keep_out on public.cb_bank_statements;
create trigger cb_info_lines_keep_out before delete on public.cb_bank_statements for each row execute function private.cb_info_lines_keep();
drop trigger if exists cb_info_lines_keep_in on public.cb_bank_statements;
create trigger cb_info_lines_keep_in after insert on public.cb_bank_statements for each row execute function private.cb_info_lines_keep();
