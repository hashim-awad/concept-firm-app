-- Layout clean-up, round 2 (Hashim, Nov 16, 2026).
--
-- 1. Entries: memo and W/P reference required; a line on 3720 (31500 Prior period adjustments) needs the
--    reason "Prior period adjustment", that reason needs a 3720 line, and it never reverses next year.
--    "Reverse it next year" is for accruals only. (CaseWare and QuickBooks Online refuse an unbalanced or
--    incomplete journal entry before it posts.)
-- 2. Standard entries on a client who keeps their own books: the preparer picks the client's account (or
--    names a new one) before the entry is added. Nothing posts to a bare GIFI line on those files.
-- 3. Firm vendor rules never set a provincial sales tax code: "Taxable at the client's rate", "No sales
--    tax" or "Choose on the line". A client's own vendor rule may still set a code.
-- 5. Duplicate uploads: cb_duplicate_lines lists the lines of an upload already in the file on any account.
-- 7. No account is ever numbered with a GIFI code: old builds made "1062 1062 Trade accounts receivable".
-- 11. Entries like the QuickBooks Online journal entry: a date (year-end by default), a sales tax code per
--    line (the tax posts as its own line to GST/HST payable), attachments, and standard entries picked
--    in the same form.

-- 11. Entry date, attachments, sales tax per line.
alter table public.cb_entries add column entry_date date, add column attachments text[] not null default '{}';
alter table public.cb_entry_lines add column tax_code text references public.cb_sales_tax_codes (code), add column is_tax boolean not null default false;

-- 3. Firm vendor rules: a tax choice, never a provincial code.
alter table public.cb_firm_vendor_rules add column tax_mode text not null default 'line' check (tax_mode in ('taxable', 'none', 'line'));
update public.cb_firm_vendor_rules set tax_mode = case
  when tax_code is null then 'line'
  when exists (select 1 from public.cb_sales_tax_parts p where p.code = cb_firm_vendor_rules.tax_code and p.rate > 0) then 'taxable'
  else 'none' end;
update public.cb_firm_vendor_rules set tax_code = null;
alter table public.cb_firm_vendor_rules add constraint cb_firm_vendor_rules_no_code check (tax_code is null);

