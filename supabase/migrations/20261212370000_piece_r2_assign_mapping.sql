-- Piece R2 (Hashim, Nov 19, 2026, version 4; mock O; decisions D1 to D18 in docs/BRIEF.md): trial balance files assign each
-- client account to a master account (the standard chart) in step 4 "Assign mapping"; the group follows the master account;
-- step 8's "Match accounts to GIFI" and the override work on these files as on bank-statement files; trial balance files take
-- Closebook entries (the monthly guard goes). No data move: the Live count found no trial balance files (Hashim, Nov 19).
-- Nothing is dropped. Bank-statement files: no change.
set check_function_bodies = off;

-- 1. Two master accounts (Hashim approved, Nov 19, 2026), as in the chart file. Chart order is number order.
insert into public.cb_chart_accounts (number, name, account_type, line_no, tax_default, note, sort_order) values
  ('12250', 'GST/HST receivable', 'Asset', '1066.00', 'None', 'GST/HST refund owing to the business (a debit balance on the return)', 0),
  ('12900', 'Other current assets', 'Asset', '1480.00', 'None', '', 0)
on conflict (number) do update set name = excluded.name, account_type = excluded.account_type, line_no = excluded.line_no,
  tax_default = excluded.tax_default, note = excluded.note;
update public.cb_chart_accounts c set sort_order = x.n
  from (select number, (row_number() over (order by number))::int n from public.cb_chart_accounts) x
 where x.number = c.number and c.sort_order is distinct from x.n;

-- 2. Columns.
alter table public.cb_accounts add column if not exists chart_account text references public.cb_chart_accounts (number);
alter table public.cb_accounts add column if not exists qbo_detail_type text;          -- from the QuickBooks Account List (D11)
alter table public.cb_accounts add column if not exists parent_key text;               -- QuickBooks Parent:Sub (D10)
alter table public.cb_accounts add column if not exists full_name text;                -- "6000 Marketing:6000.01 Search", as QuickBooks writes it
alter table public.cb_accounts add column if not exists in_list boolean not null default false;   -- from the Account List only (D9)
alter table public.cb_accounts add column if not exists assign_source text;            -- last_year, type, name, manual
alter table public.cb_accounts add column if not exists line_move_ok text;             -- the reviewer kept a line that changed from last year
do $$ begin
  alter table public.cb_accounts add constraint cb_accounts_assign_source_check check (assign_source is null or assign_source in ('last_year', 'type', 'name', 'manual'));
exception when duplicate_object then null; end $$;
create index if not exists cb_accounts_chart_idx on public.cb_accounts (file_id, chart_account);

alter table public.cb_client_mappings add column if not exists chart_account text references public.cb_chart_accounts (number);
alter table public.cb_client_mappings add column if not exists name text;
alter table public.cb_client_mappings alter column line_no drop not null;               -- 10900 Clearing has no line

alter table public.cb_entries add column if not exists booked_at timestamptz;           -- "Booked in QuickBooks" (D12c)
alter table public.cb_entries add column if not exists booked_by uuid references public.staff (id);

-- One row per step 4 action, for Undo (D17) and History.
create table if not exists public.cb_assign_actions (
  id         uuid primary key default gen_random_uuid(),
  file_id    uuid not null references public.cb_files (id) on delete cascade,
  label      text not null,
  items      jsonb not null,                  -- [{account, before, after}]
  done_by    uuid,
  done_at    timestamptz not null default now(),
  undone_at  timestamptz
);
create index if not exists cb_assign_actions_file_idx on public.cb_assign_actions (file_id, done_at desc);
alter table public.cb_assign_actions enable row level security;
drop policy if exists "Closebook viewers read" on public.cb_assign_actions;
create policy "Closebook viewers read" on public.cb_assign_actions for select to authenticated using ((select private.can_view('closebook')));
grant select on public.cb_assign_actions to authenticated;

-- The client account an entry takes when several client accounts sit on one master account (D12b); rolls forward.
create table if not exists public.cb_client_chart_picks (
  client_id     uuid not null references public.clients (id) on delete cascade,
  chart_account text not null references public.cb_chart_accounts (number),
  account_key   text not null,
  picked_by     uuid,
  picked_at     timestamptz not null default now(),
  primary key (client_id, chart_account)
);
alter table public.cb_client_chart_picks enable row level security;
drop policy if exists "Closebook viewers read" on public.cb_client_chart_picks;
create policy "Closebook viewers read" on public.cb_client_chart_picks for select to authenticated using ((select private.can_view('closebook')));
grant select on public.cb_client_chart_picks to authenticated;

-- 3. Helpers.
create or replace function private.cb_is_tb(p_file uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select books not in ('statements', 'paper') from public.cb_files where id = p_file), false)
$$;

-- Clearing: the bank-file account 10900, or a client account assigned to 10900 (D2).
create or replace function private.cb_clearing(p_key text, p_chart text) returns boolean language sql immutable as $$
  select coalesce(p_key = 'chart:10900', false) or coalesce(p_chart = '10900', false)
$$;

-- QuickBooks Opening Balance Equity: assigned to 10900 with QuickBooks type Equity, else by its name (Hashim, Nov 19).
create or replace function private.cb_obe(a public.cb_accounts) returns boolean language sql stable as $$
  select coalesce(a.chart_account = '10900', false) and (coalesce(a.tb_type, '') ilike 'equity'
    or lower(regexp_replace(btrim(a.name), '\s+', ' ', 'g')) = 'opening balance equity')
$$;

-- The master account for a line written directly (cb_map_account, an old function no screen uses on these files):
-- exactly one master account on the line; on 1002 and 8000 (same tax treatment) the first in chart order (D3).
create or replace function private.cb_chart_for_line(p_line text) returns text language sql stable security definer set search_path = '' as $$
  select case when (select count(*) from public.cb_chart_accounts where line_no = p_line) = 1
                then (select number from public.cb_chart_accounts where line_no = p_line)
              when p_line in ('1002.00', '8000.00')
                then (select number from public.cb_chart_accounts where line_no = p_line order by sort_order limit 1) end
$$;

-- Step 4 signed (prepared or reviewed): no mapping change until the sign-off is taken back (D7).
create or replace function private.cb_step4_signed(p_file uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.cb_step_signoffs where file_id = p_file and step = 'code' and (prepared_at is not null or reviewed_at is not null))
$$;

-- Last year's line for a trial balance account: the same account in the client's file just before (step 8's "Line changed").
create or replace function private.cb_prior_line(p_file uuid, p_key text) returns text language sql stable security definer set search_path = '' as $$
  select a.line_no from public.cb_files f
    join public.cb_files pf on pf.client_id = f.client_id and pf.year_end < f.year_start
    join public.cb_accounts a on a.file_id = pf.id and a.account_key = p_key
   where f.id = p_file order by pf.year_end desc limit 1
$$;

-- An account that counts for step 4 (D9): a balance this year or last year, or an entry.
create or replace function private.cb_assign_counted(a public.cb_accounts) returns boolean language sql stable security definer set search_path = '' as $$
  select a.account_key not in ('opening', 'uncoded') and (a.this_year <> 0 or a.last_year <> 0
    or exists (select 1 from public.cb_entry_lines l where l.account_id = a.id))
$$;

-- 4. Trial balance files: the group follows the master account (D6). A line written directly finds its master account;
-- a line with none is refused. On insert, an account given a line finds its master account where it can.
create or replace function private.cb_chart_sync() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_line text; v_c text; v_prev text;
begin
  if not private.cb_is_tb(new.file_id) then return new; end if;
  if new.account_key in ('opening', 'uncoded') or new.account_key like 'line:%' or new.account_key like 'gifi:%' then return new; end if;
  if tg_op = 'UPDATE' and new.chart_account is distinct from old.chart_account then
    v_line := case when new.chart_account is null then null else (select line_no from public.cb_chart_accounts where number = new.chart_account) end;
    new.line_no := v_line;
    if new.chart_account is null then new.gifi_override := null; new.line_move_ok := null; end if;
    -- R1's override rolls forward on these files when the master account is first set (the year just before only).
    if old.chart_account is null and new.chart_account is not null and new.gifi_override is null and v_line is not null then
      select a.gifi_override into v_prev from public.cb_files f
        join public.cb_files pf on pf.client_id = f.client_id and pf.year_end = f.year_start - 1
        join public.cb_accounts a on a.file_id = pf.id and a.account_key = new.account_key
       where f.id = new.file_id limit 1;
      if v_prev is not null and v_prev <> v_line and not private.cb_re_line(v_prev) and not private.cb_re_line(v_line)
         and exists (select 1 from public.cb_master_lines o join public.cb_master_lines g on g.line_no = v_line
                      where o.line_no = v_prev and o.mappable and not o.locked and o.line_type = g.line_type) then
        new.gifi_override := v_prev;
        perform private.cb_log_event(new.file_id, 'gifi_override', 't2', format('%s: GIFI %s carried from last year', btrim(coalesce(nullif(new.number, '') || ' ', '') || new.name),
          replace(v_prev, '.00', '')), null, null, btrim(coalesce(nullif(new.number, '') || ' ', '') || new.name), 'Carried from last year', 'GIFI ' || replace(v_line, '.00', ''), 'GIFI ' || replace(v_prev, '.00', ''));
      end if;
    end if;
  elsif tg_op = 'UPDATE' and new.line_no is distinct from old.line_no then
    if new.line_no is null then
      new.chart_account := null;
    else
      v_c := private.cb_chart_for_line(new.line_no);
      perform private.require(v_c is not null, 'On a trial balance file the group follows the master account: assign a master account in step 4.');
      new.chart_account := v_c;
    end if;
  elsif tg_op = 'INSERT' then
    if new.chart_account is not null then
      new.line_no := (select line_no from public.cb_chart_accounts where number = new.chart_account);
    elsif new.line_no is not null then
      new.chart_account := private.cb_chart_for_line(new.line_no);
    end if;
  end if;
  return new;
end;
$$;

-- A new master account on the same line clears step 4 only (D7). A line change goes through cb_changed as before.
create or replace function private.cb_assign_changed() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.line_no is distinct from old.line_no then return null; end if;
  -- Step 4 only: nothing that rests on it moves (cb_clear_step would also clear steps 6 to 8).
  if exists (select 1 from public.cb_step_signoffs where file_id = new.file_id and step = 'code') then
    delete from public.cb_step_signoffs where file_id = new.file_id and step = 'code';
    perform private.cb_log(new.file_id, 'signoff_cleared', 'code', format('%s: master account %s to %s', btrim(coalesce(nullif(new.number, '') || ' ', '') || new.name),
      coalesce(old.chart_account, 'none'), coalesce(new.chart_account, 'none')));
  end if;
  return null;
end;
$$;

-- 5. Step 4: assign, unassign, accept, unassign all, undo. One database call per action (Undo included).
-- p_items: [{account, chart}] (chart null to unassign). p_source: last_year, type, name or manual.
create or replace function public.cb_assign(p_file uuid, p_items jsonb, p_label text, p_source text default 'manual') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files; v jsonb; a public.cb_accounts; v_chart public.cb_chart_accounts; v_items jsonb := '[]'::jsonb; v_id uuid; v_n int := 0;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook to assign accounts.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null, 'File not found.');
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(v_file.books not in ('statements', 'paper'), 'Bank-statement files use the master chart already.');
  perform private.require(not private.cb_step4_signed(p_file), 'Step 4 is signed. Take back the sign-off first.');
  perform private.require(jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) between 1 and 5000, 'Choose at least one account.');
  perform private.require(coalesce(p_source, 'manual') in ('last_year', 'type', 'name', 'manual'), 'Unknown source.');
  perform private.require(length(btrim(coalesce(p_label, ''))) between 3 and 300, 'Name the action.');
  for v in select * from jsonb_array_elements(p_items) loop
    select * into a from public.cb_accounts where id = (v ->> 'account')::uuid and file_id = p_file for update;
    perform private.require(a.id is not null, 'An account is not in this file.');
    perform private.require(a.account_key not in ('opening', 'uncoded'), 'This row takes no master account.');
    perform private.require(not a.client_new or nullif(v ->> 'chart', '') is not null, 'This row cannot be unassigned.');
    if nullif(v ->> 'chart', '') is not null then
      select * into v_chart from public.cb_chart_accounts where number = v ->> 'chart';
      perform private.require(v_chart.number is not null, 'Choose a master account.');
    end if;
    if a.chart_account is not distinct from nullif(v ->> 'chart', '') then continue; end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object('account', a.id, 'before', a.chart_account, 'after', nullif(v ->> 'chart', ''),
      'before_source', a.assign_source));
    update public.cb_accounts set chart_account = nullif(v ->> 'chart', ''), line_no = v_chart.line_no,
           assign_source = case when nullif(v ->> 'chart', '') is null then null else coalesce(p_source, 'manual') end,
           mapping_source = case when nullif(v ->> 'chart', '') is null then null else 'preparer' end,
           needs_reviewer = false, mapped_by = (select auth.uid()), mapped_at = now()
     where id = a.id;
    if nullif(v ->> 'chart', '') is not null then
      insert into public.cb_client_mappings (client_id, account_key, line_no, chart_account, name, tax_code, decided_by)
      values (v_file.client_id, a.account_key, v_chart.line_no, v_chart.number, a.name, a.tax_code, (select auth.uid()))
      on conflict (client_id, account_key) do update set line_no = excluded.line_no, chart_account = excluded.chart_account, name = excluded.name,
        decided_by = excluded.decided_by, decided_at = now();
    end if;
    v_chart := null;
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then return jsonb_build_object('action', null, 'n', 0); end if;
  insert into public.cb_assign_actions (file_id, label, items, done_by) values (p_file, left(btrim(p_label), 300), v_items, (select auth.uid())) returning id into v_id;
  perform private.cb_log_event(p_file, 'assign', 'code', left(btrim(p_label), 300), null, null, null, null, null, null, null);
  update public.cb_files set updated_at = now() where id = p_file;
  return jsonb_build_object('action', v_id, 'n', v_n);
