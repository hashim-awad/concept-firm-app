-- Piece R1, version 2 (Hashim, Nov 19, 2026; benchmark CaseWare Cloud: one grouping for the statements and one GIFI property
-- for the tax return, mapped and checked at the tax stage): GIFI in one place, step 8 "Match accounts to GIFI".
--   * New column cb_accounts.gifi_override: a master line, set only in step 8 on bank-statement files. The GIFI file, the T2
--     tie-out and the tax workpaper read it when set, else the account's group (cb_accounts.line_no, unchanged). Lead sheets,
--     step 6 flags, statements, reports, the revenue check and shareholder loans keep the group (D1, D2). The tax code stays
--     the account's own, else the group line's default (D3).
--   * Step 8's box (private.cb_match_items) and the two ties (private.cb_match_ties) gate step 8's sign-off and the GIFI export
--     on bank-statement files. Trial balance files keep step 4 matching and step 7's GIFI checks until piece R2 (D7).
--   * Type and wrong-side flags test the line the account is reported on (the override when set, else the group). The
--     database refuses an override of another account type, an override on Clearing or a system row, and a preparer's pick
--     for an account waiting for the reviewer (D4, D5).
--   * An override change clears step 8 only (then 9 and 10 through the chain), with History naming the account and the old and
--     new line. It is in the export fingerprint, so a change after the final export makes it stale (D10). It rolls forward to
--     the client's next file.
--   * Wording before step 8 without GIFI (item 4): step 6 "no group", the entry writer, Reclassify, step 6 confirm; step 10's
--     refusal uses the step names on screen (item 7).
-- No table or column is dropped. No data is changed: the new column starts empty on every account. Safe to run twice.

alter table public.cb_accounts add column if not exists gifi_override text references public.cb_master_lines(line_no) on update cascade;
comment on column public.cb_accounts.gifi_override is 'Piece R1: the GIFI line for the tax return when it differs from the group (line_no). Step 8 only, bank-statement files.';

-- The line a balance is reported on: a paired line takes the balance on the other side (matching.ts effectiveLine).
create or replace function private.cb_eff_line(p_line text, p_fin numeric) returns text
language sql stable security definer set search_path = '' as $$
  select case when p_line is null then null
    when m.pair_line is null or coalesce(p_fin, 0) = 0 then p_line
    when (m.line_type in ('Asset', 'Expense') and p_fin < 0) or (m.line_type not in ('Asset', 'Expense') and p_fin > 0) then m.pair_line
    else p_line end
  from (select 1) x left join public.cb_master_lines m on m.line_no = p_line;
$$;

-- Step 8's box: every account on a bank-statement file that needs a decision, with one reason each, in this order:
-- clearing / opening / uncoded (system rows with a balance: no picker), no_group, reviewer, locked (a total or locked line),
-- suggested, type, side.
create or replace function private.cb_match_items(p_file uuid) returns table (account_id uuid, reason text)
language sql stable security definer set search_path = '' as $$
  select x.id, x.reason from (
    select a.id, a.number, a.name,
      case
        when a.account_key in ('chart:10900', 'opening', 'uncoded') then
          case when private.cb_account_final(a.id) <> 0 then case a.account_key when 'chart:10900' then 'clearing' else a.account_key end end
        when a.line_no is null then case when private.cb_account_used(a.id) then 'no_group' end
        when a.needs_reviewer then 'reviewer'
        when not coalesce(m.mappable, false) or coalesce(m.locked, false) then case when private.cb_account_final(a.id) <> 0 then 'locked' end
        when a.mapping_source = 'suggested' then 'suggested'
        when private.cb_flag_open(a.account_type, coalesce(a.gifi_override, a.line_no), a.type_confirm_reason, a.type_confirmed_line) then 'type'
        when private.cb_side_open(a.id) then 'side'
      end as reason
    from public.cb_accounts a
    join public.cb_files f on f.id = a.file_id and f.books in ('statements', 'paper')
    left join public.cb_master_lines m on m.line_no = coalesce(a.gifi_override, a.line_no)
    where a.file_id = p_file) x
  where x.reason is not null
  order by x.number, x.name;
$$;

