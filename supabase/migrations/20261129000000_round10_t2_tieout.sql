-- Round 10 (Hashim, Nov 27, 2026): step 8, T2 tie-out.
-- Benchmarks: QuickBooks Online's GIFI export for the file format, ProFile for the import, CaseWare for
-- the tie-out working paper.
--   1. Two GIFI exports, "before tax entries" and "final", kept with who and when, and the trial balance
--      they were made from (a fingerprint). A change to the trial balance after the final export makes it
--      stale and reopens step 8.
--   2. The checks run in the app before every export (the figures and the rules are in
--      src/lib/closebook/t2.ts); the database refuses an export with a failed check and checks again
--      that the trial balance balances and every account is matched.
--   3. The tie-out to ProFile: the preparer types net income, total assets, CCA and income tax from
--      ProFile and attaches the T2. A difference blocks the preparer; only the reviewer accepts one, with
--      a reason, and the acceptance reopens if the difference changes (as on the revenue check).
--   4. The reviewer's treatment of REVIEW lines and the client's book amortization choice, kept per client
--      so they roll forward.
--   5. Step 8 gets its sign-offs.
-- Round 10 fixes (Hashim, Nov 27, 2026): ProFile rounds each GIFI line to whole dollars, so a tie-out
-- difference within "Rounding allowed in the T2 tie-out" (Settings, $5) shows as rounding and does not
-- block; differences are Closebook less ProFile; a REVIEW line with no treatment blocks step 8's
-- preparer; a balance on the wrong side of a balance sheet line with no paired line goes to the reviewer
-- in step 7, who keeps it there with a reason or moves it.
-- Safe to run twice (round 4d rule).

alter table public.cb_settings add column if not exists t2_rounding numeric(12, 2) not null default 5;
alter table public.cb_settings drop constraint if exists cb_settings_t2_rounding_check;
alter table public.cb_settings add constraint cb_settings_t2_rounding_check check (t2_rounding between 0 and 1000);

create or replace function public.cb_update_t2_rounding(p_amount numeric) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.is_owner(), 'Only an owner changes thresholds.');
  perform private.require(p_amount is not null and p_amount between 0 and 1000, 'Rounding allowed in the T2 tie-out: a number from 0 to 1,000.');
  update public.cb_settings set t2_rounding = round(p_amount, 2), updated_at = now(), updated_by = (select auth.uid());
end;
$$;
revoke all on function public.cb_update_t2_rounding(numeric) from public, anon;
grant execute on function public.cb_update_t2_rounding(numeric) to authenticated;

create table if not exists public.cb_gifi_exports (
  id           uuid primary key default gen_random_uuid(),
  file_id      uuid not null references public.cb_files (id) on delete cascade,
  kind         text not null check (kind in ('before_tax', 'final')),
  file_name    text not null check (length(file_name) between 5 and 200),
  content      text not null,
  totals       jsonb not null,
  checks       jsonb not null,
  fingerprint  text not null,
  created_by   uuid references public.staff (id),
  created_at   timestamptz not null default now()
);
create index if not exists cb_gifi_exports_file on public.cb_gifi_exports (file_id, kind, created_at desc);

create table if not exists public.cb_t2_tieouts (
  file_id       uuid primary key references public.cb_files (id) on delete cascade,
  net_income    numeric(14, 2),
  total_assets  numeric(14, 2),
  cca           numeric(14, 2),
  income_tax    numeric(14, 2),
  t2_pdf        text,
  -- {"ni": {"diff": n, "by": uuid, "at": ts, "reason": text}, ...}: the reviewer's acceptances.
  accepted      jsonb not null default '{}',
  entered_by    uuid references public.staff (id),
  entered_at    timestamptz not null default now()
);

create table if not exists public.cb_review_treatments (
  client_id   uuid not null references public.clients (id) on delete cascade,
  line_no     text not null references public.cb_master_lines (line_no),
  treatment   text not null check (treatment in ('add100', 'add50', 'deduct100', 'none')),
  set_by      uuid references public.staff (id),
  set_at      timestamptz not null default now(),
  primary key (client_id, line_no)
);

