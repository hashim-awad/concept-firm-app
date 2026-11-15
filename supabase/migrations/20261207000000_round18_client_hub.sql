-- Round 18 (Hashim, Nov 15, 2026): the client page is the hub. Safe to run twice.
--  1. The basis of accounting and the users of the statements live on the client only. Each user has a kind
--     (lender, other), a name and the basis it needs. The two older fields letters read (third_party_user,
--     third_party_basis) are kept, filled from the first user, so letters keep working.
--  2. Closebook's acceptance record confirms them from the client each year and keeps a read-only record of
--     what was confirmed (basis, users, who and when). A locked file shows that record, never today's client.
--  3. The type from TaxDome tags: a mapping (PREC gives PREC). A type set by hand is never overwritten by an
--     import.
--  4. One-time move: users from each client's latest acceptance record where the client has none; clients
--     where the two disagree are listed for an owner to decide.

-- ---------- 1. The users of the statements, on the client
create or replace function private.statement_users_ok(p jsonb) returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 5 and not exists (
    select 1 from jsonb_array_elements(p) u
     where coalesce(u ->> 'kind', '') not in ('lender', 'other')
        or length(btrim(coalesce(u ->> 'name', ''))) not between 2 and 120
        or coalesce(u ->> 'basis_needed', '') not in ('', 'Can request further information', 'Agreed basis of accounting'));
$$;

alter table public.clients add column if not exists statement_users jsonb not null default '[]';
do $$ begin
  alter table public.clients add constraint clients_statement_users_ok check (private.statement_users_ok(statement_users));
exception when duplicate_object then null; end $$;
alter table public.clients add column if not exists entity_type_by_hand boolean not null default false;

-- The older single third-party fields: the first user, kept for the letters. A letter that still writes
-- third_party_user adds that user to the list if it is not there.
create or replace function private.clients_statement_users() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.statement_users = '[]'::jsonb and btrim(coalesce(new.third_party_user, '')) <> '' then
      new.statement_users := jsonb_build_array(jsonb_build_object('kind', 'other', 'name', btrim(new.third_party_user), 'basis_needed', coalesce(new.third_party_basis, '')));
    end if;
  elsif new.statement_users is not distinct from old.statement_users and new.third_party_user is distinct from old.third_party_user
        and btrim(coalesce(new.third_party_user, '')) <> ''
        and not exists (select 1 from jsonb_array_elements(new.statement_users) u where lower(btrim(u ->> 'name')) = lower(btrim(new.third_party_user))) then
    new.statement_users := new.statement_users || jsonb_build_array(jsonb_build_object('kind', 'other', 'name', btrim(new.third_party_user), 'basis_needed', coalesce(new.third_party_basis, '')));
  end if;
  new.third_party_user := coalesce(new.statement_users -> 0 ->> 'name', '');
  new.third_party_basis := coalesce(new.statement_users -> 0 ->> 'basis_needed', '');
  return new;
end;
$$;
drop trigger if exists clients_statement_users on public.clients;
create trigger clients_statement_users before insert or update on public.clients for each row execute function private.clients_statement_users();

-- ---------- 3. The type from TaxDome tags
create table if not exists public.taxdome_type_tags (
  tag         text primary key check (length(btrim(tag)) between 1 and 60),
  entity_type text not null check (entity_type in ('PREC', 'Holdco', 'Operating co', 'Professional corp')),
  updated_by  uuid references public.staff (id),
  updated_at  timestamptz not null default now()
);
alter table public.taxdome_type_tags enable row level security;
drop policy if exists "Staff read the TaxDome type tags" on public.taxdome_type_tags;
create policy "Staff read the TaxDome type tags" on public.taxdome_type_tags for select to authenticated using (true);
revoke insert, update, delete on public.taxdome_type_tags from anon, authenticated;
grant select on public.taxdome_type_tags to authenticated;
insert into public.taxdome_type_tags (tag, entity_type) values ('PREC', 'PREC') on conflict (tag) do nothing;

-- The type a set of tags gives: the first mapped type in this order, else Other.
create or replace function private.taxdome_type_for(p_tags text[]) returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select m.entity_type from public.taxdome_type_tags m
                    where upper(btrim(m.tag)) in (select upper(btrim(t)) from unnest(coalesce(p_tags, '{}')) t)
                    order by array_position(array['PREC', 'Holdco', 'Operating co', 'Professional corp'], m.entity_type) limit 1), 'Other');
$$;

