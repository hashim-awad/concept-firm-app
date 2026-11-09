-- Staff, roles, permissions, settings and the activity log.
--
-- How access works (plain words):
-- - Every staff member has one role. A role has a level for each area: none, view or edit.
-- - The Owner role always has edit on every area. It is locked: nobody can change it.
-- - Only an owner can create or change roles, and only an owner can give or take away the
--   Owner role. The database refuses any change that would leave no active owner.
-- - A non-owner with "Staff accounts: edit" can add staff and change roles, but only to roles
--   that do not go beyond their own access, and never their own role.
-- - The app reads these tables directly (read-only). Every change goes through the functions
--   at the bottom of this file, which check permissions. Every change is written to the
--   activity log by the database itself.
-- - No person's name is in this file. The first owner is set once with
--   private.bootstrap_owner(email, full name), run by Hashim in the Supabase SQL editor.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.permission_areas (
  key         text primary key,
  label       text not null,
  description text not null,
  sort_order  int  not null
);

insert into public.permission_areas (key, label, description, sort_order) values
  ('leads',            'Leads',                'Leads from the public forms, their status and assignment.', 10),
  ('clients',          'Clients',              'Client records and links between clients.',                 20),
  ('documents',        'Quotes and documents', 'Build, send and withdraw quotes and other documents.',      30),
  ('vault',            'Document vault',       'Search, open and download stored documents.',               40),
  ('price_book',       'Price book and rules', 'Service catalogue, prices, screening questions and rules.', 50),
  ('tax_rates',        'Tax rates',            'Sales tax rates by province.',                              60),
  ('engagement_terms', 'Engagement terms',     'Engagement terms text used on quotes.',                     70),
  ('custom_line',      'Custom line',          'Add a custom priced line to a quote (safety net only).',    80),
  ('staff_accounts',   'Staff accounts',       'Add staff, change their role, switch accounts off.',        90),
  ('exports',          'Exports',              'Download the full data export.',                            100),
  ('settings',         'Settings',             'Lead assignment, lead sources, retention period.',          110);

create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (length(btrim(name)) between 1 and 60),
  description text not null default '',
  is_owner    boolean not null default false,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now()
);
-- Only one Owner role can exist.
create unique index roles_single_owner_role on public.roles (is_owner) where is_owner;

create table public.role_permissions (
  role_id  uuid not null references public.roles (id) on delete cascade,
  area_key text not null references public.permission_areas (key),
  level    text not null default 'none' check (level in ('none', 'view', 'edit')),
  primary key (role_id, area_key)
);

create table public.staff (
  id          uuid primary key references auth.users (id) on delete restrict,
  full_name   text not null check (length(btrim(full_name)) between 1 and 120),
  email       text not null,
  role_id     uuid not null references public.roles (id),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.staff (id),
  updated_at  timestamptz not null default now()
);
create unique index staff_email_unique on public.staff (lower(email));
create index staff_role_idx on public.staff (role_id);

alter table public.roles add constraint roles_created_by_fkey
  foreign key (created_by) references public.staff (id);

create table public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff (id)
);

insert into public.settings (key, value) values
  ('lead_assignment', '{"mode": "unassigned", "staff_ids": [], "next_index": 0}'),
  ('retention_months', '24');

-- Append-only record of who did what. Holds no client details.
create table public.activity_log (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id    uuid,          -- staff id; null means the system or the Supabase dashboard
  action      text not null, -- insert, update, delete, or a named action
  entity_type text not null, -- table or area name
  entity_id   text,
  details     jsonb not null default '{}'
);
create index activity_log_occurred_idx on public.activity_log (occurred_at desc);

-- ---------------------------------------------------------------------------
-- Seed: Owner role (locked) and a starting Staff role owners can change
-- ---------------------------------------------------------------------------

insert into public.roles (name, description, is_owner)
values ('Owner', 'Full access to everything. Locked.', true);

insert into public.role_permissions (role_id, area_key, level)
select r.id, a.key, 'edit'
from public.roles r cross join public.permission_areas a
where r.is_owner;

insert into public.roles (name, description)
values ('Staff', 'Starting role for accountants. Owners can change it.');

