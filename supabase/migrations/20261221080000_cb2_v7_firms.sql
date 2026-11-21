-- CloseBook2 piece CB2-0 version 7, Part 4 item 5 (Hashim, Nov 21, 2026; docs/CLOSEBOOK2.md rule 12): firm ID with
-- row-level security. Tables firms and firm_members; every Closebook (cb_) row carries a firm ID, Concept's for every row
-- today. A person sees and changes only their own firm's rows:
--   1. a restrictive row-level security policy on every cb_ table (direct reads and writes);
--   2. a guard trigger on every cb_ table, so the database functions (which run with the owner's rights) cannot change
--      another firm's row either;
--   3. the database functions that return a file's data check the file's firm first.
-- Not a member of a firm (the service role, a client answering by link) is not limited here, as before.
create table if not exists public.firms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.firm_members (
  firm_id uuid not null references public.firms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id)
);
alter table public.firms enable row level security;
alter table public.firm_members enable row level security;
insert into public.firms (id, name) values ('c0ce9700-0000-4000-8000-000000000001', 'Concept Accounting & Advisory') on conflict (id) do nothing;

create or replace function private.concept_firm() returns uuid language sql immutable set search_path to ''
as $f$ select 'c0ce9700-0000-4000-8000-000000000001'::uuid $f$;
create or replace function private.my_firm() returns uuid language sql stable security definer set search_path to ''
as $f$ select m.firm_id from public.firm_members m where m.user_id = (select auth.uid()) $f$;
-- The firm a new row gets: the person's own, else Concept's (the service role, migrations, the answer-key loader).
create or replace function private.cb_default_firm() returns uuid language sql stable security definer set search_path to ''
as $f$ select coalesce(private.my_firm(), private.concept_firm()) $f$;
revoke all on function private.my_firm() from public, anon;
grant execute on function private.my_firm() to authenticated;
revoke all on function private.cb_default_firm() from public, anon;
grant execute on function private.cb_default_firm() to authenticated;

drop policy if exists "Members read their firm" on public.firms;
create policy "Members read their firm" on public.firms for select to authenticated using (id = (select private.my_firm()));
drop policy if exists "Members read their membership" on public.firm_members;
create policy "Members read their membership" on public.firm_members for select to authenticated using (user_id = (select auth.uid()));
grant select on public.firms, public.firm_members to authenticated;

-- Every staff member today is Concept's; a new staff member joins Concept until firms are set up in Settings.
insert into public.firm_members (firm_id, user_id) select private.concept_firm(), s.id from public.staff s
  where exists (select 1 from auth.users u where u.id = s.id) on conflict (user_id) do nothing;
create or replace function private.firm_member_for_staff() returns trigger language plpgsql security definer set search_path to ''
as $f$
begin
  if exists (select 1 from auth.users u where u.id = new.id) then
    insert into public.firm_members (firm_id, user_id) values (private.concept_firm(), new.id) on conflict (user_id) do nothing;
  end if;
  return new;
end;
$f$;
revoke all on function private.firm_member_for_staff() from public, anon, authenticated;
drop trigger if exists firm_member_for_staff on public.staff;
create trigger firm_member_for_staff after insert on public.staff for each row execute function private.firm_member_for_staff();

-- The guard: a firm member never changes another firm's row, through any path.
create or replace function private.cb_firm_guard() returns trigger language plpgsql security definer set search_path to ''
as $f$
declare v uuid;
begin
  if (select auth.uid()) is null then return coalesce(new, old); end if;
  v := private.my_firm();
  if v is null then return coalesce(new, old); end if;
  if tg_op in ('UPDATE', 'DELETE') and old.firm_id is distinct from v then
    raise exception 'Not found.' using errcode = '42501';
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    if new.firm_id is null then new.firm_id := v;
    elsif new.firm_id is distinct from v then raise exception 'Not found.' using errcode = '42501';
    end if;
    return new;
  end if;
  return old;
end;
$f$;
revoke all on function private.cb_firm_guard() from public, anon, authenticated;

-- A file of another firm reads as not found in the functions that return a file's data.
create or replace function private.cb_firm_file(p_file uuid) returns void language plpgsql stable security definer set search_path to ''
as $f$
declare v uuid := private.my_firm();
begin
  if v is not null and exists (select 1 from public.cb_files f where f.id = p_file and f.firm_id is distinct from v) then
    raise exception 'File not found.' using errcode = 'P0001';
  end if;
end;
$f$;
revoke all on function private.cb_firm_file(uuid) from public, anon;
grant execute on function private.cb_firm_file(uuid) to authenticated;

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename like 'cb\_%' order by tablename loop
    execute format('alter table public.%I add column if not exists firm_id uuid not null default private.cb_default_firm() references public.firms (id)', t);
    execute format('create index if not exists %I on public.%I (firm_id)', t || '_firm_idx', t);
    execute format('drop policy if exists "Own firm only" on public.%I', t);
    execute format('create policy "Own firm only" on public.%I as restrictive for all to authenticated using (firm_id = (select private.my_firm())) with check (firm_id = (select private.my_firm()))', t);
    execute format('drop trigger if exists cb_0_firm_guard on public.%I', t);
    execute format('create trigger cb_0_firm_guard before insert or update or delete on public.%I for each row execute function private.cb_firm_guard()', t);
  end loop;
