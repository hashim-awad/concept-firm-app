-- Round 33 (Hashim, Nov 17, 2026): internal notes must never reach the client page.
--   * A question is "sent" only when a Notify client or Copy link sends it: cb_line_questions.sent_at / sent_link_id.
--     The client page shows only sent questions, on lines that are Waiting or Answered and not posted or excluded.
--   * A question not sent yet can be edited, deleted or moved to the line's internal note (its memo); a sent one can't.
--     History logs each change.
--   * The internal note (memo) holds up to 2,000 characters and keeps its line breaks. It never leaves Closebook.
--   * The firm's address, phone and email live in Settings (key firm_contact), set by an owner; never in code.
-- Never drops a table or column (the deploy's restore needs them). Safe to run twice.

-- ---------- 1. When a question went out
alter table public.cb_line_questions add column if not exists sent_at timestamptz;
alter table public.cb_line_questions add column if not exists sent_link_id uuid;
alter table public.cb_question_links add column if not exists sent_at timestamptz;
update public.cb_question_links set sent_at = created_at where sent and sent_at is null;
-- Questions already sent: the first link sent after the question was typed that carried its line.
update public.cb_line_questions q set (sent_at, sent_link_id) = (
    select k.created_at, k.id from public.cb_question_links k
     where k.file_id = q.file_id and k.sent and q.line_id = any (k.line_ids) and k.created_at >= q.created_at
     order by k.created_at limit 1)
 where q.kind = 'q' and q.sent_at is null
   and exists (select 1 from public.cb_question_links k where k.file_id = q.file_id and k.sent and q.line_id = any (k.line_ids) and k.created_at >= q.created_at);

-- The link goes live: the questions not sent yet on its open lines are now sent (with this link).
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
  update public.cb_question_links set sent = true, active = true, replaced = v_old, sent_at = now() where id = k.id;
  update public.cb_line_questions q set sent_at = now(), sent_link_id = k.id
   where q.file_id = k.file_id and q.kind = 'q' and q.sent_at is null and q.line_id = any (k.line_ids)
     and exists (select 1 from public.cb_bank_lines l where l.id = q.line_id and private.cb_line_pending(l));
  perform set_config('cb.transfer', 'on', true);
  update public.cb_bank_lines l set q_status = 'waiting', q_sent_on = (now() at time zone 'America/Toronto')::date
   where l.file_id = k.file_id and l.id = any (k.line_ids) and l.q_status in ('not_sent', 'waiting') and private.cb_line_pending(l);
  get diagnostics v_n = row_count;
  perform set_config('cb.transfer', '', true);
  perform private.cb_log_event(k.file_id, case when p_copied then 'questions_link_copied' else 'questions_sent' end, 'code',
    case when p_copied then 'Link copied' else 'Client notified' end, null, null, format('%s question%s', v_n, case when v_n = 1 then '' else 's' end),
    case when v_old is not null then 'The earlier link was switched off.' else '' end, '', array_to_string(k.to_emails || k.cc_emails, ', '));
  return v_n;
end;
$$;
revoke all on function private.cb_question_link_go(uuid, boolean) from public, anon, authenticated;

-- ---------- 2. A line's question status from its thread (after a question is edited away, deleted or moved)
create or replace function private.cb_q_status_recalc(p_line uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_unsent boolean; v_lastq timestamptz; v_lasta timestamptz; v_status text;
begin
  select bool_or(kind = 'q' and sent_at is null), max(sent_at) filter (where kind = 'q'), max(created_at) filter (where kind = 'a')
    into v_unsent, v_lastq, v_lasta from public.cb_line_questions where line_id = p_line;
  v_status := case when coalesce(v_unsent, false) then 'not_sent' when v_lastq is null and v_lasta is null then ''
                   when v_lasta is not null and (v_lastq is null or v_lasta >= v_lastq) then 'answered' else 'waiting' end;
  perform set_config('cb.transfer', 'on', true);
  update public.cb_bank_lines set q_status = v_status, q_sent_on = case when v_status = '' then null else q_sent_on end
   where id = p_line and q_status is distinct from v_status;
  perform set_config('cb.transfer', '', true);
end;
$$;
revoke all on function private.cb_q_status_recalc(uuid) from public, anon, authenticated;

-- The question, checked: a question, not sent, on an open line in an open file, by someone with Edit on Closebook.
create or replace function private.cb_q_unsent(p_id uuid) returns public.cb_line_questions
language plpgsql security definer set search_path = '' as $$
declare q public.cb_line_questions; l public.cb_bank_lines;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into q from public.cb_line_questions where id = p_id for update;
  perform private.require(q.id is not null and q.kind = 'q', 'Question not found.');
  perform private.require(q.sent_at is null, 'This question was sent to the client, so it can''t be changed. Ask a follow-up instead.');
  perform private.cb_file_open(q.file_id);
  select * into l from public.cb_bank_lines where id = q.line_id;
  perform private.require(private.cb_line_pending(l), 'This line is posted or excluded.');
  return q;
end;
$$;
revoke all on function private.cb_q_unsent(uuid) from public, anon, authenticated;

create or replace function public.cb_question_edit(p_id uuid, p_text text) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.cb_line_questions := private.cb_q_unsent(p_id); l public.cb_bank_lines; v text := btrim(coalesce(p_text, ''));
begin
  perform private.require(length(v) between 3 and 400, 'Type the question: 400 characters at most.');
  if v = q.body then return; end if;
  update public.cb_line_questions set body = v where id = q.id;
  select * into l from public.cb_bank_lines where id = q.line_id;
  perform private.cb_log_event(q.file_id, 'line_question_edited', 'code', 'Question changed (not sent)', l.statement_id, l.id, private.cb_line_label(l), '', left(q.body, 300), left(v, 300));
end;
$$;

create or replace function public.cb_question_delete(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.cb_line_questions := private.cb_q_unsent(p_id); l public.cb_bank_lines;
begin
  delete from public.cb_line_questions where id = q.id;
  perform private.cb_q_status_recalc(q.line_id);
  select * into l from public.cb_bank_lines where id = q.line_id;
  perform private.cb_log_event(q.file_id, 'line_question_deleted', 'code', 'Question deleted (not sent)', l.statement_id, l.id, private.cb_line_label(l), '', left(q.body, 300), '');
end;
$$;

-- Move to internal note: the text goes to the end of the line's memo; the question goes.
create or replace function public.cb_question_to_note(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.cb_line_questions := private.cb_q_unsent(p_id); l public.cb_bank_lines; v_memo text;
begin
  select * into l from public.cb_bank_lines where id = q.line_id for update;
  v_memo := case when btrim(coalesce(l.memo, '')) = '' then q.body else l.memo || E'\n' || q.body end;
  perform private.require(length(v_memo) <= 2000, 'The internal note would be over 2,000 characters. Shorten the note first.');
  update public.cb_bank_lines set memo = v_memo where id = l.id;
  delete from public.cb_line_questions where id = q.id;
  perform private.cb_q_status_recalc(q.line_id);
  perform private.cb_log_event(q.file_id, 'line_question_to_note', 'code', 'Question moved to the internal note (not sent)', l.statement_id, l.id, private.cb_line_label(l), '', left(q.body, 300), '');
end;
$$;

revoke all on function public.cb_question_edit(uuid, text), public.cb_question_delete(uuid), public.cb_question_to_note(uuid) from public, anon;
grant execute on function public.cb_question_edit(uuid, text), public.cb_question_delete(uuid), public.cb_question_to_note(uuid) to authenticated;

-- ---------- 3. The internal note (memo): up to 2,000 characters, line breaks kept.
alter table public.cb_bank_lines drop constraint if exists cb_bank_lines_memo_check;
alter table public.cb_bank_lines add constraint cb_bank_lines_memo_check check (length(memo) <= 2000);
create or replace function public.cb_set_line_memo(p_line uuid, p_memo text, p_confirm boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare v_line public.cb_bank_lines; v_file public.cb_files;
  v_memo text := btrim(regexp_replace(regexp_replace(coalesce(p_memo, ''), E'\r\n?', E'\n', 'g'), '[ \t]+', ' ', 'g'));
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_line from public.cb_bank_lines where id = p_line;
  perform private.require(v_line.id is not null, 'Line not found.');
  select * into v_file from public.cb_files where id = v_line.file_id for update;
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(length(v_memo) <= 2000, 'Keep the internal note under 2,000 characters.');
  if v_memo = v_line.memo then return; end if;
  perform private.cb_feed_guard(v_line.file_id, p_confirm, 'memo changed');
  update public.cb_bank_lines set memo = v_memo where id = p_line;
end;
$$;
revoke all on function public.cb_set_line_memo(uuid, text, boolean) from public, anon;
grant execute on function public.cb_set_line_memo(uuid, text, boolean) to authenticated;

-- ---------- 4. The firm's contact details for client pages (Settings › Firm details › Contact; owners only)
create or replace function public.update_firm_contact(p_address text, p_phone text, p_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare a text := btrim(coalesce(p_address, '')); ph text := btrim(coalesce(p_phone, '')); em text := lower(btrim(coalesce(p_email, '')));
begin
  perform private.require(private.is_owner(), 'Only an owner can change the firm''s contact details.');
  perform private.require(length(a) between 5 and 200, 'Enter the firm''s address.');
  perform private.require(ph ~ '^[0-9 ()+.-]{7,25}$', 'Enter the phone number with digits only, for example 226-555-0100.');
  perform private.require(em ~ '^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$', 'Enter the firm''s email address.');
  insert into public.settings (key, value, updated_at, updated_by) values ('firm_contact', jsonb_build_object('address', a, 'phone', ph, 'email', em), now(), (select auth.uid()))
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;
end;
$$;
revoke all on function public.update_firm_contact(text, text, text) from public, anon;
grant execute on function public.update_firm_contact(text, text, text) to authenticated;