end;
$$;

create or replace function public.cb_unassign_all(p_file uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_items jsonb; v_n int;
begin
  select coalesce(jsonb_agg(jsonb_build_object('account', id, 'chart', null)), '[]'::jsonb), count(*) into v_items, v_n
    from public.cb_accounts where file_id = p_file and chart_account is not null and not client_new and account_key not in ('opening', 'uncoded');
  perform private.require(v_n > 0, 'No account is assigned.');
  return public.cb_assign(p_file, v_items, format('Unassigned all %s accounts', v_n), 'manual');
end;
$$;

-- Undo reverses one action in one call; refused, naming the accounts, when any changed since (D17).
create or replace function public.cb_undo_assign(p_action uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.cb_assign_actions; v_file public.cb_files; v jsonb; v_names text; v_chart text;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook to assign accounts.');
  select * into r from public.cb_assign_actions where id = p_action;
  perform private.require(r.id is not null, 'Nothing to undo.');
  select * into v_file from public.cb_files where id = r.file_id for update;
  select * into r from public.cb_assign_actions where id = p_action for update;
  perform private.require(r.undone_at is null, 'This action is already undone.');
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(not private.cb_step4_signed(r.file_id), 'Step 4 is signed. Take back the sign-off first.');
  select string_agg(btrim(coalesce(nullif(a.number, '') || ' ', '') || a.name), ', ' order by a.number, a.name) into v_names
    from jsonb_array_elements(r.items) i join public.cb_accounts a on a.id = (i ->> 'account')::uuid
   where a.chart_account is distinct from nullif(i ->> 'after', '');
  perform private.require(v_names is null, format('Cannot undo: changed since by another action: %s.', v_names));
  for v in select * from jsonb_array_elements(r.items) loop
    v_chart := nullif(v ->> 'before', '');
    update public.cb_accounts set chart_account = v_chart, line_no = (select line_no from public.cb_chart_accounts where number = v_chart),
           assign_source = nullif(v ->> 'before_source', ''), mapping_source = case when v_chart is null then null else 'preparer' end,
           mapped_by = (select auth.uid()), mapped_at = now()
     where id = (v ->> 'account')::uuid;
    if v_chart is not null then
      update public.cb_client_mappings m set chart_account = v_chart, line_no = (select line_no from public.cb_chart_accounts where number = v_chart), decided_at = now()
        from public.cb_accounts a where a.id = (v ->> 'account')::uuid and m.client_id = v_file.client_id and m.account_key = a.account_key;
    end if;
  end loop;
  update public.cb_assign_actions set undone_at = now() where id = r.id;
  perform private.cb_log_event(r.file_id, 'assign', 'code', 'Undo: ' || r.label, null, null, null, null, null, null, null);
  return jsonb_build_object('undone', r.id);
end;
$$;

-- The client account an entry takes when several sit on one master account (D12b).
create or replace function public.cb_pick_chart_account(p_file uuid, p_chart text, p_account uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files; a public.cb_accounts;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(v_file.books not in ('statements', 'paper'), 'Only trial balance files pick a client account.');
  select * into a from public.cb_accounts where id = p_account and file_id = p_file;
  perform private.require(a.id is not null and a.chart_account = p_chart, 'Choose a client account on that master account.');
  perform private.require(not exists (select 1 from public.cb_accounts c where c.file_id = p_file and c.parent_key = a.account_key),
    'Choose a sub-account, not its parent.');
  insert into public.cb_client_chart_picks (client_id, chart_account, account_key, picked_by) values (v_file.client_id, p_chart, a.account_key, (select auth.uid()))
  on conflict (client_id, chart_account) do update set account_key = excluded.account_key, picked_by = excluded.picked_by, picked_at = now();
  perform private.cb_log_event(p_file, 'assign', 'entries', format('Entries to master account %s go to %s', p_chart, btrim(coalesce(nullif(a.number, '') || ' ', '') || a.name)),
    null, null, null, null, null, null, null);
end;
$$;

-- "Booked in QuickBooks" (D12c): a re-import of the trial balance is refused while any entry is marked.
create or replace function public.cb_mark_booked(p_entry uuid, p_booked boolean) returns void language plpgsql security definer set search_path = '' as $$
declare e public.cb_entries; v_file public.cb_files;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into e from public.cb_entries where id = p_entry;
  perform private.require(e.id is not null, 'Entry not found.');
  select * into v_file from public.cb_files where id = e.file_id for update;
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(v_file.books not in ('statements', 'paper'), 'Only trial balance files book entries in the client''s books.');
  -- Nothing goes to the client before review: only a reviewed entry is marked booked.
  perform private.require(not p_booked or e.reviewed_at is not null or not e.needs_review, 'Only a reviewed entry can be marked Booked in QuickBooks.');
  perform set_config('cb.booked_mark', 'on', true);
  update public.cb_entries set booked_at = case when p_booked then now() end, booked_by = case when p_booked then (select auth.uid()) end where id = p_entry;
  perform set_config('cb.booked_mark', 'off', true);
  perform private.cb_log_event(e.file_id, 'entry_booked', 'entries', format('%s %s %s', e.kind, e.number, case when p_booked then 'marked Booked in QuickBooks' else 'no longer marked Booked in QuickBooks' end),
    null, null, null, null, null, null, null);
end;
$$;

-- A booked entry does not change until it is unmarked: its lines are already in the client's books.
create or replace function private.cb_booked_guard() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_entry uuid; v_booked timestamptz;
begin
  if tg_table_name = 'cb_entries' then
    if coalesce(current_setting('cb.booked_mark', true), '') = 'on' then return case when tg_op = 'DELETE' then old else new end; end if;
    v_booked := old.booked_at;
  else
    v_entry := case when tg_op = 'DELETE' then old.entry_id else new.entry_id end;
    select booked_at into v_booked from public.cb_entries where id = v_entry;
  end if;
  perform private.require(v_booked is null, 'This entry is marked Booked in QuickBooks. Unmark it first.');
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- The reviewer keeps a line that changed from last year (step 8's box, "Line changed from last year").
create or replace function public.cb_keep_line_move(p_account uuid) returns void language plpgsql security definer set search_path = '' as $$
declare a public.cb_accounts; v_file public.cb_files; v_label text;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = (select file_id from public.cb_accounts where id = p_account) for update;
  select * into a from public.cb_accounts where id = p_account for update;
  perform private.require(a.id is not null, 'Account not found.');
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(private.cb_is_reviewer(v_file), 'The reviewer decides.');
  v_label := btrim(coalesce(nullif(a.number, '') || ' ', '') || a.name);
  update public.cb_accounts set line_move_ok = a.line_no where id = a.id;
  perform private.cb_log_event(a.file_id, 'account_reviewed', 't2', format('%s: line changed from last year, kept', v_label), null, null, v_label,
    'GIFI ' || replace(coalesce(a.line_no, ''), '.00', ''), 'Line changed from last year', 'Kept');
end;
$$;

-- Step 4 and step 6 on trial balance files (items 1 and 2; D2, D9).
CREATE OR REPLACE FUNCTION private.cb_step_problems(p_file uuid, p_step text)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_file public.cb_files;
  v_bank boolean;
  v_out text[] := '{}';
  v_n int;
  v_txt text;
  v_set jsonb;
  v_flag_amount numeric; v_flag_percent numeric;
begin
  select * into v_file from public.cb_files where id = p_file;
  v_bank := v_file.books in ('statements', 'paper');
  v_set := coalesce(v_file.setup, '{}'::jsonb);
  if p_step = 'setup' then
    select count(*) into v_n from unnest(array['realtor', 'owner_paid', 'dividends', 'payroll', 'holdco', 'gst_registered']) k where not (v_set ? k);
    if (v_set ->> 'gst_registered') = 'true' then
      v_n := v_n + (case when v_set ? 'gst_frequency' then 0 else 1 end) + (case when v_set ? 'quick_method' then 0 else 1 end);
    end if;
    if v_n > 0 then v_out := v_out || format('%s setup question%s to answer.', v_n, case when v_n = 1 then '' else 's' end); end if;
    -- Round 16: the acceptance and continuance record is signed with step 1.
    v_out := v_out || private.cb_acceptance_problems(p_file);
  elsif p_step = 'opening' then
    if v_bank then
      v_out := v_out || private.cb_opening_problems(p_file);
    elsif not exists (select 1 from public.cb_imports where file_id = p_file and target = 'this_year') then
      v_out := v_out || 'Import the trial balance: last year''s column comes with it.'::text;
    end if;
  elsif p_step = 'records' then
    if v_bank then
      -- Round 22: accounts, coverage, waiting statements, the tie to step 2 and the year edges.
      v_out := v_out || private.cb_records_problems(p_file);
    else
      if not exists (select 1 from public.cb_imports where file_id = p_file and target = 'this_year') then
        v_out := v_out || 'Import the trial balance.'::text;
      elsif (select coalesce(sum(this_year), 0) from public.cb_accounts where file_id = p_file) <> 0 then
        v_out := v_out || 'The trial balance does not balance: import it again.'::text;
      end if;
    end if;
  elsif p_step = 'code' then
    if v_bank then
      -- Round 31: Pending lines (some asked of the client), then the excluded lines until the reviewer ticks them.
      select count(*) into v_n from public.cb_bank_lines l where l.file_id = p_file and private.cb_line_pending(l);
      if v_n > 0 then v_out := v_out || format('%s line%s pending.', v_n, case when v_n = 1 then '' else 's' end); end if;
      select count(*) into v_n from public.cb_bank_lines l where l.file_id = p_file and l.status = 'excluded';
      if v_n > 0 and (select excluded_reviewed_key from public.cb_files where id = p_file) is distinct from private.cb_excluded_key(p_file) then
        v_out := v_out || format('Excluded: %s line%s · %s. The reviewer ticks "Excluded lines reviewed".', v_n, case when v_n = 1 then '' else 's' end,
          private.cb_money((select sum(abs(amount)) from public.cb_bank_lines where file_id = p_file and status = 'excluded')));
      end if;
      v_out := v_out || private.cb_code_tie_problems(p_file);
    else
      -- Piece R2: every account with a balance this year or last year, or an entry, assigned to a master account (D9).
      select count(*) into v_n from public.cb_accounts a where a.file_id = p_file and a.chart_account is null
         and (a.line_no is null or not a.client_new) and private.cb_assign_counted(a);
      if v_n > 0 then v_out := v_out || format('%s account%s with a balance to assign to a master account.', v_n, case when v_n = 1 then '' else 's' end); end if;
    end if;
  elsif p_step = 'entries' then
    -- Piece 10: the flagged changes are explained in step 6 now.
    -- Round 9: the revenue check, and expenses paid personally when the setup says so.
    v_out := v_out || private.cb_step5_problems(p_file);
  elsif p_step = 'compare' then
    -- Piece 10, step 6 "Compare to last year". a) Every flagged change explained (moved from step 5; the rule is unchanged).
    select flag_amount, flag_percent into v_flag_amount, v_flag_percent from public.cb_settings limit 1;
    v_flag_amount := coalesce(v_flag_amount, 5000); v_flag_percent := coalesce(v_flag_percent, 20);
    select count(*) into v_n from (
      select a.id, private.cb_account_final(a.id) - coalesce((select sum(l.amount) from public.cb_entry_lines l join public.cb_entries e on e.id = l.entry_id
           where l.account_id = a.id and e.kind = 'TJE'), 0) fin, a.last_year from public.cb_accounts a join public.cb_master_lines m on m.line_no = a.line_no
       where a.file_id = p_file and m.lead_sheet is not null and left(coalesce(a.line_no, ''), 4) not in ('3600', '3660')
         and coalesce(a.tax_code, m.default_tax_code, '') not in ('INCTAX', 'AMORT')) x   -- piece 6
     where abs(fin - last_year) > v_flag_amount and (last_year = 0 or abs(fin - last_year) / abs(last_year) * 100 > v_flag_percent)
       and not exists (select 1 from public.cb_flag_notes n where n.account_id = x.id);
    if v_n > 0 then v_out := v_out || format('%s flagged change%s to explain in Flagged changes.', v_n, case when v_n = 1 then '' else 's' end); end if;
    -- Every used account in a group, and Clearing at zero (moved from the old step 6).
    select count(*) into v_n from public.cb_accounts a where a.file_id = p_file and a.line_no is null and not a.needs_reviewer
       and a.account_key not in ('opening', 'uncoded') and not private.cb_clearing(a.account_key, a.chart_account) and private.cb_account_used(a.id);
    if v_n > 0 then v_out := v_out || format('%s account%s with no group: %s.', v_n, case when v_n = 1 then '' else 's' end,
      case when v_bank then 'choose a group' else 'assign a master account in step 4' end); end if;
    if exists (select 1 from public.cb_accounts a where a.file_id = p_file and a.account_key = 'chart:10900' and private.cb_account_final(a.id) <> 0) then
      v_out := v_out || 'Clearing (10900) has a balance: move it to the right account.'::text;
    end if;
    -- Piece R2 (D2, Hashim): client accounts on 10900 Clearing hold step 6 while they have a balance. Opening Balance Equity is
    -- cleared by one RJE to retained earnings; the others by an entry to cash (deposit in transit) or receivables.
    v_out := v_out || coalesce((select array_agg(format('%s (Clearing) has a balance: %s.', btrim(coalesce(nullif(a.number, '') || ' ', '') || a.name),
             case when private.cb_obe(a) then 'clear it to retained earnings with one RJE' else 'clear it with an entry to cash or receivables' end) order by a.number, a.name)
      from public.cb_accounts a where a.file_id = p_file and a.chart_account = '10900' and private.cb_account_final(a.id) <> 0), '{}'::text[]);
    -- b) Every new account confirmed, in the group it has now.
    select count(*) into v_n from private.cb_compare_accounts(p_file) x where x.kind = 'new'
       and not exists (select 1 from public.cb_new_accounts n where n.file_id = p_file and n.account_key = x.account_key and n.confirmed_line is not distinct from x.line_no);
    if v_n > 0 then v_out := v_out || format('%s new account%s to confirm.', v_n, case when v_n = 1 then '' else 's' end); end if;
    -- c) The accounts not used this year seen.
    v_txt := private.cb_unused_key(p_file);
    if v_txt <> '' and not exists (select 1 from public.cb_compare_seen where file_id = p_file and seen_key = v_txt) then
      v_out := v_out || 'Accounts not used this year: tick Seen.'::text;
    end if;
    -- d) Every question answered.
    select 6 - count(*) into v_n from public.cb_year_changes where file_id = p_file;
    if v_n > 0 then v_out := v_out || format('What changed this year: %s question%s to answer.', v_n, case when v_n = 1 then '' else 's' end); end if;
  end if;
  -- A review note not yet fixed is open work on its step.
  select count(*) into v_n from public.cb_review_notes where file_id = p_file and step = p_step and status = 'open';
  if v_n > 0 then v_out := v_out || format('%s review note%s to fix.', v_n, case when v_n = 1 then '' else 's' end); end if;
  return v_out;