end $$;

CREATE OR REPLACE FUNCTION public.cb_sh_status(p_file uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p public.cb_sh_prepared;
begin
  perform private.cb_firm_file(p_file);   -- CB2-0 v7 item 5
  perform private.require(private.can_view('closebook'), 'You need View on Closebook.');
  select * into p from public.cb_sh_prepared where file_id = p_file;
  return jsonb_build_object('applies', private.cb_sh_applies(p_file), 'prepared_at', p.prepared_at, 'prepared_by', p.prepared_by,
    'stale', p.file_id is not null and p.fingerprint <> private.cb_sh_fingerprint(p_file),
    'problems', to_jsonb(private.cb_sh_review_problems(p_file)), 'waiting', '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_revenue_status(p_file uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.cb_firm_file(p_file);   -- CB2-0 v7 item 5
  perform private.require(private.can_view('closebook'), 'You need Closebook access.');
  return private.cb_revenue_state(p_file) || jsonb_build_object('added', private.cb_revenue_added(p_file));
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_t2_status(p_file uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.cb_firm_file(p_file);   -- CB2-0 v7 item 5
  perform private.require(private.can_view('closebook'), 'You need Closebook access.');
  return private.cb_t2_state(p_file);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_fs_status(p_file uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f public.cb_file_fs; q record; s record; w record;
begin
  perform private.cb_firm_file(p_file);   -- CB2-0 v7 item 5
  perform private.require(private.can_view('closebook'), 'You need Closebook access.');
  select * into f from public.cb_file_fs where file_id = p_file;
  select id, status, sent_at, signed_at into q from public.quotes where id = f.mal_quote_id;
  select first_name, last_name, email, token, signed_at, signed_name, signed_title into s from public.quote_signers where quote_id = f.mal_quote_id order by person limit 1;
  select id, status into w from public.quotes where id = f.mal_withdrawn_quote;
  return jsonb_build_object('mal_quote_id', f.mal_quote_id, 'mal_status', q.status, 'mal_sent_at', f.mal_sent_at, 'mal_sent_by', f.mal_sent_by,
    'mal_token', s.token, 'mal_email', s.email, 'mal_signed_at', s.signed_at, 'mal_signed_name', s.signed_name, 'mal_signed_title', s.signed_title,
    'mal_withdrawn_at', f.mal_withdrawn_at, 'mal_withdrawn_why', f.mal_withdrawn_why, 'mal_withdrawn_status', w.status);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_close_status(p_file uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s record;
begin
  perform private.cb_firm_file(p_file);   -- CB2-0 v7 item 5
  perform private.require(private.can_view('closebook'), 'You need Closebook access.');
  select * into s from private.cb_mal_signed_row(p_file) as (signed_at timestamptz, signed_name text, signed_title text);
  return jsonb_build_object('mal_signed_at', s.signed_at, 'mal_signed_name', s.signed_name, 'mal_signed_title', s.signed_title,
    'step10', to_jsonb(private.cb_step10_problems(p_file)), 'lock', to_jsonb(private.cb_lock_problems(p_file)));
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_match_state(p_file uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.cb_firm_file(p_file);   -- CB2-0 v7 item 5
  perform private.require(private.can_view('closebook'), 'You need Closebook access.');
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object('account_id', i.account_id, 'reason', i.reason)) from private.cb_match_items(p_file) i), '[]'::jsonb),
    'ties', private.cb_match_ties(p_file),
    'problems', to_jsonb(private.cb_match_problems(p_file)));
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_step_status(p_file uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v jsonb := '{}'::jsonb; s text; r public.cb_step_signoffs;
begin
  perform private.cb_firm_file(p_file);   -- CB2-0 v7 item 5
  perform private.require(private.can_view('closebook'), 'You need Closebook access.');
  foreach s in array array['setup', 'opening', 'records', 'code', 'entries', 'compare', 'review', 't2', 'statements', 'lock'] loop
    select * into r from public.cb_step_signoffs where file_id = p_file and step = s;
    v := v || jsonb_build_object(s, jsonb_build_object(
      'prepared_by', r.prepared_by, 'prepared_at', r.prepared_at, 'reviewed_by', r.reviewed_by, 'reviewed_at', r.reviewed_at,
      'problems', to_jsonb(case when s = 'review' then private.cb_review_problems(p_file) when s = 't2' then private.cb_step8_problems(p_file)
        when s = 'statements' then private.cb_step9_problems(p_file) when s = 'lock' then private.cb_step10_problems(p_file) else private.cb_step_problems(p_file, s) end),
      'waiting', to_jsonb(case when s in ('review', 't2', 'statements', 'lock') then '{}'::text[] else private.cb_step_waiting_shown(p_file, s) end),
      'notes', (select count(*) from public.cb_review_notes n where n.file_id = p_file and n.step = s and n.status <> 'cleared')));
  end loop;
  return v || jsonb_build_object('checklist', to_jsonb(private.cb_checklist_problems(p_file)));
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_substep_status(p_file uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v jsonb := '{}'::jsonb; s text; r public.cb_substep_signoffs;
begin
  perform private.cb_firm_file(p_file);   -- CB2-0 v7 item 5
  perform private.require(private.can_view('closebook'), 'You need Closebook access.');
  foreach s in array array['3.1', '3.2', '3.3'] loop
    select * into r from public.cb_substep_signoffs where file_id = p_file and substep = s;
    v := v || jsonb_build_object(s, jsonb_build_object('prepared_by', r.prepared_by, 'prepared_at', r.prepared_at, 'reviewed_by', r.reviewed_by,
      'reviewed_at', r.reviewed_at, 'problems', to_jsonb(private.cb_banking_problems(p_file, s))));
  end loop;
  return v;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_excluded_key_of(p_file uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.cb_firm_file(p_file);   -- CB2-0 v7 item 5
  perform private.require(private.can_view('closebook'), 'You need Closebook.');
  return private.cb_excluded_key(p_file);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_entry_last_change(p_entry uuid)
 RETURNS TABLE(changed_by text, changed_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_e public.cb_entries;
begin
  perform private.cb_firm_file((select e.file_id from public.cb_entries e where e.id = p_entry));   -- CB2-0 v7 item 5
  perform private.require(private.can_view('closebook'), 'You need View on Closebook.');
  select * into v_e from public.cb_entries where id = p_entry;
  if v_e.id is null then return; end if;
  return query
    select coalesce(s.full_name, ''), h.at
      from public.cb_file_history h left join public.staff s on s.id = h.actor_id
     where h.file_id = v_e.file_id and h.action = 'entry_edited' and h.ref_label = private.cb_entry_label(v_e.id) and h.at >= v_e.created_at
     order by h.at desc, h.id desc
     limit 1;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_sh_due_list()
 RETURNS TABLE(file_id uuid, client_id uuid, client_name text, year_end date, shareholder smallint, accounts text, amount numeric, due_on date, next_file uuid, unpaid numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select g.file_id, f.client_id, c.legal_name, f.year_end, g.shareholder,
         (select string_agg(s.number || ' ' || s.name, ', ' order by s.number) from public.cb_sh_schedules s where s.file_id = g.file_id and s.account_key = any (g.accounts)),
         g.this_part, g.due_on, n.id, r.unpaid
    from public.cb_sh_groups g
    join public.cb_files f on f.id = g.file_id
    join public.clients c on c.id = f.client_id
    left join lateral (select x.id from public.cb_files x where x.client_id = f.client_id and x.year_start > f.year_end order by x.year_start limit 1) n on true
    left join public.cb_sh_repaid r on r.file_id = n.id and r.account_key = g.group_key and r.due_on = g.due_on
   where g.this_part > 0 and g.due_on is not null and private.can_view('closebook') and f.firm_id = private.my_firm()
     and (private.cb_can('review') or f.preparer_id = (select auth.uid()))
     and coalesce(r.unpaid, -1) <> 0
   order by g.due_on, c.legal_name, g.shareholder
$function$;

CREATE OR REPLACE FUNCTION public.cb_duplicate_lines(p_file uuid, p_rows jsonb)
 RETURNS TABLE(row_no integer, txn_date date, description text, amount numeric, account_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select (r ->> 'line')::int, (r ->> 'date')::date, r ->> 'description', (r ->> 'amount')::numeric, a.name
    from jsonb_array_elements(p_rows) r
    join public.cb_bank_lines l on l.file_id = p_file and l.txn_date = (r ->> 'date')::date
     and upper(btrim(l.description)) = upper(btrim(r ->> 'description')) and abs(l.amount) = abs((r ->> 'amount')::numeric)
    join public.cb_bank_accounts a on a.id = l.account_id
   where private.can_view('closebook') and l.firm_id = private.my_firm()
   order by 1;
$function$;

CREATE OR REPLACE FUNCTION public.cb_file_duplicates(p_file uuid)
 RETURNS TABLE(txn_date date, description text, amount numeric, times integer, accounts text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select l.txn_date, min(l.description), abs(l.amount), count(*)::int, string_agg(distinct a.name, ', ')
    from public.cb_bank_lines l join public.cb_bank_accounts a on a.id = l.account_id
   where l.file_id = p_file and private.can_view('closebook') and l.firm_id = private.my_firm()
   group by l.txn_date, upper(btrim(l.description)), abs(l.amount)
  having count(*) filter (where not l.dup_confirmed) > 1
   order by 1, 2;
$function$;
