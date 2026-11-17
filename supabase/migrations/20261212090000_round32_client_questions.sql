-- Round 32 (Hashim, Nov 18, 2026): questions to the client about bank and card lines, answered online.
-- Benchmarks: TaxDome's transaction questions (ask from the line, notify, the client answers on a secure page), QuickBooks
-- Online's comment icon, CaseWare Cloud's Queries (due date, client contacts, "Awaiting response", history).
-- Firm decision: staff and owners can both ask and notify the client. Safe to run twice.
--
-- A line's question status: '' (none), 'not_sent' (asked, client not notified yet), 'waiting' (client notified),
-- 'answered'. "Closed" is not stored: a line posted or excluded in step 4 is closed. Asking posts nothing and changes
-- nothing else on the line.

-- ---------- 1. Staff profile: credentials and title, for the email signature
alter table public.staff add column if not exists credentials text not null default '';
alter table public.staff add column if not exists title text not null default '';

-- ---------- 2. The thread on a line
alter table public.cb_bank_lines add column if not exists q_status text not null default '';
alter table public.cb_bank_lines add column if not exists q_sent_on date;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cb_bank_lines_q_status_check') then
    alter table public.cb_bank_lines add constraint cb_bank_lines_q_status_check check (q_status in ('', 'not_sent', 'waiting', 'answered'));
  end if;
end $$;

create table if not exists public.cb_line_questions (
  id           uuid primary key default gen_random_uuid(),
  file_id      uuid not null references public.cb_files(id) on delete cascade,
  line_id      uuid not null references public.cb_bank_lines(id) on delete cascade,
  kind         text not null check (kind in ('q', 'a')),
  body         text not null default '' check (length(body) <= 2000),
  asked_by     uuid references public.staff(id),
  answered_by  text not null default '',          -- the client contact's email, on an answer
  link_id      uuid,
  created_at   timestamptz not null default now()
);
create index if not exists cb_line_questions_line on public.cb_line_questions (line_id, created_at);
create index if not exists cb_line_questions_file on public.cb_line_questions (file_id);
alter table public.cb_line_questions enable row level security;
alter table public.cb_line_questions force row level security;
drop policy if exists "Closebook viewers read questions" on public.cb_line_questions;
create policy "Closebook viewers read questions" on public.cb_line_questions for select to authenticated using ((select private.can_view('closebook')));
grant select on public.cb_line_questions to authenticated;

-- The client's files go on the line's 📎, tied to the answer.
alter table public.cb_line_files add column if not exists question_id uuid references public.cb_line_questions(id) on delete set null;
alter table public.cb_line_files add column if not exists from_client text not null default '';

-- Round 31's question list moves into the thread: its question, and the answer typed in by staff, if any.
do $$ begin
  if not exists (select 1 from public.cb_line_questions) then
    insert into public.cb_line_questions (file_id, line_id, kind, body, asked_by, created_at)
    select file_id, id, 'q', left(coalesce(nullif(client_question, ''), 'What was this transaction for?'), 400), asked_by, asked_at
      from public.cb_bank_lines where asked_at is not null;
    insert into public.cb_line_questions (file_id, line_id, kind, body, created_at)
    select file_id, id, 'a', client_answer, asked_at + interval '1 second' from public.cb_bank_lines where asked_at is not null and client_answer <> '';
    perform set_config('cb.transfer', 'on', true);
    update public.cb_bank_lines set q_status = case when client_answer <> '' then 'answered' else 'not_sent' end where asked_at is not null and q_status = '';
    perform set_config('cb.transfer', '', true);
  end if;
end $$;

-- ---------- 3. Saved questions, per person
create table if not exists public.cb_saved_questions (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references public.staff(id) on delete cascade,
  body        text not null check (length(btrim(body)) between 1 and 400),
  created_at  timestamptz not null default now(),
  unique (staff_id, body)
);
alter table public.cb_saved_questions enable row level security;
alter table public.cb_saved_questions force row level security;
drop policy if exists "Own saved questions" on public.cb_saved_questions;
create policy "Own saved questions" on public.cb_saved_questions for select to authenticated using (staff_id = (select auth.uid()));
grant select on public.cb_saved_questions to authenticated;
alter table public.staff add column if not exists saved_questions_seeded boolean not null default false;

