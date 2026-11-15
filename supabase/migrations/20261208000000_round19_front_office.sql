-- Round 19 (Hashim, Nov 15, 2026): the front office. Benchmarks: TaxDome (one list for letters, with
-- filters) and QuickBooks Online (permissions ticked on the user role).
--   1. Letter permissions on each role: "Can prepare T1 letters" and "Can prepare corporate letters".
--   2. One list of letters for Engagements > Letters, the menu badge and My day, including letters sent or
--      signed outside Studio and recorded on an engagement.
--   3. Deadlines: each done line keeps its reason and source; "Mark done before a date" (owners) with a
--      same-day undo; the EFILE confirmation number in Closebook marks the T2 filing deadline done.
-- Safe to run twice.

-- ---------- 1. Letter permissions on the role
-- The first time only (Hashim's decision): every role with "Quotes and documents" today gets both boxes, so
-- nobody loses access on deploy. A second run never ticks a box an owner has since cleared. The Owner role
-- is locked and needs no box: owners always have every type.
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'roles' and column_name = 'can_t1_letters') then
    alter table public.roles add column can_t1_letters boolean not null default false,
                             add column can_corporate_letters boolean not null default false;
    update public.roles r set can_t1_letters = true, can_corporate_letters = true
     where not r.is_owner and exists (select 1 from public.role_permissions p where p.role_id = r.id and p.area_key = 'documents' and p.level in ('view', 'edit'));
  end if;
end $$;

