-- Round 14: the shareholder loan schedule on step 5, with the s.15(2) repayment date.
-- Benchmark: CaseWare's shareholder loan continuity working paper (opening, movements by kind, closing
-- tied to the trial balance), with its debit-balance checks. The schedule is worked out by the app
-- (src/lib/closebook/sh-loans.ts) from the same postings the reports use, and saved here with a
-- fingerprint of the books, as the GST/HST returns are (round 13). Safe to run twice.

-- ---------------------------------------------------------------------------------------------------
-- 1. Settings: the window for "repaid in the last days of the year" (Settings > Closebook > Thresholds).
-- ---------------------------------------------------------------------------------------------------
alter table public.cb_settings add column if not exists sh_repay_window_days int not null default 30;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cb_settings_sh_window_check') then
    alter table public.cb_settings add constraint cb_settings_sh_window_check check (sh_repay_window_days between 1 and 365);
  end if;
end $$;

create or replace function public.cb_update_sh_window(p_days int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.is_owner(), 'Only an owner changes thresholds.');
  perform private.require(p_days is not null and p_days between 1 and 365, 'Shareholder loan repayment window: a number of days from 1 to 365.');
  update public.cb_settings set sh_repay_window_days = p_days, updated_at = now(), updated_by = (select auth.uid());
