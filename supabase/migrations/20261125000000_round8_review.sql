-- Round 8 (Hashim, Nov 24, 2026): step 6 Review and staff access. Follows CaseWare Working Papers:
-- each step (CaseWare: each document) has a "Prepared by" and a "Reviewed by" sign-off with name and
-- date; a change to a signed step clears its sign-offs; review notes sit on one step (or an item in it),
-- the preparer replies and marks them fixed, and only the reviewer clears them; the engagement's final
-- sign-off needs every document reviewed, no open note, and the completion checklist answered.
-- Safe to run twice (round 4d rule).

-- ---------------------------------------------------------------------------------------------------
-- 1. Roles. A "Closebook preparer" role: My files and All files, prepare, sign as preparer, reply to
--    notes. The reviewer is an owner (for now): a file's reviewer must be an active owner.
-- ---------------------------------------------------------------------------------------------------
insert into public.roles (name, description)
select 'Closebook preparer', 'Prepares Closebook files: works the steps, signs as preparer and replies to review notes. Sees client names only.'
 where not exists (select 1 from public.roles where name = 'Closebook preparer');
insert into public.role_permissions (role_id, area_key, level)
select r.id, a.key, case a.key when 'closebook' then 'edit' when 'clients' then 'view' else 'none' end
  from public.roles r cross join public.permission_areas a
 where r.name = 'Closebook preparer'
on conflict (role_id, area_key) do nothing;