-- An import sets the type from the tags unless a person set it by hand; a person setting it marks it.
create or replace function private.clients_entity_type() returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('app.taxdome_import', true), '') = 'on' then
    if new.kind = 'corporation' and not new.entity_type_by_hand and (tg_op = 'INSERT' or new.taxdome_tags is distinct from old.taxdome_tags or current_setting('app.taxdome_retype', true) = 'on') then
      new.entity_type := private.taxdome_type_for(new.taxdome_tags);
    end if;
  elsif tg_op = 'UPDATE' and new.entity_type is distinct from old.entity_type then
    new.entity_type_by_hand := true;
  elsif tg_op = 'INSERT' and new.entity_type <> 'Other' then
    new.entity_type_by_hand := true;
  end if;
  return new;
end;
$$;
drop trigger if exists clients_entity_type on public.clients;
create trigger clients_entity_type before insert or update on public.clients for each row execute function private.clients_entity_type();

-- Owners edit the mapping in Connections. Clients not typed by hand take the new mapping at once.
create or replace function public.set_taxdome_type_tags(p jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  perform private.require(private.is_owner(), 'Only an owner changes the TaxDome tag mapping.');
  perform private.require(jsonb_typeof(p) = 'array', 'The mapping could not be read.');
  for r in select * from jsonb_array_elements(p) loop
    perform private.require(length(btrim(coalesce(r ->> 'tag', ''))) between 1 and 60, 'A tag is 1 to 60 characters.');
    perform private.require(r ->> 'entity_type' in ('PREC', 'Holdco', 'Operating co', 'Professional corp'), 'Pick a type for each tag.');
  end loop;
  delete from public.taxdome_type_tags where true;
  insert into public.taxdome_type_tags (tag, entity_type, updated_by)
  select distinct on (upper(btrim(r ->> 'tag'))) btrim(r ->> 'tag'), r ->> 'entity_type', (select auth.uid()) from jsonb_array_elements(p) r;
  perform set_config('app.taxdome_import', 'on', true);
  perform set_config('app.taxdome_retype', 'on', true);
  update public.clients set entity_type = entity_type where kind = 'corporation' and taxdome_account_id is not null and not entity_type_by_hand;
  perform set_config('app.taxdome_retype', '', true);
  perform set_config('app.taxdome_import', '', true);
  insert into public.activity_log (actor_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), 'update', 'taxdome_type_tags', 'mapping', jsonb_build_object('new', p));
end;
$$;
revoke all on function public.set_taxdome_type_tags(jsonb) from public, anon;
grant execute on function public.set_taxdome_type_tags(jsonb) to authenticated, service_role;

-- ---------- 2. The acceptance record confirms the client's basis and users, and keeps what it confirmed
alter table public.cb_acceptance add column if not exists confirmed jsonb;

-- What the client says now, in the form the acceptance record keeps.
create or replace function private.client_statements(p_client uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('basis', c.basis, 'custom_basis_wording', c.custom_basis_wording,
    'users', coalesce((select jsonb_agg(jsonb_build_object('kind', u ->> 'kind', 'name', btrim(u ->> 'name'), 'basis_needed', coalesce(u ->> 'basis_needed', ''))) from jsonb_array_elements(c.statement_users) u), '[]'))
  from public.clients c where c.id = p_client;
$$;

-- The preparer confirms the client's basis and users for this year. The file keeps a read-only record of
-- them, with who and when; each user's answer to question 7 carries over by name (from this file, else last
-- year's). The client's activity says it was confirmed.
create or replace function public.cb_acceptance_confirm_client(p_file uuid) returns void language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files; a public.cb_acceptance; v_prior public.cb_acceptance; v_now jsonb; v_users jsonb := '[]'; u jsonb; v_agreed text;
        v_ans jsonb; v_same boolean; v_changed boolean;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  select * into a from public.cb_acceptance where file_id = p_file;
  select * into v_prior from public.cb_acceptance where file_id = private.cb_prior_file(p_file);
  v_now := private.client_statements(v_file.client_id);
  for u in select * from jsonb_array_elements(v_now -> 'users') loop
    select x ->> 'agreed' into v_agreed from jsonb_array_elements(coalesce(a.users, '[]')) x where x ->> 'kind' = u ->> 'kind' and lower(x ->> 'name') = lower(u ->> 'name') limit 1;
    if v_agreed is null then
      select x ->> 'agreed' into v_agreed from jsonb_array_elements(coalesce(v_prior.users, '[]')) x where x ->> 'kind' = u ->> 'kind' and lower(x ->> 'name') = lower(u ->> 'name') limit 1;
    end if;
    v_users := v_users || jsonb_build_array(u || jsonb_build_object('agreed', coalesce(v_agreed, '')));
  end loop;
  v_same := v_prior.confirmed is not null and (v_prior.confirmed - 'by' - 'at') = v_now;
  v_ans := coalesce(a.answered, '{}'::jsonb) || jsonb_build_object(
    'q6', jsonb_build_object('by', (select auth.uid()), 'at', now(), 'same', v_same),
    'q8', jsonb_build_object('by', (select auth.uid()), 'at', now(), 'same', v_same));
  v_changed := a.file_id is null or a.confirmed is null or (a.confirmed - 'by' - 'at') is distinct from v_now or a.users is distinct from v_users;
  insert into public.cb_acceptance as t (file_id, users, q8, confirmed, answered, updated_by, updated_at)
  values (p_file, v_users, 'confirmed', v_now || jsonb_build_object('by', (select auth.uid()), 'at', now()), v_ans, (select auth.uid()), now())
  on conflict (file_id) do update set users = excluded.users, q8 = 'confirmed', q8_note = '', confirmed = excluded.confirmed,
    answered = excluded.answered, updated_by = excluded.updated_by, updated_at = now();
  perform private.cb_log(p_file, 'acceptance_client_confirmed', 'setup', 'The client''s basis and users of the statements confirmed');
  insert into public.activity_log (actor_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), 'statements_confirmed', 'clients', v_file.client_id::text,
          jsonb_build_object('file_id', p_file, 'year', extract(year from v_file.year_end)::int, 'confirmed', v_now));
  if v_changed then perform private.cb_clear_step(p_file, 'setup', 'The client''s basis or users of the statements changed'); end if;