insert into public.role_permissions (role_id, area_key, level)
select r.id, a.key,
  case a.key
    when 'leads' then 'edit'
    when 'clients' then 'edit'
    when 'documents' then 'edit'
    when 'vault' then 'view'
    when 'price_book' then 'view'
    when 'tax_rates' then 'view'
    when 'engagement_terms' then 'view'
    else 'none'
  end
from public.roles r cross join public.permission_areas a
where r.name = 'Staff';

-- ---------------------------------------------------------------------------
-- Permission helpers (private schema, not reachable through the Data API)
-- ---------------------------------------------------------------------------

create or replace function private.level_rank(p_level text)
returns int language sql immutable set search_path = '' as $$
  select case p_level when 'edit' then 2 when 'view' then 1 else 0 end
$$;

create or replace function private.is_active_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff s
    where s.id = (select auth.uid()) and s.is_active
  )
$$;

create or replace function private.is_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff s join public.roles r on r.id = s.role_id
    where s.id = (select auth.uid()) and s.is_active and r.is_owner
  )
$$;

create or replace function private.permission_level(p_area text)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when private.is_owner() then 'edit'
    else coalesce((
      select rp.level
      from public.staff s
      join public.role_permissions rp on rp.role_id = s.role_id
      where s.id = (select auth.uid()) and s.is_active and rp.area_key = p_area
    ), 'none')
  end
$$;

create or replace function private.can_view(p_area text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.permission_level(p_area) in ('view', 'edit')
$$;

create or replace function private.can_edit(p_area text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.permission_level(p_area) = 'edit'
$$;

-- True when every area of the role is at or below the caller's own level.
-- The Owner role is never "within" a non-owner.
create or replace function private.role_within_caller(p_role_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_owner() or (
    not (select r.is_owner from public.roles r where r.id = p_role_id)
    and not exists (
      select 1 from public.role_permissions rp
      where rp.role_id = p_role_id
        and private.level_rank(rp.level) > private.level_rank(private.permission_level(rp.area_key))
    )
  )
$$;

create or replace function private.require(p_ok boolean, p_message text)
returns void language plpgsql set search_path = '' as $$
begin
  if not coalesce(p_ok, false) then
    raise exception '%', p_message using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Rules the database enforces on every change, whoever makes it
-- ---------------------------------------------------------------------------

create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger roles_touch before update on public.roles
  for each row execute function private.touch_updated_at();
create trigger staff_touch before update on public.staff
  for each row execute function private.touch_updated_at();
create trigger settings_touch before update on public.settings
  for each row execute function private.touch_updated_at();

-- The Owner role is locked.
create or replace function private.guard_owner_role()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.is_owner then
      raise exception 'There can only be one Owner role.' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.is_owner then
    raise exception 'The Owner role is locked and cannot be changed or deleted.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.is_owner then
    raise exception 'A role cannot be made into the Owner role.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger roles_guard_owner before insert or update or delete on public.roles
  for each row execute function private.guard_owner_role();

create or replace function private.guard_owner_permissions()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (
    select 1 from public.roles r
    where r.is_owner and r.id in (coalesce(new.role_id, old.role_id), coalesce(old.role_id, new.role_id))
  ) then
    raise exception 'The Owner role is locked and its permissions cannot be changed.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger role_permissions_guard_owner before insert or update or delete on public.role_permissions
  for each row execute function private.guard_owner_permissions();

-- Only an owner can give or take away the Owner role (checked when a signed-in user makes the
-- change; the SQL editor and bootstrap have no signed-in user).
create or replace function private.guard_owner_assignment()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_old_owner boolean := false;
  v_new_owner boolean := false;
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    select r.is_owner into v_old_owner from public.roles r where r.id = old.role_id;
  end if;
  select r.is_owner into v_new_owner from public.roles r where r.id = new.role_id;
  if (v_old_owner or v_new_owner)
     and (tg_op = 'INSERT' or old.role_id is distinct from new.role_id or old.is_active is distinct from new.is_active)
     and not private.is_owner() then
    raise exception 'Only an owner can give, remove or switch off the Owner role.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger staff_guard_owner_assignment before insert or update on public.staff
  for each row execute function private.guard_owner_assignment();

-- There must always be at least one active owner once the first owner exists.
create or replace function private.guard_at_least_one_owner()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.staff)
     and not exists (
       select 1 from public.staff s join public.roles r on r.id = s.role_id
       where r.is_owner and s.is_active
     ) then
    raise exception 'The app must always keep at least one active owner.' using errcode = '42501';
  end if;
  return null;
end;
$$;

create constraint trigger staff_at_least_one_owner
  after update or delete on public.staff
  deferrable initially deferred
  for each row execute function private.guard_at_least_one_owner();

-- Activity log: every change to these tables is recorded by the database.
create or replace function private.log_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
begin
  insert into public.activity_log (actor_id, action, entity_type, entity_id, details)
  values (
    (select auth.uid()),
    lower(tg_op),
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'role_id', v_row ->> 'key'),
    case tg_op
      when 'INSERT' then jsonb_build_object('new', to_jsonb(new))
      when 'DELETE' then jsonb_build_object('old', to_jsonb(old))
      else jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new))
    end
  );
  return null;
