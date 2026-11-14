-- Round 14 fixes (Hashim, Nov 14, 2026), on the same PR. Safe to run twice.
-- 1. A debit balance is split by when it arose, repayments against the oldest balance first: last year's
--    part (its s.15(2) date, this year end, has passed: the reviewer) and this year's part (its date is
--    next year end: My day). Next year's file answers "Repaid by" from its own postings; the preparer
--    confirms it, with no Yes or No to pick and no evidence to attach.
-- 2. The s.15(2) test is on each shareholder's accounts together: shareholder 1 or 2 from the standard
--    chart; any other account is picked by the preparer on the schedule, and the choice rolls forward.
-- The schedule is still worked out by the app (src/lib/closebook/sh-loans.ts) and saved here with the
-- books' fingerprint.

-- ---------------------------------------------------------------------------------------------------
-- Tables.
-- ---------------------------------------------------------------------------------------------------
-- The preparer's pick of shareholder for an account that is not one of the standard chart's.
create table if not exists public.cb_sh_owners (
  file_id      uuid not null references public.cb_files (id) on delete cascade,
  account_key  text not null,
  shareholder  smallint not null check (shareholder between 1 and 9),
  source       text not null default 'picked' check (source in ('picked', 'rolled')),
  picked_by    uuid references public.staff (id),
  picked_at    timestamptz not null default now(),
  primary key (file_id, account_key)
);
alter table public.cb_sh_schedules add column if not exists shareholder smallint;
alter table public.cb_sh_schedules add column if not exists owner_source text not null default '';
alter table public.cb_sh_schedules drop column if exists flags;
alter table public.cb_sh_schedules drop column if exists due_on;
alter table public.cb_sh_schedules drop column if exists prior_due_on;
-- Each shareholder's accounts together, as prepared. group_key: "sh:1", or "none:<account>" for an
-- account whose shareholder is not picked yet. Amounts debit positive.
create table if not exists public.cb_sh_groups (
  file_id        uuid not null references public.cb_files (id) on delete cascade,
  group_key      text not null,
  shareholder    smallint,
  accounts       text[] not null default '{}',
  opening        numeric(14, 2) not null,
  closing        numeric(14, 2) not null,
  reductions     numeric(14, 2) not null default 0,
  last_part      numeric(14, 2) not null default 0,
  this_part      numeric(14, 2) not null default 0,
  due_on         date,
  prior_due_on   date,
  prior_opening  numeric(14, 2),
  prior_repaid   numeric(14, 2),
  prior_unpaid   numeric(14, 2),
  flags          text[] not null default '{}' check (flags <@ array['earlier_debit', 'late_repayment']),
  primary key (file_id, group_key)
);
-- "Repaid by": now the preparer's confirmation of the figures worked out from the postings. account_key
-- holds the group key. The unpaid part goes to the reviewer through the earlier_debit flag.
drop trigger if exists cb_changed_sh_repaid on public.cb_sh_repaid;
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cb_sh_repaid' and column_name = 'answer') then
    delete from public.cb_sh_repaid;   -- the first build's answers (Test only, dummy files)
  end if;
end $$;
alter table public.cb_sh_repaid drop constraint if exists cb_sh_repaid_check;
alter table public.cb_sh_repaid drop column if exists answer;
alter table public.cb_sh_repaid drop column if exists evidence_kind;
alter table public.cb_sh_repaid drop column if exists evidence_ref;
alter table public.cb_sh_repaid drop column if exists evidence_label;
alter table public.cb_sh_repaid drop column if exists note;
alter table public.cb_sh_repaid drop column if exists accepted_by;
alter table public.cb_sh_repaid drop column if exists accepted_at;
alter table public.cb_sh_repaid drop column if exists accepted_why;
alter table public.cb_sh_repaid add column if not exists opening numeric(14, 2) not null default 0;
alter table public.cb_sh_repaid add column if not exists repaid numeric(14, 2) not null default 0;
alter table public.cb_sh_repaid add column if not exists unpaid numeric(14, 2) not null default 0;
create trigger cb_changed_sh_repaid after insert or update of repaid, unpaid, due_on on public.cb_sh_repaid for each row
  execute function private.cb_changed('entries', 'A shareholder loan repayment was confirmed');