end;
$$;
revoke all on function public.cb_acceptance_confirm_client(uuid) from public, anon;
grant execute on function public.cb_acceptance_confirm_client(uuid) to authenticated, service_role;

-- Saving the record no longer takes the users or the basis from the form: they come from the client, by
-- confirming. The form sends each user's answer to question 7, matched by kind and name.
create or replace function public.cb_save_acceptance(p_file uuid, p jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files; a public.cb_acceptance; v_prior public.cb_acceptance; v_ans jsonb; k text; u jsonb; v_changed boolean; v_users jsonb := '[]'; v_agreed text;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(jsonb_typeof(coalesce(p -> 'users', '[]')) = 'array', 'The answers could not be read.');
  for u in select * from jsonb_array_elements(coalesce(p -> 'users', '[]')) loop
    perform private.require(coalesce(u ->> 'agreed', '') in ('', 'yes', 'no'), 'Answer Yes or No.');
  end loop;
  select * into a from public.cb_acceptance where file_id = p_file;
  select * into v_prior from public.cb_acceptance where file_id = private.cb_prior_file(p_file);
  for u in select * from jsonb_array_elements(coalesce(a.users, '[]')) loop
    select x ->> 'agreed' into v_agreed from jsonb_array_elements(coalesce(p -> 'users', '[]')) x where x ->> 'kind' = u ->> 'kind' and lower(btrim(x ->> 'name')) = lower(u ->> 'name') limit 1;
    v_users := v_users || jsonb_build_array(u || jsonb_build_object('agreed', coalesce(v_agreed, u ->> 'agreed', '')));
  end loop;
  v_ans := coalesce(a.answered, '{}'::jsonb);
  foreach k in array array['q1', 'q2', 'q3', 'q4', 'q5', 'q9'] loop
    if nullif(p ->> k, '') is not null and (p ->> k) is distinct from (to_jsonb(a) ->> k) then
      v_ans := v_ans || jsonb_build_object(k, jsonb_build_object('by', (select auth.uid()), 'at', now(), 'same', (p ->> k) = (to_jsonb(v_prior) ->> k)));
    end if;
  end loop;
  insert into public.cb_acceptance as t (file_id, q1, q2, q3, q4, q5, q5_note, users, q9, answered, updated_by, updated_at)
  values (p_file, nullif(p ->> 'q1', ''), nullif(p ->> 'q2', ''), nullif(p ->> 'q3', ''), nullif(p ->> 'q4', ''), nullif(p ->> 'q5', ''),
          left(btrim(coalesce(p ->> 'q5_note', '')), 1000), v_users, nullif(p ->> 'q9', ''), v_ans, (select auth.uid()), now())
  on conflict (file_id) do update set q1 = excluded.q1, q2 = excluded.q2, q3 = excluded.q3, q4 = excluded.q4, q5 = excluded.q5, q5_note = excluded.q5_note,
    users = excluded.users, q9 = excluded.q9, answered = excluded.answered, updated_by = excluded.updated_by, updated_at = now();
  v_changed := a.file_id is null or row(a.q1, a.q2, a.q3, a.q4, a.q5, a.q5_note, a.users, a.q9)
    is distinct from (select row(t.q1, t.q2, t.q3, t.q4, t.q5, t.q5_note, t.users, t.q9) from public.cb_acceptance t where t.file_id = p_file);
  if v_changed then
    perform private.cb_log(p_file, 'acceptance_saved', 'setup', 'Acceptance and continuance saved');
    perform private.cb_clear_step(p_file, 'setup', 'The acceptance record changed');
  end if;
end;
$$;
revoke all on function public.cb_save_acceptance(uuid, jsonb) from public, anon;
grant execute on function public.cb_save_acceptance(uuid, jsonb) to authenticated, service_role;

-- "Same as last year for all": last year's answers, and the client's basis and users confirmed for this year.
create or replace function public.cb_acceptance_same_as_last(p_file uuid) returns void language plpgsql security definer set search_path = '' as $$
declare v_prior public.cb_acceptance; v_ans jsonb := '{}'::jsonb; k text;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  perform private.require((select phase from public.cb_files where id = p_file) <> 'locked', 'This file is locked.');
  select * into v_prior from public.cb_acceptance where file_id = private.cb_prior_file(p_file);
  perform private.require(v_prior.file_id is not null, 'There is no earlier file with an acceptance record.');
  perform public.cb_save_acceptance(p_file, jsonb_build_object('q1', v_prior.q1, 'q2', v_prior.q2, 'q3', v_prior.q3, 'q4', v_prior.q4, 'q5', v_prior.q5,
    'q5_note', v_prior.q5_note, 'q9', v_prior.q9));
  perform public.cb_acceptance_confirm_client(p_file);
  foreach k in array array['q1', 'q2', 'q3', 'q4', 'q5', 'q9'] loop
    v_ans := v_ans || jsonb_build_object(k, jsonb_build_object('by', (select auth.uid()), 'at', now(), 'same', true));
  end loop;
  update public.cb_acceptance set answered = answered || v_ans where file_id = p_file;
  perform private.cb_log(p_file, 'acceptance_confirmed', 'setup', 'Every acceptance answer confirmed as last year''s');
end;
$$;
revoke all on function public.cb_acceptance_same_as_last(uuid) from public, anon;
grant execute on function public.cb_acceptance_same_as_last(uuid) to authenticated, service_role;

create or replace function private.cb_acceptance_problems(p_file uuid) returns text[] language plpgsql stable security definer set search_path = '' as $$
declare a public.cb_acceptance; v_file public.cb_files; v_out text[] := '{}'; v_n int := 0; u jsonb;
begin
  select * into a from public.cb_acceptance where file_id = p_file;
  select * into v_file from public.cb_files where id = p_file;
  if a.file_id is null then return array['Answer the acceptance questions.']; end if;
  v_n := (a.q1 is null)::int + (a.q2 is null)::int + (a.q3 is null)::int + (a.q4 is null)::int + (a.q5 is null)::int + (a.q9 is null)::int;
  for u in select * from jsonb_array_elements(a.users) loop
    if coalesce(u ->> 'agreed', '') = '' then v_n := v_n + 1; end if;
  end loop;
  if v_n > 0 then v_out := v_out || format('%s acceptance question%s to answer.', v_n, case when v_n = 1 then '' else 's' end); end if;
  -- Round 18: the basis and users come from the client, confirmed for this year.
  if a.confirmed is null then
    v_out := v_out || 'Confirm the client''s basis of accounting and users of the statements (questions 6 and 8).'::text;
  elsif v_file.phase <> 'locked' and (a.confirmed - 'by' - 'at') is distinct from private.client_statements(v_file.client_id) then
    v_out := v_out || 'The client''s basis or users of the statements changed since they were confirmed: confirm them again.'::text;
  end if;
  if a.q1 = 'no' then v_out := v_out || 'Acceptance question 1 must be Yes: the engagement letter on file must cover this year-end.'::text; end if;
  if a.q2 = 'no' then v_out := v_out || 'Acceptance question 2 is No: a new or amended engagement letter is needed before work continues.'::text; end if;
  if a.q3 = 'no' then v_out := v_out || 'Acceptance question 3 must be Yes.'::text; end if;
  if a.q4 = 'no' then v_out := v_out || 'Acceptance question 4 must be Yes.'::text; end if;
  if a.q5 = 'no' and btrim(a.q5_note) = '' then v_out := v_out || 'Acceptance question 5: say what affects independence.'::text; end if;
  for u in select * from jsonb_array_elements(a.users) loop
    if u ->> 'agreed' = 'no' then v_out := v_out || format('Acceptance question 7 must be Yes for %s.', u ->> 'name'); end if;
  end loop;
  if a.q9 = 'no' then v_out := v_out || 'Acceptance question 9 must be Yes: a basis a user cannot accept cannot be used.'::text; end if;
  return v_out;
end;
$$;

-- ---------- 4. One-time move
-- Clients whose users differ from their latest acceptance record, for an owner to decide.
create table if not exists public.client_user_conflicts (
  client_id   uuid primary key references public.clients (id) on delete cascade,
  file_id     uuid references public.cb_files (id) on delete set null,
  client_users jsonb not null,
  file_users  jsonb not null,
  created_at  timestamptz not null default now()
);
alter table public.client_user_conflicts enable row level security;
drop policy if exists "Owners read user conflicts" on public.client_user_conflicts;
create policy "Owners read user conflicts" on public.client_user_conflicts for select to authenticated using (private.is_owner());
revoke insert, update, delete on public.client_user_conflicts from anon, authenticated;
grant select on public.client_user_conflicts to authenticated;

-- Deciding: saving the client's users clears its conflict.
create or replace function private.clients_conflict_resolved() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.statement_users is distinct from old.statement_users then delete from public.client_user_conflicts where client_id = new.id; end if;
  return null;
end;
$$;
drop trigger if exists clients_conflict_resolved on public.clients;
create trigger clients_conflict_resolved after update on public.clients for each row execute function private.clients_conflict_resolved();

do $$
declare r record; v_file_users jsonb; v_names_c text[]; v_names_f text[];
begin
  perform set_config('app.taxdome_import', 'on', true);
  for r in
    select distinct on (f.client_id) f.client_id, f.id file_id, a.users, c.statement_users
      from public.cb_files f join public.cb_acceptance a on a.file_id = f.id join public.clients c on c.id = f.client_id
     where jsonb_array_length(coalesce(a.users, '[]')) > 0
     order by f.client_id, f.year_end desc
  loop
    select coalesce(jsonb_agg(jsonb_build_object('kind', u ->> 'kind', 'name', btrim(u ->> 'name'), 'basis_needed', '')), '[]') into v_file_users from jsonb_array_elements(r.users) u;
    if r.statement_users = '[]'::jsonb then
      update public.clients set statement_users = v_file_users where id = r.client_id;
    else
      select array_agg(lower(btrim(u ->> 'name')) order by lower(btrim(u ->> 'name'))) into v_names_c from jsonb_array_elements(r.statement_users) u;
      select array_agg(lower(btrim(u ->> 'name')) order by lower(btrim(u ->> 'name'))) into v_names_f from jsonb_array_elements(v_file_users) u;
      if v_names_c is distinct from v_names_f then
        insert into public.client_user_conflicts (client_id, file_id, client_users, file_users) values (r.client_id, r.file_id, r.statement_users, v_file_users)
        on conflict (client_id) do nothing;
      end if;
    end if;
  end loop;
  -- Before round 18 the import always gave "Other": a TaxDome company with another type was typed by hand.
  update public.clients set entity_type_by_hand = true where kind = 'corporation' and taxdome_account_id is not null and entity_type <> 'Other' and not entity_type_by_hand;
  -- Companies from TaxDome still on "Other" take the type their tags give.
  update public.clients set entity_type = private.taxdome_type_for(taxdome_tags)
   where kind = 'corporation' and taxdome_account_id is not null and entity_type = 'Other' and not entity_type_by_hand and private.taxdome_type_for(taxdome_tags) <> 'Other';
  perform set_config('app.taxdome_import', '', true);
end $$;

-- Acceptance records answered before round 18 keep a record of what they confirmed: their users, and the
-- client's basis at the time of this move.
update public.cb_acceptance a set confirmed = jsonb_build_object(
    'basis', c.basis, 'custom_basis_wording', c.custom_basis_wording,
    'users', coalesce((select jsonb_agg(jsonb_build_object('kind', u ->> 'kind', 'name', btrim(u ->> 'name'), 'basis_needed', '')) from jsonb_array_elements(a.users) u), '[]'),
    'by', coalesce(a.answered -> 'q8' ->> 'by', a.updated_by::text), 'at', coalesce(a.answered -> 'q8' ->> 'at', a.updated_at::text))
  from public.cb_files f join public.clients c on c.id = f.client_id
 where f.id = a.file_id and a.confirmed is null and a.q8 is not null;
