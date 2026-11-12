-- Closebook part 2b, first piece (Hashim, Nov 13, 2026; BRIEF.md "Bank and card import"): bank and card
-- statements uploaded in Concept's bank upload template, one format only (Date, Description, Amount).
-- - Each upload is one statement for one account. The account type is chosen at the first upload:
--   a bank account (money in positive) or a credit card or line of credit (charges positive).
-- - The upload is refused unless opening + amounts = closing, to the cent; the message shows the difference.
-- - A statement whose dates overlap one already uploaded for that account is refused (remove it first).
-- The Transactions view (coding each line to a GIFI line, vendor rules) builds on these lines next.
-- Anyone with Closebook reads; Closebook Edit uploads and removes.

create table public.cb_bank_accounts (
  id         uuid primary key default gen_random_uuid(),
  file_id    uuid not null references public.cb_files (id) on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 100),
  name_key   text not null,
  kind       text not null check (kind in ('bank', 'card')),
  created_by uuid references public.staff (id),
  created_at timestamptz not null default now(),
  unique (file_id, name_key)
);

create table public.cb_bank_statements (
  id          uuid primary key default gen_random_uuid(),
  file_id     uuid not null references public.cb_files (id) on delete cascade,
  account_id  uuid not null references public.cb_bank_accounts (id) on delete cascade,
  file_name   text not null default '',
  first_date  date not null,
  last_date   date not null,
  opening     numeric(14, 2) not null,
  closing     numeric(14, 2) not null,
  lines       int not null,
  plus_total  numeric(14, 2) not null,   -- money in (bank) or charges (card)
  minus_total numeric(14, 2) not null,   -- money out (bank) or payments (card), as a negative
  uploaded_by uuid references public.staff (id),
  uploaded_at timestamptz not null default now(),
  check (opening + plus_total + minus_total = closing)
);

create table public.cb_bank_lines (
  id           uuid primary key default gen_random_uuid(),
  statement_id uuid not null references public.cb_bank_statements (id) on delete cascade,
  file_id      uuid not null references public.cb_files (id) on delete cascade,
  account_id   uuid not null references public.cb_bank_accounts (id) on delete cascade,
  row_no       int not null,          -- the line in the uploaded file
  txn_date     date not null,
  description  text not null,
  amount       numeric(14, 2) not null
);
create index cb_bank_lines_file on public.cb_bank_lines (file_id, account_id, txn_date);

-- Upload one statement. p_rows: [{"line": 2, "date": "2026-01-01", "description": "...", "amount": 294.83}].
-- p_account: an account already on the file, or null with p_name and p_kind for a new one.
create or replace function public.cb_upload_bank(p_file uuid, p_account uuid, p_name text, p_kind text, p_file_name text,
  p_opening numeric, p_closing numeric, p_rows jsonb)
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
  perform private.require(p_opening + v_sum = p_closing, format(
    'The statement does not balance. Opening %s + transactions %s = %s, but the closing balance is %s: a difference of %s. Check the balances and the file.',
    to_char(p_opening, 'FM999,999,999,990.00'), to_char(v_sum, 'FM999,999,999,990.00'), to_char(p_opening + v_sum, 'FM999,999,999,990.00'),
    to_char(p_closing, 'FM999,999,999,990.00'), to_char(p_closing - (p_opening + v_sum), 'FM999,999,999,990.00')));

  if v_acc.id is null then
    insert into public.cb_bank_accounts (file_id, name, name_key, kind, created_by)
    values (p_file, btrim(regexp_replace(p_name, '\s+', ' ', 'g')), v_key, p_kind, (select auth.uid())) returning * into v_acc;
  end if;
  select * into v_clash from public.cb_bank_statements
   where account_id = v_acc.id and first_date <= v_last and last_date >= v_first order by first_date limit 1;
  perform private.require(v_clash.id is null, format(
    'These dates (%s to %s) overlap a statement already uploaded for %s (%s to %s). Remove that one first if this replaces it.',
    v_first, v_last, v_acc.name, v_clash.first_date, v_clash.last_date));

  insert into public.cb_bank_statements (file_id, account_id, file_name, first_date, last_date, opening, closing, lines, plus_total, minus_total, uploaded_by)
  values (p_file, v_acc.id, left(coalesce(p_file_name, ''), 200), v_first, v_last, p_opening, p_closing, jsonb_array_length(p_rows), v_plus, v_minus, (select auth.uid()))
  returning id into v_stmt;
  insert into public.cb_bank_lines (statement_id, file_id, account_id, row_no, txn_date, description, amount)
  select v_stmt, p_file, v_acc.id, coalesce((r ->> 'line')::int, 0), (r ->> 'date')::date, btrim(r ->> 'description'), (r ->> 'amount')::numeric
    from jsonb_array_elements(p_rows) r;
  update public.cb_files set updated_at = now() where id = p_file;
  return jsonb_build_object('statement', v_stmt, 'account', v_acc.name, 'lines', jsonb_array_length(p_rows), 'first', v_first, 'last', v_last,
    'outside_year', (select count(*) from jsonb_array_elements(p_rows) r where (r ->> 'date')::date not between v_file.year_start and v_file.year_end));
end;
$$;

-- Remove one statement and its lines. An account with no statements left is removed too.
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
  delete from public.cb_bank_accounts a where a.id = v_st.account_id and not exists (select 1 from public.cb_bank_statements s where s.account_id = a.id);
  update public.cb_files set updated_at = now() where id = v_st.file_id;
end;
$$;

alter table public.cb_bank_accounts enable row level security;
alter table public.cb_bank_accounts force row level security;
alter table public.cb_bank_statements enable row level security;
alter table public.cb_bank_statements force row level security;
alter table public.cb_bank_lines enable row level security;
alter table public.cb_bank_lines force row level security;
create policy "Closebook viewers read bank accounts" on public.cb_bank_accounts for select to authenticated using ((select private.can_view('closebook')));
create policy "Closebook viewers read bank statements" on public.cb_bank_statements for select to authenticated using ((select private.can_view('closebook')));
create policy "Closebook viewers read bank lines" on public.cb_bank_lines for select to authenticated using ((select private.can_view('closebook')));
grant select on public.cb_bank_accounts, public.cb_bank_statements, public.cb_bank_lines to authenticated;

revoke all on function public.cb_upload_bank(uuid, uuid, text, text, text, numeric, numeric, jsonb), public.cb_delete_bank_statement(uuid) from public, anon;
grant execute on function public.cb_upload_bank(uuid, uuid, text, text, text, numeric, numeric, jsonb), public.cb_delete_bank_statement(uuid) to authenticated;
