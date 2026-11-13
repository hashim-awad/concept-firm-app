-- Layout clean-up items 3, 4 and 6 (Hashim, Nov 15, 2026).
--
-- 3. An expense coded to money in, or revenue coded to money out, goes to the reviewer with the reason
--    (QuickBooks Online flags the same mismatch in its bank feed review).
-- 4. Firm vendor rules (Settings, Closebook): owner-set codings used when the client has no rule and no
--    history for the vendor. Suggestions never come from a guess at what a vendor's name means.
-- 6. Standard entries (Settings, Closebook): owner-set entries (accounts, type, reason, memo, W/P ref);
--    staff pick one in step 5 and enter the amount only. An entry at or under the review threshold
--    (Thresholds) does not need the reviewer, as the earlier batch planned; over it, it goes to them.

-- 4. Firm vendor rules.
create table public.cb_firm_vendor_rules (
  id            uuid primary key default gen_random_uuid(),
  vendor_key    text not null unique check (length(vendor_key) between 2 and 200),
  chart_account text not null references public.cb_chart_accounts (number) on update cascade,
  tax_code      text references public.cb_sales_tax_codes (code),
  created_by    uuid references public.staff (id),
  created_at    timestamptz not null default now()
);
alter table public.cb_firm_vendor_rules enable row level security;
alter table public.cb_firm_vendor_rules force row level security;
create policy "Closebook viewers read firm vendor rules" on public.cb_firm_vendor_rules for select to authenticated using ((select private.can_view('closebook')));
grant select on public.cb_firm_vendor_rules to authenticated;

