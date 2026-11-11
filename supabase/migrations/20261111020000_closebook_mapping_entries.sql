-- Closebook build step 1, part 3a (Phase 3 batch 4.3, 4.5, 5.4 and 5.5): matching accounts to GIFI
-- lines, tax codes, the reviewer's list, and entries.
-- - Staff match client accounts to master lines; never GIFI codes or tax codes (4.5).
-- - The client's history is reused automatically; the app sends name-based suggestions; an account
--   with no clear match, or two, goes to "Needs reviewer decision". The reviewer's decision is saved
--   for the client's future years.
-- - Only the file's reviewer changes an account's tax code (4.3).
-- - Entries (full files only, 5.4): AJE, RJE, TJE, numbered per kind; must balance; only to lines staff
--   can map to (never a total); free entries and any entry over the threshold go to the reviewer; RJEs
--   cannot change the result.

alter table public.cb_accounts
  add column line_no        text references public.cb_master_lines (line_no),
  add column tax_code       text references public.cb_tax_codes (code),   -- the reviewer's choice; empty means the line's default
  add column mapping_source text check (mapping_source in ('history', 'suggested', 'preparer', 'reviewer')),
  add column needs_reviewer boolean not null default false,
  add column reviewer_reason text not null default '',
  add column mapped_by      uuid references public.staff (id),
  add column mapped_at      timestamptz;

-- The latest decision per client account, reused in every later file for that client.
create table public.cb_client_mappings (
  client_id   uuid not null references public.clients (id) on delete cascade,
  account_key text not null,
  line_no     text not null references public.cb_master_lines (line_no),
  tax_code    text references public.cb_tax_codes (code),
  decided_by  uuid references public.staff (id),
  decided_at  timestamptz not null default now(),
  primary key (client_id, account_key)
);

create table public.cb_entries (
  id                uuid primary key default gen_random_uuid(),
  file_id           uuid not null references public.cb_files (id) on delete cascade,
  kind              text not null check (kind in ('AJE', 'RJE', 'TJE')),
  number            int not null,
  reason            text not null check (reason in ('accrual', 'reclassification', 'correction', 'tax')),
  note              text not null check (length(btrim(note)) between 3 and 500),
  reverse_next_year boolean not null default false,
  needs_review      boolean not null default true,
  reviewed_by       uuid references public.staff (id),
  reviewed_at       timestamptz,
  created_by        uuid references public.staff (id),
  created_at        timestamptz not null default now(),
  unique (file_id, kind, number)
);

create table public.cb_entry_lines (
  id         uuid primary key default gen_random_uuid(),
  entry_id   uuid not null references public.cb_entries (id) on delete cascade,
  account_id uuid not null references public.cb_accounts (id),
  amount     numeric(14, 2) not null check (amount <> 0),   -- debit positive, credit negative
  memo       text not null default ''
);

create or replace function private.cb_file_of_account(p_account uuid)
returns public.cb_files language sql stable security definer set search_path = '' as $$
  select f.* from public.cb_files f join public.cb_accounts a on a.file_id = f.id where a.id = p_account
$$;