-- May the signed-in person prepare and see letters of this type ('t1' or 'corporate')? Owners always.
create or replace function private.can_letter(p_type text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_owner() or coalesce((
    select case p_type when 't1' then r.can_t1_letters when 'corporate' then r.can_corporate_letters else false end
      from public.staff s join public.roles r on r.id = s.role_id
     where s.id = (select auth.uid()) and s.is_active), false)
$$;

-- The access the app reads: as before, plus the two letter permissions.
create or replace function public.my_access()
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when not private.is_active_staff() then null else jsonb_build_object(
    'staff_id', (select auth.uid()),
    'full_name', (select s.full_name from public.staff s where s.id = (select auth.uid())),
    'role_name', (select r.name from public.staff s join public.roles r on r.id = s.role_id where s.id = (select auth.uid())),
    'is_owner', private.is_owner(),
    'permissions', (select jsonb_object_agg(a.key, private.permission_level(a.key)) from public.permission_areas a),
    'letters', jsonb_build_object('t1', private.can_letter('t1'), 'corporate', private.can_letter('corporate'))
  ) end
$$;

-- Owners tick the boxes on a role. The Owner role always has both.
create or replace function public.set_role_letters(p_role_id uuid, p_t1 boolean, p_corporate boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_role public.roles;
begin
  perform private.require(private.is_owner(), 'Only an owner can change roles.');
  select * into v_role from public.roles where id = p_role_id;
  perform private.require(v_role.id is not null, 'That role was not found.');
  perform private.require(not v_role.is_owner, 'The Owner role always has every letter type.');
  if v_role.can_t1_letters is distinct from coalesce(p_t1, false) or v_role.can_corporate_letters is distinct from coalesce(p_corporate, false) then
    update public.roles set can_t1_letters = coalesce(p_t1, false), can_corporate_letters = coalesce(p_corporate, false) where id = p_role_id;
    insert into public.activity_log (actor_id, action, entity_type, entity_id, details)
    values ((select auth.uid()), 'role_letters_changed', 'roles', p_role_id,
            jsonb_build_object('role', v_role.name, 't1', coalesce(p_t1, false), 'corporate', coalesce(p_corporate, false),
                               'before', jsonb_build_object('t1', v_role.can_t1_letters, 'corporate', v_role.can_corporate_letters)));
  end if;
end;
$$;
revoke all on function public.set_role_letters(uuid, boolean, boolean) from public, anon;
grant execute on function public.set_role_letters(uuid, boolean, boolean) to authenticated, service_role;

-- A letter draft (Studio documents) only for the types the person may prepare. Proposals as before.
create or replace function private.documents_letter_permission() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 't1_letter' and not private.can_letter('t1') then
    raise exception 'Your role does not include T1 letters.';
  elsif new.kind = 'corporate_letter' and not private.can_letter('corporate') then
    raise exception 'Your role does not include corporate letters.';
  end if;
  return new;
end;
$$;
drop trigger if exists documents_letter_permission on public.documents;
create trigger documents_letter_permission before insert on public.documents for each row execute function private.documents_letter_permission();

-- ---------- 2. One list of letters
-- Every engagement letter, whatever the path: quotes and new letters sent from Studio, and letters sent or
-- signed outside Studio and recorded on an engagement ("Outside Studio": an engagement with no Studio letter
-- and a sent or signed date, or marked sent; one a Studio letter points to is not outside). Each person sees the types their role allows (T1, Corporate). Hashim, round 19: one word for offers, "quote";
-- proposals are not a letter type. A signed monthly quote is the client's corporate letter ("Came from: Monthly quote");
-- an unsigned one is a quote, listed in Quotes only.
drop function if exists public.letter_list();
create function public.letter_list()
returns table (id uuid, source text, kind text, letter_type text, status text, status_label text, client text, client_id uuid, letter text,
               came_from text, sent_at timestamptz, signed_at timestamptz, valid_until date, lead_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_t1 boolean := private.can_letter('t1');
  v_corp boolean := private.can_letter('corporate');
begin
  perform private.require(private.can_view('documents') or private.can_view('leads'), 'You do not have access to engagement letters.');
  return query
  with studio as (
    select q.id, 'studio'::text as source, q.kind,
           case q.kind when 't1' then 't1' when 'corporate' then 'corporate' when 'proposal' then 'corporate'
                else case when q.details ->> 'doc_kind' = 't1_letter' then 't1' else 'corporate' end end as letter_type,
           q.status, ''::text as status_label,
           coalesce(nullif(btrim(q.company_name), ''), c.legal_name, nullif(btrim(q.title), ''),
                    (select string_agg(s.first_name || ' ' || s.last_name, ' and ' order by s.person) from public.quote_signers s where s.quote_id = q.id), 'Untitled') as client,
           q.client_id,
           case q.kind
             when 't1' then 'Personal tax ' || q.tax_year
             when 'corporate' then 'Year-end ' || to_char(q.year_end, 'Mon FMDD, YYYY')
             when 'proposal' then coalesce('Monthly: ' || (q.proposal -> 'opts' -> q.chosen_option ->> 'name'), 'Monthly quote')
             else coalesce(nullif(q.details ->> 'label', ''), 'Engagement letter') end as letter,
           case q.kind
             when 'letter' then 'New letter'
             when 'proposal' then 'Monthly quote'
             else 'Quote (' || case when l.source ilike 'phone%' then 'phone' else 'website' end || ')' end as came_from,
           q.sent_at, q.signed_at, q.valid_until, q.lead_id
    from public.quotes q
    left join public.leads l on l.id = q.lead_id
    left join public.clients c on c.id = q.client_id
    where q.status <> 'draft' and coalesce(q.details ->> 'doc_kind', '') <> 'cb_mal' and (q.kind <> 'proposal' or (q.status = 'signed' and jsonb_typeof(q.proposal -> 'opts') = 'array'))
  ), outside as (
    select e.id, 'outside'::text, 'engagement'::text,
           case when e.type = 'T1 personal' then 't1' else 'corporate' end,
           case when e.el_signed is not null then 'signed' when e.status = 'EL sent' then 'sent' else 'other' end,
           e.status,
           coalesce(c.legal_name || coalesce(' and ' || c2.legal_name, ''), e.title),
           e.client_id, e.title, 'Recorded on the engagement'::text,
           (e.el_issued::timestamp at time zone 'America/Toronto'), (e.el_signed::timestamp at time zone 'America/Toronto'), null::date, null::uuid
    from public.engagements e
    left join public.clients c on c.id = e.client_id
    left join public.clients c2 on c2.id = e.client2_id
    where e.quote_id is null and (e.el_issued is not null or e.el_signed is not null or e.status = 'EL sent')
      -- A Studio letter sent for an existing engagement points to it until the client signs: not outside.
      and not exists (select 1 from public.quotes q2 where q2.status <> 'draft' and q2.details ->> 'engagement_id' = e.id::text)
  )
  select x.* from (select * from studio union all select * from outside) x
  where (x.letter_type = 't1' and v_t1) or (x.letter_type = 'corporate' and v_corp)
  order by coalesce(x.signed_at, x.sent_at) desc nulls last;
end;
$$;
revoke all on function public.letter_list() from public, anon;
grant execute on function public.letter_list() to authenticated;

-- The Engagements badge and My day: letters waiting for a signature, from the same list.
create or replace function public.letters_waiting_count()
returns int language sql stable security definer set search_path = '' as $$
  select case when private.can_view('documents') or private.can_view('leads') then
    (select count(*)::int from public.letter_list() l
      where l.status in ('sent', 'viewed') and (l.source = 'outside' or l.valid_until >= (now() at time zone 'America/Toronto')::date))
  else 0 end
$$;

-- ---------- 3. Deadlines
-- The deadline types. T2 today; GST/HST reminders are added as new rows.
create table if not exists public.deadline_kinds (
  key   text primary key check (key ~ '^[a-z0-9_]{2,40}$'),
  label text not null check (length(btrim(label)) between 2 and 60),
  sort  int not null default 0
);
alter table public.deadline_kinds enable row level security;
drop policy if exists "Staff read deadline kinds" on public.deadline_kinds;
create policy "Staff read deadline kinds" on public.deadline_kinds for select to authenticated using (true);
revoke insert, update, delete on public.deadline_kinds from anon, authenticated;
grant select on public.deadline_kinds to authenticated;
insert into public.deadline_kinds (key, label, sort) values ('balance', 'Balance due', 10), ('filing', 'T2 filing', 20) on conflict (key) do nothing;

alter table public.t2_deadline_done drop constraint if exists t2_deadline_done_kind_check;
do $$ begin
  alter table public.t2_deadline_done add constraint t2_deadline_done_kind_fkey foreign key (kind) references public.deadline_kinds (key);
exception when duplicate_object then null; end $$;
alter table public.t2_deadline_done add column if not exists reason text not null default '';
alter table public.t2_deadline_done add column if not exists source text not null default 'manual';
alter table public.t2_deadline_done add column if not exists batch_id uuid;
do $$ begin
  alter table public.t2_deadline_done add constraint t2_deadline_done_reason_len check (length(reason) <= 200);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.t2_deadline_done add constraint t2_deadline_done_source_ok check (source in ('manual', 'batch', 'efile'));
exception when duplicate_object then null; end $$;
create index if not exists t2_deadline_done_batch on public.t2_deadline_done (batch_id) where batch_id is not null;

-- Mark done before a date (owners): every deadline the app lists as due before the date, with one reason.
-- The app sends the list it shows in the dialog; each line keeps the batch, so the batch can be undone today.
create or replace function public.deadlines_mark_done_before(p_before date, p_reason text, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_batch uuid := gen_random_uuid();
  v_n int;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform private.require(private.is_owner(), 'Only an owner can mark deadlines done in one step.');
  perform private.require(p_before is not null, 'Choose the date.');
  perform private.require(length(v_reason) between 2 and 200, 'Give the reason (2 to 200 characters).');
  perform private.require(jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) between 1 and 2000, 'No deadlines are due before that date.');
  perform private.require(not exists (select 1 from jsonb_array_elements(p_items) i
     where not exists (select 1 from public.clients c where c.id = (i ->> 'client_id')::uuid)
        or not exists (select 1 from public.deadline_kinds k where k.key = i ->> 'kind')
        or (i ->> 'year_end')::date is null), 'A deadline in the list is not valid. Reload My day and try again.');
  insert into public.t2_deadline_done (client_id, year_end, kind, reason, source, batch_id)
  select distinct (i ->> 'client_id')::uuid, (i ->> 'year_end')::date, i ->> 'kind', v_reason, 'batch', v_batch
    from jsonb_array_elements(p_items) i
  on conflict (client_id, year_end, kind) do nothing;
  get diagnostics v_n = row_count;
  insert into public.activity_log (actor_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), 'deadlines_marked_done_before', 'deadlines', v_batch, jsonb_build_object('before', p_before, 'reason', v_reason, 'count', v_n));
  return jsonb_build_object('batch_id', v_batch, 'count', v_n);
end;
$$;
revoke all on function public.deadlines_mark_done_before(date, text, jsonb) from public, anon;
grant execute on function public.deadlines_mark_done_before(date, text, jsonb) to authenticated, service_role;

-- Undo a batch in one step, on the day it was made. After that day, lines are reopened one by one.
create or replace function public.deadlines_undo_batch(p_batch uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  perform private.require(private.is_owner(), 'Only an owner can undo a batch.');
  perform private.require(exists (select 1 from public.t2_deadline_done where batch_id = p_batch), 'That batch is already undone.');
  perform private.require(not exists (select 1 from public.t2_deadline_done where batch_id = p_batch
     and (done_at at time zone 'America/Toronto')::date <> (now() at time zone 'America/Toronto')::date),
     'A batch can be undone in one step only on the day it was made. Reopen the lines one by one.');
  delete from public.t2_deadline_done where batch_id = p_batch;
  get diagnostics v_n = row_count;
  insert into public.activity_log (actor_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), 'deadlines_batch_undone', 'deadlines', p_batch, jsonb_build_object('count', v_n));
  return v_n;
end;
$$;
revoke all on function public.deadlines_undo_batch(uuid) from public, anon;
grant execute on function public.deadlines_undo_batch(uuid) to authenticated, service_role;

-- The EFILE confirmation number recorded in Closebook marks the client's T2 filing deadline for that year
-- end done, with the reason. A deadline already done is left as it is; clearing the number reopens nothing.
create or replace function private.cb_efile_marks_t2_done() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(new.efile_number, '') <> '' and (tg_op = 'INSERT' or old.efile_number is distinct from new.efile_number) then
    insert into public.t2_deadline_done (client_id, year_end, kind, done_by, reason, source)
    select f.client_id, f.year_end, 'filing', (select auth.uid()), left('EFILE confirmation ' || new.efile_number || ' recorded in Closebook', 200), 'efile'
      from public.cb_files f where f.id = new.file_id
    on conflict (client_id, year_end, kind) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists cb_efile_marks_t2_done on public.cb_file_close;
create trigger cb_efile_marks_t2_done after insert or update of efile_number on public.cb_file_close for each row execute function private.cb_efile_marks_t2_done();

-- Files that already have an EFILE number.
insert into public.t2_deadline_done (client_id, year_end, kind, done_by, reason, source)
select f.client_id, f.year_end, 'filing', null, left('EFILE confirmation ' || x.efile_number || ' recorded in Closebook', 200), 'efile'
  from public.cb_file_close x join public.cb_files f on f.id = x.file_id
 where coalesce(x.efile_number, '') <> ''
on conflict (client_id, year_end, kind) do nothing;
