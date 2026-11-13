-- Bank upload, a statement period (Hashim, Nov 13, 2026; BRIEF.md): a file may hold one month or a whole
-- year. The preparer confirms the period (filled from the file's first and last dates); every day inside
-- it counts as received for that account. Every transaction must fall inside the period, and periods for
-- one account may not overlap. Existing statements take their first and last transaction dates.
alter table public.cb_bank_statements add column period_start date, add column period_end date;
update public.cb_bank_statements set period_start = first_date, period_end = last_date;
alter table public.cb_bank_statements alter column period_start set not null, alter column period_end set not null,
  add constraint cb_bank_statements_period check (period_end >= period_start and period_start <= first_date and period_end >= last_date);

drop function public.cb_upload_bank(uuid, uuid, text, text, text, numeric, numeric, jsonb);

create or replace function public.cb_upload_bank(p_file uuid, p_account uuid, p_name text, p_kind text, p_file_name text,
  p_opening numeric, p_closing numeric, p_rows jsonb, p_period_start date, p_period_end date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_acc public.cb_bank_accounts;
  v_row jsonb;
  v_sum numeric := 0;
  v_plus numeric := 0;
  v_minus numeric := 0;
  v_amt numeric;
  v_first date;
  v_last date;
  v_clash public.cb_bank_statements;
  v_stmt uuid;
  v_key text := lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'));
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook to upload.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null, 'File not found.');
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(v_file.file_type = 'full', 'Monthly files confirm bank and cards in QuickBooks; there is nothing to upload.');
  perform private.require(p_opening is not null and p_closing is not null, 'Enter the statement''s opening and closing balances.');
  perform private.require(round(p_opening, 2) = p_opening and round(p_closing, 2) = p_closing, 'Balances have at most 2 decimals.');
  perform private.require(p_period_start is not null and p_period_end is not null and p_period_end >= p_period_start,
    'Enter the statement period: the first and last day the statement covers.');
  perform private.require(p_period_end - p_period_start <= 400, 'One upload covers at most a year.');
  perform private.require(jsonb_typeof(p_rows) = 'array' and jsonb_array_length(p_rows) between 1 and 20000, 'The file has no transactions, or too many.');

  if p_account is not null then
    select * into v_acc from public.cb_bank_accounts where id = p_account and file_id = p_file;
    perform private.require(v_acc.id is not null, 'Choose an account on this file.');
  else
    perform private.require(length(v_key) between 1 and 100, 'Name the account (for example "TD chequing 1234").');
    perform private.require(p_kind in ('bank', 'card'), 'Choose the account type.');
    perform private.require(not exists (select 1 from public.cb_bank_accounts where file_id = p_file and name_key = v_key),
      'An account with that name is already on this file. Choose it from the list.');
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_amt := (v_row ->> 'amount')::numeric;
    perform private.require(v_amt is not null and round(v_amt, 2) = v_amt, 'Every amount has at most 2 decimals.');
    perform private.require((v_row ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$' and length(btrim(coalesce(v_row ->> 'description', ''))) between 1 and 500,
      'Every line needs a date and a description.');
    v_sum := v_sum + v_amt;
    if v_amt > 0 then v_plus := v_plus + v_amt; else v_minus := v_minus + v_amt; end if;
    v_first := least(v_first, (v_row ->> 'date')::date);
    v_last := greatest(v_last, (v_row ->> 'date')::date);
  end loop;
  perform private.require(v_first >= p_period_start and v_last <= p_period_end, format(
    'The file has transactions from %s to %s, outside the statement period %s to %s. Check the period.', v_first, v_last, p_period_start, p_period_end));
  perform private.require(p_opening + v_sum = p_closing, format(
    'The statement does not balance. Opening %s + transactions %s = %s, but the closing balance is %s: a difference of %s. Check the balances and the file.',
    to_char(p_opening, 'FM999,999,999,990.00'), to_char(v_sum, 'FM999,999,999,990.00'), to_char(p_opening + v_sum, 'FM999,999,999,990.00'),
    to_char(p_closing, 'FM999,999,999,990.00'), to_char(p_closing - (p_opening + v_sum), 'FM999,999,999,990.00')));

  if v_acc.id is null then
    insert into public.cb_bank_accounts (file_id, name, name_key, kind, created_by)
    values (p_file, btrim(regexp_replace(p_name, '\s+', ' ', 'g')), v_key, p_kind, (select auth.uid())) returning * into v_acc;
  end if;
  select * into v_clash from public.cb_bank_statements
   where account_id = v_acc.id and period_start <= p_period_end and period_end >= p_period_start order by period_start limit 1;
  perform private.require(v_clash.id is null, format(
    'This period (%s to %s) overlaps a statement already uploaded for %s (%s to %s). Remove that one first if this replaces it.',
    p_period_start, p_period_end, v_acc.name, v_clash.period_start, v_clash.period_end));

  insert into public.cb_bank_statements (file_id, account_id, file_name, first_date, last_date, period_start, period_end, opening, closing, lines, plus_total, minus_total, uploaded_by)
  values (p_file, v_acc.id, left(coalesce(p_file_name, ''), 200), v_first, v_last, p_period_start, p_period_end, p_opening, p_closing, jsonb_array_length(p_rows), v_plus, v_minus, (select auth.uid()))
  returning id into v_stmt;
  insert into public.cb_bank_lines (statement_id, file_id, account_id, row_no, txn_date, description, amount)
  select v_stmt, p_file, v_acc.id, coalesce((r ->> 'line')::int, 0), (r ->> 'date')::date, btrim(r ->> 'description'), (r ->> 'amount')::numeric
    from jsonb_array_elements(p_rows) r;
  update public.cb_files set updated_at = now() where id = p_file;
  return jsonb_build_object('statement', v_stmt, 'account', v_acc.name, 'account_id', v_acc.id, 'lines', jsonb_array_length(p_rows),
    'first', p_period_start, 'last', p_period_end,
    'outside_year', (select count(*) from jsonb_array_elements(p_rows) r where (r ->> 'date')::date not between v_file.year_start and v_file.year_end));
end;
$$;

revoke all on function public.cb_upload_bank(uuid, uuid, text, text, text, numeric, numeric, jsonb, date, date) from public, anon;
grant execute on function public.cb_upload_bank(uuid, uuid, text, text, text, numeric, numeric, jsonb, date, date) to authenticated;
