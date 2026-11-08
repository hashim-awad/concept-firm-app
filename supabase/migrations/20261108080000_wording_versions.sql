-- Editable wording (decision 30). The app's letters, proposals and terms use the wording of the
-- current approved version. EL v3.31 is the original (Studio's), held in the app's code; each
-- later version stores only the pieces that differ from it.
--
-- Rules the database enforces:
-- - Drafts are prepared by staff with Edit on "Engagement terms". Only an owner approves.
-- - Approving makes the version current for new letters. Letters already made keep theirs.
-- - Approved versions never change. A wrong version is fixed by a new one, or an owner makes
--   an earlier version current again (with a reason). Everything is in the activity log.

create table public.wording_versions (
  id           uuid primary key default gen_random_uuid(),
  label        text not null unique check (label ~ '^EL v[0-9]+\.[0-9]+$'),
  status       text not null default 'draft' check (status in ('draft', 'approved')),
  is_current   boolean not null default false,
  based_on     uuid references public.wording_versions (id),
  notes        text not null default '',
  approved_by  uuid references public.staff (id),
  approved_at  timestamptz,
  current_reason text not null default '',
  created_at   timestamptz not null default now(),
  created_by   uuid references public.staff (id),
  updated_at   timestamptz not null default now(),
  check (not is_current or status = 'approved')
);
create unique index wording_versions_one_current on public.wording_versions (is_current) where is_current;
create unique index wording_versions_one_draft on public.wording_versions (status) where status = 'draft';

create table public.wording_texts (
  id          uuid primary key default gen_random_uuid(),
  version_id  uuid not null references public.wording_versions (id) on delete cascade,
  key         text not null check (key ~ '^w[0-9a-f]{10}$'),
  text        text not null check (length(btrim(text)) > 0 and length(text) <= 5000),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.staff (id),
  unique (version_id, key)
);

-- The original, approved at Studio's release.
insert into public.wording_versions (label, status, is_current, notes, approved_at)
values ('EL v3.31', 'approved', true, 'Original wording from Concept Studio, approved 2026-10-29.', '2026-10-29 00:00:00-04');

alter table public.wording_versions enable row level security;
alter table public.wording_texts enable row level security;

create trigger wording_versions_created_by before insert on public.wording_versions for each row execute function private.set_created_by();
create trigger wording_versions_touch before update on public.wording_versions for each row execute function private.touch_updated_at();
create trigger wording_versions_log after insert or update or delete on public.wording_versions for each row execute function private.log_change();
create trigger wording_texts_log after insert or update or delete on public.wording_texts for each row execute function private.log_change();

-- Only drafts can change; approval and "make current" go through the owner functions below.
create or replace function private.guard_wording_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'An approved wording version is kept as a record.' using errcode = '42501'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.is_current then raise exception 'A new wording version starts as a draft.' using errcode = '42501'; end if;
    return new;
  end if;
  if current_setting('app.wording_owner_action', true) = 'on' and not private.is_owner() then
    raise exception 'Only an owner approves wording or makes a version current.' using errcode = '42501';
  end if;
  if current_setting('app.wording_owner_action', true) is distinct from 'on' then
    if old.status <> 'draft' then raise exception 'An approved wording version cannot be changed.' using errcode = '42501'; end if;
    if new.status <> old.status or new.is_current <> old.is_current or new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at then
      raise exception 'Only an owner approves wording or makes a version current.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger wording_versions_guard before insert or update or delete on public.wording_versions
  for each row execute function private.guard_wording_version();

create or replace function private.guard_wording_text()
returns trigger language plpgsql set search_path = '' as $$
declare v_status text;
begin
  select status into v_status from public.wording_versions where id = coalesce(new.version_id, old.version_id);
  if v_status is distinct from 'draft' and current_setting('app.wording_owner_action', true) is distinct from 'on' then
    raise exception 'Wording of an approved version cannot be changed. Start a new version.' using errcode = '42501';
  end if;
  if tg_op <> 'DELETE' then new.updated_at := now(); new.updated_by := (select auth.uid()); return new; end if;
  return old;
end;
$$;
create trigger wording_texts_guard before insert or update or delete on public.wording_texts
  for each row execute function private.guard_wording_text();

-- Start a draft from the current version (copies its edits). Engagement-terms editors.
create or replace function public.start_wording_draft(p_label text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_cur uuid; v_new uuid;
begin
  perform private.require(private.can_edit('engagement_terms'), 'You do not have permission to edit wording.');
  perform private.require(not exists (select 1 from public.wording_versions where status = 'draft'), 'A draft already exists. Finish or delete it first.');
  perform private.require(p_label ~ '^EL v[0-9]+\.[0-9]+$', 'The version name must look like EL v3.32.');
  perform private.require(not exists (select 1 from public.wording_versions where label = p_label), 'That version name is already used.');
  select id into v_cur from public.wording_versions where is_current;
  insert into public.wording_versions (label, based_on) values (p_label, v_cur) returning id into v_new;
  insert into public.wording_texts (version_id, key, text) select v_new, key, text from public.wording_texts where version_id = v_cur;
  return v_new;
end;
$$;

-- Owner: approve the draft; it becomes current for new letters.
create or replace function public.approve_wording(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.is_owner(), 'Only an owner can approve wording.');
  perform private.require(exists (select 1 from public.wording_versions where id = p_id and status = 'draft'), 'Only a draft can be approved.');
  perform set_config('app.wording_owner_action', 'on', true);
  update public.wording_versions set is_current = false where is_current;
  update public.wording_versions set status = 'approved', is_current = true, approved_by = (select auth.uid()), approved_at = now(), current_reason = 'Approved' where id = p_id;
  perform set_config('app.wording_owner_action', 'off', true);
end;
$$;

-- Owner: make an earlier approved version current again, with a reason.
create or replace function public.make_wording_current(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.is_owner(), 'Only an owner can change the current wording.');
  perform private.require(length(btrim(coalesce(p_reason, ''))) >= 5, 'Give the reason.');
  perform private.require(exists (select 1 from public.wording_versions where id = p_id and status = 'approved'), 'Only an approved version can be made current.');
  perform set_config('app.wording_owner_action', 'on', true);
  update public.wording_versions set is_current = false where is_current;
  update public.wording_versions set is_current = true, current_reason = btrim(p_reason) where id = p_id;
  perform set_config('app.wording_owner_action', 'off', true);
end;
$$;

-- The current wording, for every staff member who makes letters.
create or replace function public.current_wording()
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when private.is_active_staff() then (
    select jsonb_build_object('id', v.id, 'label', v.label, 'approved_at', v.approved_at,
      'texts', coalesce((select jsonb_object_agg(t.key, t.text) from public.wording_texts t where t.version_id = v.id), '{}'::jsonb))
    from public.wording_versions v where v.is_current
  ) end
$$;

revoke all on function public.start_wording_draft(text), public.approve_wording(uuid), public.make_wording_current(uuid, text), public.current_wording() from public, anon;
grant execute on function public.start_wording_draft(text), public.approve_wording(uuid), public.make_wording_current(uuid, text), public.current_wording() to authenticated;

create policy "Wording readers read versions" on public.wording_versions for select to authenticated
  using ((select private.can_view('engagement_terms')) or ((select private.can_view('documents')) and status = 'approved'));
create policy "Wording editors change drafts" on public.wording_versions for update to authenticated
  using ((select private.can_edit('engagement_terms'))) with check ((select private.can_edit('engagement_terms')));
create policy "Wording editors delete drafts" on public.wording_versions for delete to authenticated
  using ((select private.can_edit('engagement_terms')));
create policy "Wording readers read texts" on public.wording_texts for select to authenticated
  using ((select private.can_view('engagement_terms')) or (select private.can_view('documents')));
create policy "Wording editors add texts" on public.wording_texts for insert to authenticated with check ((select private.can_edit('engagement_terms')));
create policy "Wording editors change texts" on public.wording_texts for update to authenticated
  using ((select private.can_edit('engagement_terms'))) with check ((select private.can_edit('engagement_terms')));
create policy "Wording editors remove texts" on public.wording_texts for delete to authenticated using ((select private.can_edit('engagement_terms')));
grant select, update, delete on public.wording_versions to authenticated;
grant select, insert, update, delete on public.wording_texts to authenticated;