end;
$$;

create trigger roles_log after insert or update or delete on public.roles
  for each row execute function private.log_change();
create trigger role_permissions_log after insert or update or delete on public.role_permissions
  for each row execute function private.log_change();
create trigger staff_log after insert or update or delete on public.staff
  for each row execute function private.log_change();
create trigger settings_log after insert or update or delete on public.settings
  for each row execute function private.log_change();

-- The activity log cannot be changed or deleted.
create or replace function private.block_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'The activity log cannot be changed or deleted.' using errcode = '42501';
end;
$$;

create trigger activity_log_no_update before update or delete on public.activity_log
  for each row execute function private.block_change();
create trigger activity_log_no_truncate before truncate on public.activity_log
  for each statement execute function private.block_change();

-- ---------------------------------------------------------------------------
-- Row level security: read access. (RLS is already on for every table.)
-- ---------------------------------------------------------------------------

alter table public.permission_areas enable row level security;
alter table public.roles            enable row level security;
alter table public.role_permissions enable row level security;
alter table public.staff            enable row level security;
alter table public.settings         enable row level security;
alter table public.activity_log     enable row level security;

create policy "Active staff can read areas" on public.permission_areas
  for select to authenticated using ((select private.is_active_staff()));
create policy "Active staff can read roles" on public.roles
  for select to authenticated using ((select private.is_active_staff()));
create policy "Active staff can read role permissions" on public.role_permissions
  for select to authenticated using ((select private.is_active_staff()));
create policy "Staff can read the staff list" on public.staff
  for select to authenticated using (id = (select auth.uid()) or (select private.is_active_staff()));
create policy "Settings viewers can read settings" on public.settings
  for select to authenticated using ((select private.can_view('settings')));
create policy "Owners can read the activity log" on public.activity_log
  for select to authenticated using ((select private.is_owner()));

grant select on public.permission_areas, public.roles, public.role_permissions,
  public.staff, public.settings, public.activity_log to authenticated;

-- Policies call these helpers as the signed-in user.
grant usage on schema private to authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_active_staff(), private.is_owner(), private.permission_level(text),
  private.can_view(text), private.can_edit(text), private.level_rank(text)
to authenticated;

-- ---------------------------------------------------------------------------
-- Actions the app can call (each checks permissions itself)
-- ---------------------------------------------------------------------------

-- What the signed-in person may do, for showing the right menus.
create or replace function public.my_access()
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when not private.is_active_staff() then null else jsonb_build_object(
    'staff_id', (select auth.uid()),
    'full_name', (select s.full_name from public.staff s where s.id = (select auth.uid())),
    'role_name', (select r.name from public.staff s join public.roles r on r.id = s.role_id where s.id = (select auth.uid())),
    'is_owner', private.is_owner(),
    'permissions', (select jsonb_object_agg(a.key, private.permission_level(a.key)) from public.permission_areas a)
  ) end
$$;

