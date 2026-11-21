-- CloseBook2 piece CB2-1 version 4, PR B (Hashim, Nov 21, 2026): Bank transactions, Upload from file, Rules and Reconcile in
-- Books, on the same bank lines the year files hold.
-- 1. Upload from file (QBO): opening and closing balances are optional (a difference is a warning, never a refusal); lines
--    land in the year that covers their date; the column mapping is kept per account (cb_books_csv_maps).
-- 2. Match: a bank line matched to a journal entry already recorded posts nothing (cb_bank_lines.matched_entry).
-- 3. Rules (QBO): per client; conditions, then account, tax code, memo or a split by percentage; "Automatically confirm".
--    One History row per action (cb_books_history.rule_id).
-- 4. Reconcile (QBO): a statement ending date and balance, the cleared lines, the difference recorded; Undo.

-- ---------- 1. Upload
alter table public.cb_bank_statements alter column opening drop not null;
alter table public.cb_bank_statements alter column closing drop not null;
-- The balances typed at upload, kept as typed. The old engine's opening and closing (which must tie to the lines) are filled
-- only when the upload covers one year and ties; a difference is a warning, never a refusal.
alter table public.cb_bank_statements add column if not exists stated_opening numeric(14, 2);
alter table public.cb_bank_statements add column if not exists stated_closing numeric(14, 2);
create table if not exists public.cb_books_csv_maps (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null default private.cb_default_firm() references public.firms (id),
  cb_client_id uuid not null references public.cb_clients (id) on delete cascade,
  ident text not null,
  mapping jsonb not null,
  updated_at timestamptz not null default now(),
  unique (cb_client_id, ident)
);

-- ---------- 2. Match to a journal entry
alter table public.cb_bank_lines add column if not exists matched_entry uuid references public.cb_entries (id) on delete set null;
alter table public.cb_bank_lines drop constraint if exists cb_bank_lines_source_check;
alter table public.cb_bank_lines add constraint cb_bank_lines_source_check
  check (source in ('', 'rule', 'auto', 'last_year', 'history', 'firm', 'manual', 'transfer', 'outstanding', 'entry'));