-- Match one account to a line. The file's reviewer decides accounts on the reviewer's list; anyone
-- with Closebook Edit matches the others. The decision is kept for the client's future files.
create or replace function public.cb_map_account(p_account uuid, p_line text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_acc public.cb_accounts;
  v_reviewer boolean;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook to match accounts.');
  select * into v_acc from public.cb_accounts where id = p_account for update;
  perform private.require(v_acc.id is not null, 'Account not found.');
  v_file := private.cb_file_of_account(p_account);
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(exists (select 1 from public.cb_master_lines where line_no = p_line and mappable), 'Choose a GIFI line staff can match to (totals are calculated).');
  v_reviewer := (select auth.uid()) = v_file.reviewer_id;
  perform private.require(not v_acc.needs_reviewer or v_reviewer, 'This account waits for the reviewer''s decision.');
  update public.cb_accounts set line_no = p_line, mapping_source = case when v_reviewer then 'reviewer' else 'preparer' end,
         needs_reviewer = false, mapped_by = (select auth.uid()), mapped_at = now()
   where id = p_account;
  insert into public.cb_client_mappings (client_id, account_key, line_no, tax_code, decided_by)
  values (v_file.client_id, v_acc.account_key, p_line, v_acc.tax_code, (select auth.uid()))
  on conflict (client_id, account_key) do update set line_no = excluded.line_no, decided_by = excluded.decided_by, decided_at = now();
end;
$$;

-- Send an account to the reviewer's list (a preparer who is not sure).
create or replace function public.cb_send_to_reviewer(p_account uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  v_file := private.cb_file_of_account(p_account);
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked.');
  update public.cb_accounts set needs_reviewer = true, reviewer_reason = left(btrim(coalesce(p_reason, '')), 300) where id = p_account;
end;
$$;

-- Matching for every account not yet matched: the client's history first; then the app's suggestions
-- ([{"account": uuid, "line": "8810.00" or null, "reason": "..."}]); no clear suggestion goes to the reviewer.
create or replace function public.cb_apply_matching(p_file uuid, p_suggestions jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_hist int := 0;
  v_sugg int := 0;
  v_rev int := 0;
  v jsonb;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook to match accounts.');
  select * into v_file from public.cb_files where id = p_file;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked.');
  with h as (
    update public.cb_accounts a set line_no = m.line_no, tax_code = m.tax_code, mapping_source = 'history', mapped_at = now()
      from public.cb_client_mappings m
     where a.file_id = p_file and a.line_no is null and not a.needs_reviewer and m.client_id = v_file.client_id and m.account_key = a.account_key
    returning 1)
  select count(*) into v_hist from h;
  for v in select * from jsonb_array_elements(coalesce(p_suggestions, '[]')) loop
    if nullif(v ->> 'line', '') is not null and exists (select 1 from public.cb_master_lines where line_no = v ->> 'line' and mappable) then
      update public.cb_accounts set line_no = v ->> 'line', mapping_source = 'suggested', mapped_at = now()
       where id = (v ->> 'account')::uuid and file_id = p_file and line_no is null and not needs_reviewer;
      if found then v_sugg := v_sugg + 1; end if;
    else
      update public.cb_accounts set needs_reviewer = true, reviewer_reason = left(coalesce(v ->> 'reason', 'No clear match'), 300)
       where id = (v ->> 'account')::uuid and file_id = p_file and line_no is null and not needs_reviewer;
      if found then v_rev := v_rev + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('history', v_hist, 'suggested', v_sugg, 'reviewer', v_rev);
end;
$$;

-- Tax code for one account: the file's reviewer only. Empty means the line's default.
create or replace function public.cb_set_tax_code(p_account uuid, p_code text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_acc public.cb_accounts;
begin
  v_file := private.cb_file_of_account(p_account);
  perform private.require(v_file.id is not null, 'Account not found.');
  perform private.require((select auth.uid()) = v_file.reviewer_id and private.can_edit('closebook'), 'Only the file''s reviewer changes a tax code.');
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(p_code is null or exists (select 1 from public.cb_tax_codes where code = p_code), 'Unknown tax code.');
  update public.cb_accounts set tax_code = p_code where id = p_account returning * into v_acc;
  if v_acc.line_no is not null then
    insert into public.cb_client_mappings (client_id, account_key, line_no, tax_code, decided_by)
    values (v_file.client_id, v_acc.account_key, v_acc.line_no, p_code, (select auth.uid()))
    on conflict (client_id, account_key) do update set tax_code = excluded.tax_code, decided_by = excluded.decided_by, decided_at = now();
  end if;
end;
$$;

-- A new entry (full files). Lines: [{"account": uuid} or {"line": "8860.00"}, "amount": 123.45, "memo": ""].
-- A line given by GIFI line uses (or adds) an account for that line.
create or replace function public.cb_add_entry(p_file uuid, p_kind text, p_reason text, p_note text, p_reverse boolean, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_id uuid;
  v_n int;
  v jsonb;
  v_acc uuid;
  v_line text;
  v_sum numeric := 0;
  v_income numeric := 0;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook to add entries.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(v_file.file_type = 'full', 'Monthly files: entries are made in QuickBooks.');
  perform private.require(p_kind in ('AJE', 'RJE', 'TJE'), 'Unknown entry type.');
  perform private.require(jsonb_typeof(p_lines) = 'array' and jsonb_array_length(p_lines) >= 2, 'An entry needs at least two lines.');
  insert into public.cb_entries (file_id, kind, number, reason, note, reverse_next_year, created_by)
  values (p_file, p_kind, coalesce((select max(number) from public.cb_entries where file_id = p_file and kind = p_kind), 0) + 1,
          p_reason, btrim(coalesce(p_note, '')), coalesce(p_reverse, false), (select auth.uid()))
  returning id, number into v_id, v_n;
  for v in select * from jsonb_array_elements(p_lines) loop
    perform private.require(round((v ->> 'amount')::numeric, 2) <> 0, 'Every line needs an amount.');
    if v ? 'account' and nullif(v ->> 'account', '') is not null then
      select a.id, a.line_no into v_acc, v_line from public.cb_accounts a where a.id = (v ->> 'account')::uuid and a.file_id = p_file;
      perform private.require(v_acc is not null, 'An account is not in this file.');
      perform private.require(v_line is not null, 'Match every account in the entry to a GIFI line first.');
    else
      v_line := v ->> 'line';
      perform private.require(exists (select 1 from public.cb_master_lines where line_no = v_line and mappable), 'Entries cannot post to a total line.');
      insert into public.cb_accounts (file_id, account_key, number, name, line_no, mapping_source, mapped_by, mapped_at)
      select p_file, 'line:' || v_line, '', m.name, v_line, 'preparer', (select auth.uid()), now() from public.cb_master_lines m where m.line_no = v_line
      on conflict (file_id, account_key) do nothing;
      select id into v_acc from public.cb_accounts where file_id = p_file and account_key = 'line:' || v_line;
    end if;
    insert into public.cb_entry_lines (entry_id, account_id, amount, memo) values (v_id, v_acc, round((v ->> 'amount')::numeric, 2), left(coalesce(v ->> 'memo', ''), 200));
    v_sum := v_sum + round((v ->> 'amount')::numeric, 2);
    if (select line_type from public.cb_master_lines where line_no = v_line) in ('Revenue', 'Expense') then v_income := v_income + round((v ->> 'amount')::numeric, 2); end if;
  end loop;
  perform private.require(v_sum = 0, format('The entry does not balance: it is out by %s.', v_sum));
  perform private.require(p_kind <> 'RJE' or v_income = 0, 'A reclassifying entry (RJE) cannot change the result. Use an AJE.');
  -- Every entry made here is a free entry, so it goes to the reviewer (needs_review defaults to true).
  -- Standard entries (Settings, Closebook) will skip review when under the entry threshold.
  update public.cb_files set updated_at = now() where id = p_file;
  return v_id;
end;
$$;

-- The reviewer approves an entry; the person who made it can delete it until then.
create or replace function public.cb_review_entry(p_entry uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files;
begin
  select f.* into v_file from public.cb_files f join public.cb_entries e on e.file_id = f.id where e.id = p_entry;
  perform private.require(v_file.id is not null, 'Entry not found.');
  perform private.require((select auth.uid()) = v_file.reviewer_id and private.can_edit('closebook'), 'Only the file''s reviewer approves entries.');
  update public.cb_entries set reviewed_by = (select auth.uid()), reviewed_at = now() where id = p_entry and reviewed_at is null;
end;
$$;

create or replace function public.cb_delete_entry(p_entry uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_e public.cb_entries;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_e from public.cb_entries where id = p_entry;
  perform private.require(v_e.id is not null, 'Entry not found.');
  perform private.require(v_e.reviewed_at is null, 'An approved entry cannot be deleted. Add a correcting entry instead.');
  perform private.require((select phase from public.cb_files where id = v_e.file_id) <> 'locked', 'This file is locked.');
  delete from public.cb_entries where id = p_entry;
end;
$$;

alter table public.cb_client_mappings enable row level security;
alter table public.cb_client_mappings force row level security;
alter table public.cb_entries enable row level security;
alter table public.cb_entries force row level security;
alter table public.cb_entry_lines enable row level security;
alter table public.cb_entry_lines force row level security;
create policy "Closebook viewers read client mappings" on public.cb_client_mappings for select to authenticated using ((select private.can_view('closebook')));
create policy "Closebook viewers read entries" on public.cb_entries for select to authenticated using ((select private.can_view('closebook')));
create policy "Closebook viewers read entry lines" on public.cb_entry_lines for select to authenticated using ((select private.can_view('closebook')));
grant select on public.cb_client_mappings, public.cb_entries, public.cb_entry_lines to authenticated;

revoke all on function public.cb_map_account(uuid, text), public.cb_send_to_reviewer(uuid, text), public.cb_apply_matching(uuid, jsonb),
  public.cb_set_tax_code(uuid, text), public.cb_add_entry(uuid, text, text, text, boolean, jsonb), public.cb_review_entry(uuid), public.cb_delete_entry(uuid) from public, anon;
grant execute on function public.cb_map_account(uuid, text), public.cb_send_to_reviewer(uuid, text), public.cb_apply_matching(uuid, jsonb),
  public.cb_set_tax_code(uuid, text), public.cb_add_entry(uuid, text, text, text, boolean, jsonb), public.cb_review_entry(uuid), public.cb_delete_entry(uuid) to authenticated;
revoke all on function private.cb_file_of_account(uuid) from public, anon, authenticated;

-- Re-importing a trial balance keeps accounts that entries use, even when the new import has no balance for them.
create or replace function private.cb_prune_accounts(p_file uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.cb_accounts a where a.file_id = p_file and a.this_year = 0 and a.last_year = 0
    and not exists (select 1 from public.cb_entry_lines l where l.account_id = a.id)
$$;
revoke all on function private.cb_prune_accounts(uuid) from public, anon, authenticated;

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
    insert into public.cb_accounts (file_id, account_key, number, name, this_year, last_year)
    values (p_file, v_key, btrim(coalesce(v_row ->> 'number', '')), btrim(v_row ->> 'name'),
            case when p_target = 'this_year' then v_amt else 0 end, case when p_target = 'last_year' then v_amt else 0 end)
    on conflict (file_id, account_key) do update
      set name = excluded.name,
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
