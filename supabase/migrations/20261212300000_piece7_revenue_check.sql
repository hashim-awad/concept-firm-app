-- Piece 7, version 2 (Hashim, Nov 18, 2026; benchmark CaseWare Cloud): the revenue check becomes a schedule the preparer adds
-- in step 5; the comparison with the GST/HST returns moves to step 8's GST/HST return page.
--   * cb_revenue_checks.added_at / added_by: set by public.cb_add_revenue_check ("+ Add revenue check"). A file that already
--     has a revenue source, a T4A, an explanation, "no T4A", an acceptance or an entry made from the check counts as added
--     (private.cb_revenue_added); nothing is written to existing files. GST/HST data alone does not count.
--   * Step 5 needs the revenue check done only once added. Step 8 needs the GST/HST revenue comparison done on a GST/HST
--     registrant's full file; a difference over the review limit waits for the reviewer. The figures and notes stay where
--     they are stored (cb_revenue_sources kind 'gst_returns', cb_revenue_checks.gst_*): nothing is moved, retyped or deleted.
--   * A change to the GST/HST figure or its note clears step 8, not step 5. History logs the GST/HST acceptance under step 8.
-- No table or column is dropped. No data is changed. Safe to run twice.

alter table public.cb_revenue_checks add column if not exists added_at timestamptz;
alter table public.cb_revenue_checks add column if not exists added_by uuid references public.staff (id);

create or replace function private.cb_revenue_added(p_file uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.cb_revenue_checks r where r.file_id = p_file and (r.added_at is not null or r.explanation <> '' or r.t4a_explanation <> ''
           or r.t4a_none or r.accepted_at is not null or r.t4a_accepted_at is not null))
      or exists (select 1 from public.cb_revenue_sources s where s.file_id = p_file and s.kind <> 'gst_returns')
      or exists (select 1 from public.cb_entries e where e.file_id = p_file and e.origin = 'revenue_check');
$$;
revoke all on function private.cb_revenue_added(uuid) from public, anon, authenticated;