-- The two ties, to the cent (D6). Chart side: each account's group line after the paired line flip; an account with no group
-- counts by its account type (else its number's type, round 5), so it shows as a difference. GIFI side: the override when set, else the group, after the same
-- flip, as the GIFI file builds them (accounts with no line or on a total line are left out there).
create or replace function private.cb_match_ties(p_file uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with b as (
    select a.id, coalesce(a.account_type, private.cb_type_from_number(a.number)) account_type, private.cb_account_final(a.id) fin, a.line_no, coalesce(a.gifi_override, a.line_no) gl
      from public.cb_accounts a where a.file_id = p_file),
  t as (
    select b.fin,
      coalesce((select m.line_type from public.cb_master_lines m where m.line_no = private.cb_eff_line(b.line_no, b.fin)), case when b.line_no is null then b.account_type end) ct,
      (select m.line_type from public.cb_master_lines m where m.line_no = private.cb_eff_line(b.gl, b.fin) and m.mappable) gt
      from b where b.fin <> 0)
  select jsonb_build_object(
    'ni_chart', coalesce(-sum(fin) filter (where ct in ('Revenue', 'Expense')), 0),
    'ni_gifi', coalesce(-sum(fin) filter (where gt in ('Revenue', 'Expense')), 0),
    'assets_chart', coalesce(sum(fin) filter (where ct = 'Asset'), 0),
    'assets_gifi', coalesce(sum(fin) filter (where gt = 'Asset'), 0))
  from t;
$$;

-- What step 8 and the export wait for on a bank-statement file. Trial balance files: nothing here (step 4 and step 7 as before).
create or replace function private.cb_match_problems(p_file uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v_out text[] := '{}'; v_n int; t jsonb;
begin
  if not exists (select 1 from public.cb_files where id = p_file and books in ('statements', 'paper')) then return v_out; end if;
  select count(*) into v_n from private.cb_match_items(p_file);
  if v_n > 0 then
    v_out := v_out || format('%s account%s need%s a decision in Match accounts to GIFI.', v_n, case when v_n = 1 then '' else 's' end, case when v_n = 1 then 's' else '' end);
  end if;
  t := private.cb_match_ties(p_file);
  if (t ->> 'ni_chart')::numeric <> (t ->> 'ni_gifi')::numeric then
    v_out := v_out || format('Net income %s does not equal GIFI 9999 %s: a difference of %s.', private.cb_money((t ->> 'ni_chart')::numeric),
      private.cb_money((t ->> 'ni_gifi')::numeric), private.cb_money((t ->> 'ni_chart')::numeric - (t ->> 'ni_gifi')::numeric));
  end if;
  if (t ->> 'assets_chart')::numeric <> (t ->> 'assets_gifi')::numeric then
    v_out := v_out || format('Total assets %s do not equal GIFI 2599 %s: a difference of %s.', private.cb_money((t ->> 'assets_chart')::numeric),
      private.cb_money((t ->> 'assets_gifi')::numeric), private.cb_money((t ->> 'assets_chart')::numeric - (t ->> 'assets_gifi')::numeric));
  end if;
  return v_out;
end;
$$;


-- Type flags test the line the account is reported on: the GIFI override when set, else the group.
CREATE OR REPLACE FUNCTION private.cb_open_type_flags(p_file uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select count(*)::int from public.cb_accounts a join public.cb_master_lines m on m.line_no = coalesce(a.gifi_override, a.line_no)
   where a.file_id = p_file and a.account_type is not null and m.line_type <> a.account_type
     and not (a.type_confirmed_line is not distinct from coalesce(a.gifi_override, a.line_no) and coalesce(a.type_confirm_reason, '') <> '');
$function$;

-- Wrong-side flags: the same line.
CREATE OR REPLACE FUNCTION private.cb_side_open(p_account uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((select m.pair_line is null and m.line_type in ('Asset', 'Liability')
      and m.name !~* '^(accumulated|allowance|less\M)|dividends|draws?\M'
      and abs(f.fin) >= 0.005 and (case when m.line_type = 'Asset' then f.fin < 0 else f.fin > 0 end)
      and a.side_confirmed_line is distinct from coalesce(a.gifi_override, a.line_no)
    from public.cb_accounts a join public.cb_master_lines m on m.line_no = coalesce(a.gifi_override, a.line_no)
    cross join lateral (select private.cb_account_final(a.id) as fin) f
   where a.id = p_account), false);
$function$;

-- The reviewer's "Keep it on this line" holds for the line the account is reported on.
CREATE OR REPLACE FUNCTION public.cb_confirm_type(p_account uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_acc public.cb_accounts;
  v_file public.cb_files;
  v_line_type text;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_acc from public.cb_accounts where id = p_account;
  perform private.require(v_acc.id is not null, 'Account not found.');
  select * into v_file from public.cb_files where id = v_acc.file_id for update;
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  perform private.require((select auth.uid()) = v_file.reviewer_id, 'Only the file''s reviewer confirms an account on a line of another type.');
  select line_type into v_line_type from public.cb_master_lines where line_no = coalesce(v_acc.gifi_override, v_acc.line_no);
  perform private.require(v_acc.account_type is not null and v_line_type is not null and v_line_type <> v_acc.account_type,
    'This account''s type matches its GIFI line: there is nothing to confirm.');
  perform private.require(v_reason <> '', 'Type the reason for keeping this account on a line of another type.');
  perform private.require(length(v_reason) <= 300, 'Keep the reason to 300 characters.');
  update public.cb_accounts set type_confirm_reason = v_reason, type_confirmed_by = (select auth.uid()), type_confirmed_at = now(),
         type_confirmed_line = coalesce(v_acc.gifi_override, v_acc.line_no)
   where id = p_account;
  update public.cb_files set updated_at = now() where id = v_file.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_confirm_side(p_account uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.cb_accounts;
begin
  perform private.require(private.can_edit('closebook') and private.is_owner(), 'Only the reviewer keeps a balance on this side. Reviewers are owners.');
  select * into a from public.cb_accounts where id = p_account;
  perform private.require(a.id is not null and (select phase from public.cb_files where id = a.file_id) <> 'locked', 'This file is locked or the account is gone.');
  perform private.require(private.cb_side_open(p_account), 'This balance is not on the wrong side of its line.');
  perform private.require(length(btrim(coalesce(p_reason, ''))) between 3 and 300, 'Type the reason for keeping it on this line.');
  update public.cb_accounts set side_confirm_reason = btrim(p_reason), side_confirmed_line = coalesce(gifi_override, line_no), side_confirmed_by = (select auth.uid()), side_confirmed_at = now() where id = p_account;
  perform private.cb_log(a.file_id, 'side_confirmed', 'review', format('%s kept on GIFI %s: %s', btrim(coalesce(nullif(a.number, '') || ' ', '') || a.name), replace(coalesce(a.gifi_override, a.line_no), '.00', ''), btrim(p_reason)));
end;
$function$;

-- D10: an override changed after the final export makes the export stale. With no override the text hashed is exactly as
-- before, so no saved export or shareholder schedule turns stale when this runs.
CREATE OR REPLACE FUNCTION private.cb_tb_fingerprint(p_file uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select md5(coalesce(string_agg(a.id::text || ':' || coalesce(a.line_no, '') || coalesce('>' || a.gifi_override, '') || ':' || coalesce(a.tax_code, '') || ':' || private.cb_account_final(a.id)::text, ',' order by a.id), ''))
    from public.cb_accounts a where a.file_id = p_file;
$function$;

CREATE OR REPLACE FUNCTION private.cb_review_problems(p_file uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_out text[] := '{}';
  v_n int;
  v_names text;
begin
  select string_agg(n.label, ', ' order by n.ord) into v_names from (values
    ('setup', 'step 1', 1), ('opening', 'step 2', 2), ('records', 'step 3', 3), ('code', 'step 4', 4), ('entries', 'step 5', 5), ('compare', 'step 6', 6)) n(step, label, ord)
   where not exists (select 1 from public.cb_step_signoffs s where s.file_id = p_file and s.step = n.step and s.reviewed_at is not null);
  if v_names is not null then v_out := v_out || format('Review %s first.', v_names); end if;
  select count(*) into v_n from public.cb_review_notes where file_id = p_file and status <> 'cleared';
  if v_n > 0 then v_out := v_out || format('%s review note%s still open.', v_n, case when v_n = 1 then '' else 's' end); end if;
  select count(*) into v_n from (select unnest(private.cb_step_waiting(p_file, s)) w from unnest(array['opening', 'code', 'entries']) s) x
   where w not like '%review note%';
  -- Piece 7: the GST/HST returns difference (now in step 8) still waits for the reviewer here, as it did from step 5.
  if coalesce((private.cb_revenue_state(p_file) ->> 'gst_waiting')::boolean, false) then v_n := v_n + 1; end if;
  if v_n > 0 then v_out := v_out || 'Items still wait for the reviewer: see the list above.'::text; end if;
  -- Piece 10: the reviewer's GIFI checks (moved from the old step 6), the new accounts and the "yes" answers of step 6.
  -- Piece R1 (D5, D7): on bank-statement files the reviewer's GIFI checks moved to step 8; trial balance files keep them here until R2.
  if not exists (select 1 from public.cb_files where id = p_file and books in ('statements', 'paper')) then
    v_out := v_out || private.cb_gifi_review_waiting(p_file);
  end if;
  v_out := v_out || private.cb_compare_review_problems(p_file);
  -- Piece 8: the shareholder loans, answered by the reviewer here.
  return v_out || private.cb_sh_review_problems(p_file);
end;
$function$;

CREATE OR REPLACE FUNCTION private.cb_step8_problems(p_file uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v jsonb := private.cb_t2_state(p_file); v_out text[] := '{}'; i jsonb; v_n int;
begin
  -- Piece R1: Match accounts to GIFI first (the box empty, the two ties met).
  v_out := v_out || private.cb_match_problems(p_file);
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
  -- Piece 7: the revenue in the books against the revenue on the year's GST/HST returns (moved from step 5).
  v_out := v_out || private.cb_gst_revenue_problems(p_file);
  select count(*) into v_n from public.cb_review_notes where file_id = p_file and step = 't2' and status = 'open';
  if v_n > 0 then v_out := v_out || format('%s review note%s to fix.', v_n, case when v_n = 1 then '' else 's' end); end if;
  return v_out;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_record_gifi_export(p_file uuid, p_kind text, p_file_name text, p_content text, p_totals jsonb, p_checks jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  perform private.require(v_n = 0, format('Export refused. %s account%s not matched or waiting for the reviewer.', v_n, case when v_n = 1 then ' is' else 's are' end));
  -- Piece R1: on bank-statement files, Match accounts to GIFI must be done (the box empty, the ties met).
  select string_agg(x, ' ') into v_failed from unnest(private.cb_match_problems(p_file)) x;
  perform private.require(v_failed is null, 'Export refused. ' || coalesce(v_failed, ''));
  perform private.require(p_content like '"GIFI01",%', 'The file is not a GIFI file.');
  insert into public.cb_gifi_exports (file_id, kind, file_name, content, totals, checks, fingerprint, created_by)
  values (p_file, p_kind, btrim(p_file_name), p_content, p_totals, p_checks, private.cb_tb_fingerprint(p_file), (select auth.uid()))
  returning id into v_id;
  perform private.cb_log(p_file, 'gifi_exported', 't2', btrim(p_file_name));
  return v_id;
end;
$function$;

-- History says "group" for a line change on bank-statement files; the owner's decision on a flag of the reported line clears nothing.
CREATE OR REPLACE FUNCTION private.cb_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_file uuid;
  v_step text := tg_argv[0];
  v_why text := tg_argv[1];
  v_bank boolean;
  v_row record;
  v_txt text;
  v_verb text := case tg_op when 'INSERT' then 'added' when 'DELETE' then 'removed' else 'changed' end;
  v_tje boolean := false;   -- piece 6
  v_moved boolean := false;   -- piece 10b
begin
  if tg_table_name = 'cb_bank_lines' and coalesce(current_setting('cb.review', true), '') = 'on' then return null; end if;   -- round 35
  v_row := case when tg_op = 'DELETE' then old else new end;
  if tg_table_name = 'cb_entry_lines' then
    select e.file_id, format('Entry %s-%s lines %s', to_char(f.year_end, 'YYYY'), lpad(e.seq::text, 3, '0'), v_verb), e.kind = 'TJE' into v_file, v_txt, v_tje
      from public.cb_entries e join public.cb_files f on f.id = e.file_id where e.id = v_row.entry_id;
  elsif tg_table_name = 'cb_files' then
    v_file := v_row.id;
    if v_step = 'setup' then v_txt := private.cb_setup_diff(old.setup, new.setup); end if;
  else
    v_file := v_row.file_id;
  end if;
  if v_file is null then return null; end if;

  if tg_table_name = 'cb_bank_lines' and tg_op = 'UPDATE' then
    -- The reviewer's decision on a line sent to the reviewer: the preparer's sign-off stays.
    if old.status = 'reviewer' and private.is_owner() then return null; end if;
    v_txt := format('%s %s: %s', to_char(new.txn_date, 'Mon FMDD'), left(new.description, 40),
      concat_ws(', ',
        case when old.chart_account is distinct from new.chart_account then format('account %s to %s', coalesce(old.chart_account, 'none'), coalesce(new.chart_account, 'none')) end,
        case when old.acct_date is distinct from new.acct_date then format('date %s to %s', to_char(old.acct_date, 'Mon FMDD'), to_char(new.acct_date, 'Mon FMDD')) end,
        case when old.tax_code is distinct from new.tax_code then format('tax %s to %s', coalesce(old.tax_code, 'none'), coalesce(new.tax_code, 'none')) end,
        case when old.status is distinct from new.status then format('%s to %s',
          case old.status when 'new' then 'to code' when 'done' then 'coded' when 'ask_client' then 'with the client' when 'matched' then 'matched to a transfer' when 'excluded' then 'excluded' else 'for the reviewer' end,
          case new.status when 'new' then 'to code' when 'done' then 'coded' when 'ask_client' then 'with the client' when 'matched' then 'matched to a transfer' when 'excluded' then 'excluded' else 'for the reviewer' end) end));
  elsif tg_table_name = 'cb_bank_lines' then
    v_txt := format('Statement line %s: %s %s', v_verb, to_char(v_row.txn_date, 'Mon FMDD'), left(v_row.description, 40));
  elsif tg_table_name = 'cb_accounts' then
    -- The reviewer's decision on an account waiting for it, or on a line of another type: the sign-off stays.
    if private.is_owner() and (old.needs_reviewer or private.cb_flag_open(old.account_type, coalesce(old.gifi_override, old.line_no), old.type_confirm_reason, old.type_confirmed_line)) then
      return null;
    end if;
    v_txt := format('%s: %s', btrim(coalesce(nullif(new.number, '') || ' ', '') || new.name),
      concat_ws(', ',
        case when old.line_no is distinct from new.line_no then format(case when exists (select 1 from public.cb_files where id = v_file and books in ('statements', 'paper')) then 'group %s to %s' else 'GIFI %s to %s' end, coalesce(replace(old.line_no, '.00', ''), 'none'), coalesce(replace(new.line_no, '.00', ''), 'none')) end,
        case when old.tax_code is distinct from new.tax_code then format('tax code %s to %s', coalesce(old.tax_code, 'the line''s default'), coalesce(new.tax_code, 'the line''s default')) end,
        case when old.type_confirm_reason is distinct from new.type_confirm_reason then 'kept on a line of another type' end));
    select books in ('statements', 'paper') into v_bank from public.cb_files where id = v_file;
    -- A trial balance file matches in step 4 and maps in step 7: a line change touches both.
    if not v_bank then perform private.cb_clear_step(v_file, 'code', v_txt); end if;
    -- Piece 10: step 6 no longer chains to step 8, so a GIFI line, tax code or type change clears step 8 here, as before.
    perform private.cb_clear_step(v_file, 't2', v_txt);
  elsif tg_table_name = 'cb_imports' then
    v_step := case v_row.target when 'account_list' then 'compare' when 'last_year' then 'opening' else 'records' end;
    v_txt := format('%s %s (%s)', case v_row.target when 'account_list' then 'QuickBooks Account List' when 'last_year' then 'Last year''s trial balance' else 'Trial balance' end,
      case tg_op when 'INSERT' then 'imported' else 'removed' end, v_row.file_name);
    if v_row.target = 'account_list' then
      perform private.cb_clear_step(v_file, 'code', v_txt);
      perform private.cb_clear_step(v_file, 't2', v_txt);   -- piece 10, as above
    end if;
  elsif tg_table_name = 'cb_bank_statements' then
    select format('Statement %s: %s, %s to %s', v_verb, b.name, to_char(v_row.period_start, 'Mon FMDD, YYYY'), to_char(v_row.period_end, 'Mon FMDD, YYYY')) into v_txt
      from public.cb_bank_accounts b where b.id = v_row.account_id;
  elsif tg_table_name = 'cb_opening_balances' then
    v_txt := format('Last year''s balance sheet: GIFI %s %s', v_row.code, v_verb);
  elsif tg_table_name = 'cb_entries' then
    v_txt := format('Entry %s-%s %s', (select to_char(year_end, 'YYYY') from public.cb_files where id = v_file), lpad(v_row.seq::text, 3, '0'), v_verb);
    -- Piece 6: a TJE added, deleted or changed while it stays a TJE. A change of type to or from TJE is an AJE change.
    v_tje := case when tg_op = 'UPDATE' then old.kind = 'TJE' and new.kind = 'TJE' else v_row.kind = 'TJE' end;
  elsif tg_table_name = 'cb_flag_notes' then
    select format('Lead sheet explanation %s: %s', v_verb, btrim(coalesce(nullif(a.number, '') || ' ', '') || a.name)) into v_txt
      from public.cb_accounts a where a.id = v_row.account_id;
  -- Piece 10: step 6's ticks and answers (step 6), and the reviewer's "Mark reviewed" on them (step 7, by the trigger's step).
  elsif tg_table_name = 'cb_new_accounts' then
    select btrim(coalesce(nullif(a.number, '') || ' ', '') || a.name) into v_txt
      from public.cb_accounts a where a.file_id = v_file and a.account_key = v_row.account_key limit 1;
    v_txt := coalesce(v_txt, v_row.account_key) || case when tg_op = 'INSERT' then ': confirmed as a new account'
      when tg_op = 'DELETE' then ': new account tick removed' when v_step = 'review' then ': review mark changed' else ': confirmed again' end;
  elsif tg_table_name = 'cb_year_changes' then
    v_txt := private.cb_year_question(v_row.question) || case when tg_op = 'DELETE' then ': answer removed' when v_step = 'review' then ': review mark changed' else ': answered' end;
  elsif tg_table_name = 'cb_compare_seen' then
    v_txt := case when tg_op = 'DELETE' then 'Accounts not used this year: Seen removed' else 'Accounts not used this year: Seen ticked' end;
  end if;
  -- Piece 7 (Hashim, Nov 18, 2026): the GST/HST returns figure and its note belong to step 8. A change to them clears step 8,
  -- not step 5. The revenue check itself (step 5) clears step 5 as before.
  -- (Nested: v_row is another table's row on other triggers, so its kind is read only here.)
  if tg_table_name = 'cb_revenue_sources' then
    if v_row.kind = 'gst_returns' then
      perform private.cb_clear_step(v_file, 't2', 'The revenue on the GST/HST returns changed');
      return null;
    end if;
  end if;
  if tg_table_name = 'cb_revenue_checks' then
    if tg_op = 'UPDATE' then
      if old.gst_explanation is distinct from new.gst_explanation then
        perform private.cb_clear_step(v_file, 't2', 'The GST/HST revenue note changed');
      end if;
      if old.explanation is not distinct from new.explanation and old.t4a_explanation is not distinct from new.t4a_explanation
         and old.t4a_none is not distinct from new.t4a_none then
        return null;
      end if;
    elsif tg_op = 'INSERT' then
      if new.gst_explanation <> '' then
        perform private.cb_clear_step(v_file, 't2', 'The GST/HST revenue note changed');
      end if;
      if new.explanation = '' and new.t4a_explanation = '' and not new.t4a_none and new.added_at is null then
        return null;
      end if;
    end if;
  end if;
  -- Piece 6 (Hashim, Nov 18, 2026): a tax entry leaves steps 5, 6 and 7 signed. The final GIFI export is stale, so
  -- step 8 is cleared (and steps 9 and 10 follow), as when step 5's chain cleared it.
  if v_tje and v_step = 'entries' then
    perform private.cb_clear_step(v_file, 't2', coalesce(nullif(v_txt, ''), v_why));
    return null;
  end if;
  if v_step = 'records' and exists (select 1 from public.cb_files where id = v_file and books in ('statements', 'paper')) then
    perform private.cb_clear_substeps(v_file, array['3.2', '3.3'], coalesce(nullif(v_txt, ''), v_why));   -- round 34
    -- Piece 10b: statement lines or statements added or removed move the balances: step 6 reopens even when step 3 is not
    -- fully signed. A statement changed in place (its file replaced, its source) moves nothing.
    if tg_op <> 'UPDATE' then
      perform private.cb_clear_step(v_file, 'compare', coalesce(nullif(v_txt, ''), v_why));
    end if;
  else
    perform private.cb_clear_step(v_file, v_step, coalesce(nullif(v_txt, ''), v_why));
  end if;
  -- Piece 10b (Hashim, Nov 19, 2026): an AJE or RJE that moves a balance reopens step 6: added or deleted, its lines changed,
  -- or its type or date changed. Its note, reason, W/P ref or attachments, and the revenue check, leave step 6 signed.
  -- (Nested: old and new are read only for cb_entries.)
  if v_step = 'entries' then
    if tg_table_name = 'cb_entry_lines' then
      -- cb_edit_entry writes every line again; it clears step 6 itself, only when the lines differ.
      v_moved := coalesce(current_setting('cb.lines_rewrite', true), '') <> 'on';
    elsif tg_table_name = 'cb_entries' then
      if tg_op <> 'UPDATE' then
        v_moved := true;
      elsif old.kind is distinct from new.kind or old.entry_date is distinct from new.entry_date then
        v_moved := true;
      end if;
    end if;
    if v_moved then
      perform private.cb_clear_step(v_file, 'compare', coalesce(nullif(v_txt, ''), v_why));
    end if;
  end if;
  return null;
end;
$function$;

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
      v_out := v_out || private.cb_opening_problems(p_file);
    elsif not exists (select 1 from public.cb_imports where file_id = p_file and target = 'this_year') then
      v_out := v_out || 'Import the trial balance: last year''s column comes with it.'::text;
    end if;
  elsif p_step = 'records' then
    if v_bank then
      -- Round 22: accounts, coverage, waiting statements, the tie to step 2 and the year edges.
      v_out := v_out || private.cb_records_problems(p_file);
    else
      if not exists (select 1 from public.cb_imports where file_id = p_file and target = 'this_year') then
        v_out := v_out || 'Import the trial balance.'::text;
      elsif (select coalesce(sum(this_year), 0) from public.cb_accounts where file_id = p_file) <> 0 then
        v_out := v_out || 'The trial balance does not balance: import it again.'::text;
      end if;
    end if;
  elsif p_step = 'code' then
    if v_bank then
      -- Round 31: Pending lines (some asked of the client), then the excluded lines until the reviewer ticks them.
      select count(*) into v_n from public.cb_bank_lines l where l.file_id = p_file and private.cb_line_pending(l);
      if v_n > 0 then v_out := v_out || format('%s line%s pending.', v_n, case when v_n = 1 then '' else 's' end); end if;
      select count(*) into v_n from public.cb_bank_lines l where l.file_id = p_file and l.status = 'excluded';
      if v_n > 0 and (select excluded_reviewed_key from public.cb_files where id = p_file) is distinct from private.cb_excluded_key(p_file) then
        v_out := v_out || format('Excluded: %s line%s · %s. The reviewer ticks "Excluded lines reviewed".', v_n, case when v_n = 1 then '' else 's' end,
          private.cb_money((select sum(abs(amount)) from public.cb_bank_lines where file_id = p_file and status = 'excluded')));
      end if;
      v_out := v_out || private.cb_code_tie_problems(p_file);
    else
      select count(*) into v_n from public.cb_accounts a where a.file_id = p_file and a.line_no is null and not a.needs_reviewer
         and a.account_key not in ('chart:10900', 'opening', 'uncoded') and private.cb_account_used(a.id);
      if v_n > 0 then v_out := v_out || format('%s account%s to match to a GIFI line.', v_n, case when v_n = 1 then '' else 's' end); end if;
    end if;
  elsif p_step = 'entries' then
    -- Piece 10: the flagged changes are explained in step 6 now.
    -- Round 9: the revenue check, and expenses paid personally when the setup says so.
    v_out := v_out || private.cb_step5_problems(p_file);
  elsif p_step = 'compare' then
    -- Piece 10, step 6 "Compare to last year". a) Every flagged change explained (moved from step 5; the rule is unchanged).
    select flag_amount, flag_percent into v_flag_amount, v_flag_percent from public.cb_settings limit 1;
    v_flag_amount := coalesce(v_flag_amount, 5000); v_flag_percent := coalesce(v_flag_percent, 20);
    select count(*) into v_n from (
      select a.id, private.cb_account_final(a.id) - coalesce((select sum(l.amount) from public.cb_entry_lines l join public.cb_entries e on e.id = l.entry_id
           where l.account_id = a.id and e.kind = 'TJE'), 0) fin, a.last_year from public.cb_accounts a join public.cb_master_lines m on m.line_no = a.line_no
       where a.file_id = p_file and m.lead_sheet is not null and left(coalesce(a.line_no, ''), 4) not in ('3600', '3660')
         and coalesce(a.tax_code, m.default_tax_code, '') not in ('INCTAX', 'AMORT')) x   -- piece 6
     where abs(fin - last_year) > v_flag_amount and (last_year = 0 or abs(fin - last_year) / abs(last_year) * 100 > v_flag_percent)
       and not exists (select 1 from public.cb_flag_notes n where n.account_id = x.id);
    if v_n > 0 then v_out := v_out || format('%s flagged change%s to explain in Flagged changes.', v_n, case when v_n = 1 then '' else 's' end); end if;
    -- Every used account in a group, and Clearing at zero (moved from the old step 6).
    select count(*) into v_n from public.cb_accounts a where a.file_id = p_file and a.line_no is null and not a.needs_reviewer
       and a.account_key not in ('chart:10900', 'opening', 'uncoded') and private.cb_account_used(a.id);
    if v_n > 0 then v_out := v_out || format('%s account%s with no group: choose a group.', v_n, case when v_n = 1 then '' else 's' end); end if;
    if exists (select 1 from public.cb_accounts a where a.file_id = p_file and a.account_key = 'chart:10900' and private.cb_account_final(a.id) <> 0) then
      v_out := v_out || 'Clearing (10900) has a balance: move it to the right account.'::text;
    end if;
    -- b) Every new account confirmed, in the group it has now.
    select count(*) into v_n from private.cb_compare_accounts(p_file) x where x.kind = 'new'
       and not exists (select 1 from public.cb_new_accounts n where n.file_id = p_file and n.account_key = x.account_key and n.confirmed_line is not distinct from x.line_no);
    if v_n > 0 then v_out := v_out || format('%s new account%s to confirm.', v_n, case when v_n = 1 then '' else 's' end); end if;
    -- c) The accounts not used this year seen.
    v_txt := private.cb_unused_key(p_file);
    if v_txt <> '' and not exists (select 1 from public.cb_compare_seen where file_id = p_file and seen_key = v_txt) then
      v_out := v_out || 'Accounts not used this year: tick Seen.'::text;
    end if;
    -- d) Every question answered.
    select 6 - count(*) into v_n from public.cb_year_changes where file_id = p_file;
    if v_n > 0 then v_out := v_out || format('What changed this year: %s question%s to answer.', v_n, case when v_n = 1 then '' else 's' end); end if;
  end if;
  -- A review note not yet fixed is open work on its step.
  select count(*) into v_n from public.cb_review_notes where file_id = p_file and step = p_step and status = 'open';
  if v_n > 0 then v_out := v_out || format('%s review note%s to fix.', v_n, case when v_n = 1 then '' else 's' end); end if;
  return v_out;
end;
$function$;

-- Item 7: step 10's refusal uses the step names on screen.
CREATE OR REPLACE FUNCTION private.cb_lock_problems(p_file uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_out text[] := '{}'; v_file public.cb_files; c public.cb_file_close; s record; st record; v_bank boolean; g public.cb_gst_returns;
begin
  select * into v_file from public.cb_files where id = p_file;
  v_bank := v_file.books in ('statements', 'paper');
  for st in select * from (values (1, 'setup', 'Set up'), (2, 'opening', 'Opening balances'),
                                  (3, 'records', case when v_bank then 'Banking' else 'Get the records' end),
                                  (4, 'code', case when v_bank then 'Code transactions' else 'Match accounts to GIFI' end),
                                  (5, 'entries', 'Adjustments'), (6, 'compare', 'Compare to last year'), (7, 'review', 'Review'),
                                  (8, 't2', 'Tax returns'), (9, 'statements', 'Statements')) as x(n, k, name) order by n loop
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
$function$;

CREATE OR REPLACE FUNCTION private.cb_entry_write_lines(p_entry uuid, p_file public.cb_files, p_kind text, p_reason text, p_reverse boolean, p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_fid uuid := p_file.id;
  v_own boolean := p_file.books in ('client_software', 'bookkeeper');
  v jsonb;
  v_acc uuid;
  v_line text;
  v_key text;
  v_name text;
  v_type text;
  v_chart public.cb_chart_accounts;
  v_sum numeric := 0;
  v_income numeric := 0;
  v_re boolean;
  v_ppa_line boolean := false;
  v_plain jsonb := '[]'::jsonb;
begin
  for v in select * from jsonb_array_elements(p_lines) loop
    perform private.require(round((v ->> 'amount')::numeric, 2) <> 0, 'Every line needs an amount.');
    perform private.require(nullif(v ->> 'tax_code', '') is null or exists (select 1 from public.cb_sales_tax_codes where code = v ->> 'tax_code'), 'Unknown sales tax code.');
    v_name := nullif(btrim(coalesce(v ->> 'new_name', '')), '');
    v_type := nullif(v ->> 'new_type', '');
    v_acc := null; v_key := '';
    if nullif(v ->> 'account', '') is not null then
      select a.id, a.line_no, a.account_key into v_acc, v_line, v_key from public.cb_accounts a where a.id = (v ->> 'account')::uuid and a.file_id = v_fid;
      perform private.require(v_acc is not null, 'An account is not in this file.');
      -- Clearing (10900) has no group by design; the reviewer clears it with an entry (round 4 item 3).
      perform private.require(v_line is not null or v_key = 'chart:10900', 'Choose an account from the chart first.');
    elsif nullif(v ->> 'chart', '') is not null then
      select * into v_chart from public.cb_chart_accounts where number = v ->> 'chart';
      perform private.require(v_chart.number is not null, 'Choose an account from the standard chart.');
      v_line := v_chart.line_no;
      if v_own then
        -- The client's own account on that GIFI line; for the sales tax line only, a new "GST/HST payable".
        select id into v_acc from public.cb_accounts where file_id = v_fid and line_no = v_line and not client_new
          and account_key not like 'line:%' and account_key not like 'gifi:%' and number <> '' order by number limit 1;
        if v_acc is null then
          perform private.require(coalesce((v ->> 'is_tax')::boolean, false), 'Choose one of the client''s accounts, or name a new account for their books.');
          v_name := v_chart.name; v_type := 'Other Current Liabilities';
        end if;
      else
        insert into public.cb_accounts (file_id, account_key, number, name, this_year, line_no, mapping_source, mapped_at)
        values (v_fid, 'chart:' || v_chart.number, v_chart.number, v_chart.name, 0, v_chart.line_no, 'chart', now())
        on conflict (file_id, account_key) do nothing;
        select id, account_key into v_acc, v_key from public.cb_accounts where file_id = v_fid and account_key = 'chart:' || v_chart.number;
      end if;
    else
      v_line := v ->> 'line';
      perform private.require(not v_own or v_name is not null, 'Choose one of the client''s accounts, or name a new account for their books.');
    end if;
    -- Retained earnings only moves through a prior period adjustment, which posts to GIFI 3720.
    v_re := v_line like '3600.%' or v_key in ('gifi:3660', 'gifi:3600');
    if v_re then
      perform private.require(p_reason = 'prior_period', 'A line on retained earnings needs the reason "Prior period adjustment".');
      v_line := '3720.00'; v_acc := null;
      if v_own then v_name := 'Prior period adjustments'; v_type := 'Equity'; end if;
    end if;
    if v_line like '3720.%' then
      perform private.require(p_reason = 'prior_period', 'A line on 31500 Prior period adjustments needs the reason "Prior period adjustment".');
      v_ppa_line := true;
    end if;
    if v_acc is null then
      perform private.require(exists (select 1 from public.cb_master_lines where line_no = v_line and mappable), 'Entries cannot post to a total line.');
      perform private.require(not private.cb_line_locked(v_line), 'This line is locked because it has sub-lines. Choose one of its sub-lines.');
      if v_own then
        perform private.require(length(v_name) between 3 and 80, 'Name the new account in plain words, for example "Amortization expense".');
        perform private.require(v_type is not null, 'Choose the new account''s QuickBooks account type.');
        insert into public.cb_accounts (file_id, account_key, number, name, line_no, mapping_source, mapped_by, mapped_at, client_new, qbo_type)
        values (v_fid, 'new:' || lower(v_name), '', v_name, v_line, 'preparer', (select auth.uid()), now(), true, v_type)
        on conflict (file_id, account_key) do nothing;
        select id into v_acc from public.cb_accounts where file_id = v_fid and account_key = 'new:' || lower(v_name);
      else
        -- A standard chart account on that line comes first (31500 for 3720); a bare line only when none.
        select * into v_chart from public.cb_chart_accounts where line_no = v_line order by sort_order limit 1;
        if v_chart.number is not null then
          insert into public.cb_accounts (file_id, account_key, number, name, this_year, line_no, mapping_source, mapped_at)
          values (v_fid, 'chart:' || v_chart.number, v_chart.number, v_chart.name, 0, v_chart.line_no, 'chart', now())
          on conflict (file_id, account_key) do nothing;
          select id into v_acc from public.cb_accounts where file_id = v_fid and account_key = 'chart:' || v_chart.number;
        else
          insert into public.cb_accounts (file_id, account_key, number, name, line_no, mapping_source, mapped_by, mapped_at)
          select v_fid, 'line:' || v_line, '', m.name, v_line, 'preparer', (select auth.uid()), now() from public.cb_master_lines m where m.line_no = v_line
          on conflict (file_id, account_key) do nothing;
          select id into v_acc from public.cb_accounts where file_id = v_fid and account_key = 'line:' || v_line;
        end if;
      end if;
    end if;
    -- Piece 3: a line from a schedule keeps its part (the Schedule tag). Only the schedule writes a new one; an edit of a
    -- schedule entry may keep them, after cb_edit_entry checked the amounts are the schedule's.
    perform private.require(nullif(v ->> 'schedule_part', '') is null or coalesce(current_setting('cb.schedule_save', true), '') = 'on'
      or (select origin from public.cb_entries where id = p_entry) = 'schedule', 'Change this amount in its schedule: click the Schedule tag.');
    insert into public.cb_entry_lines (entry_id, account_id, amount, memo, tax_code, is_tax, schedule_part)
    values (p_entry, v_acc, round((v ->> 'amount')::numeric, 2), left(coalesce(v ->> 'memo', ''), 200), nullif(v ->> 'tax_code', ''), coalesce((v ->> 'is_tax')::boolean, false),
            nullif(v ->> 'schedule_part', ''));
    if not coalesce((v ->> 'is_tax')::boolean, false) then v_plain := v_plain || jsonb_build_array(jsonb_build_object('line', v_line, 'amount', round((v ->> 'amount')::numeric, 2), 'tax', v ->> 'tax_code')); end if;
    v_sum := v_sum + round((v ->> 'amount')::numeric, 2);
    if (select line_type from public.cb_master_lines where line_no = v_line) in ('Revenue', 'Expense') then v_income := v_income + round((v ->> 'amount')::numeric, 2); end if;
  end loop;
  perform private.require(v_sum = 0, format('The entry does not balance: it is out by %s.', v_sum));
  perform private.require(p_kind <> 'RJE' or v_income = 0, 'A reclassifying entry (RJE) cannot change the result. Use an AJE.');
  perform private.require(p_reason <> 'prior_period' or v_ppa_line, 'The reason "Prior period adjustment" needs a line on 31500 Prior period adjustments.');
  perform private.require(p_reason <> 'prior_period' or not coalesce(p_reverse, false), 'A prior period adjustment never reverses next year.');
  return v_plain;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_reclassify(p_file uuid, p_items jsonb, p_account text, p_tax text, p_total numeric DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_file public.cb_files := private.cb_file_open(p_file);
  v_bankfile boolean := v_file.books in ('statements', 'paper');
  v_acc text := nullif(btrim(coalesce(p_account, '')), '');
  v_tax text := nullif(btrim(coalesce(p_tax, '')), '');
  v_chart public.cb_chart_accounts;
  v_target uuid; v_label text := ''; v_batch uuid; it jsonb;
  l public.cb_bank_lines; el public.cb_entry_lines; e public.cb_entries;
  v_new_acc text; v_new_tax text; v_bn int := 0; v_en int := 0; v_from text[] := '{}';
begin
  perform private.require(jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) between 1 and 5000, 'Tick the lines to reclassify.');
  perform private.require(v_acc is not null or v_tax is not null, 'Choose an account, a sales tax code, or both.');
  if v_acc is not null then
    if v_bankfile then
      select * into v_chart from public.cb_chart_accounts where number = v_acc;
      perform private.require(v_chart.number is not null, 'Choose an account from the chart.');
      perform private.require(not private.cb_bank_chart(p_file, v_acc), 'Bank, card and loan accounts change in step 3 and step 4, not here.');
      v_label := v_chart.number || ' ' || v_chart.name;
    else
      perform private.require(v_acc ~ '^[0-9a-f-]{36}$' and exists (select 1 from public.cb_accounts where id = v_acc::uuid and file_id = p_file and line_no is not null),
        'Choose one of this file''s accounts.');
      v_target := v_acc::uuid; v_label := private.cb_account_label(v_target);
    end if;
  end if;
  perform private.require(v_tax is null or exists (select 1 from public.cb_sales_tax_codes where code = v_tax), 'Choose a sales tax code from the list.');
  insert into public.cb_reclass_batches (file_id, created_by, target, target_label, tax, total)
  values (p_file, (select auth.uid()), coalesce(v_acc, ''), v_label, v_tax, coalesce(p_total, 0)) returning id into v_batch;

  for it in select * from jsonb_array_elements(p_items) loop
    if it ->> 'kind' = 'bank' then
      perform private.require(v_bankfile, 'Line not found.');
      select * into l from public.cb_bank_lines where id = (it ->> 'id')::uuid and file_id = p_file for update;
      perform private.require(l.id is not null, 'Line not found. Nothing was changed.');
      perform private.require(l.status in ('done', 'reviewer') and not private.cb_line_pending(l), format('%s: only a posted line changes here. Post it in step 4 first. Nothing was changed.', left(l.description, 40)));
      perform private.require(l.transfer_account is null and coalesce(l.source, '') not in ('transfer', 'outstanding')
        and not exists (select 1 from public.cb_bank_transfers t where t.out_line = l.id or t.in_line = l.id), format('%s is a transfer: change it in step 4. Nothing was changed.', left(l.description, 40)));
      perform private.require(not l.is_split, format('%s is split: change it with Split. Nothing was changed.', left(l.description, 40)));
      perform private.require(l.chart_account is not null, 'Line not found. Nothing was changed.');
      v_new_acc := coalesce(v_acc, l.chart_account); v_new_tax := coalesce(v_tax, l.tax_code);
      if v_new_acc is distinct from l.chart_account or v_new_tax is distinct from l.tax_code then
        insert into public.cb_reclass_items (batch_id, kind, item_id, old_account, old_tax, old_source, old_rule, new_account, new_tax)
        values (v_batch, 'bank', l.id, l.chart_account, l.tax_code, l.source, l.rule_id, v_new_acc, v_new_tax);
        v_from := array_append(v_from, l.chart_account);
        -- The line's own trigger logs "Coding changed" (old and new), and cb_changed removes step 4's sign-off.
        update public.cb_bank_lines set chart_account = v_new_acc, tax_code = v_new_tax, source = 'manual', rule_id = null where id = l.id;
        v_bn := v_bn + 1;
      end if;
    elsif it ->> 'kind' = 'entry' then
      select * into el from public.cb_entry_lines where id = (it ->> 'id')::uuid for update;
      select * into e from public.cb_entries where id = el.entry_id;
      perform private.require(e.id is not null and e.file_id = p_file, 'Entry line not found. Nothing was changed.');
      perform private.require(not coalesce(el.is_tax, false), format('Entry %s: a sales tax line follows its entry. Change the entry in step 5. Nothing was changed.', private.cb_entry_label(e.id)));
      perform private.require(coalesce(e.origin, '') = '', format('Entry %s comes from a working paper: change it there. Nothing was changed.', private.cb_entry_label(e.id)));
      if v_acc is null then continue; end if;   -- an entry line keeps its sales tax (its tax line is worked out in step 5)
      if v_bankfile and v_target is null then
        insert into public.cb_accounts (file_id, account_key, number, name, this_year, line_no, mapping_source, mapped_at)
        values (p_file, 'chart:' || v_chart.number, v_chart.number, v_chart.name, 0, v_chart.line_no, 'chart', now())
        on conflict (file_id, account_key) do nothing;
        select id into v_target from public.cb_accounts where file_id = p_file and account_key = 'chart:' || v_chart.number;
      end if;
      if v_target is distinct from el.account_id then
        insert into public.cb_reclass_items (batch_id, kind, item_id, old_account, old_tax, new_account, new_tax)
        values (v_batch, 'entry', el.id, el.account_id::text, el.tax_code, v_target::text, el.tax_code);
        v_from := array_append(v_from, coalesce(private.cb_account_label(el.account_id), ''));
        perform private.cb_log_event(p_file, 'entry_line_reclassified', 'entries', format('Entry %s line reclassified', private.cb_entry_label(e.id)), null, null,
          private.cb_entry_label(e.id), coalesce(nullif(el.memo, ''), ''), coalesce(private.cb_account_label(el.account_id), ''), v_label);
        update public.cb_entry_lines set account_id = v_target where id = el.id;   -- cb_changed removes step 5's sign-off
        v_en := v_en + 1;
      end if;
    else
      raise exception 'Line not found. Nothing was changed.' using errcode = 'P0001';
    end if;
  end loop;
  perform private.require(v_bn + v_en > 0, 'Nothing to change: the ticked lines already have this account and sales tax.');
  update public.cb_reclass_batches set n = v_bn + v_en where id = v_batch;
  perform private.cb_log_event(p_file, 'reclassified', case when v_bn = 0 then 'entries' else 'code' end,
    format('Reclassified %s line%s', v_bn + v_en, case when v_bn + v_en = 1 then '' else 's' end), null, null,
    format('%s line%s, %s', v_bn + v_en, case when v_bn + v_en = 1 then '' else 's' end, to_char(coalesce(p_total, 0), 'FM999,999,999,990.00')),
    concat_ws(', ', case when v_bn > 0 then format('%s bank line%s', v_bn, case when v_bn = 1 then '' else 's' end) end,
      case when v_en > 0 then format('%s entry line%s', v_en, case when v_en = 1 then '' else 's' end) end),
    (select string_agg(distinct x, ', ') from unnest(v_from) x),
    concat_ws(', ', nullif(v_label, ''), case when v_tax is not null then 'sales tax ' || v_tax end));
  return v_batch;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_confirm_new_account(p_file uuid, p_account text, p_on boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file public.cb_files; c record;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  if not p_on then
    delete from public.cb_new_accounts where file_id = p_file and account_key = p_account;
    if found then perform private.cb_log(p_file, 'new_account_unconfirmed', 'compare', p_account); end if;
    return;
  end if;
  select * into c from private.cb_compare_accounts(p_file) x where x.kind = 'new' and x.account_key = p_account;
  perform private.require(c.account_key is not null, 'This account is not new this year.');
  perform private.require(c.line_no is not null, 'Choose a group for the account first.');
  insert into public.cb_new_accounts (file_id, account_key, confirmed_line, confirmed_by) values (p_file, p_account, c.line_no, (select auth.uid()))
  on conflict (file_id, account_key) do update set confirmed_line = excluded.confirmed_line, confirmed_by = excluded.confirmed_by, confirmed_at = now(),
    reviewed_line = null, reviewed_by = null, reviewed_at = null
   where public.cb_new_accounts.confirmed_line is distinct from excluded.confirmed_line;
  if found then perform private.cb_log(p_file, 'new_account_confirmed', 'compare', format('%s in group %s', p_account, replace(c.line_no, '.00', ''))); end if;
end;
$function$;

-- Step 8's paper reads the box and the ties.
create or replace function public.cb_match_state(p_file uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require(private.can_view('closebook'), 'You need Closebook access.');
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object('account_id', i.account_id, 'reason', i.reason)) from private.cb_match_items(p_file) i), '[]'::jsonb),
    'ties', private.cb_match_ties(p_file),
    'problems', to_jsonb(private.cb_match_problems(p_file)));
end;
$$;

-- Set or remove an account's GIFI override (step 8, bank-statement files). p_line null, or the group's own line, removes it.
-- Saving the line the account is on now is a decision too (accounting review of the build): it confirms a suggested line,
-- and when the reviewer (or an owner) saves an account waiting for the reviewer it clears that item, as cb_map_account does.
-- The reviewer's decision clears no sign-off; a changed line clears step 8.
create or replace function public.cb_set_gifi_override(p_account uuid, p_line text) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.cb_accounts; v_file public.cb_files; v_line text := nullif(btrim(coalesce(p_line, '')), ''); v_group_type text; v_type text;
  v_label text; v_old text; v_new text;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  -- The file first, then the account, as cb_confirm_type does (security finding 3: one lock order).
  select * into v_file from public.cb_files where id = (select file_id from public.cb_accounts where id = p_account) for update;
  select * into a from public.cb_accounts where id = p_account for update;
  perform private.require(a.id is not null, 'Account not found.');
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(v_file.books in ('statements', 'paper'), 'On this file, match accounts to GIFI in step 4.');
  perform private.require(a.account_key not in ('chart:10900', 'opening', 'uncoded'),
    'Clearing and the system rows take no GIFI line. Clear the balance with an entry or in the step that made it.');
  perform private.require(a.line_no is not null, 'Choose a group for the account first.');
  perform private.require(not a.needs_reviewer or private.cb_is_reviewer(v_file), 'This account waits for the reviewer''s decision.');
  if v_line = a.line_no then v_line := null; end if;
  if v_line is not null then
    perform private.require(exists (select 1 from public.cb_master_lines where line_no = v_line and mappable), 'Choose a GIFI line staff can match to (totals are calculated).');
    perform private.require(not private.cb_line_locked(v_line), 'This line is locked because it has sub-lines. Choose one of its sub-lines.');
    select line_type into v_group_type from public.cb_master_lines where line_no = a.line_no;
    select line_type into v_type from public.cb_master_lines where line_no = v_line;
    perform private.require(v_type = v_group_type,
      format('This is a GIFI line for %s. The account''s group is for %s: choose a line of the same type.', lower(v_type), lower(v_group_type)));
    -- Retained earnings moves only through a prior period adjustment (3720): never an override onto 3600 or 3660.
    perform private.require(left(v_line, 4) not in ('3600', '3660'), 'Retained earnings is not a line to move an account to. Use a prior period adjustment (3720) through an entry.');
  end if;
  v_label := btrim(coalesce(nullif(a.number, '') || ' ', '') || a.name);
  if a.mapping_source = 'suggested' then
    update public.cb_accounts set mapping_source = case when private.cb_is_reviewer(v_file) then 'reviewer' else 'preparer' end, mapped_by = (select auth.uid()), mapped_at = now() where id = a.id;
  end if;
  if a.needs_reviewer and private.cb_is_reviewer(v_file) then
    update public.cb_accounts set needs_reviewer = false, review_note = format('Decided in step 8: GIFI %s', replace(coalesce(v_line, a.line_no), '.00', '')),
           review_by = (select auth.uid()), review_at = now(), review_cents = round(this_year * 100) where id = a.id;
    perform private.cb_log_event(a.file_id, 'account_reviewed', 't2', 'Account decided in step 8', null, null, v_label,
      format('GIFI %s', replace(coalesce(v_line, a.line_no), '.00', '')), a.reviewer_reason, 'Reviewed');
  end if;
  if v_line is not distinct from a.gifi_override then return; end if;
  update public.cb_accounts set gifi_override = v_line where id = a.id;
  v_old := replace(coalesce(a.gifi_override, a.line_no), '.00', '');
  v_new := replace(coalesce(v_line, a.line_no), '.00', '');
  perform private.cb_log_event(a.file_id, 'gifi_override', 't2', format('%s: GIFI %s to %s', v_label, v_old, v_new), null, null, v_label, null, 'GIFI ' || v_old, 'GIFI ' || v_new);
  perform private.cb_clear_step(a.file_id, 't2', format('%s: GIFI %s to %s', v_label, v_old, v_new));
  update public.cb_files set updated_at = now() where id = a.file_id;
end;
$$;

-- The override rolls forward to the client's next bank-statement file with the account, while it still fits the group.
create or replace function private.cb_override_roll() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  if new.gifi_override is not null or new.line_no is null then return new; end if;
  select a.gifi_override into v
    from public.cb_files f
    join public.cb_files pf on pf.client_id = f.client_id and pf.year_end < f.year_end
    left join public.cb_accounts a on a.file_id = pf.id and a.account_key = new.account_key
   where f.id = new.file_id and f.books in ('statements', 'paper')
   order by pf.year_end desc limit 1;
  if v is not null and v <> new.line_no
     and exists (select 1 from public.cb_master_lines o join public.cb_master_lines g on g.line_no = new.line_no
                  where o.line_no = v and o.mappable and not o.locked and o.line_type = g.line_type) then
    new.gifi_override := v;
    -- Security finding 2: the carried line is in the new file's History.
    perform private.cb_log_event(new.file_id, 'gifi_override', 't2', format('%s: GIFI %s carried from last year', btrim(coalesce(nullif(new.number, '') || ' ', '') || new.name),
      replace(v, '.00', '')), null, null, btrim(coalesce(nullif(new.number, '') || ' ', '') || new.name), 'Carried from last year', 'GIFI ' || replace(new.line_no, '.00', ''), 'GIFI ' || replace(v, '.00', ''));
  end if;
  return new;
end;
$$;
drop trigger if exists cb_override_roll on public.cb_accounts;
create trigger cb_override_roll before insert on public.cb_accounts for each row execute function private.cb_override_roll();

-- Accounting review of the build: a group changed to a line of another type drops an override that no longer fits, with a
-- History line (the database never keeps an override of another type).
create or replace function private.cb_override_group() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.gifi_override is not null and new.line_no is distinct from old.line_no
     and (new.line_no is null or (select line_type from public.cb_master_lines where line_no = new.line_no)
                                  is distinct from (select line_type from public.cb_master_lines where line_no = new.gifi_override)) then
    perform private.cb_log_event(new.file_id, 'gifi_override', 't2', format('%s: GIFI %s dropped, the group changed to another type',
      btrim(coalesce(nullif(new.number, '') || ' ', '') || new.name), replace(new.gifi_override, '.00', '')), null, null,
      btrim(coalesce(nullif(new.number, '') || ' ', '') || new.name), 'Group changed', 'GIFI ' || replace(new.gifi_override, '.00', ''), 'GIFI ' || coalesce(replace(new.line_no, '.00', ''), 'none'));
    new.gifi_override := null;
  end if;
  return new;
end;
$$;
drop trigger if exists cb_override_group on public.cb_accounts;
create trigger cb_override_group before update of line_no on public.cb_accounts for each row execute function private.cb_override_group();

revoke all on function private.cb_override_group() from public, anon, authenticated;
revoke all on function private.cb_eff_line(text, numeric), private.cb_match_items(uuid), private.cb_match_ties(uuid), private.cb_match_problems(uuid),
  private.cb_override_roll() from public, anon, authenticated;
revoke all on function public.cb_match_state(uuid), public.cb_set_gifi_override(uuid, text) from public, anon;
grant execute on function public.cb_match_state(uuid), public.cb_set_gifi_override(uuid, text) to authenticated;
