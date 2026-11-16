-- Round 23 (Hashim, Nov 16, 2026): step 3 becomes "Banking", with three sub-steps, each with its own preparer
-- and reviewer sign-off, like step 1's papers:
--   3.1 Bank accounts & T2 tie-out: every account with its balance at last year end, each T2 line within 1.00.
--   3.2 Bank feeds: every account Complete (no missing period, nothing to fix).
--   3.3 Reconcile: every account's year adds up to the bank (DIFFERENCE 0.00), the start of the year explained.
-- Step 3 itself is signed when all three are: the steps after it keep their rules. Bank and card files only.
-- Existing files keep their accounts and statements; a step 3 already signed carries to all three sub-steps.
-- Safe to run twice.

-- ---------- 1. Sub-step sign-offs
create table if not exists public.cb_substep_signoffs (
  file_id      uuid not null references public.cb_files (id) on delete cascade,
  substep      text not null check (substep in ('3.1', '3.2', '3.3')),
  prepared_by  uuid references public.staff (id),
  prepared_at  timestamptz,
  reviewed_by  uuid references public.staff (id),
  reviewed_at  timestamptz,
  primary key (file_id, substep),
  check (reviewed_at is null or prepared_at is not null)
);
alter table public.cb_substep_signoffs enable row level security;
alter table public.cb_substep_signoffs force row level security;
drop policy if exists "Closebook viewers read sub-step sign-offs" on public.cb_substep_signoffs;
create policy "Closebook viewers read sub-step sign-offs" on public.cb_substep_signoffs for select to authenticated using ((select private.can_view('closebook')));
grant select on public.cb_substep_signoffs to authenticated;

-- A step 3 already signed on a bank file: each sub-step carries the same sign-offs (nothing else moves).
insert into public.cb_substep_signoffs (file_id, substep, prepared_by, prepared_at, reviewed_by, reviewed_at)
select s.file_id, x.sub, s.prepared_by, s.prepared_at, s.reviewed_by, s.reviewed_at
  from public.cb_step_signoffs s join public.cb_files f on f.id = s.file_id
 cross join (values ('3.1'), ('3.2'), ('3.3')) x(sub)
 where s.step = 'records' and s.prepared_at is not null and f.books in ('statements', 'paper')
on conflict (file_id, substep) do nothing;

