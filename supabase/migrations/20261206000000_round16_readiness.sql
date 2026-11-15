-- Round 16 (Hashim, Nov 15, 2026): readiness before real files. Safe to run twice.
--  1. The acceptance and continuance record on step 1 (CSRS 4200), signed with step 1, rolled forward.
--  2. The completion checklist's 13 questions (a new draft in Templates; the 12 before stay for files
--     already answered on them).
--  3. People: the owner changes the preparer and reviewer; the reviewer is always an owner.
--  4. First-year files: no opening balances, confirmed by the reviewer with step 2.
--  5. Shareholder loans: a part the reviewer already decided carries forward, not flagged again.


alter table public.cb_checklist_questions add column if not exists active boolean not null default true;
update public.cb_checklist_questions set active = false where key between 'wb200000001' and 'wb20000000c';
insert into public.cb_checklist_questions (key, sort_order, active)
select format('wb2%s', lpad(to_hex(12 + n), 8, '0')), n, true from generate_series(1, 13) n
on conflict (key) do update set sort_order = excluded.sort_order, active = true;
-- The questions are a new draft: Hashim approves them on the Templates page.
delete from public.template_approvals where template_key = 'cbchecklist';

CREATE OR REPLACE FUNCTION private.cb_checklist_problems(p_file uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_out text[] := '{}'; v_n int; v_must text; s record;
begin
  select * into s from private.cb_mal_signed_row(p_file) as (signed_at timestamptz, signed_name text, signed_title text);
  if s.signed_at is null then return array['The checklist opens once the MAL is signed (step 9).']; end if;
  select count(*) into v_n from public.cb_checklist_questions q
   where q.active and not exists (select 1 from public.cb_checklist_answers a where a.file_id = p_file and a.question = q.key);
  if v_n > 0 then v_out := v_out || format('%s checklist question%s to answer.', v_n, case when v_n = 1 then '' else 's' end); end if;
  select string_agg(q.sort_order::text, ', ' order by q.sort_order) into v_must from public.cb_checklist_questions q
    join public.cb_checklist_answers a on a.file_id = p_file and a.question = q.key
   where q.active and q.sort_order in (1, 2, 3, 4, 6, 7, 10, 11, 12, 13) and a.answer <> 'yes';
  if v_must is not null then v_out := v_out || format('Question%s %s must be Yes.', case when position(',' in v_must) > 0 then 's' else '' end, v_must); end if;
  select count(*) into v_n from public.cb_review_notes where file_id = p_file and status = 'open';
  if v_n > 0 then v_out := v_out || format('%s open review note%s on the file.', v_n, case when v_n = 1 then '' else 's' end); end if;
  return v_out;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_save_checklist(p_file uuid, p_answers jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file public.cb_files; v jsonb; v_order int; v_changed int := 0; s record;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  select * into s from private.cb_mal_signed_row(p_file) as (signed_at timestamptz, signed_name text, signed_title text);
  perform private.require(s.signed_at is not null, 'The checklist opens once the MAL is signed (step 9).');
  perform private.require(jsonb_typeof(p_answers) = 'array', 'Answers are missing.');
  for v in select * from jsonb_array_elements(p_answers) loop
    select sort_order into v_order from public.cb_checklist_questions where key = v ->> 'question' and active;
    perform private.require(v_order is not null, 'Unknown checklist question.');
    continue when v_order in (6, 10, 11, 12);   -- filled by Closebook
    perform private.require(v ->> 'answer' in ('yes', 'no', 'na'), 'Answer Yes, No or Not applicable.');
    perform private.require(v ->> 'answer' <> 'na' or v_order in (8, 9), format('Question %s cannot be Not applicable: only questions 8 and 9 can.', v_order));
    -- Round 16: question 9 cannot be Not applicable when we are not independent (step 1, acceptance question 5).
    perform private.require(not (v_order = 9 and v ->> 'answer' = 'na' and exists (select 1 from public.cb_acceptance where file_id = p_file and q5 = 'no')),
      'Question 9 cannot be Not applicable: step 1 says we are not independent of the client.');
    perform private.require(v ->> 'answer' <> 'no' or length(btrim(coalesce(v ->> 'note', ''))) > 0, 'A "No" needs a note: say why, and what was done.');
    insert into public.cb_checklist_answers (file_id, question, answer, note, answered_by)
    values (p_file, v ->> 'question', v ->> 'answer', left(btrim(coalesce(v ->> 'note', '')), 1000), (select auth.uid()))
    on conflict (file_id, question) do update set answer = excluded.answer, note = excluded.note, answered_by = excluded.answered_by, answered_at = now()
     where public.cb_checklist_answers.answer is distinct from excluded.answer or public.cb_checklist_answers.note is distinct from excluded.note;
    if found then v_changed := v_changed + 1; end if;
  end loop;
  if v_changed > 0 then
    perform private.cb_log(p_file, 'checklist_saved', 'lock', format('%s answer%s', v_changed, case when v_changed = 1 then '' else 's' end));
    perform private.cb_clear_step(p_file, 'lock', 'The checklist changed');
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION private.cb_open_checklist(p_file uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s record; v_day text;
begin
  select * into s from private.cb_mal_signed_row(p_file) as (signed_at timestamptz, signed_name text, signed_title text);
  if s.signed_at is null then return; end if;
  insert into public.cb_file_close (file_id) values (p_file) on conflict (file_id) do nothing;
  if (select checklist_opened_at from public.cb_file_close where file_id = p_file) is null then
    delete from public.cb_checklist_answers where file_id = p_file;
    update public.cb_file_close set checklist_opened_at = now() where file_id = p_file;
    perform private.cb_log(p_file, 'checklist_opened', 'lock', 'The MAL is signed: the checklist is open. Answers saved before were cleared.');
  end if;
  v_day := trim(to_char((s.signed_at at time zone 'America/Toronto')::date, 'FMMonth FMDD, YYYY'));
  insert into public.cb_checklist_answers (file_id, question, answer, note, answered_by)
  select p_file, q.key, 'yes', case q.sort_order
      when 6 then format('Filled by Closebook from the signing record: %s approved our adjusting entries and reclassifications in the signed acknowledgement letter on %s.', s.signed_name, v_day)
      when 12 then 'Filled by Closebook: the compilation report comes from the firm''s standard CSRS 4200 wording, which cannot be edited in a file.'
      when 10 then format('Filled by Closebook from the signing record: the MAL was signed by %s, %s, on %s.', s.signed_name, coalesce(s.signed_title, ''), v_day)
      else format('Filled by Closebook: the report is dated %s, the day the MAL was signed.', v_day) end, null
    from public.cb_checklist_questions q where q.active and q.sort_order in (6, 10, 11, 12)
  on conflict (file_id, question) do update set answer = excluded.answer, note = excluded.note, answered_by = null, answered_at = now();
end;
$function$;

CREATE OR REPLACE FUNCTION private.cb_withdraw_mal(p_file uuid, p_why text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f public.cb_file_fs;
begin
  delete from public.cb_checklist_answers a using public.cb_checklist_questions q where a.file_id = p_file and a.question = q.key and q.active and q.sort_order in (6, 10, 11, 12);
  update public.cb_file_close set delivered_at = null, delivered_by = null, delivered_path = null, delivered_sha256 = null, delivered_email = null
   where file_id = p_file and delivered_at is not null;
  if found then perform private.cb_log(p_file, 'delivery_cleared', 'lock', 'The package changed: the documents must be delivered again.'); end if;
  select * into f from public.cb_file_fs where file_id = p_file;
  if f.mal_quote_id is null then return; end if;
  update public.quotes set status = 'withdrawn' where id = f.mal_quote_id and status in ('sent', 'viewed');
  update public.cb_file_fs set mal_withdrawn_quote = mal_quote_id, mal_quote_id = null, mal_sent_at = null, mal_sent_by = null, mal_withdrawn_at = now(),
    mal_withdrawn_why = left(coalesce(p_why, ''), 300) where file_id = p_file;
  perform private.cb_log(p_file, 'mal_withdrawn', 'statements', coalesce(p_why, ''));
end;
$function$;


create table if not exists public.cb_acceptance (
  file_id uuid primary key references public.cb_files(id) on delete cascade,
  q1 text check (q1 in ('yes', 'no')), q2 text check (q2 in ('yes', 'no')), q3 text check (q3 in ('yes', 'no')),
  q4 text check (q4 in ('yes', 'no')), q5 text check (q5 in ('yes', 'no')), q5_note text not null default '' check (length(q5_note) <= 1000),
  -- Question 6: management always uses the statements; outside users, each named, with question 7's answer.
  users jsonb not null default '[]'::jsonb check (jsonb_typeof(users) = 'array'),
  q8 text check (q8 in ('confirmed', 'different')), q8_note text not null default '' check (length(q8_note) <= 1000),
  q9 text check (q9 in ('yes', 'no')),
  -- Who answered or confirmed each question, and when: {"q1": {"by": uuid, "at": time, "same": bool}}.
  answered jsonb not null default '{}'::jsonb,
  updated_by uuid references public.staff(id), updated_at timestamptz not null default now()
);
alter table public.cb_acceptance enable row level security;
drop policy if exists "Closebook viewers read" on public.cb_acceptance;
create policy "Closebook viewers read" on public.cb_acceptance for select to authenticated using ((select private.can_view('closebook')));
revoke insert, update, delete on public.cb_acceptance from anon, authenticated;
grant select on public.cb_acceptance to authenticated;

-- The client's file just before this one (a year earlier), whose acceptance rolls forward.
create or replace function private.cb_prior_file(p_file uuid) returns uuid language sql stable security definer set search_path = '' as $$
  select p.id from public.cb_files f join public.cb_files p on p.client_id = f.client_id and p.year_end < f.year_end
   where f.id = p_file order by p.year_end desc limit 1
$$;

create or replace function private.cb_acceptance_problems(p_file uuid) returns text[] language plpgsql stable security definer set search_path = '' as $$
declare a public.cb_acceptance; v_out text[] := '{}'; v_n int := 0; u jsonb;
begin
  select * into a from public.cb_acceptance where file_id = p_file;
  if a.file_id is null then return array['Answer the acceptance questions.']; end if;
  v_n := (a.q1 is null)::int + (a.q2 is null)::int + (a.q3 is null)::int + (a.q4 is null)::int + (a.q5 is null)::int + (a.q8 is null)::int + (a.q9 is null)::int;
  for u in select * from jsonb_array_elements(a.users) loop
    if coalesce(u ->> 'agreed', '') = '' then v_n := v_n + 1; end if;
  end loop;
  if v_n > 0 then v_out := v_out || format('%s acceptance question%s to answer.', v_n, case when v_n = 1 then '' else 's' end); end if;
  if a.q1 = 'no' then v_out := v_out || 'Acceptance question 1 must be Yes: the engagement letter on file must cover this year-end.'::text; end if;
  if a.q2 = 'no' then v_out := v_out || 'Acceptance question 2 is No: a new or amended engagement letter is needed before work continues.'::text; end if;
  if a.q3 = 'no' then v_out := v_out || 'Acceptance question 3 must be Yes.'::text; end if;
  if a.q4 = 'no' then v_out := v_out || 'Acceptance question 4 must be Yes.'::text; end if;
  if a.q5 = 'no' and btrim(a.q5_note) = '' then v_out := v_out || 'Acceptance question 5: say what affects independence.'::text; end if;
  for u in select * from jsonb_array_elements(a.users) loop
    if btrim(coalesce(u ->> 'name', '')) = '' then v_out := v_out || 'Acceptance question 6: name each outside user.'::text;
    elsif u ->> 'agreed' = 'no' then v_out := v_out || format('Acceptance question 7 must be Yes for %s.', u ->> 'name');
    end if;
  end loop;
  if a.q8 = 'different' and btrim(a.q8_note) = '' then v_out := v_out || 'Acceptance question 8: say how the basis differs.'::text; end if;
  if a.q9 = 'no' then v_out := v_out || 'Acceptance question 9 must be Yes: a basis a user cannot accept cannot be used.'::text; end if;
  return v_out;
end;
$$;

-- Save the record. Every answer saved records who answered it and when; an answer the same as last
-- year's is recorded as confirmed. A change clears step 1's sign-offs.
create or replace function public.cb_save_acceptance(p_file uuid, p jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files; a public.cb_acceptance; v_prior public.cb_acceptance; v_ans jsonb; k text; u jsonb; v_changed boolean;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(jsonb_typeof(coalesce(p -> 'users', '[]')) = 'array' and jsonb_array_length(coalesce(p -> 'users', '[]')) <= 5, 'Up to 5 outside users.');
  for u in select * from jsonb_array_elements(coalesce(p -> 'users', '[]')) loop
    perform private.require(u ->> 'kind' in ('lender', 'other'), 'An outside user is a lender or other.');
    perform private.require(length(btrim(coalesce(u ->> 'name', ''))) between 2 and 120, 'Name each outside user.');
    perform private.require(coalesce(u ->> 'agreed', '') in ('', 'yes', 'no'), 'Answer Yes or No.');
  end loop;
  select * into a from public.cb_acceptance where file_id = p_file;
  select * into v_prior from public.cb_acceptance where file_id = private.cb_prior_file(p_file);
  v_ans := coalesce(a.answered, '{}'::jsonb);
  foreach k in array array['q1', 'q2', 'q3', 'q4', 'q5', 'q8', 'q9'] loop
    if nullif(p ->> k, '') is not null and (p ->> k) is distinct from (to_jsonb(a) ->> k) then
      v_ans := v_ans || jsonb_build_object(k, jsonb_build_object('by', (select auth.uid()), 'at', now(), 'same', (p ->> k) = (to_jsonb(v_prior) ->> k)));
    end if;
  end loop;
  if coalesce(p -> 'users', '[]') is distinct from coalesce(a.users, '[]') then
    v_ans := v_ans || jsonb_build_object('q6', jsonb_build_object('by', (select auth.uid()), 'at', now(), 'same', coalesce(p -> 'users', '[]') = v_prior.users));
  end if;
  insert into public.cb_acceptance as t (file_id, q1, q2, q3, q4, q5, q5_note, users, q8, q8_note, q9, answered, updated_by, updated_at)
  values (p_file, nullif(p ->> 'q1', ''), nullif(p ->> 'q2', ''), nullif(p ->> 'q3', ''), nullif(p ->> 'q4', ''), nullif(p ->> 'q5', ''),
          left(btrim(coalesce(p ->> 'q5_note', '')), 1000), coalesce(p -> 'users', '[]'), nullif(p ->> 'q8', ''), left(btrim(coalesce(p ->> 'q8_note', '')), 1000),
          nullif(p ->> 'q9', ''), v_ans, (select auth.uid()), now())
  on conflict (file_id) do update set q1 = excluded.q1, q2 = excluded.q2, q3 = excluded.q3, q4 = excluded.q4, q5 = excluded.q5, q5_note = excluded.q5_note,
    users = excluded.users, q8 = excluded.q8, q8_note = excluded.q8_note, q9 = excluded.q9, answered = excluded.answered, updated_by = excluded.updated_by, updated_at = now();
  v_changed := a.file_id is null or row(a.q1, a.q2, a.q3, a.q4, a.q5, a.q5_note, a.users, a.q8, a.q8_note, a.q9)
    is distinct from (select row(t.q1, t.q2, t.q3, t.q4, t.q5, t.q5_note, t.users, t.q8, t.q8_note, t.q9) from public.cb_acceptance t where t.file_id = p_file);
  if v_changed then
    perform private.cb_log(p_file, 'acceptance_saved', 'setup', 'Acceptance and continuance saved');
    perform private.cb_clear_step(p_file, 'setup', 'The acceptance record changed');
  end if;
end;
$$;
revoke all on function public.cb_save_acceptance(uuid, jsonb) from public, anon;
grant execute on function public.cb_save_acceptance(uuid, jsonb) to authenticated, service_role;

-- "Same as last year for all": every answer from the client's last file, each recorded as confirmed.
create or replace function public.cb_acceptance_same_as_last(p_file uuid) returns void language plpgsql security definer set search_path = '' as $$
declare v_prior public.cb_acceptance; v_ans jsonb := '{}'::jsonb; k text;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  perform private.require((select phase from public.cb_files where id = p_file) <> 'locked', 'This file is locked.');
  select * into v_prior from public.cb_acceptance where file_id = private.cb_prior_file(p_file);
  perform private.require(v_prior.file_id is not null, 'There is no earlier file with an acceptance record.');
  foreach k in array array['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q8', 'q9'] loop
    v_ans := v_ans || jsonb_build_object(k, jsonb_build_object('by', (select auth.uid()), 'at', now(), 'same', true));
  end loop;
  perform public.cb_save_acceptance(p_file, jsonb_build_object('q1', v_prior.q1, 'q2', v_prior.q2, 'q3', v_prior.q3, 'q4', v_prior.q4, 'q5', v_prior.q5,
    'q5_note', v_prior.q5_note, 'users', v_prior.users, 'q8', v_prior.q8, 'q8_note', v_prior.q8_note, 'q9', v_prior.q9));
  update public.cb_acceptance set answered = v_ans where file_id = p_file;
  perform private.cb_log(p_file, 'acceptance_confirmed', 'setup', 'Every acceptance answer confirmed as last year''s');
end;
$$;
revoke all on function public.cb_acceptance_same_as_last(uuid) from public, anon;
grant execute on function public.cb_acceptance_same_as_last(uuid) to authenticated, service_role;


alter table public.cb_files add column if not exists first_year boolean not null default false;

CREATE OR REPLACE FUNCTION private.cb_step_problems(p_file uuid, p_step text)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_file public.cb_files;
  v_bank boolean;
  v_out text[] := '{}';
  v_n int;
  v_txt text;
  v_set jsonb;
  v_flag_amount numeric; v_flag_percent numeric;
begin
  select * into v_file from public.cb_files where id = p_file;
  v_bank := v_file.books in ('statements', 'paper');
  v_set := coalesce(v_file.setup, '{}'::jsonb);
  if p_step = 'setup' then
    select count(*) into v_n from unnest(array['realtor', 'owner_paid', 'dividends', 'payroll', 'holdco', 'gst_registered']) k where not (v_set ? k);
    if (v_set ->> 'gst_registered') = 'true' then
      v_n := v_n + (case when v_set ? 'gst_frequency' then 0 else 1 end) + (case when v_set ? 'quick_method' then 0 else 1 end);
    end if;
    if v_n > 0 then v_out := v_out || format('%s setup question%s to answer.', v_n, case when v_n = 1 then '' else 's' end); end if;
    -- Round 16: the acceptance and continuance record is signed with step 1.
    v_out := v_out || private.cb_acceptance_problems(p_file);
  elsif p_step = 'opening' then
    if v_bank then
      v_txt := private.cb_opening_problem(p_file);
      if v_txt is not null then v_out := v_out || v_txt; end if;
    elsif not exists (select 1 from public.cb_imports where file_id = p_file and target = 'this_year') then
      v_out := v_out || 'Import the trial balance: last year''s column comes with it.'::text;
    end if;
  elsif p_step = 'records' then
    if v_bank then
      if not exists (select 1 from public.cb_bank_accounts where file_id = p_file) then
        v_out := v_out || 'Add the bank and card accounts and upload their statements.'::text;
      else
        select count(*) into v_n from (
          select distinct a.id, date_trunc('month', d) from public.cb_bank_accounts a
           cross join generate_series(v_file.year_start::timestamp, v_file.year_end::timestamp, interval '1 day') d
           where a.file_id = p_file and not exists (select 1 from public.cb_bank_statements s where s.account_id = a.id and d::date between s.period_start and s.period_end)) x;
        if v_n > 0 then v_out := v_out || format('%s month%s of statements missing.', v_n, case when v_n = 1 then '' else 's' end); end if;
        select count(*) into v_n from (
          select opening, lag(closing) over (partition by account_id order by period_start) prev from public.cb_bank_statements where file_id = p_file) x
         where prev is not null and opening <> prev;
        if v_n > 0 then v_out := v_out || format('%s statement%s whose opening balance does not follow the one before.', v_n, case when v_n = 1 then '' else 's' end); end if;
        select count(*) into v_n from (
          select a.id, m from public.cb_bank_accounts a
           cross join generate_series(date_trunc('month', v_file.year_start::timestamp), v_file.year_end::timestamp, interval '1 month') m
           where a.file_id = p_file
             and exists (select 1 from public.cb_bank_statements s where s.account_id = a.id and s.period_start <= (m + interval '1 month - 1 day')::date and s.period_end >= m::date)
             and not exists (select 1 from public.cb_bank_lines l where l.file_id = p_file and l.account_id = a.id and date_trunc('month', l.txn_date::timestamp) = m)) x;
        if v_n > 0 then v_out := v_out || format('%s month%s with no transactions: check the statements are complete.', v_n, case when v_n = 1 then '' else 's' end); end if;
      end if;
    else
      if not exists (select 1 from public.cb_imports where file_id = p_file and target = 'this_year') then
        v_out := v_out || 'Import the trial balance.'::text;
      elsif (select coalesce(sum(this_year), 0) from public.cb_accounts where file_id = p_file) <> 0 then
        v_out := v_out || 'The trial balance does not balance: import it again.'::text;
      end if;
    end if;
  elsif p_step = 'code' then
    if v_bank then
      select count(*) into v_n from public.cb_bank_lines where file_id = p_file and status = 'new';
      if v_n > 0 then v_out := v_out || format('%s line%s to code.', v_n, case when v_n = 1 then '' else 's' end); end if;
      select count(*) into v_n from public.cb_bank_lines where file_id = p_file and status = 'ask_client';
      if v_n > 0 then v_out := v_out || format('%s line%s on the client''s question list.', v_n, case when v_n = 1 then '' else 's' end); end if;
    else
      select count(*) into v_n from public.cb_accounts a where a.file_id = p_file and a.line_no is null and not a.needs_reviewer
         and a.account_key not in ('chart:10900', 'opening', 'uncoded') and private.cb_account_used(a.id);
      if v_n > 0 then v_out := v_out || format('%s account%s to match to a GIFI line.', v_n, case when v_n = 1 then '' else 's' end); end if;
    end if;
  elsif p_step = 'entries' then
    select flag_amount, flag_percent into v_flag_amount, v_flag_percent from public.cb_settings limit 1;
    v_flag_amount := coalesce(v_flag_amount, 5000); v_flag_percent := coalesce(v_flag_percent, 20);
    select count(*) into v_n from (
      select a.id, private.cb_account_final(a.id) fin, a.last_year from public.cb_accounts a join public.cb_master_lines m on m.line_no = a.line_no
       where a.file_id = p_file and m.lead_sheet is not null and left(coalesce(a.line_no, ''), 4) not in ('3600', '3660')) x
     where abs(fin - last_year) > v_flag_amount and (last_year = 0 or abs(fin - last_year) / abs(last_year) * 100 > v_flag_percent)
       and not exists (select 1 from public.cb_flag_notes n where n.account_id = x.id);
    if v_n > 0 then v_out := v_out || format('%s flagged change%s to explain on the lead sheets.', v_n, case when v_n = 1 then '' else 's' end); end if;
    -- Round 9: the revenue check, and expenses paid personally when the setup says so.
    v_out := v_out || private.cb_step5_problems(p_file);
  elsif p_step = 'mapping' then
    select count(*) into v_n from public.cb_accounts a where a.file_id = p_file and a.line_no is null and not a.needs_reviewer
       and a.account_key not in ('chart:10900', 'opening', 'uncoded') and private.cb_account_used(a.id);
    if v_n > 0 then v_out := v_out || format('%s account%s with no GIFI line.', v_n, case when v_n = 1 then '' else 's' end); end if;
    if exists (select 1 from public.cb_accounts a where a.file_id = p_file and a.account_key = 'chart:10900' and private.cb_account_final(a.id) <> 0) then
      v_out := v_out || 'Clearing (10900) has a balance: move it to the right account.'::text;
    end if;
  end if;
  -- A review note not yet fixed is open work on its step.
  select count(*) into v_n from public.cb_review_notes where file_id = p_file and step = p_step and status = 'open';
  if v_n > 0 then v_out := v_out || format('%s review note%s to fix.', v_n, case when v_n = 1 then '' else 's' end); end if;
  return v_out;
end;
$function$;

CREATE OR REPLACE FUNCTION private.cb_opening_problem(p_file uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_file public.cb_files;
  v_assets numeric; v_liab numeric; v_equity numeric; v_rev numeric; v_exp numeric; v_re numeric; v_has125 boolean; v_ni numeric;
begin
  select * into v_file from public.cb_files where id = p_file;
  -- Round 16: a first-year company has no opening balances.
  if v_file.first_year then return null; end if;
  if not exists (select 1 from public.cb_opening_balances where file_id = p_file) then return 'Enter last year''s balance sheet first.'; end if;
  if v_file.opening_re_stated is null then return 'Type last year''s 3849 from the T2.'; end if;
  select coalesce(sum(amount) filter (where t = 'Asset'), 0), coalesce(sum(amount) filter (where t = 'Liability'), 0),
         coalesce(sum(amount) filter (where t = 'Equity' and not (code = '3660' or code::int between 3700 and 3848)), 0),
         coalesce(sum(amount) filter (where t = 'Revenue'), 0), coalesce(sum(amount) filter (where t = 'Expense'), 0),
         coalesce(sum(case when code = '3660' or code::int between 3700 and 3848 then amount else 0 end), 0),
         bool_or(t in ('Revenue', 'Expense'))
    into v_assets, v_liab, v_equity, v_rev, v_exp, v_re, v_has125
    from (select code, amount, private.cb_gifi_type(code) t from public.cb_opening_balances where file_id = p_file) x;
  v_ni := case when coalesce(v_has125, false) then v_rev - v_exp else v_file.opening_ni_typed end;
  if v_ni is null then return 'Type last year''s net income (9999), or enter the Schedule 125 tab.'; end if;
  if v_re + v_ni <> v_file.opening_re_stated then return format('3849 (%s) does not equal 3660 + 9999 + the 3700s (%s).', v_file.opening_re_stated, v_re + v_ni); end if;
  if v_liab + v_equity + v_file.opening_re_stated <> v_assets then
    return format('Total liabilities and equity (3640, %s) does not equal total assets (2599, %s).', v_liab + v_equity + v_file.opening_re_stated, v_assets);
  end if;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION private.cb_step9_problems(p_file uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_file public.cb_files; c public.cb_client_fs_fields; f public.cb_file_fs; v_out text[] := '{}'; v_n int; v_out_by numeric; r record; v_bank boolean;
begin
  select * into v_file from public.cb_files where id = p_file;
  select * into c from public.cb_client_fs_fields where client_id = v_file.client_id;
  select * into f from public.cb_file_fs where file_id = p_file;
  v_bank := v_file.books in ('statements', 'paper');
  if not exists (select 1 from public.cb_step_signoffs where file_id = p_file and step = 't2' and prepared_at is not null) then
    v_out := v_out || 'Step 8 must be signed by the preparer first.'::text;
  end if;
  select coalesce(sum(private.cb_account_final(id)), 0) into v_out_by from public.cb_accounts where file_id = p_file;
  select count(*) into v_n from public.cb_accounts a where a.file_id = p_file and private.cb_account_final(a.id) <> 0 and (a.line_no is null or a.needs_reviewer) and a.account_key <> 'chart:10900';
  if v_out_by <> 0 or v_n > 0 then v_out := v_out || 'The trial balance does not balance, or an account is not matched in step 6.'::text; end if;
  -- The fields (Appendix C's intake questions). Each one still empty shows "To fill".
  if coalesce(c.officer_name, '') = '' then v_out := v_out || 'To fill: the signing officer''s name.'::text; end if;
  if coalesce(c.officer_position, '') = '' then v_out := v_out || 'To fill: the signing officer''s position.'::text; end if;
  if coalesce(c.officer_email, '') = '' then v_out := v_out || 'To fill: the signing officer''s email.'::text; end if;
  if f.first_year is null then v_out := v_out || 'To fill: whether this is the corporation''s first year.'::text; end if;
  if f.first_year = false and v_bank and not exists (select 1 from public.cb_opening_s125 where file_id = p_file) then
    v_out := v_out || 'Enter last year''s Schedule 125 in step 2.'::text;
  end if;
  -- A balance due to or from a shareholder needs its terms.
  if coalesce(c.sh_terms, '') = '' and exists (select 1 from public.cb_accounts a join public.cb_master_lines m on m.line_no = a.line_no
      where a.file_id = p_file and m.gifi_code in ('1300', '1301', '1302', '1303', '2180', '2181', '2182', '2183', '2780', '2781', '2782', '2783', '3260', '3261', '3262', '3263') and private.cb_account_final(a.id) <> 0) then
    v_out := v_out || 'To fill: the shareholder loan terms.'::text;
  end if;
  -- Each related-party line with a balance needs the related party's name.
  for r in select distinct m.gifi_code, m.gifi_name from public.cb_accounts a join public.cb_master_lines m on m.line_no = a.line_no
            where a.file_id = p_file and private.cb_account_final(a.id) <> 0 and m.gifi_name ~* 'related (part|corp|canadian|foreign)|affiliat' order by m.gifi_code loop
    if coalesce(c.related ->> r.gifi_code, '') = '' then v_out := v_out || format('To fill: the related party for GIFI %s (%s).', r.gifi_code, r.gifi_name); end if;
  end loop;
  -- Each dividend line with a balance needs its class and dates, for the minute book letter.
  for r in select a.line_no, m.name from public.cb_accounts a join public.cb_master_lines m on m.line_no = a.line_no
            where a.file_id = p_file and m.gifi_code between '3700' and '3719' and private.cb_account_final(a.id) <> 0 group by a.line_no, m.name order by a.line_no loop
    if not exists (select 1 from jsonb_array_elements(coalesce(f.dividends, '[]')) d where d ->> 'line' = r.line_no
        and coalesce(d ->> 'cls', '') <> '' and coalesce(d ->> 'declared', '') <> '' and coalesce(d ->> 'paid', '') <> '') then
      v_out := v_out || format('To fill: the class and dates of the dividends on %s (%s).', replace(r.line_no, '.00', ''), r.name);
    end if;
  end loop;
  select count(*) into v_n from public.cb_review_notes where file_id = p_file and step = 'statements' and status = 'open';
  if v_n > 0 then v_out := v_out || format('%s review note%s to fix.', v_n, case when v_n = 1 then '' else 's' end); end if;
  return v_out;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_save_fs_fields(p_file uuid, p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file public.cb_files; v_old jsonb; v_new jsonb;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(btrim(coalesce(p ->> 'officer_email', '')) = '' or (p ->> 'officer_email') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$', 'The signing officer''s email does not look right.');
  perform private.require(jsonb_typeof(coalesce(p -> 'related', '{}')) = 'object' and jsonb_typeof(coalesce(p -> 'dividends', '[]')) = 'array', 'The fields could not be read.');
  select to_jsonb(c) - 'updated_by' - 'updated_at' - 'client_id' || coalesce((select to_jsonb(f) - 'updated_by' - 'updated_at' - 'file_id' from public.cb_file_fs f where f.file_id = p_file), '{}')
    into v_old from public.cb_client_fs_fields c where c.client_id = v_file.client_id;
  insert into public.cb_client_fs_fields (client_id, officer_name, officer_position, officer_email, sh_terms, related, audit_waiver, updated_by)
  values (v_file.client_id, btrim(coalesce(p ->> 'officer_name', '')), btrim(coalesce(p ->> 'officer_position', '')), lower(btrim(coalesce(p ->> 'officer_email', ''))),
          btrim(coalesce(p ->> 'sh_terms', '')), coalesce(p -> 'related', '{}'), coalesce((p ->> 'audit_waiver')::boolean, true), (select auth.uid()))
  on conflict (client_id) do update set officer_name = excluded.officer_name, officer_position = excluded.officer_position, officer_email = excluded.officer_email,
    sh_terms = excluded.sh_terms, related = excluded.related, audit_waiver = excluded.audit_waiver, updated_by = excluded.updated_by, updated_at = now();
  insert into public.cb_file_fs (file_id, first_year, dividends, updated_by)
  values (p_file, case when v_file.first_year then true else (p ->> 'first_year')::boolean end, coalesce(p -> 'dividends', '[]'), (select auth.uid()))
  on conflict (file_id) do update set first_year = excluded.first_year, dividends = excluded.dividends, updated_by = excluded.updated_by, updated_at = now();
  select to_jsonb(c) - 'updated_by' - 'updated_at' - 'client_id' || coalesce((select to_jsonb(f) - 'updated_by' - 'updated_at' - 'file_id' from public.cb_file_fs f where f.file_id = p_file), '{}')
    into v_new from public.cb_client_fs_fields c where c.client_id = v_file.client_id;
  -- A change to what the package says reopens step 9 (and withdraws a MAL out for signing).
  if v_old is distinct from v_new then perform private.cb_clear_step(p_file, 'statements', 'Step 9 fields changed'); end if;
end;
$function$;


-- First year (round 16): a company with no prior T2 has no opening balances. The preparer chooses it on
-- step 2; the reviewer confirms it by signing step 2. Last year's columns stay empty; the statements
-- drop the prior-year column.
create or replace function public.cb_set_first_year(p_file uuid, p_on boolean) returns void language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  if p_on then
    perform private.require(not exists (select 1 from public.cb_accounts where file_id = p_file and last_year <> 0),
      'This file has last year''s amounts: it is not a first year.');
    perform private.require(not exists (select 1 from public.cb_files where client_id = v_file.client_id and year_end < v_file.year_end),
      'There is an earlier Closebook file for this client: it is not a first year.');
    delete from public.cb_opening_balances where file_id = p_file;
    delete from public.cb_opening_s125 where file_id = p_file;
    update public.cb_files set first_year = true, opening_source = null, opening_re_stated = null, opening_ni_typed = null,
      opening_signed_by = null, opening_signed_at = null, updated_at = now() where id = p_file;
  else
    update public.cb_files set first_year = false, opening_signed_by = null, opening_signed_at = null, updated_at = now() where id = p_file;
  end if;
  insert into public.cb_file_fs (file_id, first_year, updated_by) values (p_file, p_on, (select auth.uid()))
  on conflict (file_id) do update set first_year = excluded.first_year, updated_by = excluded.updated_by, updated_at = now();
  perform private.cb_log(p_file, case when p_on then 'first_year_on' else 'first_year_off' end, 'opening',
    case when p_on then 'First year: no opening balances' else 'Not a first year: enter the opening balances' end);
  perform private.cb_clear_step(p_file, 'opening', case when p_on then 'First year chosen' else 'First year taken back' end);
end;
$$;
revoke all on function public.cb_set_first_year(uuid, boolean) from public, anon;
grant execute on function public.cb_set_first_year(uuid, boolean) to authenticated, service_role;

-- ---------- 3. People (round 16; CaseWare Cloud engagement properties)
create or replace function public.cb_set_people(p_file uuid, p_preparer uuid, p_reviewer uuid) returns void language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files; v_names text;
begin
  perform private.require(private.is_owner(), 'Only an owner changes the preparer and reviewer.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(exists (select 1 from public.staff where id = p_preparer and is_active), 'Choose an active staff member as preparer.');
  perform private.require(exists (select 1 from public.staff s join public.roles r on r.id = s.role_id where s.id = p_reviewer and s.is_active and r.is_owner),
    format('%s is not an owner: only an owner reviews.', coalesce((select full_name from public.staff where id = p_reviewer), 'That person')));
  if v_file.preparer_id = p_preparer and v_file.reviewer_id = p_reviewer then return; end if;
  update public.cb_files set preparer_id = p_preparer, reviewer_id = p_reviewer, updated_at = now() where id = p_file;
  select format('Preparer %s, reviewer %s', (select full_name from public.staff where id = p_preparer), (select full_name from public.staff where id = p_reviewer)) into v_names;
  perform private.cb_log(p_file, 'people_changed', null, v_names);
end;
$$;
revoke all on function public.cb_set_people(uuid, uuid, uuid) from public, anon;
grant execute on function public.cb_set_people(uuid, uuid, uuid) to authenticated, service_role;

-- ---------- 5. Shareholder loans: what the reviewer decided carries forward (round 14's deferred item).
alter table public.cb_sh_groups add column if not exists decided_left numeric(14,2) not null default 0;
alter table public.cb_sh_groups add column if not exists decided_year int;
alter table public.cb_sh_groups add column if not exists decided_why text not null default '';
alter table public.cb_sh_groups add column if not exists decided_repaid numeric(14,2) not null default 0;

CREATE OR REPLACE FUNCTION public.cb_prepare_sh_schedule(p_file uuid, p_rows jsonb, p_groups jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file public.cb_files; x jsonb; f text; v_amt numeric;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(jsonb_typeof(p_rows) = 'array' and jsonb_typeof(p_groups) = 'array', 'The schedule could not be worked out.');
  delete from public.cb_sh_schedules where file_id = p_file;
  for x in select * from jsonb_array_elements(p_rows) loop
    insert into public.cb_sh_schedules (file_id, account_key, number, name, line_no, opening, closing, tb, movements, shareholder, owner_source)
    values (p_file, x ->> 'account_key', coalesce(x ->> 'number', ''), coalesce(x ->> 'name', ''), coalesce(x ->> 'line_no', ''),
      round((x ->> 'opening')::numeric, 2), round((x ->> 'closing')::numeric, 2), round((x ->> 'tb')::numeric, 2), coalesce(x -> 'movements', '[]'),
      nullif(x ->> 'shareholder', '')::smallint, coalesce(x ->> 'owner_source', ''));
    -- A pick rolled forward from the client's last file is kept on this file, so it rolls on.
    if x ->> 'owner_source' = 'rolled' then
      insert into public.cb_sh_owners (file_id, account_key, shareholder, source, picked_by) values (p_file, x ->> 'account_key', (x ->> 'shareholder')::smallint, 'rolled', (select auth.uid()))
      on conflict (file_id, account_key) do nothing;
    end if;
  end loop;
  delete from public.cb_sh_groups where file_id = p_file;
  for x in select * from jsonb_array_elements(p_groups) loop
    perform private.require(case when (x ->> 'this_part')::numeric > 0 then (x ->> 'due_on')::date = (v_file.year_end + interval '1 year')::date else coalesce(x ->> 'due_on', '') = '' end,
      'The s.15(2) date of this year''s part is one year after the year end.');
    perform private.require(round((x ->> 'last_part')::numeric + (x ->> 'this_part')::numeric, 2) = greatest(round((x ->> 'closing')::numeric, 2), 0) or x ->> 'group_key' like 'none:%',
      'Last year''s part and this year''s part add up to the balance owed at year end.');
    insert into public.cb_sh_groups (file_id, group_key, shareholder, accounts, opening, closing, reductions, last_part, this_part, due_on, prior_due_on, prior_opening, prior_repaid, prior_unpaid, flags, decided_left, decided_year, decided_why, decided_repaid)
    values (p_file, x ->> 'group_key', nullif(x ->> 'shareholder', '')::smallint, coalesce(array(select jsonb_array_elements_text(x -> 'accounts')), '{}'),
      round((x ->> 'opening')::numeric, 2), round((x ->> 'closing')::numeric, 2), round(coalesce((x ->> 'reductions')::numeric, 0), 2),
      round((x ->> 'last_part')::numeric, 2), round((x ->> 'this_part')::numeric, 2), nullif(x ->> 'due_on', '')::date,
      nullif(x ->> 'prior_due_on', '')::date, round((x ->> 'prior_opening')::numeric, 2), round((x ->> 'prior_repaid')::numeric, 2), round((x ->> 'prior_unpaid')::numeric, 2),
      coalesce(array(select jsonb_array_elements_text(x -> 'flags')), '{}'),
      round(coalesce((x ->> 'decided_left')::numeric, 0), 2), nullif(x ->> 'decided_year', '')::int, left(coalesce(x ->> 'decided_why', ''), 500), round(coalesce((x ->> 'decided_repaid')::numeric, 0), 2));
    -- Each flag keeps its answer while its amount is the same; a changed amount needs it again.
    for f in select jsonb_array_elements_text(x -> 'flags') loop
      v_amt := round(coalesce((x -> 'flag_amounts' ->> f)::numeric, (x ->> 'closing')::numeric), 2);
      insert into public.cb_sh_flags (file_id, account_key, flag, closing) values (p_file, x ->> 'group_key', f, v_amt)
      on conflict (file_id, account_key, flag) do update set closing = excluded.closing,
        note = case when public.cb_sh_flags.closing = excluded.closing then public.cb_sh_flags.note else '' end,
        noted_by = case when public.cb_sh_flags.closing = excluded.closing then public.cb_sh_flags.noted_by end,
        noted_at = case when public.cb_sh_flags.closing = excluded.closing then public.cb_sh_flags.noted_at end,
        accepted_by = case when public.cb_sh_flags.closing = excluded.closing then public.cb_sh_flags.accepted_by end,
        accepted_at = case when public.cb_sh_flags.closing = excluded.closing then public.cb_sh_flags.accepted_at end,
        accepted_why = case when public.cb_sh_flags.closing = excluded.closing then public.cb_sh_flags.accepted_why else '' end;
    end loop;
  end loop;
  delete from public.cb_sh_flags g where g.file_id = p_file
    and not exists (select 1 from public.cb_sh_groups s where s.file_id = p_file and s.group_key = g.account_key and g.flag = any (s.flags));
  delete from public.cb_sh_repaid r where r.file_id = p_file
    and not exists (select 1 from public.cb_sh_groups s where s.file_id = p_file and s.group_key = r.account_key and s.prior_due_on = r.due_on);
  insert into public.cb_sh_prepared (file_id, fingerprint, prepared_by) values (p_file, private.cb_sh_fingerprint(p_file), (select auth.uid()))
  on conflict (file_id) do update set fingerprint = excluded.fingerprint, prepared_by = excluded.prepared_by, prepared_at = now();
  perform private.cb_log(p_file, 'sh_prepared', 'entries', format('Shareholder loan schedule prepared: %s account%s, %s shareholder%s',
    jsonb_array_length(p_rows), case when jsonb_array_length(p_rows) = 1 then '' else 's' end, jsonb_array_length(p_groups), case when jsonb_array_length(p_groups) = 1 then '' else 's' end));
end;
$function$;


-- Files whose checklist is already open get the new questions Closebook fills (6, 10, 11, 12).
do $$ declare f uuid; begin
  for f in select c.file_id from public.cb_file_close c join public.cb_files x on x.id = c.file_id where c.checklist_opened_at is not null and x.phase <> 'locked' loop
    perform private.cb_open_checklist(f);
  end loop;
end $$;