drop function if exists public.cb_save_firm_vendor_rule(text, text, text);
create or replace function public.cb_save_firm_vendor_rule(p_vendor_key text, p_account text, p_tax_mode text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require((select private.is_owner()), 'Only an owner can change firm vendor rules.');
  perform private.require(length(btrim(coalesce(p_vendor_key, ''))) between 2 and 200, 'Type the vendor as it shows on the statement.');
  perform private.require(exists (select 1 from public.cb_chart_accounts where number = p_account), 'Choose an account from the standard chart.');
  perform private.require(p_tax_mode in ('taxable', 'none', 'line'), 'Choose the sales tax: taxable at the client''s rate, no sales tax, or choose on the line.');
  insert into public.cb_firm_vendor_rules (vendor_key, chart_account, tax_mode, created_by)
  values (upper(btrim(p_vendor_key)), p_account, p_tax_mode, (select auth.uid()))
  on conflict (vendor_key) do update set chart_account = excluded.chart_account, tax_mode = excluded.tax_mode, created_by = excluded.created_by, created_at = now();
end;
$$;
revoke all on function public.cb_save_firm_vendor_rule(text, text, text) from public, anon;
grant execute on function public.cb_save_firm_vendor_rule(text, text, text) to authenticated;

-- 1, 2, 11. Adding an entry.
-- A line is one of: {"account": id} an account already in the file; {"chart": "66000"} a standard chart
-- account (bank-statement files; added to the file when new); {"line": "8670.00"} a GIFI line with no
-- standard chart account (bank-statement files); {"line", "new_name", "new_type"} a new account in the
-- books of a client who keeps their own. "tax_code" names the sales tax on a line; a line with
-- "is_tax": true is the tax itself (to GST/HST payable), worked out by the server from the rates.
drop function if exists public.cb_add_entry(uuid, text, text, text, boolean, jsonb, text);
create or replace function public.cb_add_entry(p_file uuid, p_kind text, p_reason text, p_note text, p_reverse boolean, p_lines jsonb, p_wp_ref text,
  p_date date default null, p_standard uuid default null, p_attachments text[] default '{}')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_own boolean;
  v_id uuid;
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
  v_std public.cb_standard_entries;
  v_limit numeric;
  v_plain jsonb := '[]'::jsonb;   -- the non-tax lines, for the standard entry check
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook to add entries.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(v_file.file_type = 'full', 'Monthly files: entries are made in QuickBooks.');
  perform private.require(p_kind in ('AJE', 'RJE', 'TJE'), 'Unknown entry type.');
  perform private.require(p_reason in ('accrual', 'reclassification', 'correction', 'tax', 'prior_period'), 'Choose a reason.');
  perform private.require(length(btrim(coalesce(p_wp_ref, ''))) between 3 and 120, 'Add the W/P reference: the step or schedule that supports the entry.');
  perform private.require(length(btrim(coalesce(p_note, ''))) between 3 and 500, 'Add the memo: what the entry does and why.');
  perform private.require(not coalesce(p_reverse, false) or p_reason = 'accrual', 'Only an accrual reverses next year.');
  perform private.require(p_date is null or p_date between v_file.year_start and v_file.year_end, 'The entry date must fall in the file''s year.');
  perform private.require(jsonb_typeof(p_lines) = 'array' and jsonb_array_length(p_lines) >= 2, 'An entry needs at least two lines.');
  perform private.require(coalesce(array_length(p_attachments, 1), 0) <= 10, 'Up to 10 attachments.');
  v_own := v_file.books in ('client_software', 'bookkeeper');
  insert into public.cb_entries (file_id, kind, number, seq, reason, note, reverse_next_year, wp_ref, created_by, entry_date, attachments)
  values (p_file, p_kind, coalesce((select max(number) from public.cb_entries where file_id = p_file and kind = p_kind), 0) + 1,
          coalesce((select max(seq) from public.cb_entries where file_id = p_file), 0) + 1,
          p_reason, btrim(p_note), coalesce(p_reverse, false), btrim(p_wp_ref), (select auth.uid()), coalesce(p_date, v_file.year_end), coalesce(p_attachments, '{}'))
  returning id into v_id;
  for v in select * from jsonb_array_elements(p_lines) loop
    perform private.require(round((v ->> 'amount')::numeric, 2) <> 0, 'Every line needs an amount.');
    perform private.require(nullif(v ->> 'tax_code', '') is null or exists (select 1 from public.cb_sales_tax_codes where code = v ->> 'tax_code'), 'Unknown sales tax code.');
    v_name := nullif(btrim(coalesce(v ->> 'new_name', '')), '');
    v_type := nullif(v ->> 'new_type', '');
    v_acc := null; v_key := '';
    if nullif(v ->> 'account', '') is not null then
      select a.id, a.line_no, a.account_key into v_acc, v_line, v_key from public.cb_accounts a where a.id = (v ->> 'account')::uuid and a.file_id = p_file;
      perform private.require(v_acc is not null, 'An account is not in this file.');
      perform private.require(v_line is not null, 'Match every account in the entry to a GIFI line first.');
    elsif nullif(v ->> 'chart', '') is not null then
      select * into v_chart from public.cb_chart_accounts where number = v ->> 'chart';
      perform private.require(v_chart.number is not null, 'Choose an account from the standard chart.');
      v_line := v_chart.line_no;
      if v_own then
        -- The client's own account on that GIFI line; for the sales tax line only, a new "GST/HST payable".
        select id into v_acc from public.cb_accounts where file_id = p_file and line_no = v_line and not client_new
          and account_key not like 'line:%' and account_key not like 'gifi:%' and number <> '' order by number limit 1;
        if v_acc is null then
          perform private.require(coalesce((v ->> 'is_tax')::boolean, false), 'Choose one of the client''s accounts, or name a new account for their books.');
          v_name := v_chart.name; v_type := 'Other Current Liabilities';
        end if;
      else
        insert into public.cb_accounts (file_id, account_key, number, name, this_year, line_no, mapping_source, mapped_at)
        values (p_file, 'chart:' || v_chart.number, v_chart.number, v_chart.name, 0, v_chart.line_no, 'chart', now())
        on conflict (file_id, account_key) do nothing;
        select id, account_key into v_acc, v_key from public.cb_accounts where file_id = p_file and account_key = 'chart:' || v_chart.number;
      end if;
    else
      v_line := v ->> 'line';
      perform private.require(not v_own or v_name is not null, 'Choose one of the client''s accounts, or name a new account for their books.');
    end if;
    -- Retained earnings only moves through a prior period adjustment, which posts to GIFI 3720.
    v_re := v_line like '3600.%' or v_key in ('gifi:3660', 'gifi:3600');
    if v_re then
      perform private.require(p_reason = 'prior_period', 'A line on retained earnings needs the reason "Prior period adjustment".');
      v_line := '3720.00'; v_acc := null;
      if v_own then v_name := 'Prior period adjustments'; v_type := 'Equity'; end if;
    end if;
    if v_line like '3720.%' then
      perform private.require(p_reason = 'prior_period', 'A line on 31500 Prior period adjustments needs the reason "Prior period adjustment".');
      v_ppa_line := true;
    end if;
    if v_acc is null then
      perform private.require(exists (select 1 from public.cb_master_lines where line_no = v_line and mappable), 'Entries cannot post to a total line.');
      perform private.require(not private.cb_line_locked(v_line), 'This line is locked because it has sub-lines. Choose one of its sub-lines.');
      if v_own then
        perform private.require(length(v_name) between 3 and 80, 'Name the new account in plain words, for example "Amortization expense".');
        perform private.require(v_type is not null, 'Choose the new account''s QuickBooks account type.');
        insert into public.cb_accounts (file_id, account_key, number, name, line_no, mapping_source, mapped_by, mapped_at, client_new, qbo_type)
        values (p_file, 'new:' || lower(v_name), '', v_name, v_line, 'preparer', (select auth.uid()), now(), true, v_type)
        on conflict (file_id, account_key) do nothing;
        select id into v_acc from public.cb_accounts where file_id = p_file and account_key = 'new:' || lower(v_name);
      else
        -- A standard chart account on that line comes first (31500 for 3720); a bare line only when none.
        select * into v_chart from public.cb_chart_accounts where line_no = v_line order by sort_order limit 1;
        if v_chart.number is not null then
          insert into public.cb_accounts (file_id, account_key, number, name, this_year, line_no, mapping_source, mapped_at)
          values (p_file, 'chart:' || v_chart.number, v_chart.number, v_chart.name, 0, v_chart.line_no, 'chart', now())
          on conflict (file_id, account_key) do nothing;
          select id into v_acc from public.cb_accounts where file_id = p_file and account_key = 'chart:' || v_chart.number;
        else
          insert into public.cb_accounts (file_id, account_key, number, name, line_no, mapping_source, mapped_by, mapped_at)
          select p_file, 'line:' || v_line, '', m.name, v_line, 'preparer', (select auth.uid()), now() from public.cb_master_lines m where m.line_no = v_line
          on conflict (file_id, account_key) do nothing;
          select id into v_acc from public.cb_accounts where file_id = p_file and account_key = 'line:' || v_line;
        end if;
      end if;
    end if;
    insert into public.cb_entry_lines (entry_id, account_id, amount, memo, tax_code, is_tax)
    values (v_id, v_acc, round((v ->> 'amount')::numeric, 2), left(coalesce(v ->> 'memo', ''), 200), nullif(v ->> 'tax_code', ''), coalesce((v ->> 'is_tax')::boolean, false));
    if not coalesce((v ->> 'is_tax')::boolean, false) then v_plain := v_plain || jsonb_build_array(jsonb_build_object('line', v_line, 'amount', round((v ->> 'amount')::numeric, 2), 'tax', v ->> 'tax_code')); end if;
    v_sum := v_sum + round((v ->> 'amount')::numeric, 2);
    if (select line_type from public.cb_master_lines where line_no = v_line) in ('Revenue', 'Expense') then v_income := v_income + round((v ->> 'amount')::numeric, 2); end if;
  end loop;
  perform private.require(v_sum = 0, format('The entry does not balance: it is out by %s.', v_sum));
  perform private.require(p_kind <> 'RJE' or v_income = 0, 'A reclassifying entry (RJE) cannot change the result. Use an AJE.');
  perform private.require(p_reason <> 'prior_period' or v_ppa_line, 'The reason "Prior period adjustment" needs a line on 31500 Prior period adjustments.');
  perform private.require(p_reason <> 'prior_period' or not coalesce(p_reverse, false), 'A prior period adjustment never reverses next year.');
  -- A standard entry needs no review at or under the threshold, if it is still the standard entry:
  -- two lines, one amount, on the setting's GIFI lines, with the setting's type and reason.
  if p_standard is not null then
    select * into v_std from public.cb_standard_entries where id = p_standard;
    perform private.require(v_std.id is not null, 'That standard entry is gone. Choose another.');
    select entry_review_amount into v_limit from public.cb_settings limit 1;
    update public.cb_entries set standard_id = v_std.id,
      needs_review = not (jsonb_array_length(v_plain) = 2 and v_std.kind = p_kind and v_std.reason = p_reason
        and (v_plain -> 0 ->> 'amount')::numeric = -(v_plain -> 1 ->> 'amount')::numeric
        and abs((v_plain -> 0 ->> 'amount')::numeric) <= coalesce(v_limit, 0)
        and exists (select 1 from jsonb_array_elements(v_plain) x where (x ->> 'amount')::numeric > 0 and x ->> 'line' = (select line_no from public.cb_chart_accounts where number = v_std.debit_account))
        and exists (select 1 from jsonb_array_elements(v_plain) x where (x ->> 'amount')::numeric < 0 and x ->> 'line' = (select line_no from public.cb_chart_accounts where number = v_std.credit_account)))
     where id = v_id;
  end if;
  update public.cb_files set updated_at = now() where id = p_file;
  return v_id;
end;
$$;
revoke all on function public.cb_add_entry(uuid, text, text, text, boolean, jsonb, text, date, uuid, text[]) from public, anon;
grant execute on function public.cb_add_entry(uuid, text, text, text, boolean, jsonb, text, date, uuid, text[]) to authenticated;

-- 2. The old "amount only" path is replaced by the entry form (the standard entry fills its lines there).
drop function if exists public.cb_add_standard_entry(uuid, uuid, numeric);

-- 5. Lines of an upload already in the file, on any account: same date, description and amount.
create or replace function public.cb_duplicate_lines(p_file uuid, p_rows jsonb)
returns table (row_no int, txn_date date, description text, amount numeric, account_name text)
language sql stable security definer set search_path = '' as $$
  select (r ->> 'line')::int, (r ->> 'date')::date, r ->> 'description', (r ->> 'amount')::numeric, a.name
    from jsonb_array_elements(p_rows) r
    join public.cb_bank_lines l on l.file_id = p_file and l.txn_date = (r ->> 'date')::date
     and upper(btrim(l.description)) = upper(btrim(r ->> 'description')) and abs(l.amount) = abs((r ->> 'amount')::numeric)
    join public.cb_bank_accounts a on a.id = l.account_id
   where private.can_view('closebook')
   order by 1;
$$;
revoke all on function public.cb_duplicate_lines(uuid, jsonb) from public, anon;
grant execute on function public.cb_duplicate_lines(uuid, jsonb) to authenticated;

-- 7. Accounts numbered with a GIFI code, made by the November 13 build ("1062 1062 Trade accounts
-- receivable"). A line with a standard chart account moves to it (its entry lines too); a line with none
-- gets a 5-digit file account number in its type's range and a plain name.
do $$
declare
  r record;
  v_chart public.cb_chart_accounts;
  v_target uuid;
  v_base int;
  v_no int;
begin
  for r in select a.*, m.line_type, m.name as line_name from public.cb_accounts a left join public.cb_master_lines m on m.line_no = a.line_no
            where a.account_key like 'gifi:%' and a.number ~ '^\d{4}$' order by a.file_id, a.line_no loop
    v_chart := null;
    select * into v_chart from public.cb_chart_accounts c where c.line_no = r.line_no or c.line_no like substr(r.line_no, 1, 4) || '.%'
     order by (c.line_no = r.line_no) desc, c.sort_order limit 1;
    if v_chart.number is not null then
      select id into v_target from public.cb_accounts where file_id = r.file_id and account_key = 'chart:' || v_chart.number;
      if v_target is null and r.this_year = 0 and r.last_year = 0 and not exists (select 1 from public.cb_entry_lines where account_id = r.id) then
        -- Empty and unused: a leftover of the old build. The next build makes what is needed.
        delete from public.cb_accounts where id = r.id;
      elsif v_target is null then
        update public.cb_accounts set account_key = 'chart:' || v_chart.number, number = v_chart.number, name = v_chart.name, line_no = v_chart.line_no,
          mapping_source = 'chart', needs_reviewer = false, reviewer_reason = '' where id = r.id;
      else
        update public.cb_entry_lines set account_id = v_target where account_id = r.id;
        delete from public.cb_accounts where id = r.id;
      end if;
    else
      v_base := case r.line_type when 'Asset' then 19000 when 'Liability' then 29000 when 'Equity' then 39000 when 'Revenue' then 49000 else 79000 end;
      v_no := v_base;
      while exists (select 1 from public.cb_chart_accounts where number = v_no::text)
         or exists (select 1 from public.cb_accounts where file_id = r.file_id and number = v_no::text) loop
        v_no := v_no + 10;
      end loop;
      update public.cb_accounts set number = v_no::text, name = coalesce(r.line_name, regexp_replace(r.name, '^\d{4}\s+', '')),
        mapping_source = 'chart', needs_reviewer = false, reviewer_reason = '' where id = r.id;
    end if;
  end loop;
end $$;