-- ---------- 2. What each sub-step waits for
-- 3.1: the accounts, each balance at last year end, and each T2 line within 1.00 (the T2 is in whole dollars).
create or replace function private.cb_banking31_problems(p_file uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v_file public.cb_files; v_out text[] := '{}'; a record; g record; v_t2 numeric;
begin
  select * into v_file from public.cb_files where id = p_file;
  if not exists (select 1 from public.cb_bank_accounts where file_id = p_file) then
    return array['Add the bank and card accounts.'];
  end if;
  for a in select * from public.cb_bank_accounts where file_id = p_file and books_opening is null order by number loop
    v_out := v_out || format('%s %s: enter its balance at last year end.', a.number, a.name);
  end loop;
  if v_file.opening_source is not null or v_file.first_year then
    -- An account overdrawn at last year end ties to Bank overdraft (2600), as an amount owing.
    for g in select case when a2.kind = 'bank' and a2.books_opening < 0 then '2600' else coalesce(left(a2.gifi_line, 4), left(c.line_no, 4)) end as code,
                    sum(case when a2.kind = 'bank' and a2.books_opening < 0 then -a2.books_opening else coalesce(a2.books_opening, 0) end) as books
               from public.cb_bank_accounts a2 left join public.cb_chart_accounts c on c.number = a2.chart_account
              where a2.file_id = p_file group by 1 order by 1 loop
      v_t2 := coalesce((select amount from public.cb_opening_balances where file_id = p_file and code = g.code), 0);
      if g.code is not null and abs(g.books - v_t2) >= 1 then
        v_out := v_out || format('GIFI %s: the accounts total %s, last year''s T2 has %s (%s %s).', g.code, private.cb_bracket(g.books), private.cb_bracket(v_t2),
          private.cb_bracket(abs(g.books - v_t2)), case when g.books < v_t2 then 'to add' else 'too much' end);
      end if;
    end loop;
  end if;
  return v_out;
end;
$$;

-- The gaps on an account in the year (between the dates it opened and closed): each run of days no statement covers,
-- and each break between two statements that meet (the opening is not the closing before). One shared day is normal.
create or replace function private.cb_bank_gaps(p_account uuid) returns int
language plpgsql stable security definer set search_path = '' as $$
declare a public.cb_bank_accounts; v_file public.cb_files; v_n int; v_gap int; v_from date; v_to date;
begin
  select * into a from public.cb_bank_accounts where id = p_account;
  select * into v_file from public.cb_files where id = a.file_id;
  if a.opened_on is null and a.closed_on is null and a.coverage_note <> '' then return 0; end if;
  v_from := greatest(v_file.year_start, coalesce(a.opened_on, v_file.year_start));
  v_to := least(v_file.year_end, coalesce(a.closed_on, v_file.year_end));
  with days as (
    select d::date as d, exists (select 1 from public.cb_bank_statements s where s.account_id = a.id and d::date between s.period_start and s.period_end) as cov
      from generate_series(v_from::timestamp, v_to::timestamp, interval '1 day') d)
  select count(*) into v_n from (select d, cov, lag(cov) over (order by d) as prev from days) x where not cov and (prev is null or prev);
  select count(*) into v_gap from (
    select s.opening, lag(s.closing) over (order by s.period_start) as prev, lag(s.period_end) over (order by s.period_start) as prev_end, s.period_start
      from public.cb_bank_statements s where s.account_id = a.id) x
   where prev is not null and opening <> prev
     and not exists (select 1 from generate_series((prev_end + 1)::timestamp, (period_start - 1)::timestamp, interval '1 day') d where d::date between v_from and v_to);
  return v_gap + v_n;
end;
$$;
revoke all on function private.cb_bank_gaps(uuid) from public, anon, authenticated;

-- 3.2: every account Complete. A gap is a run of days no statement covers, or a break between two statements
-- that meet (round 22 fixes); an account with a reason recorded and no dates needs none. Statements read
-- and not imported (a misread line) are "to fix".
create or replace function private.cb_banking32_problems(p_file uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v_file public.cb_files; v_out text[] := '{}'; a record; v_n int; v_gap int;
begin
  select * into v_file from public.cb_files where id = p_file;
  for a in select * from public.cb_bank_accounts where file_id = p_file order by number loop
    if a.opened_on is null and a.closed_on is null and a.coverage_note <> '' then continue; end if;
    if not exists (select 1 from public.cb_bank_statements where account_id = a.id) then
      v_out := v_out || format('%s %s: not uploaded.', a.number, a.name);
      continue;
    end if;
    v_gap := private.cb_bank_gaps(a.id);
    if v_gap > 0 then v_out := v_out || format('%s %s: %s missing.', a.number, a.name, v_gap); end if;
  end loop;
  select count(*) into v_n from public.cb_statement_imports i
   where i.file_id = p_file and i.status in ('queued', 'reading', 'ready', 'needs_look')
     and not (coalesce(i.summary ->> 'period_end', '9999-12-31') < v_file.year_start::text or coalesce(i.summary ->> 'period_start', '0000-01-01') > v_file.year_end::text)
     and not (i.file_sha256 is not null and exists (select 1 from public.cb_bank_statements s where s.file_id = p_file and s.file_sha256 = i.file_sha256));
  if v_n > 0 then v_out := v_out || format('%s statement%s to fix.', v_n, case when v_n = 1 then '' else 's' end); end if;
  return v_out;
end;
$$;

-- 3.3: each account's year adds up to the bank. The start band: the bank on the day before the year against
-- the opening, explained by outstanding items (under 1.00 is rounding). DIFFERENCE: opening + lines that post
-- = closing, against the bank at the year end, less items at the year end and whatever the start band holds.
create or replace function private.cb_banking33_problems(p_file uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v_file public.cb_files; v_out text[] := '{}'; a record; v_start numeric; v_end numeric;
begin
  select * into v_file from public.cb_files where id = p_file;
  for a in select * from public.cb_bank_accounts where file_id = p_file order by number loop
    if a.opened_on is null and a.closed_on is null and a.coverage_note <> '' and not exists (select 1 from public.cb_bank_statements where account_id = a.id) then continue; end if;
    v_start := private.cb_edge_left(a.id, 'start');
    if v_start is not null and abs(v_start) >= 1 then
      v_out := v_out || format('%s %s: the start of the year differs from the bank by %s. Explain it.', a.number, a.name, private.cb_bracket(v_start));
    end if;
    -- A missing period (3.2) comes first: the year's difference waits until it is in.
    if not exists (select 1 from public.cb_bank_statements where account_id = a.id) or private.cb_bank_gaps(a.id) > 0 then continue; end if;
    v_end := private.cb_edge_left(a.id, 'end');
    if v_end is null then
      if a.books_opening is not null then v_out := v_out || format('%s %s: no statement covers the year end yet.', a.number, a.name); end if;
    elsif v_end - coalesce(v_start, 0) <> 0 then
      v_out := v_out || format('%s %s: DIFFERENCE %s.', a.number, a.name, private.cb_bracket(v_end - coalesce(v_start, 0)));
    end if;
  end loop;
  return v_out;
end;
$$;

create or replace function private.cb_banking_problems(p_file uuid, p_sub text) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v_out text[];
begin
  v_out := case p_sub when '3.1' then private.cb_banking31_problems(p_file) when '3.2' then private.cb_banking32_problems(p_file)
                      when '3.3' then private.cb_banking33_problems(p_file) else array['Unknown sub-step.'] end;
  return v_out;
end;
$$;

-- Step 3's own list (the steps list and anything that reads step 3) is the three sub-steps' lists.
create or replace function private.cb_records_problems(p_file uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
begin
  return private.cb_banking31_problems(p_file) || private.cb_banking32_problems(p_file) || private.cb_banking33_problems(p_file);
end;
$$;
revoke all on function private.cb_banking31_problems(uuid), private.cb_banking32_problems(uuid), private.cb_banking33_problems(uuid),
  private.cb_banking_problems(uuid, text), private.cb_records_problems(uuid) from public, anon, authenticated;

-- ---------- 3. Signing a sub-step. Step 3 is signed as prepared when all three are, and as reviewed when all three are.
create or replace function private.cb_records_follow(p_file uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_prep int; v_rev int; v_pby uuid; v_pat timestamptz; v_rby uuid; v_rat timestamptz;
begin
  select count(*) filter (where prepared_at is not null), count(*) filter (where reviewed_at is not null) into v_prep, v_rev
    from public.cb_substep_signoffs where file_id = p_file;
  select prepared_by, prepared_at into v_pby, v_pat from public.cb_substep_signoffs where file_id = p_file and prepared_at is not null order by prepared_at desc limit 1;
  select reviewed_by, reviewed_at into v_rby, v_rat from public.cb_substep_signoffs where file_id = p_file and reviewed_at is not null order by reviewed_at desc limit 1;
  if v_prep = 3 then
    insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at, reviewed_by, reviewed_at)
    values (p_file, 'records', v_pby, v_pat, case when v_rev = 3 then v_rby end, case when v_rev = 3 then v_rat end)
    on conflict (file_id, step) do update set prepared_by = excluded.prepared_by, prepared_at = excluded.prepared_at,
      reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at;
  elsif exists (select 1 from public.cb_step_signoffs where file_id = p_file and step = 'records') then
    perform private.cb_clear_step(p_file, 'records', 'A Banking sub-step was taken back or changed');
  end if;
end;
$$;
revoke all on function private.cb_records_follow(uuid) from public, anon, authenticated;

create or replace function public.cb_sign_substep(p_file uuid, p_sub text, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files; r public.cb_substep_signoffs; v_list text[];
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(v_file.books in ('statements', 'paper'), 'Banking sub-steps are for bank and card files.');
  perform private.require(p_sub in ('3.1', '3.2', '3.3'), 'Unknown sub-step.');
  perform private.require(p_role in ('prepared', 'reviewed'), 'Unknown sign-off.');
  select * into r from public.cb_substep_signoffs where file_id = p_file and substep = p_sub;
  v_list := private.cb_banking_problems(p_file, p_sub);
  if p_role = 'prepared' then
    perform private.require(r.prepared_at is null, 'This sub-step is already signed as prepared.');
    perform private.require(cardinality(v_list) = 0, 'Not yet: ' || array_to_string(v_list, ' '));
    insert into public.cb_substep_signoffs (file_id, substep, prepared_by, prepared_at) values (p_file, p_sub, (select auth.uid()), now())
    on conflict (file_id, substep) do update set prepared_by = excluded.prepared_by, prepared_at = excluded.prepared_at, reviewed_by = null, reviewed_at = null;
    perform private.cb_log(p_file, 'prepared', 'records', 'Sub-step ' || p_sub);
  else
    perform private.require(private.is_owner(), 'Only the reviewer signs as reviewer. Reviewers are owners.');
    perform private.require(r.prepared_at is not null, 'The preparer signs first.');
    perform private.require(r.reviewed_at is null, 'This sub-step is already reviewed.');
    perform private.require(cardinality(v_list) = 0, 'Not yet: ' || array_to_string(v_list, ' '));
    update public.cb_substep_signoffs set reviewed_by = (select auth.uid()), reviewed_at = now() where file_id = p_file and substep = p_sub;
    perform private.cb_log(p_file, 'reviewed', 'records', 'Sub-step ' || p_sub || case when r.prepared_by = (select auth.uid()) then ': prepared and reviewed by the same person' else '' end);
  end if;
  perform private.cb_records_follow(p_file);
  update public.cb_files set updated_at = now() where id = p_file;
end;
$$;

create or replace function public.cb_unsign_substep(p_file uuid, p_sub text, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files; r public.cb_substep_signoffs;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  select * into r from public.cb_substep_signoffs where file_id = p_file and substep = p_sub;
  if p_role = 'reviewed' then
    perform private.require(r.reviewed_at is not null and (r.reviewed_by = (select auth.uid()) or private.is_owner()), 'There is no reviewer sign-off of yours to take back.');
    update public.cb_substep_signoffs set reviewed_by = null, reviewed_at = null where file_id = p_file and substep = p_sub;
    perform private.cb_log(p_file, 'unsigned_reviewed', 'records', 'Sub-step ' || p_sub);
  else
    perform private.require(r.prepared_at is not null and r.prepared_by = (select auth.uid()), 'There is no preparer sign-off of yours to take back.');
    perform private.require(r.reviewed_at is null, 'The sub-step is reviewed: the reviewer takes back their sign-off first.');
    delete from public.cb_substep_signoffs where file_id = p_file and substep = p_sub;
    perform private.cb_log(p_file, 'unsigned_prepared', 'records', 'Sub-step ' || p_sub);
  end if;
  perform private.cb_records_follow(p_file);
end;
$$;

-- Each sub-step's sign-offs and what it waits for, as the screens show them.
create or replace function public.cb_substep_status(p_file uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb := '{}'::jsonb; s text; r public.cb_substep_signoffs;
begin
  perform private.require(private.can_view('closebook'), 'You need Closebook access.');
  foreach s in array array['3.1', '3.2', '3.3'] loop
    select * into r from public.cb_substep_signoffs where file_id = p_file and substep = s;
    v := v || jsonb_build_object(s, jsonb_build_object('prepared_by', r.prepared_by, 'prepared_at', r.prepared_at, 'reviewed_by', r.reviewed_by,
      'reviewed_at', r.reviewed_at, 'problems', to_jsonb(private.cb_banking_problems(p_file, s))));
  end loop;
  return v;
end;
$$;
revoke all on function public.cb_sign_substep(uuid, text, text), public.cb_unsign_substep(uuid, text, text), public.cb_substep_status(uuid) from public, anon;
grant execute on function public.cb_sign_substep(uuid, text, text), public.cb_unsign_substep(uuid, text, text), public.cb_substep_status(uuid) to authenticated;

-- Step 3 on a bank file is signed in its sub-steps, not as a whole.
do $$
declare d text; k text := 'perform private.require(p_role in (''prepared'', ''reviewed''), ''Unknown sign-off.'');';
begin
  d := pg_get_functiondef('public.cb_sign_step(uuid, text, text)'::regprocedure);
  if position('signed in its sub-steps' in d) = 0 and position(k in d) > 0 then
    execute replace(d, k, k || E'\n  perform private.require(not (p_step = ''records'' and v_file.books in (''statements'', ''paper'')), ''Step 3 is signed in its sub-steps: 3.1, 3.2 and 3.3.'');');
  end if;
end $$;

-- ---------- 4. A change saved after sign-off clears the sign-off (CaseWare). Accounts: 3.1 and 3.3; statements:
-- 3.2 and 3.3; outstanding items: 3.3. Step 3 then follows.
create or replace function private.cb_clear_substeps(p_file uuid, p_subs text[], p_why text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  delete from public.cb_substep_signoffs where file_id = p_file and substep = any (p_subs);
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform private.cb_log(p_file, 'signoff_cleared', 'records', p_why);
    perform private.cb_records_follow(p_file);
  end if;
end;
$$;
revoke all on function private.cb_clear_substeps(uuid, text[], text) from public, anon, authenticated;

create or replace function private.cb_banking_changed() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_file uuid := coalesce(new.file_id, old.file_id);
begin
  if not exists (select 1 from public.cb_substep_signoffs where file_id = v_file) then return coalesce(new, old); end if;
  if tg_table_name = 'cb_bank_accounts' then
    if tg_op <> 'UPDATE' or new.books_opening is distinct from old.books_opening or new.gifi_line is distinct from old.gifi_line
       or new.chart_account is distinct from old.chart_account or new.last4 is distinct from old.last4 then
      perform private.cb_clear_substeps(v_file, array['3.1', '3.3'], 'An account changed');
    end if;
    if tg_op = 'UPDATE' and (new.opened_on is distinct from old.opened_on or new.closed_on is distinct from old.closed_on or new.coverage_note is distinct from old.coverage_note) then
      perform private.cb_clear_substeps(v_file, array['3.2', '3.3'], 'An account''s months changed');
    end if;
  elsif tg_table_name = 'cb_bank_statements' then
    perform private.cb_clear_substeps(v_file, array['3.2', '3.3'], case when tg_op = 'DELETE' then 'A statement was deleted' else 'A statement was added' end);
  elsif tg_table_name = 'cb_bank_outstanding' then
    perform private.cb_clear_substeps(v_file, array['3.3'], 'An outstanding item changed');
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function private.cb_banking_changed() from public, anon, authenticated;
drop trigger if exists cb_banking_changed on public.cb_bank_accounts;
create trigger cb_banking_changed after insert or update or delete on public.cb_bank_accounts for each row execute function private.cb_banking_changed();
drop trigger if exists cb_banking_changed on public.cb_bank_statements;
create trigger cb_banking_changed after insert or delete on public.cb_bank_statements for each row execute function private.cb_banking_changed();
drop trigger if exists cb_banking_changed on public.cb_bank_outstanding;
create trigger cb_banking_changed after insert or update or delete on public.cb_bank_outstanding for each row execute function private.cb_banking_changed();

-- ---------- 4b. A statement that touches the year goes in even with no line inside it (Hashim, round 23): the one
-- ending Sep 2 that holds only August lines still covers Sep 1 and 2, and gives the bank's balance on Aug 31.
do $$
declare d text; k text := $k$  perform private.require(v_in > 0, 'No line of this statement is inside the year: it is not needed. Skip it.');$k$;
begin
  d := pg_get_functiondef('private.cb_add_statement(uuid, uuid, text, numeric, numeric, jsonb, date, date, numeric, numeric, text)'::regprocedure);
  if position(k in d) > 0 then execute replace(d, k, ''); end if;
end $$;

-- ---------- 5. One CSV for the account (as today: refused unless opening + lines = the closing entered). It goes
-- through the same rules as a PDF statement (private.cb_add_statement): only lines inside the year are kept, one
-- shared day with another statement is normal, the same period twice is refused. The bank's balance on the day
-- before the year and on its last day is worked out from the CSV, for 3.3.
create or replace function public.cb_import_csv(p_file uuid, p_account uuid, p_file_name text, p_opening numeric, p_closing numeric, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files; v_first date; v_last date; v_ps date; v_pe date; v_start numeric; v_end numeric; v jsonb;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file;
  perform private.require(v_file.id is not null, 'File not found.');
  perform private.require(jsonb_typeof(p_rows) = 'array' and jsonb_array_length(p_rows) > 0, 'The CSV has no lines.');
  select min((r ->> 'date')::date), max((r ->> 'date')::date) into v_first, v_last from jsonb_array_elements(p_rows) r;
  -- A CSV for the year: it covers the year from its first day when its first line is in the first month, and to
  -- the last day when its last line is in the last month.
  v_ps := case when v_first between v_file.year_start and v_file.year_start + 31 then v_file.year_start else v_first end;
  v_pe := case when v_last between v_file.year_end - 31 and v_file.year_end then v_file.year_end else v_last end;
  if v_file.year_start between v_ps and v_pe then
    v_start := p_opening + coalesce((select sum((r ->> 'amount')::numeric) from jsonb_array_elements(p_rows) r where (r ->> 'date')::date < v_file.year_start), 0);
  end if;
  if v_file.year_end between v_ps and v_pe then
    v_end := p_opening + coalesce((select sum((r ->> 'amount')::numeric) from jsonb_array_elements(p_rows) r where (r ->> 'date')::date <= v_file.year_end), 0);
  end if;
  v := private.cb_add_statement(p_file, p_account, p_file_name, p_opening, p_closing, p_rows, v_ps, v_pe, v_start, v_end, null);
  update public.cb_bank_statements set source = 'csv' where id = (v ->> 'statement')::uuid;
  perform private.cb_log(p_file, 'bank_csv', 'records', format('%s: CSV %s, %s lines in the year.', v ->> 'account', left(coalesce(p_file_name, ''), 120), v ->> 'lines'));
  return v;
end;
$$;
revoke all on function public.cb_import_csv(uuid, uuid, text, numeric, numeric, jsonb) from public, anon;
grant execute on function public.cb_import_csv(uuid, uuid, text, numeric, numeric, jsonb) to authenticated;
