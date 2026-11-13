-- Hashim, Nov 15, 2026.
-- 1. The standard chart gains 31500 Prior period adjustments, on GIFI 3720. Entries to retained earnings
--    post there (an entry line on 3720.00 lands on 31500 in the reports, as on any standard chart line).
-- 2. Clients who keep their own books (full files on the client's QuickBooks or Xero, or a bookkeeper's
--    file): entries post to the client's own accounts, the QuickBooks way. When none fits, the preparer
--    names a new account in plain words with its QuickBooks account type; the GIFI line it maps to stays
--    in the working papers. A GIFI line is never an account in the client's books.

update public.cb_chart_accounts set sort_order = sort_order + 1 where sort_order >= 60;
insert into public.cb_chart_accounts (number, name, account_type, line_no, tax_default, note, sort_order)
values ('31500', 'Prior period adjustments', 'Equity', '3720.00', 'None', 'Entries to retained earnings post here', 60);

alter table public.cb_accounts
  add column client_new boolean not null default false,
  add column qbo_type text check (qbo_type in ('Bank', 'Accounts receivable (A/R)', 'Other Current Assets', 'Fixed Assets', 'Other Assets',
    'Accounts payable (A/P)', 'Credit Card', 'Other Current Liabilities', 'Long Term Liabilities', 'Equity', 'Income', 'Other Income',
    'Cost of Goods Sold', 'Expenses', 'Other Expense'));

create or replace function public.cb_add_entry(p_file uuid, p_kind text, p_reason text, p_note text, p_reverse boolean, p_lines jsonb, p_wp_ref text)
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
  v_sum numeric := 0;
  v_income numeric := 0;
  v_re boolean;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook to add entries.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(v_file.file_type = 'full', 'Monthly files: entries are made in QuickBooks.');
  perform private.require(p_kind in ('AJE', 'RJE', 'TJE'), 'Unknown entry type.');
  perform private.require(p_reason in ('accrual', 'reclassification', 'correction', 'tax', 'prior_period'), 'Choose a reason.');
  perform private.require(length(btrim(coalesce(p_wp_ref, ''))) between 3 and 120, 'Add the working paper reference: the step or schedule that supports the entry.');
  perform private.require(jsonb_typeof(p_lines) = 'array' and jsonb_array_length(p_lines) >= 2, 'An entry needs at least two lines.');
  v_own := v_file.books in ('client_software', 'bookkeeper');
  insert into public.cb_entries (file_id, kind, number, seq, reason, note, reverse_next_year, wp_ref, created_by)
  values (p_file, p_kind, coalesce((select max(number) from public.cb_entries where file_id = p_file and kind = p_kind), 0) + 1,
          coalesce((select max(seq) from public.cb_entries where file_id = p_file), 0) + 1,
          p_reason, btrim(coalesce(p_note, '')), coalesce(p_reverse, false), btrim(p_wp_ref), (select auth.uid()))
  returning id into v_id;
  for v in select * from jsonb_array_elements(p_lines) loop
    perform private.require(round((v ->> 'amount')::numeric, 2) <> 0, 'Every line needs an amount.');
    v_name := nullif(btrim(coalesce(v ->> 'new_name', '')), '');
    v_type := nullif(v ->> 'new_type', '');
    if v ? 'account' and nullif(v ->> 'account', '') is not null then
      select a.id, a.line_no, a.account_key into v_acc, v_line, v_key from public.cb_accounts a where a.id = (v ->> 'account')::uuid and a.file_id = p_file;
      perform private.require(v_acc is not null, 'An account is not in this file.');
      perform private.require(v_line is not null, 'Match every account in the entry to a GIFI line first.');
    else
      v_line := v ->> 'line'; v_acc := null; v_key := '';
      perform private.require(not v_own or v_name is not null, 'Choose one of the client''s accounts, or name a new account for their books.');
    end if;
    -- Retained earnings only moves through a prior period adjustment, which posts to GIFI 3720.
    v_re := v_line like '3600.%' or v_key in ('gifi:3660', 'gifi:3600');
    if v_re then
      perform private.require(p_reason = 'prior_period', 'An entry that posts to retained earnings must use the reason "Prior period adjustment".');
      v_line := '3720.00'; v_acc := null;
      if v_own then v_name := 'Prior period adjustments'; v_type := 'Equity'; end if;
    end if;
    if v_acc is null then
      perform private.require(exists (select 1 from public.cb_master_lines where line_no = v_line and mappable), 'Entries cannot post to a total line.');
      perform private.require(not private.cb_line_locked(v_line), 'This line is locked because it has sub-lines. Choose one of its sub-lines.');
      if v_own then
        -- A new account in the client's books: a plain name and its QuickBooks type, on a GIFI line.
        perform private.require(length(v_name) between 3 and 80, 'Name the new account in plain words, for example "Amortization expense".');
        perform private.require(v_type is not null, 'Choose the new account''s QuickBooks account type.');
        insert into public.cb_accounts (file_id, account_key, number, name, line_no, mapping_source, mapped_by, mapped_at, client_new, qbo_type)
        values (p_file, 'new:' || lower(v_name), '', v_name, v_line, 'preparer', (select auth.uid()), now(), true, v_type)
        on conflict (file_id, account_key) do nothing;
        select id into v_acc from public.cb_accounts where file_id = p_file and account_key = 'new:' || lower(v_name);
      else
        insert into public.cb_accounts (file_id, account_key, number, name, line_no, mapping_source, mapped_by, mapped_at)
        select p_file, 'line:' || v_line, '', m.name, v_line, 'preparer', (select auth.uid()), now() from public.cb_master_lines m where m.line_no = v_line
        on conflict (file_id, account_key) do nothing;
        select id into v_acc from public.cb_accounts where file_id = p_file and account_key = 'line:' || v_line;
      end if;
    end if;
    insert into public.cb_entry_lines (entry_id, account_id, amount, memo) values (v_id, v_acc, round((v ->> 'amount')::numeric, 2), left(coalesce(v ->> 'memo', ''), 200));
    v_sum := v_sum + round((v ->> 'amount')::numeric, 2);
    if (select line_type from public.cb_master_lines where line_no = v_line) in ('Revenue', 'Expense') then v_income := v_income + round((v ->> 'amount')::numeric, 2); end if;
  end loop;
  perform private.require(v_sum = 0, format('The entry does not balance: it is out by %s.', v_sum));
  perform private.require(p_kind <> 'RJE' or v_income = 0, 'A reclassifying entry (RJE) cannot change the result. Use an AJE.');
  update public.cb_files set updated_at = now() where id = p_file;
  return v_id;
end;
$$;