-- ---------- 4. The client's link, codes and sessions (read and written by the server only)
create table if not exists public.cb_question_links (
  id            uuid primary key default gen_random_uuid(),
  file_id       uuid not null references public.cb_files(id) on delete cascade,
  token_hash    text not null unique,
  created_by    uuid references public.staff(id),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  active        boolean not null default true,
  sent          boolean not null default false,
  replaced      uuid,                              -- the link this one switched off (restored if sending fails)
  reply_by      date,
  to_emails     text[] not null default '{}',
  cc_emails     text[] not null default '{}',
  line_ids      uuid[] not null default '{}',
  failed_codes  int not null default 0,
  locked_until  timestamptz
);
create index if not exists cb_question_links_file on public.cb_question_links (file_id, active);
alter table public.cb_question_links enable row level security;
alter table public.cb_question_links force row level security;
drop policy if exists "Closebook viewers read links" on public.cb_question_links;
create policy "Closebook viewers read links" on public.cb_question_links for select to authenticated using ((select private.can_view('closebook')));
grant select (id, file_id, created_by, created_at, expires_at, active, sent, reply_by, to_emails, cc_emails, line_ids) on public.cb_question_links to authenticated;

create table if not exists public.cb_question_codes (
  id          uuid primary key default gen_random_uuid(),
  link_id     uuid not null references public.cb_question_links(id) on delete cascade,
  email       text not null,
  code_hash   text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);
alter table public.cb_question_codes enable row level security;
alter table public.cb_question_codes force row level security;

create table if not exists public.cb_question_sessions (
  id            uuid primary key default gen_random_uuid(),
  link_id       uuid not null references public.cb_question_links(id) on delete cascade,
  session_hash  text not null unique,
  email         text not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null
);
alter table public.cb_question_sessions enable row level security;
alter table public.cb_question_sessions force row level security;

