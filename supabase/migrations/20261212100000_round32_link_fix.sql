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
-- Safe to run twice.

-- ---------- 1. Rights for the server key (the client page and the client's answer)
grant select on public.cb_question_links, public.cb_files, public.clients, public.cb_bank_lines, public.cb_bank_accounts,
  public.cb_line_questions, public.cb_line_files to service_role;
grant update (failed_codes, locked_until) on public.cb_question_links to service_role;
grant select, insert, update on public.cb_question_codes to service_role;
grant select, insert on public.cb_question_sessions to service_role;

-- ---------- 2. Links made by the old flow and never sent are not links: switch them off. Then one live link per file.
update public.cb_question_links set active = false where active and not sent;
update public.cb_question_links k set active = false
 where k.active and exists (select 1 from public.cb_question_links n where n.file_id = k.file_id and n.active and n.created_at > k.created_at);
create unique index if not exists cb_question_links_one_live on public.cb_question_links (file_id) where active;

-- ---------- 3. Notify client: pending link, then switched on only after the email went
create or replace function public.cb_question_link_create(p_file uuid, p_token_hash text, p_ids uuid[], p_to text[], p_cc text[], p_reply_by date, p_expires timestamptz) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files := private.cb_file_open(p_file); v_id uuid;
begin
  perform private.require(p_token_hash ~ '^[0-9a-f]{64}$', 'Bad link.');
  perform private.require(coalesce(array_length(p_to, 1), 0) between 1 and 10, 'Tick at least one contact.');
  perform private.require(coalesce(array_length(p_ids, 1), 0) >= 1, 'No open questions to send.');
  perform private.require(p_reply_by is not null, 'Enter the reply-by date.');
  -- Pending: not active, not sent. Nothing else changes until the email has gone.
  insert into public.cb_question_links (file_id, token_hash, created_by, expires_at, active, sent, reply_by, to_emails, cc_emails, line_ids)
  values (p_file, p_token_hash, (select auth.uid()), p_expires, false, false, p_reply_by, p_to, coalesce(p_cc, '{}'), p_ids)
  returning id into v_id;
  return v_id;
end;
$$;

-- The email went: this link goes live and the earlier ones switch off, in one step; the questions are Waiting, sent today.
create or replace function public.cb_question_link_sent(p_link uuid) returns int
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
  perform private.cb_log_event(k.file_id, 'questions_sent', 'code', 'Client notified', null, null, format('%s question%s', v_n, case when v_n = 1 then '' else 's' end),
    case when v_old is not null then 'The earlier link was switched off.' else '' end, '', array_to_string(k.to_emails || k.cc_emails, ', '));
  return v_n;
end;
$$;

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
  public.cb_question_link_cancel(uuid) from public, anon;
grant execute on function public.cb_question_link_create(uuid, text, uuid[], text[], text[], date, timestamptz), public.cb_question_link_sent(uuid),
  public.cb_question_link_cancel(uuid) to authenticated;

-- ---------- 5. Check every right the client page needs. If one does not hold, the deploy stops and says which.
do $$
declare
  v_need text[][] := array[
    ['cb_question_links', 'select'], ['cb_question_links', 'update'], ['cb_files', 'select'], ['clients', 'select'], ['cb_bank_lines', 'select'],
    ['cb_bank_accounts', 'select'], ['cb_line_questions', 'select'], ['cb_line_files', 'select'],
    ['cb_question_codes', 'select'], ['cb_question_codes', 'insert'], ['cb_question_codes', 'update'],
    ['cb_question_sessions', 'select'], ['cb_question_sessions', 'insert']];
  v_missing text[] := '{}';
  i int;
begin
  for i in 1 .. array_length(v_need, 1) loop
    if not (has_table_privilege('service_role', 'public.' || v_need[i][1], v_need[i][2])
            or (v_need[i][2] = 'update' and has_column_privilege('service_role', 'public.' || v_need[i][1], 'locked_until', 'update'))) then
      v_missing := v_missing || format('%s %s', v_need[i][2], v_need[i][1]);
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.cb_client_answer(uuid, uuid, text, text, jsonb)', 'execute') then v_missing := v_missing || 'execute cb_client_answer'::text; end if;
  if not has_function_privilege('service_role', 'public.cb_question_link_refused(uuid, text)', 'execute') then v_missing := v_missing || 'execute cb_question_link_refused'::text; end if;
  if array_length(v_missing, 1) > 0 then
    raise exception 'The server key still cannot use: %. The deploy ran as %.', array_to_string(v_missing, '; '), current_user;
  end if;
end;
$$;
