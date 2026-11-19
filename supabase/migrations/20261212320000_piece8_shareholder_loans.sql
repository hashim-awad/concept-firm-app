-- Piece 8, version 5 (Hashim, Nov 18, 2026; benchmark CaseWare Cloud): shareholder loans move to Reporting and to the reviewer.
--   * Step 5 no longer needs the shareholder loan schedule; its flags no longer wait there.
--   * Step 7 needs, for a file with a shareholder account: the figures saved and current ("Update"), each account's shareholder
--     picked, each flag decided, "Repaid by" confirmed for a balance owed at the start, and, for each account owed by the
--     shareholder at year-end, the reviewer's "Noted: repay by <date>" (cb_sh_noted; Hashim's answer, Nov 18, 2026).
--   * A change to these answers clears step 7 only (the triggers on cb_sh_flags, cb_sh_repaid and cb_sh_noted now name step 7).
--   * cb_sh_names: an optional shareholder name on a shareholder account, per file, logged in History; the app reads the
--     client's latest earlier file when this file has none, so it rolls forward. It changes nothing on the statements.
-- Existing answers are kept. No table or column is dropped. No data is changed. Safe to run twice.

create table if not exists public.cb_sh_noted (
  file_id     uuid not null references public.cb_files (id) on delete cascade,
  account_key text not null,
  closing     numeric(14, 2) not null,
  due_on      date not null,
  noted_by    uuid references public.staff (id),
  noted_at    timestamptz not null default now(),
  primary key (file_id, account_key)
);
create table if not exists public.cb_sh_names (
  file_id     uuid not null references public.cb_files (id) on delete cascade,
  account_key text not null,
  name        text not null default '' check (length(name) <= 120),
  updated_by  uuid references public.staff (id),
  updated_at  timestamptz not null default now(),
  primary key (file_id, account_key)
);
do $$ declare t text;
begin
  foreach t in array array['cb_sh_noted', 'cb_sh_names'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists "Closebook viewers read" on public.%I', t);
    execute format('create policy "Closebook viewers read" on public.%I for select to authenticated using ((select private.can_view(''closebook'')))', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop trigger if exists cb_locked_guard on public.%I', t);
    execute format('create trigger cb_locked_guard before insert or update or delete on public.%I for each row execute function private.cb_locked_guard()', t);
  end loop;
end $$;

-- A changed answer reopens step 7 only (it reopened step 5 before piece 8).
drop trigger if exists cb_changed_sh_flags on public.cb_sh_flags;
drop trigger if exists cb_changed_sh_flags_new on public.cb_sh_flags;
drop trigger if exists cb_changed_sh_flags_accept on public.cb_sh_flags;
create trigger cb_changed_sh_flags_new after insert on public.cb_sh_flags for each row
  execute function private.cb_changed('review', 'A shareholder loan flag was raised');
create trigger cb_changed_sh_flags after update of note on public.cb_sh_flags for each row when (old.note is distinct from new.note)
  execute function private.cb_changed('review', 'A shareholder loan flag answer changed');
create trigger cb_changed_sh_flags_accept after update of accepted_at, accepted_kind, accepted_year, accepted_why on public.cb_sh_flags for each row
  when (old.accepted_at is distinct from new.accepted_at or old.accepted_kind is distinct from new.accepted_kind
        or old.accepted_year is distinct from new.accepted_year or old.accepted_why is distinct from new.accepted_why)
  execute function private.cb_changed('review', 'The reviewer''s shareholder loan decision changed');
drop trigger if exists cb_changed_sh_repaid on public.cb_sh_repaid;
create trigger cb_changed_sh_repaid after insert or update of repaid, unpaid, due_on on public.cb_sh_repaid for each row
  execute function private.cb_changed('review', 'A shareholder loan repayment was confirmed');
drop trigger if exists cb_changed_sh_noted on public.cb_sh_noted;
create trigger cb_changed_sh_noted after insert or update or delete on public.cb_sh_noted for each row
  execute function private.cb_changed('review', 'A shareholder loan repay-by date was noted');

-- Step 7's shareholder loan items.
create or replace function private.cb_sh_review_problems(p_file uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v_out text[] := '{}'; v_n int; p public.cb_sh_prepared; v_end date;
begin
  if not private.cb_sh_applies(p_file) then return v_out; end if;
  select * into p from public.cb_sh_prepared where file_id = p_file;
  if p.file_id is null then return v_out || 'Shareholder loans: click Update to work out the figures.'::text; end if;
  if p.fingerprint <> private.cb_sh_fingerprint(p_file) then
    return v_out || 'Shareholder loans: the books changed. Click Update.'::text;
  end if;
  select count(*) into v_n from public.cb_sh_schedules where file_id = p_file and shareholder is null;
  if v_n > 0 then v_out := v_out || format('Shareholder loans: pick the shareholder for %s account%s.', v_n, case when v_n = 1 then '' else 's' end); end if;
  select count(*) into v_n from public.cb_sh_flags where file_id = p_file and accepted_at is null;
  if v_n > 0 then v_out := v_out || format('Shareholder loans: decide %s flag%s.', v_n, case when v_n = 1 then '' else 's' end); end if;
  select count(*) into v_n from public.cb_sh_groups g where g.file_id = p_file and g.prior_due_on is not null
     and not exists (select 1 from public.cb_sh_repaid r where r.file_id = p_file and r.account_key = g.group_key and r.due_on = g.prior_due_on
                        and r.repaid = g.prior_repaid and r.unpaid = g.prior_unpaid);
  if v_n > 0 then v_out := v_out || format('Shareholder loans: confirm "Repaid by" for %s shareholder%s.', v_n, case when v_n = 1 then '' else 's' end); end if;
  select year_end into v_end from public.cb_files where id = p_file;
  select count(*) into v_n from public.cb_sh_schedules s where s.file_id = p_file and s.closing > 0
     and not exists (select 1 from public.cb_sh_noted n where n.file_id = p_file and n.account_key = s.account_key
                        and n.closing = s.closing and n.due_on = (v_end + interval '1 year')::date);
  if v_n > 0 then v_out := v_out || format('Shareholder loans: note the repay-by date for %s account%s owed by the shareholder.', v_n, case when v_n = 1 then '' else 's' end); end if;
  return v_out;
end;
$$;
revoke all on function private.cb_sh_review_problems(uuid) from public, anon, authenticated;

-- "Noted: repay by <date>": the reviewer notes an account owed by the shareholder at year-end (s.15(2.6): one year after it).
create or replace function public.cb_note_sh_due(p_file uuid, p_account text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files; s public.cb_sh_schedules; v_due date;
begin
  perform private.require(private.is_owner(), 'Only the reviewer notes the repay-by date. Reviewers are owners.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(exists (select 1 from public.cb_sh_prepared p where p.file_id = p_file and p.fingerprint = private.cb_sh_fingerprint(p_file)),
    'The books changed. Click Update first.');
  select * into s from public.cb_sh_schedules where file_id = p_file and account_key = p_account;
  perform private.require(s.file_id is not null and s.closing > 0, 'This account is not owed by the shareholder at year-end.');
  v_due := (v_file.year_end + interval '1 year')::date;
  insert into public.cb_sh_noted (file_id, account_key, closing, due_on, noted_by) values (p_file, p_account, s.closing, v_due, (select auth.uid()))
  on conflict (file_id, account_key) do update set closing = excluded.closing, due_on = excluded.due_on, noted_by = excluded.noted_by, noted_at = now();
  perform private.cb_log(p_file, 'sh_due_noted', 'review', format('%s %s: owed by the shareholder at year-end %s; repay by %s',
    s.number, s.name, private.cb_money(s.closing), to_char(v_due, 'Mon FMDD, YYYY')));
end;
$$;
revoke all on function public.cb_note_sh_due(uuid, text) from public, anon;
grant execute on function public.cb_note_sh_due(uuid, text) to authenticated;

-- The shareholder's name on a shareholder account ("Who is who"). Blank clears it. Every change goes to History.
create or replace function public.cb_set_sh_name(p_file uuid, p_account text, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files; a public.cb_accounts; v_name text := btrim(coalesce(p_name, '')); v_old text;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(length(v_name) <= 120, 'Keep the name to 120 characters.');
  select * into a from public.cb_accounts where file_id = p_file and account_key = p_account limit 1;
  perform private.require(a.id is not null and left(coalesce(a.line_no, ''), 4) in ('1301', '1302', '1303', '2180', '2181', '2182', '2183', '2780', '2781', '2782', '2783', '3260', '3261', '3262', '3263')
    and p_account not in ('chart:13100', 'chart:23150', 'chart:25450'), 'Only a shareholder account takes a shareholder name.');
  select name into v_old from public.cb_sh_names where file_id = p_file and account_key = p_account;
  if coalesce(v_old, '') = v_name and v_old is not null then return; end if;
  insert into public.cb_sh_names (file_id, account_key, name, updated_by) values (p_file, p_account, v_name, (select auth.uid()))
  on conflict (file_id, account_key) do update set name = excluded.name, updated_by = excluded.updated_by, updated_at = now();
  perform private.cb_log(p_file, 'sh_name', null, format('%s %s: shareholder %s', coalesce(nullif(a.number, ''), p_account), a.name,
    case when v_name = '' then 'name removed' else format('"%s"', v_name) end || case when coalesce(v_old, '') <> '' then format(' (was "%s")', v_old) else '' end));
end;
$$;
revoke all on function public.cb_set_sh_name(uuid, text, text) from public, anon;
grant execute on function public.cb_set_sh_name(uuid, text, text) to authenticated;

CREATE OR REPLACE FUNCTION private.cb_step5_problems(p_file uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v jsonb := private.cb_revenue_state(p_file);
  v_out text[] := '{}';
  v_file public.cb_files;
begin
  select * into v_file from public.cb_files where id = p_file;
  -- Piece 7: the revenue check is required only once it was added (by "+ Add revenue check", or saved before piece 7).
  if not private.cb_revenue_added(p_file) then return v_out; end if;
  if (v ->> 'realtor')::boolean and (v ->> 'n_commission')::int = 0 then
    v_out := v_out || 'Revenue check: enter the brokerage''s commission statement.'::text;
  elsif (v ->> 'n_sources')::int = 0 then
    v_out := v_out || 'Revenue check: enter the revenue source and attach it.'::text;
  elsif (v ->> 'diff')::numeric <> 0 and not (v ->> 'explained')::boolean then
    v_out := v_out || case when v ->> 'explanation' = '' then 'Revenue check: explain the difference, or fix it with an entry.'
      else 'Revenue check: the difference changed since it was explained. Check the explanation and save it again.' end;
  end if;
  -- Piece 7: the comparison with the GST/HST returns moved to step 8 (private.cb_gst_revenue_problems).
  if (v ->> 'realtor')::boolean then
    if (v ->> 'n_t4a')::int = 0 and not (v ->> 't4a_none')::boolean then v_out := v_out || 'Revenue check: enter the brokerage''s T4A, or say there is none.'::text;
    elsif (v ->> 'n_t4a')::int > 0 and (v ->> 't4a_diff')::numeric <> 0 and not (v ->> 't4a_explained')::boolean then
      v_out := v_out || 'Revenue check: explain the difference between the T4A and the commission statement.'::text;
    end if;
  end if;
  -- Piece 8: the shareholder loans are no longer step 5's (Reporting, and the reviewer in step 7).
  return v_out;
end;
$$;

CREATE OR REPLACE FUNCTION private.cb_step5_waiting(p_file uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
declare v jsonb := private.cb_revenue_state(p_file);
  v_out text[] := '{}';
begin
  if (v ->> 'waiting')::boolean then v_out := v_out || format('Revenue difference of %s, over the review threshold.', private.cb_money((v ->> 'diff')::numeric)); end if;
  -- Piece 7: the GST/HST returns difference waits in step 8 (private.cb_gst_revenue_problems).
  if (v ->> 't4a_waiting')::boolean then v_out := v_out || format('T4A difference of %s, over the review threshold.', private.cb_money((v ->> 't4a_diff')::numeric)); end if;
  -- Piece 8: the shareholder loan flags wait in step 7 (private.cb_sh_review_problems).
  return v_out;
end;
$$;

CREATE OR REPLACE FUNCTION private.cb_review_problems(p_file uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_out text[] := '{}';
  v_n int;
  v_names text;
begin
  select string_agg(n.label, ', ' order by n.ord) into v_names from (values
    ('setup', 'step 1', 1), ('opening', 'step 2', 2), ('records', 'step 3', 3), ('code', 'step 4', 4), ('entries', 'step 5', 5), ('mapping', 'step 6', 6)) n(step, label, ord)
   where not exists (select 1 from public.cb_step_signoffs s where s.file_id = p_file and s.step = n.step and s.reviewed_at is not null);
  if v_names is not null then v_out := v_out || format('Review %s first.', v_names); end if;
  select count(*) into v_n from public.cb_review_notes where file_id = p_file and status <> 'cleared';
  if v_n > 0 then v_out := v_out || format('%s review note%s still open.', v_n, case when v_n = 1 then '' else 's' end); end if;
  select count(*) into v_n from (select unnest(private.cb_step_waiting(p_file, s)) w from unnest(array['opening', 'code', 'entries', 'mapping']) s) x
   where w not like '%review note%';
  -- Piece 7: the GST/HST returns difference (now in step 8) still waits for the reviewer here, as it did from step 5.
  if coalesce((private.cb_revenue_state(p_file) ->> 'gst_waiting')::boolean, false) then v_n := v_n + 1; end if;
  if v_n > 0 then v_out := v_out || 'Items still wait for the reviewer: see the list above.'::text; end if;
  -- Piece 8: the shareholder loans, answered by the reviewer here.
  return v_out || private.cb_sh_review_problems(p_file);
end;
$$;

CREATE OR REPLACE FUNCTION public.cb_accept_sh_flag(p_file uuid, p_account text, p_flag text, p_why text, p_kind text DEFAULT ''::text, p_year integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare v_file public.cb_files; g public.cb_sh_flags; v_why text := btrim(coalesce(p_why, '')); v_kind text := coalesce(p_kind, '');
begin
  perform private.require(private.is_owner(), 'Only the reviewer accepts a shareholder loan flag. Reviewers are owners.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  select * into g from public.cb_sh_flags where file_id = p_file and account_key = p_account and flag = p_flag;
  -- Piece 8: the reviewer answers the flag in step 7; no preparer's answer is needed first.
  perform private.require(g.file_id is not null, 'There is no such flag. Click Update first.');
  if p_flag = 'earlier_debit' then
    perform private.require(v_kind in ('included', 'not_included'), 'Pick the decision: included in the shareholder''s income, or not included.');
    if v_kind = 'included' then
      perform private.require(p_year between 1990 and extract(year from v_file.year_end)::int, 'Pick the year the amount is included in the shareholder''s income.');
      v_why := format('Included in the shareholder''s income for %s', p_year);
    else
      perform private.require(length(v_why) >= 3, 'Say why the amount is not included.');
    end if;
  else
    perform private.require(length(v_why) >= 3, 'Say why the flag is accepted.');
    v_kind := '';
  end if;
  update public.cb_sh_flags set accepted_by = (select auth.uid()), accepted_at = now(), accepted_why = v_why, accepted_kind = v_kind,
         accepted_year = case when v_kind = 'included' then p_year end
   where file_id = p_file and account_key = p_account and flag = p_flag;
  perform private.cb_log(p_file, 'sh_flag_accepted', 'review', format('%s accepted: %s', p_account,
    case when v_kind = 'not_included' then 'Not included: ' || v_why else v_why end));
end;
$$;

CREATE OR REPLACE FUNCTION public.cb_confirm_sh_repaid(p_file uuid, p_group text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare v_file public.cb_files; g public.cb_sh_groups;
begin
  perform private.require(private.is_owner(), 'Only the reviewer confirms "Repaid by". Reviewers are owners.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(not exists (select 1 from public.cb_sh_prepared p where p.file_id = p_file and p.fingerprint <> private.cb_sh_fingerprint(p_file)),
    'The books changed. Click Update first.');
  select * into g from public.cb_sh_groups where file_id = p_file and group_key = p_group;
  perform private.require(g.prior_due_on is not null, 'There is no balance owed at the start of the year to confirm.');
  insert into public.cb_sh_repaid (file_id, account_key, due_on, opening, repaid, unpaid, answered_by)
  values (p_file, p_group, g.prior_due_on, g.prior_opening, g.prior_repaid, g.prior_unpaid, (select auth.uid()))
  on conflict (file_id, account_key) do update set due_on = excluded.due_on, opening = excluded.opening, repaid = excluded.repaid, unpaid = excluded.unpaid,
    answered_by = excluded.answered_by, answered_at = now();
  perform private.cb_log(p_file, 'sh_repaid_confirmed', 'review', format('%s: owed %s at the start of the year; repaid by %s: %s; not repaid: %s',
    private.cb_sh_label(p_group), private.cb_money(g.prior_opening), to_char(g.prior_due_on, 'Mon FMDD, YYYY'), private.cb_money(g.prior_repaid), private.cb_money(g.prior_unpaid)));
end;
$$;

CREATE OR REPLACE FUNCTION public.cb_prepare_sh_schedule(p_file uuid, p_rows jsonb, p_groups jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare v_file public.cb_files; x jsonb; f text; v_amt numeric;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(jsonb_typeof(p_rows) = 'array' and jsonb_typeof(p_groups) = 'array', 'The schedule could not be worked out.');
  delete from public.cb_sh_schedules where file_id = p_file;
  for x in select * from jsonb_array_elements(p_rows) loop
    insert into public.cb_sh_schedules (file_id, account_key, number, name, line_no, opening, closing, tb, movements, shareholder, owner_source)
    values (p_file, x ->> 'account_key', coalesce(x ->> 'number', ''), coalesce(x ->> 'name', ''), coalesce(x ->> 'line_no', ''),
      round((x ->> 'opening')::numeric, 2), round((x ->> 'closing')::numeric, 2), round((x ->> 'tb')::numeric, 2), coalesce(x -> 'movements', '[]'),
      nullif(x ->> 'shareholder', '')::smallint, coalesce(x ->> 'owner_source', ''));
    -- A pick rolled forward from the client's last file is kept on this file, so it rolls on.
    if x ->> 'owner_source' = 'rolled' then
      insert into public.cb_sh_owners (file_id, account_key, shareholder, source, picked_by) values (p_file, x ->> 'account_key', (x ->> 'shareholder')::smallint, 'rolled', (select auth.uid()))
      on conflict (file_id, account_key) do nothing;
    end if;
  end loop;
  delete from public.cb_sh_groups where file_id = p_file;
  for x in select * from jsonb_array_elements(p_groups) loop
    perform private.require(case when (x ->> 'this_part')::numeric > 0 then (x ->> 'due_on')::date = (v_file.year_end + interval '1 year')::date else coalesce(x ->> 'due_on', '') = '' end,
      'The s.15(2) date of this year''s part is one year after the year end.');
    perform private.require(round((x ->> 'last_part')::numeric + (x ->> 'this_part')::numeric + coalesce((x ->> 'decided_left')::numeric, 0), 2) = greatest(round((x ->> 'closing')::numeric, 2), 0) or x ->> 'group_key' like 'none:%',
      'Decided amounts, last year''s part and this year''s part add up to the balance owed at year end.');
    insert into public.cb_sh_groups (file_id, group_key, shareholder, accounts, opening, closing, reductions, last_part, this_part, due_on, prior_due_on, prior_opening, prior_repaid, prior_unpaid, flags, decided_left, decided)
    values (p_file, x ->> 'group_key', nullif(x ->> 'shareholder', '')::smallint, coalesce(array(select jsonb_array_elements_text(x -> 'accounts')), '{}'),
      round((x ->> 'opening')::numeric, 2), round((x ->> 'closing')::numeric, 2), round(coalesce((x ->> 'reductions')::numeric, 0), 2),
      round((x ->> 'last_part')::numeric, 2), round((x ->> 'this_part')::numeric, 2), nullif(x ->> 'due_on', '')::date,
      nullif(x ->> 'prior_due_on', '')::date, round((x ->> 'prior_opening')::numeric, 2), round((x ->> 'prior_repaid')::numeric, 2), round((x ->> 'prior_unpaid')::numeric, 2),
      coalesce(array(select jsonb_array_elements_text(x -> 'flags')), '{}'),
      round(coalesce((x ->> 'decided_left')::numeric, 0), 2), case when jsonb_typeof(x -> 'decided') = 'array' then x -> 'decided' else '[]' end);
    -- Each flag keeps its answer while its amount is the same; a changed amount needs it again.
    for f in select jsonb_array_elements_text(x -> 'flags') loop
      v_amt := round(coalesce((x -> 'flag_amounts' ->> f)::numeric, (x ->> 'closing')::numeric), 2);
      insert into public.cb_sh_flags (file_id, account_key, flag, closing) values (p_file, x ->> 'group_key', f, v_amt)
      on conflict (file_id, account_key, flag) do update set closing = excluded.closing,
        note = case when public.cb_sh_flags.closing = excluded.closing then public.cb_sh_flags.note else '' end,
        noted_by = case when public.cb_sh_flags.closing = excluded.closing then public.cb_sh_flags.noted_by end,
        noted_at = case when public.cb_sh_flags.closing = excluded.closing then public.cb_sh_flags.noted_at end,
        accepted_by = case when public.cb_sh_flags.closing = excluded.closing then public.cb_sh_flags.accepted_by end,
        accepted_at = case when public.cb_sh_flags.closing = excluded.closing then public.cb_sh_flags.accepted_at end,
        accepted_why = case when public.cb_sh_flags.closing = excluded.closing then public.cb_sh_flags.accepted_why else '' end,
        accepted_kind = case when public.cb_sh_flags.closing = excluded.closing then public.cb_sh_flags.accepted_kind else '' end,
        accepted_year = case when public.cb_sh_flags.closing = excluded.closing then public.cb_sh_flags.accepted_year end;
    end loop;
  end loop;
  delete from public.cb_sh_flags g where g.file_id = p_file
    and not exists (select 1 from public.cb_sh_groups s where s.file_id = p_file and s.group_key = g.account_key and g.flag = any (s.flags));
  delete from public.cb_sh_repaid r where r.file_id = p_file
    and not exists (select 1 from public.cb_sh_groups s where s.file_id = p_file and s.group_key = r.account_key and s.prior_due_on = r.due_on);
  insert into public.cb_sh_prepared (file_id, fingerprint, prepared_by) values (p_file, private.cb_sh_fingerprint(p_file), (select auth.uid()))
  on conflict (file_id) do update set fingerprint = excluded.fingerprint, prepared_by = excluded.prepared_by, prepared_at = now();
  perform private.cb_log(p_file, 'sh_prepared', 'review', format('Shareholder loans updated: %s account%s, %s shareholder%s',
    jsonb_array_length(p_rows), case when jsonb_array_length(p_rows) = 1 then '' else 's' end, jsonb_array_length(p_groups), case when jsonb_array_length(p_groups) = 1 then '' else 's' end));
end;
$$;

CREATE OR REPLACE FUNCTION public.cb_sh_status(p_file uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
declare p public.cb_sh_prepared;
begin
  perform private.require(private.can_view('closebook'), 'You need View on Closebook.');
  select * into p from public.cb_sh_prepared where file_id = p_file;
  return jsonb_build_object('applies', private.cb_sh_applies(p_file), 'prepared_at', p.prepared_at, 'prepared_by', p.prepared_by,
    'stale', p.file_id is not null and p.fingerprint <> private.cb_sh_fingerprint(p_file),
    'problems', to_jsonb(private.cb_sh_review_problems(p_file)), 'waiting', '[]'::jsonb);
end;
$$;
revoke all on function private.cb_step5_problems(uuid), private.cb_step5_waiting(uuid), private.cb_review_problems(uuid) from public, anon, authenticated;
revoke all on function public.cb_accept_sh_flag(uuid, text, text, text, text, integer), public.cb_confirm_sh_repaid(uuid, text),
  public.cb_prepare_sh_schedule(uuid, jsonb, jsonb), public.cb_sh_status(uuid) from public, anon;
grant execute on function public.cb_accept_sh_flag(uuid, text, text, text, text, integer), public.cb_confirm_sh_repaid(uuid, text),
  public.cb_prepare_sh_schedule(uuid, jsonb, jsonb), public.cb_sh_status(uuid) to authenticated;