end;
$$;
revoke all on function public.cb_update_sh_window(int) from public, anon;
grant execute on function public.cb_update_sh_window(int) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 2. Tables.
-- ---------------------------------------------------------------------------------------------------
-- When the schedule was prepared, and the books it was prepared from.
create table if not exists public.cb_sh_prepared (
  file_id      uuid primary key references public.cb_files (id) on delete cascade,
  fingerprint  text not null,
  prepared_by  uuid references public.staff (id),
  prepared_at  timestamptz not null default now()
);
-- One row per shareholder account, as prepared. Amounts debit positive (the shareholder owes the company).
create table if not exists public.cb_sh_schedules (
  file_id       uuid not null references public.cb_files (id) on delete cascade,
  account_key   text not null,
  number        text not null default '',
  name          text not null default '',
  line_no       text not null default '',
  opening       numeric(14, 2) not null,
  closing       numeric(14, 2) not null,
  tb            numeric(14, 2) not null,
  movements     jsonb not null default '[]',
  flags         text[] not null default '{}' check (flags <@ array['earlier_debit', 'late_repayment']),
  due_on        date,
  prior_due_on  date,
  primary key (file_id, account_key)
);
-- The preparer's answer to a flag, then the reviewer's acceptance. A changed balance needs both again.
create table if not exists public.cb_sh_flags (
  file_id      uuid not null references public.cb_files (id) on delete cascade,
  account_key  text not null,
  flag         text not null check (flag in ('earlier_debit', 'late_repayment')),
  closing      numeric(14, 2) not null,
  note         text not null default '' check (length(note) <= 500),
  noted_by     uuid references public.staff (id),
  noted_at     timestamptz,
  accepted_by  uuid references public.staff (id),
  accepted_at  timestamptz,
  accepted_why text not null default '',
  primary key (file_id, account_key, flag)
);
-- Next year's file: "Repaid by [last year's s.15(2) date]?". Yes needs the evidence (a bank line or an
-- entry on this file); No goes to the reviewer.
create table if not exists public.cb_sh_repaid (
  file_id        uuid not null references public.cb_files (id) on delete cascade,
  account_key    text not null,
  due_on         date not null,
  answer         text not null check (answer in ('yes', 'no')),
  evidence_kind  text check (evidence_kind in ('bank', 'entry')),
  evidence_ref   uuid,
  evidence_label text not null default '' check (length(evidence_label) <= 300),
  note           text not null default '' check (length(note) <= 500),
  answered_by    uuid references public.staff (id),
  answered_at    timestamptz not null default now(),
  accepted_by    uuid references public.staff (id),
  accepted_at    timestamptz,
  accepted_why   text not null default '',
  primary key (file_id, account_key),
  check (answer = 'no' or (evidence_kind is not null and evidence_ref is not null))
);
do $$ declare t text;
begin
  foreach t in array array['cb_sh_prepared', 'cb_sh_schedules', 'cb_sh_flags', 'cb_sh_repaid'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists "Closebook viewers read" on public.%I', t);
    execute format('create policy "Closebook viewers read" on public.%I for select to authenticated using ((select private.can_view(''closebook'')))', t);
    execute format('grant select on public.%I to authenticated', t);
    -- A locked file is read-only everywhere (round 12).
    execute format('drop trigger if exists cb_locked_guard on public.%I', t);
    execute format('create trigger cb_locked_guard before insert or update or delete on public.%I for each row execute function private.cb_locked_guard()', t);
  end loop;
end $$;

-- A changed answer reopens step 5, as any change to a step does. The reviewer's acceptance does not.
-- Re-preparing the schedule writes the same answers back: only a real change counts.
drop trigger if exists cb_changed_sh_flags on public.cb_sh_flags;
drop trigger if exists cb_changed_sh_flags_new on public.cb_sh_flags;
create trigger cb_changed_sh_flags_new after insert on public.cb_sh_flags for each row
  execute function private.cb_changed('entries', 'A shareholder loan flag was raised');
create trigger cb_changed_sh_flags after update of note on public.cb_sh_flags for each row when (old.note is distinct from new.note)
  execute function private.cb_changed('entries', 'A shareholder loan flag answer changed');
drop trigger if exists cb_changed_sh_repaid on public.cb_sh_repaid;
create trigger cb_changed_sh_repaid after insert or update of answer, evidence_ref, note on public.cb_sh_repaid for each row
  execute function private.cb_changed('entries', 'A shareholder loan repayment answer changed');

-- ---------------------------------------------------------------------------------------------------
-- 3. The books the schedule rests on: the trial balance, plus the dates and amounts of bank lines and
-- entries (a re-dated line can change the late-repayment flag without changing a balance).
-- ---------------------------------------------------------------------------------------------------
create or replace function private.cb_sh_fingerprint(p_file uuid) returns text
language sql stable security definer set search_path = '' as $$
  select md5(private.cb_tb_fingerprint(p_file)
    || coalesce((select string_agg(l.id::text || l.txn_date::text || l.amount::text || l.status || coalesce(l.chart_account, ''), ',' order by l.id) from public.cb_bank_lines l where l.file_id = p_file), '')
    || coalesce((select string_agg(e.id::text || coalesce(e.entry_date::text, '') || coalesce(e.origin, ''), ',' order by e.id) from public.cb_entries e where e.file_id = p_file), ''))
$$;
-- Whether the file has a shareholder account: an account on a due to or due from shareholder line.
create or replace function private.cb_sh_applies(p_file uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.cb_accounts a where a.file_id = p_file
     and left(coalesce(a.line_no, ''), 4) in ('1301', '1302', '1303', '2780', '2781', '2782', '2783', '3260', '3261', '3262', '3263')
     and (a.this_year <> 0 or a.last_year <> 0 or private.cb_account_final(a.id) <> 0))
$$;
revoke all on function private.cb_sh_fingerprint(uuid), private.cb_sh_applies(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 4. Prepare, answer, accept.
-- ---------------------------------------------------------------------------------------------------
-- p_rows: [{account_key, number, name, line_no, opening, closing, tb, movements, flags, due_on, prior_due_on}]
create or replace function public.cb_prepare_sh_schedule(p_file uuid, p_rows jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files; x jsonb; f text;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(jsonb_typeof(p_rows) = 'array', 'The schedule could not be worked out.');
  delete from public.cb_sh_schedules where file_id = p_file;
  for x in select * from jsonb_array_elements(p_rows) loop
    perform private.require((x ->> 'closing')::numeric <= 0 or (x ->> 'due_on')::date = (v_file.year_end + interval '1 year')::date,
      'The s.15(2) date is one year after the year end.');
    insert into public.cb_sh_schedules (file_id, account_key, number, name, line_no, opening, closing, tb, movements, flags, due_on, prior_due_on)
    values (p_file, x ->> 'account_key', coalesce(x ->> 'number', ''), coalesce(x ->> 'name', ''), coalesce(x ->> 'line_no', ''),
      round((x ->> 'opening')::numeric, 2), round((x ->> 'closing')::numeric, 2), round((x ->> 'tb')::numeric, 2), coalesce(x -> 'movements', '[]'),
      coalesce(array(select jsonb_array_elements_text(x -> 'flags')), '{}'), nullif(x ->> 'due_on', '')::date, nullif(x ->> 'prior_due_on', '')::date);
    -- Each flag keeps its answer while the balance is the same; a changed balance needs the answer again.
    for f in select jsonb_array_elements_text(x -> 'flags') loop
      insert into public.cb_sh_flags (file_id, account_key, flag, closing) values (p_file, x ->> 'account_key', f, round((x ->> 'closing')::numeric, 2))
      on conflict (file_id, account_key, flag) do update set closing = excluded.closing,
        note = case when public.cb_sh_flags.closing = excluded.closing then public.cb_sh_flags.note else '' end,
        noted_by = case when public.cb_sh_flags.closing = excluded.closing then public.cb_sh_flags.noted_by end,
        noted_at = case when public.cb_sh_flags.closing = excluded.closing then public.cb_sh_flags.noted_at end,
        accepted_by = case when public.cb_sh_flags.closing = excluded.closing then public.cb_sh_flags.accepted_by end,
        accepted_at = case when public.cb_sh_flags.closing = excluded.closing then public.cb_sh_flags.accepted_at end,
        accepted_why = case when public.cb_sh_flags.closing = excluded.closing then public.cb_sh_flags.accepted_why else '' end;
    end loop;
  end loop;
  -- Flags no longer raised, and repayment questions no longer asked, go.
  delete from public.cb_sh_flags g where g.file_id = p_file
    and not exists (select 1 from public.cb_sh_schedules s where s.file_id = p_file and s.account_key = g.account_key and g.flag = any (s.flags));
  delete from public.cb_sh_repaid r where r.file_id = p_file
    and not exists (select 1 from public.cb_sh_schedules s where s.file_id = p_file and s.account_key = r.account_key and s.prior_due_on = r.due_on);
  insert into public.cb_sh_prepared (file_id, fingerprint, prepared_by) values (p_file, private.cb_sh_fingerprint(p_file), (select auth.uid()))
  on conflict (file_id) do update set fingerprint = excluded.fingerprint, prepared_by = excluded.prepared_by, prepared_at = now();
  perform private.cb_log(p_file, 'sh_prepared', 'entries', format('Shareholder loan schedule prepared: %s account%s', jsonb_array_length(p_rows), case when jsonb_array_length(p_rows) = 1 then '' else 's' end));
end;
$$;

create or replace function public.cb_answer_sh_flag(p_file uuid, p_account text, p_flag text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(length(btrim(coalesce(p_note, ''))) >= 3, 'Say what the reviewer needs to know.');
  update public.cb_sh_flags set note = left(btrim(p_note), 500), noted_by = (select auth.uid()), noted_at = now(),
    accepted_by = null, accepted_at = null, accepted_why = ''
   where file_id = p_file and account_key = p_account and flag = p_flag;
  perform private.require(found, 'Prepare the schedule first.');
  perform private.cb_log(p_file, 'sh_flag_answered', 'entries', format('%s: %s', p_account, btrim(p_note)));
end;
$$;

create or replace function public.cb_accept_sh_flag(p_file uuid, p_account text, p_flag text, p_why text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files; g public.cb_sh_flags;
begin
  perform private.require(private.is_owner(), 'Only the reviewer accepts a shareholder loan flag. Reviewers are owners.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(length(btrim(coalesce(p_why, ''))) >= 3, 'Say why the flag is accepted.');
  select * into g from public.cb_sh_flags where file_id = p_file and account_key = p_account and flag = p_flag;
  perform private.require(g.file_id is not null and g.note <> '', 'The preparer answers the flag first.');
  update public.cb_sh_flags set accepted_by = (select auth.uid()), accepted_at = now(), accepted_why = btrim(p_why)
   where file_id = p_file and account_key = p_account and flag = p_flag;
  perform private.cb_log(p_file, 'sh_flag_accepted', 'entries', format('%s accepted: %s', p_account, btrim(p_why)));
end;
$$;

-- "Repaid by [date]?" Yes: the bank line or entry on this file that shows it. No: a note for the reviewer.
create or replace function public.cb_answer_sh_repaid(p_file uuid, p_account text, p_answer text, p_kind text, p_ref uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files; s public.cb_sh_schedules; v_label text;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  select * into s from public.cb_sh_schedules where file_id = p_file and account_key = p_account;
  perform private.require(s.prior_due_on is not null, 'There is no repayment question for this account.');
  perform private.require(p_answer in ('yes', 'no'), 'Answer Yes or No.');
  if p_answer = 'yes' then
    perform private.require(p_kind in ('bank', 'entry') and p_ref is not null, 'Yes: attach the evidence, the bank line or entry that shows the repayment.');
    if p_kind = 'bank' then
      select format('%s %s %s', to_char(l.txn_date, 'Mon FMDD, YYYY'), l.description, private.cb_money(l.amount)) into v_label from public.cb_bank_lines l where l.id = p_ref and l.file_id = p_file;
    else
      select format('Entry %s-%s %s', to_char(v_file.year_end, 'YYYY'), lpad(e.seq::text, 3, '0'), e.note) into v_label from public.cb_entries e where e.id = p_ref and e.file_id = p_file;
    end if;
    perform private.require(v_label is not null, 'The evidence must be a bank line or entry on this file.');
  else
    perform private.require(length(btrim(coalesce(p_note, ''))) >= 3, 'No: say what happened, for the reviewer.');
  end if;
  insert into public.cb_sh_repaid (file_id, account_key, due_on, answer, evidence_kind, evidence_ref, evidence_label, note, answered_by)
  values (p_file, p_account, s.prior_due_on, p_answer, case when p_answer = 'yes' then p_kind end, case when p_answer = 'yes' then p_ref end,
    coalesce(left(v_label, 300), ''), left(btrim(coalesce(p_note, '')), 500), (select auth.uid()))
  on conflict (file_id, account_key) do update set due_on = excluded.due_on, answer = excluded.answer, evidence_kind = excluded.evidence_kind, evidence_ref = excluded.evidence_ref,
    evidence_label = excluded.evidence_label, note = excluded.note, answered_by = excluded.answered_by, answered_at = now(),
    accepted_by = null, accepted_at = null, accepted_why = '';
  perform private.cb_log(p_file, 'sh_repaid_answered', 'entries', format('%s: repaid by %s? %s%s', p_account, s.prior_due_on,
    case when p_answer = 'yes' then 'Yes, ' || v_label else 'No' end, case when btrim(coalesce(p_note, '')) <> '' then '. ' || btrim(p_note) else '' end));
end;
$$;

create or replace function public.cb_accept_sh_repaid(p_file uuid, p_account text, p_why text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files; r public.cb_sh_repaid;
begin
  perform private.require(private.is_owner(), 'Only the reviewer accepts a loan not repaid by its s.15(2) date. Reviewers are owners.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(length(btrim(coalesce(p_why, ''))) >= 3, 'Say what was decided (for example, the amount included in income).');
  select * into r from public.cb_sh_repaid where file_id = p_file and account_key = p_account;
  perform private.require(r.file_id is not null and r.answer = 'no', 'There is no unpaid loan to accept.');
  update public.cb_sh_repaid set accepted_by = (select auth.uid()), accepted_at = now(), accepted_why = btrim(p_why) where file_id = p_file and account_key = p_account;
  perform private.cb_log(p_file, 'sh_repaid_accepted', 'entries', format('%s not repaid by %s, accepted: %s', p_account, r.due_on, btrim(p_why)));
end;
$$;
revoke all on function public.cb_prepare_sh_schedule(uuid, jsonb), public.cb_answer_sh_flag(uuid, text, text, text), public.cb_accept_sh_flag(uuid, text, text, text),
  public.cb_answer_sh_repaid(uuid, text, text, text, uuid, text), public.cb_accept_sh_repaid(uuid, text, text) from public, anon;
grant execute on function public.cb_prepare_sh_schedule(uuid, jsonb), public.cb_answer_sh_flag(uuid, text, text, text), public.cb_accept_sh_flag(uuid, text, text, text),
  public.cb_answer_sh_repaid(uuid, text, text, text, uuid, text), public.cb_accept_sh_repaid(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 5. Step 5: what the schedule still needs, and what waits for the reviewer.
-- ---------------------------------------------------------------------------------------------------
create or replace function private.cb_sh_problems(p_file uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v_out text[] := '{}'; v_n int; p public.cb_sh_prepared;
begin
  if not private.cb_sh_applies(p_file) then return v_out; end if;
  select * into p from public.cb_sh_prepared where file_id = p_file;
  if p.file_id is null then return v_out || 'Shareholder loan schedule: prepare it.'::text; end if;
  if p.fingerprint <> private.cb_sh_fingerprint(p_file) then
    return v_out || 'Shareholder loan schedule: the books changed after it was prepared. Prepare it again.'::text;
  end if;
  select count(*) into v_n from public.cb_sh_schedules where file_id = p_file and closing <> tb;
  if v_n > 0 then v_out := v_out || format('Shareholder loan schedule: %s account%s do%s not tie to the trial balance.', v_n, case when v_n = 1 then '' else 's' end, case when v_n = 1 then 'es' else '' end); end if;
  select count(*) into v_n from public.cb_sh_flags where file_id = p_file and note = '';
  if v_n > 0 then v_out := v_out || format('Shareholder loan schedule: answer %s flag%s for the reviewer.', v_n, case when v_n = 1 then '' else 's' end); end if;
  select count(*) into v_n from public.cb_sh_schedules s where s.file_id = p_file and s.prior_due_on is not null
     and not exists (select 1 from public.cb_sh_repaid r where r.file_id = p_file and r.account_key = s.account_key and r.due_on = s.prior_due_on);
  if v_n > 0 then v_out := v_out || format('Shareholder loan schedule: answer "Repaid by" for %s account%s.', v_n, case when v_n = 1 then '' else 's' end); end if;
  return v_out;
end;
$$;

create or replace function private.cb_sh_waiting(p_file uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v_out text[] := '{}'; v_n int;
begin
  select count(*) into v_n from public.cb_sh_flags where file_id = p_file and note <> '' and accepted_at is null;
  if v_n > 0 then v_out := v_out || format('%s shareholder loan flag%s for the reviewer.', v_n, case when v_n = 1 then '' else 's' end); end if;
  select count(*) into v_n from public.cb_sh_repaid where file_id = p_file and answer = 'no' and accepted_at is null;
  if v_n > 0 then v_out := v_out || format('%s shareholder loan%s not repaid by the s.15(2) date.', v_n, case when v_n = 1 then '' else 's' end); end if;
  return v_out;
end;
$$;
revoke all on function private.cb_sh_problems(uuid), private.cb_sh_waiting(uuid) from public, anon, authenticated;

-- Step 5's own rules (round 9, unchanged) plus the schedule.
create or replace function private.cb_step5_problems(p_file uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb := private.cb_revenue_state(p_file);
  v_out text[] := '{}';
  v_file public.cb_files;
begin
  select * into v_file from public.cb_files where id = p_file;
  if (v ->> 'realtor')::boolean and (v ->> 'n_commission')::int = 0 then
    v_out := v_out || 'Revenue check: enter the brokerage''s commission statement.'::text;
  elsif (v ->> 'n_sources')::int = 0 then
    v_out := v_out || 'Revenue check: enter the revenue source and attach it.'::text;
  elsif (v ->> 'diff')::numeric <> 0 and not (v ->> 'explained')::boolean then
    v_out := v_out || case when v ->> 'explanation' = '' then 'Revenue check: explain the difference, or fix it with an entry.'
      else 'Revenue check: the difference changed since it was explained. Check the explanation and save it again.' end;
  end if;
  if (v ->> 'registrant')::boolean then
    if (v ->> 'n_gst')::int = 0 then v_out := v_out || 'Revenue check: enter the revenue on the year''s GST/HST returns.'::text;
    elsif (v ->> 'gst_diff')::numeric <> 0 and not (v ->> 'gst_explained')::boolean then v_out := v_out || 'Revenue check: explain the difference with the GST/HST returns.'::text;
    end if;
  end if;
  if (v ->> 'realtor')::boolean then
    if (v ->> 'n_t4a')::int = 0 and not (v ->> 't4a_none')::boolean then v_out := v_out || 'Revenue check: enter the brokerage''s T4A, or say there is none.'::text;
    elsif (v ->> 'n_t4a')::int > 0 and (v ->> 't4a_diff')::numeric <> 0 and not (v ->> 't4a_explained')::boolean then
      v_out := v_out || 'Revenue check: explain the difference between the T4A and the commission statement.'::text;
    end if;
  end if;
  return v_out || private.cb_sh_problems(p_file);
end;
$$;

create or replace function private.cb_step5_waiting(p_file uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb := private.cb_revenue_state(p_file);
  v_out text[] := '{}';
begin
  if (v ->> 'waiting')::boolean then v_out := v_out || format('Revenue difference of %s, over the review threshold.', private.cb_money((v ->> 'diff')::numeric)); end if;
  if (v ->> 'gst_waiting')::boolean then v_out := v_out || format('GST/HST returns difference of %s, over the review threshold.', private.cb_money((v ->> 'gst_diff')::numeric)); end if;
  if (v ->> 't4a_waiting')::boolean then v_out := v_out || format('T4A difference of %s, over the review threshold.', private.cb_money((v ->> 't4a_diff')::numeric)); end if;
  return v_out || private.cb_sh_waiting(p_file);
end;
$$;
revoke all on function private.cb_step5_problems(uuid), private.cb_step5_waiting(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 6. My day: each s.15(2) date not yet confirmed as repaid in the client's next file. Owners see every
-- file; other staff see the files they prepare.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.cb_sh_due_list() returns table (
  file_id uuid, client_id uuid, client_name text, year_end date, account_key text, number text, name text, closing numeric, due_on date,
  next_file uuid, answer text)
language sql stable security definer set search_path = '' as $$
  select s.file_id, f.client_id, c.legal_name, f.year_end, s.account_key, s.number, s.name, s.closing, s.due_on, n.id, r.answer
    from public.cb_sh_schedules s
    join public.cb_files f on f.id = s.file_id
    join public.clients c on c.id = f.client_id
    left join lateral (select x.id from public.cb_files x where x.client_id = f.client_id and x.year_start > f.year_end order by x.year_start limit 1) n on true
    -- The answer in the next file is on the same account, or on its pair: a debit balance on 23000 Due to
    -- shareholder 1 carries to 13000 Due from shareholder 1 (the master lines' pairs).
    left join lateral (select r.answer from public.cb_sh_repaid r join public.cb_sh_schedules s2 on s2.file_id = r.file_id and s2.account_key = r.account_key
       where r.file_id = n.id and r.due_on = s.due_on
         and (r.account_key = s.account_key or s2.line_no = s.line_no or s2.line_no = (select m.pair_line from public.cb_master_lines m where m.line_no = s.line_no))
       order by (r.answer = 'yes') desc limit 1) r on true
   where s.due_on is not null and private.can_view('closebook')
     and (private.is_owner() or f.preparer_id = (select auth.uid()))
     and coalesce(r.answer, '') <> 'yes'
   order by s.due_on, c.legal_name, s.number
$$;
revoke all on function public.cb_sh_due_list() from public, anon;
grant execute on function public.cb_sh_due_list() to authenticated;

-- The screen's view of the rules above: whether the schedule is current, what is open, what waits.
create or replace function public.cb_sh_status(p_file uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p public.cb_sh_prepared;
begin
  perform private.require(private.can_view('closebook'), 'You need View on Closebook.');
  select * into p from public.cb_sh_prepared where file_id = p_file;
  return jsonb_build_object('applies', private.cb_sh_applies(p_file), 'prepared_at', p.prepared_at, 'prepared_by', p.prepared_by,
    'stale', p.file_id is not null and p.fingerprint <> private.cb_sh_fingerprint(p_file),
    'problems', to_jsonb(private.cb_sh_problems(p_file)), 'waiting', to_jsonb(private.cb_sh_waiting(p_file)));
end;
$$;
revoke all on function public.cb_sh_status(uuid) from public, anon;
grant execute on function public.cb_sh_status(uuid) to authenticated;