create table if not exists public.cb_client_tax_settings (
  client_id          uuid primary key references public.clients (id) on delete cascade,
  book_amortization  boolean not null default false,
  set_by             uuid references public.staff (id),
  set_at             timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['cb_gifi_exports', 'cb_t2_tieouts', 'cb_review_treatments', 'cb_client_tax_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists "Closebook viewers read %s" on public.%I', t, t);
    execute format('create policy "Closebook viewers read %s" on public.%I for select to authenticated using ((select private.can_view(''closebook'')))', t, t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- The trial balance an export was made from: every account's GIFI line, tax code and final balance.
create or replace function private.cb_tb_fingerprint(p_file uuid) returns text
language sql stable security definer set search_path = '' as $$
  select md5(coalesce(string_agg(a.id::text || ':' || coalesce(a.line_no, '') || ':' || coalesce(a.tax_code, '') || ':' || private.cb_account_final(a.id)::text, ',' order by a.id), ''))
    from public.cb_accounts a where a.file_id = p_file;
$$;

create or replace function public.cb_record_gifi_export(p_file uuid, p_kind text, p_file_name text, p_content text, p_totals jsonb, p_checks jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files; v_id uuid; v_failed text; v_out numeric; v_n int;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(v_file.file_type = 'full', 'Monthly files have no T2 tie-out.');
  perform private.require(p_kind in ('before_tax', 'final'), 'Choose the export: before tax entries or final.');
  perform private.require(jsonb_typeof(p_checks) = 'array' and jsonb_array_length(p_checks) >= 5, 'The checks did not run. Nothing was exported.');
  select string_agg(c ->> 'title', '; ') into v_failed from jsonb_array_elements(p_checks) c where not (c ->> 'ok')::boolean;
  perform private.require(v_failed is null, 'Export refused. Failed: ' || coalesce(v_failed, '') || '.');
  -- Checked again here: the trial balance balances and every account with a balance is matched.
  select coalesce(sum(private.cb_account_final(id)), 0) into v_out from public.cb_accounts where file_id = p_file;
  perform private.require(v_out = 0, format('Export refused. The trial balance is out by %s.', v_out));
  select count(*) into v_n from public.cb_accounts a where a.file_id = p_file and private.cb_account_final(a.id) <> 0
     and (a.line_no is null or a.needs_reviewer) and a.account_key <> 'chart:10900';
  perform private.require(v_n = 0, format('Export refused. %s account%s not matched in step 7 or waiting for the reviewer.', v_n, case when v_n = 1 then ' is' else 's are' end));
  perform private.require(p_content like '"GIFI01",%', 'The file is not a GIFI file.');
  insert into public.cb_gifi_exports (file_id, kind, file_name, content, totals, checks, fingerprint, created_by)
  values (p_file, p_kind, btrim(p_file_name), p_content, p_totals, p_checks, private.cb_tb_fingerprint(p_file), (select auth.uid()))
  returning id into v_id;
  perform private.cb_log(p_file, 'gifi_exported', 't2', btrim(p_file_name));
  return v_id;
end;
$$;

-- Step 8's figures: the latest final export (stale or current), the tie-out and its differences.
create or replace function private.cb_t2_state(p_file uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_file public.cb_files; e public.cb_gifi_exports; t public.cb_t2_tieouts; v_book boolean; v_items jsonb := '[]'; v_stale boolean;
  k text; v_cb numeric; v_pf numeric; v_diff numeric; v_acc jsonb; v_compared boolean; v_round numeric;
begin
  select * into v_file from public.cb_files where id = p_file;
  select * into e from public.cb_gifi_exports where file_id = p_file and kind = 'final' order by created_at desc limit 1;
  select * into t from public.cb_t2_tieouts where file_id = p_file;
  select coalesce(book_amortization, false) into v_book from public.cb_client_tax_settings where client_id = v_file.client_id;
  v_book := coalesce(v_book, false);
  select coalesce(t2_rounding, 5) into v_round from public.cb_settings limit 1;
  v_round := coalesce(v_round, 5);
  v_stale := e.id is not null and e.fingerprint <> private.cb_tb_fingerprint(p_file);
  if e.id is not null then
    foreach k in array array['ni', 'assets', 'cca', 'tax'] loop
      v_cb := coalesce((e.totals ->> case k when 'ni' then '9999' when 'assets' then '2599' when 'cca' then 'amort' else 'inctax' end)::numeric, 0);
      v_pf := case k when 'ni' then t.net_income when 'assets' then t.total_assets when 'cca' then t.cca else t.income_tax end;
      -- Closebook less ProFile (round 10 fix 6).
      v_diff := case when v_pf is null then null else v_cb - v_pf end;
      v_acc := t.accepted -> k;
      v_compared := k <> 'cca' or not v_book;
      v_items := v_items || jsonb_build_object('key', k, 'closebook', v_cb, 'profile', v_pf, 'diff', v_diff, 'compared', v_compared,
        -- ProFile rounds the GIFI lines to whole dollars, so net income (9999) and total assets (2599) may
        -- differ by the rounding allowed. CCA and income tax are typed from ProFile and booked to the cent:
        -- they tie exactly.
        'rounding', v_compared and k in ('ni', 'assets') and v_diff is not null and v_diff <> 0 and abs(v_diff) <= v_round,
        'open', v_compared and v_diff is not null and abs(v_diff) > (case when k in ('ni', 'assets') then v_round else 0 end)
          and (v_acc is null or (v_acc ->> 'diff')::numeric is distinct from v_diff));
    end loop;
  end if;
  return jsonb_build_object('rounding', v_round, 'final_id', e.id, 'final_at', e.created_at, 'stale', v_stale, 'book_amortization', v_book,
    'entered', t.file_id is not null and t.net_income is not null and t.total_assets is not null and t.cca is not null and t.income_tax is not null,
    't2_pdf', t.t2_pdf, 'items', v_items);
end;
$$;

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
  select count(*) into v_n from public.cb_review_notes where file_id = p_file and step = 't2' and status = 'open';
  if v_n > 0 then v_out := v_out || format('%s review note%s to fix.', v_n, case when v_n = 1 then '' else 's' end); end if;
  return v_out;
end;
$$;

create or replace function public.cb_save_t2_tieout(p_file uuid, p_ni numeric, p_assets numeric, p_cca numeric, p_tax numeric, p_pdf text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(exists (select 1 from public.cb_gifi_exports where file_id = p_file and kind = 'final'), 'Export the final GIFI file first, then import it into ProFile.');
  perform private.require(p_ni is not null and p_assets is not null and p_cca is not null and p_tax is not null, 'Type all four figures from ProFile.');
  perform private.require(nullif(p_pdf, '') is not null or exists (select 1 from public.cb_t2_tieouts where file_id = p_file and t2_pdf is not null), 'Attach the T2 PDF from ProFile.');
  insert into public.cb_t2_tieouts (file_id, net_income, total_assets, cca, income_tax, t2_pdf, entered_by)
  values (p_file, round(p_ni, 2), round(p_assets, 2), round(p_cca, 2), round(p_tax, 2), nullif(p_pdf, ''), (select auth.uid()))
  on conflict (file_id) do update set net_income = excluded.net_income, total_assets = excluded.total_assets, cca = excluded.cca, income_tax = excluded.income_tax,
    t2_pdf = coalesce(excluded.t2_pdf, public.cb_t2_tieouts.t2_pdf), entered_by = excluded.entered_by, entered_at = now();
end;
$$;

-- The reviewer accepts a difference, with a reason. A later change to that signed difference opens it again.
create or replace function public.cb_accept_t2_difference(p_file uuid, p_item text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v jsonb; i jsonb;
begin
  perform private.require(private.can_edit('closebook') and private.is_owner(), 'Only the reviewer accepts a difference. Reviewers are owners.');
  perform private.require(length(btrim(coalesce(p_reason, ''))) between 3 and 300, 'Say why the difference is accepted.');
  v := private.cb_t2_state(p_file);
  select x into i from jsonb_array_elements(v -> 'items') x where x ->> 'key' = p_item;
  perform private.require(i is not null and (i ->> 'open')::boolean, 'Nothing to accept on this line.');
  perform private.require(not (v ->> 'stale')::boolean, 'Export the final GIFI file again first.');
  update public.cb_t2_tieouts set accepted = accepted || jsonb_build_object(p_item, jsonb_build_object('diff', (i ->> 'diff')::numeric, 'by', (select auth.uid()), 'at', now(), 'reason', btrim(p_reason)))
   where file_id = p_file;
  perform private.cb_log(p_file, 't2_accepted', 't2', format('%s difference %s accepted: %s',
    case p_item when 'ni' then 'Net income' when 'assets' then 'Total assets' when 'cca' then 'CCA' else 'Income tax' end, private.cb_money((i ->> 'diff')::numeric), btrim(p_reason)));
end;
$$;

-- The reviewer's treatment of a REVIEW line for this client (rolls forward), and book amortization.
create or replace function public.cb_set_review_treatment(p_file uuid, p_line text, p_treatment text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_client uuid;
begin
  perform private.require(private.can_edit('closebook') and private.is_owner(), 'Only the reviewer sets the treatment. Reviewers are owners.');
  select client_id into v_client from public.cb_files where id = p_file;
  perform private.require(v_client is not null, 'File not found.');
  perform private.require(exists (select 1 from public.cb_master_lines where line_no = p_line and default_tax_code = 'REVIEW')
    or exists (select 1 from public.cb_accounts where file_id = p_file and line_no = p_line and tax_code = 'REVIEW'), 'This line is not a REVIEW line.');
  if nullif(p_treatment, '') is null then delete from public.cb_review_treatments where client_id = v_client and line_no = p_line; return; end if;
  perform private.require(p_treatment in ('add100', 'add50', 'deduct100', 'none'), 'Choose the treatment.');
  insert into public.cb_review_treatments (client_id, line_no, treatment, set_by) values (v_client, p_line, p_treatment, (select auth.uid()))
  on conflict (client_id, line_no) do update set treatment = excluded.treatment, set_by = excluded.set_by, set_at = now();
end;
$$;

create or replace function public.cb_set_book_amortization(p_file uuid, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_client uuid;
begin
  perform private.require(private.can_edit('closebook') and private.is_owner(), 'Only the reviewer sets book amortization. Reviewers are owners.');
  select client_id into v_client from public.cb_files where id = p_file;
  perform private.require(v_client is not null, 'File not found.');
  insert into public.cb_client_tax_settings (client_id, book_amortization, set_by) values (v_client, coalesce(p_on, false), (select auth.uid()))
  on conflict (client_id) do update set book_amortization = excluded.book_amortization, set_by = excluded.set_by, set_at = now();
end;
$$;

create or replace function public.cb_t2_status(p_file uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require(private.can_view('closebook'), 'You need Closebook access.');
  return private.cb_t2_state(p_file);
end;
$$;
revoke all on function public.cb_t2_status(uuid) from public, anon;
grant execute on function public.cb_t2_status(uuid) to authenticated;
revoke all on function private.cb_tb_fingerprint(uuid), private.cb_t2_state(uuid), private.cb_step8_problems(uuid) from public, anon, authenticated;
revoke all on function public.cb_record_gifi_export(uuid, text, text, text, jsonb, jsonb), public.cb_save_t2_tieout(uuid, numeric, numeric, numeric, numeric, text),
  public.cb_accept_t2_difference(uuid, text, text), public.cb_set_review_treatment(uuid, text, text), public.cb_set_book_amortization(uuid, boolean) from public, anon;
grant execute on function public.cb_record_gifi_export(uuid, text, text, text, jsonb, jsonb), public.cb_save_t2_tieout(uuid, numeric, numeric, numeric, numeric, text),
  public.cb_accept_t2_difference(uuid, text, text), public.cb_set_review_treatment(uuid, text, text), public.cb_set_book_amortization(uuid, boolean) to authenticated;

-- A new export or new ProFile figures clear step 8's sign-offs, as any change to a step does. The
-- reviewer's acceptance is a decision on an item sent to the reviewer: it does not.
drop trigger if exists cb_changed_gifi_export on public.cb_gifi_exports;
create trigger cb_changed_gifi_export after insert on public.cb_gifi_exports for each row execute function private.cb_changed('t2', 'A GIFI file was exported');
drop trigger if exists cb_changed_t2_tieout on public.cb_t2_tieouts;
create trigger cb_changed_t2_tieout after insert or update of net_income, total_assets, cca, income_tax, t2_pdf on public.cb_t2_tieouts for each row
  execute function private.cb_changed('t2', 'The ProFile figures changed');

-- A balance on the wrong side of a balance sheet line with no paired line (round 10 fix 5): an asset line
-- with a credit balance, or a liability line with a debit balance (Birch's Visa in credit on 2707). Contra
-- lines (accumulated amortization, allowances) are left out. It waits for the reviewer in step 7, who
-- keeps it on the line with a reason (kept while the account stays on that line) or moves it.
alter table public.cb_accounts add column if not exists side_confirm_reason text check (side_confirm_reason is null or length(side_confirm_reason) <= 300);
alter table public.cb_accounts add column if not exists side_confirmed_line text;
alter table public.cb_accounts add column if not exists side_confirmed_by uuid references public.staff (id);
alter table public.cb_accounts add column if not exists side_confirmed_at timestamptz;

create or replace function private.cb_side_open(p_account uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select m.pair_line is null and m.line_type in ('Asset', 'Liability')
      and m.name !~* '^(accumulated|allowance|less\M)|dividends|draws?\M'
      and abs(f.fin) >= 0.005 and (case when m.line_type = 'Asset' then f.fin < 0 else f.fin > 0 end)
      and a.side_confirmed_line is distinct from a.line_no
    from public.cb_accounts a join public.cb_master_lines m on m.line_no = a.line_no
    cross join lateral (select private.cb_account_final(a.id) as fin) f
   where a.id = p_account), false);
$$;
create or replace function private.cb_open_side_flags(p_file uuid) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.cb_accounts a where a.file_id = p_file and a.line_no is not null and private.cb_side_open(a.id);
$$;

create or replace function public.cb_confirm_side(p_account uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.cb_accounts;
begin
  perform private.require(private.can_edit('closebook') and private.is_owner(), 'Only the reviewer keeps a balance on this side. Reviewers are owners.');
  select * into a from public.cb_accounts where id = p_account;
  perform private.require(a.id is not null and (select phase from public.cb_files where id = a.file_id) <> 'locked', 'This file is locked or the account is gone.');
  perform private.require(private.cb_side_open(p_account), 'This balance is not on the wrong side of its line.');
  perform private.require(length(btrim(coalesce(p_reason, ''))) between 3 and 300, 'Type the reason for keeping it on this line.');
  update public.cb_accounts set side_confirm_reason = btrim(p_reason), side_confirmed_line = line_no, side_confirmed_by = (select auth.uid()), side_confirmed_at = now() where id = p_account;
  perform private.cb_log(a.file_id, 'side_confirmed', 'mapping', format('%s kept on GIFI %s: %s', btrim(coalesce(nullif(a.number, '') || ' ', '') || a.name), replace(a.line_no, '.00', ''), btrim(p_reason)));
end;
$$;
revoke all on function private.cb_side_open(uuid), private.cb_open_side_flags(uuid) from public, anon, authenticated;
revoke all on function public.cb_confirm_side(uuid, text) from public, anon;
grant execute on function public.cb_confirm_side(uuid, text) to authenticated;

-- Step 8's sign-offs (round 8 functions, with step 8 added).
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
  perform private.require(p_step in ('setup', 'opening', 'records', 'code', 'entries', 'review', 'mapping', 't2'), 'This step is not built yet: it has no sign-off.');
  perform private.require(p_role in ('prepared', 'reviewed'), 'Unknown sign-off.');
  select * into r from public.cb_step_signoffs where file_id = p_file and step = p_step;
  if p_role = 'prepared' then
    perform private.require(p_step <> 'review', 'Step 6 is the reviewer''s: it has no preparer sign-off.');
    perform private.require(r.prepared_at is null, 'This step is already signed as prepared.');
    v_list := case when p_step = 't2' then private.cb_step8_problems(p_file) else private.cb_prepare_blockers(p_file, p_step) end;
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
  foreach s in array array['setup', 'opening', 'records', 'code', 'entries', 'review', 'mapping', 't2'] loop
    select * into r from public.cb_step_signoffs where file_id = p_file and step = s;
    v := v || jsonb_build_object(s, jsonb_build_object(
      'prepared_by', r.prepared_by, 'prepared_at', r.prepared_at, 'reviewed_by', r.reviewed_by, 'reviewed_at', r.reviewed_at,
      'problems', to_jsonb(case when s = 'review' then private.cb_review_problems(p_file) when s = 't2' then private.cb_step8_problems(p_file) else private.cb_step_problems(p_file, s) end),
      'waiting', to_jsonb(case when s in ('review', 't2') then '{}'::text[] else private.cb_step_waiting(p_file, s) end),
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
  if p_step not in ('review', 't2') then
    perform private.cb_clear_step(p_file, 'review', 'A step it rests on changed');
  end if;
  -- A change to the trial balance (its import, coding, entries or matches) reopens step 8: the final
  -- export no longer matches it.
  if p_step in ('opening', 'records', 'code', 'entries', 'mapping') then
    perform private.cb_clear_step(p_file, 't2', 'The trial balance changed after the final export');
  end if;
end;
$function$

;

-- Step 7's waiting list, with the wrong-side balances (round 9 function otherwise unchanged).
create or replace function private.cb_step_waiting(p_file uuid, p_step text)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_out text[] := '{}';
  v_n int;
begin
  if p_step = 'opening' then
    if exists (select 1 from public.cb_accounts where file_id = p_file and account_key = 'opening' and needs_reviewer) then
      v_out := v_out || 'A difference with last year''s closing balances.'::text;
    end if;
  elsif p_step = 'code' then
    select count(*) into v_n from public.cb_bank_lines where file_id = p_file and status = 'reviewer';
    if v_n > 0 then v_out := v_out || format('%s line%s for the reviewer.', v_n, case when v_n = 1 then '' else 's' end); end if;
  elsif p_step = 'entries' then
    select count(*) into v_n from public.cb_entries where file_id = p_file and needs_review and reviewed_at is null;
    if v_n > 0 then v_out := v_out || format('%s entr%s to approve.', v_n, case when v_n = 1 then 'y' else 'ies' end); end if;
    v_out := v_out || private.cb_step5_waiting(p_file);
  elsif p_step = 'mapping' then
    select count(*) into v_n from public.cb_accounts where file_id = p_file and needs_reviewer and account_key not in ('opening', 'uncoded');
    if v_n > 0 then v_out := v_out || format('%s account%s waiting for the reviewer''s decision.', v_n, case when v_n = 1 then '' else 's' end); end if;
    v_n := private.cb_open_type_flags(p_file);
    if v_n > 0 then v_out := v_out || format('%s account%s on a GIFI line of another type.', v_n, case when v_n = 1 then '' else 's' end); end if;
    v_n := private.cb_open_side_flags(p_file);
    if v_n > 0 then v_out := v_out || format('%s account%s with a balance on the wrong side of its GIFI line.', v_n, case when v_n = 1 then '' else 's' end); end if;
  end if;
  select count(*) into v_n from public.cb_review_notes where file_id = p_file and step = p_step and status <> 'cleared';
  if v_n > 0 then v_out := v_out || format('%s review note%s to clear.', v_n, case when v_n = 1 then '' else 's' end); end if;
  return v_out;
end;
$function$

;