-- Flags are now per shareholder: drop the first build's per-account rows (Test only, dummy files).
delete from public.cb_sh_flags where account_key not like 'sh:%';
do $$ declare t text;
begin
  foreach t in array array['cb_sh_owners', 'cb_sh_groups'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists "Closebook viewers read" on public.%I', t);
    execute format('create policy "Closebook viewers read" on public.%I for select to authenticated using ((select private.can_view(''closebook'')))', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop trigger if exists cb_locked_guard on public.%I', t);
    execute format('create trigger cb_locked_guard before insert or update or delete on public.%I for each row execute function private.cb_locked_guard()', t);
  end loop;
end $$;

-- The books the schedule rests on, now with the shareholder picks.
create or replace function private.cb_sh_fingerprint(p_file uuid) returns text
language sql stable security definer set search_path = '' as $$
  select md5(private.cb_tb_fingerprint(p_file)
    || coalesce((select string_agg(l.id::text || l.txn_date::text || l.amount::text || l.status || coalesce(l.chart_account, ''), ',' order by l.id) from public.cb_bank_lines l where l.file_id = p_file), '')
    || coalesce((select string_agg(e.id::text || coalesce(e.entry_date::text, '') || coalesce(e.origin, ''), ',' order by e.id) from public.cb_entries e where e.file_id = p_file), '')
    || coalesce((select string_agg(o.account_key || '=' || o.shareholder, ',' order by o.account_key) from public.cb_sh_owners o where o.file_id = p_file), ''))
$$;
revoke all on function private.cb_sh_fingerprint(uuid) from public, anon, authenticated;
create or replace function private.cb_sh_label(p_key text) returns text
language sql immutable set search_path = '' as $$
  select case when p_key like 'sh:%' then 'Shareholder ' || substr(p_key, 4) else 'Shareholder not picked' end
$$;

-- ---------------------------------------------------------------------------------------------------
-- Prepare, pick, confirm.
-- ---------------------------------------------------------------------------------------------------
drop function if exists public.cb_prepare_sh_schedule(uuid, jsonb);
drop function if exists public.cb_answer_sh_repaid(uuid, text, text, text, uuid, text);
drop function if exists public.cb_accept_sh_repaid(uuid, text, text);

-- p_rows: [{account_key, number, name, line_no, opening, closing, tb, movements, shareholder, owner_source}]
-- p_groups: [{group_key, shareholder, accounts, opening, closing, reductions, last_part, this_part, due_on,
--             prior_due_on, prior_opening, prior_repaid, prior_unpaid, flags, flag_amounts: {flag: amount}}]
create or replace function public.cb_prepare_sh_schedule(p_file uuid, p_rows jsonb, p_groups jsonb) returns void
language plpgsql security definer set search_path = '' as $$
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
    perform private.require(round((x ->> 'last_part')::numeric + (x ->> 'this_part')::numeric, 2) = greatest(round((x ->> 'closing')::numeric, 2), 0) or x ->> 'group_key' like 'none:%',
      'Last year''s part and this year''s part add up to the balance owed at year end.');
    insert into public.cb_sh_groups (file_id, group_key, shareholder, accounts, opening, closing, reductions, last_part, this_part, due_on, prior_due_on, prior_opening, prior_repaid, prior_unpaid, flags)
    values (p_file, x ->> 'group_key', nullif(x ->> 'shareholder', '')::smallint, coalesce(array(select jsonb_array_elements_text(x -> 'accounts')), '{}'),
      round((x ->> 'opening')::numeric, 2), round((x ->> 'closing')::numeric, 2), round(coalesce((x ->> 'reductions')::numeric, 0), 2),
      round((x ->> 'last_part')::numeric, 2), round((x ->> 'this_part')::numeric, 2), nullif(x ->> 'due_on', '')::date,
      nullif(x ->> 'prior_due_on', '')::date, round((x ->> 'prior_opening')::numeric, 2), round((x ->> 'prior_repaid')::numeric, 2), round((x ->> 'prior_unpaid')::numeric, 2),
      coalesce(array(select jsonb_array_elements_text(x -> 'flags')), '{}'));
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
        accepted_why = case when public.cb_sh_flags.closing = excluded.closing then public.cb_sh_flags.accepted_why else '' end;
    end loop;
  end loop;
  delete from public.cb_sh_flags g where g.file_id = p_file
    and not exists (select 1 from public.cb_sh_groups s where s.file_id = p_file and s.group_key = g.account_key and g.flag = any (s.flags));
  delete from public.cb_sh_repaid r where r.file_id = p_file
    and not exists (select 1 from public.cb_sh_groups s where s.file_id = p_file and s.group_key = r.account_key and s.prior_due_on = r.due_on);
  insert into public.cb_sh_prepared (file_id, fingerprint, prepared_by) values (p_file, private.cb_sh_fingerprint(p_file), (select auth.uid()))
  on conflict (file_id) do update set fingerprint = excluded.fingerprint, prepared_by = excluded.prepared_by, prepared_at = now();
  perform private.cb_log(p_file, 'sh_prepared', 'entries', format('Shareholder loan schedule prepared: %s account%s, %s shareholder%s',
    jsonb_array_length(p_rows), case when jsonb_array_length(p_rows) = 1 then '' else 's' end, jsonb_array_length(p_groups), case when jsonb_array_length(p_groups) = 1 then '' else 's' end));
end;
$$;

-- The preparer picks the shareholder of an account that is not one of the standard chart's.
create or replace function public.cb_set_sh_owner(p_file uuid, p_account text, p_shareholder int) returns void
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(p_shareholder between 1 and 9, 'Pick shareholder 1 to 9.');
  perform private.require(p_account not in ('chart:13000', 'chart:23000', 'chart:25400', 'chart:13050', 'chart:23050'),
    'The standard chart sets this account''s shareholder.');
  perform private.require(exists (select 1 from public.cb_accounts a where a.file_id = p_file and a.account_key = p_account
     and left(coalesce(a.line_no, ''), 4) in ('1301', '1302', '1303', '2780', '2781', '2782', '2783', '3260', '3261', '3262', '3263')),
    'That account is not on a shareholder line.');
  insert into public.cb_sh_owners (file_id, account_key, shareholder, source, picked_by) values (p_file, p_account, p_shareholder, 'picked', (select auth.uid()))
  on conflict (file_id, account_key) do update set shareholder = excluded.shareholder, source = 'picked', picked_by = excluded.picked_by, picked_at = now();
  perform private.cb_log(p_file, 'sh_owner', 'entries', format('%s: shareholder %s', p_account, p_shareholder));
end;
$$;

-- The preparer confirms "Repaid by", as worked out from this year's postings.
create or replace function public.cb_confirm_sh_repaid(p_file uuid, p_group text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files; g public.cb_sh_groups;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(not exists (select 1 from public.cb_sh_prepared p where p.file_id = p_file and p.fingerprint <> private.cb_sh_fingerprint(p_file)),
    'The books changed after the schedule was prepared. Prepare it again first.');
  select * into g from public.cb_sh_groups where file_id = p_file and group_key = p_group;
  perform private.require(g.prior_due_on is not null, 'There is no balance owed at the start of the year to confirm.');
  insert into public.cb_sh_repaid (file_id, account_key, due_on, opening, repaid, unpaid, answered_by)
  values (p_file, p_group, g.prior_due_on, g.prior_opening, g.prior_repaid, g.prior_unpaid, (select auth.uid()))
  on conflict (file_id, account_key) do update set due_on = excluded.due_on, opening = excluded.opening, repaid = excluded.repaid, unpaid = excluded.unpaid,
    answered_by = excluded.answered_by, answered_at = now();
  perform private.cb_log(p_file, 'sh_repaid_confirmed', 'entries', format('%s: owed %s at the start of the year; repaid by %s: %s; not repaid: %s',
    private.cb_sh_label(p_group), private.cb_money(g.prior_opening), to_char(g.prior_due_on, 'Mon FMDD, YYYY'), private.cb_money(g.prior_repaid), private.cb_money(g.prior_unpaid)));
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
  perform private.cb_log(p_file, 'sh_flag_answered', 'entries', format('%s: %s', private.cb_sh_label(p_account), btrim(p_note)));
end;
$$;

revoke all on function public.cb_prepare_sh_schedule(uuid, jsonb, jsonb), public.cb_set_sh_owner(uuid, text, int), public.cb_confirm_sh_repaid(uuid, text) from public, anon;
grant execute on function public.cb_prepare_sh_schedule(uuid, jsonb, jsonb), public.cb_set_sh_owner(uuid, text, int), public.cb_confirm_sh_repaid(uuid, text) to authenticated;
revoke all on function private.cb_sh_label(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Step 5's rules.
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
  select count(*) into v_n from public.cb_sh_schedules where file_id = p_file and shareholder is null;
  if v_n > 0 then v_out := v_out || format('Shareholder loan schedule: pick the shareholder for %s account%s.', v_n, case when v_n = 1 then '' else 's' end); end if;
  select count(*) into v_n from public.cb_sh_flags where file_id = p_file and note = '';
  if v_n > 0 then v_out := v_out || format('Shareholder loan schedule: answer %s flag%s for the reviewer.', v_n, case when v_n = 1 then '' else 's' end); end if;
  select count(*) into v_n from public.cb_sh_groups g where g.file_id = p_file and g.prior_due_on is not null
     and not exists (select 1 from public.cb_sh_repaid r where r.file_id = p_file and r.account_key = g.group_key and r.due_on = g.prior_due_on
                        and r.repaid = g.prior_repaid and r.unpaid = g.prior_unpaid);
  if v_n > 0 then v_out := v_out || format('Shareholder loan schedule: confirm "Repaid by" for %s shareholder%s.', v_n, case when v_n = 1 then '' else 's' end); end if;
  return v_out;
end;
$$;

create or replace function private.cb_sh_waiting(p_file uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v_out text[] := '{}'; v_n int;
begin
  select count(*) into v_n from public.cb_sh_flags where file_id = p_file and note <> '' and accepted_at is null;
  if v_n > 0 then v_out := v_out || format('%s shareholder loan flag%s for the reviewer.', v_n, case when v_n = 1 then '' else 's' end); end if;
  return v_out;
end;
$$;
revoke all on function private.cb_sh_problems(uuid), private.cb_sh_waiting(uuid) from public, anon, authenticated;

-- My day: this year's part of each shareholder's debit, with its s.15(2) date, until the client's next
-- file confirms it was repaid in full. Owners see every file; other staff the files they prepare.
drop function if exists public.cb_sh_due_list();
create function public.cb_sh_due_list() returns table (
  file_id uuid, client_id uuid, client_name text, year_end date, shareholder smallint, accounts text, amount numeric, due_on date, next_file uuid, unpaid numeric)
language sql stable security definer set search_path = '' as $$
  select g.file_id, f.client_id, c.legal_name, f.year_end, g.shareholder,
         (select string_agg(s.number || ' ' || s.name, ', ' order by s.number) from public.cb_sh_schedules s where s.file_id = g.file_id and s.account_key = any (g.accounts)),
         g.this_part, g.due_on, n.id, r.unpaid
    from public.cb_sh_groups g
    join public.cb_files f on f.id = g.file_id
    join public.clients c on c.id = f.client_id
    left join lateral (select x.id from public.cb_files x where x.client_id = f.client_id and x.year_start > f.year_end order by x.year_start limit 1) n on true
    left join public.cb_sh_repaid r on r.file_id = n.id and r.account_key = g.group_key and r.due_on = g.due_on
   where g.this_part > 0 and g.due_on is not null and private.can_view('closebook')
     and (private.is_owner() or f.preparer_id = (select auth.uid()))
     and coalesce(r.unpaid, -1) <> 0
   order by g.due_on, c.legal_name, g.shareholder
$$;
revoke all on function public.cb_sh_due_list() from public, anon;
grant execute on function public.cb_sh_due_list() to authenticated;
