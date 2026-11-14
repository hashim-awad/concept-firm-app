-- Round 11 (Hashim, Nov 27, 2026): step 9, Statements, part 1: the year-end package.
-- Benchmark: the firm's year-end package (Appendix C, docs/phase3/Year-end-package-standard.zip),
-- reproduced in the app: cover, CSRS 4200 compilation engagement report, balance sheet, statement of
-- earnings and retained earnings, notes, the Management Responsibility Acknowledgement (MAL) and the
-- minute book letter. Figures come from the final trial balance through the step 7 matches; last
-- year's column from step 2.
--   1. Step 9 fields (Appendix C's intake questions): kept per client where they repeat (signing
--      officer, shareholder loan terms, related party names, audit waiver) and per file where they do
--      not (first year, dividends).
--   2. Last year's Schedule 125, entered in step 2 on a bank-statement file.
--   3. Step 9's rules and sign-offs: a field still empty blocks the preparer.
--   4. The MAL, sent for signing through Studio's signing engine after the reviewer signs step 9, and
--      withdrawn when step 9 reopens (any change to the trial balance or to step 8 reopens it).
-- Safe to run twice (round 4d rule).

create table if not exists public.cb_client_fs_fields (
  client_id         uuid primary key references public.clients (id) on delete cascade,
  officer_name      text not null default '' check (length(officer_name) <= 120),
  officer_position  text not null default '' check (length(officer_position) <= 120),
  officer_email     text not null default '' check (length(officer_email) <= 200),
  sh_terms          text not null default '' check (length(sh_terms) <= 1000),
  related           jsonb not null default '{}',   -- {"2860": "ABC Holdings Inc."}: the related party on each GIFI code
  audit_waiver      boolean not null default true,
  updated_by        uuid references public.staff (id),
  updated_at        timestamptz not null default now()
);

create table if not exists public.cb_file_fs (
  file_id             uuid primary key references public.cb_files (id) on delete cascade,
  first_year          boolean,
  -- [{"line": "3701.10", "cls": "Class A common", "declared": "2026-12-15", "paid": "2026-12-20"}];
  -- the amount and eligibility come from the trial balance (3701.10 non-eligible, 3701.20 eligible).
  dividends           jsonb not null default '[]',
  mal_quote_id        uuid references public.quotes (id) on delete set null,
  mal_sent_at         timestamptz,
  mal_sent_by         uuid references public.staff (id),
  mal_withdrawn_at    timestamptz,
  mal_withdrawn_quote uuid references public.quotes (id) on delete set null,
  mal_withdrawn_why   text not null default '',
  updated_by          uuid references public.staff (id),
  updated_at          timestamptz not null default now()
);

create table if not exists public.cb_opening_s125 (
  file_id  uuid not null references public.cb_files (id) on delete cascade,
  code     text not null check (code ~ '^\d{4}$'),
  amount   numeric(14, 2) not null,
  primary key (file_id, code)
);

