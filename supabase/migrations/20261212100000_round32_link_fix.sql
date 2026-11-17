-- Round 32 fix (Hashim, Nov 17, 2026): the client's link showed "This link is no longer active" right after a good send.
-- Cause: the client page reads the questions tables with the app's server key (role service_role), and on Live that role
-- has no rights on tables a migration creates unless they are granted (as with questionnaires, 20261110120000). Round 32
-- granted none, the page read nothing and showed the "no longer active" message. Locally the role has the rights by default.
-- Also, the rules as fixed by Hashim:
--   * A failed send never creates a link and never switches one off. A send makes a pending link (not active); only a
--     good send switches it on and switches the earlier ones off, in one step.
--   * One live link per file at most (a unique index).
--   * The reply-by date never affects the link. Opening the page never changes it.
--   * A refused link is written to History with the reason (expired, replaced, file locked, not sent).
-- Hashim's additions (Nov 17, 2026):
--   * The cause, for good: the role that runs the migrations gives the server key its rights on every new table, view,
--     sequence and function in public by default, and the existing ones get them now.
--   * The check below (private.server_key_gaps) covers tables, views, sequences, functions, the storage buckets and the
--     storage tables; the deploy also runs it after the change (scripts/checks/server-key-rights.sql) and stops on any row.
--   * A database error on the client page goes in History and as a bell notice to the file's preparer and reviewer.
-- Firm decision (Hashim, Nov 17, 2026): no 6-digit code. The link opens the questions directly (as DocuSign's default
-- link): the code and session tables and the lock columns go. Every opening of the link is logged in History (device).
-- "Copy link" in Notify client switches a link on without an email, for staff to paste into TaxDome or Outlook.
-- Safe to run twice.

