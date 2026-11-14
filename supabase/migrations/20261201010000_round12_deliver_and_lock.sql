-- Round 12 B (Hashim, Nov 14, 2026): step 10, "Deliver and lock". Benchmark: CaseWare's completion and
-- lockdown; the client email and documents follow Appendix C. Safe to run twice.

-- The instalment threshold Appendix C's email uses, as a setting (Settings, Closebook, Thresholds).
alter table public.cb_settings add column if not exists instalment_threshold numeric(12, 2) not null default 3000;
alter table public.cb_settings drop constraint if exists cb_settings_instalment_threshold_check;
alter table public.cb_settings add constraint cb_settings_instalment_threshold_check check (instalment_threshold between 0 and 1000000);
create or replace function public.cb_update_instalment_threshold(p_amount numeric) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.is_owner(), 'Only an owner changes thresholds.');
  perform private.require(p_amount is not null and p_amount between 0 and 1000000, 'Instalment threshold: a number from 0 to 1,000,000.');
  update public.cb_settings set instalment_threshold = round(p_amount, 2), updated_at = now(), updated_by = (select auth.uid());
end;
$$;
revoke all on function public.cb_update_instalment_threshold(numeric) from public, anon;
grant execute on function public.cb_update_instalment_threshold(numeric) to authenticated;

-- Step 10's record per file: the email's figures (typed from ProFile), the delivery, the filing record and the lock.
create table if not exists public.cb_file_close (
  file_id             uuid primary key references public.cb_files (id) on delete cascade,
  -- A. Corporate tax: owing (+), refund (-) or nil (0).
  tax_balance         numeric(14, 2),
  tax_due             date,
  filed_on            date,
  noa_issued          boolean,
  noa_penalty         numeric(14, 2) not null default 0 check (noa_penalty >= 0),
  noa_interest        numeric(14, 2) not null default 0 check (noa_interest >= 0),
  -- B. GST/HST, only when a return was filed with this package.
  hst_filed           boolean not null default false,
  hst_balance         numeric(14, 2),
  hst_due             date,
  hst_rt              text not null default 'RT 0001' check (hst_rt ~ '^RT [0-9]{4}$'),
  -- C. Instalments: federal and provincial tax for the year filed and the year before; ProFile's schedule.
  fed_tax             numeric(14, 2),
  prov_tax            numeric(14, 2),
  fed_tax_prior       numeric(14, 2),
  prov_tax_prior      numeric(14, 2),
  instalments         jsonb not null default '[]' check (jsonb_typeof(instalments) = 'array'),
  -- The checklist opens once the MAL is signed; answers saved before are cleared once, the first time.
  checklist_opened_at timestamptz,
  -- Delivery: the documents for TaxDome and the email as sent.
  delivered_at        timestamptz,
  delivered_by        uuid references public.staff (id),
  delivered_path      text,
  delivered_sha256    text,
  delivered_email     jsonb,
  -- Filing record.
  t183_signed_on      date,
  efile_number        text not null default '' check (length(efile_number) <= 40),
  -- Lock.
  locked_at           timestamptz,
  locked_by           uuid references public.staff (id),
  phase_before_lock   text,
  updated_by          uuid references public.staff (id),
  updated_at          timestamptz not null default now()
);
alter table public.cb_file_close enable row level security;
alter table public.cb_file_close force row level security;
drop policy if exists "Closebook viewers read step 10" on public.cb_file_close;
create policy "Closebook viewers read step 10" on public.cb_file_close for select to authenticated using ((select private.can_view('closebook')));
grant select on public.cb_file_close to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- A locked file is read-only everywhere: every table that holds a file's work refuses a change while
-- the file is locked. Only the lock and the reopen themselves (owners) get through, for that moment.
create or replace function private.cb_locked_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_file uuid; v_locked boolean;
begin
  if coalesce(current_setting('cb.unlock', true), '') = 'on' then return coalesce(new, old); end if;
  if tg_table_name = 'cb_files' then
    if old.phase = 'locked' then raise exception 'This file is locked. An owner can reopen it.' using errcode = 'P0001'; end if;
    return coalesce(new, old);
  elsif tg_table_name = 'cb_entry_lines' then
    select e.file_id into v_file from public.cb_entries e where e.id = coalesce(new.entry_id, old.entry_id);
  elsif tg_table_name = 'cb_review_note_replies' then
    select n.file_id into v_file from public.cb_review_notes n where n.id = coalesce(new.note_id, old.note_id);
  else
    v_file := case when tg_op = 'DELETE' then old.file_id else new.file_id end;
    if tg_op = 'UPDATE' and old.file_id is distinct from new.file_id then
      select phase = 'locked' into v_locked from public.cb_files where id = old.file_id;
      if v_locked then raise exception 'This file is locked. An owner can reopen it.' using errcode = 'P0001'; end if;
    end if;
  end if;
  select phase = 'locked' into v_locked from public.cb_files where id = v_file;
  if coalesce(v_locked, false) then raise exception 'This file is locked. An owner can reopen it.' using errcode = 'P0001'; end if;
  return coalesce(new, old);