create or replace function public.create_role(p_name text, p_description text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform private.require(private.is_owner(), 'Only an owner can create roles.');
  insert into public.roles (name, description, created_by)
  values (btrim(p_name), coalesce(btrim(p_description), ''), (select auth.uid()))
  returning id into v_id;
  insert into public.role_permissions (role_id, area_key, level)
  select v_id, a.key, 'none' from public.permission_areas a;
  return v_id;
end;
$$;

create or replace function public.update_role(p_role_id uuid, p_name text, p_description text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.is_owner(), 'Only an owner can change roles.');
  update public.roles set name = btrim(p_name), description = coalesce(btrim(p_description), '')
  where id = p_role_id;
  perform private.require(found, 'Role not found.');
end;
$$;

-- p_levels: {"leads": "edit", "clients": "view", ...}. Areas left out are not changed.
create or replace function public.set_role_permissions(p_role_id uuid, p_levels jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_key text;
  v_level text;
begin
  perform private.require(private.is_owner(), 'Only an owner can change permissions.');
  perform private.require(exists (select 1 from public.roles where id = p_role_id), 'Role not found.');
  for v_key, v_level in select key, value from jsonb_each_text(p_levels) loop
    perform private.require(exists (select 1 from public.permission_areas where key = v_key), 'Unknown area: ' || v_key);
    perform private.require(v_level in ('none', 'view', 'edit'), 'Level must be none, view or edit.');
    insert into public.role_permissions (role_id, area_key, level)
    values (p_role_id, v_key, v_level)
    on conflict (role_id, area_key) do update set level = excluded.level
    where public.role_permissions.level is distinct from excluded.level;
  end loop;
end;
$$;

create or replace function public.delete_role(p_role_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.is_owner(), 'Only an owner can delete roles.');
  perform private.require(not exists (select 1 from public.staff where role_id = p_role_id),
    'This role is still assigned to staff. Move them to another role first.');
  delete from public.roles where id = p_role_id;
  perform private.require(found, 'Role not found.');
end;
$$;

-- Called by the app after it creates the login (invite) for a new staff member.
create or replace function public.add_staff(p_user_id uuid, p_full_name text, p_email text, p_role_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.can_edit('staff_accounts'), 'You do not have permission to add staff.');
  perform private.require(private.role_within_caller(p_role_id),
    'You can only give a role that does not go beyond your own access.');
  perform private.require(exists (
    select 1 from auth.users u where u.id = p_user_id and lower(u.email) = lower(btrim(p_email))
  ), 'Login not found for this email.');
  insert into public.staff (id, full_name, email, role_id, created_by)
  values (p_user_id, btrim(p_full_name), lower(btrim(p_email)), p_role_id, (select auth.uid()));
end;
$$;

create or replace function public.set_staff_role(p_staff_id uuid, p_role_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_current_role uuid;
begin
  perform private.require(private.can_edit('staff_accounts'), 'You do not have permission to change roles.');
  perform private.require(p_staff_id <> (select auth.uid()), 'You cannot change your own role.');
  select role_id into v_current_role from public.staff where id = p_staff_id;
  perform private.require(v_current_role is not null, 'Staff member not found.');
  perform private.require(private.role_within_caller(v_current_role),
    'You cannot change the role of someone with more access than you.');
  perform private.require(private.role_within_caller(p_role_id),
    'You can only give a role that does not go beyond your own access.');
  update public.staff set role_id = p_role_id where id = p_staff_id;
end;
$$;

create or replace function public.set_staff_active(p_staff_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_role uuid;
begin
  perform private.require(private.can_edit('staff_accounts'), 'You do not have permission to switch accounts on or off.');
  perform private.require(p_staff_id <> (select auth.uid()), 'You cannot switch off your own account.');
  select role_id into v_role from public.staff where id = p_staff_id;
  perform private.require(v_role is not null, 'Staff member not found.');
  perform private.require(private.role_within_caller(v_role),
    'You cannot change the account of someone with more access than you.');
  update public.staff set is_active = p_active where id = p_staff_id;
end;
$$;

create or replace function public.update_staff_name(p_staff_id uuid, p_full_name text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(
    p_staff_id = (select auth.uid()) and private.is_active_staff()
    or private.can_edit('staff_accounts') and private.role_within_caller((select role_id from public.staff where id = p_staff_id)),
    'You do not have permission to change this name.');
  update public.staff set full_name = btrim(p_full_name) where id = p_staff_id;
  perform private.require(found, 'Staff member not found.');
end;
$$;

-- Settings with checks on each value.
create or replace function public.update_setting(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_mode text;
  v_ids jsonb;
  v_count int;
begin
  perform private.require(private.can_edit('settings'), 'You do not have permission to change settings.');
  if p_key = 'lead_assignment' then
    v_mode := p_value ->> 'mode';
    v_ids := coalesce(p_value -> 'staff_ids', '[]'::jsonb);
    perform private.require(v_mode in ('single', 'unassigned', 'rotate'),
      'Assignment must be: one person, unassigned queue, or rotate.');
    perform private.require(jsonb_typeof(v_ids) = 'array', 'Staff list is not valid.');
    v_count := jsonb_array_length(v_ids);
    perform private.require(
      (v_mode = 'unassigned' and v_count = 0) or (v_mode = 'single' and v_count = 1) or (v_mode = 'rotate' and v_count >= 2),
      'Choose one person for "one person", two or more for "rotate", none for "unassigned".');
    perform private.require(not exists (
      select 1 from jsonb_array_elements_text(v_ids) e(id)
      where not exists (select 1 from public.staff s where s.id::text = e.id and s.is_active)
    ), 'Every chosen person must be an active staff member.');
    p_value := jsonb_build_object('mode', v_mode, 'staff_ids', v_ids, 'next_index', 0);
  elsif p_key = 'retention_months' then
    perform private.require(jsonb_typeof(p_value) = 'number'
      and (p_value #>> '{}')::numeric = trunc((p_value #>> '{}')::numeric)
      and (p_value #>> '{}')::int between 1 and 120,
      'Retention must be a whole number of months from 1 to 120.');
  else
    perform private.require(false, 'Unknown setting: ' || p_key);
  end if;
  update public.settings set value = p_value, updated_by = (select auth.uid()) where key = p_key;
end;
$$;

revoke all on function
  public.my_access(), public.create_role(text, text), public.update_role(uuid, text, text),
  public.set_role_permissions(uuid, jsonb), public.delete_role(uuid),
  public.add_staff(uuid, text, text, uuid), public.set_staff_role(uuid, uuid),
  public.set_staff_active(uuid, boolean), public.update_staff_name(uuid, text),
  public.update_setting(text, jsonb)
from public, anon;
grant execute on function
  public.my_access(), public.create_role(text, text), public.update_role(uuid, text, text),
  public.set_role_permissions(uuid, jsonb), public.delete_role(uuid),
  public.add_staff(uuid, text, text, uuid), public.set_staff_role(uuid, uuid),
  public.set_staff_active(uuid, boolean), public.update_staff_name(uuid, text),
  public.update_setting(text, jsonb)
to authenticated;

-- ---------------------------------------------------------------------------
-- First owner (run once, by hand, in the Supabase SQL editor)
-- ---------------------------------------------------------------------------
-- 1. Create the login in Supabase: Authentication > Users > Add user.
-- 2. In the SQL editor run:  select private.bootstrap_owner('email@example.com', 'Full Name');
-- It refuses to run once any owner exists. Further owners are added in the app by an owner.

create or replace function private.bootstrap_owner(p_email text, p_full_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid;
begin
  if exists (select 1 from public.staff s join public.roles r on r.id = s.role_id where r.is_owner) then
    raise exception 'An owner already exists. Add further owners in the app.';
  end if;
  select u.id into v_user_id from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_user_id is null then
    raise exception 'No login found for %. Create it first under Authentication > Users.', p_email;
  end if;
  insert into public.staff (id, full_name, email, role_id)
  select v_user_id, btrim(p_full_name), lower(btrim(p_email)), r.id from public.roles r where r.is_owner;
  insert into public.activity_log (action, entity_type, entity_id, details)
  values ('bootstrap_owner', 'staff', v_user_id::text, '{}');
end;
$$;

revoke all on function private.bootstrap_owner(text, text) from public, anon, authenticated;
