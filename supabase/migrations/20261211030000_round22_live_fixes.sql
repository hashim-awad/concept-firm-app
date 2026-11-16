-- Round 22 fixes from the first Live use (Hashim, Nov 16, 2026). Safe to run twice.
--
-- 1. A statement that starts on the day the one before ends (some banks print the same day on both) is
--    not an overlap. Two statements overlap only when they share more than that one day. Before this,
--    the shared day refused every second statement of such a bank, and the upload list called them
--    "Already imported" although nothing of them was in the books.
-- 2. One copy of each statement: a new upload that is the same statement as one already in the list,
--    not imported (same file fingerprint, or the same account and period), is removed and the copy
--    already there stays, with its own status (statement_keep_one, called by the reader).
-- 3. Rounding: last year's T2 is in whole dollars, so a GIFI line ties within 1.00, and an outstanding item
--    of kind "rounding" takes a year-edge difference left under 1.00 (it posts nothing, like every item).
-- 4. Sign-off counts gaps as the page shows them: each run of days no statement covers, plus each break
--    between two statements that meet.

-- ---------- 1. The shared day (CSV path and PDF path)
do $$
declare f text; d text;
begin
  foreach f in array array['public.cb_upload_bank(uuid, uuid, text, text, text, numeric, numeric, jsonb, date, date)',
                           'private.cb_add_statement(uuid, uuid, text, numeric, numeric, jsonb, date, date, numeric, numeric, text)'] loop
    if to_regprocedure(f) is null then continue; end if;
    d := pg_get_functiondef(to_regprocedure(f));
    if position('period_start <= p_period_end and period_end >= p_period_start' in d) > 0 then
      execute replace(d, 'period_start <= p_period_end and period_end >= p_period_start', 'period_start < p_period_end and period_end > p_period_start');
    end if;
  end loop;
end $$;