end;
$$;
revoke all on function private.cb_locked_guard() from public, anon, authenticated;

do $$
declare t text;
begin
  for t in select c.table_name from information_schema.columns c join information_schema.tables x using (table_schema, table_name)
            where c.table_schema = 'public' and c.column_name = 'file_id' and x.table_type = 'BASE TABLE' and c.table_name like 'cb\_%'
              and c.table_name <> 'cb_file_history'
           union select unnest(array['cb_entry_lines', 'cb_review_note_replies'])
  loop
    execute format('drop trigger if exists cb_locked_guard on public.%I', t);
    execute format('create trigger cb_locked_guard before insert or update or delete on public.%I for each row execute function private.cb_locked_guard()', t);
  end loop;
  -- The file row itself: a locked file cannot be changed or deleted (the lock and the reopen excepted).
  drop trigger if exists cb_locked_guard on public.cb_files;
  create trigger cb_locked_guard before update or delete on public.cb_files for each row execute function private.cb_locked_guard();
end $$;

-- ---------------------------------------------------------------------------------------------------
-- The checklist (round 8b), now on step 10: open only once the MAL is signed; questions 10 and 11 are
-- filled by Closebook from the signing record and cannot be changed by hand.
create or replace function private.cb_mal_signed_row(p_file uuid) returns record
language sql stable security definer set search_path = '' as $$
  select s.signed_at, s.signed_name, s.signed_title from public.cb_file_fs f
    join public.quotes q on q.id = f.mal_quote_id and q.status = 'signed'
    join public.quote_signers s on s.quote_id = q.id and s.signed_at is not null
   where f.file_id = p_file order by s.person limit 1
$$;

-- The MAL is signed: the checklist opens (answers saved before are cleared once, the first time), and
-- questions 10 and 11 are answered from the signing record.
create or replace function private.cb_open_checklist(p_file uuid) returns void
language plpgsql security definer set search_path = '' as $$
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
      when 10 then format('Filled by Closebook from the signing record: the MAL was signed by %s, %s, on %s.', s.signed_name, coalesce(s.signed_title, ''), v_day)
      else format('Filled by Closebook: the report is dated %s, the day the MAL was signed.', v_day) end, null
    from public.cb_checklist_questions q where q.sort_order in (10, 11)
  on conflict (file_id, question) do update set answer = excluded.answer, note = excluded.note, answered_by = null, answered_at = now();
end;
$$;
revoke all on function private.cb_open_checklist(uuid) from public, anon, authenticated;