end;
$function$;

-- Step 6 leaves Clearing out, on either file type (D2).
CREATE OR REPLACE FUNCTION private.cb_compare_accounts(p_file uuid)
 RETURNS TABLE(kind text, account_id uuid, account_key text, line_no text, last_year numeric, final numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when x.last_year = 0 then 'new' else 'unused' end, x.id, x.account_key, x.line_no, x.last_year, x.fin
    from (select a.id, a.account_key, a.line_no, a.last_year, private.cb_account_final(a.id) fin from public.cb_accounts a
           where a.file_id = p_file and a.account_key not in ('opening', 'uncoded') and not private.cb_clearing(a.account_key, a.chart_account)) x
   where (x.last_year = 0 and x.fin <> 0) or (x.last_year <> 0 and x.fin = 0);
$function$;

-- Step 8's box on every file (item 3); a line changed from last year waits for the reviewer (D6).
CREATE OR REPLACE FUNCTION private.cb_match_items(p_file uuid)
 RETURNS TABLE(account_id uuid, reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  return query select x.id, x.reason from (
    select a.id, a.number, a.name,
      case
        when a.account_key in ('opening', 'uncoded') or private.cb_clearing(a.account_key, a.chart_account) then
          case when private.cb_account_final(a.id) <> 0 then case when a.account_key in ('opening', 'uncoded') then a.account_key else 'clearing' end end
        when a.line_no is null then case when private.cb_account_used(a.id) then 'no_group' end
        when a.needs_reviewer then 'reviewer'
        when not coalesce(m.mappable, false) or coalesce(m.locked, false) then case when private.cb_account_final(a.id) <> 0 then 'locked' end
        when a.mapping_source = 'suggested' then 'suggested'
        when private.cb_flag_open(a.account_type, coalesce(a.gifi_override, a.line_no), a.type_confirm_reason, a.type_confirmed_line) then 'type'
        when f.books not in ('statements', 'paper') and a.gifi_override is null and a.line_move_ok is distinct from a.line_no
             and private.cb_prior_line(a.file_id, a.account_key) <> a.line_no and private.cb_account_final(a.id) <> 0 then 'moved'
        when private.cb_side_open(a.id) then 'side'
      end as reason
    from public.cb_accounts a
    join public.cb_files f on f.id = a.file_id
    left join public.cb_master_lines m on m.line_no = coalesce(a.gifi_override, a.line_no)
    where a.file_id = p_file) x
  where x.reason is not null
  order by x.number, x.name;
end;
$function$;

-- Match accounts to GIFI holds step 8 on every file (item 3).
CREATE OR REPLACE FUNCTION private.cb_match_problems(p_file uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_out text[] := '{}'; v_n int; t jsonb;
begin
  select count(*) into v_n from private.cb_match_items(p_file);
  if v_n > 0 then
    v_out := v_out || format('%s account%s need%s a decision in Match accounts to GIFI.', v_n, case when v_n = 1 then '' else 's' end, case when v_n = 1 then 's' else '' end);
  end if;
  t := private.cb_match_ties(p_file);
  if (t ->> 'ni_chart')::numeric <> (t ->> 'ni_gifi')::numeric then
    v_out := v_out || format('Net income %s · GIFI 9999 %s · Out of balance %s.', private.cb_money((t ->> 'ni_chart')::numeric),
      private.cb_money((t ->> 'ni_gifi')::numeric), private.cb_money((t ->> 'ni_chart')::numeric - (t ->> 'ni_gifi')::numeric));
  end if;
  if (t ->> 'assets_chart')::numeric <> (t ->> 'assets_gifi')::numeric then
    v_out := v_out || format('Total assets %s · GIFI 2599 %s · Out of balance %s.', private.cb_money((t ->> 'assets_chart')::numeric),
      private.cb_money((t ->> 'assets_gifi')::numeric), private.cb_money((t ->> 'assets_chart')::numeric - (t ->> 'assets_gifi')::numeric));
  end if;
  return v_out;
end;
$function$;

-- Step 7's GIFI checks move to step 8 on trial balance files (item 3).
CREATE OR REPLACE FUNCTION private.cb_review_problems(p_file uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_out text[] := '{}';
  v_n int;
  v_names text;
begin
  select string_agg(n.label, ', ' order by n.ord) into v_names from (values
    ('setup', 'step 1', 1), ('opening', 'step 2', 2), ('records', 'step 3', 3), ('code', 'step 4', 4), ('entries', 'step 5', 5), ('compare', 'step 6', 6)) n(step, label, ord)
   where not exists (select 1 from public.cb_step_signoffs s where s.file_id = p_file and s.step = n.step and s.reviewed_at is not null);
  if v_names is not null then v_out := v_out || format('Review %s first.', v_names); end if;
  select count(*) into v_n from public.cb_review_notes where file_id = p_file and status <> 'cleared';
  if v_n > 0 then v_out := v_out || format('%s review note%s still open.', v_n, case when v_n = 1 then '' else 's' end); end if;
  select count(*) into v_n from (select unnest(private.cb_step_waiting(p_file, s)) w from unnest(array['opening', 'code', 'entries']) s) x
   where w not like '%review note%';
  -- Piece 7: the GST/HST returns difference (now in step 8) still waits for the reviewer here, as it did from step 5.
  if coalesce((private.cb_revenue_state(p_file) ->> 'gst_waiting')::boolean, false) then v_n := v_n + 1; end if;
  if v_n > 0 then v_out := v_out || 'Items still wait for the reviewer: see the list above.'::text; end if;
  -- Piece 10: the reviewer's GIFI checks (moved from the old step 6), the new accounts and the "yes" answers of step 6.
  -- Piece R2 (item 3): the reviewer's GIFI checks are in step 8 on every file.
  v_out := v_out || private.cb_compare_review_problems(p_file);
  -- Piece 8: the shareholder loans, answered by the reviewer here.
  return v_out || private.cb_sh_review_problems(p_file);
end;
$function$;

-- The step 8 override works on trial balance files with R1's rules (item 2).
CREATE OR REPLACE FUNCTION public.cb_set_gifi_override(p_account uuid, p_line text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.cb_accounts; v_file public.cb_files; v_line text := nullif(btrim(coalesce(p_line, '')), ''); v_group_type text; v_type text;
  v_label text; v_old text; v_new text;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  -- The file first, then the account, as cb_confirm_type does (security finding 3: one lock order).
  select * into v_file from public.cb_files where id = (select file_id from public.cb_accounts where id = p_account) for update;
  select * into a from public.cb_accounts where id = p_account for update;
  perform private.require(a.id is not null, 'Account not found.');
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(a.account_key not in ('opening', 'uncoded') and not private.cb_clearing(a.account_key, a.chart_account),
    'Clearing and the system rows take no GIFI line. Clear the balance with an entry or in the step that made it.');
  perform private.require(a.line_no is not null, case when v_file.books in ('statements', 'paper') then 'Choose a group for the account first.' else 'Assign a master account in step 4 first.' end);
  perform private.require(not a.needs_reviewer or private.cb_is_reviewer(v_file), 'This account waits for the reviewer''s decision.');
  if v_line = a.line_no then v_line := null; end if;
  if v_line is not null then
    perform private.require(exists (select 1 from public.cb_master_lines where line_no = v_line and mappable), 'Choose a GIFI line staff can match to (totals are calculated).');
    perform private.require(not private.cb_line_locked(v_line), 'This line is locked because it has sub-lines. Choose one of its sub-lines.');
    select line_type into v_group_type from public.cb_master_lines where line_no = a.line_no;
    select line_type into v_type from public.cb_master_lines where line_no = v_line;
    perform private.require(v_type = v_group_type,
      format('This is a GIFI line for %s. The account''s group is for %s: choose a line of the same type.', lower(v_type), lower(v_group_type)));
    -- Retained earnings, dividends and prior period adjustments (3600 to 3849) move only through entries.
    perform private.require(not private.cb_re_line(v_line) and not private.cb_re_line(a.line_no),
      'Retained earnings, dividends and prior period adjustments (3600 to 3849) take no override. Use an entry.');
  end if;
  v_label := btrim(coalesce(nullif(a.number, '') || ' ', '') || a.name);
  if a.mapping_source = 'suggested' then
    update public.cb_accounts set mapping_source = case when private.cb_is_reviewer(v_file) then 'reviewer' else 'preparer' end, mapped_by = (select auth.uid()), mapped_at = now() where id = a.id;
  end if;
  if a.needs_reviewer and private.cb_is_reviewer(v_file) then
    update public.cb_accounts set needs_reviewer = false, review_note = format('Decided in step 8: GIFI %s', replace(coalesce(v_line, a.line_no), '.00', '')),
           review_by = (select auth.uid()), review_at = now(), review_cents = round(this_year * 100) where id = a.id;
    perform private.cb_log_event(a.file_id, 'account_reviewed', 't2', 'Account decided in step 8', null, null, v_label,
      format('GIFI %s', replace(coalesce(v_line, a.line_no), '.00', '')), a.reviewer_reason, 'Reviewed');
  end if;
  if v_line is not distinct from a.gifi_override then return; end if;
  update public.cb_accounts set gifi_override = v_line where id = a.id;
  v_old := replace(coalesce(a.gifi_override, a.line_no), '.00', '');
  v_new := replace(coalesce(v_line, a.line_no), '.00', '');
  perform private.cb_log_event(a.file_id, 'gifi_override', 't2', format('%s: GIFI %s to %s', v_label, v_old, v_new), null, null, v_label, null, 'GIFI ' || v_old, 'GIFI ' || v_new);
  perform private.cb_clear_step(a.file_id, 't2', format('%s: GIFI %s to %s', v_label, v_old, v_new));
  update public.cb_files set updated_at = now() where id = a.file_id;
end;
$function$;

-- What a mapping change clears on trial balance files (D7); marking an entry booked clears nothing.
CREATE OR REPLACE FUNCTION private.cb_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_file uuid;
  v_step text := tg_argv[0];
  v_why text := tg_argv[1];
  v_bank boolean;
  v_row record;
  v_txt text;
  v_verb text := case tg_op when 'INSERT' then 'added' when 'DELETE' then 'removed' else 'changed' end;
  v_tje boolean := false;   -- piece 6
  v_moved boolean := false;   -- piece 10b
begin
  if tg_table_name = 'cb_bank_lines' and coalesce(current_setting('cb.review', true), '') = 'on' then return null; end if;   -- round 35
  if tg_table_name = 'cb_entries' and coalesce(current_setting('cb.booked_mark', true), '') = 'on' then return null; end if;   -- piece R2
  v_row := case when tg_op = 'DELETE' then old else new end;
  if tg_table_name = 'cb_entry_lines' then
    select e.file_id, format('Entry %s-%s lines %s', to_char(f.year_end, 'YYYY'), lpad(e.seq::text, 3, '0'), v_verb), e.kind = 'TJE' into v_file, v_txt, v_tje
      from public.cb_entries e join public.cb_files f on f.id = e.file_id where e.id = v_row.entry_id;
  elsif tg_table_name = 'cb_files' then
    v_file := v_row.id;
    if v_step = 'setup' then v_txt := private.cb_setup_diff(old.setup, new.setup); end if;
  else
    v_file := v_row.file_id;
  end if;
  if v_file is null then return null; end if;

  if tg_table_name = 'cb_bank_lines' and tg_op = 'UPDATE' then
    -- The reviewer's decision on a line sent to the reviewer: the preparer's sign-off stays.
    if old.status = 'reviewer' and private.is_owner() then return null; end if;
    v_txt := format('%s %s: %s', to_char(new.txn_date, 'Mon FMDD'), left(new.description, 40),
      concat_ws(', ',
        case when old.chart_account is distinct from new.chart_account then format('account %s to %s', coalesce(old.chart_account, 'none'), coalesce(new.chart_account, 'none')) end,
        case when old.acct_date is distinct from new.acct_date then format('date %s to %s', to_char(old.acct_date, 'Mon FMDD'), to_char(new.acct_date, 'Mon FMDD')) end,
        case when old.tax_code is distinct from new.tax_code then format('tax %s to %s', coalesce(old.tax_code, 'none'), coalesce(new.tax_code, 'none')) end,
        case when old.status is distinct from new.status then format('%s to %s',
          case old.status when 'new' then 'to code' when 'done' then 'coded' when 'ask_client' then 'with the client' when 'matched' then 'matched to a transfer' when 'excluded' then 'excluded' else 'for the reviewer' end,
          case new.status when 'new' then 'to code' when 'done' then 'coded' when 'ask_client' then 'with the client' when 'matched' then 'matched to a transfer' when 'excluded' then 'excluded' else 'for the reviewer' end) end));
  elsif tg_table_name = 'cb_bank_lines' then
    v_txt := format('Statement line %s: %s %s', v_verb, to_char(v_row.txn_date, 'Mon FMDD'), left(v_row.description, 40));
  elsif tg_table_name = 'cb_accounts' then
    -- The reviewer's decision on an account waiting for it, or on a line of another type: the sign-off stays.
    if private.is_owner() and (old.needs_reviewer or private.cb_flag_open(old.account_type, coalesce(old.gifi_override, old.line_no), old.type_confirm_reason, old.type_confirmed_line)) then
      return null;
    end if;
    v_txt := format('%s: %s', btrim(coalesce(nullif(new.number, '') || ' ', '') || new.name),
      concat_ws(', ',
        case when old.line_no is distinct from new.line_no then
          format('%s to %s', coalesce((select name from public.cb_master_lines where line_no = old.line_no), 'no group'), coalesce((select name from public.cb_master_lines where line_no = new.line_no), 'no group')) end,
        case when old.tax_code is distinct from new.tax_code then format('tax code %s to %s', coalesce(old.tax_code, 'the line''s default'), coalesce(new.tax_code, 'the line''s default')) end,
        case when old.type_confirm_reason is distinct from new.type_confirm_reason then 'kept on a line of another type' end));
    select books in ('statements', 'paper') into v_bank from public.cb_files where id = v_file;
    -- Piece R2 (D7): on a trial balance file a group change (a master account on another line) also clears step 4; a tax
    -- code, type or override change clears what it clears on bank files.
    if not v_bank and old.line_no is distinct from new.line_no then perform private.cb_clear_step(v_file, 'code', v_txt); end if;
    -- Piece 10: step 6 no longer chains to step 8, so a GIFI line, tax code or type change clears step 8 here, as before.
    perform private.cb_clear_step(v_file, 't2', v_txt);
  elsif tg_table_name = 'cb_imports' then
    v_step := case v_row.target when 'account_list' then 'compare' when 'last_year' then 'opening' else 'records' end;
    v_txt := format('%s %s (%s)', case v_row.target when 'account_list' then 'QuickBooks Account List' when 'last_year' then 'Last year''s trial balance' else 'Trial balance' end,
      case tg_op when 'INSERT' then 'imported' else 'removed' end, v_row.file_name);
    if v_row.target = 'account_list' then
      perform private.cb_clear_step(v_file, 'code', v_txt);
      perform private.cb_clear_step(v_file, 't2', v_txt);   -- piece 10, as above
    end if;
  elsif tg_table_name = 'cb_bank_statements' then
    select format('Statement %s: %s, %s to %s', v_verb, b.name, to_char(v_row.period_start, 'Mon FMDD, YYYY'), to_char(v_row.period_end, 'Mon FMDD, YYYY')) into v_txt
      from public.cb_bank_accounts b where b.id = v_row.account_id;
  elsif tg_table_name = 'cb_opening_balances' then
    v_txt := format('Last year''s balance sheet: GIFI %s %s', v_row.code, v_verb);
  elsif tg_table_name = 'cb_entries' then
    v_txt := format('Entry %s-%s %s', (select to_char(year_end, 'YYYY') from public.cb_files where id = v_file), lpad(v_row.seq::text, 3, '0'), v_verb);
    -- Piece 6: a TJE added, deleted or changed while it stays a TJE. A change of type to or from TJE is an AJE change.
    v_tje := case when tg_op = 'UPDATE' then old.kind = 'TJE' and new.kind = 'TJE' else v_row.kind = 'TJE' end;
  elsif tg_table_name = 'cb_flag_notes' then
    select format('Lead sheet explanation %s: %s', v_verb, btrim(coalesce(nullif(a.number, '') || ' ', '') || a.name)) into v_txt
      from public.cb_accounts a where a.id = v_row.account_id;
  -- Piece 10: step 6's ticks and answers (step 6), and the reviewer's "Mark reviewed" on them (step 7, by the trigger's step).
  elsif tg_table_name = 'cb_new_accounts' then
    select btrim(coalesce(nullif(a.number, '') || ' ', '') || a.name) into v_txt
      from public.cb_accounts a where a.file_id = v_file and a.account_key = v_row.account_key limit 1;
    v_txt := coalesce(v_txt, v_row.account_key) || case when tg_op = 'INSERT' then ': confirmed as a new account'
      when tg_op = 'DELETE' then ': new account tick removed' when v_step = 'review' then ': review mark changed' else ': confirmed again' end;
  elsif tg_table_name = 'cb_year_changes' then
    v_txt := private.cb_year_question(v_row.question) || case when tg_op = 'DELETE' then ': answer removed' when v_step = 'review' then ': review mark changed' else ': answered' end;
  elsif tg_table_name = 'cb_compare_seen' then
    v_txt := case when tg_op = 'DELETE' then 'Accounts not used this year: Seen removed' else 'Accounts not used this year: Seen ticked' end;
  end if;
  -- Piece 7 (Hashim, Nov 18, 2026): the GST/HST returns figure and its note belong to step 8. A change to them clears step 8,
  -- not step 5. The revenue check itself (step 5) clears step 5 as before.
  -- (Nested: v_row is another table's row on other triggers, so its kind is read only here.)
  if tg_table_name = 'cb_revenue_sources' then
    if v_row.kind = 'gst_returns' then
      perform private.cb_clear_step(v_file, 't2', 'The revenue on the GST/HST returns changed');
      return null;
    end if;
  end if;
  if tg_table_name = 'cb_revenue_checks' then
    if tg_op = 'UPDATE' then
      if old.gst_explanation is distinct from new.gst_explanation then
        perform private.cb_clear_step(v_file, 't2', 'The GST/HST revenue note changed');
      end if;
      if old.explanation is not distinct from new.explanation and old.t4a_explanation is not distinct from new.t4a_explanation
         and old.t4a_none is not distinct from new.t4a_none then
        return null;
      end if;
    elsif tg_op = 'INSERT' then
      if new.gst_explanation <> '' then
        perform private.cb_clear_step(v_file, 't2', 'The GST/HST revenue note changed');
      end if;
      if new.explanation = '' and new.t4a_explanation = '' and not new.t4a_none and new.added_at is null then
        return null;
      end if;
    end if;
  end if;
  -- Piece 6 (Hashim, Nov 18, 2026): a tax entry leaves steps 5, 6 and 7 signed. The final GIFI export is stale, so
  -- step 8 is cleared (and steps 9 and 10 follow), as when step 5's chain cleared it.
  if v_tje and v_step = 'entries' then
    perform private.cb_clear_step(v_file, 't2', coalesce(nullif(v_txt, ''), v_why));
    return null;
  end if;
  if v_step = 'records' and exists (select 1 from public.cb_files where id = v_file and books in ('statements', 'paper')) then
    perform private.cb_clear_substeps(v_file, array['3.2', '3.3'], coalesce(nullif(v_txt, ''), v_why));   -- round 34
    -- Piece 10b: statement lines or statements added or removed move the balances: step 6 reopens even when step 3 is not
    -- fully signed. A statement changed in place (its file replaced, its source) moves nothing.
    if tg_op <> 'UPDATE' then
      perform private.cb_clear_step(v_file, 'compare', coalesce(nullif(v_txt, ''), v_why));
    end if;
  else
    perform private.cb_clear_step(v_file, v_step, coalesce(nullif(v_txt, ''), v_why));
  end if;
  -- Piece 10b (Hashim, Nov 19, 2026): an AJE or RJE that moves a balance reopens step 6: added or deleted, its lines changed,
  -- or its type or date changed. Its note, reason, W/P ref or attachments, and the revenue check, leave step 6 signed.
  -- (Nested: old and new are read only for cb_entries.)
  if v_step = 'entries' then
    if tg_table_name = 'cb_entry_lines' then
      -- cb_edit_entry writes every line again; it clears step 6 itself, only when the lines differ.
      v_moved := coalesce(current_setting('cb.lines_rewrite', true), '') <> 'on';
    elsif tg_table_name = 'cb_entries' then
      if tg_op <> 'UPDATE' then
        v_moved := true;
      elsif old.kind is distinct from new.kind or old.entry_date is distinct from new.entry_date then
        v_moved := true;
      end if;
    end if;
    if v_moved then
      perform private.cb_clear_step(v_file, 'compare', coalesce(nullif(v_txt, ''), v_why));
    end if;
  end if;
  return null;
end;
$function$;

-- Step names on trial balance files (item 0).
CREATE OR REPLACE FUNCTION private.cb_lock_problems(p_file uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_out text[] := '{}'; v_file public.cb_files; c public.cb_file_close; s record; st record; v_bank boolean; g public.cb_gst_returns;
begin
  select * into v_file from public.cb_files where id = p_file;
  v_bank := v_file.books in ('statements', 'paper');
  for st in select * from (values (1, 'setup', 'Set up'), (2, 'opening', 'Opening balances'),
                                  (3, 'records', case when v_bank then 'Banking' else 'Import trial balance' end),
                                  (4, 'code', case when v_bank then 'Code transactions' else 'Assign mapping' end),
                                  (5, 'entries', 'Adjustments'), (6, 'compare', 'Compare to last year'), (7, 'review', 'Review'),
                                  (8, 't2', 'Tax returns'), (9, 'statements', 'Statements')) as x(n, k, name) order by n loop
    if not exists (select 1 from public.cb_step_signoffs where file_id = p_file and step = st.k and reviewed_at is not null) then
      v_out := v_out || format('Step %s, %s: not signed by the reviewer.', st.n, st.name);
    end if;
  end loop;
  select * into s from private.cb_mal_signed_row(p_file) as (signed_at timestamptz, signed_name text, signed_title text);
  if s.signed_at is null then v_out := v_out || 'The MAL is not signed.'::text;
  else v_out := v_out || (select coalesce(array_agg('Checklist: ' || x), '{}') from unnest(private.cb_checklist_problems(p_file)) x); end if;
  if not exists (select 1 from public.cb_step_signoffs where file_id = p_file and step = 'lock' and reviewed_at is not null) then
    v_out := v_out || 'Step 10: not signed by the reviewer (the email is still a draft).'::text;
  end if;
  select * into c from public.cb_file_close where file_id = p_file;
  if c.delivered_at is null then v_out := v_out || 'The documents are not delivered: tick "Uploaded to TaxDome and email sent".'::text; end if;
  if coalesce(c.efile_number, '') = '' then v_out := v_out || 'The EFILE confirmation number is not recorded.'::text; end if;
  -- Round 13: each GST/HST return of the year, its filing date and CRA confirmation number.
  if private.cb_gst_applies(p_file) then
    for g in select * from public.cb_gst_returns where file_id = p_file order by period_no loop
      if g.filed_on is null or coalesce(g.confirmation, '') = '' then
        v_out := v_out || format('GST/HST return %s: the filing date and CRA confirmation number are not recorded.', g.label);
      end if;
    end loop;
  end if;
  return v_out;
end;
$function$;

-- Trial balance files take Closebook entries: the monthly guard goes (item 5).
CREATE OR REPLACE FUNCTION private.cb_entry_head_check(p_file cb_files, p_kind text, p_reason text, p_note text, p_reverse boolean, p_lines jsonb, p_wp_ref text, p_date date, p_attachments text[])
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require(p_file.id is not null and p_file.phase <> 'locked', 'This file is locked.');
  perform private.require(p_kind in ('AJE', 'RJE', 'TJE'), 'Unknown entry type.');
  perform private.require(p_reason in ('accrual', 'reclassification', 'correction', 'tax', 'prior_period'), 'Choose a reason.');
  perform private.require(length(btrim(coalesce(p_wp_ref, ''))) between 3 and 120, 'Add the W/P reference: the step or schedule that supports the entry.');
  perform private.require(length(btrim(coalesce(p_note, ''))) between 3 and 500, 'Add the memo: what the entry does and why.');
  perform private.require(not coalesce(p_reverse, false) or p_reason = 'accrual', 'Only an accrual reverses next year.');
  perform private.require(p_date is null or p_date between p_file.year_start and p_file.year_end, 'The entry date must fall in the file''s year.');
  perform private.require(jsonb_typeof(p_lines) = 'array' and jsonb_array_length(p_lines) >= 2, 'An entry needs at least two lines.');
  perform private.require(coalesce(array_length(p_attachments, 1), 0) <= 10, 'Up to 10 attachments.');
end;
$function$;

-- Entries on trial balance files (item 5; D12a, D12b; Opening Balance Equity, option A).
CREATE OR REPLACE FUNCTION private.cb_entry_write_lines(p_entry uuid, p_file cb_files, p_kind text, p_reason text, p_reverse boolean, p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_fid uuid := p_file.id;
  -- Piece R2 (D12a): every trial balance file posts to the client's own accounts (monthly QuickBooks files included).
  v_own boolean := p_file.books not in ('statements', 'paper');
  v_cn text;
  v_cnt int;
  v_obe boolean := false;
  v_obe_acc uuid;
  v_re_now numeric;
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
  v_plain jsonb := '[]'::jsonb;
  v_n_re int;
begin
  -- Hashim (Nov 19, 2026): QuickBooks Opening Balance Equity is cleared by one RJE to retained earnings at the start of the
  -- year, the only exception to "retained earnings only through prior period adjustments": two lines, one on that account
  -- and one on retained earnings.
  if v_own and p_kind = 'RJE' and jsonb_array_length(p_lines) = 2 then
    select max(a.id::text) filter (where private.cb_obe(a))::uuid, count(*) filter (where private.cb_obe(a)), count(*) filter (where a.line_no like '3600.%')
      into v_obe_acc, v_cnt, v_n_re from jsonb_array_elements(p_lines) l join public.cb_accounts a on a.id = nullif(l ->> 'account', '')::uuid and a.file_id = v_fid;
    v_obe := v_cnt = 1 and v_n_re = 1;
  end if;
  for v in select * from jsonb_array_elements(p_lines) loop
    v_chart := null; v_cn := null;
    perform private.require(round((v ->> 'amount')::numeric, 2) <> 0, 'Every line needs an amount.');
    perform private.require(nullif(v ->> 'tax_code', '') is null or exists (select 1 from public.cb_sales_tax_codes where code = v ->> 'tax_code'), 'Unknown sales tax code.');
    v_name := nullif(btrim(coalesce(v ->> 'new_name', '')), '');
    v_type := nullif(v ->> 'new_type', '');
    v_acc := null; v_key := '';
    if nullif(v ->> 'account', '') is not null then
      select a.id, a.line_no, a.account_key, a.chart_account into v_acc, v_line, v_key, v_cn from public.cb_accounts a where a.id = (v ->> 'account')::uuid and a.file_id = v_fid;
      perform private.require(v_acc is not null, 'An account is not in this file.');
      -- Clearing (10900) has no group by design; the reviewer clears it with an entry (round 4 item 3; piece R2 D2).
      perform private.require(v_line is not null or private.cb_clearing(v_key, v_cn),
        case when v_own then 'Assign this account to a master account in step 4 first.' else 'Choose an account from the chart first.' end);
      -- Piece R2 (D12b): never a QuickBooks parent that has sub-accounts.
      perform private.require(not v_own or not exists (select 1 from public.cb_accounts c where c.file_id = v_fid and c.parent_key = v_key),
        'Post to a sub-account, not to its parent.');
    elsif nullif(v ->> 'chart', '') is not null then
      select * into v_chart from public.cb_chart_accounts where number = v ->> 'chart';
      perform private.require(v_chart.number is not null, 'Choose an account from the standard chart.');
      v_line := v_chart.line_no;
      if v_own and v_name is null then
        -- Piece R2 (D12b): the client's account assigned to that master account; with several, the one the preparer picked
        -- (cb_client_chart_picks, rolled forward); never a parent with sub-accounts. For the sales tax line only, a new
        -- "GST/HST payable" when the client has none.
        select count(*) into v_cnt from public.cb_accounts a where a.file_id = v_fid and a.chart_account = v_chart.number
           and a.account_key not like 'line:%' and a.account_key not like 'gifi:%' and a.account_key not like 'chart:%'
           and not exists (select 1 from public.cb_accounts c where c.file_id = v_fid and c.parent_key = a.account_key);
        if v_cnt = 1 then
          select a.id into v_acc from public.cb_accounts a where a.file_id = v_fid and a.chart_account = v_chart.number
             and a.account_key not like 'line:%' and a.account_key not like 'gifi:%' and a.account_key not like 'chart:%'
             and not exists (select 1 from public.cb_accounts c where c.file_id = v_fid and c.parent_key = a.account_key);
        elsif v_cnt > 1 then
          select a.id into v_acc from public.cb_accounts a join public.cb_client_chart_picks p on p.client_id = p_file.client_id
             and p.chart_account = v_chart.number and p.account_key = a.account_key where a.file_id = v_fid and a.chart_account = v_chart.number
             and not exists (select 1 from public.cb_accounts c where c.file_id = v_fid and c.parent_key = a.account_key);
          perform private.require(v_acc is not null, format('Several of the client''s accounts are on master account %s %s: choose the one entries take (step 4, open the master account).', v_chart.number, v_chart.name));
        end if;
        if v_acc is null and coalesce((v ->> 'is_tax')::boolean, false) and v_chart.number = '21500' and v_cnt = 0 then
          -- The client's GST/HST account may sit on 12250 GST/HST receivable (a debit balance): the tax line takes it.
          select min(a.id::text)::uuid into v_acc from public.cb_accounts a where a.file_id = v_fid and a.chart_account = '12250'
             and (select count(*) from public.cb_accounts b where b.file_id = v_fid and b.chart_account = '12250') = 1;
        end if;
        if v_acc is null then
          perform private.require(coalesce((v ->> 'is_tax')::boolean, false), 'Choose one of the client''s accounts, or name a new account for their books.');
          v_name := v_chart.name; v_type := 'Other Current Liabilities';
        end if;
      elsif v_own then
        null;   -- a new client account named on this master account (created below, with the master account)
      else
        insert into public.cb_accounts (file_id, account_key, number, name, this_year, line_no, mapping_source, mapped_at)
        values (v_fid, 'chart:' || v_chart.number, v_chart.number, v_chart.name, 0, v_chart.line_no, 'chart', now())
        on conflict (file_id, account_key) do nothing;
        select id, account_key into v_acc, v_key from public.cb_accounts where file_id = v_fid and account_key = 'chart:' || v_chart.number;
      end if;
    else
      v_line := v ->> 'line';
      perform private.require(not v_own or v_name is not null, 'Choose one of the client''s accounts, or name a new account for their books.');
    end if;
    -- Retained earnings only moves through a prior period adjustment, which posts to GIFI 3720.
    v_re := v_line like '3600.%' or v_key in ('gifi:3660', 'gifi:3600');
    if v_re and not v_obe then
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
        -- Piece R2 (item 5): a new client account is created with a master account.
        perform private.require(v_line like '3720.%' or coalesce(v_chart.number, private.cb_chart_for_line(v_line)) is not null,
          'Choose the master account for the new account.');
        insert into public.cb_accounts (file_id, account_key, number, name, line_no, chart_account, mapping_source, mapped_by, mapped_at, client_new, qbo_type)
        values (v_fid, 'new:' || lower(v_name), '', v_name, v_line, case when v_line like '3720.%' then '31500' else coalesce(v_chart.number, private.cb_chart_for_line(v_line)) end,
                'preparer', (select auth.uid()), now(), true, v_type)
        on conflict (file_id, account_key) do nothing;
        select id into v_acc from public.cb_accounts where file_id = v_fid and account_key = 'new:' || lower(v_name);
      else
        -- A standard chart account on that line comes first (31500 for 3720); a bare line only when none.
        select * into v_chart from public.cb_chart_accounts where line_no = v_line order by sort_order limit 1;
        if v_chart.number is not null then
          insert into public.cb_accounts (file_id, account_key, number, name, this_year, line_no, mapping_source, mapped_at)
          values (v_fid, 'chart:' || v_chart.number, v_chart.number, v_chart.name, 0, v_chart.line_no, 'chart', now())
          on conflict (file_id, account_key) do nothing;
          select id into v_acc from public.cb_accounts where file_id = v_fid and account_key = 'chart:' || v_chart.number;
        else
          insert into public.cb_accounts (file_id, account_key, number, name, line_no, mapping_source, mapped_by, mapped_at)
          select v_fid, 'line:' || v_line, '', m.name, v_line, 'preparer', (select auth.uid()), now() from public.cb_master_lines m where m.line_no = v_line
          on conflict (file_id, account_key) do nothing;
          select id into v_acc from public.cb_accounts where file_id = v_fid and account_key = 'line:' || v_line;
        end if;
      end if;
    end if;
    -- Piece 3: a line from a schedule keeps its part (the Schedule tag). Only the schedule writes a new one; an edit of a
    -- schedule entry may keep them, after cb_edit_entry checked the amounts are the schedule's.
    perform private.require(nullif(v ->> 'schedule_part', '') is null or coalesce(current_setting('cb.schedule_save', true), '') = 'on'
      or (select origin from public.cb_entries where id = p_entry) = 'schedule', 'Change this amount in its schedule: click the Schedule tag.');
    insert into public.cb_entry_lines (entry_id, account_id, amount, memo, tax_code, is_tax, schedule_part)
    values (p_entry, v_acc, round((v ->> 'amount')::numeric, 2), left(coalesce(v ->> 'memo', ''), 200), nullif(v ->> 'tax_code', ''), coalesce((v ->> 'is_tax')::boolean, false),
            nullif(v ->> 'schedule_part', ''));
    if not coalesce((v ->> 'is_tax')::boolean, false) then v_plain := v_plain || jsonb_build_array(jsonb_build_object('line', v_line, 'amount', round((v ->> 'amount')::numeric, 2), 'tax', v ->> 'tax_code')); end if;
    v_sum := v_sum + round((v ->> 'amount')::numeric, 2);
    if (select line_type from public.cb_master_lines where line_no = v_line) in ('Revenue', 'Expense') then v_income := v_income + round((v ->> 'amount')::numeric, 2); end if;
  end loop;
  perform private.require(v_sum = 0, format('The entry does not balance: it is out by %s.', v_sum));
  if v_obe then
    -- Option A (Hashim, Nov 19): only against step 2's closing retained earnings typed from the T2, and it must tie.
    perform private.require(p_file.opening_re_stated is not null, 'Enter last year''s closing retained earnings in step 2 first.');
    perform private.require(private.cb_account_final(v_obe_acc) = 0, 'The entry must clear Opening Balance Equity to nil.');
    select -coalesce(sum(private.cb_account_final(a.id)), 0) into v_re_now from public.cb_accounts a where a.file_id = v_fid and a.line_no like '3600.%';
    perform private.require(v_re_now = p_file.opening_re_stated,
      format('After this entry, retained earnings at the start (%s) must equal last year''s closing retained earnings in step 2 (%s).',
        private.cb_money(v_re_now), private.cb_money(p_file.opening_re_stated)));
    perform private.cb_log_event(v_fid, 'entry_obe', 'entries', 'Opening Balance Equity cleared to retained earnings (RJE), checked against step 2',
      null, null, null, null, null, null, null);
  end if;
  perform private.require(p_kind <> 'RJE' or v_income = 0, 'A reclassifying entry (RJE) cannot change the result. Use an AJE.');
  perform private.require(p_reason <> 'prior_period' or v_ppa_line, 'The reason "Prior period adjustment" needs a line on 31500 Prior period adjustments.');
  perform private.require(p_reason <> 'prior_period' or not coalesce(p_reverse, false), 'A prior period adjustment never reverses next year.');
  return v_plain;
end;
$function$;

-- Trial balance import: sub-accounts kept apart (D10); refused while entries are booked (D12c).
CREATE OR REPLACE FUNCTION public.cb_import_tb(p_file uuid, p_target text, p_source text, p_file_name text, p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- Piece R2 (D12c): entries already booked in QuickBooks would count twice in a new trial balance.
  perform private.require(p_target <> 'this_year' or not exists (select 1 from public.cb_entries where file_id = p_file and booked_at is not null),
    'Some entries are marked Booked in QuickBooks: a new trial balance already holds them, so they would count twice. Unmark and delete those entries first, then import.');
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
    -- Piece R2 (D10): a QuickBooks sub-account is its own account: its own number, else its full Parent:Sub name.
    v_key := coalesce(nullif(btrim(v_row ->> 'number'), ''), lower(regexp_replace(btrim(coalesce(nullif(v_row ->> 'path', ''), v_row ->> 'name')), '\s+', ' ', 'g')));
    v_amt := round((v_row ->> 'amount')::numeric, 2);
    insert into public.cb_accounts (file_id, account_key, number, name, this_year, last_year, tb_type, parent_key, full_name)
    values (p_file, v_key, btrim(coalesce(v_row ->> 'number', '')), btrim(v_row ->> 'name'),
            case when p_target = 'this_year' then v_amt else 0 end, case when p_target = 'last_year' then v_amt else 0 end,
            left(nullif(btrim(coalesce(v_row ->> 'type', '')), ''), 60), nullif(btrim(coalesce(v_row ->> 'parent', '')), ''),
            left(nullif(btrim(coalesce(v_row ->> 'full_name', '')), ''), 400))
    on conflict (file_id, account_key) do update
      set name = excluded.name,
          tb_type = coalesce(excluded.tb_type, public.cb_accounts.tb_type),
          parent_key = coalesce(excluded.parent_key, public.cb_accounts.parent_key),
          full_name = coalesce(excluded.full_name, public.cb_accounts.full_name),
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
$function$;

-- Account List: rows with no balance, parents and detail types (D9 to D11).
CREATE OR REPLACE FUNCTION public.cb_import_account_list(p_file uuid, p_file_name text, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_file public.cb_files;
  v_n int;
  v_matched int := 0;
  v_left int;
  a record;
  v_type text;
  norm constant text := '\s+';
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook to import.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null, 'File not found.');
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(v_file.books not in ('statements', 'paper'), 'Bank-statement files use the standard chart: their accounts already have a type.');
  perform private.require(exists (select 1 from public.cb_imports where file_id = p_file and target = 'this_year'), 'Import the trial balance first, then the Account List.');
  perform private.require(jsonb_typeof(p_rows) = 'array' and jsonb_array_length(p_rows) between 1 and 5000, 'The Account List has no accounts, or too many.');
  v_n := jsonb_array_length(p_rows);
  for a in select id, number, name from public.cb_accounts where file_id = p_file
             and account_key not in ('opening', 'uncoded') and account_key not like 'chart:%' and account_key not like 'bank:%'
             and account_key not like 'line:%' and account_key not like 'gifi:%' and not client_new loop
    v_type := null;
    -- By account number when the account has one; otherwise by name (case and spacing ignored).
    if coalesce(a.number, '') <> '' then
      select left(btrim(r ->> 'type'), 60) into v_type from jsonb_array_elements(p_rows) r where btrim(coalesce(r ->> 'number', '')) = a.number limit 1;
    end if;
    if v_type is null then
      select left(btrim(r ->> 'type'), 60) into v_type from jsonb_array_elements(p_rows) r
       where lower(regexp_replace(btrim(coalesce(r ->> 'name', '')), norm, ' ', 'g')) = lower(regexp_replace(btrim(a.name), norm, ' ', 'g')) limit 1;
    end if;
    if coalesce(v_type, '') <> '' then
      update public.cb_accounts set tb_type = v_type where id = a.id;
      v_matched := v_matched + 1;
    end if;
  end loop;
  -- Piece R2 (D9, D10, D11): the client's accounts with no balance join as rows ("Hide no balance" hides them), each with
  -- its parent and its QuickBooks detail type.
  insert into public.cb_accounts (file_id, account_key, number, name, this_year, last_year, tb_type, qbo_detail_type, parent_key, full_name, in_list)
  select p_file, k.key, k.number, k.name, 0, 0, k.type, k.detail, k.parent, k.full_name, true
    from (select distinct on (key) key, number, name, type, detail, parent, full_name from (
      select coalesce(nullif(btrim(r ->> 'number'), ''), lower(regexp_replace(btrim(coalesce(nullif(r ->> 'path', ''), r ->> 'name')), norm, ' ', 'g'))) key,
             btrim(coalesce(r ->> 'number', '')) number, left(btrim(r ->> 'name'), 200) name, left(nullif(btrim(coalesce(r ->> 'type', '')), ''), 60) type,
             left(nullif(btrim(coalesce(r ->> 'detail', '')), ''), 80) detail, nullif(btrim(coalesce(r ->> 'parent', '')), '') parent,
             left(nullif(btrim(coalesce(r ->> 'full_name', '')), ''), 400) full_name
        from jsonb_array_elements(p_rows) r where length(btrim(coalesce(r ->> 'name', ''))) between 1 and 200) x order by key) k
  on conflict (file_id, account_key) do update set in_list = true,
    qbo_detail_type = coalesce(excluded.qbo_detail_type, public.cb_accounts.qbo_detail_type),
    parent_key = coalesce(public.cb_accounts.parent_key, excluded.parent_key),
    full_name = coalesce(public.cb_accounts.full_name, excluded.full_name);
  select count(*) into v_left from public.cb_accounts where file_id = p_file and account_type is null
     and account_key not in ('opening', 'uncoded') and account_key not like 'line:%' and account_key not like 'gifi:%';
  delete from public.cb_imports where file_id = p_file and target = 'account_list';
  insert into public.cb_imports (file_id, target, source, file_name, rows, debit_total, credit_total, imported_by)
  values (p_file, 'account_list', 'quickbooks', left(coalesce(p_file_name, ''), 200), v_n, 0, 0, (select auth.uid()));
  update public.cb_files set updated_at = now() where id = p_file;
  return jsonb_build_object('rows', v_n, 'matched', v_matched, 'accounts_without', v_left);
end;
$function$;

-- Accounts from the Account List stay with no balance (D9).
CREATE OR REPLACE FUNCTION private.cb_prune_accounts(p_file uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  delete from public.cb_accounts a where a.file_id = p_file and a.this_year = 0 and a.last_year = 0
    and not exists (select 1 from public.cb_entry_lines l where l.account_id = a.id) and not a.in_list
$function$;

-- Clearing by master account too (D2).
CREATE OR REPLACE FUNCTION private.cb_step9_problems(p_file uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_file public.cb_files; c public.cb_client_fs_fields; f public.cb_file_fs; v_out text[] := '{}'; v_n int; v_out_by numeric; r record; v_bank boolean;
begin
  select * into v_file from public.cb_files where id = p_file;
  select * into c from public.cb_client_fs_fields where client_id = v_file.client_id;
  select * into f from public.cb_file_fs where file_id = p_file;
  v_bank := v_file.books in ('statements', 'paper');
  if not exists (select 1 from public.cb_step_signoffs where file_id = p_file and step = 't2' and prepared_at is not null) then
    v_out := v_out || 'Step 8 must be signed by the preparer first.'::text;
  end if;
  select coalesce(sum(private.cb_account_final(id)), 0) into v_out_by from public.cb_accounts where file_id = p_file;
  select count(*) into v_n from public.cb_accounts a where a.file_id = p_file and private.cb_account_final(a.id) <> 0 and (a.line_no is null or a.needs_reviewer) and not private.cb_clearing(a.account_key, a.chart_account);
  if v_out_by <> 0 or v_n > 0 then v_out := v_out || 'The trial balance does not balance, or an account is not matched in step 6.'::text; end if;
  -- The fields (Appendix C's intake questions). Each one still empty shows "To fill".
  if coalesce(c.officer_name, '') = '' then v_out := v_out || 'To fill: the signing officer''s name.'::text; end if;
  if coalesce(c.officer_position, '') = '' then v_out := v_out || 'To fill: the signing officer''s position.'::text; end if;
  if coalesce(c.officer_email, '') = '' then v_out := v_out || 'To fill: the signing officer''s email.'::text; end if;
  if f.first_year is null then v_out := v_out || 'To fill: whether this is the corporation''s first year.'::text; end if;
  if f.first_year = false and v_bank and not exists (select 1 from public.cb_opening_s125 where file_id = p_file) then
    v_out := v_out || 'Enter last year''s Schedule 125 in step 2.'::text;
  end if;
  -- A balance due to or from a shareholder needs its terms.
  if coalesce(c.sh_terms, '') = '' and exists (select 1 from public.cb_accounts a join public.cb_master_lines m on m.line_no = a.line_no
      where a.file_id = p_file and m.gifi_code in ('1300', '1301', '1302', '1303', '2180', '2181', '2182', '2183', '2780', '2781', '2782', '2783', '3260', '3261', '3262', '3263') and private.cb_account_final(a.id) <> 0) then
    v_out := v_out || 'To fill: the shareholder loan terms.'::text;
  end if;
  -- Each related-party line with a balance needs the related party's name.
  for r in select distinct m.gifi_code, m.gifi_name from public.cb_accounts a join public.cb_master_lines m on m.line_no = a.line_no
            where a.file_id = p_file and private.cb_account_final(a.id) <> 0 and m.gifi_name ~* 'related (part|corp|canadian|foreign)|affiliat' order by m.gifi_code loop
    if coalesce(c.related ->> r.gifi_code, '') = '' then v_out := v_out || format('To fill: the related party for GIFI %s (%s).', r.gifi_code, r.gifi_name); end if;
  end loop;
  -- Each dividend line with a balance needs its class and dates, for the minute book letter.
  for r in select a.line_no, m.name from public.cb_accounts a join public.cb_master_lines m on m.line_no = a.line_no
            where a.file_id = p_file and m.gifi_code between '3700' and '3719' and private.cb_account_final(a.id) <> 0 group by a.line_no, m.name order by a.line_no loop
    if not exists (select 1 from jsonb_array_elements(coalesce(f.dividends, '[]')) d where d ->> 'line' = r.line_no
        and coalesce(d ->> 'cls', '') <> '' and coalesce(d ->> 'declared', '') <> '' and coalesce(d ->> 'paid', '') <> '') then
      v_out := v_out || format('To fill: the class and dates of the dividends on %s (%s).', replace(r.line_no, '.00', ''), r.name);
    end if;
  end loop;
  select count(*) into v_n from public.cb_review_notes where file_id = p_file and step = 'statements' and status = 'open';
  if v_n > 0 then v_out := v_out || format('%s review note%s to fix.', v_n, case when v_n = 1 then '' else 's' end); end if;
  return v_out;
end;
$function$;

-- Clearing by master account too (D2).
CREATE OR REPLACE FUNCTION public.cb_record_gifi_export(p_file uuid, p_kind text, p_file_name text, p_content text, p_totals jsonb, p_checks jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file public.cb_files; v_id uuid; v_failed text; v_out numeric; v_n int;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(v_file.file_type = 'full', 'Monthly files have no T2 tie-out.');
  perform private.require(p_kind in ('before_tax', 'final'), 'Choose the export: before tax entries or final.');
  perform private.require(jsonb_typeof(p_checks) = 'array' and jsonb_array_length(p_checks) >= 5, 'The checks did not run. Nothing was exported.');
  select string_agg(c ->> 'title', '; ') into v_failed from jsonb_array_elements(p_checks) c where not (c ->> 'ok')::boolean;
  perform private.require(v_failed is null, 'Export refused. Failed: ' || coalesce(v_failed, '') || '.');
  -- Checked again here: the trial balance balances and every account with a balance is matched.
  select coalesce(sum(private.cb_account_final(id)), 0) into v_out from public.cb_accounts where file_id = p_file;
  perform private.require(v_out = 0, format('Export refused. The trial balance is out by %s.', v_out));
  select count(*) into v_n from public.cb_accounts a where a.file_id = p_file and private.cb_account_final(a.id) <> 0
     and (a.line_no is null or a.needs_reviewer) and not private.cb_clearing(a.account_key, a.chart_account);
  perform private.require(v_n = 0, format('Export refused. %s account%s not matched or waiting for the reviewer.', v_n, case when v_n = 1 then ' is' else 's are' end));
  -- Piece R1: on bank-statement files, Match accounts to GIFI must be done (the box empty, the ties met).
  select string_agg(x, ' ') into v_failed from unnest(private.cb_match_problems(p_file)) x;
  perform private.require(v_failed is null, 'Export refused. ' || coalesce(v_failed, ''));
  perform private.require(p_content like '"GIFI01",%', 'The file is not a GIFI file.');
  insert into public.cb_gifi_exports (file_id, kind, file_name, content, totals, checks, fingerprint, created_by)
  values (p_file, p_kind, btrim(p_file_name), p_content, p_totals, p_checks, private.cb_gifi_fingerprint(p_file), (select auth.uid()))
  returning id into v_id;
  perform private.cb_log(p_file, 'gifi_exported', 't2', btrim(p_file_name));
  return v_id;
end;
$function$;

-- D13: a director account (13100, 23150, 25450) by master account on trial balance files too.
CREATE OR REPLACE FUNCTION public.cb_set_sh_name(p_file uuid, p_account text, p_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file public.cb_files; a public.cb_accounts; v_name text := btrim(coalesce(p_name, '')); v_old text;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(length(v_name) <= 120, 'Keep the name to 120 characters.');
  select * into a from public.cb_accounts where file_id = p_file and account_key = p_account limit 1;
  perform private.require(a.id is not null and left(coalesce(a.line_no, ''), 4) in ('1301', '1302', '1303', '2180', '2181', '2182', '2183', '2780', '2781', '2782', '2783', '3260', '3261', '3262', '3263')
    and p_account not in ('chart:13100', 'chart:23150', 'chart:25450') and coalesce(a.chart_account, '') not in ('13100', '23150', '25450'), 'Only a shareholder account takes a shareholder name.');
  select name into v_old from public.cb_sh_names where file_id = p_file and account_key = p_account;
  if coalesce(v_old, '') = v_name and v_old is not null then return; end if;
  insert into public.cb_sh_names (file_id, account_key, name, updated_by) values (p_file, p_account, v_name, (select auth.uid()))
  on conflict (file_id, account_key) do update set name = excluded.name, updated_by = excluded.updated_by, updated_at = now();
  perform private.cb_log(p_file, 'sh_name', null, format('%s %s: shareholder %s', coalesce(nullif(a.number, ''), p_account), a.name,
    case when v_name = '' then 'name removed' else format('"%s"', v_name) end || case when coalesce(v_old, '') <> '' then format(' (was "%s")', v_old) else '' end));
end;
$function$;

-- D13: directors by master account too.
CREATE OR REPLACE FUNCTION private.cb_sh_applies(p_file uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.cb_accounts a where a.file_id = p_file
     and left(coalesce(a.line_no, ''), 4) in ('1301', '1302', '1303', '2180', '2181', '2182', '2183', '2780', '2781', '2782', '2783', '3260', '3261', '3262', '3263')
     and a.account_key not in ('chart:13100', 'chart:23150', 'chart:25450') and coalesce(a.chart_account, '') not in ('13100', '23150', '25450')
     and (a.this_year <> 0 or a.last_year <> 0 or private.cb_account_final(a.id) <> 0))
$function$;

-- 6. Triggers.
drop trigger if exists cb_a_chart_sync on public.cb_accounts;
create trigger cb_a_chart_sync before insert or update of chart_account, line_no on public.cb_accounts
  for each row execute function private.cb_chart_sync();
drop trigger if exists cb_assign_changed on public.cb_accounts;
create trigger cb_assign_changed after update of chart_account on public.cb_accounts
  for each row when (old.chart_account is distinct from new.chart_account) execute function private.cb_assign_changed();
drop trigger if exists cb_booked_guard on public.cb_entries;
create trigger cb_booked_guard before delete or update of kind, entry_date, reason, reverse_next_year on public.cb_entries
  for each row execute function private.cb_booked_guard();
drop trigger if exists cb_booked_guard on public.cb_entry_lines;
create trigger cb_booked_guard before insert or update or delete on public.cb_entry_lines
  for each row execute function private.cb_booked_guard();

-- 7. Grants.
revoke all on function private.cb_is_tb(uuid), private.cb_clearing(text, text), private.cb_obe(public.cb_accounts),
  private.cb_chart_for_line(text), private.cb_step4_signed(uuid), private.cb_prior_line(uuid, text), private.cb_assign_counted(public.cb_accounts),
  private.cb_chart_sync(), private.cb_assign_changed(), private.cb_booked_guard() from public, anon, authenticated;
revoke all on function public.cb_assign(uuid, jsonb, text, text), public.cb_unassign_all(uuid), public.cb_undo_assign(uuid),
  public.cb_pick_chart_account(uuid, text, uuid), public.cb_mark_booked(uuid, boolean), public.cb_keep_line_move(uuid) from public, anon;
grant execute on function public.cb_assign(uuid, jsonb, text, text), public.cb_unassign_all(uuid), public.cb_undo_assign(uuid),
  public.cb_pick_chart_account(uuid, text, uuid), public.cb_mark_booked(uuid, boolean), public.cb_keep_line_move(uuid) to authenticated;

reset check_function_bodies;
