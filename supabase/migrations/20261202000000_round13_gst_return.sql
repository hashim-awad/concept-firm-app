-- Round 13 (Hashim, Nov 14, 2026): the GST/HST return for year-end clients, on step 8 beside the T2.
-- Benchmark: QuickBooks Online's GST/HST return. Full files whose books are built in Closebook (bank and
-- card statements) only. The return's figures are worked out in the app (src/lib/closebook/gst-return.ts)
-- and kept here when the preparer prepares each return, with the trial balance's fingerprint. Safe to run twice.

-- Step 1: two more GST/HST answers (the RT account; whether the GST/HST year is the fiscal year).
create or replace function public.cb_save_setup(p_file uuid, p_setup jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_key text;
  v_new jsonb;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null, 'File not found.');
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(jsonb_typeof(p_setup) = 'object', 'Answers are missing.');
  for v_key in select jsonb_object_keys(p_setup) loop
    perform private.require(v_key in ('realtor', 'owner_paid', 'dividends', 'payroll', 'holdco', 'gst_registered', 'gst_frequency', 'quick_method', 'gst_rt', 'gst_year_same'), format('Unknown question %s.', v_key));
  end loop;
  perform private.require(coalesce(p_setup ->> 'gst_frequency', 'annual') in ('annual', 'quarterly', 'monthly'), 'Choose annual, quarterly or monthly.');
  -- Round 13: the GST/HST account (RT0001 by default) and whether the GST/HST year is the fiscal year.
  perform private.require(coalesce(p_setup ->> 'gst_rt', 'RT0001') ~ '^RT[0-9]{4}$', 'The GST/HST account is RT and four digits, for example RT0001.');
  perform private.require(coalesce(jsonb_typeof(p_setup -> 'gst_year_same'), 'boolean') = 'boolean', 'Answer Yes or No.');
  v_new := coalesce(v_file.setup, '{}'::jsonb) || p_setup;
  update public.cb_files set setup = v_new, updated_at = now() where id = p_file;
  -- Before November 17 an unanswered file was coded as a registrant on the regular method; compare with that.
  if coalesce((v_file.setup ->> 'gst_registered')::boolean, true) is distinct from coalesce((v_new ->> 'gst_registered')::boolean, true)
     or coalesce((v_file.setup ->> 'quick_method')::boolean, false) is distinct from coalesce((v_new ->> 'quick_method')::boolean, false) then
    update public.cb_bank_lines l set status = 'reviewer', reviewer_reason = 'The GST/HST answers changed: the sales tax was worked out again. Check it.'
     where l.file_id = p_file and l.status = 'done'
       and exists (select 1 from public.cb_sales_tax_parts p where p.code = l.tax_code and p.rate > 0);
    update public.cb_entries e set needs_review = true, reviewed_at = null, reviewed_by = null
     where e.file_id = p_file and exists (select 1 from public.cb_entry_lines x where x.entry_id = e.id and x.tax_code is not null);
  end if;
end;
$$;

-- Settings, Closebook, GST/HST: CRA's due-date rule and the quick method's rates. Hashim fills the rates
-- from CRA's page; until then a quick method return says they are missing and does not guess.
alter table public.cb_settings add column if not exists gst_due_months_annual int not null default 3;
alter table public.cb_settings add column if not exists gst_due_months_period int not null default 1;
alter table public.cb_settings add column if not exists quick_credit_rate numeric(8, 6);
alter table public.cb_settings add column if not exists quick_credit_limit numeric(14, 2);
alter table public.cb_settings drop constraint if exists cb_settings_gst_due_check;
alter table public.cb_settings add constraint cb_settings_gst_due_check check (gst_due_months_annual between 1 and 12 and gst_due_months_period between 1 and 12
  and (quick_credit_rate is null or quick_credit_rate between 0 and 1) and (quick_credit_limit is null or quick_credit_limit >= 0));
create table if not exists public.cb_gst_quick_rates (
  province   text primary key check (province ~ '^[A-Z]{2}$'),
  rate       numeric(8, 6) not null check (rate between 0 and 1),
  updated_by uuid references public.staff (id),
  updated_at timestamptz not null default now()
);
alter table public.cb_gst_quick_rates enable row level security;
alter table public.cb_gst_quick_rates force row level security;
drop policy if exists "Closebook viewers read quick rates" on public.cb_gst_quick_rates;
create policy "Closebook viewers read quick rates" on public.cb_gst_quick_rates for select to authenticated using ((select private.can_view('closebook')));
grant select on public.cb_gst_quick_rates to authenticated;