create or replace function public.cb_save_firm_vendor_rule(p_vendor_key text, p_account text, p_tax text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require((select private.is_owner()), 'Only an owner can change firm vendor rules.');
  perform private.require(length(btrim(coalesce(p_vendor_key, ''))) between 2 and 200, 'Type the vendor as it shows on the statement.');
  perform private.require(exists (select 1 from public.cb_chart_accounts where number = p_account), 'Choose an account from the standard chart.');
  perform private.require(nullif(p_tax, '') is null or exists (select 1 from public.cb_sales_tax_codes where code = p_tax), 'Unknown sales tax code.');
  insert into public.cb_firm_vendor_rules (vendor_key, chart_account, tax_code, created_by)
  values (upper(btrim(p_vendor_key)), p_account, nullif(p_tax, ''), (select auth.uid()))
  on conflict (vendor_key) do update set chart_account = excluded.chart_account, tax_code = excluded.tax_code, created_by = excluded.created_by, created_at = now();
end;
$$;
create or replace function public.cb_delete_firm_vendor_rule(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require((select private.is_owner()), 'Only an owner can change firm vendor rules.');
  delete from public.cb_firm_vendor_rules where id = p_id;
end;
$$;
revoke all on function public.cb_save_firm_vendor_rule(text, text, text), public.cb_delete_firm_vendor_rule(uuid) from public, anon;
grant execute on function public.cb_save_firm_vendor_rule(text, text, text), public.cb_delete_firm_vendor_rule(uuid) to authenticated;

-- 6. Standard entries.
create table public.cb_standard_entries (
  id                uuid primary key default gen_random_uuid(),
  name              text not null unique check (length(btrim(name)) between 3 and 80),
  kind              text not null check (kind in ('AJE', 'TJE')),
  reason            text not null check (reason in ('accrual', 'correction', 'tax')),
  debit_account     text not null references public.cb_chart_accounts (number) on update cascade,
  credit_account    text not null references public.cb_chart_accounts (number) on update cascade,
  memo              text not null check (length(btrim(memo)) between 3 and 500),
  wp_ref            text not null check (length(btrim(wp_ref)) between 3 and 120),
  reverse_next_year boolean not null default false,
  sort_order        int not null default 0,
  created_at        timestamptz not null default now(),
  check (debit_account <> credit_account)
);
alter table public.cb_standard_entries enable row level security;
alter table public.cb_standard_entries force row level security;
create policy "Closebook viewers read standard entries" on public.cb_standard_entries for select to authenticated using ((select private.can_view('closebook')));
grant select on public.cb_standard_entries to authenticated;
-- The four Hashim named; owners change them in Settings, Closebook, Standard entries. No home office
-- account is in the standard chart, so home office starts on Office expenses.
insert into public.cb_standard_entries (name, kind, reason, debit_account, credit_account, memo, wp_ref, reverse_next_year, sort_order) values
  ('Home office', 'AJE', 'correction', '65100', '23000', 'To record the business share of home office costs paid by the shareholder.', 'Home office schedule', false, 10),
  ('Auto expenses', 'AJE', 'correction', '70600', '23000', 'To record the business share of vehicle costs paid by the shareholder.', 'Auto log schedule', false, 20),
  ('Accounting fee accrual', 'AJE', 'accrual', '66000', '21100', 'To accrue the year-end accounting fee.', 'Standard entry: accounting fee accrual', true, 30),
  ('Tax provision', 'TJE', 'tax', '72000', '21400', 'To record the income tax provision from ProFile.', 'Income tax schedule', false, 40);

alter table public.cb_entries add column standard_id uuid references public.cb_standard_entries (id) on delete set null;

create or replace function public.cb_save_standard_entry(p_id uuid, p_name text, p_kind text, p_reason text, p_debit text, p_credit text, p_memo text, p_wp_ref text, p_reverse boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.require((select private.is_owner()), 'Only an owner can change standard entries.');
  perform private.require(p_debit <> p_credit, 'Choose two different accounts.');
  if p_id is null then
    insert into public.cb_standard_entries (name, kind, reason, debit_account, credit_account, memo, wp_ref, reverse_next_year, sort_order)
    values (btrim(p_name), p_kind, p_reason, p_debit, p_credit, btrim(p_memo), btrim(p_wp_ref), coalesce(p_reverse, false), coalesce((select max(sort_order) from public.cb_standard_entries), 0) + 10)
    returning id into v_id;
  else
    update public.cb_standard_entries set name = btrim(p_name), kind = p_kind, reason = p_reason, debit_account = p_debit, credit_account = p_credit,
      memo = btrim(p_memo), wp_ref = btrim(p_wp_ref), reverse_next_year = coalesce(p_reverse, false) where id = p_id returning id into v_id;
  end if;
  return v_id;
end;
$$;
create or replace function public.cb_delete_standard_entry(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require((select private.is_owner()), 'Only an owner can change standard entries.');
  delete from public.cb_standard_entries where id = p_id;
end;
$$;

-- Step 5: a standard entry with the amount only. Accounts, type, reason, memo and W/P ref come from the
-- setting. On a file whose client keeps their own books, each side goes to the client's account on the
-- same GIFI line, else to a new account in plain words (the standard chart account's name).
create or replace function public.cb_add_standard_entry(p_file uuid, p_standard uuid, p_amount numeric)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_std public.cb_standard_entries;
  v_lines jsonb := '[]'::jsonb;
  v_side record;
  v_acc uuid;
  v_id uuid;
  v_limit numeric;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook to add entries.');
  select * into v_file from public.cb_files where id = p_file;
  perform private.require(v_file.id is not null, 'File not found.');
  select * into v_std from public.cb_standard_entries where id = p_standard;
  perform private.require(v_std.id is not null, 'Choose a standard entry.');
  perform private.require(coalesce(p_amount, 0) > 0, 'Enter the amount, more than 0.00.');
  for v_side in select c.number, c.name, c.account_type, c.line_no, x.sign from (values (v_std.debit_account, 1), (v_std.credit_account, -1)) x(number, sign)
    join public.cb_chart_accounts c on c.number = x.number loop
    v_acc := null;
    if v_file.books in ('client_software', 'bookkeeper') then
      -- The client's own account on that line (from their trial balance), never a bare GIFI-line account.
      select id into v_acc from public.cb_accounts where file_id = p_file and line_no = v_side.line_no and not client_new
        and account_key not like 'line:%' and number <> '' order by number limit 1;
      if v_acc is null then
        v_lines := v_lines || jsonb_build_array(jsonb_build_object('line', v_side.line_no, 'new_name', v_side.name, 'amount', v_side.sign * round(p_amount, 2),
          'new_type', case v_side.account_type when 'Asset' then 'Other Current Assets' when 'Liability' then 'Other Current Liabilities' when 'Equity' then 'Equity' when 'Revenue' then 'Income' else 'Expenses' end));
        continue;
      end if;
    else
      -- The standard chart account (as the build in step 3 makes it), so the entry shows 66000 and not a GIFI line.
      insert into public.cb_accounts (file_id, account_key, number, name, this_year, line_no, mapping_source, mapped_at)
      values (p_file, 'chart:' || v_side.number, v_side.number, v_side.name, 0, v_side.line_no, 'chart', now())
      on conflict (file_id, account_key) do nothing;
      select id into v_acc from public.cb_accounts where file_id = p_file and account_key = 'chart:' || v_side.number;
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account', v_acc, 'amount', v_side.sign * round(p_amount, 2)));
  end loop;
  v_id := public.cb_add_entry(p_file, v_std.kind, v_std.reason, v_std.memo, v_std.reverse_next_year, v_lines, v_std.wp_ref);
  select entry_review_amount into v_limit from public.cb_settings limit 1;
  update public.cb_entries set standard_id = v_std.id, needs_review = round(p_amount, 2) > coalesce(v_limit, 0) where id = v_id;
  return v_id;
end;
$$;
revoke all on function public.cb_save_standard_entry(uuid, text, text, text, text, text, text, text, boolean), public.cb_delete_standard_entry(uuid), public.cb_add_standard_entry(uuid, uuid, numeric) from public, anon;
grant execute on function public.cb_save_standard_entry(uuid, text, text, text, text, text, text, text, boolean), public.cb_delete_standard_entry(uuid), public.cb_add_standard_entry(uuid, uuid, numeric) to authenticated;

-- 3. Coding: an expense on money in, or revenue on money out, goes to the reviewer with the reason.
create or replace function public.cb_code_lines(p_file uuid, p_items jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_item jsonb;
  v_acc public.cb_chart_accounts;
  v_tax text;
  v_reviewer boolean;
  v_line public.cb_bank_lines;
  v_kind text;
  v_in boolean;
  v_reason text;
  v_n int := 0;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook to code transactions.');
  select * into v_file from public.cb_files where id = p_file;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  v_reviewer := (select auth.uid()) = v_file.reviewer_id or (select private.is_owner());
  perform private.require(jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) between 1 and 5000, 'Nothing to code.');
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_acc from public.cb_chart_accounts where number = v_item ->> 'account';
    perform private.require(v_acc.number is not null, 'Choose an account from the standard chart.');
    v_tax := nullif(v_item ->> 'tax', '');
    perform private.require(v_tax is not null, 'Choose a sales tax code for every line. Nothing was saved.');
    perform private.require(exists (select 1 from public.cb_sales_tax_codes where code = v_tax), 'Unknown sales tax code.');
    select * into v_line from public.cb_bank_lines where id = (v_item ->> 'id')::uuid and file_id = p_file;
    perform private.require(v_line.id is not null, 'Line not found.');
    select kind into v_kind from public.cb_bank_accounts where id = v_line.account_id;
    -- Money in: a deposit on a bank account, a payment or refund on a card.
    v_in := case when v_kind = 'card' then v_line.amount < 0 else v_line.amount > 0 end;
    v_reason := case
      when v_reviewer and v_line.status = 'reviewer' then ''
      when v_acc.account_type = 'Expense' and v_in then 'An expense coded to money in: check it is a refund, or choose another account.'
      when v_acc.account_type = 'Revenue' and not v_in then 'Revenue coded to money out: check it is a refund to a customer, or choose another account.'
      when v_acc.tax_default = 'Check' and not v_reviewer then 'The sales tax on this account is the reviewer''s call.'
      when v_acc.number = '60200' and coalesce(v_tax, '') not like 'MEALS%' then 'Meals coded at the full rate: only 50% of the tax is claimable.'
      else '' end;
    update public.cb_bank_lines set chart_account = v_acc.number, tax_code = v_tax,
      status = case when v_reason = '' then 'done' else 'reviewer' end, reviewer_reason = v_reason,
      source = coalesce(nullif(v_item ->> 'source', ''), 'manual'), coded_by = (select auth.uid()), coded_at = now()
     where id = (v_item ->> 'id')::uuid and file_id = p_file;
    v_n := v_n + 1;
  end loop;
  update public.cb_files set updated_at = now() where id = p_file;
  return v_n;
end;
$$;

-- Where a coded line's account came from: the client's vendor rule, the client's own coding history
-- (this year or last year), a firm vendor rule, or typed by hand ('last_year' is the older name for history).
alter table public.cb_bank_lines drop constraint if exists cb_bank_lines_source_check;
alter table public.cb_bank_lines add constraint cb_bank_lines_source_check check (source in ('', 'rule', 'last_year', 'history', 'firm', 'manual'));