-- ---------- 2. One copy of each statement
-- p_id is a job of a Closebook file. Returns the id of the copy kept when p_id was removed, else null.
create or replace function public.statement_keep_one(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v public.cb_statement_imports; k public.cb_statement_imports;
begin
  select * into v from public.cb_statement_imports where id = p_id for update;
  if v.id is null or v.file_id is null or v.status in ('discarded', 'imported', 'skipped', 'uploading') then return null; end if;
  select * into k from public.cb_statement_imports o
   where o.file_id = v.file_id and o.id <> v.id
     and o.status in ('queued', 'reading', 'ready', 'needs_look')
     and (o.created_at, o.id) < (v.created_at, v.id)
     and ((v.file_sha256 is not null and o.file_sha256 = v.file_sha256)
       or (v.summary ->> 'period_start' is not null
           and o.summary ->> 'period_start' = v.summary ->> 'period_start' and o.summary ->> 'period_end' = v.summary ->> 'period_end'
           and (o.target_account is null or v.target_account is null or o.target_account = v.target_account)
           and exists (select 1 from jsonb_array_elements(coalesce(v.summary -> 'found', '[]')) a, jsonb_array_elements(coalesce(o.summary -> 'found', '[]')) b
                        where length(regexp_replace(coalesce(a ->> 'last4', ''), '\D', '', 'g')) >= 2
                          and right(regexp_replace(a ->> 'last4', '\D', '', 'g'), 4) = right(regexp_replace(coalesce(b ->> 'last4', ''), '\D', '', 'g'), 4))))
   order by o.created_at, o.id limit 1;
  if k.id is null then return null; end if;
  update public.cb_statement_imports set status = 'discarded', result = null, edited = null, summary = null, finished_at = coalesce(finished_at, now()),
         error = 'Another copy of this statement is already in the list.' where id = v.id;
  if k.target_account is null and v.target_account is not null then
    update public.cb_statement_imports set target_account = v.target_account where id = k.id;
  end if;
  return k.id;
end;
$$;
revoke all on function public.statement_keep_one(uuid) from public, anon, authenticated;
grant execute on function public.statement_keep_one(uuid) to service_role;

-- ---------- 3. Rounding items
alter table public.cb_bank_outstanding add column if not exists kind text not null default 'item';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cb_bank_outstanding_kind_check') then
    alter table public.cb_bank_outstanding add constraint cb_bank_outstanding_kind_check check (kind in ('item', 'rounding'));
  end if;
end $$;

-- The statements' balance at a year edge, and the books' (the end: books opening + every line that posts).
create or replace function private.cb_edge_left(p_account uuid, p_edge text) returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare a public.cb_bank_accounts; v_bal numeric; v_books numeric; v_items numeric;
begin
  select * into a from public.cb_bank_accounts where id = p_account;
  if a.id is null or a.books_opening is null then return null; end if;
  if p_edge = 'start' then
    select at_start into v_bal from public.cb_bank_statements where account_id = a.id and at_start is not null order by period_start limit 1;
    v_books := a.books_opening;
  else
    select at_end into v_bal from public.cb_bank_statements where account_id = a.id and at_end is not null order by period_start desc limit 1;
    select a.books_opening + coalesce(sum(l.amount), 0) into v_books from public.cb_bank_lines l where l.account_id = a.id and not (l.status = 'matched' and l.source = 'outstanding');
  end if;
  if v_bal is null then return null; end if;
  select coalesce(sum(case when dir = 'in' then amount else -amount end), 0) into v_items from public.cb_bank_outstanding where account_id = a.id and edge = p_edge;
  return v_books - v_bal - v_items;   -- what is left to explain; an 'in' item of this amount closes it
end;
$$;
revoke all on function private.cb_edge_left(uuid, text) from public, anon, authenticated;

drop function if exists public.cb_add_outstanding(uuid, text, date, text, text, numeric, uuid);
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
    -- The T2 is in whole dollars: only a difference left under 1.00, all of it, as one item.
    v_left := private.cb_edge_left(p_account, p_edge);
    perform private.require(v_left is not null and v_left <> 0 and abs(v_left) < 1, 'Rounding is only for a difference left under 1.00.');
    insert into public.cb_bank_outstanding (file_id, account_id, edge, item_date, description, dir, amount, cleared_line, created_by, kind)
    values (v_acc.file_id, p_account, p_edge, case when p_edge = 'start' then v_file.year_start - 1 else v_file.year_end end,
            'Rounding (the T2 is in whole dollars)', case when v_left > 0 then 'in' else 'out' end, abs(v_left), null, (select auth.uid()), 'rounding')
    returning id into v_id;
    perform private.cb_log(v_acc.file_id, 'bank_outstanding', 'records', format('%s: rounding of %s at the %s of the year.', v_acc.name,
      to_char(abs(v_left), 'FM999,999,999,990.00'), p_edge));
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
revoke all on function public.cb_add_outstanding(uuid, text, date, text, text, numeric, uuid, text) from public, anon;
grant execute on function public.cb_add_outstanding(uuid, text, date, text, text, numeric, uuid, text) to authenticated;

-- ---------- 4. What step 3's sign-off waits for (round 22, with the gap count and the rounding tie)
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
    -- Gaps, between the dates it opened and closed (a note with no dates waives them): each run of days no
    -- statement covers, and each break between two statements that meet (the opening is not the closing before).
    v_gap := 0;
    if not (a.opened_on is null and a.closed_on is null and a.coverage_note <> '') then
      v_from := greatest(v_file.year_start, coalesce(a.opened_on, v_file.year_start));
      v_to := least(v_file.year_end, coalesce(a.closed_on, v_file.year_end));
      with days as (
        select d::date as d, exists (select 1 from public.cb_bank_statements s where s.account_id = a.id and d::date between s.period_start and s.period_end) as cov
          from generate_series(v_from::timestamp, v_to::timestamp, interval '1 day') d)
      select count(*) into v_n from (select d, cov, lag(cov) over (order by d) as prev from days) x where not cov and (prev is null or prev);
      select count(*) into v_gap from (
        select s.opening, lag(s.closing) over (order by s.period_start) as prev, lag(s.period_end) over (order by s.period_start) as prev_end, s.period_start
          from public.cb_bank_statements s where s.account_id = a.id) x
       where prev is not null and opening <> prev
         and not exists (select 1 from generate_series((prev_end + 1)::timestamp, (period_start - 1)::timestamp, interval '1 day') d
                          where d::date between v_from and v_to);
      v_gap := v_gap + v_n;
      if v_gap > 0 then
        v_out := v_out || format('%s %s: %s gap%s in the statements. Upload the missing statements, or record why (opened or closed in the year).', a.number, a.name, v_gap,
          case when v_gap = 1 then '' else 's' end);
      end if;
    end if;
    -- The year edges: the balance from the statements, against the books, explained by outstanding items.
    if a.books_opening is not null then
      v_bal := private.cb_edge_left(a.id, 'start');
      if v_bal is not null and v_bal <> 0 then
        select at_start into v_books from public.cb_bank_statements where account_id = a.id and at_start is not null order by period_start limit 1;
        v_out := v_out || format('%s %s: the statements show %s on %s and the books %s. Explain the difference of %s with outstanding items.', a.number, a.name,
          private.cb_bracket(v_books), to_char(v_file.year_start - 1, 'Mon FMDD, YYYY'), private.cb_bracket(a.books_opening), private.cb_bracket(v_bal));
      end if;
      -- The end edge once there is no gap (before that the books are missing lines).
      if v_gap = 0 then
        v_bal := private.cb_edge_left(a.id, 'end');
        if v_bal is not null and v_bal <> 0 then
          v_out := v_out || format('%s %s: the statements and the books differ by %s on %s. Explain the difference with outstanding items.', a.number, a.name,
            private.cb_bracket(v_bal), to_char(v_file.year_end, 'Mon FMDD, YYYY'));
        end if;
      end if;
    end if;
  end loop;
  -- Months a statement covers with no transactions (round 8): check the statements are complete.
  select count(*) into v_n from (
    select ba.id, mo from public.cb_bank_accounts ba
     cross join generate_series(date_trunc('month', v_file.year_start::timestamp), v_file.year_end::timestamp, interval '1 month') mo
     where ba.file_id = p_file
       and exists (select 1 from public.cb_bank_statements s where s.account_id = ba.id and s.period_start <= (mo + interval '1 month - 1 day')::date and s.period_end >= mo::date)
       and not exists (select 1 from public.cb_bank_lines l where l.file_id = p_file and l.account_id = ba.id and date_trunc('month', l.txn_date::timestamp) = mo)) x;
  if v_n > 0 then v_out := v_out || format('%s month%s with no transactions: check the statements are complete.', v_n, case when v_n = 1 then '' else 's' end); end if;
  -- Nothing waiting to check: statements read or reading, not outside the year and not already imported.
  select count(*) into v_n from public.cb_statement_imports i
   where i.file_id = p_file and i.status in ('queued', 'reading', 'ready', 'needs_look', 'failed')
     and not (coalesce(i.summary ->> 'period_end', '9999-12-31') < v_file.year_start::text or coalesce(i.summary ->> 'period_start', '0000-01-01') > v_file.year_end::text)
     and not (i.file_sha256 is not null and exists (select 1 from public.cb_bank_statements s where s.file_id = p_file and s.file_sha256 = i.file_sha256));
  if v_n > 0 then v_out := v_out || format('%s statement%s waiting to check.', v_n, case when v_n = 1 then '' else 's' end); end if;
  -- The tie to step 2: each GIFI line's accounts against last year's T2, within 1.00 (the T2 is in whole dollars).
  if v_file.opening_source is not null or v_file.first_year then
    for g in select coalesce(left(a2.gifi_line, 4), left(c.line_no, 4)) as code, sum(coalesce(a2.books_opening, 0)) as books
               from public.cb_bank_accounts a2 left join public.cb_chart_accounts c on c.number = a2.chart_account
              where a2.file_id = p_file group by 1 loop
      if g.code is not null and abs(coalesce((select amount from public.cb_opening_balances where file_id = p_file and code = g.code), 0) - g.books) >= 1 then
        v_out := v_out || format('GIFI %s: the accounts open at %s, last year''s T2 has %s.', g.code, private.cb_bracket(g.books),
          private.cb_bracket(coalesce((select amount from public.cb_opening_balances where file_id = p_file and code = g.code), 0)));
      end if;
    end loop;
  end if;
  return v_out;
end;
$$;
revoke all on function private.cb_records_problems(uuid) from public, anon, authenticated;
