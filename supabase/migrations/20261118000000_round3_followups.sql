-- Round 3 follow-ups (Hashim, Nov 17, 2026).
--
-- 1. Standard entries are firm-wide, so like firm vendor rules they never carry a provincial tax code:
--    "Taxable at the client's rate", "No sales tax" or "Choose on the line".
-- 3. Lines already in a file twice (same date, description and amount, on any account) are listed in
--    step 3, unless the preparer confirmed them as real when uploading.
-- 4. Lines uploaded with "These are real transactions" go to the reviewer with the reason.
-- 5. No line is confirmed before the GST/HST questions are answered (no assumed registrant). When the
--    answers change, confirmed lines with sales tax, and entries with a sales tax line, go back to the
--    reviewer: their tax is worked out again under the new answers.

-- 1.
alter table public.cb_standard_entries add column tax_mode text not null default 'line' check (tax_mode in ('taxable', 'none', 'line'));
update public.cb_standard_entries set tax_mode = case name when 'Home office' then 'none' when 'Auto expenses' then 'line' when 'Accounting fee accrual' then 'taxable' else 'none' end;

drop function if exists public.cb_save_standard_entry(uuid, text, text, text, text, text, text, text, boolean);
create or replace function public.cb_save_standard_entry(p_id uuid, p_name text, p_kind text, p_reason text, p_debit text, p_credit text, p_memo text, p_wp_ref text, p_reverse boolean, p_tax_mode text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.require((select private.is_owner()), 'Only an owner can change standard entries.');
  perform private.require(p_debit <> p_credit, 'Choose two different accounts.');
  perform private.require(p_tax_mode in ('taxable', 'none', 'line'), 'Choose the sales tax: taxable at the client''s rate, no sales tax, or choose on the line.');
  if p_id is null then
    insert into public.cb_standard_entries (name, kind, reason, debit_account, credit_account, memo, wp_ref, reverse_next_year, tax_mode, sort_order)
    values (btrim(p_name), p_kind, p_reason, p_debit, p_credit, btrim(p_memo), btrim(p_wp_ref), coalesce(p_reverse, false), p_tax_mode,
            coalesce((select max(sort_order) from public.cb_standard_entries), 0) + 10)
    returning id into v_id;
  else
    update public.cb_standard_entries set name = btrim(p_name), kind = p_kind, reason = p_reason, debit_account = p_debit, credit_account = p_credit,
      memo = btrim(p_memo), wp_ref = btrim(p_wp_ref), reverse_next_year = coalesce(p_reverse, false), tax_mode = p_tax_mode where id = p_id returning id into v_id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.cb_save_standard_entry(uuid, text, text, text, text, text, text, text, boolean, text) from public, anon;
grant execute on function public.cb_save_standard_entry(uuid, text, text, text, text, text, text, text, boolean, text) to authenticated;

-- 3 and 4.
alter table public.cb_bank_lines add column dup_confirmed boolean not null default false;

create or replace function public.cb_file_duplicates(p_file uuid)
returns table (txn_date date, description text, amount numeric, times int, accounts text)
language sql stable security definer set search_path = '' as $$
  select l.txn_date, min(l.description), abs(l.amount), count(*)::int, string_agg(distinct a.name, ', ')
    from public.cb_bank_lines l join public.cb_bank_accounts a on a.id = l.account_id
   where l.file_id = p_file and private.can_view('closebook')
   group by l.txn_date, upper(btrim(l.description)), abs(l.amount)
  having count(*) filter (where not l.dup_confirmed) > 1
   order by 1, 2;
$$;
revoke all on function public.cb_file_duplicates(uuid) from public, anon;
grant execute on function public.cb_file_duplicates(uuid) to authenticated;

-- The lines of one statement that were already in the file: kept, marked as confirmed by the preparer,
-- and sent to the reviewer with the reason.
create or replace function public.cb_flag_uploaded_duplicates(p_file uuid, p_statement uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  update public.cb_bank_lines l set dup_confirmed = true, status = 'reviewer', reviewer_reason = 'Uploaded although already in the file.'
   where l.file_id = p_file and l.statement_id = p_statement
     and exists (select 1 from public.cb_bank_lines o where o.file_id = p_file and o.statement_id <> p_statement and o.txn_date = l.txn_date
                 and upper(btrim(o.description)) = upper(btrim(l.description)) and abs(o.amount) = abs(l.amount));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.cb_flag_uploaded_duplicates(uuid, uuid) from public, anon;
grant execute on function public.cb_flag_uploaded_duplicates(uuid, uuid) to authenticated;

-- 5. Setup answers: a change to GST/HST registration or the quick method sends taxed work back to the reviewer.
create or replace function public.cb_save_setup(p_file uuid, p_setup jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_key text;
  v_new jsonb;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null, 'File not found.');
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(jsonb_typeof(p_setup) = 'object', 'Answers are missing.');
  for v_key in select jsonb_object_keys(p_setup) loop
    perform private.require(v_key in ('realtor', 'owner_paid', 'dividends', 'payroll', 'holdco', 'gst_registered', 'gst_frequency', 'quick_method'), format('Unknown question %s.', v_key));
  end loop;
  perform private.require(coalesce(p_setup ->> 'gst_frequency', 'annual') in ('annual', 'quarterly', 'monthly'), 'Choose annual, quarterly or monthly.');
  v_new := coalesce(v_file.setup, '{}'::jsonb) || p_setup;
  update public.cb_files set setup = v_new, updated_at = now() where id = p_file;
  -- Before November 17 an unanswered file was coded as a registrant on the regular method; compare with that.
  if coalesce((v_file.setup ->> 'gst_registered')::boolean, true) is distinct from coalesce((v_new ->> 'gst_registered')::boolean, true)
     or coalesce((v_file.setup ->> 'quick_method')::boolean, false) is distinct from coalesce((v_new ->> 'quick_method')::boolean, false) then
    update public.cb_bank_lines l set status = 'reviewer', reviewer_reason = 'The GST/HST answers changed: the sales tax was worked out again. Check it.'
     where l.file_id = p_file and l.status = 'done'
       and exists (select 1 from public.cb_sales_tax_parts p where p.code = l.tax_code and p.rate > 0);
    update public.cb_entries e set needs_review = true, reviewed_at = null, reviewed_by = null
     where e.file_id = p_file and exists (select 1 from public.cb_entry_lines x where x.entry_id = e.id and x.tax_code is not null);
  end if;
end;
$$;

-- 5. Coding needs the GST/HST answers first.
create or replace function private.cb_require_gst_answers(p_file uuid) returns void language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require((select setup ? 'gst_registered' from public.cb_files where id = p_file), 'Answer the GST/HST questions in step 1 first.');
end;
$$;
revoke all on function private.cb_require_gst_answers(uuid) from public, anon, authenticated;

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
  perform private.cb_require_gst_answers(p_file);
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
      -- A line uploaded although already in the file stays with the reviewer whoever codes it.
      when v_line.dup_confirmed and v_line.status = 'reviewer' then v_line.reviewer_reason
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