create or replace function public.cb_revenue_status(p_file uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require(private.can_view('closebook'), 'You need Closebook access.');
  return private.cb_revenue_state(p_file) || jsonb_build_object('added', private.cb_revenue_added(p_file));
end;
$$;
revoke all on function public.cb_revenue_status(uuid) from public, anon;
grant execute on function public.cb_revenue_status(uuid) to authenticated;

-- "+ Add revenue check" (step 5). Once added it stays: removing it is not offered.
create or replace function public.cb_add_revenue_check(p_file uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(v_file.file_type = 'full', 'Monthly files have no revenue check.');
  if private.cb_revenue_added(p_file) then return; end if;
  insert into public.cb_revenue_checks (file_id, added_at, added_by) values (p_file, now(), (select auth.uid()))
  on conflict (file_id) do update set added_at = now(), added_by = (select auth.uid());
  perform private.cb_log(p_file, 'revenue_added', 'entries', 'Revenue check added');
  perform private.cb_clear_step(p_file, 'entries', 'Revenue check added');
end;
$$;
revoke all on function public.cb_add_revenue_check(uuid) from public, anon;
grant execute on function public.cb_add_revenue_check(uuid) to authenticated;

-- Step 8: the note on the GST/HST revenue difference, alone (the other explanations are step 5's).
create or replace function public.cb_save_gst_revenue_note(p_file uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files; v jsonb; v_note text := btrim(coalesce(p_note, ''));
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(length(v_note) <= 200, 'Keep the note to one line (200 characters).');
  v := private.cb_revenue_state(p_file);
  insert into public.cb_revenue_checks (file_id, gst_explanation, gst_explained_diff, updated_by)
  values (p_file, v_note, case when v_note <> '' then (v ->> 'gst_diff')::numeric end, (select auth.uid()))
  on conflict (file_id) do update set gst_explanation = excluded.gst_explanation, gst_explained_diff = excluded.gst_explained_diff,
    updated_by = excluded.updated_by, updated_at = now();
end;
$$;
revoke all on function public.cb_save_gst_revenue_note(uuid, text) from public, anon;
grant execute on function public.cb_save_gst_revenue_note(uuid, text) to authenticated;

-- Step 8's GST/HST revenue comparison (moved from step 5): a registrant's full file.
create or replace function private.cb_gst_revenue_problems(p_file uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb := private.cb_revenue_state(p_file); v_out text[] := '{}'; v_full boolean;
begin
  select file_type = 'full' into v_full from public.cb_files where id = p_file;
  if not coalesce(v_full, false) or not (v ->> 'registrant')::boolean then return v_out; end if;
  if (v ->> 'n_gst')::int = 0 then
    -- A return built in Closebook is asked for by private.cb_gst_problems.
    if not (v ->> 'gst_from_return')::boolean then v_out := v_out || 'GST/HST revenue: enter the revenue on the year''s GST/HST returns and attach them.'::text; end if;
  elsif (v ->> 'gst_diff')::numeric <> 0 and not (v ->> 'gst_explained')::boolean then
    v_out := v_out || 'GST/HST revenue: explain the difference between the books and the returns.'::text;
  elsif (v ->> 'gst_waiting')::boolean then
    v_out := v_out || format('GST/HST revenue: the difference of %s is over the review threshold: the reviewer accepts it.', private.cb_money((v ->> 'gst_diff')::numeric));
  end if;
  return v_out;
end;
$$;
revoke all on function private.cb_gst_revenue_problems(uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION private.cb_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_file uuid;
  v_step text := tg_argv[0];
  v_why text := tg_argv[1];
  v_bank boolean;
  v_row record;
  v_txt text;
  v_verb text := case tg_op when 'INSERT' then 'added' when 'DELETE' then 'removed' else 'changed' end;
  v_tje boolean := false;   -- piece 6
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
    if private.is_owner() and (old.needs_reviewer or private.cb_flag_open(old.account_type, old.line_no, old.type_confirm_reason, old.type_confirmed_line)) then
      return null;
    end if;
    v_txt := format('%s: %s', btrim(coalesce(nullif(new.number, '') || ' ', '') || new.name),
      concat_ws(', ',
        case when old.line_no is distinct from new.line_no then format('GIFI %s to %s', coalesce(replace(old.line_no, '.00', ''), 'none'), coalesce(replace(new.line_no, '.00', ''), 'none')) end,
        case when old.tax_code is distinct from new.tax_code then format('tax code %s to %s', coalesce(old.tax_code, 'the line''s default'), coalesce(new.tax_code, 'the line''s default')) end,
        case when old.type_confirm_reason is distinct from new.type_confirm_reason then 'kept on a line of another type' end));
    select books in ('statements', 'paper') into v_bank from public.cb_files where id = v_file;
    -- A trial balance file matches in step 4 and maps in step 7: a line change touches both.
    if not v_bank then perform private.cb_clear_step(v_file, 'code', v_txt); end if;
  elsif tg_table_name = 'cb_imports' then
    v_step := case v_row.target when 'account_list' then 'mapping' when 'last_year' then 'opening' else 'records' end;
    v_txt := format('%s %s (%s)', case v_row.target when 'account_list' then 'QuickBooks Account List' when 'last_year' then 'Last year''s trial balance' else 'Trial balance' end,
      case tg_op when 'INSERT' then 'imported' else 'removed' end, v_row.file_name);
    if v_row.target = 'account_list' then perform private.cb_clear_step(v_file, 'code', v_txt); end if;
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
  else
    perform private.cb_clear_step(v_file, v_step, coalesce(nullif(v_txt, ''), v_why));
  end if;
  return null;
end;
$$;

CREATE OR REPLACE FUNCTION private.cb_step5_problems(p_file uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v jsonb := private.cb_revenue_state(p_file);
  v_out text[] := '{}';
  v_file public.cb_files;
begin
  select * into v_file from public.cb_files where id = p_file;
  -- Piece 7: the revenue check is required only once it was added (by "+ Add revenue check", or saved before piece 7).
  if not private.cb_revenue_added(p_file) then return v_out || private.cb_sh_problems(p_file); end if;
  if (v ->> 'realtor')::boolean and (v ->> 'n_commission')::int = 0 then
    v_out := v_out || 'Revenue check: enter the brokerage''s commission statement.'::text;
  elsif (v ->> 'n_sources')::int = 0 then
    v_out := v_out || 'Revenue check: enter the revenue source and attach it.'::text;
  elsif (v ->> 'diff')::numeric <> 0 and not (v ->> 'explained')::boolean then
    v_out := v_out || case when v ->> 'explanation' = '' then 'Revenue check: explain the difference, or fix it with an entry.'
      else 'Revenue check: the difference changed since it was explained. Check the explanation and save it again.' end;
  end if;
  -- Piece 7: the comparison with the GST/HST returns moved to step 8 (private.cb_gst_revenue_problems).
  if (v ->> 'realtor')::boolean then
    if (v ->> 'n_t4a')::int = 0 and not (v ->> 't4a_none')::boolean then v_out := v_out || 'Revenue check: enter the brokerage''s T4A, or say there is none.'::text;
    elsif (v ->> 'n_t4a')::int > 0 and (v ->> 't4a_diff')::numeric <> 0 and not (v ->> 't4a_explained')::boolean then
      v_out := v_out || 'Revenue check: explain the difference between the T4A and the commission statement.'::text;
    end if;
  end if;
  return v_out || private.cb_sh_problems(p_file);
end;
$$;

CREATE OR REPLACE FUNCTION private.cb_step5_waiting(p_file uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
declare v jsonb := private.cb_revenue_state(p_file);
  v_out text[] := '{}';
begin
  if (v ->> 'waiting')::boolean then v_out := v_out || format('Revenue difference of %s, over the review threshold.', private.cb_money((v ->> 'diff')::numeric)); end if;
  -- Piece 7: the GST/HST returns difference waits in step 8 (private.cb_gst_revenue_problems).
  if (v ->> 't4a_waiting')::boolean then v_out := v_out || format('T4A difference of %s, over the review threshold.', private.cb_money((v ->> 't4a_diff')::numeric)); end if;
  return v_out || private.cb_sh_waiting(p_file);
end;
$$;

CREATE OR REPLACE FUNCTION private.cb_step8_problems(p_file uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
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
  -- Piece 7: the revenue in the books against the revenue on the year's GST/HST returns (moved from step 5).
  v_out := v_out || private.cb_gst_revenue_problems(p_file);
  select count(*) into v_n from public.cb_review_notes where file_id = p_file and step = 't2' and status = 'open';
  if v_n > 0 then v_out := v_out || format('%s review note%s to fix.', v_n, case when v_n = 1 then '' else 's' end); end if;
  return v_out;
end;
$$;

CREATE OR REPLACE FUNCTION private.cb_review_problems(p_file uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_out text[] := '{}';
  v_n int;
  v_names text;
begin
  select string_agg(n.label, ', ' order by n.ord) into v_names from (values
    ('setup', 'step 1', 1), ('opening', 'step 2', 2), ('records', 'step 3', 3), ('code', 'step 4', 4), ('entries', 'step 5', 5), ('mapping', 'step 6', 6)) n(step, label, ord)
   where not exists (select 1 from public.cb_step_signoffs s where s.file_id = p_file and s.step = n.step and s.reviewed_at is not null);
  if v_names is not null then v_out := v_out || format('Review %s first.', v_names); end if;
  select count(*) into v_n from public.cb_review_notes where file_id = p_file and status <> 'cleared';
  if v_n > 0 then v_out := v_out || format('%s review note%s still open.', v_n, case when v_n = 1 then '' else 's' end); end if;
  select count(*) into v_n from (select unnest(private.cb_step_waiting(p_file, s)) w from unnest(array['opening', 'code', 'entries', 'mapping']) s) x
   where w not like '%review note%';
  -- Piece 7: the GST/HST returns difference (now in step 8) still waits for the reviewer here, as it did from step 5.
  if coalesce((private.cb_revenue_state(p_file) ->> 'gst_waiting')::boolean, false) then v_n := v_n + 1; end if;
  if v_n > 0 then v_out := v_out || 'Items still wait for the reviewer: see the list above.'::text; end if;
  return v_out;
end;
$$;

CREATE OR REPLACE FUNCTION public.cb_accept_revenue_difference(p_file uuid, p_check text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare v jsonb; v_diff numeric; v_name text;
begin
  perform private.require(private.can_edit('closebook') and private.is_owner(), 'Only the reviewer accepts a revenue difference. Reviewers are owners.');
  perform private.require(p_check in ('revenue', 'gst', 't4a'), 'Unknown check.');
  v := private.cb_revenue_state(p_file);
  v_diff := (v ->> case p_check when 'revenue' then 'diff' when 'gst' then 'gst_diff' else 't4a_diff' end)::numeric;
  v_name := case p_check when 'revenue' then 'Revenue difference' when 'gst' then 'GST/HST returns difference' else 'T4A difference' end;
  perform private.require((v ->> case p_check when 'revenue' then 'waiting' when 'gst' then 'gst_waiting' else 't4a_waiting' end)::boolean,
    'Nothing to accept: the difference is within the review threshold, already accepted, or has no source yet.');
  perform private.require((v ->> case p_check when 'revenue' then 'explained' when 'gst' then 'gst_explained' else 't4a_explained' end)::boolean,
    'The preparer explains this difference first.');
  insert into public.cb_revenue_checks (file_id) values (p_file) on conflict (file_id) do nothing;
  if p_check = 'revenue' then update public.cb_revenue_checks set accepted_by = (select auth.uid()), accepted_at = now(), accepted_diff = v_diff where file_id = p_file;
  elsif p_check = 'gst' then update public.cb_revenue_checks set gst_accepted_by = (select auth.uid()), gst_accepted_at = now(), gst_accepted_diff = v_diff where file_id = p_file;
  else update public.cb_revenue_checks set t4a_accepted_by = (select auth.uid()), t4a_accepted_at = now(), t4a_accepted_diff = v_diff where file_id = p_file;
  end if;
  perform private.cb_log(p_file, 'revenue_accepted', case when p_check = 'gst' then 't2' else 'entries' end, format('%s %s accepted', v_name, private.cb_money(v_diff)));
end;
$$;
revoke all on function private.cb_changed(), private.cb_step5_problems(uuid), private.cb_step5_waiting(uuid), private.cb_step8_problems(uuid),
  private.cb_review_problems(uuid) from public, anon, authenticated;
revoke all on function public.cb_accept_revenue_difference(uuid, text) from public, anon;
grant execute on function public.cb_accept_revenue_difference(uuid, text) to authenticated;