create or replace function public.cb_update_gst_settings(p_due_annual int, p_due_period int, p_credit_rate numeric, p_credit_limit numeric, p_rates jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare x jsonb;
begin
  perform private.require(private.is_owner(), 'Only an owner changes the GST/HST settings.');
  perform private.require(p_due_annual between 1 and 12 and p_due_period between 1 and 12, 'Due dates: a number of months from 1 to 12.');
  perform private.require(p_credit_rate is null or p_credit_rate between 0 and 1, 'The quick method credit is a rate from 0 to 100%.');
  perform private.require(p_credit_limit is null or p_credit_limit >= 0, 'The credit limit is an amount, 0 or more.');
  perform private.require(jsonb_typeof(coalesce(p_rates, '[]')) = 'array', 'The remittance rates could not be read.');
  update public.cb_settings set gst_due_months_annual = p_due_annual, gst_due_months_period = p_due_period, quick_credit_rate = p_credit_rate,
    quick_credit_limit = p_credit_limit, updated_at = now(), updated_by = (select auth.uid());
  for x in select * from jsonb_array_elements(coalesce(p_rates, '[]')) loop
    perform private.require(coalesce(x ->> 'province', '') ~ '^[A-Z]{2}$', 'Each remittance rate needs its province (two letters).');
    if nullif(x ->> 'rate', '') is null then delete from public.cb_gst_quick_rates where province = x ->> 'province';
    else
      perform private.require((x ->> 'rate')::numeric between 0 and 1, 'A remittance rate is from 0 to 100%.');
      insert into public.cb_gst_quick_rates (province, rate, updated_by) values (x ->> 'province', (x ->> 'rate')::numeric, (select auth.uid()))
      on conflict (province) do update set rate = excluded.rate, updated_by = excluded.updated_by, updated_at = now();
    end if;
  end loop;
end;
$$;
revoke all on function public.cb_update_gst_settings(int, int, numeric, numeric, jsonb) from public, anon;
grant execute on function public.cb_update_gst_settings(int, int, numeric, numeric, jsonb) to authenticated;

-- The year's returns: one row per period, kept when the preparer prepares it (its lines as worked out, the
-- instalments confirmed, the trial balance's fingerprint), and its filing record (step 10).
create table if not exists public.cb_gst_returns (
  file_id         uuid not null references public.cb_files (id) on delete cascade,
  period_no       int not null check (period_no between 1 and 12),
  label           text not null,
  period_start    date not null,
  period_end      date not null,
  due_on          date not null,
  instalments     numeric(14, 2) not null default 0,
  lines           jsonb not null check (jsonb_typeof(lines) = 'object'),
  fingerprint     text not null,
  prepared_by     uuid references public.staff (id),
  prepared_at     timestamptz not null default now(),
  filed_on        date,
  confirmation    text not null default '' check (length(confirmation) <= 40),
  primary key (file_id, period_no)
);
-- The check against the books (GST/HST payable, 21500), as worked out when the returns were prepared.
create table if not exists public.cb_gst_check (
  file_id      uuid primary key references public.cb_files (id) on delete cascade,
  owing        numeric(14, 2) not null,
  book         numeric(14, 2) not null,
  diff         numeric(14, 2) not null,
  fingerprint  text not null,
  note         text not null default '' check (length(note) <= 300),
  noted_by     uuid references public.staff (id),
  noted_at     timestamptz,
  accepted_by  uuid references public.staff (id),
  accepted_at  timestamptz,
  accepted_why text not null default ''
);
do $$ declare t text;
begin
  foreach t in array array['cb_gst_returns', 'cb_gst_check'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists "Closebook viewers read" on public.%I', t);
    execute format('create policy "Closebook viewers read" on public.%I for select to authenticated using ((select private.can_view(''closebook'')))', t);
    execute format('grant select on public.%I to authenticated', t);
    -- A locked file is read-only everywhere (round 12).
    execute format('drop trigger if exists cb_locked_guard on public.%I', t);
    execute format('create trigger cb_locked_guard before insert or update or delete on public.%I for each row execute function private.cb_locked_guard()', t);
  end loop;
end $$;

-- Whether the file has a GST/HST return built in Closebook: a full file whose books are built here (bank
-- and card statements), registered, and the GST/HST year the fiscal year.
create or replace function private.cb_gst_applies(p_file uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select f.file_type = 'full' and f.books in ('statements', 'paper') and coalesce((f.setup ->> 'gst_registered')::boolean, false)
     and coalesce((f.setup ->> 'gst_year_same')::boolean, true) and f.setup ? 'gst_frequency'
    from public.cb_files f where f.id = p_file
$$;
-- The year's periods, as gst-return.ts works them out: one, or the quarters or months inside the year.
create or replace function private.cb_gst_period_count(p_file uuid) returns int
language sql stable security definer set search_path = '' as $$
  select case f.setup ->> 'gst_frequency' when 'annual' then 1
    else (select count(*)::int from generate_series(f.year_start, f.year_end, case f.setup ->> 'gst_frequency' when 'quarterly' then interval '3 months' else interval '1 month' end)) end
    from public.cb_files f where f.id = p_file
$$;

-- What the GST/HST returns still need before step 8's preparer signs.
create or replace function private.cb_gst_problems(p_file uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v_out text[] := '{}'; v_n int; v_fp text; c public.cb_gst_check; v_limit numeric;
begin
  if not private.cb_gst_applies(p_file) then return v_out; end if;
  v_fp := private.cb_tb_fingerprint(p_file);
  select count(*) into v_n from public.cb_gst_returns where file_id = p_file;
  if v_n < private.cb_gst_period_count(p_file) then
    v_out := v_out || format('Prepare the GST/HST return%s for the year (%s of %s prepared).', case when private.cb_gst_period_count(p_file) = 1 then '' else 's' end, v_n, private.cb_gst_period_count(p_file));
  elsif exists (select 1 from public.cb_gst_returns where file_id = p_file and fingerprint <> v_fp) then
    v_out := v_out || 'The books changed after the GST/HST returns were prepared. Prepare them again.'::text;
  end if;
  select * into c from public.cb_gst_check where file_id = p_file;
  if c.file_id is null or c.fingerprint <> v_fp then return v_out; end if;
  if c.diff <> 0 then
    select entry_review_amount into v_limit from public.cb_settings limit 1;
    if abs(c.diff) > coalesce(v_limit, 5000) and c.accepted_at is null then
      v_out := v_out || format('GST/HST payable (21500) differs from the balances owing on the returns by %s, over the review threshold: the reviewer accepts it, or fix it with an entry.', private.cb_money(c.diff));
    elsif abs(c.diff) <= coalesce(v_limit, 5000) and coalesce(c.note, '') = '' then
      v_out := v_out || format('GST/HST payable (21500) differs from the balances owing on the returns by %s: explain it in one line, or fix it with an entry.', private.cb_money(c.diff));
    end if;
  end if;
  return v_out;
end;
$$;
revoke all on function private.cb_gst_applies(uuid), private.cb_gst_period_count(uuid), private.cb_gst_problems(uuid) from public, anon, authenticated;

-- Prepare one return: its lines as worked out, the instalments confirmed, the trial balance's fingerprint.
create or replace function public.cb_prepare_gst_return(p_file uuid, p_period int, p_label text, p_start date, p_end date, p_due date, p_instalments numeric, p_lines jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files; o public.cb_gst_returns;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(private.cb_gst_applies(p_file), 'This file has no GST/HST return built in Closebook.');
  select * into o from public.cb_gst_returns where file_id = p_file and period_no = p_period;
  perform private.require(p_period between 1 and private.cb_gst_period_count(p_file) and p_start >= v_file.year_start and p_end <= v_file.year_end and p_start <= p_end, 'That period is not in the fiscal year.');
  perform private.require(p_instalments is not null and p_instalments >= 0, 'Instalments paid: type the amount from the CRA account, 0 or more.');
  perform private.require(jsonb_typeof(p_lines) = 'object' and p_lines ? '113', 'The return could not be worked out.');
  insert into public.cb_gst_returns (file_id, period_no, label, period_start, period_end, due_on, instalments, lines, fingerprint, prepared_by)
  values (p_file, p_period, left(p_label, 120), p_start, p_end, p_due, round(p_instalments, 2), p_lines, private.cb_tb_fingerprint(p_file), (select auth.uid()))
  on conflict (file_id, period_no) do update set label = excluded.label, period_start = excluded.period_start, period_end = excluded.period_end, due_on = excluded.due_on,
    instalments = excluded.instalments, lines = excluded.lines, fingerprint = excluded.fingerprint, prepared_by = excluded.prepared_by, prepared_at = now();
  -- Periods no longer in the year (the frequency changed) go.
  delete from public.cb_gst_returns where file_id = p_file and period_no > private.cb_gst_period_count(p_file);
  perform private.cb_log(p_file, 'gst_prepared', 't2', format('%s: balance %s', p_label, private.cb_money((p_lines ->> '113')::numeric / 100)));
  -- A return that changed after step 8 was signed reopens step 8.
  if o.file_id is not null and (o.lines is distinct from p_lines or o.instalments is distinct from round(p_instalments, 2)) then
    perform private.cb_clear_step(p_file, 't2', 'A GST/HST return changed');
  end if;
end;
$$;

-- The check against the books, as worked out with the returns; the preparer's one-line explanation.
create or replace function public.cb_save_gst_check(p_file uuid, p_owing numeric, p_book numeric, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files; v_diff numeric := round(p_book - p_owing, 2); c public.cb_gst_check;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(private.cb_gst_applies(p_file), 'This file has no GST/HST return built in Closebook.');
  select * into c from public.cb_gst_check where file_id = p_file;
  insert into public.cb_gst_check (file_id, owing, book, diff, fingerprint, note, noted_by, noted_at)
  values (p_file, round(p_owing, 2), round(p_book, 2), v_diff, private.cb_tb_fingerprint(p_file), left(btrim(coalesce(p_note, '')), 300),
          case when btrim(coalesce(p_note, '')) <> '' then (select auth.uid()) end, case when btrim(coalesce(p_note, '')) <> '' then now() end)
  on conflict (file_id) do update set owing = excluded.owing, book = excluded.book, diff = excluded.diff, fingerprint = excluded.fingerprint,
    note = excluded.note, noted_by = excluded.noted_by, noted_at = excluded.noted_at,
    -- A changed difference needs the reviewer again.
    accepted_by = case when public.cb_gst_check.diff = excluded.diff then public.cb_gst_check.accepted_by end,
    accepted_at = case when public.cb_gst_check.diff = excluded.diff then public.cb_gst_check.accepted_at end,
    accepted_why = case when public.cb_gst_check.diff = excluded.diff then public.cb_gst_check.accepted_why else '' end;
  if btrim(coalesce(p_note, '')) <> '' and coalesce(c.note, '') is distinct from btrim(p_note) then
    perform private.cb_log(p_file, 'gst_check_explained', 't2', format('%s: %s', private.cb_money(v_diff), btrim(p_note)));
  end if;
end;
$$;

create or replace function public.cb_accept_gst_check(p_file uuid, p_why text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files; c public.cb_gst_check;
begin
  perform private.require(private.is_owner(), 'Only the reviewer accepts a GST/HST difference. Reviewers are owners.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(length(btrim(coalesce(p_why, ''))) >= 3, 'Say why the difference is accepted.');
  select * into c from public.cb_gst_check where file_id = p_file;
  perform private.require(c.file_id is not null and c.diff <> 0, 'There is no GST/HST difference to accept.');
  update public.cb_gst_check set accepted_by = (select auth.uid()), accepted_at = now(), accepted_why = btrim(p_why) where file_id = p_file;
  perform private.cb_log(p_file, 'gst_check_accepted', 't2', format('%s accepted: %s', private.cb_money(c.diff), btrim(p_why)));
end;
$$;

-- Step 10: each return's filing date and CRA confirmation number.
create or replace function public.cb_save_gst_filing(p_file uuid, p_period int, p_filed date, p_confirmation text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(p_filed is null or p_filed <= (now() at time zone 'America/Toronto')::date, 'The filing date cannot be in the future.');
  perform private.require(coalesce(btrim(p_confirmation), '') = '' or btrim(p_confirmation) ~ '^[A-Za-z0-9-]{4,40}$', 'The CRA confirmation number is letters and digits.');
  update public.cb_gst_returns set filed_on = p_filed, confirmation = upper(coalesce(btrim(p_confirmation), '')) where file_id = p_file and period_no = p_period;
  perform private.require(found, 'Prepare the return first (step 8).');
  perform private.cb_log(p_file, 'gst_filed', 'lock', format('Period %s: filed %s, confirmation %s', p_period, coalesce(p_filed::text, 'not yet'), coalesce(nullif(upper(btrim(p_confirmation)), ''), 'not yet')));
end;
$$;
revoke all on function public.cb_prepare_gst_return(uuid, int, text, date, date, date, numeric, jsonb), public.cb_save_gst_check(uuid, numeric, numeric, text),
  public.cb_accept_gst_check(uuid, text), public.cb_save_gst_filing(uuid, int, date, text) from public, anon;
grant execute on function public.cb_prepare_gst_return(uuid, int, text, date, date, date, numeric, jsonb), public.cb_save_gst_check(uuid, numeric, numeric, text),
  public.cb_accept_gst_check(uuid, text), public.cb_save_gst_filing(uuid, int, date, text) to authenticated;

-- Step 8's preparer sign-off needs the year's returns prepared and the check tied or explained.
create or replace function private.cb_step8_problems(p_file uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb := private.cb_t2_state(p_file); v_out text[] := '{}'; i jsonb; v_n int;
begin
  if v ->> 'final_id' is null then
    v_out := v_out || 'Export the final GIFI file, after the tax entries are booked.'::text;
  elsif (v ->> 'stale')::boolean then
    v_out := v_out || 'The trial balance changed after the final export. Export again and import it into ProFile.'::text;
  end if;
  if v ->> 'final_id' is not null and not (v ->> 'stale')::boolean then
    if not (v ->> 'entered')::boolean or coalesce(v ->> 't2_pdf', '') = '' then
      v_out := v_out || 'Enter the figures from ProFile and attach the T2 PDF.'::text;
    else
      for i in select * from jsonb_array_elements(v -> 'items') loop
        if (i ->> 'open')::boolean then
          v_out := v_out || case when i ->> 'key' in ('ni', 'assets')
            then format('%s: Closebook less ProFile is %s, more than the rounding allowed (%s). Only the reviewer can accept it.',
              case i ->> 'key' when 'ni' then 'Net income' else 'Total assets' end, private.cb_money((i ->> 'diff')::numeric), private.cb_money((v ->> 'rounding')::numeric))
            else format('%s: Closebook less ProFile is %s. It must tie to the cent. Only the reviewer can accept it.',
              case i ->> 'key' when 'cca' then 'CCA' else 'Income tax' end, private.cb_money((i ->> 'diff')::numeric)) end;
        end if;
      end loop;
    end if;
  end if;
  -- A REVIEW line with a balance and no treatment set by the reviewer (round 10 fix 2). Exports go ahead.
  select count(*) into v_n from public.cb_accounts a join public.cb_master_lines m on m.line_no = a.line_no join public.cb_files f on f.id = a.file_id
   where a.file_id = p_file and coalesce(a.tax_code, m.default_tax_code) = 'REVIEW' and private.cb_account_final(a.id) <> 0
     and not exists (select 1 from public.cb_review_treatments t where t.client_id = f.client_id and t.line_no = a.line_no);
  if v_n > 0 then v_out := v_out || format('%s REVIEW line%s wait%s for the reviewer''s Schedule 1 treatment (tax workpaper).', v_n,
    case when v_n = 1 then '' else 's' end, case when v_n = 1 then 's' else '' end); end if;
  -- Round 13: the year's GST/HST returns prepared, and the check against 21500 tied or explained.
  v_out := v_out || private.cb_gst_problems(p_file);
  select count(*) into v_n from public.cb_review_notes where file_id = p_file and step = 't2' and status = 'open';
  if v_n > 0 then v_out := v_out || format('%s review note%s to fix.', v_n, case when v_n = 1 then '' else 's' end); end if;
  return v_out;
end;
$$;

-- The lock needs each GST/HST return's filing date and confirmation number.
create or replace function private.cb_lock_problems(p_file uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v_out text[] := '{}'; v_file public.cb_files; c public.cb_file_close; s record; st record; v_bank boolean; g public.cb_gst_returns;
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
  -- Round 13: each GST/HST return of the year, its filing date and CRA confirmation number.
  if private.cb_gst_applies(p_file) then
    for g in select * from public.cb_gst_returns where file_id = p_file order by period_no loop
      if g.filed_on is null or coalesce(g.confirmation, '') = '' then
        v_out := v_out || format('GST/HST return %s: the filing date and CRA confirmation number are not recorded.', g.label);
      end if;
    end loop;
  end if;
  return v_out;
end;
$$;
revoke all on function private.cb_lock_problems(uuid), private.cb_step8_problems(uuid) from public, anon, authenticated;
