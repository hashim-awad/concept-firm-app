-- Round 35b (Hashim, Nov 17, 2026): a question on a posted line never changes the books.
--   * The rule is about the question, not the line. Posting a line closes every question still waiting on it at that
--     moment (never on the client page; round 33's rule). A question asked on a line that is already posted stays open
--     until the client answers; the line stays posted, with its account, tax and "For the reviewer" flag.
--   * The client page shows open questions that were sent (Waiting) and answered ones (Answered), posted or not; never
--     a closed question, an unsent one, an internal note, or an excluded line.
--   * cb_line_questions.closed_at records the closing; q_status gains 'closed' (every question on the line closed).
-- The functions are written out in full (the repository's versions with the pending checks replaced), so a database
-- holding an older copy takes them the same way. Existing data: questions still waiting on lines already posted or
-- excluded are closed now, as the app already treated them. Never drops a table or column. Safe to run twice.

alter table public.cb_line_questions add column if not exists closed_at timestamptz;
alter table public.cb_bank_lines drop constraint if exists cb_bank_lines_q_status_check;
alter table public.cb_bank_lines add constraint cb_bank_lines_q_status_check check (q_status in ('', 'not_sent', 'waiting', 'answered', 'closed'));

CREATE OR REPLACE FUNCTION private.cb_q_status_recalc(p_line uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
-- Round 35b: from the questions that are still open (not closed by posting). Not sent: an open question not sent yet;
-- Waiting / Answered: the last open sent question and the last answer; Closed: every question closed; '': none.
declare v_unsent boolean; v_open boolean; v_any boolean; v_lastq timestamptz; v_lasta timestamptz; v_status text;
  v_flag text := coalesce(current_setting('cb.transfer', true), '');   -- the caller's flag (a transfer pairing) is kept
begin
  select bool_or(kind = 'q' and closed_at is null and sent_at is null), bool_or(kind = 'q' and closed_at is null), bool_or(kind = 'q'),
         max(sent_at) filter (where kind = 'q' and closed_at is null), max(created_at) filter (where kind = 'a')
    into v_unsent, v_open, v_any, v_lastq, v_lasta from public.cb_line_questions where line_id = p_line;
  v_status := case when coalesce(v_unsent, false) then 'not_sent'
                   when coalesce(v_open, false) and v_lastq is not null then case when v_lasta is not null and v_lasta >= v_lastq then 'answered' else 'waiting' end
                   when coalesce(v_any, false) then 'closed' else '' end;
  perform set_config('cb.transfer', 'on', true);
  update public.cb_bank_lines set q_status = v_status, q_sent_on = case when v_status = '' then null else q_sent_on end
   where id = p_line and q_status is distinct from v_status;
  perform set_config('cb.transfer', v_flag, true);
end;
$function$;
revoke all on function private.cb_q_status_recalc(uuid) from public, anon, authenticated;

-- Posting (or excluding) a line closes the questions still waiting on it: unsent, or sent and not answered.
create or replace function private.cb_close_questions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.q_status <> '' and private.cb_line_pending(old) and not private.cb_line_pending(new) then
    update public.cb_line_questions q set closed_at = now()
     where q.line_id = new.id and q.kind = 'q' and q.closed_at is null
       and not exists (select 1 from public.cb_line_questions a where a.line_id = q.line_id and a.kind = 'a' and a.created_at >= q.created_at);
    perform private.cb_q_status_recalc(new.id);
  end if;
  return null;
end;
$$;
revoke all on function private.cb_close_questions() from public, anon, authenticated;
drop trigger if exists cb_close_questions on public.cb_bank_lines;
create trigger cb_close_questions after update of status on public.cb_bank_lines for each row execute function private.cb_close_questions();

-- Existing data: questions still waiting on lines already posted or excluded are closed, as the app showed them.
update public.cb_line_questions q set closed_at = now()
 where q.kind = 'q' and q.closed_at is null
   and exists (select 1 from public.cb_bank_lines l where l.id = q.line_id and not private.cb_line_pending(l))
   and not exists (select 1 from public.cb_line_questions a where a.line_id = q.line_id and a.kind = 'a' and a.created_at >= q.created_at);
do $$ declare r record; begin
  for r in select distinct line_id from public.cb_line_questions loop perform private.cb_q_status_recalc(r.line_id); end loop;
end $$;

-- ---------- Asking, sending, marking sent, answering and editing: open questions, posted line or not (never excluded).
CREATE OR REPLACE FUNCTION public.cb_ask_questions(p_file uuid, p_ids uuid[], p_text text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file public.cb_files := private.cb_file_open(p_file); l public.cb_bank_lines; v_n int := 0; v_q text := btrim(coalesce(p_text, ''));
begin
  perform private.require(length(v_q) between 3 and 400, 'Type the question: 400 characters at most.');
  perform private.require(coalesce(array_length(p_ids, 1), 0) between 1 and 1000, 'Choose the lines.');
  for l in select * from public.cb_bank_lines where file_id = p_file and id = any (p_ids) for update loop
    perform private.require(l.status <> 'excluded', 'An excluded line cannot be asked about.');   -- round 35b: a posted line can be asked about; it stays posted
    insert into public.cb_line_questions (file_id, line_id, kind, body, asked_by) values (p_file, l.id, 'q', v_q, (select auth.uid()));
    -- Asking posts nothing and changes nothing else on the line.
    perform set_config('cb.transfer', 'on', true);
    update public.cb_bank_lines set q_status = 'not_sent' where id = l.id;
    perform set_config('cb.transfer', '', true);
    perform private.cb_log_event(p_file, 'line_question', 'code', 'Question added', l.statement_id, l.id, private.cb_line_label(l), '', '', v_q);
    v_n := v_n + 1;
  end loop;
  perform private.require(v_n > 0, 'Choose the lines.');
  return v_n;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_mark_questions_sent(p_file uuid, p_ids uuid[], p_date date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file public.cb_files := private.cb_file_open(p_file); v_n int;
begin
  perform private.require(p_date is not null and p_date <= (now() at time zone 'America/Toronto')::date, 'Enter the date they were sent.');
  perform set_config('cb.transfer', 'on', true);
  update public.cb_bank_lines set q_status = 'waiting', q_sent_on = p_date
   where file_id = p_file and id = any (p_ids) and q_status in ('not_sent', 'waiting') and status <> 'excluded';
  get diagnostics v_n = row_count;
  perform set_config('cb.transfer', '', true);
  perform private.require(v_n > 0, 'None of these questions is open.');
  perform private.cb_log_event(p_file, 'questions_marked_sent', 'code', 'Questions marked as sent', null, null, format('%s question%s', v_n, case when v_n = 1 then '' else 's' end), '',
    '', to_char(p_date, 'Mon FMDD, YYYY'));
  return v_n;
end;
$function$;

CREATE OR REPLACE FUNCTION private.cb_question_link_go(p_link uuid, p_copied boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
     and q.closed_at is null and exists (select 1 from public.cb_bank_lines l where l.id = q.line_id and l.status <> 'excluded');
  perform set_config('cb.transfer', 'on', true);
  update public.cb_bank_lines l set q_status = 'waiting', q_sent_on = (now() at time zone 'America/Toronto')::date
   where l.file_id = k.file_id and l.id = any (k.line_ids) and l.q_status in ('not_sent', 'waiting') and l.status <> 'excluded';
  get diagnostics v_n = row_count;
  perform set_config('cb.transfer', '', true);
  perform private.cb_log_event(k.file_id, case when p_copied then 'questions_link_copied' else 'questions_sent' end, 'code',
    case when p_copied then 'Link copied' else 'Client notified' end, null, null, format('%s question%s', v_n, case when v_n = 1 then '' else 's' end),
    case when v_old is not null then 'The earlier link was switched off.' else '' end, '', array_to_string(k.to_emails || k.cc_emails, ', '));
  return v_n;
end;
$function$;
revoke all on function private.cb_question_link_go(uuid, boolean) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cb_client_answer(p_link uuid, p_line uuid, p_email text, p_text text, p_files jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare k public.cb_question_links; l public.cb_bank_lines; v_file public.cb_files; v_a uuid; f jsonb; v_name text; v_notice uuid; v_n int;
begin
  select * into k from public.cb_question_links where id = p_link;
  perform private.require(k.id is not null and k.active and k.sent and k.expires_at > now(), 'This link is no longer active.');
  select * into v_file from public.cb_files where id = k.file_id;
  perform private.require(v_file.phase <> 'locked', 'This link is no longer active.');
  select * into l from public.cb_bank_lines where id = p_line and file_id = k.file_id for update;
  perform private.require(l.id is not null and l.q_status = 'waiting' and l.status <> 'excluded', 'This question is already answered.');
  perform private.require(length(btrim(coalesce(p_text, ''))) > 0 or jsonb_array_length(coalesce(p_files, '[]')) > 0, 'Type an answer or attach a file.');
  perform private.require(jsonb_array_length(coalesce(p_files, '[]')) <= 5, 'Up to 5 files per answer.');
  insert into public.cb_line_questions (file_id, line_id, kind, body, answered_by, link_id) values (k.file_id, l.id, 'a', left(btrim(coalesce(p_text, '')), 2000), lower(p_email), k.id)
  returning id into v_a;
  for f in select * from jsonb_array_elements(coalesce(p_files, '[]')) loop
    perform private.require(f ->> 'path' like 'closebook/' || k.file_id::text || '/lines/' || l.id::text || '/client/%', 'Wrong place for the file.');
    insert into public.cb_line_files (file_id, line_id, path, name, size, question_id, from_client) values (k.file_id, l.id, f ->> 'path', left(f ->> 'name', 200), coalesce((f ->> 'size')::bigint, 0), v_a, lower(p_email));
  end loop;
  perform set_config('cb.transfer', 'on', true);
  update public.cb_bank_lines set q_status = 'answered' where id = l.id;
  perform set_config('cb.transfer', '', true);
  insert into public.cb_file_history (file_id, actor_id, action, step, detail, statement_id, line_id, ref_label, reason, old_value, new_value)
  values (k.file_id, null, 'client_answer', 'code', 'Client answered', l.statement_id, l.id, left(private.cb_line_label(l), 300), left(lower(p_email), 300), '',
          left(btrim(coalesce(p_text, '')) || case when jsonb_array_length(coalesce(p_files, '[]')) > 0 then format(' (%s file%s attached)', jsonb_array_length(p_files), case when jsonb_array_length(p_files) = 1 then '' else 's' end) else '' end, 300));
  -- One bell notice per client per 10 minutes, to the person who sent the notice.
  if k.created_by is not null then
    select c.legal_name into v_name from public.clients c where c.id = v_file.client_id;
    select id, count into v_notice, v_n from public.staff_notices where staff_id = k.created_by and group_key = 'cbq:' || k.file_id::text and created_at > now() - interval '10 minutes'
      order by created_at desc limit 1;
    if v_notice is null then
      insert into public.staff_notices (staff_id, group_key, title, href, count)
      values (k.created_by, 'cbq:' || k.file_id::text, format('%s answered 1 question.', v_name), format('/closebook/%s?area=reporting&report=questions', k.file_id), 1);
    else
      update public.staff_notices set count = v_n + 1, title = format('%s answered %s questions.', v_name, v_n + 1), updated_at = now(), read_at = null where id = v_notice;
    end if;
  end if;
  return 1;
end;
$function$;

CREATE OR REPLACE FUNCTION private.cb_q_unsent(p_id uuid)
 RETURNS cb_line_questions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare q public.cb_line_questions; l public.cb_bank_lines;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into q from public.cb_line_questions where id = p_id for update;
  perform private.require(q.id is not null and q.kind = 'q', 'Question not found.');
  perform private.require(q.sent_at is null, 'This question was sent to the client, so it can''t be changed. Ask a follow-up instead.');
  perform private.cb_file_open(q.file_id);
  select * into l from public.cb_bank_lines where id = q.line_id;
  perform private.require(q.closed_at is null, 'This question was closed when the line was posted.');
  perform private.require(l.status <> 'excluded', 'This line is excluded.');
  return q;
end;
$function$;
revoke all on function private.cb_q_unsent(uuid) from public, anon, authenticated;
