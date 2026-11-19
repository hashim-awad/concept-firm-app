-- TEST PROJECT ONLY ("Concept Firm App - Test", wtivdpwyoarpcbgohgnr). Never run on Live.
-- Creates (or resets) a dummy owner login on Test so Hashim can sign in to previews with test values.
-- Run by the one-off workflow .github/workflows/test-dummy-owner.yml with psql variables:
--   email, full_name, pw_hash (a bcrypt hash; the password itself is never in the repo).
-- Safe to run twice: an existing login gets the new password; an existing staff row becomes an active owner.
-- No client data is touched. One activity log entry is written by the staff table's own log trigger.

\set ON_ERROR_STOP on
begin;

create temporary table dummy_owner_input on commit drop as
select lower(btrim(:'email')) as email, btrim(:'full_name') as full_name, :'pw_hash' as pw_hash;

do $$
declare
  v public.roles%rowtype;
  i record;
  v_id uuid;
  c text;
begin
  select * into i from pg_temp.dummy_owner_input;
  if i.email !~ '@example\.test$' then
    raise exception 'Dummy owners must use an @example.test address.';
  end if;
  if i.pw_hash !~ '^\$2[aby]\$' then
    raise exception 'pw_hash must be a bcrypt hash.';
  end if;

  select u.id into v_id from auth.users u where lower(u.email) = i.email;
  if v_id is null then
    v_id := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', i.email, i.pw_hash, now(),
            '{"provider": "email", "providers": ["email"]}', jsonb_build_object('full_name', i.full_name), now(), now());
  else
    update auth.users set encrypted_password = i.pw_hash, email_confirmed_at = coalesce(email_confirmed_at, now()),
           banned_until = null, updated_at = now()
     where id = v_id;
  end if;
  -- The auth server reads these as text and fails on null; set whichever of them this version has.
  foreach c in array array['confirmation_token', 'recovery_token', 'email_change_token_new', 'email_change',
                           'email_change_token_current', 'phone_change', 'phone_change_token', 'reauthentication_token'] loop
    if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = c) then
      execute format('update auth.users set %I = coalesce(%I, %L) where id = $1', c, c, '') using v_id;
    end if;
  end loop;

  if not exists (select 1 from auth.identities where user_id = v_id and provider = 'email') then
    insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
    values (v_id::text, v_id, jsonb_build_object('sub', v_id::text, 'email', i.email, 'email_verified', true), 'email', now(), now());
  end if;

  -- Piece R3a-1: there is no Owner role; the dummy login gets the role with Admin (Edit on Staff accounts and Settings).
  select r.* into v from public.roles r where private.role_is_admin(r.id) order by (r.name = 'Partner') desc, r.created_at limit 1;
  if v.id is null then
    raise exception 'No role with Admin found.';
  end if;
  if exists (select 1 from public.staff where id = v_id) then
    update public.staff set role_id = v.id, is_active = true, full_name = i.full_name, email = i.email where id = v_id;
  else
    insert into public.staff (id, full_name, email, role_id) values (v_id, i.full_name, i.email, v.id);
  end if;
  raise notice 'DUMMY OWNER READY: % (owner role, active)', i.email;
end;
$$;

commit;