-- When the officer signs the MAL (the signing engine sets the quote to signed), the checklist opens.
create or replace function private.cb_mal_quote_signed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'signed' and old.status is distinct from 'signed' and new.kind = 'letter' and new.details ->> 'doc_kind' = 'cb_mal'
     and (new.details ->> 'file_id') ~ '^[0-9a-f-]{36}$' then
    perform private.cb_open_checklist((new.details ->> 'file_id')::uuid);
  end if;
  return new;
end;
$$;
revoke all on function private.cb_mal_quote_signed() from public, anon, authenticated;
drop trigger if exists cb_mal_quote_signed on public.quotes;
create trigger cb_mal_quote_signed after update of status on public.quotes for each row execute function private.cb_mal_quote_signed();

-- MALs signed before this change: open their checklists now (once).
do $$ declare f uuid;
begin
  for f in select fs.file_id from public.cb_file_fs fs join public.quotes q on q.id = fs.mal_quote_id and q.status = 'signed'
             join public.cb_files x on x.id = fs.file_id and x.phase <> 'locked' loop
    perform private.cb_open_checklist(f);
  end loop;
end $$;

create or replace function private.cb_checklist_problems(p_file uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v_out text[] := '{}'; v_n int; v_must text; s record;
begin
  select * into s from private.cb_mal_signed_row(p_file) as (signed_at timestamptz, signed_name text, signed_title text);
  if s.signed_at is null then return array['The checklist opens once the MAL is signed (step 9).']; end if;
  select count(*) into v_n from public.cb_checklist_questions q
   where not exists (select 1 from public.cb_checklist_answers a where a.file_id = p_file and a.question = q.key);
  if v_n > 0 then v_out := v_out || format('%s checklist question%s to answer.', v_n, case when v_n = 1 then '' else 's' end); end if;
  select string_agg(q.sort_order::text, ', ' order by q.sort_order) into v_must from public.cb_checklist_questions q
    join public.cb_checklist_answers a on a.file_id = p_file and a.question = q.key
   where q.sort_order in (1, 10, 11) and a.answer <> 'yes';
  if v_must is not null then v_out := v_out || format('Question%s %s must be Yes.', case when position(',' in v_must) > 0 then 's' else '' end, v_must); end if;
  select count(*) into v_n from public.cb_review_notes where file_id = p_file and status = 'open';
  if v_n > 0 then v_out := v_out || format('%s open review note%s on the file.', v_n, case when v_n = 1 then '' else 's' end); end if;
  return v_out;
end;
$$;
revoke all on function private.cb_checklist_problems(uuid) from public, anon, authenticated;

create or replace function public.cb_save_checklist(p_file uuid, p_answers jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files; v jsonb; v_order int; v_changed int := 0; s record;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  select * into s from private.cb_mal_signed_row(p_file) as (signed_at timestamptz, signed_name text, signed_title text);
  perform private.require(s.signed_at is not null, 'The checklist opens once the MAL is signed (step 9).');
  perform private.require(jsonb_typeof(p_answers) = 'array', 'Answers are missing.');
  for v in select * from jsonb_array_elements(p_answers) loop
    select sort_order into v_order from public.cb_checklist_questions where key = v ->> 'question';
    perform private.require(v_order is not null, 'Unknown checklist question.');
    continue when v_order in (10, 11);   -- filled by Closebook from the signing record
    perform private.require(v ->> 'answer' in ('yes', 'no', 'na'), 'Answer Yes, No or Not applicable.');
    perform private.require(v ->> 'answer' <> 'na' or v_order in (8, 9), format('Question %s cannot be Not applicable: only questions 8 and 9 can.', v_order));
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
$$;

-- A MAL taken back (the package changed): questions 10 and 11 empty again, and a delivery made on it is
-- no longer the file's delivery (the history keeps it).
create or replace function private.cb_withdraw_mal(p_file uuid, p_why text) returns void
language plpgsql security definer set search_path = '' as $$
declare f public.cb_file_fs;
begin
  delete from public.cb_checklist_answers a using public.cb_checklist_questions q where a.file_id = p_file and a.question = q.key and q.sort_order in (10, 11);
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
$$;
revoke all on function private.cb_withdraw_mal(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Step 10's fields (the email's figures). A change after step 10 is signed reopens it.
create or replace function public.cb_save_close_fields(p_file uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files; v_old jsonb; v_new jsonb; x jsonb; c public.cb_file_close;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  select * into c from public.cb_file_close where file_id = p_file;
  perform private.require(c.delivered_at is null, 'The email was sent: its figures are kept as sent.');
  perform private.require(jsonb_typeof(coalesce(p -> 'instalments', '[]')) = 'array', 'The instalments could not be read.');
  for x in select * from jsonb_array_elements(coalesce(p -> 'instalments', '[]')) loop
    perform private.require(coalesce(x ->> 'date', '') ~ '^\d{4}-\d{2}-\d{2}$' and coalesce((x ->> 'amount')::numeric, 0) > 0, 'Each instalment needs a due date and an amount.');
  end loop;
  perform private.require(coalesce(p ->> 'hst_rt', 'RT 0001') ~ '^RT [0-9]{4}$', 'The GST/HST account is written RT and four digits, for example RT 0001.');
  insert into public.cb_file_close (file_id) values (p_file) on conflict (file_id) do nothing;
  select to_jsonb(cl) - 'updated_by' - 'updated_at' into v_old from public.cb_file_close cl where file_id = p_file;
  update public.cb_file_close set
    tax_balance = (p ->> 'tax_balance')::numeric, tax_due = nullif(p ->> 'tax_due', '')::date, filed_on = nullif(p ->> 'filed_on', '')::date,
    noa_issued = (p ->> 'noa_issued')::boolean, noa_penalty = coalesce((p ->> 'noa_penalty')::numeric, 0), noa_interest = coalesce((p ->> 'noa_interest')::numeric, 0),
    hst_filed = coalesce((p ->> 'hst_filed')::boolean, false), hst_balance = (p ->> 'hst_balance')::numeric, hst_due = nullif(p ->> 'hst_due', '')::date,
    hst_rt = coalesce(nullif(p ->> 'hst_rt', ''), 'RT 0001'),
    fed_tax = (p ->> 'fed_tax')::numeric, prov_tax = (p ->> 'prov_tax')::numeric, fed_tax_prior = (p ->> 'fed_tax_prior')::numeric, prov_tax_prior = (p ->> 'prov_tax_prior')::numeric,
    instalments = coalesce(p -> 'instalments', '[]'), updated_by = (select auth.uid()), updated_at = now()
   where file_id = p_file;
  select to_jsonb(cl) - 'updated_by' - 'updated_at' into v_new from public.cb_file_close cl where file_id = p_file;
  if v_old is distinct from v_new then
    perform private.cb_log(p_file, 'close_fields_saved', 'lock', '');
    perform private.cb_clear_step(p_file, 'lock', 'Step 10 fields changed');
  end if;
end;
$$;

-- The filing record: T183CORP signed date (the signing stays in TaxDome or Adobe) and the EFILE number.
create or replace function public.cb_save_filing_record(p_file uuid, p_t183 date, p_efile text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(p_t183 is null or p_t183 <= (now() at time zone 'America/Toronto')::date, 'The T183CORP signed date cannot be in the future.');
  perform private.require(coalesce(btrim(p_efile), '') = '' or btrim(p_efile) ~ '^[A-Za-z0-9-]{4,40}$', 'The EFILE confirmation number is letters and digits, as ProFile shows it.');
  insert into public.cb_file_close (file_id) values (p_file) on conflict (file_id) do nothing;
  update public.cb_file_close set t183_signed_on = p_t183, efile_number = upper(coalesce(btrim(p_efile), '')), updated_by = (select auth.uid()), updated_at = now() where file_id = p_file;
  perform private.cb_log(p_file, 'filing_recorded', 'lock', format('T183CORP signed %s; EFILE %s', coalesce(p_t183::text, 'not yet'), coalesce(nullif(upper(btrim(p_efile)), ''), 'not yet')));
end;
$$;

-- What step 10 still needs before the preparer signs: the MAL signed, the checklist complete, the email's figures.
create or replace function private.cb_step10_problems(p_file uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v_out text[] := '{}'; c public.cb_file_close; s record;
begin
  select * into s from private.cb_mal_signed_row(p_file) as (signed_at timestamptz, signed_name text, signed_title text);
  if s.signed_at is null then return array['The MAL is not signed yet (step 9).']; end if;
  v_out := private.cb_checklist_problems(p_file);
  select * into c from public.cb_file_close where file_id = p_file;
  if c.tax_balance is null then v_out := v_out || 'To fill: the corporate tax balance owing or refund (A).'::text; end if;
  if c.tax_due is null then v_out := v_out || 'To fill: the corporate tax due date (A).'::text; end if;
  if c.filed_on is null then v_out := v_out || 'To fill: the date the T2 was filed (A).'::text; end if;
  if c.noa_issued is null then v_out := v_out || 'To fill: whether the Notice of Assessment is issued (A).'::text; end if;
  if coalesce(c.hst_filed, false) and c.hst_balance is null then v_out := v_out || 'To fill: the GST/HST balance owing or refund (B).'::text; end if;
  if coalesce(c.hst_filed, false) and c.hst_due is null then v_out := v_out || 'To fill: the GST/HST due date (B).'::text; end if;
  if c.fed_tax is null or c.prov_tax is null then v_out := v_out || 'To fill: federal and provincial tax for the year filed (C).'::text; end if;
  return v_out;
end;
$$;
revoke all on function private.cb_step10_problems(uuid) from public, anon, authenticated;

-- Delivery: the documents for TaxDome (stored, as delivered) and the email as sent. After the reviewer
-- signs step 10 (the email is final), the preparer ticks "Uploaded to TaxDome and email sent".
create or replace function public.cb_record_delivery(p_file uuid, p_path text, p_sha256 text, p_email jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files; c public.cb_file_close;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(exists (select 1 from public.cb_step_signoffs where file_id = p_file and step = 'lock' and reviewed_at is not null),
    'The reviewer signs step 10 first: until then the email is a draft.');
  select * into c from public.cb_file_close where file_id = p_file;
  perform private.require(c.delivered_at is null, 'The documents are already recorded as delivered.');
  perform private.require(coalesce(p_path, '') like 'closebook/' || p_file::text || '/delivered/%' and coalesce(p_sha256, '') ~ '^[0-9a-f]{64}$', 'The documents could not be stored.');
  perform private.require(jsonb_typeof(p_email) = 'object' and length(coalesce(p_email ->> 'subject', '')) > 0, 'The email could not be kept.');
  update public.cb_file_close set delivered_at = now(), delivered_by = (select auth.uid()), delivered_path = p_path, delivered_sha256 = p_sha256, delivered_email = p_email,
    updated_by = (select auth.uid()), updated_at = now() where file_id = p_file;
  perform private.cb_log(p_file, 'delivered', 'lock', 'Uploaded to TaxDome and email sent');
end;
$$;

-- What stops the lock, each item named.
create or replace function private.cb_lock_problems(p_file uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v_out text[] := '{}'; v_file public.cb_files; c public.cb_file_close; s record; st record; v_bank boolean;
begin
  select * into v_file from public.cb_files where id = p_file;
  v_bank := v_file.books in ('statements', 'paper');
  for st in select * from (values (1, 'setup', 'Set up the file'), (2, 'opening', 'Opening balances'),
                                  (3, 'records', case when v_bank then 'Bank statements' else 'Get the records' end),
                                  (4, 'code', case when v_bank then 'Code the transactions' else 'Match accounts to GIFI' end),
                                  (5, 'entries', 'Adjusting entries'), (6, 'review', 'Review'), (7, 'mapping', 'GIFI mapping'),
                                  (8, 't2', 'T2 tie-out'), (9, 'statements', 'Statements')) as x(n, k, name) order by n loop
    if not exists (select 1 from public.cb_step_signoffs where file_id = p_file and step = st.k and reviewed_at is not null) then
      v_out := v_out || format('Step %s, %s: not signed by the reviewer.', st.n, st.name);
    end if;
  end loop;
  select * into s from private.cb_mal_signed_row(p_file) as (signed_at timestamptz, signed_name text, signed_title text);
  if s.signed_at is null then v_out := v_out || 'The MAL is not signed.'::text;
  else v_out := v_out || (select coalesce(array_agg('Checklist: ' || x), '{}') from unnest(private.cb_checklist_problems(p_file)) x); end if;
  if not exists (select 1 from public.cb_step_signoffs where file_id = p_file and step = 'lock' and reviewed_at is not null) then
    v_out := v_out || 'Step 10: not signed by the reviewer (the email is still a draft).'::text;
  end if;
  select * into c from public.cb_file_close where file_id = p_file;
  if c.delivered_at is null then v_out := v_out || 'The documents are not delivered: tick "Uploaded to TaxDome and email sent".'::text; end if;
  if coalesce(c.efile_number, '') = '' then v_out := v_out || 'The EFILE confirmation number is not recorded.'::text; end if;
  return v_out;
end;
$$;
revoke all on function private.cb_lock_problems(uuid) from public, anon, authenticated;

create or replace function public.cb_lock_file(p_file uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files; v_list text[];
begin
  perform private.require(private.is_owner(), 'Only an owner locks a file.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null, 'This file is missing.');
  perform private.require(v_file.phase <> 'locked', 'This file is already locked.');
  v_list := private.cb_lock_problems(p_file);
  perform private.require(cardinality(v_list) = 0, 'The file cannot be locked yet: ' || array_to_string(v_list, ' '));
  update public.cb_file_close set locked_at = now(), locked_by = (select auth.uid()), phase_before_lock = v_file.phase where file_id = p_file;
  perform private.cb_log(p_file, 'locked', 'lock', 'File locked: read-only, its documents kept as delivered');
  update public.cb_files set phase = 'locked', updated_at = now() where id = p_file;
end;
$$;

-- Reopen: owners only, with a reason. The file goes back to its last unsigned step (step 10's sign-off
-- is cleared); the delivery and the filing record stay as history until the package changes.
create or replace function public.cb_reopen_file(p_file uuid, p_why text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files; c public.cb_file_close;
begin
  perform private.require(private.is_owner(), 'Only an owner reopens a locked file.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase = 'locked', 'This file is not locked.');
  perform private.require(length(btrim(coalesce(p_why, ''))) >= 5, 'Say why the file is reopened.');
  select * into c from public.cb_file_close where file_id = p_file;
  perform set_config('cb.unlock', 'on', true);
  update public.cb_files set phase = coalesce(c.phase_before_lock, 'conclusion'), updated_at = now() where id = p_file;
  update public.cb_file_close set locked_at = null, locked_by = null, phase_before_lock = null where file_id = p_file;
  perform set_config('cb.unlock', 'off', true);
  perform private.cb_log(p_file, 'reopened', 'lock', btrim(p_why));
  perform private.cb_clear_step(p_file, 'lock', 'File reopened: ' || btrim(p_why));
end;
$$;

revoke all on function public.cb_save_close_fields(uuid, jsonb), public.cb_save_filing_record(uuid, date, text), public.cb_record_delivery(uuid, text, text, jsonb),
  public.cb_lock_file(uuid), public.cb_reopen_file(uuid, text) from public, anon;
grant execute on function public.cb_save_close_fields(uuid, jsonb), public.cb_save_filing_record(uuid, date, text), public.cb_record_delivery(uuid, text, text, jsonb),
  public.cb_lock_file(uuid), public.cb_reopen_file(uuid, text) to authenticated;

-- Step 10's state for the screen.
create or replace function public.cb_close_status(p_file uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s record;
begin
  perform private.require(private.can_view('closebook'), 'You need Closebook access.');
  select * into s from private.cb_mal_signed_row(p_file) as (signed_at timestamptz, signed_name text, signed_title text);
  return jsonb_build_object('mal_signed_at', s.signed_at, 'mal_signed_name', s.signed_name, 'mal_signed_title', s.signed_title,
    'step10', to_jsonb(private.cb_step10_problems(p_file)), 'lock', to_jsonb(private.cb_lock_problems(p_file)));
end;
$$;
revoke all on function public.cb_close_status(uuid) from public, anon;
grant execute on function public.cb_close_status(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Sign-offs: step 10 gets its own, on step 10's rules. Its problems come from cb_step10_problems.
create or replace function public.cb_sign_step(p_file uuid, p_step text, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files; r public.cb_step_signoffs; v_list text[];
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(p_step in ('setup', 'opening', 'records', 'code', 'entries', 'review', 'mapping', 't2', 'statements', 'lock'), 'Unknown step.');
  perform private.require(p_role in ('prepared', 'reviewed'), 'Unknown sign-off.');
  select * into r from public.cb_step_signoffs where file_id = p_file and step = p_step;
  if p_role = 'prepared' then
    perform private.require(p_step <> 'review', 'Step 6 is the reviewer''s: it has no preparer sign-off.');
    perform private.require(r.prepared_at is null, 'This step is already signed as prepared.');
    v_list := case when p_step = 't2' then private.cb_step8_problems(p_file) when p_step = 'statements' then private.cb_step9_problems(p_file)
      when p_step = 'lock' then private.cb_step10_problems(p_file) else private.cb_prepare_blockers(p_file, p_step) end;
    perform private.require(cardinality(v_list) = 0, 'Not yet: ' || array_to_string(v_list, ' '));
    if p_step = 'opening' and v_file.books in ('statements', 'paper') then
      perform public.cb_sign_opening(p_file);
      return;
    end if;
    insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at) values (p_file, p_step, (select auth.uid()), now())
    on conflict (file_id, step) do update set prepared_by = excluded.prepared_by, prepared_at = excluded.prepared_at;
    perform private.cb_log(p_file, 'prepared', p_step, '');
  else
    perform private.require(private.is_owner(), 'Only the reviewer signs as reviewer. Reviewers are owners.');
    perform private.require(r.reviewed_at is null, 'This step is already reviewed.');
    if p_step = 'review' then
      v_list := private.cb_review_problems(p_file);
      perform private.require(cardinality(v_list) = 0, 'Not yet: ' || array_to_string(v_list, ' '));
      insert into public.cb_step_signoffs (file_id, step, reviewed_by, reviewed_at) values (p_file, 'review', (select auth.uid()), now())
      on conflict (file_id, step) do update set reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at;
    else
      perform private.require(r.prepared_at is not null, 'The preparer signs first.');
      v_list := case when p_step = 't2' then coalesce((select array_agg(x) from unnest(private.cb_step8_problems(p_file)) x where x not like '%review note%'), '{}')
        when p_step = 'statements' then coalesce((select array_agg(x) from unnest(private.cb_step9_problems(p_file)) x where x not like '%review note%'), '{}')
        when p_step = 'lock' then coalesce((select array_agg(x) from unnest(private.cb_step10_problems(p_file)) x where x not like '%review note%'), '{}')
        else private.cb_step_waiting(p_file, p_step)
          || coalesce((select array_agg(x) from unnest(private.cb_step_problems(p_file, p_step)) x where x not like '%review note%'), '{}') end;
      perform private.require(cardinality(v_list) = 0, 'Not yet: ' || array_to_string(v_list, ' '));
      update public.cb_step_signoffs set reviewed_by = (select auth.uid()), reviewed_at = now() where file_id = p_file and step = p_step;
    end if;
    perform private.cb_log(p_file, 'reviewed', p_step, case when r.prepared_by = (select auth.uid()) then 'Prepared and reviewed by the same person' else '' end);
  end if;
  update public.cb_files set updated_at = now() where id = p_file;
end;
$$;

create or replace function public.cb_step_status(p_file uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb := '{}'::jsonb; s text; r public.cb_step_signoffs;
begin
  perform private.require(private.can_view('closebook'), 'You need Closebook access.');
  foreach s in array array['setup', 'opening', 'records', 'code', 'entries', 'review', 'mapping', 't2', 'statements', 'lock'] loop
    select * into r from public.cb_step_signoffs where file_id = p_file and step = s;
    v := v || jsonb_build_object(s, jsonb_build_object(
      'prepared_by', r.prepared_by, 'prepared_at', r.prepared_at, 'reviewed_by', r.reviewed_by, 'reviewed_at', r.reviewed_at,
      'problems', to_jsonb(case when s = 'review' then private.cb_review_problems(p_file) when s = 't2' then private.cb_step8_problems(p_file)
        when s = 'statements' then private.cb_step9_problems(p_file) when s = 'lock' then private.cb_step10_problems(p_file) else private.cb_step_problems(p_file, s) end),
      'waiting', to_jsonb(case when s in ('review', 't2', 'statements', 'lock') then '{}'::text[] else private.cb_step_waiting(p_file, s) end),
      'notes', (select count(*) from public.cb_review_notes n where n.file_id = p_file and n.step = s and n.status <> 'cleared')));
  end loop;
  return v || jsonb_build_object('checklist', to_jsonb(private.cb_checklist_problems(p_file)));
end;
$$;

create or replace function private.cb_clear_step(p_file uuid, p_step text, p_why text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.cb_step_signoffs;
begin
  if not exists (select 1 from public.cb_files where id = p_file) then return; end if;
  delete from public.cb_step_signoffs where file_id = p_file and step = p_step returning * into r;
  if r.file_id is not null then
    perform private.cb_log(p_file, 'signoff_cleared', p_step, p_why);
    if p_step = 'opening' then
      update public.cb_files set opening_signed_by = null, opening_signed_at = null where id = p_file and opening_signed_at is not null;
    end if;
  end if;
  if p_step not in ('review', 't2', 'statements', 'lock') then
    perform private.cb_clear_step(p_file, 'review', 'A step it rests on changed');
  end if;
  if p_step in ('opening', 'records', 'code', 'entries', 'mapping') then
    perform private.cb_clear_step(p_file, 't2', 'The trial balance changed after the final export');
  end if;
  if p_step = 't2' then
    perform private.cb_clear_step(p_file, 'statements', 'The trial balance or step 8 changed');
  end if;
  -- Step 10 rests on the package (round 12): a reopened step 9 reopens it, and takes back the MAL.
  if p_step = 'statements' then
    perform private.cb_clear_step(p_file, 'lock', 'Step 9 reopened');
    perform private.cb_withdraw_mal(p_file, coalesce(nullif(p_why, ''), 'Step 9 changed'));
  end if;
end;
$$;
revoke all on function private.cb_clear_step(uuid, text, text) from public, anon, authenticated;

-- Step 9: the director lines (1303, 2183, 2783, 3263) are shareholder balances too and need the terms.
create or replace function private.cb_step9_problems(p_file uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
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
  if v_out_by <> 0 or v_n > 0 then v_out := v_out || 'The trial balance does not balance, or an account is not matched in step 7.'::text; end if;
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
$$;