-- ---------- 5. The bell (Studio notices to one person)
create table if not exists public.staff_notices (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references public.staff(id) on delete cascade,
  group_key   text not null default '',
  title       text not null,
  href        text not null default '',
  count       int not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index if not exists staff_notices_staff on public.staff_notices (staff_id, updated_at desc);
alter table public.staff_notices enable row level security;
alter table public.staff_notices force row level security;
drop policy if exists "Own notices" on public.staff_notices;
create policy "Own notices" on public.staff_notices for select to authenticated using (staff_id = (select auth.uid()));
grant select on public.staff_notices to authenticated;

create or replace function public.staff_notices_read() returns void language sql security definer set search_path = '' as $$
  update public.staff_notices set read_at = now() where staff_id = (select auth.uid()) and read_at is null;
$$;

-- ---------- 6. Asking, saved questions, marking as sent (staff and owners)
create or replace function public.cb_my_saved_questions() returns setof public.cb_saved_questions
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := (select auth.uid());
begin
  perform private.require(private.can_view('closebook'), 'You need Closebook.');
  if not coalesce((select saved_questions_seeded from public.staff where id = v_me), true) then
    insert into public.cb_saved_questions (staff_id, body, created_at) values
      (v_me, 'What was this transaction for?', now()),
      (v_me, 'Could you provide the receipt for this transaction?', now() + interval '1 millisecond'),
      (v_me, 'What was this transaction for? Please attach the receipt or invoice.', now() + interval '2 milliseconds')
    on conflict do nothing;
    update public.staff set saved_questions_seeded = true where id = v_me;
  end if;
  return query select * from public.cb_saved_questions where staff_id = v_me order by created_at;
end;
$$;

create or replace function public.cb_saved_question_add(p_text text) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.require(private.can_view('closebook'), 'You need Closebook.');
  perform private.require(length(btrim(coalesce(p_text, ''))) between 3 and 400, 'Type the question first.');
  insert into public.cb_saved_questions (staff_id, body) values ((select auth.uid()), btrim(p_text)) on conflict (staff_id, body) do update set body = excluded.body returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.cb_saved_question_remove(p_id uuid) returns void language sql security definer set search_path = '' as $$
  delete from public.cb_saved_questions where id = p_id and staff_id = (select auth.uid());
$$;

create or replace function public.cb_ask_questions(p_file uuid, p_ids uuid[], p_text text) returns int
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files := private.cb_file_open(p_file); l public.cb_bank_lines; v_n int := 0; v_q text := btrim(coalesce(p_text, ''));
begin
  perform private.require(length(v_q) between 3 and 400, 'Type the question: 400 characters at most.');
  perform private.require(coalesce(array_length(p_ids, 1), 0) between 1 and 1000, 'Choose the lines.');
  for l in select * from public.cb_bank_lines where file_id = p_file and id = any (p_ids) for update loop
    perform private.require(private.cb_line_pending(l), 'Only Pending lines can be asked about.');
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
$$;

create or replace function public.cb_mark_questions_sent(p_file uuid, p_ids uuid[], p_date date) returns int
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files := private.cb_file_open(p_file); v_n int;
begin
  perform private.require(p_date is not null and p_date <= (now() at time zone 'America/Toronto')::date, 'Enter the date they were sent.');
  perform set_config('cb.transfer', 'on', true);
  update public.cb_bank_lines set q_status = 'waiting', q_sent_on = p_date
   where file_id = p_file and id = any (p_ids) and q_status in ('not_sent', 'waiting') and private.cb_line_pending(cb_bank_lines);
  get diagnostics v_n = row_count;
  perform set_config('cb.transfer', '', true);
  perform private.require(v_n > 0, 'None of these questions is open.');
  perform private.cb_log_event(p_file, 'questions_marked_sent', 'code', 'Questions marked as sent', null, null, format('%s question%s', v_n, case when v_n = 1 then '' else 's' end), '',
    '', to_char(p_date, 'Mon FMDD, YYYY'));
  return v_n;
end;
$$;

-- ---------- 7. Notify client: one live link per file
create or replace function public.cb_question_link_create(p_file uuid, p_token_hash text, p_ids uuid[], p_to text[], p_cc text[], p_reply_by date, p_expires timestamptz) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files := private.cb_file_open(p_file); v_old uuid; v_id uuid;
begin
  perform private.require(p_token_hash ~ '^[0-9a-f]{64}$', 'Bad link.');
  perform private.require(coalesce(array_length(p_to, 1), 0) between 1 and 10, 'Tick at least one contact.');
  perform private.require(coalesce(array_length(p_ids, 1), 0) >= 1, 'No open questions to send.');
  perform private.require(p_reply_by is not null, 'Enter the reply-by date.');
  select id into v_old from public.cb_question_links where file_id = p_file and active order by created_at desc limit 1;
  update public.cb_question_links set active = false where file_id = p_file and active;
  insert into public.cb_question_links (file_id, token_hash, created_by, expires_at, replaced, reply_by, to_emails, cc_emails, line_ids)
  values (p_file, p_token_hash, (select auth.uid()), p_expires, v_old, p_reply_by, p_to, coalesce(p_cc, '{}'), p_ids)
  returning id into v_id;
  return v_id;
end;
$$;

-- The email went: the included open questions are Waiting, sent today; History has who, when, to whom, how many.
create or replace function public.cb_question_link_sent(p_link uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare k public.cb_question_links; v_n int;
begin
  select * into k from public.cb_question_links where id = p_link;
  perform private.require(k.id is not null and k.created_by = (select auth.uid()), 'Link not found.');
  perform private.cb_file_open(k.file_id);
  update public.cb_question_links set sent = true where id = k.id;
  perform set_config('cb.transfer', 'on', true);
  update public.cb_bank_lines set q_status = 'waiting', q_sent_on = (now() at time zone 'America/Toronto')::date
   where file_id = k.file_id and id = any (k.line_ids) and q_status in ('not_sent', 'waiting');
  get diagnostics v_n = row_count;
  perform set_config('cb.transfer', '', true);
  perform private.cb_log_event(k.file_id, 'questions_sent', 'code', 'Client notified', null, null, format('%s question%s', v_n, case when v_n = 1 then '' else 's' end), '',
    '', array_to_string(k.to_emails || k.cc_emails, ', '));
  return v_n;
end;
$$;

-- Sending failed: this link goes, the one it replaced comes back.
create or replace function public.cb_question_link_cancel(p_link uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare k public.cb_question_links;
begin
  select * into k from public.cb_question_links where id = p_link;
  perform private.require(k.id is not null and k.created_by = (select auth.uid()) and not k.sent, 'Link not found.');
  delete from public.cb_question_links where id = k.id;
  if k.replaced is not null then update public.cb_question_links set active = true where id = k.replaced and sent and expires_at > now(); end if;
end;
$$;

-- ---------- 8. The client's answer (called by the server for a signed-in link)
create or replace function public.cb_client_answer(p_link uuid, p_line uuid, p_email text, p_text text, p_files jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare k public.cb_question_links; l public.cb_bank_lines; v_file public.cb_files; v_a uuid; f jsonb; v_name text; v_notice uuid; v_n int;
begin
  select * into k from public.cb_question_links where id = p_link;
  perform private.require(k.id is not null and k.active and k.sent and k.expires_at > now(), 'This link is no longer active.');
  select * into v_file from public.cb_files where id = k.file_id;
  perform private.require(v_file.phase <> 'locked', 'This link is no longer active.');
  select * into l from public.cb_bank_lines where id = p_line and file_id = k.file_id for update;
  perform private.require(l.id is not null and l.q_status = 'waiting' and private.cb_line_pending(l), 'This question is already answered.');
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
$$;

-- The sender's signature on the questions email: credentials and title. A person sets their own; staff-account editors set others'.
create or replace function public.update_staff_signature(p_staff_id uuid, p_credentials text, p_title text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(
    p_staff_id = (select auth.uid()) and private.is_active_staff()
    or private.can_edit('staff_accounts') and private.role_within_caller((select role_id from public.staff where id = p_staff_id)),
    'You do not have permission to change this signature.');
  perform private.require(length(coalesce(p_credentials, '')) <= 80 and length(coalesce(p_title, '')) <= 80, 'Keep the credentials and title to 80 characters each.');
  update public.staff set credentials = coalesce(btrim(p_credentials), ''), title = coalesce(btrim(p_title), '') where id = p_staff_id;
  perform private.require(found, 'Staff member not found.');
end;
$$;
revoke all on function public.update_staff_signature(uuid, text, text) from public, anon;
grant execute on function public.update_staff_signature(uuid, text, text) to authenticated;

-- ---------- 9. Grants
revoke all on function public.cb_my_saved_questions(), public.cb_saved_question_add(text), public.cb_saved_question_remove(uuid), public.cb_ask_questions(uuid, uuid[], text),
  public.cb_mark_questions_sent(uuid, uuid[], date), public.cb_question_link_create(uuid, text, uuid[], text[], text[], date, timestamptz), public.cb_question_link_sent(uuid),
  public.cb_question_link_cancel(uuid), public.staff_notices_read(), public.cb_client_answer(uuid, uuid, text, text, jsonb) from public, anon;
grant execute on function public.cb_my_saved_questions(), public.cb_saved_question_add(text), public.cb_saved_question_remove(uuid), public.cb_ask_questions(uuid, uuid[], text),
  public.cb_mark_questions_sent(uuid, uuid[], date), public.cb_question_link_create(uuid, text, uuid[], text[], text[], date, timestamptz), public.cb_question_link_sent(uuid),
  public.cb_question_link_cancel(uuid), public.staff_notices_read() to authenticated;
-- The client's answer comes only through the server, which checks the link and the code first.
grant execute on function public.cb_client_answer(uuid, uuid, text, text, jsonb) to service_role;