do $$
declare t text;
begin
  foreach t in array array['cb_client_fs_fields', 'cb_file_fs', 'cb_opening_s125'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists "Closebook viewers read %s" on public.%I', t, t);
    execute format('create policy "Closebook viewers read %s" on public.%I for select to authenticated using ((select private.can_view(''closebook'')))', t, t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- A MAL withdrawn from signing (step 9 reopened) shows as withdrawn on its signing page.
alter table public.quotes drop constraint if exists quotes_status_check;
alter table public.quotes add constraint quotes_status_check check (status in ('draft', 'sent', 'viewed', 'signed', 'declined', 'expired', 'withdrawn'));

-- Last year's Schedule 125 (bank-statement files): one amount per GIFI code, as on last year's T2.
create or replace function public.cb_save_opening_s125(p_file uuid, p_lines jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files; x jsonb;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(jsonb_typeof(p_lines) = 'array', 'Nothing to save.');
  for x in select * from jsonb_array_elements(p_lines) loop
    perform private.require(exists (select 1 from public.cb_master_lines where gifi_code = x ->> 'code' and line_type in ('Revenue', 'Expense')),
      format('GIFI %s is not a Schedule 125 line.', coalesce(x ->> 'code', '')));
  end loop;
  delete from public.cb_opening_s125 where file_id = p_file;
  insert into public.cb_opening_s125 (file_id, code, amount)
  select p_file, e ->> 'code', round((e ->> 'amount')::numeric, 2) from jsonb_array_elements(p_lines) e where coalesce((e ->> 'amount')::numeric, 0) <> 0
  on conflict (file_id, code) do update set amount = excluded.amount;
  perform private.cb_clear_step(p_file, 'statements', 'Last year''s Schedule 125 changed');
end;
$$;

-- Step 9 fields. p: {"officer_name", "officer_position", "officer_email", "sh_terms", "related": {...},
-- "audit_waiver", "first_year", "dividends": [...]}.
create or replace function public.cb_save_fs_fields(p_file uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
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
  values (p_file, (p ->> 'first_year')::boolean, coalesce(p -> 'dividends', '[]'), (select auth.uid()))
  on conflict (file_id) do update set first_year = excluded.first_year, dividends = excluded.dividends, updated_by = excluded.updated_by, updated_at = now();
  select to_jsonb(c) - 'updated_by' - 'updated_at' - 'client_id' || coalesce((select to_jsonb(f) - 'updated_by' - 'updated_at' - 'file_id' from public.cb_file_fs f where f.file_id = p_file), '{}')
    into v_new from public.cb_client_fs_fields c where c.client_id = v_file.client_id;
  -- A change to what the package says reopens step 9 (and withdraws a MAL out for signing).
  if v_old is distinct from v_new then perform private.cb_clear_step(p_file, 'statements', 'Step 9 fields changed'); end if;
end;
$$;

-- What step 9 still needs before the preparer signs. The package's own tie-outs run in the app
-- (src/lib/closebook/fs-model.ts) and stop the package by name; here the database checks again that
-- the trial balance balances and every account is matched, as the final export does.
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
      where a.file_id = p_file and m.gifi_code in ('1300', '1301', '1302', '2180', '2181', '2182', '2780', '2781', '2782', '3260', '3261', '3262') and private.cb_account_final(a.id) <> 0) then
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

-- Withdraw a MAL out for signing (step 9 reopened). A signed MAL stays signed on its own record, but the
-- package no longer rests on it.
create or replace function private.cb_withdraw_mal(p_file uuid, p_why text) returns void
language plpgsql security definer set search_path = '' as $$
declare f public.cb_file_fs;
begin
  select * into f from public.cb_file_fs where file_id = p_file;
  if f.mal_quote_id is null then return; end if;
  update public.quotes set status = 'withdrawn' where id = f.mal_quote_id and status in ('sent', 'viewed');
  update public.cb_file_fs set mal_withdrawn_quote = mal_quote_id, mal_quote_id = null, mal_sent_at = null, mal_sent_by = null, mal_withdrawn_at = now(),
    mal_withdrawn_why = left(coalesce(p_why, ''), 300) where file_id = p_file;
  perform private.cb_log(p_file, 'mal_withdrawn', 'statements', coalesce(p_why, ''));
end;
$$;

-- Send the MAL for signing, through the quotes signing engine: a letter whose document is the MAL as
-- built for this file (p_html), signed by the signing officer. Only after the reviewer signs step 9.
drop function if exists public.cb_send_mal(uuid, text, text, jsonb);
create or replace function public.cb_send_mal(p_file uuid, p_title text, p_html text, p_pdf jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files; c public.cb_client_fs_fields; v_staff public.staff; v_id uuid; v_first text; v_last text; v_client public.clients;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(exists (select 1 from public.cb_step_signoffs where file_id = p_file and step = 'statements' and reviewed_at is not null),
    'The reviewer signs step 9 first. Nothing goes to the client before that.');
  perform private.require(not exists (select 1 from public.cb_file_fs where file_id = p_file and mal_quote_id is not null), 'The MAL is already out for signing.');
  -- Management cannot confirm statements for a year that has not ended: the MAL goes out from the day
  -- after the year end (Hashim, Nov 14, 2026).
  perform private.require((now() at time zone 'America/Toronto')::date > v_file.year_end,
    format('The MAL can be sent from %s, the day after the year end.', trim(to_char(v_file.year_end + 1, 'FMMonth FMDD, YYYY'))));
  select * into c from public.cb_client_fs_fields where client_id = v_file.client_id;
  perform private.require(coalesce(c.officer_email, '') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$', 'Add the signing officer''s email in step 9.');
  perform private.require(length(coalesce(p_html, '')) > 100 and jsonb_typeof(p_pdf) = 'array', 'The MAL could not be built.');
  select * into v_client from public.clients where id = v_file.client_id;
  v_first := split_part(btrim(c.officer_name), ' ', 1);
  v_last := nullif(btrim(substr(btrim(c.officer_name), length(v_first) + 1)), '');
  select * into v_staff from public.staff where id = (select auth.uid());
  insert into public.quotes (kind, status, title, client_id, company_name, details, sent_at, sent_by, valid_until, sender, signer, wording, created_by)
  values ('letter', 'sent', left(coalesce(p_title, 'Management Responsibility Acknowledgement'), 200), v_file.client_id, v_client.legal_name,
          jsonb_build_object('doc_kind', 'cb_mal', 'file_id', p_file, 'html', p_html, 'pdf', p_pdf, 'position', c.officer_position),
          now(), v_staff.id, (now() at time zone 'America/Toronto')::date + 30,
          jsonb_build_object('name', v_staff.full_name, 'phone', v_staff.phone, 'email', v_staff.email), '{}'::jsonb, '{}'::jsonb, v_staff.id)
  returning id into v_id;
  insert into public.quote_signers (quote_id, person, first_name, last_name, email, token)
  values (v_id, 0, v_first, coalesce(v_last, v_first), c.officer_email, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));
  insert into public.cb_file_fs (file_id, mal_quote_id, mal_sent_at, mal_sent_by) values (p_file, v_id, now(), v_staff.id)
  on conflict (file_id) do update set mal_quote_id = excluded.mal_quote_id, mal_sent_at = excluded.mal_sent_at, mal_sent_by = excluded.mal_sent_by;
  perform private.cb_log(p_file, 'mal_sent', 'statements', format('MAL sent for signing to %s', c.officer_name));
  return v_id;
end;
$$;

-- Step 9's state for the screen: the MAL and its signing.
create or replace function public.cb_fs_status(p_file uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare f public.cb_file_fs; q record; s record; w record;
begin
  perform private.require(private.can_view('closebook'), 'You need Closebook access.');
  select * into f from public.cb_file_fs where file_id = p_file;
  select id, status, sent_at, signed_at into q from public.quotes where id = f.mal_quote_id;
  select first_name, last_name, email, token, signed_at, signed_name, signed_title into s from public.quote_signers where quote_id = f.mal_quote_id order by person limit 1;
  select id, status into w from public.quotes where id = f.mal_withdrawn_quote;
  return jsonb_build_object('mal_quote_id', f.mal_quote_id, 'mal_status', q.status, 'mal_sent_at', f.mal_sent_at, 'mal_sent_by', f.mal_sent_by,
    'mal_token', s.token, 'mal_email', s.email, 'mal_signed_at', s.signed_at, 'mal_signed_name', s.signed_name, 'mal_signed_title', s.signed_title,
    'mal_withdrawn_at', f.mal_withdrawn_at, 'mal_withdrawn_why', f.mal_withdrawn_why, 'mal_withdrawn_status', w.status);
end;
$$;

revoke all on function private.cb_step9_problems(uuid), private.cb_withdraw_mal(uuid, text) from public, anon, authenticated;
revoke all on function public.cb_save_opening_s125(uuid, jsonb), public.cb_save_fs_fields(uuid, jsonb), public.cb_send_mal(uuid, text, text, jsonb), public.cb_fs_status(uuid) from public, anon;
grant execute on function public.cb_save_opening_s125(uuid, jsonb), public.cb_save_fs_fields(uuid, jsonb), public.cb_send_mal(uuid, text, text, jsonb), public.cb_fs_status(uuid) to authenticated;

-- Step 9's sign-offs (round 10 functions, with step 9 added).
create or replace function public.cb_sign_step(p_file uuid, p_step text, p_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_file public.cb_files;
  r public.cb_step_signoffs;
  v_list text[];
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(p_step in ('setup', 'opening', 'records', 'code', 'entries', 'review', 'mapping', 't2', 'statements'), 'This step is not built yet: it has no sign-off.');
  perform private.require(p_role in ('prepared', 'reviewed'), 'Unknown sign-off.');
  select * into r from public.cb_step_signoffs where file_id = p_file and step = p_step;
  if p_role = 'prepared' then
    perform private.require(p_step <> 'review', 'Step 6 is the reviewer''s: it has no preparer sign-off.');
    perform private.require(r.prepared_at is null, 'This step is already signed as prepared.');
    v_list := case when p_step = 't2' then private.cb_step8_problems(p_file) when p_step = 'statements' then private.cb_step9_problems(p_file) else private.cb_prepare_blockers(p_file, p_step) end;
    perform private.require(cardinality(v_list) = 0, 'Not yet: ' || array_to_string(v_list, ' '));
    if p_step = 'opening' and v_file.books in ('statements', 'paper') then
      perform public.cb_sign_opening(p_file);   -- records the sign-off and the history
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
        else private.cb_step_waiting(p_file, p_step)
          || coalesce((select array_agg(x) from unnest(private.cb_step_problems(p_file, p_step)) x where x not like '%review note%'), '{}') end;
      perform private.require(cardinality(v_list) = 0, 'Not yet: ' || array_to_string(v_list, ' '));
      update public.cb_step_signoffs set reviewed_by = (select auth.uid()), reviewed_at = now() where file_id = p_file and step = p_step;
    end if;
    perform private.cb_log(p_file, 'reviewed', p_step, case when r.prepared_by = (select auth.uid()) then 'Prepared and reviewed by the same person' else '' end);
  end if;
  update public.cb_files set updated_at = now() where id = p_file;
end;
$function$

;
create or replace function public.cb_step_status(p_file uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v jsonb := '{}'::jsonb; s text; r public.cb_step_signoffs;
begin
  perform private.require(private.can_view('closebook'), 'You need Closebook access.');
  foreach s in array array['setup', 'opening', 'records', 'code', 'entries', 'review', 'mapping', 't2', 'statements'] loop
    select * into r from public.cb_step_signoffs where file_id = p_file and step = s;
    v := v || jsonb_build_object(s, jsonb_build_object(
      'prepared_by', r.prepared_by, 'prepared_at', r.prepared_at, 'reviewed_by', r.reviewed_by, 'reviewed_at', r.reviewed_at,
      'problems', to_jsonb(case when s = 'review' then private.cb_review_problems(p_file) when s = 't2' then private.cb_step8_problems(p_file) when s = 'statements' then private.cb_step9_problems(p_file) else private.cb_step_problems(p_file, s) end),
      'waiting', to_jsonb(case when s in ('review', 't2', 'statements') then '{}'::text[] else private.cb_step_waiting(p_file, s) end),
      'notes', (select count(*) from public.cb_review_notes n where n.file_id = p_file and n.step = s and n.status <> 'cleared')));
  end loop;
  -- Step 10's checklist rule, for the screen that shows it.
  return v || jsonb_build_object('checklist', to_jsonb(private.cb_checklist_problems(p_file)));
end;
$function$

;
create or replace function private.cb_clear_step(p_file uuid, p_step text, p_why text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.cb_step_signoffs;
begin
  -- The file itself is being deleted: nothing to clear or record.
  if not exists (select 1 from public.cb_files where id = p_file) then return; end if;
  delete from public.cb_step_signoffs where file_id = p_file and step = p_step returning * into r;
  if r.file_id is not null then
    perform private.cb_log(p_file, 'signoff_cleared', p_step, p_why);
    if p_step = 'opening' then
      update public.cb_files set opening_signed_by = null, opening_signed_at = null where id = p_file and opening_signed_at is not null;
    end if;
  end if;
  -- Step 6 rests on steps 1 to 5 and 7; step 8 comes after it and does not reopen it (round 10).
  if p_step not in ('review', 't2', 'statements') then
    perform private.cb_clear_step(p_file, 'review', 'A step it rests on changed');
  end if;
  -- A change to the trial balance (its import, coding, entries or matches) reopens step 8: the final
  -- export no longer matches it.
  if p_step in ('opening', 'records', 'code', 'entries', 'mapping') then
    perform private.cb_clear_step(p_file, 't2', 'The trial balance changed after the final export');
  end if;
  -- Step 9's package rests on the final export (round 11): a change to step 8 reopens it, and a reopened
  -- step 9 withdraws a MAL that was sent for signing.
  if p_step = 't2' then
    perform private.cb_clear_step(p_file, 'statements', 'The trial balance or step 8 changed');
  end if;
  if p_step = 'statements' then
    perform private.cb_withdraw_mal(p_file, coalesce(nullif(p_why, ''), 'Step 9 changed'));
  end if;
end;
$function$

;


-- The MAL is signed by the company's signing officer: the title is required, as on a company letter.
create or replace function public.record_t1_signature(p_quote uuid, p_person int, p_name text, p_ip text, p_agent text, p_hash text, p_same_device boolean,
  p_title text default null, p_option int default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_q public.quotes;
  v_all boolean;
  v_company boolean;
begin
  select * into v_q from public.quotes where id = p_quote for update;
  perform private.require(v_q.id is not null, 'Quote not found.');
  perform private.require(v_q.status in ('sent', 'viewed'), 'This quote cannot be signed.');
  perform private.require(v_q.valid_until >= (now() at time zone 'America/Toronto')::date, 'This quote has expired.');
  perform private.require(length(btrim(coalesce(p_name, ''))) between 2 and 120, 'Type your full name to sign.');
  perform private.require(coalesce(p_hash, '') ~ '^[0-9a-f]{64}$', 'The document could not be checked.');
  v_company := v_q.kind in ('corporate', 'proposal') or (v_q.kind = 'letter' and v_q.details ->> 'doc_kind' in ('corporate_letter', 'cb_mal'));
  perform private.require(not v_company or length(btrim(coalesce(p_title, ''))) between 2 and 80, 'Type your title at the company to sign.');
  if v_q.kind = 'proposal' then
    perform private.require(p_option is not null and p_option >= 0 and p_option < jsonb_array_length(v_q.proposal -> 'opts'), 'Choose an option to sign.');
  end if;
  update public.quote_signers
     set signed_at = now(), signed_name = btrim(p_name), signed_ip = left(coalesce(p_ip, ''), 100),
         signed_agent = left(coalesce(p_agent, ''), 400), document_hash = p_hash, same_device = coalesce(p_same_device, false),
         signed_title = case when v_company then btrim(p_title) end
   where quote_id = p_quote and person = p_person and signed_at is null;
  perform private.require(found, 'Already signed.');
  if v_q.kind = 'proposal' then update public.quotes set chosen_option = p_option where id = p_quote; end if;
  v_all := not exists (select 1 from public.quote_signers where quote_id = p_quote and signed_at is null);
  if v_all then
    update public.quotes set status = 'signed', signed_at = now() where id = p_quote;
    update public.leads set status = 'signed', closed_at = coalesce(closed_at, now()) where id = v_q.lead_id;
    perform private.on_quote_signed(p_quote);
    -- The MAL from Closebook step 9: its signing goes in the file's history.
    if v_q.details ->> 'doc_kind' = 'cb_mal' and (v_q.details ->> 'file_id') ~ '^[0-9a-f-]{36}$' then
      perform private.cb_log((v_q.details ->> 'file_id')::uuid, 'mal_signed', 'statements', format('MAL signed by %s, %s', btrim(p_name), btrim(coalesce(p_title, ''))));
    end if;
  end if;
  return v_all;
end;
$$;
revoke all on function public.record_t1_signature(uuid, int, text, text, text, text, boolean, text, int) from public, anon, authenticated;
grant execute on function public.record_t1_signature(uuid, int, text, text, text, text, boolean, text, int) to service_role;


-- The MAL lives in Closebook step 9, not in Engagement letters or its badge.
create or replace function public.letter_list()
returns table (id uuid, kind text, status text, client text, letter text, came_from text, sent_at timestamptz, signed_at timestamptz, lead_id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require(private.can_view('documents') or private.can_view('leads'), 'You do not have access to engagement letters.');
  return query
  select q.id, q.kind, q.status,
         coalesce(nullif(btrim(q.company_name), ''), c.legal_name, nullif(btrim(q.title), ''),
                  (select string_agg(s.first_name || ' ' || s.last_name, ' and ' order by s.person) from public.quote_signers s where s.quote_id = q.id), 'Untitled'),
         case q.kind
           when 't1' then 'Personal tax ' || q.tax_year
           when 'corporate' then 'Year-end ' || to_char(q.year_end, 'Mon FMDD, YYYY')
           when 'proposal' then coalesce('Monthly: ' || (q.proposal -> 'opts' -> q.chosen_option ->> 'name'), 'Monthly proposal')
           else coalesce(nullif(q.details ->> 'label', ''), 'Engagement letter') end,
         case q.kind
           when 'letter' then 'New letter'
           when 'proposal' then 'Proposal' || coalesce(' (' || (q.proposal -> 'opts' -> q.chosen_option ->> 'name') || ')', '')
           else 'Quote (' || case when l.source ilike 'phone%' then 'phone' else 'website' end || ')' end,
         q.sent_at, q.signed_at, q.lead_id
  from public.quotes q
  left join public.leads l on l.id = q.lead_id
  left join public.clients c on c.id = q.client_id
  where q.status <> 'draft' and coalesce(q.details ->> 'doc_kind', '') <> 'cb_mal' and (q.kind <> 'proposal' or jsonb_typeof(q.proposal -> 'opts') = 'array')
  order by coalesce(q.signed_at, q.sent_at) desc;
end;
$$;
revoke all on function public.letter_list() from public, anon;
grant execute on function public.letter_list() to authenticated;

-- The Engagement letters badge: letters waiting for a signature (quotes, proposals and new letters).
create or replace function public.letters_waiting_count()
returns int language sql stable security definer set search_path = '' as $$
  select case when private.can_view('documents') or private.can_view('leads') then
    (select count(*)::int from public.quotes where status in ('sent', 'viewed') and coalesce(details ->> 'doc_kind', '') <> 'cb_mal' and valid_until >= (now() at time zone 'America/Toronto')::date)
  else 0 end
$$;
revoke all on function public.letters_waiting_count() from public, anon;
grant execute on function public.letters_waiting_count() to authenticated;