-- Whether a staff member is an active owner, or may prepare Closebook files.
create or replace function private.cb_staff_is_owner(p_staff uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s join public.roles r on r.id = s.role_id where s.id = p_staff and s.is_active and r.is_owner);
$$;
create or replace function private.cb_staff_can_prepare(p_staff uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select private.cb_staff_is_owner(p_staff) or exists (select 1 from public.staff s join public.role_permissions rp on rp.role_id = s.role_id
    where s.id = p_staff and s.is_active and rp.area_key = 'closebook' and rp.level = 'edit');
$$;
revoke all on function private.cb_staff_is_owner(uuid), private.cb_staff_can_prepare(uuid) from public, anon, authenticated;

create or replace function private.cb_file_people() returns trigger language plpgsql set search_path = '' as $$
begin
  if not private.cb_staff_is_owner(new.reviewer_id) then
    raise exception 'The reviewer must be an owner.' using errcode = 'P0001';
  end if;
  if not private.cb_staff_can_prepare(new.preparer_id) then
    raise exception 'The preparer needs Closebook preparer access (Settings, Team and roles).' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.cb_file_people() from public, anon, authenticated;
drop trigger if exists cb_file_people on public.cb_files;
create trigger cb_file_people before insert or update of preparer_id, reviewer_id on public.cb_files
  for each row execute function private.cb_file_people();

-- ---------------------------------------------------------------------------------------------------
-- 2. Tables: sign-offs, review notes and replies, file history, the completion checklist.
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.cb_step_signoffs (
  file_id      uuid not null references public.cb_files (id) on delete cascade,
  step         text not null check (step in ('setup', 'opening', 'records', 'code', 'entries', 'review', 'mapping', 't2', 'statements', 'lock')),
  prepared_by  uuid references public.staff (id),
  prepared_at  timestamptz,
  reviewed_by  uuid references public.staff (id),
  reviewed_at  timestamptz,
  primary key (file_id, step),
  check ((reviewed_at is null) or (prepared_at is not null) or step = 'review')
);

create table if not exists public.cb_review_notes (
  id           uuid primary key default gen_random_uuid(),
  file_id      uuid not null references public.cb_files (id) on delete cascade,
  step         text not null check (step in ('setup', 'opening', 'records', 'code', 'entries', 'review', 'mapping', 't2', 'statements', 'lock')),
  target_type  text not null check (target_type in ('step', 'account', 'entry', 'bank_line')),
  target_id    uuid,
  target_label text not null default '' check (length(target_label) <= 200),
  body         text not null check (length(btrim(body)) between 1 and 2000),
  status       text not null default 'open' check (status in ('open', 'fixed', 'cleared')),
  created_by   uuid not null references public.staff (id),
  created_at   timestamptz not null default now(),
  fixed_by     uuid references public.staff (id),
  fixed_at     timestamptz,
  cleared_by   uuid references public.staff (id),
  cleared_at   timestamptz,
  check ((target_type = 'step') = (target_id is null))
);
create index if not exists cb_review_notes_file on public.cb_review_notes (file_id, status);

create table if not exists public.cb_review_note_replies (
  id          uuid primary key default gen_random_uuid(),
  note_id     uuid not null references public.cb_review_notes (id) on delete cascade,
  body        text not null check (length(btrim(body)) between 1 and 2000),
  created_by  uuid not null references public.staff (id),
  created_at  timestamptz not null default now()
);
create index if not exists cb_review_note_replies_note on public.cb_review_note_replies (note_id);

-- File history: every sign-off, cleared sign-off, note, reply and checklist save, with who and when.
create table if not exists public.cb_file_history (
  id        bigint generated always as identity primary key,
  file_id   uuid not null references public.cb_files (id) on delete cascade,
  at        timestamptz not null default now(),
  actor_id  uuid,
  action    text not null,
  step      text,
  detail    text not null default ''
);
create index if not exists cb_file_history_file on public.cb_file_history (file_id, at);

-- The completion checklist (CSRS 4200): the questions' words are wording pieces on the Templates page
-- (key = the piece's key); the answers are kept per file.
create table if not exists public.cb_checklist_questions (
  key         text primary key check (key ~ '^w[0-9a-f]{10}$'),
  sort_order  int not null
);
insert into public.cb_checklist_questions (key, sort_order) values
  ('wb200000001', 1), ('wb200000002', 2), ('wb200000003', 3), ('wb200000004', 4), ('wb200000005', 5), ('wb200000006', 6),
  ('wb200000007', 7), ('wb200000008', 8), ('wb200000009', 9), ('wb20000000a', 10), ('wb20000000b', 11), ('wb20000000c', 12)
on conflict (key) do nothing;

create table if not exists public.cb_checklist_answers (
  file_id      uuid not null references public.cb_files (id) on delete cascade,
  question     text not null references public.cb_checklist_questions (key),
  answer       text not null check (answer in ('yes', 'no', 'na')),
  note         text not null default '' check (length(note) <= 1000),
  answered_by  uuid references public.staff (id),
  answered_at  timestamptz not null default now(),
  primary key (file_id, question),
  check (answer <> 'no' or length(btrim(note)) > 0)
);

alter table public.cb_step_signoffs enable row level security;
alter table public.cb_step_signoffs force row level security;
alter table public.cb_review_notes enable row level security;
alter table public.cb_review_notes force row level security;
alter table public.cb_review_note_replies enable row level security;
alter table public.cb_review_note_replies force row level security;
alter table public.cb_file_history enable row level security;
alter table public.cb_file_history force row level security;
alter table public.cb_checklist_questions enable row level security;
alter table public.cb_checklist_questions force row level security;
alter table public.cb_checklist_answers enable row level security;
alter table public.cb_checklist_answers force row level security;
drop policy if exists "Closebook viewers read sign-offs" on public.cb_step_signoffs;
create policy "Closebook viewers read sign-offs" on public.cb_step_signoffs for select to authenticated using ((select private.can_view('closebook')));
drop policy if exists "Closebook viewers read review notes" on public.cb_review_notes;
create policy "Closebook viewers read review notes" on public.cb_review_notes for select to authenticated using ((select private.can_view('closebook')));
drop policy if exists "Closebook viewers read replies" on public.cb_review_note_replies;
create policy "Closebook viewers read replies" on public.cb_review_note_replies for select to authenticated using ((select private.can_view('closebook')));
drop policy if exists "Owners read file history" on public.cb_file_history;
create policy "Owners read file history" on public.cb_file_history for select to authenticated using ((select private.is_owner()));
drop policy if exists "Closebook viewers read checklist questions" on public.cb_checklist_questions;
create policy "Closebook viewers read checklist questions" on public.cb_checklist_questions for select to authenticated using ((select private.can_view('closebook')));
drop policy if exists "Closebook viewers read checklist answers" on public.cb_checklist_answers;
create policy "Closebook viewers read checklist answers" on public.cb_checklist_answers for select to authenticated using ((select private.can_view('closebook')));
revoke all on public.cb_step_signoffs, public.cb_review_notes, public.cb_review_note_replies, public.cb_file_history, public.cb_checklist_questions, public.cb_checklist_answers from anon;
grant select on public.cb_step_signoffs, public.cb_review_notes, public.cb_review_note_replies, public.cb_file_history, public.cb_checklist_questions, public.cb_checklist_answers to authenticated;

-- Step 2 sign-offs given before round 8 (cb_sign_opening) become step 2's "Prepared by".
insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at)
select id, 'opening', opening_signed_by, opening_signed_at from public.cb_files
 where opening_signed_at is not null and opening_signed_by is not null
on conflict (file_id, step) do nothing;

-- ---------------------------------------------------------------------------------------------------
-- 3. History and clearing.
-- ---------------------------------------------------------------------------------------------------
create or replace function private.cb_log(p_file uuid, p_action text, p_step text, p_detail text) returns void
language sql security definer set search_path = '' as $$
  insert into public.cb_file_history (file_id, actor_id, action, step, detail) values (p_file, (select auth.uid()), p_action, p_step, left(coalesce(p_detail, ''), 500));
$$;

-- A change to a signed step clears its sign-offs (CaseWare: a change after sign-off clears it), and the
-- step 6 sign-off with it, since step 6 rests on every step. Nothing to clear: nothing happens.
create or replace function private.cb_clear_step(p_file uuid, p_step text, p_why text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.cb_step_signoffs;
begin
  -- The file itself is being deleted: nothing to clear or record.
  if not exists (select 1 from public.cb_files where id = p_file) then return; end if;
  delete from public.cb_step_signoffs where file_id = p_file and step = p_step returning * into r;
  if r.file_id is not null then
    perform private.cb_log(p_file, 'signoff_cleared', p_step, p_why);
    if p_step = 'opening' then
      update public.cb_files set opening_signed_by = null, opening_signed_at = null where id = p_file and opening_signed_at is not null;
    end if;
  end if;
  if p_step <> 'review' then
    perform private.cb_clear_step(p_file, 'review', 'A step it rests on changed');
  end if;
end;
$$;
revoke all on function private.cb_log(uuid, text, text, text), private.cb_clear_step(uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 4. What is open for the preparer, and what waits for the reviewer, on each step. One rule for the
--    sign-offs, the step 6 list and the screens (the screens read these through cb_step_status).
-- ---------------------------------------------------------------------------------------------------
-- Step 2 on a bank-statement file: last year's balance sheet must tie out (the step 2 sign rule).
create or replace function private.cb_opening_problem(p_file uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_assets numeric; v_liab numeric; v_equity numeric; v_rev numeric; v_exp numeric; v_re numeric; v_has125 boolean; v_ni numeric;
begin
  select * into v_file from public.cb_files where id = p_file;
  if not exists (select 1 from public.cb_opening_balances where file_id = p_file) then return 'Enter last year''s balance sheet first.'; end if;
  if v_file.opening_re_stated is null then return 'Type last year''s 3849 from the T2.'; end if;
  select coalesce(sum(amount) filter (where t = 'Asset'), 0), coalesce(sum(amount) filter (where t = 'Liability'), 0),
         coalesce(sum(amount) filter (where t = 'Equity' and not (code = '3660' or code::int between 3700 and 3848)), 0),
         coalesce(sum(amount) filter (where t = 'Revenue'), 0), coalesce(sum(amount) filter (where t = 'Expense'), 0),
         coalesce(sum(case when code = '3660' or code::int between 3700 and 3848 then amount else 0 end), 0),
         bool_or(t in ('Revenue', 'Expense'))
    into v_assets, v_liab, v_equity, v_rev, v_exp, v_re, v_has125
    from (select code, amount, private.cb_gifi_type(code) t from public.cb_opening_balances where file_id = p_file) x;
  v_ni := case when coalesce(v_has125, false) then v_rev - v_exp else v_file.opening_ni_typed end;
  if v_ni is null then return 'Type last year''s net income (9999), or enter the Schedule 125 tab.'; end if;
  if v_re + v_ni <> v_file.opening_re_stated then return format('3849 (%s) does not equal 3660 + 9999 + the 3700s (%s).', v_file.opening_re_stated, v_re + v_ni); end if;
  if v_liab + v_equity + v_file.opening_re_stated <> v_assets then
    return format('Total liabilities and equity (3640, %s) does not equal total assets (2599, %s).', v_liab + v_equity + v_file.opening_re_stated, v_assets);
  end if;
  return null;
end;
$$;

create or replace function public.cb_sign_opening(p_file uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_problem text;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  v_problem := private.cb_opening_problem(p_file);
  perform private.require(v_problem is null, coalesce(v_problem, ''));
  update public.cb_files set opening_signed_by = (select auth.uid()), opening_signed_at = now(), updated_at = now() where id = p_file;
  -- Round 8: this is step 2's "Prepared by".
  insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at) values (p_file, 'opening', (select auth.uid()), now())
  on conflict (file_id, step) do update set prepared_by = excluded.prepared_by, prepared_at = excluded.prepared_at, reviewed_by = null, reviewed_at = null;
  perform private.cb_log(p_file, 'prepared', 'opening', '');
end;
$$;

-- An account with no balance either year and no entries: "not used", no decision (round 4b item 4).
create or replace function private.cb_account_used(p_account uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.cb_accounts a where a.id = p_account and (a.this_year <> 0 or a.last_year <> 0))
      or exists (select 1 from public.cb_entry_lines l where l.account_id = p_account);
$$;

-- The account's balance after entries.
create or replace function private.cb_account_final(p_account uuid) returns numeric language sql stable security definer set search_path = '' as $$
  select a.this_year + coalesce((select sum(l.amount) from public.cb_entry_lines l where l.account_id = a.id), 0) from public.cb_accounts a where a.id = p_account;
$$;

-- Open items for the preparer: the step cannot be signed as prepared while any is open.
create or replace function private.cb_step_problems(p_file uuid, p_step text) returns text[]
language plpgsql stable security definer set search_path = '' as $$
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
  elsif p_step = 'opening' then
    if v_bank then
      v_txt := private.cb_opening_problem(p_file);
      if v_txt is not null then v_out := v_out || v_txt; end if;
    elsif not exists (select 1 from public.cb_imports where file_id = p_file and target = 'this_year') then
      v_out := v_out || 'Import the trial balance: last year''s column comes with it.'::text;
    end if;
  elsif p_step = 'records' then
    if v_bank then
      if not exists (select 1 from public.cb_bank_accounts where file_id = p_file) then
        v_out := v_out || 'Add the bank and card accounts and upload their statements.'::text;
      else
        select count(*) into v_n from (
          select distinct a.id, date_trunc('month', d) from public.cb_bank_accounts a
           cross join generate_series(v_file.year_start::timestamp, v_file.year_end::timestamp, interval '1 day') d
           where a.file_id = p_file and not exists (select 1 from public.cb_bank_statements s where s.account_id = a.id and d::date between s.period_start and s.period_end)) x;
        if v_n > 0 then v_out := v_out || format('%s month%s of statements missing.', v_n, case when v_n = 1 then '' else 's' end); end if;
        select count(*) into v_n from (
          select opening, lag(closing) over (partition by account_id order by period_start) prev from public.cb_bank_statements where file_id = p_file) x
         where prev is not null and opening <> prev;
        if v_n > 0 then v_out := v_out || format('%s statement%s whose opening balance does not follow the one before.', v_n, case when v_n = 1 then '' else 's' end); end if;
        select count(*) into v_n from (
          select a.id, m from public.cb_bank_accounts a
           cross join generate_series(date_trunc('month', v_file.year_start::timestamp), v_file.year_end::timestamp, interval '1 month') m
           where a.file_id = p_file
             and exists (select 1 from public.cb_bank_statements s where s.account_id = a.id and s.period_start <= (m + interval '1 month - 1 day')::date and s.period_end >= m::date)
             and not exists (select 1 from public.cb_bank_lines l where l.file_id = p_file and l.account_id = a.id and date_trunc('month', l.txn_date::timestamp) = m)) x;
        if v_n > 0 then v_out := v_out || format('%s month%s with no transactions: check the statements are complete.', v_n, case when v_n = 1 then '' else 's' end); end if;
      end if;
    else
      if not exists (select 1 from public.cb_imports where file_id = p_file and target = 'this_year') then
        v_out := v_out || 'Import the trial balance.'::text;
      elsif (select coalesce(sum(this_year), 0) from public.cb_accounts where file_id = p_file) <> 0 then
        v_out := v_out || 'The trial balance does not balance: import it again.'::text;
      end if;
    end if;
  elsif p_step = 'code' then
    if v_bank then
      select count(*) into v_n from public.cb_bank_lines where file_id = p_file and status = 'new';
      if v_n > 0 then v_out := v_out || format('%s line%s to code.', v_n, case when v_n = 1 then '' else 's' end); end if;
      select count(*) into v_n from public.cb_bank_lines where file_id = p_file and status = 'ask_client';
      if v_n > 0 then v_out := v_out || format('%s line%s on the client''s question list.', v_n, case when v_n = 1 then '' else 's' end); end if;
    else
      select count(*) into v_n from public.cb_accounts a where a.file_id = p_file and a.line_no is null and not a.needs_reviewer
         and a.account_key not in ('chart:10900', 'opening', 'uncoded') and private.cb_account_used(a.id);
      if v_n > 0 then v_out := v_out || format('%s account%s to match to a GIFI line.', v_n, case when v_n = 1 then '' else 's' end); end if;
    end if;
  elsif p_step = 'entries' then
    select flag_amount, flag_percent into v_flag_amount, v_flag_percent from public.cb_settings limit 1;
    v_flag_amount := coalesce(v_flag_amount, 5000); v_flag_percent := coalesce(v_flag_percent, 20);
    select count(*) into v_n from (
      select a.id, private.cb_account_final(a.id) fin, a.last_year from public.cb_accounts a join public.cb_master_lines m on m.line_no = a.line_no
       where a.file_id = p_file and m.lead_sheet is not null) x
     where abs(fin - last_year) > v_flag_amount and (last_year = 0 or abs(fin - last_year) / abs(last_year) * 100 > v_flag_percent)
       and not exists (select 1 from public.cb_flag_notes n where n.account_id = x.id);
    if v_n > 0 then v_out := v_out || format('%s flagged change%s to explain on the lead sheets.', v_n, case when v_n = 1 then '' else 's' end); end if;
  elsif p_step = 'mapping' then
    select count(*) into v_n from public.cb_accounts a where a.file_id = p_file and a.line_no is null and not a.needs_reviewer
       and a.account_key not in ('chart:10900', 'opening', 'uncoded') and private.cb_account_used(a.id);
    if v_n > 0 then v_out := v_out || format('%s account%s with no GIFI line.', v_n, case when v_n = 1 then '' else 's' end); end if;
    if exists (select 1 from public.cb_accounts a where a.file_id = p_file and a.account_key = 'chart:10900' and private.cb_account_final(a.id) <> 0) then
      v_out := v_out || 'Clearing (10900) has a balance: move it to the right account.'::text;
    end if;
  end if;
  -- A review note not yet fixed is open work on its step.
  select count(*) into v_n from public.cb_review_notes where file_id = p_file and step = p_step and status = 'open';
  if v_n > 0 then v_out := v_out || format('%s review note%s to fix.', v_n, case when v_n = 1 then '' else 's' end); end if;
  return v_out;
end;
$$;

-- What waits for the reviewer on a step: the step cannot be signed as reviewed while any waits.
create or replace function private.cb_step_waiting(p_file uuid, p_step text) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  v_out text[] := '{}';
  v_n int;
begin
  if p_step = 'opening' then
    if exists (select 1 from public.cb_accounts where file_id = p_file and account_key = 'opening' and needs_reviewer) then
      v_out := v_out || 'A difference with last year''s closing balances.'::text;
    end if;
  elsif p_step = 'code' then
    select count(*) into v_n from public.cb_bank_lines where file_id = p_file and status = 'reviewer';
    if v_n > 0 then v_out := v_out || format('%s line%s for the reviewer.', v_n, case when v_n = 1 then '' else 's' end); end if;
  elsif p_step = 'entries' then
    select count(*) into v_n from public.cb_entries where file_id = p_file and needs_review and reviewed_at is null;
    if v_n > 0 then v_out := v_out || format('%s entr%s to approve.', v_n, case when v_n = 1 then 'y' else 'ies' end); end if;
  elsif p_step = 'mapping' then
    select count(*) into v_n from public.cb_accounts where file_id = p_file and needs_reviewer and account_key not in ('opening', 'uncoded');
    if v_n > 0 then v_out := v_out || format('%s account%s waiting for the reviewer''s decision.', v_n, case when v_n = 1 then '' else 's' end); end if;
    v_n := private.cb_open_type_flags(p_file);
    if v_n > 0 then v_out := v_out || format('%s account%s on a GIFI line of another type.', v_n, case when v_n = 1 then '' else 's' end); end if;
  end if;
  select count(*) into v_n from public.cb_review_notes where file_id = p_file and step = p_step and status <> 'cleared';
  if v_n > 0 then v_out := v_out || format('%s review note%s to clear.', v_n, case when v_n = 1 then '' else 's' end); end if;
  return v_out;
end;
$$;

-- Step 6: what keeps the reviewer from signing it.
create or replace function private.cb_review_problems(p_file uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  v_out text[] := '{}';
  v_n int;
  v_names text;
begin
  select string_agg(n.label, ', ' order by n.ord) into v_names from (values
    ('setup', 'step 1', 1), ('opening', 'step 2', 2), ('records', 'step 3', 3), ('code', 'step 4', 4), ('entries', 'step 5', 5), ('mapping', 'step 7', 7)) n(step, label, ord)
   where not exists (select 1 from public.cb_step_signoffs s where s.file_id = p_file and s.step = n.step and s.reviewed_at is not null);
  if v_names is not null then v_out := v_out || format('Review %s first.', v_names); end if;
  select count(*) into v_n from public.cb_review_notes where file_id = p_file and status <> 'cleared';
  if v_n > 0 then v_out := v_out || format('%s review note%s still open.', v_n, case when v_n = 1 then '' else 's' end); end if;
  select count(*) into v_n from (select unnest(private.cb_step_waiting(p_file, s)) w from unnest(array['opening', 'code', 'entries', 'mapping']) s) x
   where w not like '%review note%';
  if v_n > 0 then v_out := v_out || 'Items still wait for the reviewer: see the list above.'::text; end if;
  select count(*) into v_n from public.cb_checklist_questions q
   where not exists (select 1 from public.cb_checklist_answers a where a.file_id = p_file and a.question = q.key);
  if v_n > 0 then v_out := v_out || format('%s checklist question%s to answer.', v_n, case when v_n = 1 then '' else 's' end); end if;
  return v_out;
end;
$$;
-- What keeps the preparer from signing: the open items, and the reviewer's decisions still to make on
-- the step. A reviewer's decision changes the step (a line's coding, an account's line), and a change
-- clears the sign-off, so those come before the preparer signs. Approving an entry changes nothing in
-- it, so entries waiting for approval do not hold the preparer.
create or replace function private.cb_prepare_blockers(p_file uuid, p_step text) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v_bank boolean;
begin
  select books in ('statements', 'paper') into v_bank from public.cb_files where id = p_file;
  return private.cb_step_problems(p_file, p_step) || coalesce((select array_agg(w) from unnest(
    case when p_step = 'opening' then private.cb_step_waiting(p_file, 'opening')
         when p_step = 'code' and v_bank then private.cb_step_waiting(p_file, 'code')
         when p_step in ('code', 'mapping') then private.cb_step_waiting(p_file, 'mapping')
         else '{}'::text[] end) w where w not like '%review note%'), '{}');
end;
$$;

revoke all on function private.cb_opening_problem(uuid), private.cb_account_used(uuid), private.cb_account_final(uuid), private.cb_step_problems(uuid, text),
  private.cb_step_waiting(uuid, text), private.cb_review_problems(uuid), private.cb_prepare_blockers(uuid, text) from public, anon, authenticated;

-- The screens' view of every step: sign-offs, open items, waiting items, open notes.
create or replace function public.cb_step_status(p_file uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb := '{}'::jsonb; s text; r public.cb_step_signoffs;
begin
  perform private.require(private.can_view('closebook'), 'You need Closebook access.');
  foreach s in array array['setup', 'opening', 'records', 'code', 'entries', 'review', 'mapping'] loop
    select * into r from public.cb_step_signoffs where file_id = p_file and step = s;
    v := v || jsonb_build_object(s, jsonb_build_object(
      'prepared_by', r.prepared_by, 'prepared_at', r.prepared_at, 'reviewed_by', r.reviewed_by, 'reviewed_at', r.reviewed_at,
      -- Each item once: the preparer's open work, then what waits for the reviewer (which also holds the
      -- preparer's sign-off where a decision would change the step; the sign-off checks both).
      'problems', to_jsonb(case when s = 'review' then private.cb_review_problems(p_file) else private.cb_step_problems(p_file, s) end),
      'holds_preparer', (cardinality(private.cb_prepare_blockers(p_file, s)) > cardinality(private.cb_step_problems(p_file, s))),
      'waiting', to_jsonb(case when s = 'review' then '{}'::text[] else private.cb_step_waiting(p_file, s) end),
      'notes', (select count(*) from public.cb_review_notes n where n.file_id = p_file and n.step = s and n.status <> 'cleared')));
  end loop;
  return v;
end;
$$;
revoke all on function public.cb_step_status(uuid) from public, anon;
grant execute on function public.cb_step_status(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 5. Signing. The preparer signs when nothing is open; the reviewer (an owner) signs after the
--    preparer, when nothing waits. The same person may sign both; the step shows it. Step 6 is the
--    reviewer's own sign-off. Steps 8 to 10 open when they are built.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.cb_sign_step(p_file uuid, p_step text, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  r public.cb_step_signoffs;
  v_list text[];
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(p_step in ('setup', 'opening', 'records', 'code', 'entries', 'review', 'mapping'), 'This step is not built yet: it has no sign-off.');
  perform private.require(p_role in ('prepared', 'reviewed'), 'Unknown sign-off.');
  select * into r from public.cb_step_signoffs where file_id = p_file and step = p_step;
  if p_role = 'prepared' then
    perform private.require(p_step <> 'review', 'Step 6 is the reviewer''s: it has no preparer sign-off.');
    perform private.require(r.prepared_at is null, 'This step is already signed as prepared.');
    v_list := private.cb_prepare_blockers(p_file, p_step);
    perform private.require(cardinality(v_list) = 0, 'Not yet: ' || array_to_string(v_list, ' '));
    if p_step = 'opening' and v_file.books in ('statements', 'paper') then
      perform public.cb_sign_opening(p_file);   -- records the sign-off and the history
      return;
    end if;
    insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at) values (p_file, p_step, (select auth.uid()), now())
    on conflict (file_id, step) do update set prepared_by = excluded.prepared_by, prepared_at = excluded.prepared_at;
    perform private.cb_log(p_file, 'prepared', p_step, '');
  else
    perform private.require(private.is_owner(), 'Only the reviewer signs as reviewer. Reviewers are owners.');
    perform private.require(r.reviewed_at is null, 'This step is already reviewed.');
    if p_step = 'review' then
      v_list := private.cb_review_problems(p_file);
      perform private.require(cardinality(v_list) = 0, 'Not yet: ' || array_to_string(v_list, ' '));
      insert into public.cb_step_signoffs (file_id, step, reviewed_by, reviewed_at) values (p_file, 'review', (select auth.uid()), now())
      on conflict (file_id, step) do update set reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at;
    else
      perform private.require(r.prepared_at is not null, 'The preparer signs first.');
      v_list := private.cb_step_waiting(p_file, p_step)
        || coalesce((select array_agg(x) from unnest(private.cb_step_problems(p_file, p_step)) x where x not like '%review note%'), '{}');
      perform private.require(cardinality(v_list) = 0, 'Not yet: ' || array_to_string(v_list, ' '));
      update public.cb_step_signoffs set reviewed_by = (select auth.uid()), reviewed_at = now() where file_id = p_file and step = p_step;
    end if;
    perform private.cb_log(p_file, 'reviewed', p_step, case when r.prepared_by = (select auth.uid()) then 'Prepared and reviewed by the same person' else '' end);
  end if;
  update public.cb_files set updated_at = now() where id = p_file;
end;
$$;

-- Take back your own sign-off. A preparer's sign-off goes only while the step is not reviewed.
create or replace function public.cb_unsign_step(p_file uuid, p_step text, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  r public.cb_step_signoffs;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  select * into r from public.cb_step_signoffs where file_id = p_file and step = p_step;
  if p_role = 'reviewed' then
    perform private.require(r.reviewed_at is not null and (r.reviewed_by = (select auth.uid()) or private.is_owner()), 'There is no reviewer sign-off of yours to take back.');
    if p_step = 'review' then delete from public.cb_step_signoffs where file_id = p_file and step = 'review';
    else update public.cb_step_signoffs set reviewed_by = null, reviewed_at = null where file_id = p_file and step = p_step;
      perform private.cb_clear_step(p_file, 'review', 'A step it rests on was taken back');
    end if;
    perform private.cb_log(p_file, 'unsigned_reviewed', p_step, '');
  else
    perform private.require(r.prepared_at is not null and r.prepared_by = (select auth.uid()), 'There is no preparer sign-off of yours to take back.');
    perform private.require(r.reviewed_at is null, 'The step is reviewed: the reviewer takes back their sign-off first.');
    delete from public.cb_step_signoffs where file_id = p_file and step = p_step;
    if p_step = 'opening' then update public.cb_files set opening_signed_by = null, opening_signed_at = null where id = p_file; end if;
    perform private.cb_log(p_file, 'unsigned_prepared', p_step, '');
  end if;
end;
$$;
revoke all on function public.cb_sign_step(uuid, text, text), public.cb_unsign_step(uuid, text, text) from public, anon;
grant execute on function public.cb_sign_step(uuid, text, text), public.cb_unsign_step(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 6. Review notes. The reviewer adds a note on a step, an account, an entry or a bank line. The
--    preparer replies and marks it fixed (fixing reopens only the step it sits on). Only the reviewer
--    clears it, or reopens it with a reply.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.cb_add_note(p_file uuid, p_step text, p_target_type text, p_target uuid, p_body text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_label text := '';
  v_id uuid;
begin
  perform private.require(private.can_edit('closebook') and private.is_owner(), 'Only the reviewer adds review notes. Reviewers are owners.');
  select * into v_file from public.cb_files where id = p_file;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(p_step in ('setup', 'opening', 'records', 'code', 'entries', 'review', 'mapping'), 'Choose a step.');
  perform private.require(length(btrim(coalesce(p_body, ''))) between 1 and 2000, 'Type the note (up to 2,000 characters).');
  if p_target_type = 'account' then
    select btrim(coalesce(nullif(number, '') || ' ', '') || name) into v_label from public.cb_accounts where id = p_target and file_id = p_file;
  elsif p_target_type = 'entry' then
    select format('Entry %s-%s', to_char(v_file.year_end, 'YYYY'), lpad(seq::text, 3, '0')) into v_label from public.cb_entries where id = p_target and file_id = p_file;
  elsif p_target_type = 'bank_line' then
    select format('%s %s %s', to_char(txn_date, 'Mon FMDD'), left(description, 80), to_char(amount, 'FM999,999,990.00')) into v_label from public.cb_bank_lines where id = p_target and file_id = p_file;
  else
    perform private.require(p_target_type = 'step' and p_target is null, 'Unknown note target.');
  end if;
  perform private.require(p_target_type = 'step' or v_label is not null, 'That item is not in this file.');
  insert into public.cb_review_notes (file_id, step, target_type, target_id, target_label, body, created_by)
  values (p_file, p_step, p_target_type, case when p_target_type = 'step' then null else p_target end, coalesce(v_label, ''), btrim(p_body), (select auth.uid()))
  returning id into v_id;
  perform private.cb_log(p_file, 'note_added', p_step, left(btrim(p_body), 200));
  return v_id;
end;
$$;

create or replace function public.cb_reply_note(p_note uuid, p_body text, p_fixed boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  n public.cb_review_notes;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into n from public.cb_review_notes where id = p_note for update;
  perform private.require(n.id is not null and n.status <> 'cleared', 'This note is cleared or missing.');
  perform private.require(length(btrim(coalesce(p_body, ''))) between 1 and 2000, 'Type the reply (up to 2,000 characters).');
  insert into public.cb_review_note_replies (note_id, body, created_by) values (p_note, btrim(p_body), (select auth.uid()));
  perform private.cb_log(n.file_id, 'note_replied', n.step, left(btrim(p_body), 200));
  if p_fixed then
    perform private.require(n.status = 'open', 'This note is already marked fixed.');
    update public.cb_review_notes set status = 'fixed', fixed_by = (select auth.uid()), fixed_at = now() where id = p_note;
    perform private.cb_log(n.file_id, 'note_fixed', n.step, '');
    -- Fixing a note reopens only the step it sits on.
    perform private.cb_clear_step(n.file_id, n.step, 'A review note on it was fixed');
  end if;
end;
$$;

create or replace function public.cb_clear_note(p_note uuid, p_reopen_with text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  n public.cb_review_notes;
begin
  perform private.require(private.can_edit('closebook') and private.is_owner(), 'Only the reviewer clears or reopens a review note.');
  select * into n from public.cb_review_notes where id = p_note for update;
  perform private.require(n.id is not null and n.status <> 'cleared', 'This note is cleared or missing.');
  if p_reopen_with is null then
    update public.cb_review_notes set status = 'cleared', cleared_by = (select auth.uid()), cleared_at = now() where id = p_note;
    perform private.cb_log(n.file_id, 'note_cleared', n.step, '');
  else
    perform private.require(length(btrim(p_reopen_with)) between 1 and 2000, 'Say what is still needed.');
    insert into public.cb_review_note_replies (note_id, body, created_by) values (p_note, btrim(p_reopen_with), (select auth.uid()));
    update public.cb_review_notes set status = 'open', fixed_by = null, fixed_at = null where id = p_note;
    perform private.cb_log(n.file_id, 'note_reopened', n.step, left(btrim(p_reopen_with), 200));
  end if;
end;
$$;
revoke all on function public.cb_add_note(uuid, text, text, uuid, text), public.cb_reply_note(uuid, text, boolean), public.cb_clear_note(uuid, text) from public, anon;
grant execute on function public.cb_add_note(uuid, text, text, uuid, text), public.cb_reply_note(uuid, text, boolean), public.cb_clear_note(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 7. The completion checklist: Yes, No (with a reason) or Not applicable for every question.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.cb_save_checklist(p_file uuid, p_answers jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v jsonb;
  v_changed int := 0;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(jsonb_typeof(p_answers) = 'array', 'Answers are missing.');
  for v in select * from jsonb_array_elements(p_answers) loop
    perform private.require(exists (select 1 from public.cb_checklist_questions where key = v ->> 'question'), 'Unknown checklist question.');
    perform private.require(v ->> 'answer' in ('yes', 'no', 'na'), 'Answer Yes, No or Not applicable.');
    perform private.require(v ->> 'answer' <> 'no' or length(btrim(coalesce(v ->> 'note', ''))) > 0, 'A "No" needs a note: say why, and what was done.');
    insert into public.cb_checklist_answers (file_id, question, answer, note, answered_by)
    values (p_file, v ->> 'question', v ->> 'answer', left(btrim(coalesce(v ->> 'note', '')), 1000), (select auth.uid()))
    on conflict (file_id, question) do update set answer = excluded.answer, note = excluded.note, answered_by = excluded.answered_by, answered_at = now()
     where public.cb_checklist_answers.answer is distinct from excluded.answer or public.cb_checklist_answers.note is distinct from excluded.note;
    if found then v_changed := v_changed + 1; end if;
  end loop;
  if v_changed > 0 then
    perform private.cb_log(p_file, 'checklist_saved', 'review', format('%s answer%s', v_changed, case when v_changed = 1 then '' else 's' end));
    perform private.cb_clear_step(p_file, 'review', 'The completion checklist changed');
  end if;
end;
$$;
revoke all on function public.cb_save_checklist(uuid, jsonb) from public, anon;
grant execute on function public.cb_save_checklist(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 8. A change to a signed step clears its sign-offs (step 2 did this already). Each change belongs to
--    the step where it is made.
-- ---------------------------------------------------------------------------------------------------
create or replace function private.cb_changed() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_file uuid;
  v_step text := tg_argv[0];
  v_why text := tg_argv[1];
  v_bank boolean;
  v_row record;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  if tg_table_name = 'cb_entry_lines' then
    select e.file_id into v_file from public.cb_entries e where e.id = v_row.entry_id;
  elsif tg_table_name = 'cb_flag_notes' then
    select a.file_id into v_file from public.cb_accounts a where a.id = v_row.account_id;
  elsif tg_table_name = 'cb_files' then
    v_file := v_row.id;
  else
    v_file := v_row.file_id;
  end if;
  if v_file is null then return null; end if;
  if tg_table_name = 'cb_imports' then
    v_step := case v_row.target when 'account_list' then 'mapping' when 'last_year' then 'opening' else 'records' end;
    if v_row.target = 'account_list' then perform private.cb_clear_step(v_file, 'code', v_why); end if;
  elsif tg_table_name = 'cb_accounts' then
    -- A trial balance file matches in step 4 and maps in step 7: a line change touches both.
    select books in ('statements', 'paper') into v_bank from public.cb_files where id = v_file;
    if not v_bank then perform private.cb_clear_step(v_file, 'code', v_why); end if;
  end if;
  perform private.cb_clear_step(v_file, v_step, v_why);
  return null;
end;
$$;
revoke all on function private.cb_changed() from public, anon, authenticated;

drop trigger if exists cb_changed_setup on public.cb_files;
create trigger cb_changed_setup after update of setup on public.cb_files for each row
  when (old.setup is distinct from new.setup) execute function private.cb_changed('setup', 'The setup answers changed');
drop trigger if exists cb_changed_opening_signed on public.cb_files;
create trigger cb_changed_opening_signed after update of opening_signed_at on public.cb_files for each row
  when (old.opening_signed_at is not null and new.opening_signed_at is null) execute function private.cb_changed('opening', 'Last year''s balance sheet changed');
drop trigger if exists cb_changed_opening on public.cb_opening_balances;
create trigger cb_changed_opening after insert or update or delete on public.cb_opening_balances for each row
  execute function private.cb_changed('opening', 'Last year''s balance sheet changed');
drop trigger if exists cb_changed_imports on public.cb_imports;
create trigger cb_changed_imports after insert or delete on public.cb_imports for each row
  execute function private.cb_changed('records', 'A new import');
drop trigger if exists cb_changed_statements on public.cb_bank_statements;
create trigger cb_changed_statements after insert or update or delete on public.cb_bank_statements for each row
  execute function private.cb_changed('records', 'A statement changed');
drop trigger if exists cb_changed_lines_in on public.cb_bank_lines;
create trigger cb_changed_lines_in after insert or delete on public.cb_bank_lines for each row
  execute function private.cb_changed('records', 'Statement lines changed');
drop trigger if exists cb_changed_coding on public.cb_bank_lines;
create trigger cb_changed_coding after update of chart_account, tax_code, status on public.cb_bank_lines for each row
  when (old.chart_account is distinct from new.chart_account or old.tax_code is distinct from new.tax_code or old.status is distinct from new.status)
  execute function private.cb_changed('code', 'A line''s coding changed');
drop trigger if exists cb_changed_entries on public.cb_entries;
create trigger cb_changed_entries after insert or delete on public.cb_entries for each row
  execute function private.cb_changed('entries', 'An entry was added or deleted');
drop trigger if exists cb_changed_entry_edit on public.cb_entries;
create trigger cb_changed_entry_edit after update of kind, reason, note, reverse_next_year, wp_ref, entry_date, attachments on public.cb_entries for each row
  when (old.kind is distinct from new.kind or old.reason is distinct from new.reason or old.note is distinct from new.note
     or old.reverse_next_year is distinct from new.reverse_next_year or old.wp_ref is distinct from new.wp_ref
     or old.entry_date is distinct from new.entry_date or old.attachments is distinct from new.attachments)
  execute function private.cb_changed('entries', 'An entry changed');
drop trigger if exists cb_changed_entry_lines on public.cb_entry_lines;
create trigger cb_changed_entry_lines after insert or update or delete on public.cb_entry_lines for each row
  execute function private.cb_changed('entries', 'An entry changed');
drop trigger if exists cb_changed_flag_notes on public.cb_flag_notes;
create trigger cb_changed_flag_notes after insert or update or delete on public.cb_flag_notes for each row
  execute function private.cb_changed('entries', 'A lead sheet explanation changed');
drop trigger if exists cb_changed_mapping on public.cb_accounts;
create trigger cb_changed_mapping after update of line_no, tax_code, type_confirm_reason, type_confirmed_line on public.cb_accounts for each row
  when (old.line_no is distinct from new.line_no or old.tax_code is distinct from new.tax_code
     or old.type_confirm_reason is distinct from new.type_confirm_reason or old.type_confirmed_line is distinct from new.type_confirmed_line)
  execute function private.cb_changed('mapping', 'An account''s GIFI line or tax code changed');

-- ---------------------------------------------------------------------------------------------------
-- 9. Standard entry memos print on the client's entry list as typed: plain words for the client.
--    Only the seeded wording changes; a memo an owner has edited stays.
-- ---------------------------------------------------------------------------------------------------
update public.cb_standard_entries set memo = 'Business share of home office costs you paid personally.'
 where memo = 'To record the business share of home office costs paid by the shareholder.';
update public.cb_standard_entries set memo = 'Business share of vehicle costs you paid personally.'
 where memo = 'To record the business share of vehicle costs paid by the shareholder.';
update public.cb_standard_entries set memo = 'Our fee for this year''s financial statements and tax return, owing at year end.'
 where memo = 'To accrue the year-end accounting fee.';
update public.cb_standard_entries set memo = 'Income tax for the year, from the corporate tax return.'
 where memo = 'To record the income tax provision from ProFile.';