-- ---------- 3. Rules
create table if not exists public.cb_books_rules (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null default private.cb_default_firm() references public.firms (id),
  cb_client_id uuid not null references public.cb_clients (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 100),
  priority int not null default 0,
  direction text not null default 'any' check (direction in ('in', 'out', 'any')),
  accounts text[] not null default '{}',              -- bank and card accounts by number; empty: all
  match_all boolean not null default true,
  conditions jsonb not null default '[]',             -- [{field: description|amount, op: contains|eq|between, value, value2}]
  chart_account text,                                 -- set account (by number), or
  splits jsonb,                                       -- split by percentage: [{account, tax, percent}]
  tax_code text,
  memo text not null default '',
  auto_confirm boolean not null default false,
  active boolean not null default true,
  created_by uuid references public.staff (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.cb_books_history add column if not exists rule_id uuid references public.cb_books_rules (id) on delete set null;

-- ---------- 4. Reconcile
create table if not exists public.cb_books_reconciliations (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null default private.cb_default_firm() references public.firms (id),
  cb_client_id uuid not null references public.cb_clients (id) on delete cascade,
  ident text not null,                                -- the bank or card account (its number)
  statement_date date not null,
  beginning numeric(14, 2) not null,
  ending numeric(14, 2) not null,
  cleared numeric(14, 2) not null,
  difference numeric(14, 2) not null,
  lines uuid[] not null default '{}',
  status text not null default 'finished' check (status in ('finished', 'undone')),
  created_by uuid references public.staff (id),
  created_at timestamptz not null default now(),
  undone_by uuid references public.staff (id),
  undone_at timestamptz
);

do $$
declare t text;
begin
  foreach t in array array['cb_books_csv_maps', 'cb_books_rules', 'cb_books_reconciliations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create index if not exists %I on public.%I (firm_id)', t || '_firm_idx', t);
    execute format('drop policy if exists "Own firm only" on public.%I', t);
    execute format('create policy "Own firm only" on public.%I as restrictive for all to authenticated using (firm_id = (select private.my_firm())) with check (firm_id = (select private.my_firm()))', t);
    execute format('drop policy if exists "Closebook viewers read" on public.%I', t);
    execute format('create policy "Closebook viewers read" on public.%I for select to authenticated using ((select private.can_view(''closebook'')))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop trigger if exists cb_0_firm_guard on public.%I', t);
    execute format('create trigger cb_0_firm_guard before insert or update or delete on public.%I for each row execute function private.cb_firm_guard()', t);
  end loop;
end $$;

-- The year file's bank or card account for a client's account (by number): found, else made like the latest year's.
create or replace function private.cb_books_bank_account(p_file public.cb_files, p_ident text) returns uuid
 language plpgsql security definer set search_path to ''
as $function$
declare v uuid; src public.cb_bank_accounts;
begin
  select a.id into v from public.cb_bank_accounts a where a.file_id = p_file.id and coalesce(nullif(a.number, ''), a.chart_account) = p_ident order by a.created_at limit 1;
  if v is not null then return v; end if;
  select a.* into src from public.cb_bank_accounts a join public.cb_files f on f.id = a.file_id
   where f.cb_client_id = p_file.cb_client_id and coalesce(nullif(a.number, ''), a.chart_account) = p_ident order by f.year_end desc limit 1;
  perform private.require(src.id is not null, 'Choose one of the client''s bank or card accounts.');
  insert into public.cb_bank_accounts (file_id, name, name_key, kind, chart_account, number, account_type, bank, long_term, gifi_line, t2_line, created_by)
  values (p_file.id, src.name, src.name_key, src.kind, src.chart_account, src.number, src.account_type, src.bank, src.long_term, src.gifi_line, src.t2_line, (select auth.uid()))
  returning id into v;
  return v;
end;
$function$;

-- Upload from file. Rows: [{date, description, amount}] in the statement's own signs. Each row lands in the year file that
-- covers its date; one statement per year file. Balances optional. Returns the lines added per year.
create or replace function public.cb_books_upload(p_client uuid, p_ident text, p_file_name text, p_rows jsonb, p_opening numeric default null,
  p_closing numeric default null, p_mapping jsonb default null) returns jsonb
 language plpgsql security definer set search_path to ''
as $function$
declare f public.cb_files; v_acc uuid; v_stmt uuid; v_n int := 0; v_out jsonb := '[]'::jsonb; v_missing text; v_row jsonb; v_cnt int; v_ties boolean;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook to upload.');
  perform private.cb_books_client(p_client);
  perform private.require(jsonb_typeof(p_rows) = 'array' and jsonb_array_length(p_rows) between 1 and 20000, 'The file has no transactions, or too many.');
  for v_row in select * from jsonb_array_elements(p_rows) loop
    perform private.require((v_row ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$', 'A row has no date.');
    perform private.require(length(btrim(coalesce(v_row ->> 'description', ''))) between 1 and 500, 'A row has no description.');
    perform private.require((v_row ->> 'amount')::numeric is not null and round((v_row ->> 'amount')::numeric, 2) = (v_row ->> 'amount')::numeric, 'Every amount has at most 2 decimals.');
  end loop;
  select string_agg(distinct to_char((r ->> 'date')::date, 'Mon FMDD, YYYY'), ', ') into v_missing from jsonb_array_elements(p_rows) r
   where not exists (select 1 from public.cb_files x where x.cb_client_id = p_client and (r ->> 'date')::date between x.year_start and x.year_end);
  perform private.require(v_missing is null, format('No year in Closebook covers %s. Add the year first.', v_missing));
  perform private.require((p_opening is null or round(p_opening, 2) = p_opening) and (p_closing is null or round(p_closing, 2) = p_closing), 'Balances have at most 2 decimals.');
  -- Both balances given, one year, and opening plus the lines equals closing.
  v_ties := p_opening is not null and p_closing is not null
    and (select count(distinct x.id) from public.cb_files x, jsonb_array_elements(p_rows) r where x.cb_client_id = p_client and (r ->> 'date')::date between x.year_start and x.year_end) = 1
    and p_opening + (select sum((r ->> 'amount')::numeric) from jsonb_array_elements(p_rows) r) = p_closing;
  for f in select * from public.cb_files x where x.cb_client_id = p_client
      and exists (select 1 from jsonb_array_elements(p_rows) r where (r ->> 'date')::date between x.year_start and x.year_end) order by x.year_end loop
    perform private.require(f.phase <> 'locked', format('The year ending %s is locked.', to_char(f.year_end, 'Mon FMDD, YYYY')));
    v_acc := private.cb_books_bank_account(f, p_ident);
    select count(*) into v_cnt from jsonb_array_elements(p_rows) r where (r ->> 'date')::date between f.year_start and f.year_end;
    insert into public.cb_bank_statements (file_id, account_id, file_name, first_date, last_date, period_start, period_end, opening, closing, stated_opening, stated_closing,
           lines, plus_total, minus_total, uploaded_by)
    select f.id, v_acc, left(coalesce(p_file_name, ''), 200), min((r ->> 'date')::date), max((r ->> 'date')::date), min((r ->> 'date')::date), max((r ->> 'date')::date),
           case when v_ties then p_opening end, case when v_ties then p_closing end, p_opening, p_closing,
           count(*), coalesce(sum((r ->> 'amount')::numeric) filter (where (r ->> 'amount')::numeric > 0), 0),
           coalesce(sum((r ->> 'amount')::numeric) filter (where (r ->> 'amount')::numeric < 0), 0), (select auth.uid())
      from jsonb_array_elements(p_rows) r where (r ->> 'date')::date between f.year_start and f.year_end
    returning id into v_stmt;
    insert into public.cb_bank_lines (statement_id, file_id, account_id, row_no, txn_date, description, amount)
    select v_stmt, f.id, v_acc, (row_number() over ())::int, (r ->> 'date')::date, btrim(r ->> 'description'), (r ->> 'amount')::numeric
      from jsonb_array_elements(p_rows) r where (r ->> 'date')::date between f.year_start and f.year_end;
    v_n := v_n + v_cnt;
    v_out := v_out || jsonb_build_array(jsonb_build_object('file', f.id, 'year_end', f.year_end, 'lines', v_cnt));
  end loop;
  if p_mapping is not null then
    insert into public.cb_books_csv_maps (cb_client_id, ident, mapping) values (p_client, p_ident, p_mapping)
    on conflict (cb_client_id, ident) do update set mapping = excluded.mapping, updated_at = now();
  end if;
  return jsonb_build_object('lines', v_n, 'years', v_out);
end;
$function$;

-- Match a bank line to a journal entry already recorded: it posts nothing (the entry holds it). One History row.
create or replace function public.cb_books_match_entry(p_line uuid, p_entry uuid) returns void
 language plpgsql security definer set search_path to ''
as $function$
declare l public.cb_bank_lines; e public.cb_entries; f public.cb_files;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into l from public.cb_bank_lines where id = p_line for update;
  perform private.require(l.id is not null, 'Line not found.');
  select * into f from public.cb_files where id = l.file_id;
  perform private.require(f.phase <> 'locked', 'This file is locked.');
  perform private.require(private.cb_line_pending(l), 'Undo the posted line first.');
  select e2.* into e from public.cb_entries e2 join public.cb_files f2 on f2.id = e2.file_id where e2.id = p_entry and f2.cb_client_id = f.cb_client_id;
  perform private.require(e.id is not null, 'Entry not found.');
  perform private.cb_one_action(true);
  perform set_config('cb.transfer', 'on', true);   -- the transfer guard: a match to an entry is a match too
  update public.cb_bank_lines set status = 'matched', source = 'entry', matched_entry = p_entry, chart_account = null, tax_code = null, transfer_account = null,
         is_split = false, coded_by = (select auth.uid()), coded_at = now() where id = p_line;
  perform set_config('cb.transfer', '', true);
  perform private.cb_one_action(false);
  insert into public.cb_file_history (file_id, actor_id, action, step, detail, line_id, entry_id, ref_label, new_value)
  values (l.file_id, (select auth.uid()), 'line_matched_entry', 'code', format('%s %s matched to journal entry %s', to_char(l.txn_date, 'Mon FMDD, YYYY'), l.description, private.cb_entry_label(p_entry)),
          l.id, p_entry, left(l.description, 300), private.cb_entry_label(p_entry));
  perform private.cb_one_action(true);
end;
$function$;

-- Undo a match to an entry: back to For review. One History row.
create or replace function public.cb_books_unmatch_entry(p_line uuid) returns void
 language plpgsql security definer set search_path to ''
as $function$
declare l public.cb_bank_lines;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into l from public.cb_bank_lines where id = p_line for update;
  perform private.require(l.id is not null and l.matched_entry is not null, 'Line not found.');
  perform private.cb_one_action(true);
  perform set_config('cb.transfer', 'on', true);
  update public.cb_bank_lines set status = 'new', source = '', matched_entry = null, coded_by = null, coded_at = null where id = p_line;
  perform set_config('cb.transfer', '', true);
  perform private.cb_one_action(false);
  insert into public.cb_file_history (file_id, actor_id, action, step, detail, line_id, entry_id, ref_label)
  values (l.file_id, (select auth.uid()), 'line_unmatched_entry', 'code', format('%s %s: match to a journal entry undone', to_char(l.txn_date, 'Mon FMDD, YYYY'), l.description),
          l.id, l.matched_entry, left(l.description, 300));
  perform private.cb_one_action(true);
end;
$function$;

-- Rules: new or edit (one History row); Copy, Delete (one History row each).
create or replace function private.cb_books_rule_text(r public.cb_books_rules) returns text
 language sql immutable set search_path to ''
as $function$
  select concat_ws(E'\n', 'Name: ' || r.name, 'Money: ' || r.direction, 'Accounts: ' || coalesce(nullif(array_to_string(r.accounts, ', '), ''), 'all'),
    'Conditions (' || case when r.match_all then 'all' else 'any' end || '): ' || r.conditions::text,
    'Then: ' || coalesce('account ' || r.chart_account, 'split ' || r.splits::text, 'nothing') || coalesce(', tax ' || r.tax_code, '') || case when r.memo <> '' then ', memo ' || r.memo else '' end,
    'Automatically confirm: ' || case when r.auto_confirm then 'Yes' else 'No' end, 'Active: ' || case when r.active then 'Yes' else 'No' end);
$function$;

create or replace function public.cb_books_save_rule(p_client uuid, p_id uuid, p_rule jsonb) returns uuid
 language plpgsql security definer set search_path to ''
as $function$
declare v_old public.cb_books_rules; v_new public.cb_books_rules; v_split jsonb := nullif(p_rule -> 'splits', 'null'::jsonb); s jsonb; v_pct numeric := 0;
  v_acc text := nullif(btrim(coalesce(p_rule ->> 'chart_account', '')), ''); v_tax text := nullif(btrim(coalesce(p_rule ->> 'tax_code', '')), '');
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  perform private.cb_books_client(p_client);
  perform private.require(length(btrim(coalesce(p_rule ->> 'name', ''))) between 1 and 100, 'Name the rule.');
  perform private.require(coalesce(p_rule ->> 'direction', 'any') in ('in', 'out', 'any'), 'Choose money in or money out.');
  perform private.require(jsonb_typeof(p_rule -> 'conditions') = 'array' and jsonb_array_length(p_rule -> 'conditions') between 1 and 10, 'Add a condition.');
  perform private.require(v_acc is not null or v_split is not null, 'Choose the account, or split by percentage.');
  perform private.require(v_acc is null or exists (select 1 from public.cb_chart_accounts where number = v_acc), 'Choose an account from the chart.');
  perform private.require(v_tax is null or exists (select 1 from public.cb_sales_tax_codes where code = v_tax), 'Choose a tax code from the list.');
  if v_split is not null then
    perform private.require(jsonb_typeof(v_split) = 'array' and jsonb_array_length(v_split) between 2 and 10, 'A split has two lines or more.');
    for s in select * from jsonb_array_elements(v_split) loop
      perform private.require(exists (select 1 from public.cb_chart_accounts where number = s ->> 'account'), 'Every split line needs an account from the chart.');
      v_pct := v_pct + (s ->> 'percent')::numeric;
    end loop;
    perform private.require(v_pct = 100, format('The percentages add up to %s, not 100.', v_pct));
  end if;
  if p_id is not null then
    select * into v_old from public.cb_books_rules where id = p_id and cb_client_id = p_client;
    perform private.require(v_old.id is not null, 'Rule not found.');
    update public.cb_books_rules set name = btrim(p_rule ->> 'name'), direction = coalesce(p_rule ->> 'direction', 'any'),
      accounts = coalesce(array(select jsonb_array_elements_text(p_rule -> 'accounts')), '{}'), match_all = coalesce((p_rule ->> 'match_all')::boolean, true),
      conditions = p_rule -> 'conditions', chart_account = case when v_split is null then v_acc end, splits = v_split, tax_code = v_tax,
      memo = left(coalesce(p_rule ->> 'memo', ''), 200), auto_confirm = coalesce((p_rule ->> 'auto_confirm')::boolean, false),
      active = coalesce((p_rule ->> 'active')::boolean, true), updated_at = now() where id = p_id returning * into v_new;
    insert into public.cb_books_history (cb_client_id, rule_id, actor_id, action, detail, old_value, new_value)
    values (p_client, p_id, (select auth.uid()), 'rule_changed', format('Rule %s changed', v_new.name), private.cb_books_rule_text(v_old), private.cb_books_rule_text(v_new));
  else
    insert into public.cb_books_rules (cb_client_id, name, priority, direction, accounts, match_all, conditions, chart_account, splits, tax_code, memo, auto_confirm, created_by)
    values (p_client, btrim(p_rule ->> 'name'), coalesce((select max(priority) + 1 from public.cb_books_rules where cb_client_id = p_client), 0), coalesce(p_rule ->> 'direction', 'any'),
      coalesce(array(select jsonb_array_elements_text(p_rule -> 'accounts')), '{}'), coalesce((p_rule ->> 'match_all')::boolean, true), p_rule -> 'conditions',
      case when v_split is null then v_acc end, v_split, v_tax, left(coalesce(p_rule ->> 'memo', ''), 200), coalesce((p_rule ->> 'auto_confirm')::boolean, false), (select auth.uid()))
    returning * into v_new;
    insert into public.cb_books_history (cb_client_id, rule_id, actor_id, action, detail, new_value)
    values (p_client, v_new.id, (select auth.uid()), 'rule_added', format('Rule %s added', v_new.name), private.cb_books_rule_text(v_new));
  end if;
  return v_new.id;
end;
$function$;

create or replace function public.cb_books_rule_action(p_rule uuid, p_action text) returns uuid
 language plpgsql security definer set search_path to ''
as $function$
declare r public.cb_books_rules; v uuid;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into r from public.cb_books_rules where id = p_rule and firm_id = private.cb_default_firm();
  perform private.require(r.id is not null, 'Rule not found.');
  if p_action = 'copy' then
    insert into public.cb_books_rules (cb_client_id, name, priority, direction, accounts, match_all, conditions, chart_account, splits, tax_code, memo, auto_confirm, active, created_by)
    values (r.cb_client_id, left('Copy of ' || r.name, 100), coalesce((select max(priority) + 1 from public.cb_books_rules where cb_client_id = r.cb_client_id), 0), r.direction, r.accounts,
      r.match_all, r.conditions, r.chart_account, r.splits, r.tax_code, r.memo, r.auto_confirm, r.active, (select auth.uid())) returning id into v;
    insert into public.cb_books_history (cb_client_id, rule_id, actor_id, action, detail)
    values (r.cb_client_id, v, (select auth.uid()), 'rule_copied', format('Rule copied from %s', r.name));
    return v;
  elsif p_action = 'delete' then
    insert into public.cb_books_history (cb_client_id, rule_id, actor_id, action, detail, old_value)
    values (r.cb_client_id, null, (select auth.uid()), 'rule_deleted', format('Rule %s deleted', r.name), private.cb_books_rule_text(r));
    delete from public.cb_books_rules where id = p_rule;
    return null;
  end if;
  perform private.require(false, 'Unknown action.');
  return null;
end;
$function$;

-- Reconcile: the lines ticked as cleared, the statement's ending date and balance. The beginning balance is the last
-- finished reconciliation's ending balance; at the first, the account's opening balance in Books (p_opening, as QBO).
-- Finish works with a difference; the difference is recorded.
create or replace function public.cb_books_reconcile(p_client uuid, p_ident text, p_date date, p_ending numeric, p_lines uuid[], p_opening numeric default 0) returns uuid
 language plpgsql security definer set search_path to ''
as $function$
declare v_begin numeric; v_cleared numeric; v uuid; v_bad int;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  perform private.cb_books_client(p_client);
  perform private.require(p_date is not null and p_ending is not null and round(p_ending, 2) = p_ending, 'Enter the statement ending date and balance.');
  select count(*) into v_bad from public.cb_bank_lines l join public.cb_bank_accounts a on a.id = l.account_id join public.cb_files f on f.id = l.file_id
   where l.id = any (coalesce(p_lines, '{}')) and (f.cb_client_id <> p_client or coalesce(nullif(a.number, ''), a.chart_account) <> p_ident or l.status = 'excluded' or l.txn_date > p_date
     or exists (select 1 from public.cb_books_reconciliations r where r.cb_client_id = p_client and r.status = 'finished' and l.id = any (r.lines)));
  perform private.require(v_bad = 0, 'A line ticked is not this account''s, is excluded, is after the statement date, or is already reconciled.');
  perform private.require(p_opening is not null and round(p_opening, 2) = p_opening, 'The opening balance has at most 2 decimals.');
  select coalesce((select ending from public.cb_books_reconciliations where cb_client_id = p_client and ident = p_ident and status = 'finished' order by statement_date desc, created_at desc limit 1), p_opening)
    into v_begin;
  select coalesce(sum(amount), 0) into v_cleared from public.cb_bank_lines where id = any (coalesce(p_lines, '{}'));
  insert into public.cb_books_reconciliations (cb_client_id, ident, statement_date, beginning, ending, cleared, difference, lines, created_by)
  values (p_client, p_ident, p_date, v_begin, p_ending, v_cleared, p_ending - (v_begin + v_cleared), coalesce(p_lines, '{}'), (select auth.uid())) returning id into v;
  insert into public.cb_books_history (cb_client_id, actor_id, action, detail, new_value)
  values (p_client, (select auth.uid()), 'reconciled', format('Account %s reconciled to %s', p_ident, to_char(p_date, 'Mon FMDD, YYYY')),
          format('Ending balance %s; cleared %s lines; difference %s', private.cb_money(p_ending), coalesce(array_length(p_lines, 1), 0), private.cb_money(p_ending - (v_begin + v_cleared))));
  return v;
end;
$function$;

create or replace function public.cb_books_undo_reconcile(p_rec uuid) returns void
 language plpgsql security definer set search_path to ''
as $function$
declare r public.cb_books_reconciliations;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into r from public.cb_books_reconciliations where id = p_rec and firm_id = private.cb_default_firm() and status = 'finished';
  perform private.require(r.id is not null, 'Reconciliation not found.');
  perform private.require(not exists (select 1 from public.cb_books_reconciliations x where x.cb_client_id = r.cb_client_id and x.ident = r.ident and x.status = 'finished'
    and (x.statement_date, x.created_at) > (r.statement_date, r.created_at)), 'Undo the later reconciliation first.');
  update public.cb_books_reconciliations set status = 'undone', undone_by = (select auth.uid()), undone_at = now() where id = p_rec;
  insert into public.cb_books_history (cb_client_id, actor_id, action, detail)
  values (r.cb_client_id, (select auth.uid()), 'reconcile_undone', format('Reconciliation of %s to %s undone', r.ident, to_char(r.statement_date, 'Mon FMDD, YYYY')));
end;
$function$;

revoke all on function private.cb_books_bank_account(public.cb_files, text), private.cb_books_rule_text(public.cb_books_rules) from public, anon, authenticated;
revoke all on function public.cb_books_upload(uuid, text, text, jsonb, numeric, numeric, jsonb), public.cb_books_match_entry(uuid, uuid), public.cb_books_unmatch_entry(uuid),
  public.cb_books_save_rule(uuid, uuid, jsonb), public.cb_books_rule_action(uuid, text), public.cb_books_reconcile(uuid, text, date, numeric, uuid[], numeric),
  public.cb_books_undo_reconcile(uuid) from public, anon;
grant execute on function public.cb_books_upload(uuid, text, text, jsonb, numeric, numeric, jsonb), public.cb_books_match_entry(uuid, uuid), public.cb_books_unmatch_entry(uuid),
  public.cb_books_save_rule(uuid, uuid, jsonb), public.cb_books_rule_action(uuid, text), public.cb_books_reconcile(uuid, text, date, numeric, uuid[], numeric),
  public.cb_books_undo_reconcile(uuid) to authenticated;

-- Confirm (QBO Bank transactions): each line routed to its year file. kind: code (account and tax code), split (rows of
-- account, tax code and amount that add up to the line), transfer (another of the client's bank or card accounts), pair (a
-- line in another account, for a transfer already recorded there), entry (a journal entry already recorded). An optional
-- memo. One History row per line (the posting's own).
create or replace function public.cb_books_confirm(p_client uuid, p_items jsonb) returns int
 language plpgsql security definer set search_path to ''
as $function$
declare it jsonb; l public.cb_bank_lines; f public.cb_files; v_n int := 0; v_kind text;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  perform private.cb_books_client(p_client);
  perform private.require(jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) between 1 and 5000, 'Nothing to confirm.');
  for it in select * from jsonb_array_elements(p_items) loop
    select x.* into l from public.cb_bank_lines x join public.cb_files y on y.id = x.file_id where x.id = (it ->> 'id')::uuid and y.cb_client_id = p_client;
    perform private.require(l.id is not null, 'Line not found.');
    select * into f from public.cb_files where id = l.file_id;
    v_kind := coalesce(it ->> 'kind', 'code');
    if it ? 'memo' and coalesce(it ->> 'memo', '') <> coalesce(l.memo, '') then
      perform private.require(length(it ->> 'memo') <= 2000, 'Keep the memo under 2,000 characters.');
      update public.cb_bank_lines set memo = btrim(it ->> 'memo') where id = l.id;
    end if;
    if v_kind = 'code' then
      perform public.cb_post_lines(l.file_id, jsonb_build_array(jsonb_build_object('id', l.id, 'kind', 'code', 'account', it ->> 'account', 'tax', it ->> 'tax',
        'source', coalesce(nullif(it ->> 'source', ''), 'manual'), 'rule_id', it ->> 'rule_id')));
    elsif v_kind = 'split' then
      perform public.cb_save_splits(l.id, it -> 'rows');
      perform public.cb_post_lines(l.file_id, jsonb_build_array(jsonb_build_object('id', l.id, 'kind', 'split', 'source', coalesce(nullif(it ->> 'source', ''), 'manual'))));
    elsif v_kind = 'transfer' then
      perform public.cb_post_lines(l.file_id, jsonb_build_array(jsonb_build_object('id', l.id, 'kind', 'transfer',
        'transfer_account', private.cb_books_bank_account(f, it ->> 'transfer'))));
    elsif v_kind = 'pair' then
      perform public.cb_post_lines(l.file_id, jsonb_build_array(jsonb_build_object('id', l.id, 'kind', 'pair', 'other', it ->> 'other')));
    elsif v_kind = 'entry' then
      perform public.cb_books_match_entry(l.id, (it ->> 'entry')::uuid);
    else
      perform private.require(false, 'Unknown action.');
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;
revoke all on function public.cb_books_confirm(uuid, jsonb) from public, anon;
grant execute on function public.cb_books_confirm(uuid, jsonb) to authenticated;
