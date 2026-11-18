-- Piece 3 of the step 5 restructure (Hashim, Nov 18, 2026; benchmark CaseWare Cloud: a working paper linked to an
-- adjusting entry by its W/P reference, with calculated amounts). Schedules, starting with the Vehicle schedule for
-- the owner's car (src/lib/closebook/vehicle-schedule.ts works out the figures; the server runs it before saving).
--   cb_schedules            one schedule per entry (entry_id unique), deleted with its entry. It keeps the inputs and
--                           what it was calculated with (rates, ITC factor, company-paid figures) and its result, so
--                           later changes on the CRA rates page or in the books change nothing until it is put in again.
--   cb_entries.origin       'schedule' added. cb_entry_lines.schedule_part: the part of the schedule a line holds
--                           (the "Schedule" tag on screen).
--   The lock, in the database: only cb_save_schedule_entry writes a schedule amount. cb_add_entry refuses a tagged
--   line; cb_edit_entry refuses a changed schedule amount (the account may change); Reclassify refuses any entry
--   with an origin, as before (round 38), and its Undo never reaches a schedule line (an entry's lines are written
--   again, with new ids, on every save).
--   History: schedule created, each input changed, method switched, ITC ticked or unticked, put into the entry,
--   printed, and the entry deleted with its schedule.
-- No table or column is dropped. Safe to run twice.

alter table public.cb_entry_lines add column if not exists schedule_part text;
alter table public.cb_entries drop constraint if exists cb_entries_origin_check;
alter table public.cb_entries add constraint cb_entries_origin_check check (origin in ('revenue_check', 'expenses_personal', 'schedule'));

create table if not exists public.cb_schedules (
  id          uuid primary key default gen_random_uuid(),
  file_id     uuid not null references public.cb_files (id) on delete cascade,
  entry_id    uuid not null unique references public.cb_entries (id) on delete cascade,
  kind        text not null check (kind in ('vehicle')),
  method      text not null default 'prorated' check (method in ('prorated', 'detailed')),
  choice      text not null default 'higher' check (choice in ('higher', 'allowance', 'actual')),
  itc_claim   boolean not null default true,
  inputs      jsonb not null default '{}'::jsonb,
  snapshot    jsonb not null default '{}'::jsonb,
  result      jsonb not null default '{}'::jsonb,
  created_by  uuid references public.staff (id),
  created_at  timestamptz not null default now(),
  updated_by  uuid references public.staff (id),
  updated_at  timestamptz
);
create index if not exists cb_schedules_file on public.cb_schedules (file_id);
alter table public.cb_schedules enable row level security;
alter table public.cb_schedules force row level security;
drop policy if exists "Closebook viewers read schedules" on public.cb_schedules;
create policy "Closebook viewers read schedules" on public.cb_schedules for select to authenticated using ((select private.can_view('closebook')));
revoke all on public.cb_schedules from anon, authenticated;
grant select on public.cb_schedules to authenticated;

-- The schedule amounts of an entry, and of lines about to be written, in one comparable form: part, amount, tax line.
create or replace function private.cb_schedule_amounts(p_entry uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(format('%s|%s|%s', schedule_part, amount, is_tax) order by schedule_part, amount), '{}')
    from public.cb_entry_lines where entry_id = p_entry and schedule_part is not null;
$$;
create or replace function private.cb_schedule_amounts_of(p_lines jsonb) returns text[]
language sql immutable security definer set search_path = '' as $$
  select coalesce(array_agg(format('%s|%s|%s', v ->> 'schedule_part', round((v ->> 'amount')::numeric, 2), coalesce((v ->> 'is_tax')::boolean, false))
           order by v ->> 'schedule_part', round((v ->> 'amount')::numeric, 2)), '{}')
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) v where nullif(v ->> 'schedule_part', '') is not null;
$$;
revoke all on function private.cb_schedule_amounts(uuid), private.cb_schedule_amounts_of(jsonb) from public, anon, authenticated;