-- ---------- 1. Rights for the server key (the client page and the client's answer)
grant select on public.cb_question_links, public.cb_files, public.clients, public.cb_bank_lines, public.cb_bank_accounts,
  public.cb_line_questions, public.cb_line_files to service_role;
-- No code (firm decision): the code, the session and the lock after wrong codes go.
drop table if exists public.cb_question_sessions;
drop table if exists public.cb_question_codes;
alter table public.cb_question_links drop column if exists failed_codes, drop column if exists locked_until;

-- ---------- 2. Links made by the old flow and never sent are not links: switch them off. Then one live link per file.
update public.cb_question_links set active = false where active and not sent;
update public.cb_question_links k set active = false
 where k.active and exists (select 1 from public.cb_question_links n where n.file_id = k.file_id and n.active and n.created_at > k.created_at);
create unique index if not exists cb_question_links_one_live on public.cb_question_links (file_id) where active;

-- ---------- 3. Notify client: pending link, then switched on only after the email went (or when the link is copied)
drop function if exists public.cb_question_link_create(uuid, text, uuid[], text[], text[], date, timestamptz);
create or replace function public.cb_question_link_create(p_file uuid, p_token_hash text, p_ids uuid[], p_to text[], p_cc text[], p_reply_by date, p_expires timestamptz) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files := private.cb_file_open(p_file); v_id uuid;
begin
  perform private.require(p_token_hash ~ '^[0-9a-f]{64}$', 'Bad link.');
  perform private.require(coalesce(array_length(p_to, 1), 0) <= 10, 'Up to 10 contacts.');
  perform private.require(coalesce(array_length(p_ids, 1), 0) >= 1, 'No open questions to send.');
  perform private.require(p_reply_by is not null, 'Enter the reply-by date.');
  -- Pending: not active, not sent. Nothing else changes until the email has gone or the link is copied.
  insert into public.cb_question_links (file_id, token_hash, created_by, expires_at, active, sent, reply_by, to_emails, cc_emails, line_ids)
  values (p_file, p_token_hash, (select auth.uid()), p_expires, false, false, p_reply_by, coalesce(p_to, '{}'), coalesce(p_cc, '{}'), p_ids)
  returning id into v_id;
  return v_id;
end;
$$;

-- This link goes live and the earlier ones switch off, in one step; the questions are Waiting, sent today; History.
create or replace function private.cb_question_link_go(p_link uuid, p_copied boolean) returns int
language plpgsql security definer set search_path = '' as $$
declare k public.cb_question_links; v_n int; v_old uuid;
begin
  select * into k from public.cb_question_links where id = p_link for update;
  perform private.require(k.id is not null and k.created_by = (select auth.uid()), 'Link not found.');
  perform private.cb_file_open(k.file_id);
  if k.sent then return 0; end if;                     -- already done (a retry)
  select id into v_old from public.cb_question_links where file_id = k.file_id and active and id <> k.id order by created_at desc limit 1;
  update public.cb_question_links set active = false where file_id = k.file_id and active and id <> k.id;
  update public.cb_question_links set sent = true, active = true, replaced = v_old where id = k.id;
  perform set_config('cb.transfer', 'on', true);
  update public.cb_bank_lines set q_status = 'waiting', q_sent_on = (now() at time zone 'America/Toronto')::date
   where file_id = k.file_id and id = any (k.line_ids) and q_status in ('not_sent', 'waiting');
  get diagnostics v_n = row_count;
  perform set_config('cb.transfer', '', true);
  perform private.cb_log_event(k.file_id, case when p_copied then 'questions_link_copied' else 'questions_sent' end, 'code',
    case when p_copied then 'Link copied' else 'Client notified' end, null, null, format('%s question%s', v_n, case when v_n = 1 then '' else 's' end),
    case when v_old is not null then 'The earlier link was switched off.' else '' end, '', array_to_string(k.to_emails || k.cc_emails, ', '));
  return v_n;
end;
$$;
revoke all on function private.cb_question_link_go(uuid, boolean) from public, anon, authenticated;

-- The email went.
create or replace function public.cb_question_link_sent(p_link uuid) returns int
language sql security definer set search_path = '' as $$ select private.cb_question_link_go(p_link, false) $$;
-- "Copy link": no email; staff paste the link into TaxDome or their own Outlook.
create or replace function public.cb_question_link_copied(p_link uuid) returns int
language sql security definer set search_path = '' as $$ select private.cb_question_link_go(p_link, true) $$;

-- The email did not go: the pending link is removed. No other link changes.
create or replace function public.cb_question_link_cancel(p_link uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare k public.cb_question_links;
begin
  select * into k from public.cb_question_links where id = p_link;
  perform private.require(k.id is not null and k.created_by = (select auth.uid()) and not k.sent, 'Link not found.');
  delete from public.cb_question_links where id = k.id;
end;
$$;

-- Every opening of a live link, in History: when, and on what (phone, tablet, computer, or an automatic link check).
create or replace function public.cb_question_link_opened(p_link uuid, p_device text) returns void
language plpgsql security definer set search_path = '' as $$
declare k public.cb_question_links;
begin
  select * into k from public.cb_question_links where id = p_link;
  if k.id is null then return; end if;
  insert into public.cb_file_history (file_id, actor_id, action, step, detail, ref_label, reason, old_value, new_value)
  values (k.file_id, null, 'client_link_opened', 'code', 'Client opened the link', format('Link sent %s', to_char(k.created_at at time zone 'America/Toronto', 'Mon FMDD, YYYY HH12:MI AM')),
          left(coalesce(nullif(btrim(p_device), ''), 'unknown device'), 100), '', k.id::text);
end;
$$;
revoke all on function public.cb_question_link_opened(uuid, text) from public, anon, authenticated;
grant execute on function public.cb_question_link_opened(uuid, text) to service_role;

-- ---------- 4. A refused link, in History with the reason (once an hour per link and reason)
create or replace function public.cb_question_link_refused(p_link uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare k public.cb_question_links; v_reason text;
begin
  select * into k from public.cb_question_links where id = p_link;
  if k.id is null then return; end if;
  v_reason := case p_reason when 'expired' then 'Expired (30 days)' when 'replaced' then 'Replaced by a newer link'
    when 'locked' then 'File locked' when 'not_sent' then 'Never sent (the email failed)' else left(coalesce(p_reason, ''), 100) end;
  if exists (select 1 from public.cb_file_history where file_id = k.file_id and action = 'client_link_refused' and reason = v_reason
             and new_value = k.id::text and at > now() - interval '1 hour') then return; end if;
  insert into public.cb_file_history (file_id, actor_id, action, step, detail, ref_label, reason, old_value, new_value)
  values (k.file_id, null, 'client_link_refused', 'code', 'Client link refused', format('Link sent %s', to_char(k.created_at at time zone 'America/Toronto', 'Mon FMDD, YYYY HH12:MI AM')),
          v_reason, '', k.id::text);
end;
$$;

revoke all on function public.cb_question_link_refused(uuid, text) from public, anon, authenticated;
grant execute on function public.cb_question_link_refused(uuid, text) to service_role;
grant execute on function public.cb_client_answer(uuid, uuid, text, text, jsonb) to service_role;
revoke all on function public.cb_question_link_create(uuid, text, uuid[], text[], text[], date, timestamptz), public.cb_question_link_sent(uuid),
  public.cb_question_link_copied(uuid), public.cb_question_link_cancel(uuid) from public, anon;
grant execute on function public.cb_question_link_create(uuid, text, uuid[], text[], text[], date, timestamptz), public.cb_question_link_sent(uuid),
  public.cb_question_link_copied(uuid), public.cb_question_link_cancel(uuid) to authenticated;

-- ---------- 5. The cause, for good: default privileges for the role running this migration (postgres on Live), and the
-- rights on what exists now. The server key bypasses row level security already; this is about table and function rights.
do $$
declare r text;
begin
  for r in select distinct x from unnest(array[current_user::text, 'postgres']) x
           where x = current_user or pg_has_role(current_user, x, 'MEMBER') loop
    execute format('alter default privileges for role %I in schema public grant select, insert, update, delete, truncate, references, trigger on tables to service_role', r);
    execute format('alter default privileges for role %I in schema public grant usage, select, update on sequences to service_role', r);
    execute format('alter default privileges for role %I in schema public grant execute on functions to service_role', r);
  end loop;
end;
$$;
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select, update on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
-- Storage: the app's buckets, and the server key's rights on the storage tables (when this role may grant them).
insert into storage.buckets (id, name, public) values ('documents', 'documents', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('brand-private', 'brand-private', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('statement-uploads', 'statement-uploads', false) on conflict (id) do nothing;
do $$
begin
  execute 'grant usage on schema storage to service_role';
  execute 'grant select, insert, update, delete on storage.objects to service_role';
  execute 'grant select on storage.buckets to service_role';
exception when insufficient_privilege then
  raise notice 'Storage rights are managed by Supabase here; the check below confirms them.';
end;
$$;

-- ---------- 6. A database error on the client page: History, and a bell notice to the file's preparer and reviewer
-- (once per file and reason every 10 minutes; the notice counts the repeats).
create or replace function public.cb_question_link_error(p_token_hash text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare k public.cb_question_links; v_file public.cb_files; v_name text; v_reason text := left(coalesce(nullif(btrim(p_reason), ''), 'unknown error'), 200);
  v_staff uuid; v_notice uuid; v_n int;
begin
  select * into k from public.cb_question_links where token_hash = p_token_hash;
  if k.id is null then return; end if;
  select * into v_file from public.cb_files where id = k.file_id;
  select legal_name into v_name from public.clients where id = v_file.client_id;
  if not exists (select 1 from public.cb_file_history where file_id = k.file_id and action = 'client_link_error' and reason = v_reason and at > now() - interval '10 minutes') then
    insert into public.cb_file_history (file_id, actor_id, action, step, detail, ref_label, reason, old_value, new_value)
    values (k.file_id, null, 'client_link_error', 'code', 'Client link error', format('Link sent %s', to_char(k.created_at at time zone 'America/Toronto', 'Mon FMDD, YYYY HH12:MI AM')),
            v_reason, '', k.id::text);
  end if;
  for v_staff in select distinct x from unnest(array[v_file.preparer_id, v_file.reviewer_id]) x where x is not null loop
    select id, count into v_notice, v_n from public.staff_notices where staff_id = v_staff and group_key = 'cbqerr:' || k.file_id::text || ':' || md5(v_reason)
      and created_at > now() - interval '10 minutes' order by created_at desc limit 1;
    if v_notice is null then
      insert into public.staff_notices (staff_id, group_key, title, href, count)
      values (v_staff, 'cbqerr:' || k.file_id::text || ':' || md5(v_reason), left(format('Client link error on %s: %s', v_name, v_reason), 300), format('/closebook/%s?history=1', k.file_id), 1);
    else
      update public.staff_notices set count = v_n + 1, updated_at = now(), read_at = null where id = v_notice;
    end if;
  end loop;
end;
$$;
revoke all on function public.cb_question_link_error(text, text) from public, anon, authenticated;
grant execute on function public.cb_question_link_error(text, text) to service_role;

-- ---------- 7. The rights check: one row per gap; no rows when all is well. The deploy runs it after the change too.
create or replace function private.server_key_gaps() returns table (kind text, name text, missing text)
language sql stable set search_path = '' as $$
  select 'schema', s, 'usage' from unnest(array['public', 'storage']) s where not has_schema_privilege('service_role', s, 'usage')
  union all
  select case c.relkind when 'v' then 'view' when 'm' then 'view' else 'table' end, n.nspname || '.' || c.relname, p
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join lateral unnest(case when c.relkind in ('v', 'm') then array['select'] else array['select', 'insert', 'update', 'delete'] end) p
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
     and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
     and not has_table_privilege('service_role', c.oid, p)
  union all
  select 'sequence', n.nspname || '.' || c.relname, 'usage'
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'S' and (case when c.relkind = 'S' then not has_sequence_privilege('service_role', c.oid, 'usage') else false end)
  union all
  select 'function', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', 'execute'
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind in ('f', 'p')
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     and not has_function_privilege('service_role', p.oid, 'execute')
  union all
  select 'storage bucket', b, 'missing' from unnest(array['documents', 'brand-private', 'statement-uploads']) b
   where not exists (select 1 from storage.buckets where id = b)
  union all
  select 'storage table', t, p from unnest(array['storage.objects']) t cross join unnest(array['select', 'insert', 'update', 'delete']) p
   where not has_table_privilege('service_role', t, p)
  union all
  select 'storage table', 'storage.buckets', 'select' where not has_table_privilege('service_role', 'storage.buckets', 'select');
$$;
revoke all on function private.server_key_gaps() from public, anon, authenticated;

do $$
declare v text;
begin
  select string_agg(format('%s %s (%s)', kind, name, missing), '; ') into v from private.server_key_gaps();
  if v is not null then
    raise exception 'The server key cannot use: %. The deploy ran as %.', v, current_user;
  end if;
end;
$$;