-- The entry line writer of piece 2, with the schedule tag.
create or replace function private.cb_entry_write_lines(p_entry uuid, p_file public.cb_files, p_kind text, p_reason text, p_reverse boolean, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_fid uuid := p_file.id;
  v_own boolean := p_file.books in ('client_software', 'bookkeeper');
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
begin
  for v in select * from jsonb_array_elements(p_lines) loop
    perform private.require(round((v ->> 'amount')::numeric, 2) <> 0, 'Every line needs an amount.');
    perform private.require(nullif(v ->> 'tax_code', '') is null or exists (select 1 from public.cb_sales_tax_codes where code = v ->> 'tax_code'), 'Unknown sales tax code.');
    v_name := nullif(btrim(coalesce(v ->> 'new_name', '')), '');
    v_type := nullif(v ->> 'new_type', '');
    v_acc := null; v_key := '';
    if nullif(v ->> 'account', '') is not null then
      select a.id, a.line_no, a.account_key into v_acc, v_line, v_key from public.cb_accounts a where a.id = (v ->> 'account')::uuid and a.file_id = v_fid;
      perform private.require(v_acc is not null, 'An account is not in this file.');
      -- Clearing (10900) has no GIFI line by design; the reviewer clears it with an entry (round 4 item 3).
      perform private.require(v_line is not null or v_key = 'chart:10900', 'Match every account in the entry to a GIFI line first.');
    elsif nullif(v ->> 'chart', '') is not null then
      select * into v_chart from public.cb_chart_accounts where number = v ->> 'chart';
      perform private.require(v_chart.number is not null, 'Choose an account from the standard chart.');
      v_line := v_chart.line_no;
      if v_own then
        -- The client's own account on that GIFI line; for the sales tax line only, a new "GST/HST payable".
        select id into v_acc from public.cb_accounts where file_id = v_fid and line_no = v_line and not client_new
          and account_key not like 'line:%' and account_key not like 'gifi:%' and number <> '' order by number limit 1;
        if v_acc is null then
          perform private.require(coalesce((v ->> 'is_tax')::boolean, false), 'Choose one of the client''s accounts, or name a new account for their books.');
          v_name := v_chart.name; v_type := 'Other Current Liabilities';
        end if;
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
        values (v_fid, 'new:' || lower(v_name), '', v_name, v_line, 'preparer', (select auth.uid()), now(), true, v_type)
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
  perform private.require(p_kind <> 'RJE' or v_income = 0, 'A reclassifying entry (RJE) cannot change the result. Use an AJE.');
  perform private.require(p_reason <> 'prior_period' or v_ppa_line, 'The reason "Prior period adjustment" needs a line on 31500 Prior period adjustments.');
  perform private.require(p_reason <> 'prior_period' or not coalesce(p_reverse, false), 'A prior period adjustment never reverses next year.');
  return v_plain;
end;
$$;
revoke all on function private.cb_entry_write_lines(uuid, public.cb_files, text, text, boolean, jsonb) from public, anon, authenticated;

-- Edit in place (piece 2), with the schedule lock.
create or replace function public.cb_edit_entry(p_entry uuid, p_kind text, p_reason text, p_note text, p_reverse boolean, p_lines jsonb, p_wp_ref text,
  p_date date default null, p_standard uuid default null, p_attachments text[] default '{}', p_seq integer default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_e public.cb_entries;
  v_file public.cb_files;
  v_new public.cb_entries;
  v_label text;
  v_old_lines text;
  v_new_lines text;
  v_seq int;
  r record;
begin
  select * into v_e from public.cb_entries where id = p_entry;
  perform private.require(v_e.id is not null, 'Entry not found.');
  perform private.require(coalesce(v_e.origin, '') <> 'expenses_personal', 'Change this entry on the Expenses paid personally paper.');
  -- Piece 3: an amount from a schedule changes only in its schedule (the account may change).
  perform private.require(coalesce(v_e.origin, '') <> 'schedule' or coalesce(current_setting('cb.schedule_save', true), '') = 'on'
    or private.cb_schedule_amounts(p_entry) = private.cb_schedule_amounts_of(p_lines), 'Change this amount in its schedule: click the Schedule tag.');
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  perform private.require(v_e.reviewed_at is null, 'An approved entry cannot be deleted. Add a correcting entry instead.');
  select * into v_file from public.cb_files where id = v_e.file_id for update;
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  perform private.cb_entry_head_check(v_file, p_kind, p_reason, p_note, p_reverse, p_lines, p_wp_ref, p_date, p_attachments);
  v_seq := coalesce(p_seq, v_e.seq);
  perform private.require(v_seq between 1 and 999 and not exists (select 1 from public.cb_entries where file_id = v_e.file_id and seq = v_seq and id <> p_entry),
    format('Entry number %s-%s is taken. Choose another.', to_char(v_file.year_end, 'YYYY'), lpad(v_seq::text, 3, '0')));
  v_label := private.cb_entry_label(p_entry);
  v_old_lines := private.cb_entry_lines_text(p_entry);

  -- The header, in place. The per-type number changes only when the type does (it is unique per type).
  update public.cb_entries set kind = p_kind, reason = p_reason, note = btrim(p_note), reverse_next_year = coalesce(p_reverse, false),
      wp_ref = btrim(p_wp_ref), entry_date = coalesce(p_date, v_file.year_end), attachments = coalesce(p_attachments, '{}'), seq = v_seq,
      number = case when p_kind = v_e.kind then v_e.number else coalesce((select max(number) from public.cb_entries where file_id = v_e.file_id and kind = p_kind), 0) + 1 end,
      needs_review = true, reviewed_by = null, reviewed_at = null
   where id = p_entry
  returning * into v_new;
  -- The lines, written again by the same rules as a new entry.
  delete from public.cb_entry_lines where entry_id = p_entry;
  perform private.cb_entry_write_lines(p_entry, v_file, p_kind, p_reason, p_reverse, p_lines);
  v_new_lines := private.cb_entry_lines_text(p_entry);

  -- History: one row per thing that changed, with the old and new value.
  for r in select * from (values
      ('Number', v_new.seq = v_e.seq, v_label, private.cb_entry_label(p_entry)),
      ('Type', p_kind = v_e.kind, v_e.kind, p_kind),
      ('Date', v_new.entry_date = v_e.entry_date, to_char(v_e.entry_date, 'Mon FMDD, YYYY'), to_char(v_new.entry_date, 'Mon FMDD, YYYY')),
      ('Description', v_new.note = v_e.note, v_e.note, v_new.note),
      ('W/P ref', v_new.wp_ref = v_e.wp_ref, v_e.wp_ref, v_new.wp_ref),
      ('Reverses next year', v_new.reverse_next_year = v_e.reverse_next_year, case when v_e.reverse_next_year then 'Yes' else 'No' end, case when v_new.reverse_next_year then 'Yes' else 'No' end),
      ('Attachments', v_new.attachments = v_e.attachments,
         coalesce(nullif(array_to_string(array(select regexp_replace(x, '^.*/(\d+-)?', '') from unnest(v_e.attachments) x), ', '), ''), 'None'),
         coalesce(nullif(array_to_string(array(select regexp_replace(x, '^.*/(\d+-)?', '') from unnest(v_new.attachments) x), ', '), ''), 'None')),
      ('Lines', v_new_lines = v_old_lines, v_old_lines, v_new_lines)) as x(what, same, was, now)
    where not same loop
    perform private.cb_log_event(v_e.file_id, 'entry_edited', 'entries', format('Entry %s changed: %s', private.cb_entry_label(p_entry), lower(r.what)),
      null, null, private.cb_entry_label(p_entry), r.what, r.was, r.now);
  end loop;
  update public.cb_files set updated_at = now() where id = v_e.file_id;
  return p_entry;
end;
$$;
revoke all on function public.cb_edit_entry(uuid, text, text, text, boolean, jsonb, text, date, uuid, text[], integer) from public, anon;
grant execute on function public.cb_edit_entry(uuid, text, text, text, boolean, jsonb, text, date, uuid, text[], integer) to authenticated, service_role;
-- Save an entry from a schedule: a new entry (p_entry null) or the same entry again. p_schedule is the schedule as
-- put in (kind, method, choice, itc, inputs, snapshot, result, lines, changes, summary); null keeps the stored one
-- (an edit of the entry itself: description, date, accounts, added lines). The schedule's lines must be exactly the
-- schedule's amounts. The entry goes to the reviewer under the same rule as a typed entry.
create or replace function public.cb_save_schedule_entry(p_file uuid, p_entry uuid, p_kind text, p_reason text, p_note text, p_reverse boolean,
  p_lines jsonb, p_wp_ref text, p_date date, p_attachments text[], p_seq integer, p_schedule jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_e public.cb_entries;
  v_s public.cb_schedules;
  v_id uuid;
  v_label text;
  v_itc boolean;
  c jsonb;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook to add entries.');
  select * into v_file from public.cb_files where id = p_file;
  perform private.require(v_file.id is not null, 'File not found.');
  if p_entry is not null then
    select * into v_e from public.cb_entries where id = p_entry;
    perform private.require(v_e.id is not null and v_e.file_id = p_file and v_e.origin = 'schedule', 'Entry not found.');
    select * into v_s from public.cb_schedules where entry_id = p_entry;
  else
    perform private.require(p_schedule is not null, 'Open the schedule and put it in the entry.');
  end if;
  if p_schedule is not null then
    perform private.require(p_schedule ->> 'kind' = 'vehicle', 'Unknown schedule.');
    perform private.require(private.cb_schedule_amounts_of(p_lines) = private.cb_schedule_amounts_of(p_schedule -> 'lines'),
      'Change this amount in its schedule: click the Schedule tag.');
    -- "Claim the ITC": ticked unless the reviewer or an owner unticks it.
    v_itc := coalesce((p_schedule ->> 'itc')::boolean, true);
    perform private.require(v_itc = coalesce(v_s.itc_claim, true) or (select auth.uid()) = v_file.reviewer_id or private.is_owner(),
      'Only the file''s reviewer or an owner can change "Claim the ITC".');
    perform set_config('cb.schedule_save', 'on', true);
  end if;
  if p_entry is null then
    v_id := public.cb_add_entry(p_file, p_kind, p_reason, p_note, p_reverse, p_lines, p_wp_ref, p_date, null, p_attachments, p_seq);
    update public.cb_entries set origin = 'schedule' where id = v_id;
    insert into public.cb_schedules (file_id, entry_id, kind, method, choice, itc_claim, inputs, snapshot, result, created_by)
    values (p_file, v_id, 'vehicle', p_schedule ->> 'method', p_schedule ->> 'choice', v_itc, coalesce(p_schedule -> 'inputs', '{}'),
            coalesce(p_schedule -> 'snapshot', '{}'), coalesce(p_schedule -> 'result', '{}'), (select auth.uid()));
    v_label := private.cb_entry_label(v_id);
    perform private.cb_log_event(p_file, 'schedule_created', 'entries', format('Vehicle schedule created for entry %s', v_label), null, null, v_label, '', '', '');
    if not v_itc then
      perform private.cb_log_event(p_file, 'schedule_itc', 'entries', format('Vehicle schedule %s: Claim the ITC unticked', v_label), null, null, v_label, '', 'Ticked', 'Unticked');
    end if;
  else
    v_id := public.cb_edit_entry(p_entry, p_kind, p_reason, p_note, p_reverse, p_lines, p_wp_ref, p_date, null, p_attachments, p_seq);
    v_label := private.cb_entry_label(v_id);
    if p_schedule is not null then
      for c in select * from jsonb_array_elements(coalesce(p_schedule -> 'changes', '[]'::jsonb)) loop
        perform private.cb_log_event(p_file, case when c ->> 'what' = 'Method' then 'schedule_method_switched' else 'schedule_input_changed' end, 'entries',
          format('Vehicle schedule %s: %s', v_label, lower(c ->> 'what')), null, null, v_label, c ->> 'what', c ->> 'old', c ->> 'new');
      end loop;
      if v_itc <> coalesce(v_s.itc_claim, true) then
        perform private.cb_log_event(p_file, 'schedule_itc', 'entries', format('Vehicle schedule %s: Claim the ITC %s', v_label, case when v_itc then 'ticked' else 'unticked' end),
          null, null, v_label, '', case when v_itc then 'Unticked' else 'Ticked' end, case when v_itc then 'Ticked' else 'Unticked' end);
      end if;
      update public.cb_schedules set method = p_schedule ->> 'method', choice = p_schedule ->> 'choice', itc_claim = v_itc,
          inputs = coalesce(p_schedule -> 'inputs', '{}'), snapshot = coalesce(p_schedule -> 'snapshot', '{}'), result = coalesce(p_schedule -> 'result', '{}'),
          updated_by = (select auth.uid()), updated_at = now()
       where entry_id = v_id;
    end if;
  end if;
  if p_schedule is not null then
    perform private.cb_log_event(p_file, 'schedule_put_in', 'entries', format('Vehicle schedule put into entry %s', v_label), null, null, v_label, '',
      '', left(coalesce(p_schedule ->> 'summary', ''), 300));
    perform set_config('cb.schedule_save', '', true);
  end if;
  return v_id;
end;
$$;
revoke all on function public.cb_save_schedule_entry(uuid, uuid, text, text, text, boolean, jsonb, text, date, text[], integer, jsonb) from public, anon;
grant execute on function public.cb_save_schedule_entry(uuid, uuid, text, text, text, boolean, jsonb, text, date, text[], integer, jsonb) to authenticated, service_role;

-- "Print schedule (PDF)": History records who printed it and when.
create or replace function public.cb_schedule_printed(p_schedule uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_s public.cb_schedules; v_label text;
begin
  perform private.require(private.can_view('closebook'), 'You need View on Closebook.');
  select * into v_s from public.cb_schedules where id = p_schedule;
  perform private.require(v_s.id is not null, 'Schedule not found.');
  v_label := private.cb_entry_label(v_s.entry_id);
  perform private.cb_log_event(v_s.file_id, 'schedule_printed', 'entries', format('Vehicle schedule %s printed', v_label), null, null, v_label, '', '', '');
end;
$$;
revoke all on function public.cb_schedule_printed(uuid) from public, anon;
grant execute on function public.cb_schedule_printed(uuid) to authenticated, service_role;

-- Deleting a schedule's entry deletes its schedule (the foreign key); History records both in one row. Not when the
-- whole file is being deleted (its history goes with it).
create or replace function private.cb_schedule_entry_deleted() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.origin = 'schedule' and exists (select 1 from public.cb_files where id = old.file_id) then
    perform private.cb_log_event(old.file_id, 'schedule_deleted', 'entries', format('Entry %s deleted with its Vehicle schedule', private.cb_entry_label(old.id)),
      null, null, private.cb_entry_label(old.id), '', '', '');
  end if;
  return old;
end;
$$;
revoke all on function private.cb_schedule_entry_deleted() from public, anon, authenticated;
drop trigger if exists cb_schedule_entry_deleted on public.cb_entries;
create trigger cb_schedule_entry_deleted before delete on public.cb_entries for each row execute function private.cb_schedule_entry_deleted();
